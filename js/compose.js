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
 * compose.js - Compose Mode: record a melody by tapping cells in real time, play it back, and
 * save it as a Standard MIDI File -- or load an existing one to keep working on.
 *
 * Undo (js/undo-stack.js, #17) reverses record/delete/insert/translate/rotate/paste-group/Clear,
 * each via its own inversion closure -- see docs/invariants.md's INV-54. A full timeline/
 * piano-roll view and true per-note drag gestures (as opposed to the discrete translate/rotate
 * controls that already exist) remain real interaction-design work saved for later.
 */

const ComposeMode = {
    state: {
        notes: [],              // { midi, p, q, time, duration }
        selectedIndices: [],    // indices into notes currently selected for editing
        groupClipboard: [],     // {midi, p, q, relTime, duration} for the last COPIED selection --
                                 // an in-Compose duplicate-a-phrase buffer, distinct from the
                                 // header's cross-mode App.clipboard (which transfers the WHOLE
                                 // piece's cell footprint to another mode; this duplicates just the
                                 // current selection, in-place, as a new group -- see #82).
        isRecording: false,
        recordStartTime: 0,
        isPlaying: false,
        playbackTimeoutIds: [],
        // null until the first draw: viewX/viewY center for the current aspect-matched ref box
        // (see Render.panView / INV-44), zoom picks the responsive default. All three then persist
        // across redraws (panning, or wheel/pinch zoom -- see main.js's applyZoomDelta).
        viewX: null,
        viewY: null,
        zoom: null,
        isPanning: false,
        lastMouse: { x: 0, y: 0 },
        dragCandidate: null,    // { startClientX, startClientY, startP, startQ, moved } -- see setupEvents
        tempoBPM: 120,
        subdivision: '1/16',
        quantizeEnabled: false, // opt-in (task #52) -- a rough free-tapped recording stays as-is unless asked
        metronomeEnabled: false,
        metronomeTimer: null,
        chordBuffer: [],       // touches pending a shared time value -- see recordTouch
        chordBufferTime: 0,
        chordBufferTimer: null,
        keySignature: null,    // fifths (-7..7), set by loadMelodyFromMusicXML's authored key or
                                // detected from notes on load; null (sharps-only spelling) for a
                                // piece composed from scratch with no load.
        undoStack: UndoStack.create(), // #17: reverses the last edit -- see undo(). Cleared on
                                        // Clear/loading a file, since undoing past that boundary
                                        // into whatever existed before doesn't mean anything.
    },

    DEFAULT_DURATION: 0.4,

    // How long to wait for more fingers to land before committing a touch (or group of touches)
    // to state.notes. Mirrors Blast's own near-simultaneous-note-on buffering window (issue #11):
    // real fingers rarely land in the exact same event, so a short grace window is what turns
    // "3 taps 10ms apart" into one recorded chord instead of a fast arpeggio.
    CHORD_WINDOW_MS: 50,

    // Every grid unit quantizeNotes supports, as a fraction of one beat (quarter note) --
    // straight subdivisions down to 1/32, triplet subdivisions down to 1/6. WRITE_TICKS_PER_BEAT
    // (480, js/midi.js) is divisible by both 32 and 3, so every one of these lands on an exact
    // integer tick count once written -- no rounding drift from the grid choice itself.
    QUANTIZE_GRID: {
        '1/8': 0.5,
        '1/16': 0.25,
        '1/32': 0.125,
        'triplet-1/8': 1 / 3,
        'triplet-1/16': 1 / 6,
    },

    init: function() {
        Render.init('tonnetz-svg');
        this.refreshBoard();
        this.setupEvents();
        this.setupDOMEvents();
        this.setupStaffDOMEvents();
        this.updateStats();
    },

    setupDOMEvents: function() {
        const recordBtn = document.getElementById('compose-record');
        const playBtn = document.getElementById('compose-play');
        const clearBtn = document.getElementById('compose-clear');
        const saveBtn = document.getElementById('compose-save');
        const fileInput = document.getElementById('compose-file-input');

        if (recordBtn) {
            recordBtn.onclick = () => {
                if (this.state.isRecording) this.stopRecording();
                else this.startRecording();
            };
        }
        if (playBtn) {
            playBtn.onclick = () => {
                if (this.state.isPlaying) this.stopPlayback();
                else this.play();
            };
        }
        if (clearBtn) clearBtn.onclick = () => this.clear();
        if (saveBtn) saveBtn.onclick = () => this.save();

        const tempoInput = document.getElementById('compose-tempo');
        const subdivisionSelect = document.getElementById('compose-subdivision');
        const quantizeCheckbox = document.getElementById('compose-quantize');
        const metronomeCheckbox = document.getElementById('compose-metronome');

        if (tempoInput) {
            tempoInput.value = this.state.tempoBPM;
            tempoInput.onchange = () => {
                const bpm = parseInt(tempoInput.value, 10);
                if (bpm > 0) this.state.tempoBPM = bpm;
            };
        }
        if (subdivisionSelect) {
            subdivisionSelect.value = this.state.subdivision;
            subdivisionSelect.onchange = () => { this.state.subdivision = subdivisionSelect.value; };
        }
        if (quantizeCheckbox) {
            quantizeCheckbox.checked = this.state.quantizeEnabled;
            quantizeCheckbox.onchange = () => { this.state.quantizeEnabled = quantizeCheckbox.checked; };
        }
        if (metronomeCheckbox) {
            metronomeCheckbox.checked = this.state.metronomeEnabled;
            metronomeCheckbox.onchange = () => { this.state.metronomeEnabled = metronomeCheckbox.checked; };
        }

        const deleteBtn = document.getElementById('compose-delete');
        const rotateCWBtn = document.getElementById('compose-rotate-cw');
        const rotateCCWBtn = document.getElementById('compose-rotate-ccw');

        if (deleteBtn) deleteBtn.onclick = () => this.deleteSelected();
        if (rotateCWBtn) rotateCWBtn.onclick = () => this.rotateSelection(1);
        if (rotateCCWBtn) rotateCCWBtn.onclick = () => this.rotateSelection(-1);

        const copySelectedBtn = document.getElementById('compose-copy-selected');
        const pasteSelectedBtn = document.getElementById('compose-paste-selected');
        if (copySelectedBtn) copySelectedBtn.onclick = () => this.copySelected();
        if (pasteSelectedBtn) pasteSelectedBtn.onclick = () => this.pasteGroup();

        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                // See js/melody.js's identical fix for why this can't just hard-code
                // loadMelodyFromArrayBuffer -- reuses MidiFolder's own fileTypes dispatch.
                const { readAs, loadMethod } = MidiFolder.resolveFileType(file.name);
                const reader = new FileReader();
                reader.onload = (event) => this[loadMethod](event.target.result, file.name);
                if (readAs === 'text') reader.readAsText(file);
                else reader.readAsArrayBuffer(file);
            };
        }

        // Time-range selection (docs/melody-notation-design.md's central workflow): mousedown on a
        // token remembers its ORIGINAL note index; mouseup on a (possibly different) token selects
        // every note between the two in TIME, regardless of pitch. A plain click (down and up on
        // the same token) is just the idxA===idxB case of the same call.
        const timelineEl = document.getElementById('compose-timeline');
        if (timelineEl) {
            let dragStartIdx = null;
            timelineEl.addEventListener('mousedown', (e) => {
                const token = e.target.closest('.note-token');
                if (!token) return;
                dragStartIdx = parseInt(token.getAttribute('data-note-idx'), 10);
            });
            timelineEl.addEventListener('mouseup', (e) => {
                if (dragStartIdx === null) return;
                const token = e.target.closest('.note-token');
                const endIdx = token ? parseInt(token.getAttribute('data-note-idx'), 10) : dragStartIdx;
                this.selectTimeRange(dragStartIdx, endIdx);
                dragStartIdx = null;
            });
        }

        // Shares Melody's exact remembered folder (both work with .mid files) -- see
        // js/file-folder.js's `ids` parameter, which is what lets the same MidiFolder instance
        // serve two different modes' own DOM elements. No `hasRandom`: Compose has no starting-
        // content concept the way Melody's offline-degrade does.
        if (typeof MidiFolder !== 'undefined') {
            MidiFolder.setup(this, {
                sourceSelect: 'compose-source',
                sourceStatus: 'compose-source-status',
                uploadGroup: 'compose-upload-group',
            });
        }
    },

    setupEvents: function() {
        const svg = Render.svg;
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const DRAG_THRESHOLD_PX = 6;

        window.onmousemove = (e) => {
            if (!isTouch && this.state.dragCandidate) {
                const dc = this.state.dragCandidate;
                const dx = e.clientX - dc.startClientX;
                const dy = e.clientY - dc.startClientY;
                if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) dc.moved = true;
                return; // suppress panning while a note-drag is in progress
            }
            if (!isTouch && this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                // panView keeps the aspect-matched viewBox the draw used (a bare updateView would
                // reset it to the fixed 4:3 box and re-letterbox mid-drag).
                const v = Render.panView(this.state.viewX, this.state.viewY, Render.zoom);
                this.state.viewX = v.viewX;
                this.state.viewY = v.viewY;
            }
        };

        window.onmouseup = (e) => {
            if (!isTouch && this.state.dragCandidate) {
                const dc = this.state.dragCandidate;
                this.state.dragCandidate = null;
                this.state.isPanning = false;
                if (dc.moved) {
                    const target = document.elementFromPoint(e.clientX, e.clientY);
                    if (target && target.tagName.toLowerCase() === 'polygon' && target.hasAttribute('data-p')) {
                        const p = parseInt(target.getAttribute('data-p'));
                        const q = parseInt(target.getAttribute('data-q'));
                        this.translateSelection(p - dc.startP, q - dc.startQ);
                    }
                } else {
                    this.tapCell(dc.startP, dc.startQ, { shiftKey: e.shiftKey });
                }
                return;
            }
            this.state.isPanning = false;
        };

        svg.onmousedown = (e) => {
            const isHex = e.target.tagName.toLowerCase() === 'polygon';
            if (isHex) {
                const p = parseInt(e.target.getAttribute('data-p'));
                const q = parseInt(e.target.getAttribute('data-q'));
                const matches = this.notesAt(p, q);
                const isDraggable = !isTouch && !this.state.isRecording &&
                    matches.some(i => this.state.selectedIndices.includes(i));
                if (isDraggable) {
                    this.state.dragCandidate = { startClientX: e.clientX, startClientY: e.clientY, startP: p, startQ: q, moved: false };
                } else {
                    this.tapCell(p, q, { shiftKey: e.shiftKey });
                }
            }
            if (!isTouch) {
                this.state.isPanning = true;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
            }
        };
    },

    // Every index into state.notes whose lattice cell matches (p, q) -- a melody can revisit the
    // same cell (a repeated pitch), so this is a list, not a single note.
    notesAt: function(p, q) {
        const indices = [];
        this.state.notes.forEach((n, i) => { if (n.p === p && n.q === q) indices.push(i); });
        return indices;
    },

    // A tap always plays the cell's note (like Sandbox's note-play tool); while recording, it
    // ALSO appends the note to state.notes with its elapsed-time timestamp. (p,q) is exactly
    // whatever cell was clicked -- no reverse-mapping ambiguity, unlike loading a file below,
    // since the player is choosing the cell directly at note-creation time.
    //
    // When not recording, a tap instead drives selection/insertion for editing: tapping a cell
    // that already hosts note(s) selects (or, with shift, toggles) one of them -- repeated taps
    // step through duplicates sharing a cell; tapping an empty cell while exactly one note is
    // selected inserts a new note right after it; tapping an empty cell otherwise just clears
    // the selection (if any) and plays the note.
    tapCell: function(p, q, opts) {
        const shiftKey = !!(opts && opts.shiftKey);
        const midi = Tonnetz.getMidi(p, q);

        if (this.state.isRecording) {
            Render.highlightByMidi(midi, 250);
            Synth.playNote(midi);
            const time = (performance.now() - this.state.recordStartTime) / 1000;
            const note = { midi, p, q, time, duration: this.DEFAULT_DURATION };
            this.state.notes.push(note);
            this.state.undoStack.push(() => { // #17
                const idx = this.state.notes.indexOf(note);
                if (idx >= 0) this.state.notes.splice(idx, 1);
            });
            this.updateStats();
            // The staff/timeline (Task #9) need refreshBoard() to show anything new -- unlike the
            // Tonnetz's own momentary highlight flash above, they don't update themselves. Recording
            // previously left both stale until some UNRELATED later action (selecting a note,
            // stopping playback, etc.) happened to trigger a redraw -- reported live as "no chance
            // to see staffs" once the staff existed to actually notice this on.
            this.refreshBoard();
            return;
        }

        const matches = this.notesAt(p, q);
        if (matches.length > 0) {
            this.selectAtCell(matches, shiftKey);
            Render.highlightByMidi(midi, 250);
            Synth.playNote(midi);
            return;
        }

        if (this.state.selectedIndices.length === 1 && !shiftKey) {
            this.insertAfterSelected(p, q);
            return;
        }

        if (!shiftKey && this.state.selectedIndices.length > 0) {
            this.state.selectedIndices = [];
            this.updateEditControls();
            this.refreshBoard();
        }
        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);
    },

    // Touch equivalent of tapCell's recording branch, but built for real multitouch: mouse can
    // only ever tap one cell at a time (no simultaneous input to buffer), so tapCell stays as-is
    // for it. A touch always plays instantly (no perceptible audio latency), but its entry into
    // state.notes is held for CHORD_WINDOW_MS so other fingers landing moments later share the
    // same time value -- that shared time is what makes several cells one chord rather than a
    // fast arpeggio of separately-timed notes.
    //
    // explicitTime, when given, is the moment this finger actually touched down (captured by the
    // caller back when a multi-finger candidate group was first created) rather than whenever the
    // touch/drag disambiguation happened to finish resolving it -- a chord's timestamp should be
    // when it was pressed, not whenever main.js finished confirming it wasn't a pan gesture.
    recordTouch: function(p, q, explicitTime) {
        const midi = Tonnetz.getMidi(p, q);
        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);
        const time = explicitTime !== undefined ? explicitTime : (performance.now() - this.state.recordStartTime) / 1000;

        if (this.state.chordBuffer.length === 0) {
            this.state.chordBufferTime = time;
            clearTimeout(this.state.chordBufferTimer);
            this.state.chordBufferTimer = setTimeout(() => this.flushChordBuffer(), this.CHORD_WINDOW_MS);
        } else {
            this.state.chordBufferTime = Math.min(this.state.chordBufferTime, time);
        }
        this.state.chordBuffer.push({ midi, p, q });
    },

    flushChordBuffer: function() {
        const buffer = this.state.chordBuffer;
        const time = this.state.chordBufferTime;
        this.state.chordBuffer = [];
        this.state.chordBufferTimer = null;
        const added = buffer.map(({ midi, p, q }) => {
            const note = { midi, p, q, time, duration: this.DEFAULT_DURATION };
            this.state.notes.push(note);
            return note;
        });
        // #17: the whole chord is ONE undo action (all fingers landed together), not one per note.
        if (added.length) {
            this.state.undoStack.push(() => {
                this.state.notes = this.state.notes.filter((n) => !added.includes(n));
            });
        }
        this.updateStats();
        if (added.length) this.refreshBoard(); // see tapCell's identical comment on why this is needed
    },

    // Resolves which specific note a tap on a (possibly duplicate-pitch) cell targets: the first
    // match not currently selected, cycling back to the first match once they're all selected --
    // so repeated taps step through notes that share a cell instead of getting stuck on one.
    selectAtCell: function(matches, shiftKey) {
        const sel = this.state.selectedIndices;
        let target = matches.find(i => !sel.includes(i));
        if (target === undefined) target = matches[0];

        if (shiftKey) {
            const pos = sel.indexOf(target);
            if (pos >= 0) sel.splice(pos, 1);
            else sel.push(target);
        } else {
            this.state.selectedIndices = [target];
        }
        this.updateEditControls();
        this.refreshBoard();
    },

    // Removes every selected note and closes exactly the time each one occupied -- every later
    // note shifts earlier by the deleted note's own duration, not by the full gap to whatever
    // comes next, so any other intentional rests between notes are left alone.
    deleteSelected: function() {
        if (this.state.selectedIndices.length === 0) return;
        const toDelete = new Set(this.state.selectedIndices);
        const ordered = this.state.notes.map((n, i) => ({ n, i })).sort((a, b) => a.n.time - b.n.time);

        let shift = 0;
        const kept = [];
        ordered.forEach(({ n, i }) => {
            if (toDelete.has(i)) {
                shift += n.duration;
            } else {
                kept.push({ midi: n.midi, p: n.p, q: n.q, time: n.time - shift, duration: n.duration });
            }
        });

        const prevNotes = this.state.notes; // #17: notes is REPLACED below, never mutated in
        const prevSelected = this.state.selectedIndices; // place, so the old array/reference is
        this.state.notes = kept;             // safe to snapshot and restore wholesale.
        this.state.selectedIndices = [];
        this.state.undoStack.push(() => {
            this.state.notes = prevNotes;
            this.state.selectedIndices = prevSelected;
        });
        this.updateStats();
        this.updateEditControls();
        this.refreshBoard();
    },

    // Inserts a new note at (p, q) right after the sole selected note, taking its duration as a
    // default, and pushes every note at or after the insertion point later by that same duration
    // -- the mirror of deleteSelected's gap-closing.
    insertAfterSelected: function(p, q) {
        const idx = this.state.selectedIndices[0];
        const anchor = this.state.notes[idx];
        const midi = Tonnetz.getMidi(p, q);
        const insertTime = anchor.time + anchor.duration;
        const newNote = { midi, p, q, time: insertTime, duration: anchor.duration };

        // #17: every later note shifts in place (mutated, not replaced) -- snapshot exactly which
        // ones and their prior .time BEFORE shifting, so undo can put each back precisely.
        const shifted = this.state.notes.filter(n => n.time >= insertTime).map(n => ({ note: n, prevTime: n.time }));
        const prevSelected = this.state.selectedIndices;

        this.state.notes.forEach(n => { if (n.time >= insertTime) n.time += newNote.duration; });
        this.state.notes.splice(idx + 1, 0, newNote);
        this.state.selectedIndices = [idx + 1];
        this.state.undoStack.push(() => {
            const i = this.state.notes.indexOf(newNote);
            if (i >= 0) this.state.notes.splice(i, 1);
            shifted.forEach(({ note, prevTime }) => { note.time = prevTime; });
            this.state.selectedIndices = prevSelected;
        });

        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);
        this.updateStats();
        this.updateEditControls();
        this.refreshBoard();
    },

    // Translates every selected note by the same (dp, dq) -- since Tonnetz.getMidi is linear,
    // this shifts every selected note's pitch by the exact same number of semitones, i.e. a
    // clean transposition, not a per-note special case.
    translateSelection: function(dp, dq) {
        if (dp === 0 && dq === 0) return;
        // #17: mutates existing note objects in place -- snapshot each one's prior p/q/midi first.
        const prior = this.state.selectedIndices.map(i => {
            const n = this.state.notes[i];
            return { note: n, p: n.p, q: n.q, midi: n.midi };
        });
        this.state.selectedIndices.forEach(i => {
            const n = this.state.notes[i];
            n.p += dp;
            n.q += dq;
            n.midi = Tonnetz.getMidi(n.p, n.q);
        });
        this.state.undoStack.push(() => {
            prior.forEach(({ note, p, q, midi }) => { note.p = p; note.q = q; note.midi = midi; });
        });
        this.updateStats();
        this.refreshBoard();
    },

    // Rotates every selected note around the first-selected note (the anchor) by one 60-degree
    // hex step, reusing the exact same rigid-rotation math Pieces.js already uses for rotating a
    // piece shape -- rotating a set of lattice offsets around a pivot, not a new transform.
    rotateSelection: function(direction) {
        if (this.state.selectedIndices.length === 0) return;
        const pivotIdx = this.state.selectedIndices[0];
        const pivot = this.state.notes[pivotIdx];
        // #17: mutates existing note objects in place -- snapshot each one's prior p/q/midi first.
        const prior = this.state.selectedIndices
            .filter(i => i !== pivotIdx)
            .map(i => { const n = this.state.notes[i]; return { note: n, p: n.p, q: n.q, midi: n.midi }; });
        this.state.selectedIndices.forEach(i => {
            if (i === pivotIdx) return;
            const n = this.state.notes[i];
            const rel = { p: n.p - pivot.p, q: n.q - pivot.q };
            const rotated = (direction > 0 ? Pieces.rotate([rel]) : Pieces.rotateCCW([rel]))[0];
            n.p = pivot.p + rotated.p;
            n.q = pivot.q + rotated.q;
            n.midi = Tonnetz.getMidi(n.p, n.q);
        });
        if (prior.length) {
            this.state.undoStack.push(() => {
                prior.forEach(({ note, p, q, midi }) => { note.p = p; note.q = q; note.midi = midi; });
            });
        }
        this.updateStats();
        this.refreshBoard();
    },

    // Timing edits (retiming a note, expressing triplets/32nd-notes/chords precisely) are
    // deliberately out of scope here -- see next_steps.md #52. A rough recording is cheap to
    // redo from scratch; anything needing real rhythm precision is better served by re-recording
    // or, past that, a real MIDI editor working on the saved .mid file directly.
    updateEditControls: function() {
        const count = this.state.selectedIndices.length;
        const group = document.getElementById('compose-edit-group');
        if (group) group.style.display = count > 0 ? 'block' : 'none';

        const label = document.getElementById('compose-selection-label');
        if (label) label.textContent = count === 0 ? '' : `Selected: ${count} note${count === 1 ? '' : 's'}`;

        // Paste is available whenever there's something copied, independent of the current
        // selection (you copy a phrase, click elsewhere/deselect, then paste it back in).
        const pasteGroup = document.getElementById('compose-paste-group');
        if (pasteGroup) pasteGroup.style.display = this.state.groupClipboard.length > 0 ? 'flex' : 'none';
    },

    // #82: copy the CURRENTLY SELECTED notes into an in-Compose group-clipboard, preserving their
    // relative timing and (p,q) shape -- an in-place "duplicate this phrase" buffer, distinct from
    // the header's cross-mode App.clipboard (whole-piece transfer to another mode).
    copySelected: function() {
        if (this.state.selectedIndices.length === 0) return;
        const notes = this.state.selectedIndices.map(i => this.state.notes[i]).sort((a, b) => a.time - b.time);
        const t0 = notes[0].time;
        this.state.groupClipboard = notes.map(n => ({ midi: n.midi, p: n.p, q: n.q, relTime: n.time - t0, duration: n.duration }));
        this.updateEditControls();
    },

    // Pastes the group-clipboard as a NEW group of notes, appended at the playhead (the current end
    // of the piece -- same convention as the cross-mode paste, App.paste's Compose target) with
    // their relative timing preserved. The new notes become the selection, so they can be
    // immediately dragged/rotated/nudged into place.
    pasteGroup: function() {
        if (this.state.groupClipboard.length === 0) return;
        const playhead = this.state.notes.reduce((t, n) => Math.max(t, n.time + n.duration), 0);
        const newIndices = [];
        const added = [];
        this.state.groupClipboard.forEach(c => {
            newIndices.push(this.state.notes.length);
            const note = { midi: c.midi, p: c.p, q: c.q, time: playhead + c.relTime, duration: c.duration };
            this.state.notes.push(note);
            added.push(note);
        });
        const prevSelected = this.state.selectedIndices; // #17
        this.state.selectedIndices = newIndices;
        this.state.undoStack.push(() => {
            this.state.notes = this.state.notes.filter((n) => !added.includes(n));
            this.state.selectedIndices = prevSelected;
        });
        this.updateStats();
        this.refreshBoard();
        this.updateEditControls();
        Synth.playChord(this.state.groupClipboard.map(c => c.midi), false, 0.12, 0.9); // soft confirmation
    },

    startRecording: function() {
        this.stopPlayback();
        this.state.isRecording = true;
        this.state.recordStartTime = performance.now();
        const btn = document.getElementById('compose-record');
        if (btn) { btn.textContent = '⏹'; btn.title = 'Stop recording'; btn.setAttribute('aria-label', 'Stop recording'); }
        this.setStatus('Recording... tap cells to add notes.');
        this.startMetronome();
    },

    stopRecording: function() {
        this.state.isRecording = false;
        this.stopMetronome();
        // A chord still waiting out its grace window when Stop is pressed shouldn't be silently
        // dropped -- commit it now instead of leaving the buffer for a timer that may never fire
        // usefully again (isRecording is already false by the time it would).
        if (this.state.chordBufferTimer) {
            clearTimeout(this.state.chordBufferTimer);
            this.flushChordBuffer();
        }
        // Quantizing only changes time/duration, not (p,q) -- nothing about the board's own
        // visual layout needs a redraw from it.
        if (this.state.quantizeEnabled) this.quantizeNotes();
        const btn = document.getElementById('compose-record');
        if (btn) { btn.textContent = '⏺'; btn.title = 'Record'; btn.setAttribute('aria-label', 'Record'); }
        this.setStatus(this.state.notes.length > 0 ? 'Ready to play or save.' : 'Ready to record.');
    },

    // Snaps every note's raw (freely-tapped) time/duration onto the current tempo/subdivision
    // grid -- task #52. Opt-in (state.quantizeEnabled), called automatically when recording
    // stops: a rough recording is cheap to redo, so this only runs when actually asked for,
    // rather than silently mangling every capture.
    quantizeNotes: function() {
        if (this.state.notes.length === 0) return;
        const secondsPerBeat = 60 / this.state.tempoBPM;
        const gridSeconds = this.QUANTIZE_GRID[this.state.subdivision] * secondsPerBeat;

        this.state.notes.forEach(n => {
            n.time = Math.round(n.time / gridSeconds) * gridSeconds;
            n.duration = Math.max(gridSeconds, Math.round(n.duration / gridSeconds) * gridSeconds);
        });
        this.state.notes.sort((a, b) => a.time - b.time);
    },

    // A metronome click at the current tempo, running only while recording -- helps a live
    // tapped performance actually land close to the grid quantizeNotes will snap it to.
    startMetronome: function() {
        if (!this.state.metronomeEnabled) return;
        Synth.playClick();
        this.state.metronomeTimer = setInterval(() => Synth.playClick(), 60000 / this.state.tempoBPM);
    },

    stopMetronome: function() {
        if (this.state.metronomeTimer) {
            clearInterval(this.state.metronomeTimer);
            this.state.metronomeTimer = null;
        }
    },

    play: function() {
        if (this.state.notes.length === 0) return;
        this.stopRecording();
        this.state.isPlaying = true;
        const playBtn = document.getElementById('compose-play');
        if (playBtn) { playBtn.textContent = '⏹'; playBtn.title = 'Stop'; playBtn.setAttribute('aria-label', 'Stop'); }
        this.setStatus('Playing...');

        this.state.notes.forEach(note => {
            const tId = setTimeout(() => {
                Synth.playNote(note.midi);
                Render.highlightByMidi(note.midi, note.duration * 1000);
            }, note.time * 1000);
            this.state.playbackTimeoutIds.push(tId);
        });

        const last = this.state.notes[this.state.notes.length - 1];
        const totalMs = (last.time + last.duration) * 1000 + 100;
        const finishId = setTimeout(() => this.stopPlayback(), totalMs);
        this.state.playbackTimeoutIds.push(finishId);
    },

    stopPlayback: function() {
        this.state.playbackTimeoutIds.forEach(id => clearTimeout(id));
        this.state.playbackTimeoutIds = [];
        this.state.isPlaying = false;
        const playBtn = document.getElementById('compose-play');
        if (playBtn) { playBtn.textContent = '▶'; playBtn.title = 'Play'; playBtn.setAttribute('aria-label', 'Play'); }
        this.setStatus(this.state.notes.length > 0 ? 'Ready to play or save.' : 'Ready to record.');
    },

    // #17: reverses the most recent edit -- record/chord/delete/insert/translate/rotate/paste/
    // Clear -- see js/undo-stack.js. Was a plain notes.pop() before, which only correctly
    // reversed "the last note I just recorded"; silently did the wrong thing (or nothing useful)
    // after delete/rotate/translate/paste-group. Silently does nothing on an empty stack.
    undo: function() {
        if (!this.state.undoStack.undo()) return;
        this.updateStats();
        this.updateEditControls();
        this.refreshBoard();
    },

    clear: function() {
        const prevNotes = this.state.notes; // #17
        const prevSelected = this.state.selectedIndices;
        this.state.undoStack.push(() => {
            this.state.notes = prevNotes;
            this.state.selectedIndices = prevSelected;
        });
        this.stopPlayback();
        this.stopRecording();
        this.state.notes = [];
        this.state.selectedIndices = [];
        this.updateStats();
        this.updateEditControls();
        this.setStatus('Ready to record.');
        this.refreshBoard();
    },

    save: async function() {
        if (this.state.notes.length === 0) {
            alert('Nothing to save yet -- record a melody first.');
            return;
        }
        const name = prompt('Save as:', 'my-song.mid');
        if (!name) return;
        // Only pass an explicit tempo when quantization was actually used -- an un-quantized,
        // freely-tapped recording's raw times aren't grid-aligned to any tempo, so writing one
        // in wouldn't add real information (see task #52; the default, no-tempo-arg path is
        // exactly today's existing behavior).
        const buffer = this.state.quantizeEnabled
            ? MelodyMode.writeMIDI(this.state.notes, this.state.tempoBPM)
            : MelodyMode.writeMIDI(this.state.notes);
        if (typeof MidiFolder !== 'undefined') {
            const savedToFolder = await MidiFolder.saveFileAs(name, buffer);
            this.setStatus(savedToFolder ? `Saved "${name}" to your MIDI folder.` : `Downloaded "${name}".`);
        }
    },

    // Loads an existing MIDI file to keep working on. Unlike a freshly-tapped note, a loaded
    // file only has {midi, time, duration} -- no (p,q) -- so each note needs a lattice position
    // assigned before it can be shown/edited on the Tonnetz. Tonnetz.nearestCoordFor lays the
    // melody out as one coherent, connected path: note 0 nearest the origin, each note after it
    // nearest the previous note's own chosen cell.
    loadMelodyFromArrayBuffer: function(arrayBuffer, displayName) {
        try {
            const parsed = MelodyMode.parseMIDI(arrayBuffer);
            if (!parsed || parsed.notes.length === 0) {
                alert('No notes found in the MIDI file.');
                return;
            }
            const melody = MelodyMode.extractMonophonicMelody(parsed);

            let prev = { p: 0, q: 0 };
            this.state.notes = melody.map(note => {
                const coord = Tonnetz.nearestCoordFor(note.midi, prev);
                prev = coord;
                return { midi: note.midi, p: coord.p, q: coord.q, time: note.time, duration: note.duration };
            });
            this.state.selectedIndices = [];
            this.state.undoStack.clear(); // #17: a freshly-loaded file is a fresh start

            this.stopPlayback();
            this.stopRecording();
            this.updateStats();
            this.updateEditControls();
            this.setStatus(`Loaded "${displayName}" -- ready to play, edit, or save.`);
            this.refreshBoard();
        } catch (err) {
            console.error(err);
            alert('Error parsing MIDI file. Please make sure it is a valid Standard MIDI File.');
        }
    },

    // MusicXML counterpart to loadMelodyFromArrayBuffer -- js/file-folder.js's fileTypes dispatch
    // (js/midi-folder.js) routes any .musicxml/.xml file here. No extractMonophonicMelody step:
    // this app's own MusicXML is already single-voice-plus-chords, the same shape Compose itself
    // produces. Compose's own Save is expected to move onto MusicXML.write directly (js/musicxml.js)
    // rather than round-tripping through this load path -- that's docs/melody-notation-design.md's
    // Compose-editing work, not this one.
    loadMelodyFromMusicXML: function(text, displayName) {
        try {
            const parsed = MusicXML.parse(text);
            if (!parsed || parsed.notes.length === 0) {
                alert('No notes found in the MusicXML file.');
                return;
            }
            let prev = { p: 0, q: 0 };
            this.state.notes = parsed.notes.map((note) => {
                const coord = Tonnetz.nearestCoordFor(note.midi, prev);
                prev = coord;
                return { midi: note.midi, p: coord.p, q: coord.q, time: note.time, duration: note.duration };
            });
            this.state.selectedIndices = [];
            // Authored key wins if the file declared one (see melody.js's own loadMelodyFromMusicXML
            // for why detectKeySignature is only a fallback, not the primary source) -- drives
            // both refreshStaff's spelling and any newly-added note's own accidental going forward.
            this.state.keySignature = parsed.keySignature != null
                ? parsed.keySignature
                : Tonnetz.detectKeySignature(this.state.notes.map((n) => n.midi));
            this.state.undoStack.clear(); // #17: a freshly-loaded file is a fresh start

            this.stopPlayback();
            this.stopRecording();
            this.updateStats();
            this.updateEditControls();
            this.setStatus(`Loaded "${displayName}" -- ready to play, edit, or save.`);
            this.refreshBoard();
        } catch (err) {
            console.error(err);
            alert('Error parsing MusicXML file: ' + err.message);
        }
    },

    // .mxl (compressed MusicXML -- js/mxl.js) counterpart, mirroring melody.js's own
    // loadMelodyFromMxl: unzip, then hand the extracted text to the existing MusicXML load path
    // rather than duplicating its note/keySignature handling.
    loadMelodyFromMxl: async function(arrayBuffer, displayName) {
        try {
            const text = await Mxl.extractMusicXML(arrayBuffer);
            this.loadMelodyFromMusicXML(text, displayName);
        } catch (err) {
            console.error(err);
            alert('Error reading .mxl file. Please make sure it is a valid compressed MusicXML archive.');
        }
    },

    setStatus: function(text) {
        const el = document.getElementById('compose-status');
        if (el) el.textContent = text;
    },

    updateStats: function() {
        const countEl = document.getElementById('compose-note-count');
        if (countEl) countEl.textContent = this.state.notes.length;

        const timeEl = document.getElementById('compose-elapsed');
        if (timeEl) {
            const last = this.state.notes[this.state.notes.length - 1];
            const total = last ? last.time + last.duration : 0;
            timeEl.textContent = `${total.toFixed(1)}s`;
        }
    },

    refreshBoard: function() {
        // -26..26: wide enough that zooming out to Render.MAX_ZOOM never reveals blank space past
        // the drawn edge (matches Sandbox/Life/Melody).
        const viewport = { minP: -26, maxP: 26, minQ: -26, maxQ: 26 };
        Render.drawLattice(viewport, {});
        // zoom is null until the first draw, then persists across redraws -- a redraw must never
        // silently reset a zoom the player set via wheel/pinch back to the responsive default.
        this.state.zoom = this.state.zoom || Render.getResponsiveZoom();
        const v = Render.panView(this.state.viewX, this.state.viewY, this.state.zoom);
        this.state.viewX = v.viewX;
        this.state.viewY = v.viewY;
        this.renderSelectionMarkers();
        this.refreshStaff();
        this.refreshTimeline();
    },

    // The real grand staff (Task #9, docs/melody-notation-design.md), driving click-to-add/
    // drag-to-re-pitch/drag-to-retime. Each note gets `id: i` (its OWN state.notes index) BEFORE
    // Notation.render internally re-sorts by time -- notesToBeatSpace/toMeasures/render all thread
    // that id straight through to noteXPositions, so _hitTestNote can map a click back to a
    // specific state.notes entry even when several notes share a pitch or a time. The render
    // result (x/y positions, staveBounds, barlineXPositions) is stashed on `this._staffRender` --
    // setupStaffDOMEvents' hit-testing/pitchFromY/beatFromX calls all read it from there, since
    // it's rebuilt on every redraw (drawLattice-style: no incremental diffing).
    refreshStaff: function() {
        const notesWithId = this.state.notes.map((n, i) => Object.assign({}, n, { id: i }));
        this._staffRender = Notation.render('compose-staff', notesWithId, {
            bpm: this.state.tempoBPM,
            keySignature: this.state.keySignature,
        });
        Notation.renderLabels('compose-staff-labels', this._staffRender ? this._staffRender.noteXPositions : [], this.state.keySignature);
    },

    // A persistent ring per selected note, distinct from highlightByMidi's momentary play-flash
    // -- drawLattice wipes the whole <svg>, so these have to be re-added after every redraw
    // rather than surviving as a diff. One ring per DISTINCT (p,q), not one per note -- a
    // time-range selection (see selectTimeRange) can span several notes that share a cell (a
    // repeated pitch within the range), and the Tonnetz is pitch-only: it has nothing to show
    // for "two different times, same pitch" beyond one highlighted cell. This IS the
    // "flattening" docs/melody-notation-design.md describes -- a simplification of this VIEW
    // only, never of state.notes itself.
    renderSelectionMarkers: function() {
        const seen = new Set();
        this.state.selectedIndices.forEach(i => {
            const n = this.state.notes[i];
            if (!n) return;
            const key = n.p + ',' + n.q;
            if (seen.has(key)) return;
            seen.add(key);
            const pos = Render.getScreenPos(n.p, n.q);
            const ring = document.createElementNS(Render.NS, 'circle');
            ring.setAttribute('cx', pos.x);
            ring.setAttribute('cy', pos.y);
            ring.setAttribute('r', Render.HEX_R * 0.55);
            ring.setAttribute('class', 'compose-selected-note');
            Render.appendToLattice(ring);
        });
    },

    // A minimal time-ordered stand-in for the real grand-staff view (docs/melody-notation-design.md)
    // -- one token per note, sorted by time (not raw array order, which insert/translate/rotate
    // don't necessarily preserve), each carrying its ORIGINAL state.notes index so a click/drag can
    // reference it. Rebuilt on every refreshBoard() the same way the Tonnetz itself is -- no diffing.
    refreshTimeline: function() {
        const el = document.getElementById('compose-timeline');
        if (!el) return;
        el.innerHTML = '';
        const ordered = this.state.notes.map((n, i) => ({ n, i })).sort((a, b) => a.n.time - b.n.time);
        ordered.forEach(({ n, i }) => {
            const span = document.createElement('span');
            span.className = 'note-token' + (this.state.selectedIndices.includes(i) ? ' selected' : '');
            span.setAttribute('data-note-idx', i);
            span.textContent = Tonnetz.getNoteName(n.midi) + Tonnetz.getOctave(n.midi);
            el.appendChild(span);
        });
    },

    // The time-range-selection half of the central workflow: every note whose TIME falls within
    // [min(a.time, b.time), max(a.time, b.time)] gets selected, regardless of pitch -- a plain
    // click (idxA === idxB) selects just that time point (which may be more than one note, if
    // it's a chord). REPLACES the selection outright (v1 -- no shift-to-extend yet, unlike
    // selectAtCell's Tonnetz-tap shiftKey toggle). translateSelection/rotateSelection then apply
    // to exactly this set with zero changes of their own: they already only ever touch each
    // selected note's p/q/midi, never time/duration.
    selectTimeRange: function(idxA, idxB) {
        const a = this.state.notes[idxA];
        const b = this.state.notes[idxB];
        if (!a || !b) return;
        const t0 = Math.min(a.time, b.time);
        const t1 = Math.max(a.time, b.time);
        this.state.selectedIndices = [];
        this.state.notes.forEach((n, i) => {
            if (n.time >= t0 && n.time <= t1) this.state.selectedIndices.push(i);
        });
        this.updateEditControls();
        this.refreshBoard();
    },

    // ---- Cross-mode copy/paste (App.copy/App.paste; docs/invariants.md INV-47) ----
    // Compose uses the standard mapping, so its notes' (p,q) are already canonical. Copy = the
    // spatial footprint of the piece (each note's cell). Paste = drop the cells in as one chord at
    // the playhead -- Compose has no scrub marker yet (#73), so the playhead is the end of the
    // current piece; every pasted cell shares that time (a simultaneous chord).
    copyCells: function() {
        return this.state.notes.map((n) => ({ p: n.p, q: n.q }));
    },
    pasteClipboard: function(cells) {
        const playhead = this.state.notes.reduce((t, n) => Math.max(t, n.time + n.duration), 0);
        const midis = [];
        cells.forEach((c) => {
            const midi = Tonnetz.getMidi(c.p, c.q);
            this.state.notes.push({ midi, p: c.p, q: c.q, time: playhead, duration: this.DEFAULT_DURATION });
            midis.push(midi);
        });
        this.refreshBoard();
        // Compose has no persistent per-note marker at rest (only a momentary flash while
        // recording, or a selection ring once explicitly tapped) -- every OTHER note-adding path
        // (recordTouch etc.) flashes its cell via Render.highlightByMidi so the player sees
        // something landed; paste skipped both that AND updateStats(), so a successful paste
        // looked identical to a no-op (reported live: "nothing pastes").
        midis.forEach((m) => Render.highlightByMidi(m, 250));
        this.updateStats();
        if (midis.length) Synth.playChord(midis, false, 0.12, 0.9); // soft confirmation
    },

    // ---- Staff editing (Task #9, docs/melody-notation-design.md) ----
    // "Click-to-add on the staff (exact pitch+time, fills the gap Tonnetz-tap can't), drag-to-
    // re-pitch (live-synced with the Tonnetz), drag-to-retime (staff-exclusive) -- all routed
    // through the existing mutators/undo stack, not a second independent document."

    // Adds a brand-new note at an EXACT (midi, time) -- unlike insertAfterSelected, nothing else
    // shifts: the player placed this note at a specific point they chose on the staff, not "right
    // after this other note." near defaults to the origin the same way pasteClipboard/a
    // from-scratch tap would.
    addNoteAt: function(midi, time) {
        const coord = Tonnetz.nearestCoordFor(midi);
        const note = { midi, p: coord.p, q: coord.q, time: Math.max(0, time), duration: this.DEFAULT_DURATION };
        this.state.notes.push(note);
        const idx = this.state.notes.length - 1;
        const prevSelected = this.state.selectedIndices;
        this.state.selectedIndices = [idx];
        this.state.undoStack.push(() => {
            const i = this.state.notes.indexOf(note);
            if (i >= 0) this.state.notes.splice(i, 1);
            this.state.selectedIndices = prevSelected;
            this.refreshBoard();
        });
        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);
        this.updateStats();
        this.updateEditControls();
        this.refreshBoard();
    },

    // Nearest rendered notehead to (x, y) within a fixed pixel radius, returned as a state.notes
    // index (via the `id` Notation.render threads through -- see refreshStaff) -- or null if
    // nothing's close enough, meaning "empty staff space" to setupStaffDOMEvents.
    HIT_RADIUS_PX: 14,
    _hitTestStaffNote: function(x, y) {
        const r = this._staffRender;
        if (!r || !r.noteXPositions) return null;
        let best = null;
        let bestDist = this.HIT_RADIUS_PX;
        r.noteXPositions.forEach((n) => {
            const dist = Math.hypot(n.x - x, n.y - y);
            if (dist < bestDist) {
                bestDist = dist;
                best = n.id;
            }
        });
        return best;
    },

    // Pixels of movement below which a mousedown+mouseup counts as a plain click (add/select),
    // not a drag (re-pitch/retime) -- distinguishes an intentional drag from a slightly shaky tap.
    DRAG_DEAD_ZONE_PX: 4,

    setupStaffDOMEvents: function() {
        const container = document.getElementById('compose-staff');
        if (!container) return;
        let drag = null; // { noteIndex, kind: null|'pitch'|'time', startX, startY, moved, origMidi, origTime, origP, origQ }

        const posFromEvent = (e) => {
            const svg = container.querySelector('svg');
            if (!svg) return null;
            const rect = svg.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };
        const beatToTime = (beat) => beat * (60 / this.state.tempoBPM);

        container.addEventListener('mousedown', (e) => {
            const pos = posFromEvent(e);
            if (!pos) return;
            const hitIndex = this._hitTestStaffNote(pos.x, pos.y);
            const hit = hitIndex != null ? this.state.notes[hitIndex] : null;
            drag = {
                noteIndex: hitIndex,
                kind: null,
                startX: pos.x,
                startY: pos.y,
                moved: false,
                origMidi: hit ? hit.midi : null,
                origTime: hit ? hit.time : null,
                origP: hit ? hit.p : null,
                origQ: hit ? hit.q : null,
            };
        });

        container.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const pos = posFromEvent(e);
            if (!pos || !this._staffRender) return;
            const dx = pos.x - drag.startX;
            const dy = pos.y - drag.startY;
            if (!drag.moved && Math.hypot(dx, dy) < this.DRAG_DEAD_ZONE_PX) return;
            drag.moved = true;
            if (drag.noteIndex == null) return; // dragging empty space: no live effect, only click-to-add on release
            if (!drag.kind) drag.kind = Math.abs(dx) > Math.abs(dy) ? 'time' : 'pitch';
            const note = this.state.notes[drag.noteIndex];
            if (!note) return;
            if (drag.kind === 'pitch') {
                const midi = Notation.pitchFromY(pos.y, this._staffRender.staveBounds, this.state.keySignature);
                if (midi !== note.midi) {
                    const coord = Tonnetz.nearestCoordFor(midi, { p: note.p, q: note.q });
                    note.midi = midi;
                    note.p = coord.p;
                    note.q = coord.q;
                    this.refreshBoard();
                }
            } else {
                const beat = Notation.beatFromX(pos.x, this._staffRender.barlineXPositions, 4);
                const time = Math.max(0, beatToTime(beat));
                if (Math.abs(time - note.time) > 1e-6) {
                    note.time = time;
                    this.refreshBoard();
                }
            }
        });

        const finishDrag = (e) => {
            if (!drag) return;
            const d = drag;
            drag = null;
            if (d.noteIndex != null) {
                const note = this.state.notes[d.noteIndex];
                if (d.moved && note) {
                    // #17: commit ONE undo entry for the whole gesture, restoring the PRE-drag
                    // values captured at mousedown -- not a per-mousemove entry each.
                    const noteIndex = d.noteIndex;
                    const origMidi = d.origMidi, origTime = d.origTime, origP = d.origP, origQ = d.origQ;
                    const prevSelected = this.state.selectedIndices;
                    this.state.selectedIndices = [noteIndex];
                    this.state.undoStack.push(() => {
                        const n = this.state.notes[noteIndex];
                        if (n) { n.midi = origMidi; n.time = origTime; n.p = origP; n.q = origQ; }
                        this.state.selectedIndices = prevSelected;
                        this.refreshBoard();
                    });
                    this.updateStats();
                    this.updateEditControls();
                    this.refreshBoard();
                } else if (!d.moved) {
                    this.state.selectedIndices = [d.noteIndex];
                    this.updateEditControls();
                    this.refreshBoard();
                }
            } else if (!d.moved) {
                const pos = posFromEvent(e);
                if (!pos || !this._staffRender) return;
                const midi = Notation.pitchFromY(pos.y, this._staffRender.staveBounds, this.state.keySignature);
                const beat = Notation.beatFromX(pos.x, this._staffRender.barlineXPositions, 4);
                this.addNoteAt(midi, beatToTime(beat));
            }
        };
        container.addEventListener('mouseup', finishDrag);
        container.addEventListener('mouseleave', () => {
            // Abandon rather than commit if the pointer leaves mid-drag -- but a 'pitch'/'time'
            // drag already mutated the note LIVE during mousemove (see above), so leaving without
            // restoring it would strand that change with no undo entry ever pushed for it.
            if (drag && drag.moved && drag.noteIndex != null) {
                const n = this.state.notes[drag.noteIndex];
                if (n) { n.midi = drag.origMidi; n.time = drag.origTime; n.p = drag.origP; n.q = drag.origQ; }
                this.refreshBoard();
            }
            drag = null;
        });
    },

    cleanup: function() {
        this.stopPlayback();
        this.stopRecording();
    }
};
