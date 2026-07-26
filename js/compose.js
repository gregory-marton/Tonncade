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
 * v1 scope is deliberately narrow (see docs/invariants.md and next_steps.md #27): Undo (remove
 * the most recently added note) and Clear are the only editing primitives. Per-note drag-to-
 * reposition/retime, a timeline/piano-roll view, multi-select, and inserting a note into the
 * middle of an existing sequence are all real interaction-design work saved for later, not
 * silently expanded into here.
 */

const ComposeMode = {
    state: {
        notes: [],              // { midi, p, q, time, duration }
        selectedIndices: [],    // indices into notes currently selected for editing
        isRecording: false,
        recordStartTime: 0,
        isPlaying: false,
        playbackTimeoutIds: [],
        viewX: -400,
        viewY: -300,
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
        chordBufferTimer: null
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
        this.updateStats();
    },

    setupDOMEvents: function() {
        const recordBtn = document.getElementById('compose-record');
        const playBtn = document.getElementById('compose-play');
        const undoBtn = document.getElementById('compose-undo');
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
        if (undoBtn) undoBtn.onclick = () => this.undo();
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

        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => this.loadMelodyFromArrayBuffer(event.target.result, file.name);
                reader.readAsArrayBuffer(file);
            };
        }

        // Shares Melody's exact remembered folder (both work with .mid files, unlike Life's
        // separate YAML folder) -- see js/midi-folder.js's `ids` parameter, which is what lets
        // the same MidiFolder singleton serve two different modes' own DOM elements.
        if (typeof MidiFolder !== 'undefined') {
            MidiFolder.setup(this, {
                uploadGroup: 'compose-upload-group',
                folderGroup: 'compose-folder-group',
                chooseBtn: 'compose-choose-folder-btn',
                filesSelect: 'compose-folder-files',
                folderStatus: 'compose-folder-status',
                onlineGroup: 'compose-online-group',
                onlineSelect: 'compose-online-files',
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
                Render.updateView(this.state.viewX, this.state.viewY, Render.zoom);
                this.state.viewX = Render.viewX;
                this.state.viewY = Render.viewY;
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
            this.state.notes.push({ midi, p, q, time, duration: this.DEFAULT_DURATION });
            this.updateStats();
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
        buffer.forEach(({ midi, p, q }) => {
            this.state.notes.push({ midi, p, q, time, duration: this.DEFAULT_DURATION });
        });
        this.updateStats();
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

        this.state.notes = kept;
        this.state.selectedIndices = [];
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

        this.state.notes.forEach(n => { if (n.time >= insertTime) n.time += newNote.duration; });
        this.state.notes.splice(idx + 1, 0, newNote);
        this.state.selectedIndices = [idx + 1];

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
        this.state.selectedIndices.forEach(i => {
            const n = this.state.notes[i];
            n.p += dp;
            n.q += dq;
            n.midi = Tonnetz.getMidi(n.p, n.q);
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
        this.state.selectedIndices.forEach(i => {
            if (i === pivotIdx) return;
            const n = this.state.notes[i];
            const rel = { p: n.p - pivot.p, q: n.q - pivot.q };
            const rotated = (direction > 0 ? Pieces.rotate([rel]) : Pieces.rotateCCW([rel]))[0];
            n.p = pivot.p + rotated.p;
            n.q = pivot.q + rotated.q;
            n.midi = Tonnetz.getMidi(n.p, n.q);
        });
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
    },

    startRecording: function() {
        this.stopPlayback();
        this.state.isRecording = true;
        this.state.recordStartTime = performance.now();
        const btn = document.getElementById('compose-record');
        if (btn) btn.textContent = 'Stop Recording';
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
        if (btn) btn.textContent = 'Record';
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
        if (playBtn) playBtn.textContent = 'Stop';
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
        if (playBtn) playBtn.textContent = 'Play';
        this.setStatus(this.state.notes.length > 0 ? 'Ready to play or save.' : 'Ready to record.');
    },

    undo: function() {
        this.state.notes.pop();
        this.state.selectedIndices = [];
        this.updateStats();
        this.updateEditControls();
        this.refreshBoard();
    },

    clear: function() {
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
            ? MidiMode.writeMIDI(this.state.notes, this.state.tempoBPM)
            : MidiMode.writeMIDI(this.state.notes);
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
            const parsed = MidiMode.parseMIDI(arrayBuffer);
            if (!parsed || parsed.notes.length === 0) {
                alert('No notes found in the MIDI file.');
                return;
            }
            const melody = MidiMode.extractMonophonicMelody(parsed);

            let prev = { p: 0, q: 0 };
            this.state.notes = melody.map(note => {
                const coord = Tonnetz.nearestCoordFor(note.midi, prev);
                prev = coord;
                return { midi: note.midi, p: coord.p, q: coord.q, time: note.time, duration: note.duration };
            });
            this.state.selectedIndices = [];

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
        const viewport = { minP: -15, maxP: 15, minQ: -15, maxQ: 15 };
        Render.drawLattice(viewport, {});
        Render.updateView(this.state.viewX, this.state.viewY, Render.getResponsiveZoom());
        this.state.viewX = Render.viewX;
        this.state.viewY = Render.viewY;
        this.renderSelectionMarkers();
    },

    // A persistent ring per selected note, distinct from highlightByMidi's momentary play-flash
    // -- drawLattice wipes the whole <svg>, so these have to be re-added after every redraw
    // rather than surviving as a diff.
    renderSelectionMarkers: function() {
        this.state.selectedIndices.forEach(i => {
            const n = this.state.notes[i];
            if (!n) return;
            const pos = Render.getScreenPos(n.p, n.q);
            const ring = document.createElementNS(Render.NS, 'circle');
            ring.setAttribute('cx', pos.x);
            ring.setAttribute('cy', pos.y);
            ring.setAttribute('r', Render.HEX_R * 0.55);
            ring.setAttribute('class', 'compose-selected-note');
            Render.appendToLattice(ring);
        });
    },

    cleanup: function() {
        this.stopPlayback();
        this.stopRecording();
    }
};
