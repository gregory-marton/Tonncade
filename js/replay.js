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
 * Keeps a rolling log of the last MAX_EVENTS raw events (keydown, pointer down/up, viewport
 * resize/orientation changes, and every real note played -- see wrapSynth) from page load,
 * independent of the current mode. Modes routinely
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
 *
 * Every recorded event also carries a `tick` count (see recordTick) -- the number of automatic
 * mode advances (GravityMode/SnakeMode's setInterval-driven tick()) that have fired so far. A
 * replay tool can reconstruct the exact interleaving of automatic ticks and player input by
 * calling tick() directly that many times between events, rather than inferring it from
 * wall-clock deltas -- which turned out to be fragile for long sessions with real thinking-pauses
 * (small timing differences during replay compounded into a completely different outcome).
 */
const Replay = {
    MAX_EVENTS: 5000,
    log: [],
    seed: null,
    tickSeq: 0,

    // Sound events get their own, much larger ring buffer, entirely separate from `log` (raw
    // input events). They're a fundamentally different kind of data -- a dense, high-frequency
    // verification trace rather than sparse reconstruction instructions -- and their volume
    // reflects that: one real ~2-game Gravity session produced ~2100 sound events against just
    // ~250 real input events (89% of a combined log), which would have evicted precious,
    // irreplaceable early-session input events out of a shared MAX_EVENTS buffer on any longer
    // session. Each entry is tiny ({t, tick, midi}), so a generous cap costs little.
    MAX_SOUND_EVENTS: 50000,
    soundLog: [],

    // Both logs are capped by amortized trimming, not a shift() on every single push: shift()
    // is O(n) (it re-indexes every remaining element), so paying it on every insert once a log
    // is at capacity would mean every single recorded event/sound costs O(n) work. Letting a log
    // grow to 2x its nominal cap before bulk-trimming back down to exactly the cap in one splice
    // pays the same total trimming work, amortized across `cap` pushes instead of paid on every
    // one -- O(1) amortized per push, at the cost of the log occasionally holding up to 2x its
    // nominal cap in memory (a few extra MB at most here, trivial). Both logs stay plain,
    // chronologically-ordered arrays throughout -- callers (tests, replay-to-gif.js, the JSON
    // export below) read them directly, no wrap-around indexing to account for.
    trimToCapacity: function(arr, cap) {
        if (arr.length > cap * 2) {
            arr.splice(0, arr.length - cap);
        }
    },

    recordSound: function(midi) {
        this.soundLog.push({ t: Date.now(), tick: this.tickSeq, midi });
        this.trimToCapacity(this.soundLog, this.MAX_SOUND_EVENTS);
    },

    record: function(entry) {
        // Stamp every recorded event with the current automatic-tick count (see recordTick) --
        // the delta between two consecutive events' `tick` values is exactly how many automatic
        // advances (GravityMode/SnakeMode's setInterval-driven tick()) fired in between. This is
        // what makes replay deterministic: instead of inferring "how many ticks happened during
        // this gap" from wall-clock deltas (fragile -- a real ~13-minute session with genuine
        // multi-second thinking-pauses turned out to be exquisitely sensitive to sub-percent
        // timing differences during replay, changing the eventual outcome completely), a replay
        // tool can just call tick() this many times directly, with no timing involved at all.
        entry.tick = this.tickSeq;
        this.log.push(entry);
        this.trimToCapacity(this.log, this.MAX_EVENTS);
    },

    // Called as the first line of any mode's automatic tick() (GravityMode, SnakeMode) --
    // increments a single counter shared across whichever mode is currently active, since only
    // one mode's timer ever runs at a time. Deliberately NOT its own log entry: at a 100ms drop
    // interval (Gravity's fastest, after enough line clears) a long session could produce far
    // more ticks than player inputs, which would evict real early-session events out of the
    // MAX_EVENTS ring buffer. Stamping the running count onto the events already being recorded
    // costs one integer each instead.
    recordTick: function() {
        this.tickSeq++;
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

    // Raw input events alone leave a replay tool with nothing to check its own reconstruction
    // against except the very final state -- if it drifts from reality anywhere along the way,
    // there's no way to tell where. But every mode's every meaningful action already plays a
    // specific, exact set of Tonnetz notes (INV-4, docs/invariants.md) -- a placement's chord, a
    // move's single note, a cleared line's chord of every note it contained. Recording that
    // sequence turns it into a compact, structured checkpoint: a replay tool's own reconstruction
    // (which runs the real app, so it plays its OWN sounds through this same recording) can be
    // diffed note-by-note against the original recording to find the exact tick two runs first
    // disagree, rather than only ever comparing the end.
    //
    // Wraps Synth.playNote specifically (not playChord) since playChord's own implementation
    // calls playNote once per note internally -- wrapping both would double-record every chord.
    // playNote's own recursive bass-boost call for low notes (isHarmonic=true) is skipped: it's
    // an audio-engineering detail, not a distinct game event, and would otherwise add a
    // near-duplicate entry for every low note played.
    wrapSynth: function() {
        if (typeof Synth === 'undefined' || typeof Synth.playNote !== 'function') return;
        const originalPlayNote = Synth.playNote.bind(Synth);
        Synth.playNote = (midi, t0, dur, peak, isHarmonic) => {
            if (!isHarmonic) {
                this.recordSound(midi);
            }
            return originalPlayNote(midi, t0, dur, peak, isHarmonic);
        };
    },

    init: function() {
        this.seedRandom();
        this.recordMeta();
        this.recordViewport();
        this.wrapSynth();

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
     * console entirely: the full log (seed, meta, and every recorded event) is either downloaded
     * as a file or copied to the clipboard -- see reportBug -- and the GitHub issue that opens
     * carries nothing but instructions to the reporter, no title, no mode/seed/version/events
     * baked into the URL. All of that lives in the downloaded/copied payload already; repeating
     * it in the URL was just redundant, and kept the URL long for no reason (a real ~2.5 hour
     * session's full log blows well past what a URL, let alone GitHub's 65536-character body
     * limit, can carry).
     */
    buildIssueUrl: function() {
        const body = [
            '1. Debugging data has been downloaded or copied to your clipboard. Please save that to a .txt or .json file and attach it here.',
            '2. What happened?',
        ].join('\n');

        const params = new URLSearchParams({ body });
        return `https://github.com/gregory-marton/Tonncade/issues/new?${params.toString()}`;
    },

    // No server involved -- a Blob + object URL + synthetic click, all client-side.
    downloadFullLog: function() {
        const fullLogJson = JSON.stringify({ seed: this.seed, meta: this.meta, events: this.log, sounds: this.soundLog });
        const blob = new Blob([fullLogJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tonncade-replay-${this.seed}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // Falls back to a hidden-textarea copy for browsers/contexts where navigator.clipboard is
    // unavailable (e.g. insecure file:// origins).
    copyFullLogToClipboard: function() {
        const fullLogJson = JSON.stringify({ seed: this.seed, meta: this.meta, events: this.log, sounds: this.soundLog });
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(fullLogJson).catch(() => this.legacyCopy(fullLogJson));
        }
        return Promise.resolve(this.legacyCopy(fullLogJson));
    },

    legacyCopy: function(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
    },

    // Downloading a file to someone's device without asking is intrusive -- confirm first.
    // Declining (or a browser that blocks confirm/popups) falls back to the clipboard instead.
    reportBug: async function(e) {
        if (e) e.preventDefault();
        if (confirm('Save your debugging data as a file on this device to attach to the report? Choose Cancel to copy it to your clipboard instead.')) {
            this.downloadFullLog();
        } else {
            await this.copyFullLogToClipboard();
        }
        window.open(this.buildIssueUrl(), '_blank');
    }
};

// { seed, meta, events } together are enough to fully recreate a session: the seed reproduces
// the exact random piece sequence, meta carries the session-level browser facts that affect how
// input dispatches and how the game behaves, and events carries every keystroke/tap plus the
// viewport size at each point in time. `sounds` isn't needed for reconstruction itself -- it's a
// separate verification trace (see Replay.wrapSynth) a replay tool can diff its own
// reconstruction's sounds against to find exactly where the two first disagree.
window.replay = function() {
    return JSON.stringify({ seed: Replay.seed, meta: Replay.meta, events: Replay.log, sounds: Replay.soundLog });
};

if (typeof module !== 'undefined') {
    module.exports = Replay;
}
