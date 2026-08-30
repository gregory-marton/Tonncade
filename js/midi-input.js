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
 * midi-input.js - Live MIDI hardware input (Web MIDI API), distinct from js/midi.js's
 * "Melody" game mode, which parses and plays back MIDI *files*.
 *
 * Any class-compliant MIDI controller works here, not just an isomorphic/Tonnetz-shaped one --
 * incoming messages are plain MIDI note numbers, which are matched against whichever lattice
 * cell(s) already have that pitch (see Render.highlightByMidi), so nothing about the physical
 * device's own key layout is ever decoded or assumed. A standard piano-style keyboard plugged in
 * instead would behave identically.
 *
 * Connection is opt-in (the #midi-connect-btn click handler in js/main.js calls MidiInput.connect
 * directly), not attempted automatically on page load: requestMIDIAccess() shows a native browser
 * permission prompt with no user-gesture requirement, so calling it unconditionally at startup
 * would prompt every visitor, including the large majority with no MIDI device and no interest in
 * one.
 */
const MidiInput = {
    state: {
        access: null,
        boundInputIds: new Set(),
        pendingChordNotes: [],
        chordTimeoutId: null,
        heldNotes: new Set(),
        sustainedNotes: new Set(),
        activeNotes: new Set(),
        sustainDown: false,
        wakeLock: null,
        wakeLockVisibilityBound: false,
    },

    // Issue #11: Blast wants a whole CHORD (the notes played close together), not one note at a
    // time, to search for a matching piece placement -- a real piano chord's individual key-
    // presses never land in the exact same JS event-loop tick, so a short buffering window is
    // needed to group them. Other modes (Sandbox/Melody/Gravity/Snake) act on each note the
    // instant it arrives; only Blast's handler ever sees this window at all.
    CHORD_WINDOW_MS: 50,

    isSupported: function() {
        return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
    },

    connect: function() {
        if (!this.isSupported()) return Promise.reject(new Error('Web MIDI not supported in this browser'));
        return navigator.requestMIDIAccess({ sysex: false }).then(access => {
            this.state.access = access;
            this.bindAllInputs();
            access.onstatechange = () => this.bindAllInputs();
            this.requestWakeLock();
            return access;
        });
    },

    // A MIDI connection is commonly used for hands-on practice on a phone or tablet. Web MIDI
    // activity alone does not keep the screen awake, so use Screen Wake Lock when available.
    // Wake locks are released automatically when the page is hidden; reacquire on return while
    // the MIDI session is still active. Unsupported browsers simply retain their old behavior.
    requestWakeLock: async function() {
        if (!this.state.access || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
        if (this.state.wakeLock || document.visibilityState !== 'visible') return;
        if (!this.state.wakeLockVisibilityBound) {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') this.requestWakeLock();
            });
            this.state.wakeLockVisibilityBound = true;
        }
        try {
            const lock = await navigator.wakeLock.request('screen');
            this.state.wakeLock = lock;
            if (lock && typeof lock.addEventListener === 'function') {
                lock.addEventListener('release', () => {
                    this.state.wakeLock = null;
                    if (document.visibilityState === 'visible') this.requestWakeLock();
                });
            }
        } catch (err) {
            // Wake Lock can be denied by policy or battery-saving settings; MIDI remains usable.
            console.warn('Screen wake lock unavailable:', err);
        }
    },

    bindAllInputs: function() {
        if (!this.state.access) return;
        this.state.access.inputs.forEach(input => {
            if (this.state.boundInputIds.has(input.id)) return;
            input.onmidimessage = (msg) => this.handleMessage(msg.data);
            this.state.boundInputIds.add(input.id);
        });
        this.refreshStatus();
    },

    connectedInputNames: function() {
        if (!this.state.access) return [];
        return Array.from(this.state.access.inputs.values())
            .filter(input => input.state === 'connected')
            .map(input => input.name);
    },

    handleMessage: function(data) {
        const command = data[0] & 0xf0;
        const note = data[1];
        const velocity = data[2];
        // A note-on with velocity 0 is the same as a note-off by MIDI convention.
        if (command === 0x90 && velocity > 0) {
            this.noteOnState(note);
            this.handleNoteOn(note);
        } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            this.noteOffState(note);
            this.handleNoteOff(note);
        } else if (command === 0xb0 && note === 64) {
            this.state.sustainDown = velocity >= 64;
            if (!this.state.sustainDown) {
                this.state.sustainedNotes.forEach((midi) => {
                    if (!this.state.heldNotes.has(midi)) this.state.activeNotes.delete(midi);
                });
                this.state.sustainedNotes.clear();
            }
        }
    },

    noteOnState: function(midi) {
        this.state.heldNotes.add(midi);
        this.state.sustainedNotes.delete(midi);
        this.state.activeNotes.add(midi);
    },

    noteOffState: function(midi) {
        this.state.heldNotes.delete(midi);
        if (this.state.sustainDown) this.state.sustainedNotes.add(midi);
        else this.state.activeNotes.delete(midi);
    },

    handleNoteOn: function(midi) {
        if (typeof App === 'undefined') return;
        if (App.currentMode === 'sandbox' && typeof SandboxMode !== 'undefined') {
            SandboxMode.playNoteByMidi(midi);
        } else if (App.currentMode === 'melody' && typeof MelodyMode !== 'undefined') {
            MelodyMode.playUserNoteByMidi(midi);
        } else if (App.currentMode === 'compose' && typeof ComposeMode !== 'undefined') {
            ComposeMode.playNoteByMidi(midi);
        } else if (App.currentMode === 'gravity' && typeof GravityMode !== 'undefined') {
            GravityMode.handleMidiNote(midi);
        } else if (App.currentMode === 'snake' && typeof SnakeMode !== 'undefined') {
            SnakeMode.handleMidiNote(midi);
        } else if (App.currentMode === 'blast' && typeof BlastMode !== 'undefined') {
            this.bufferChordNote(midi);
        } else if (App.currentMode === 'life' && typeof LifeMode !== 'undefined') {
            LifeMode.handleMidiNote(midi);
        }
    },

    handleNoteOff: function(midi) {
        if (typeof App === 'undefined') return;
        if (App.currentMode === 'melody' && typeof MelodyMode !== 'undefined' && MelodyMode.releaseUserNoteByMidi) {
            MelodyMode.releaseUserNoteByMidi(midi);
        }
    },

    bufferChordNote: function(midi) {
        this.state.pendingChordNotes.push(midi);
        clearTimeout(this.state.chordTimeoutId);
        this.state.chordTimeoutId = setTimeout(() => {
            const notes = this.state.pendingChordNotes;
            this.state.pendingChordNotes = [];
            this.state.chordTimeoutId = null;
            BlastMode.handleMidiChord(notes);
        }, this.CHORD_WINDOW_MS);
    },

    refreshStatus: function() {
        const btn = document.getElementById('midi-connect-btn');
        if (!btn) return;
        const names = this.connectedInputNames();
        btn.classList.toggle('connected', names.length > 0);
        btn.title = names.length > 0
            ? `MIDI connected: ${names.join(', ')}`
            : 'Connect a MIDI keyboard';
    },
};
