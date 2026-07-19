/*
@licstart  The following is the entire license notice for the
JavaScript code in this file.

Copyright (C) 2026  Gregory Marton

The JavaScript code in this file is free software: you can
redistribute it and/or modify it under the terms of the GNU
General Public License (GNU GPL) as published by the Free Software
Foundation, either version 3 of the License, or (at your option)
any later version.  The code is distributed WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.

As additional permission under GNU GPL version 3 section 7, you
may distribute non-source (e.g., minimized or compacted) forms of
that code without the copy of the GNU GPL normally required by
section 4, provided you include this license notice and a URL
through which recipients can access the Corresponding Source.

@licend  The above is the entire license notice
for the JavaScript code in this file.
*/
/**
 * replay.js - Always-on input recording for post-hoc bug reports and full session recreation.
 *
 * Keeps a rolling log of the last MAX_EVENTS raw events (keydown, pointer down/up, and viewport
 * resize/orientation changes) from page load, independent of the current mode. Modes routinely
 * reassign window.onkeydown per mode switch (App.setMode nulls it, each mode's setupEvents()
 * reassigns it) -- this listens via addEventListener instead, so it keeps recording across every
 * mode change without needing any mode to cooperate.
 *
 * Keystrokes and taps alone aren't enough to actually recreate a session: every mode that draws
 * random pieces (Gravity, Blast) depends on Math.random(), and without knowing what it produced,
 * replaying the same inputs against a fresh (differently-random) session won't reproduce
 * anything. So this seeds Math.random() once per page load, from real entropy (via
 * crypto.getRandomValues -- gameplay is exactly as unpredictable to the player as before, only
 * now the specific sequence any one session got is reproducible after the fact), and records
 * that seed. Pointer coordinates are similarly meaningless without knowing the viewport size and
 * orientation they were captured at, which can change mid-session on mobile -- recorded at load
 * and on every resize.
 *
 * A player who hits a bug can open the browser console and type copy(replay()) to get their
 * seed, viewport history, and last few thousand real inputs as JSON, without having to reproduce
 * the issue with any special instrumentation pre-armed -- the recording was already running.
 */
const Replay = {
    MAX_EVENTS: 5000,
    log: [],
    seed: null,

    record: function(entry) {
        this.log.push(entry);
        if (this.log.length > this.MAX_EVENTS) {
            this.log.shift();
        }
    },

    describeTarget: function(el) {
        if (!el || !el.tagName) return null;
        if (el.id) return `#${el.id}`;
        if (typeof el.className === 'string' && el.className) return `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}`;
        return el.tagName.toLowerCase();
    },

    // mulberry32 -- small, fast, good-enough-for-gameplay deterministic PRNG. Used to REPLACE
    // Math.random() globally (not just to drive test scripts, as elsewhere in this repo).
    //
    // Recording a seed is only half of "full recreation" -- the other half is being able to
    // feed a previously-recorded seed back in and actually get the same random sequence again.
    // A `?seed=` URL param does that: a developer investigating a bug report pastes the seed
    // from the report into the URL and reloads. With no param, seed from real entropy as usual,
    // so ordinary gameplay stays exactly as unpredictable as before.
    seedRandom: function() {
        const forced = (typeof window !== 'undefined' && window.location)
            ? parseInt(new URLSearchParams(window.location.search).get('seed'), 10)
            : NaN;

        this.seed = !isNaN(forced) ? (forced >>> 0)
            : (typeof crypto !== 'undefined' && crypto.getRandomValues)
                ? crypto.getRandomValues(new Uint32Array(1))[0]
                : (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;

        let state = this.seed;
        Math.random = function() {
            state |= 0; state = (state + 0x6D2B79F5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    recordViewport: function() {
        this.record({
            type: 'resize', t: Date.now(),
            width: window.innerWidth, height: window.innerHeight,
            orientation: window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'
        });
    },

    // Session-level facts that affect how input actually dispatches and how the game behaves
    // (unlike viewport size, these don't change mid-session, so one snapshot at load suffices).
    // version identifies which exact commit's code produced this recording -- game logic itself
    // changes over time, so replaying against the wrong checkout can behave differently even
    // with the right seed/inputs. devicePixelRatio doesn't affect game logic (which works in
    // CSS-pixel/logical coordinates), but is cheap and worth keeping for anyone visually
    // comparing screenshots against a replay.
    recordMeta: function() {
        this.meta = {
            version: (typeof GIT_VERSION !== 'undefined') ? GIT_VERSION : 'local',
            userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'unknown',
            maxTouchPoints: (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0,
            devicePixelRatio: (typeof window !== 'undefined' && window.devicePixelRatio) || 1
        };
    },

    recordVisibility: function() {
        this.record({ type: 'visibility', t: Date.now(), state: document.visibilityState });
    },

    init: function() {
        this.seedRandom();
        this.recordMeta();
        this.recordViewport();

        window.addEventListener('keydown', (e) => {
            this.record({ type: 'keydown', t: Date.now(), key: e.key, code: e.code, shiftKey: e.shiftKey });
        }, { capture: true });

        window.addEventListener('pointerdown', (e) => {
            this.record({ type: 'pointerdown', t: Date.now(), x: e.clientX, y: e.clientY, target: this.describeTarget(e.target) });
        }, { capture: true });

        window.addEventListener('pointerup', (e) => {
            this.record({ type: 'pointerup', t: Date.now(), x: e.clientX, y: e.clientY, target: this.describeTarget(e.target) });
        }, { capture: true });

        window.addEventListener('resize', () => this.recordViewport());
        // orientationchange is a belt-and-suspenders backup: some mobile browsers have a history
        // of firing it before the viewport's own resize event catches up.
        window.addEventListener('orientationchange', () => this.recordViewport());

        // Tab/app going to the background explains otherwise-mysterious gaps in a replay (a long
        // stretch with no input isn't necessarily a hang -- the player may just have switched
        // away), and matters for reproduction if any mode ever comes to pause on visibility.
        document.addEventListener('visibilitychange', () => this.recordVisibility());

        const link = document.getElementById('report-bug-link');
        if (link) link.addEventListener('click', (e) => this.reportBug(e));
    },

    /**
     * Players who can't reach a browser console (most mobile users -- see docs/ for why) still
     * need a way to report a bug with their real input history attached. This bypasses the
     * console entirely: it fires a clipboard write with the full log (best-effort; clipboard
     * access needs a secure context, so it silently no-ops over file:// or older browsers) and
     * opens a prefilled GitHub issue. Only the last 30 events go directly in the URL, since a
     * GitHub issue URL carrying the full 5000-event log would be far too long to work reliably.
     */
    buildIssueUrl: function() {
        const mode = (typeof App !== 'undefined') ? App.currentMode : 'unknown';
        const viewport = `${window.innerWidth || '?'}x${window.innerHeight || '?'}`;
        const meta = this.meta || {};
        const recentEvents = this.log.slice(-30);
        // Appending ?seed=<seed> to the app's own URL re-forces the same random sequence on
        // reload -- see seedRandom(). This turns the recorded seed from a fact into something
        // directly actionable for whoever investigates the report.
        const replayUrl = `${location.origin}${location.pathname}?seed=${this.seed}`;

        const body = [
            `**Version:** ${meta.version || 'unknown'}`,
            `**Mode:** ${mode}`,
            `**Seed:** ${this.seed} (reload with \`${replayUrl}\` to reproduce the same random sequence)`,
            `**Viewport:** ${viewport}`,
            `**User agent:** ${meta.userAgent || 'unknown'}`,
            `**Max touch points:** ${meta.maxTouchPoints}`,
            `**Device pixel ratio:** ${meta.devicePixelRatio}`,
            '',
            '**What happened:**',
            '(describe the bug here)',
            '',
            'If your recent input history isn\'t already pasted below (some browsers block automatic clipboard copying), open the browser console, run `copy(replay())`, and paste the result here.',
            '',
            `**Last ${recentEvents.length} recorded inputs:**`,
            '```json',
            JSON.stringify(recentEvents, null, 2),
            '```',
        ].join('\n');

        const params = new URLSearchParams({ title: 'Bug report', body });
        return `https://github.com/gregory-marton/Tonncade/issues/new?${params.toString()}`;
    },

    reportBug: function(e) {
        if (e) e.preventDefault();

        if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(window.replay()).catch(() => {});
        }

        window.open(this.buildIssueUrl(), '_blank');
    }
};

// { seed, meta, events } together are enough to fully recreate a session: the seed reproduces
// the exact random piece sequence, meta carries the session-level browser facts that affect how
// input dispatches and how the game behaves, and events carries every keystroke/tap plus the
// viewport size at each point in time. See the file header comment for why each part matters.
window.replay = function() {
    return JSON.stringify({ seed: Replay.seed, meta: Replay.meta, events: Replay.log });
};

if (typeof module !== 'undefined') {
    module.exports = Replay;
}
