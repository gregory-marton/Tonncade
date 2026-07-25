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
        isRecording: false,
        recordStartTime: 0,
        isPlaying: false,
        playbackTimeoutIds: [],
        viewX: -400,
        viewY: -300,
        isPanning: false,
        lastMouse: { x: 0, y: 0 }
    },

    DEFAULT_DURATION: 0.4,

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
            });
        }
    },

    setupEvents: function() {
        const svg = Render.svg;
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        window.onmousemove = (e) => {
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

        window.onmouseup = () => {
            this.state.isPanning = false;
        };

        svg.onmousedown = (e) => {
            const isHex = e.target.tagName.toLowerCase() === 'polygon';
            if (isHex) {
                const p = parseInt(e.target.getAttribute('data-p'));
                const q = parseInt(e.target.getAttribute('data-q'));
                this.tapCell(p, q);
            }
            if (!isTouch) {
                this.state.isPanning = true;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
            }
        };
    },

    // A tap always plays the cell's note (like Sandbox's note-play tool); while recording, it
    // ALSO appends the note to state.notes with its elapsed-time timestamp. (p,q) is exactly
    // whatever cell was clicked -- no reverse-mapping ambiguity, unlike loading a file below,
    // since the player is choosing the cell directly at note-creation time.
    tapCell: function(p, q) {
        const midi = Tonnetz.getMidi(p, q);
        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);

        if (this.state.isRecording) {
            const time = (performance.now() - this.state.recordStartTime) / 1000;
            this.state.notes.push({ midi, p, q, time, duration: this.DEFAULT_DURATION });
            this.updateStats();
        }
    },

    startRecording: function() {
        this.stopPlayback();
        this.state.isRecording = true;
        this.state.recordStartTime = performance.now();
        const btn = document.getElementById('compose-record');
        if (btn) btn.textContent = 'Stop Recording';
        this.setStatus('Recording... tap cells to add notes.');
    },

    stopRecording: function() {
        this.state.isRecording = false;
        const btn = document.getElementById('compose-record');
        if (btn) btn.textContent = 'Record';
        this.setStatus(this.state.notes.length > 0 ? 'Ready to play or save.' : 'Ready to record.');
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
        this.updateStats();
    },

    clear: function() {
        this.stopPlayback();
        this.stopRecording();
        this.state.notes = [];
        this.updateStats();
        this.setStatus('Ready to record.');
    },

    save: async function() {
        if (this.state.notes.length === 0) {
            alert('Nothing to save yet -- record a melody first.');
            return;
        }
        const name = prompt('Save as:', 'my-song.mid');
        if (!name) return;
        const buffer = MidiMode.writeMIDI(this.state.notes);
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

            this.stopPlayback();
            this.stopRecording();
            this.updateStats();
            this.setStatus(`Loaded "${displayName}" -- ready to play, edit, or save.`);
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
    },

    cleanup: function() {
        this.stopPlayback();
        this.stopRecording();
    }
};
