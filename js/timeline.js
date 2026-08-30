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
 * timeline.js - The Timeline: what Melody and Compose have in common -- a grand staff, an
 * aligned pitch row beneath it, and two draggable boundary markers (start, end). One shared
 * implementation (docs/invariants.md INV-55), following this project's established factory
 * convention for one shared implementation, several independent instances (js/board.js's
 * createBoard(shape), js/file-folder.js's FileFolder.create(config),
 * js/difficulty-barbell.js's DifficultyBarbell.create(config)).
 *
 * What a mode DOES with the two markers is entirely its own choice, via onStartCommit/
 * onEndCommit: Melody's practice strip (the Timeline plus its own past/current/upcoming color
 * hints and Tonnetz glow-linkage -- see js/melody.js) wires them to seekTo/its own auto-
 * advancing endIndex; Compose wires both straight to selectTimeRange, since the two markers ARE
 * its selection mechanism (replacing the old click-drag-across-tokens gesture).
 */
const Timeline = {
    // config: { staffContainerId, labelsContainerId, scrollContainerId, onStartCommit, onEndCommit }
    create: function(config) {
        return Object.assign(Object.create(Timeline._proto), {
            staffContainerId: config.staffContainerId,
            labelsContainerId: config.labelsContainerId,
            scrollContainerId: config.scrollContainerId,
            onStartCommit: config.onStartCommit || function() {},
            onEndCommit: config.onEndCommit || function() {},
            _lastRender: null,
            _dragIndex: null,
        });
    },

    _proto: {
        // notes: {midi, time, duration}[], each optionally carrying its own `id` (an opaque
        // caller-assigned handle -- e.g. Compose's own state.notes index) -- defaults to array
        // index when omitted, so a caller with no separate concept of note identity (Melody,
        // whose `melody` array index already IS the identity) doesn't need to think about it.
        // opts: {bpm, keySignature, beatsPerMeasure, startIndex, endIndex, decorate,
        // showBarlines} -- decorate is an optional (entry) => {className, style} hook
        // Notation.renderLabels applies per pitch-row label (Melody's practice-strip color
        // hints; Compose omits it). showBarlines defaults to true; Melody's Random mode passes
        // false -- a generated Simon prefix is not authored measure-by-measure notation, even
        // though the complete prefix remains on this ordinary scrollable Timeline.
        refresh: function(notes, opts) {
            opts = opts || {};
            const notesWithId = (notes || []).map((n, i) => Object.assign({}, n, { id: n.id != null ? n.id : i }));
            // The scroll container's OWN current width -- not the staff container's, which is
            // exactly as wide as whatever VexFlow drew last time and would otherwise never grow
            // (see Notation.render's opts.targetWidth) -- lets the staff fill however much room
            // it's actually been given (e.g. #notation-bar's Timeline half) instead of always
            // rendering at a fixed content-driven size regardless of available space.
            const scrollEl = document.getElementById(this.scrollContainerId);
            const renderOpts = Object.assign({}, opts, { targetWidth: scrollEl ? scrollEl.clientWidth : undefined });
            this._lastRender = Notation.render(this.staffContainerId, notesWithId, renderOpts);
            const noteXPositions = this._lastRender ? this._lastRender.noteXPositions : [];
            const barlineXPositions = this._lastRender ? this._lastRender.barlineXPositions : [];
            Notation.renderLabels(this.labelsContainerId, noteXPositions, opts.keySignature, opts.decorate);
            Notation.renderBarlineOverlay(this.scrollContainerId, opts.showBarlines === false ? [] : barlineXPositions);
            this._positionMarker('start', opts.startIndex);
            this._positionMarker('end', opts.endIndex);
        },

        // Reuses the SAME marker DOM node across calls (created once via appendChild, only ever
        // repositioned via style.left afterward -- never recreated) for the same reason Melody's
        // original scrub marker did (INV-55): a full re-render mid-drag would detach whatever a
        // real touchstart captured as its event target, silently breaking the rest of the
        // gesture on a real device.
        _positionMarker: function(which, idx) {
            const scrollEl = document.getElementById(this.scrollContainerId);
            if (!scrollEl || !this._lastRender) return;
            // Every marker renders as a caret BEFORE its own note's x (see below) -- correct for
            // 'start' (an inclusive start sits right before the first included note), but that
            // would read as EXCLUDING its own note for 'end' (an inclusive end). Looking up id+1
            // instead places the end marker in the gap AFTER its note -- the next real note if
            // there is one, or Notation.render's own trailing padding-rest entry (endPadding) if
            // idx is the very last real note (reported live: the end marker visually excluded its
            // own last note).
            // idx != null, not just `which === 'end'` -- JS coerces `null + 1` to `1`, so an
            // An absent endIndex must not be coerced into an id lookup (for example, null + 1).
            const lookupId = (which === 'end' && idx != null) ? idx + 1 : idx;
            // A sparse rendered range may lack a real id+1 note or endPadding. Falling back to
            // idx itself (same spot the start marker would use) keeps the marker usable.
            const entry = this._lastRender.noteXPositions.find((n) => n.id === lookupId) ||
                (which === 'end' && this._lastRender.endPadding && this._lastRender.endPadding.id === lookupId
                    ? this._lastRender.endPadding : null) ||
                (which === 'end' && idx != null ? this._lastRender.noteXPositions.find((n) => n.id === idx) : null);
            let marker = scrollEl.querySelector('.timeline-marker-' + which);
            if (!entry) {
                if (marker) marker.remove();
                return;
            }
            if (!marker) {
                marker = document.createElement('span');
                marker.className = 'timeline-marker timeline-marker-' + which;
                marker.title = which === 'start' ? 'Drag to move the start' : 'Drag to move the end';
                // The line/box are pointer-events:none (css/style.css) -- only these two handles
                // actually receive pointer events, so a drag always starts from grabbing one of
                // them, never the line passing over the staff.
                const handleTop = document.createElement('span');
                handleTop.className = 'timeline-marker-handle timeline-marker-handle-top';
                const handleBottom = document.createElement('span');
                handleBottom.className = 'timeline-marker-handle timeline-marker-handle-bottom';
                marker.appendChild(handleTop);
                marker.appendChild(handleBottom);
                scrollEl.appendChild(marker);
            }
            // -10, not -3: half of .timeline-marker's own 20px width (css/style.css) --
            // deliberately wider than its 2px visible stem, so the marker's own visible line
            // still lands exactly on entry.x even though the (invisible, easier-to-grab) hit box
            // around it is much wider.
            marker.style.left = Math.max(0, entry.x - 10) + 'px';
        },

        // Keeps the currently-played note centered in the scroll container as playback advances
        // past whatever's already visible -- without this, a real song (rendered in full up
        // front, per updateDifficultyUI's own comment) just sits there once play scrolls past the
        // initially-visible notes, even though the note-role/glow decoration is still updating
        // correctly underneath. Skipped entirely mid-drag (see setupDrag's this._dragging) so it
        // never fights a live gesture's own scroll position.
        scrollToCurrent: function(idx) {
            if (this._dragging || idx == null) return;
            const scrollEl = document.getElementById(this.scrollContainerId);
            if (!scrollEl || !this._lastRender) return;
            const entry = this._lastRender.noteXPositions.find((n) => n.id === idx);
            if (!entry) return;
            const target = entry.x - scrollEl.clientWidth / 2;
            scrollEl.scrollLeft = Math.max(0, target);
        },

        // Nearest rendered note (by x, in the scroll container's own coordinate space) to a
        // given screen clientX -- the same closest-token approach Melody's original
        // updateScrubDragTarget used, generalized to work off Notation.render's own
        // noteXPositions instead of live DOM element positions.
        _nearestIndex: function(clientX) {
            if (!this._lastRender || !this._lastRender.noteXPositions.length) return null;
            const scrollEl = document.getElementById(this.scrollContainerId);
            if (!scrollEl) return null;
            const rect = scrollEl.getBoundingClientRect();
            const x = clientX - rect.left + scrollEl.scrollLeft;
            let closest = this._lastRender.noteXPositions[0];
            let closestDist = Infinity;
            this._lastRender.noteXPositions.forEach((entry) => {
                const dist = Math.abs(x - entry.x);
                if (dist < closestDist) { closestDist = dist; closest = entry; }
            });
            return closest.id;
        },

        // One-time listener setup -- call once (e.g. from the mode's own init()), not per
        // refresh(). Mirrors Melody's original setupScrubMarker/updateScrubDragTarget, doubled
        // for two markers: mousedown/touchstart on either marker begins a drag; move repositions
        // that marker live (cheap -- no full refresh() per tick) and edge-scrolls the container;
        // release commits via onStartCommit/onEndCommit, exactly once.
        setupDrag: function() {
            const scrollEl = document.getElementById(this.scrollContainerId);
            if (!scrollEl) return;
            this._dragging = null; // 'start' | 'end' | null -- exposed on `this` so scrollToCurrent
                                    // can tell a live drag apart from ordinary playback and not
                                    // fight the user's own scroll position mid-gesture
            const EDGE = 40; // px from either edge that triggers auto-scroll
            const MAX_SPEED = 12; // px per tick

            const edgeScroll = (clientX) => {
                const rect = scrollEl.getBoundingClientRect();
                if (clientX < rect.left + EDGE) {
                    scrollEl.scrollLeft -= MAX_SPEED * (1 - Math.max(0, clientX - rect.left) / EDGE);
                } else if (clientX > rect.right - EDGE) {
                    scrollEl.scrollLeft += MAX_SPEED * (1 - Math.max(0, rect.right - clientX) / EDGE);
                }
            };
            const startDrag = (which, clientX) => {
                this._dragging = which;
                this._dragIndex = this._nearestIndex(clientX);
                if (this._dragIndex != null) this._positionMarker(which, this._dragIndex);
            };
            const moveDrag = (clientX) => {
                if (!this._dragging) return;
                edgeScroll(clientX);
                const idx = this._nearestIndex(clientX);
                if (idx != null) {
                    this._dragIndex = idx;
                    this._positionMarker(this._dragging, idx);
                }
            };
            const endDrag = () => {
                if (!this._dragging) return;
                const which = this._dragging;
                const idx = this._dragIndex;
                this._dragging = null;
                if (idx == null) return;
                if (which === 'start') this.onStartCommit(idx);
                else this.onEndCommit(idx);
            };

            // .closest(), not a direct classList check -- e.target is now one of the two handle
            // children (css/style.css: the marker's own box/line are pointer-events:none), so the
            // marker itself has to be found by walking up from whichever handle was actually hit.
            scrollEl.addEventListener('mousedown', (e) => {
                // Render.wasRecentlyTouched(), not a device-capability sniff (see its own
                // comment) -- a static check here disabled mouse dragging entirely on any
                // touch-CAPABLE device (e.g. a touchscreen laptop driven by a real mouse), which
                // is exactly the bug reported live as "having trouble dragging the start marker."
                if (Render.wasRecentlyTouched()) return;
                if (e.target.closest('.timeline-marker-start')) { e.preventDefault(); startDrag('start', e.clientX); }
                else if (e.target.closest('.timeline-marker-end')) { e.preventDefault(); startDrag('end', e.clientX); }
            });
            window.addEventListener('mousemove', (e) => moveDrag(e.clientX));
            window.addEventListener('mouseup', endDrag);

            scrollEl.addEventListener('touchstart', (e) => {
                if (e.target.closest('.timeline-marker-start')) { e.preventDefault(); startDrag('start', e.touches[0].clientX); }
                else if (e.target.closest('.timeline-marker-end')) { e.preventDefault(); startDrag('end', e.touches[0].clientX); }
            }, { passive: false });
            scrollEl.addEventListener('touchmove', (e) => {
                // Was `if (!dragging) return;` -- `dragging` was never declared anywhere in this
                // file, so this threw a ReferenceError the first time a real touchmove fired
                // during a drag, silently aborting it after the initial touchstart placement.
                if (!this._dragging) return;
                e.preventDefault();
                moveDrag(e.touches[0].clientX);
            }, { passive: false });
            scrollEl.addEventListener('touchend', endDrag);
        },
    },
};

if (typeof module !== 'undefined') {
    module.exports = Timeline;
}
