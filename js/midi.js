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
 * midi.js - MIDI File Parser and Melody Game Mode.
 */

const MidiMode = {
    state: {
        melody: [],            // List of { midi, time, duration }
        targetLength: 1,       // Current number of notes to play/repeat
        userIndex: 0,          // Current progress of user in repeating the sequence
        isPlayingPreview: false,
        isPlayingSequence: false,
        playbackTimeoutIds: [],// Scheduled timeouts for preview/sequence playback
        userRepeatTimeoutId: null, // Timer for "going ahead" (2s timeout)
        mistakeTimeoutId: null,    // Timer for showing sequence again on mistake
        bestStreak: 0,         // Longest streak achieved
        difficulty: 'easy',    // 'easy', 'medium', 'hard'
        hoverCell: { p: 0, q: 0 }, // Keyboard navigation hover cell
        reverseQwertyMap: {},      // Reverse mapping built in init()

        qwertyMap: {
            // Row q = 3 (Shift + Top Letter)
            'Q': { p: -5, q: 3 }, 'W': { p: -4, q: 3 }, 'E': { p: -3, q: 3 }, 'R': { p: -2, q: 3 }, 'T': { p: -1, q: 3 },
            'Y': { p: 0, q: 3 },  'U': { p: 1, q: 3 },  'I': { p: 2, q: 3 },  'O': { p: 3, q: 3 },  'P': { p: 4, q: 3 },

            // Row q = 2 (Shift + Middle Letter)
            'A': { p: -4, q: 2 }, 'S': { p: -3, q: 2 }, 'D': { p: -2, q: 2 }, 'F': { p: -1, q: 2 }, 'G': { p: 0, q: 2 },
            'H': { p: 1, q: 2 },  'J': { p: 2, q: 2 },  'K': { p: 3, q: 2 },  'L': { p: 4, q: 2 },  ':': { p: 5, q: 2 },

            // Row q = 1 (Shift + Bottom Letter)
            'Z': { p: -3, q: 1 }, 'X': { p: -2, q: 1 }, 'C': { p: -1, q: 1 }, 'V': { p: 0, q: 1 },  'B': { p: 1, q: 1 },
            'N': { p: 2, q: 1 },  'M': { p: 3, q: 1 },  '<': { p: 4, q: 1 },  '>': { p: 5, q: 1 },  '?': { p: 6, q: 1 },

            // Row q = 0 (Number Row)
            '1': { p: -5, q: 0 }, '2': { p: -4, q: 0 }, '3': { p: -3, q: 0 }, '4': { p: -2, q: 0 }, '5': { p: -1, q: 0 },
            '6': { p: 0, q: 0 },  '7': { p: 1, q: 0 },  '8': { p: 2, q: 0 },  '9': { p: 3, q: 0 },  '0': { p: 4, q: 0 },

            // Row q = -1 (Top Letter)
            'q': { p: -5, q: -1 }, 'w': { p: -4, q: -1 }, 'e': { p: -3, q: -1 }, 'r': { p: -2, q: -1 }, 't': { p: -1, q: -1 },
            'y': { p: 0, q: -1 },  'u': { p: 1, q: -1 },  'i': { p: 2, q: -1 },  'o': { p: 3, q: -1 },  'p': { p: 4, q: -1 },

            // Row q = -2 (Middle Letter)
            'a': { p: -4, q: -2 }, 's': { p: -3, q: -2 }, 'd': { p: -2, q: -2 }, 'f': { p: -1, q: -2 }, 'g': { p: 0, q: -2 },
            'h': { p: 1, q: -2 },  'j': { p: 2, q: -2 },  'k': { p: 3, q: -2 },  'l': { p: 4, q: -2 },  ';': { p: 5, q: -2 },

            // Row q = -3 (Bottom Letter)
            'z': { p: -3, q: -3 }, 'x': { p: -2, q: -3 }, 'c': { p: -1, q: -3 }, 'v': { p: 0, q: -3 },  'b': { p: 1, q: -3 },
            'n': { p: 2, q: -3 },  'm': { p: 3, q: -3 },  ',': { p: 4, q: -3 },  '.': { p: 5, q: -3 },  '/': { p: 6, q: -3 }
        }
    },

    // Default built-in melody: Hot Cross Buns
    defaultMelody: [
        { midi: 64, time: 0.0, duration: 0.4 }, // Hot
        { midi: 62, time: 0.5, duration: 0.4 }, // cross
        { midi: 60, time: 1.0, duration: 0.8 }, // buns
        
        { midi: 64, time: 2.0, duration: 0.4 }, // Hot
        { midi: 62, time: 2.5, duration: 0.4 }, // cross
        { midi: 60, time: 3.0, duration: 0.8 }, // buns
        
        { midi: 60, time: 4.0, duration: 0.2 }, // One
        { midi: 60, time: 4.25, duration: 0.2 }, // a
        { midi: 60, time: 4.5, duration: 0.2 }, // pen-
        { midi: 60, time: 4.75, duration: 0.2 }, // ny
        
        { midi: 62, time: 5.0, duration: 0.2 }, // Two
        { midi: 62, time: 5.25, duration: 0.2 }, // a
        { midi: 62, time: 5.5, duration: 0.2 }, // pen-
        { midi: 62, time: 5.75, duration: 0.2 }, // ny
        
        { midi: 64, time: 6.0, duration: 0.4 }, // Hot
        { midi: 62, time: 6.5, duration: 0.4 }, // cross
        { midi: 60, time: 7.0, duration: 0.8 }  // buns
    ],

    init: function() {
        Render.init('tonnetz-svg');
        
        // Load best streak from localStorage
        this.state.bestStreak = parseInt(localStorage.getItem('tonncade_midi_best') || '0');
        this.updateStreakUI();

        // Load default melody if none is loaded
        if (this.state.melody.length === 0) {
            this.state.melody = JSON.parse(JSON.stringify(this.defaultMelody));
        }

        // Build reverse map for rendering labels
        this.state.reverseQwertyMap = {};
        for (const key in this.state.qwertyMap) {
            const { p, q } = this.state.qwertyMap[key];
            this.state.reverseQwertyMap[`${p},${q}`] = key;
        }

        this.setupDOMEvents();
        this.resetGame();
        this.refreshBoard();
        this.setupKeyboardEvents();
    },

    setupDOMEvents: function() {
        const fileInput = document.getElementById('midi-file-input');
        const playBtn = document.getElementById('midi-play-preview');
        const restartBtn = document.getElementById('midi-game-restart');
        const filenameSpan = document.getElementById('midi-filename');

        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (filenameSpan) {
                    filenameSpan.textContent = file.name;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const parsed = this.parseMIDI(event.target.result);
                        if (!parsed || parsed.notes.length === 0) {
                            alert("No notes found in the MIDI file.");
                            return;
                        }

                        // Filter to a monophonic sequence
                        let melodySeq = this.extractMonophonicMelody(parsed);
                        
                        // Center notes in the viewport octave range
                        melodySeq = this.centerMelody(melodySeq);

                        this.state.melody = melodySeq;
                        this.resetGame();
                        this.refreshBoard();
                    } catch (err) {
                        console.error(err);
                        alert("Error parsing MIDI file. Please make sure it is a valid Standard MIDI File.");
                    }
                };
                reader.readAsArrayBuffer(file);
            };
        }

        if (playBtn) {
            playBtn.onclick = () => {
                if (this.state.isPlayingPreview) {
                    this.stopPreview();
                } else {
                    this.playPreview();
                }
            };
        }

        if (restartBtn) {
            restartBtn.onclick = () => {
                this.resetGame();
            };
        }

        const diffSelect = document.getElementById('midi-difficulty');
        if (diffSelect) {
            diffSelect.value = this.state.difficulty;
            diffSelect.onchange = (e) => {
                this.state.difficulty = e.target.value;
                this.updateDifficultyUI();
            };
        }
    },

    setupKeyboardEvents: function() {
        const svg = Render.svg;

        window.onmousemove = (e) => {
            if (this.state.isPlayingPreview || this.state.isPlayingSequence) return;
            this.updateGhost(e);
        };

        window.onkeydown = (e) => {
            if (this.state.isPlayingPreview || this.state.isPlayingSequence) return;

            // Block default scroll action for Space/Arrow keys
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.code === 'Space') {
                e.preventDefault();
            }

            // Direct qwerty layout note playing
            const mapped = this.state.qwertyMap[e.key];
            if (mapped) {
                e.preventDefault();
                const { p, q } = mapped;
                this.state.hoverCell = { p, q };
                this.updateGhost();
                const midi = Tonnetz.getMidi(p, q);
                this.playUserNote(midi, p, q);
            }
        };

        svg.onmousedown = (e) => {
            if (this.state.isPlayingPreview || this.state.isPlayingSequence) return;

            const isHex = e.target.tagName.toLowerCase() === 'polygon';
            if (isHex) {
                const p = parseInt(e.target.getAttribute('data-p'));
                const q = parseInt(e.target.getAttribute('data-q'));
                this.state.hoverCell = { p, q };
                const midi = Tonnetz.getMidi(p, q);
                this.playUserNote(midi, p, q);
            }
        };
    },

    updateGhost: function(e) {
        const oldGhosts = document.querySelectorAll('.ghost');
        oldGhosts.forEach(g => g.remove());

        let p, q;
        if (e && e.target && e.target.getAttribute('data-p')) {
            p = parseInt(e.target.getAttribute('data-p'));
            q = parseInt(e.target.getAttribute('data-q'));
            this.state.hoverCell = { p, q };
        } else {
            p = this.state.hoverCell.p;
            q = this.state.hoverCell.q;
        }

        if (p !== undefined) {
            const hex = Render.createHex(p, q, {
                fill: 'rgba(127, 224, 208, 0.4)',
                className: 'ghost',
                data: { p, q }
            });
            hex.style.pointerEvents = 'none';
            Render.appendToLattice(hex);
        }
    },

    playUserNote: function(midi, p, q) {
        // Flash visual highlight
        this.highlightCell(p, q, 250);

        // Sound note
        Synth.playNote(midi);

        // Feed to game logic
        this.handleUserInputNote(midi);
    },

    // Same as playUserNote, but for an input source that only knows the note played, not which
    // specific cell was touched (live MIDI hardware input -- see js/midi-input.js). Highlights
    // every cell sharing that pitch instead of one specific (p, q).
    playUserNoteByMidi: function(midi) {
        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);
        this.handleUserInputNote(midi);
    },

    getQwertyKey: function(p, q) {
        if (!this.state.reverseQwertyMap) return null;
        return this.state.reverseQwertyMap[`${p},${q}`] || null;
    },

    highlightCell: function(p, q, duration = 300) {
        const polygon = document.querySelector(`polygon[data-p="${p}"][data-q="${q}"]`);
        if (polygon) {
            polygon.classList.remove('active-note');
            void polygon.offsetWidth; // Force layout flush to register class removal
            polygon.classList.add('active-note');
            
            if (polygon.activeTimeoutId) {
                clearTimeout(polygon.activeTimeoutId);
            }
            
            polygon.activeTimeoutId = setTimeout(() => {
                polygon.classList.remove('active-note');
                polygon.activeTimeoutId = null;
            }, duration);
        }
    },

    setStatus: function(text, type = 'info') {
        const statusEl = document.getElementById('midi-game-status');
        if (statusEl) {
            statusEl.textContent = text;
            
            // Apply color classes based on status type
            statusEl.className = ''; // Reset
            if (type === 'error') {
                statusEl.style.color = '#ff6b6b';
            } else if (type === 'success') {
                statusEl.style.color = '#4bff4b';
            } else if (type === 'going-ahead') {
                statusEl.style.color = '#ffc04b';
            } else {
                statusEl.style.color = 'var(--accent)';
            }
        }
    },

    updateStreak: function(streak) {
        const currentStreakEl = document.getElementById('midi-current-streak');
        if (currentStreakEl) {
            currentStreakEl.textContent = streak;
        }

        if (streak > this.state.bestStreak) {
            this.state.bestStreak = streak;
            localStorage.setItem('tonncade_midi_best', streak.toString());
            this.updateStreakUI();
        }
    },

    updateStreakUI: function() {
        const bestStreakEl = document.getElementById('midi-best-streak');
        if (bestStreakEl) {
            bestStreakEl.textContent = this.state.bestStreak;
        }
    },

    updateDifficultyUI: function(overrideIndex) {
        const listEl = document.getElementById('midi-note-list');
        const diff = this.state.difficulty;

        // Clear old glows
        document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
        document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));

        if (!listEl) return;

        if (diff === 'hard' || this.state.melody.length === 0) {
            listEl.innerHTML = '';
            return;
        }

        const melody = this.state.melody;
        const current = (overrideIndex !== undefined) ? overrideIndex : this.state.userIndex;

        let displayNotes = [];
        const pastWindow = 3;
        const futureWindow = diff === 'easy' ? 4 : 0; // Current + 3 ahead
        const pastOpacityByDistance = { 1: 0.85, 2: 0.55, 3: 0.3 };

        // Add past notes, fading progressively with distance so the most recently
        // played note reads as distinct from older history
        for (let i = Math.max(0, current - pastWindow); i < current; i++) {
            const midi = melody[i].midi;
            const name = Tonnetz.getNoteName(midi);
            const distance = current - i;
            const opacity = pastOpacityByDistance[distance] || 0.3;
            displayNotes.push(`<span data-note-role="past" data-distance="${distance}" style="opacity: ${opacity};">${name}</span>`);

            // Add past glow
            const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
            polygons.forEach(p => p.classList.add('glow-past'));
        }

        // Add current/future notes
        if (diff === 'easy') {
            for (let i = current; i < Math.min(melody.length, current + futureWindow); i++) {
                const midi = melody[i].midi;
                const name = Tonnetz.getNoteName(midi);
                if (i === current) {
                    displayNotes.push(`<span data-note-role="current" style="color: var(--accent); font-size: 1.1em; font-weight: 900;">${name}</span>`);
                } else {
                    displayNotes.push(`<span data-note-role="future" style="opacity: 0.8;">${name}</span>`);
                }

                // Add future glow
                const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
                polygons.forEach(p => p.classList.add('glow-future'));
            }
        }

        listEl.innerHTML = displayNotes.join(' - ');
    },

    resetGame: function() {
        this.cleanup();
        this.state.targetLength = 1;
        this.state.userIndex = 0;
        this.updateStreak(0);
        this.updateGhost();
        this.updateDifficultyUI();

        this.setStatus("Starting game...", "info");
        setTimeout(() => {
            this.playTargetSequence();
        }, 1000);
    },

    playTargetSequence: function() {
        this.cleanupPlayback();
        this.state.isPlayingSequence = true;
        this.setStatus("Listen to the notes...", "info");

        // Disable input
        this.state.userIndex = 0;

        let delayOffset = 0.5; // Initial delay before sequence starts playing

        for (let i = 0; i < this.state.targetLength; i++) {
            const note = this.state.melody[i];
            if (!note) break;

            // Calculate timing relative to first note in sequence
            const relativeTime = note.time - this.state.melody[0].time;
            const scheduledTime = (relativeTime * 1000) + (delayOffset * 1000);

            // Schedule note sound and visual highlight
            const tId1 = setTimeout(() => {
                Synth.playNote(note.midi);
                Render.highlightByMidi(note.midi, note.duration * 1000);
                this.updateDifficultyUI(i);
            }, scheduledTime);

            this.state.playbackTimeoutIds.push(tId1);
        }

        // Calculate when the sequence finishes playing
        const lastNote = this.state.melody[this.state.targetLength - 1];
        const lastRelativeTime = lastNote ? (lastNote.time - this.state.melody[0].time + lastNote.duration) : 1;
        const totalDuration = (lastRelativeTime * 1000) + (delayOffset * 1000);

        const tId2 = setTimeout(() => {
            this.state.isPlayingSequence = false;
            this.setStatus("Your turn! Repeat the notes.", "success");
            this.state.userIndex = 0;
            this.updateDifficultyUI();
        }, totalDuration);

        this.state.playbackTimeoutIds.push(tId2);
    },

    playPreview: function() {
        this.cleanup();
        this.state.isPlayingPreview = true;

        const playBtn = document.getElementById('midi-play-preview');
        if (playBtn) playBtn.textContent = "Stop Preview";

        this.setStatus("Playing full melody preview...", "info");

        let delayOffset = 0.2;

        for (let i = 0; i < this.state.melody.length; i++) {
            const note = this.state.melody[i];
            const relativeTime = note.time - this.state.melody[0].time;
            const scheduledTime = (relativeTime * 1000) + (delayOffset * 1000);

            const tId = setTimeout(() => {
                Synth.playNote(note.midi);
                Render.highlightByMidi(note.midi, note.duration * 1000);
                this.updateDifficultyUI(i);
            }, scheduledTime);

            this.state.playbackTimeoutIds.push(tId);
        }

        const lastNote = this.state.melody[this.state.melody.length - 1];
        const lastRelativeTime = lastNote ? (lastNote.time - this.state.melody[0].time + lastNote.duration) : 5;
        const totalDuration = (lastRelativeTime * 1000) + (delayOffset * 1000);

        const tIdFinish = setTimeout(() => {
            this.stopPreview();
        }, totalDuration);

        this.state.playbackTimeoutIds.push(tIdFinish);
    },

    stopPreview: function() {
        this.cleanupPlayback();
        this.state.isPlayingPreview = false;

        const playBtn = document.getElementById('midi-play-preview');
        if (playBtn) playBtn.textContent = "Play Melody";

        this.setStatus("Preview stopped. Ready.", "info");
        this.updateDifficultyUI();
    },

    handleUserInputNote: function(midi) {
        if (this.state.isPlayingSequence || this.state.isPlayingPreview) return;

        const targetNote = this.state.melody[this.state.userIndex];
        if (!targetNote) return;

        // Compare exact MIDI note pitch
        if (midi === targetNote.midi) {
            // Correct note!
            this.state.userIndex++;
            this.updateStreak(this.state.userIndex);
            this.updateDifficultyUI();

            // Clear any existing "going ahead" timeout
            if (this.state.userRepeatTimeoutId) {
                clearTimeout(this.state.userRepeatTimeoutId);
                this.state.userRepeatTimeoutId = null;
            }

            if (this.state.userIndex >= this.state.melody.length) {
                // Completed the entire song!
                this.setStatus("Congratulations! You completed the song! 🎉", "success");
                document.getElementById('midi-note-list').innerHTML = '';
                document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
                document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
                this.celebrate();
                return;
            }

            if (this.state.userIndex >= this.state.targetLength) {
                // User has repeated the target sequence and can keep going ahead!
                this.setStatus("Correct! Go ahead! (2s timeout)...", "going-ahead");

                this.state.userRepeatTimeoutId = setTimeout(() => {
                    // Timeout fired: User stopped playing ahead.
                    // Immediately transition to playing the new sequence (Silence is golden).
                    this.state.targetLength = this.state.userIndex + 1;
                    this.playTargetSequence();
                }, 2000);
            } else {
                // Still repeating the target sequence
                const remaining = this.state.targetLength - this.state.userIndex;
                this.setStatus(`Correct! Repeat ${remaining} more note${remaining > 1 ? 's' : ''}...`, "progress");
            }
        } else {
            // Mistake!
            this.setStatus("Oops! Let's listen again...", "error");
            
            // If the user made progress up to or beyond the current target,
            // advance the target to show the correct version of the note they missed.
            if (this.state.userIndex >= this.state.targetLength) {
                this.state.targetLength = this.state.userIndex + 1;
            }
            this.state.userIndex = 0;
            this.updateDifficultyUI();
            
            if (this.state.userRepeatTimeoutId) {
                clearTimeout(this.state.userRepeatTimeoutId);
                this.state.userRepeatTimeoutId = null;
            }

            if (this.state.mistakeTimeoutId) {
                clearTimeout(this.state.mistakeTimeoutId);
            }

            // Temporarily block inputs by setting isPlayingSequence
            this.state.isPlayingSequence = true;

            // Replay the target sequence after a 1.2s delay to let the wrong note decay
            this.state.mistakeTimeoutId = setTimeout(() => {
                this.state.mistakeTimeoutId = null;
                if (App.currentMode === 'midi' && !this.state.isPlayingPreview) {
                    this.playTargetSequence();
                }
            }, 1200);
        }
    },

    celebrate: function() {
        // Get unique notes present in the melody, sorted from lowest to highest
        const songNotes = [...new Set(this.state.melody.map(n => n.midi))];
        songNotes.sort((a, b) => a - b);

        const victoryChord = songNotes.length > 0 ? songNotes : [60, 64, 67, 72];
        
        // Play the rolled notes of the song
        Synth.playChord(victoryChord, true, 0.18, 2.0);

        // Flash corresponding cells on the lattice
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                victoryChord.forEach(note => Render.highlightByMidi(note, 150));
            }, i * 300);
        }
    },

    cleanupPlayback: function() {
        this.state.playbackTimeoutIds.forEach(id => clearTimeout(id));
        this.state.playbackTimeoutIds = [];
    },

    cleanup: function() {
        this.cleanupPlayback();
        if (this.state.userRepeatTimeoutId) {
            clearTimeout(this.state.userRepeatTimeoutId);
            this.state.userRepeatTimeoutId = null;
        }
        if (this.state.mistakeTimeoutId) {
            clearTimeout(this.state.mistakeTimeoutId);
            this.state.mistakeTimeoutId = null;
        }
        this.state.isPlayingSequence = false;
        this.state.isPlayingPreview = false;

        const playBtn = document.getElementById('midi-play-preview');
        if (playBtn) playBtn.textContent = "Play Melody";

        // Remove any visual cell highlights
        document.querySelectorAll('.active-note').forEach(el => el.classList.remove('active-note'));
        document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
        document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
        const listEl = document.getElementById('midi-note-list');
        if (listEl) listEl.innerHTML = '';
    },

    refreshBoard: function() {
        // Render the full Sandbox Tonnetz layout
        const viewport = {
            minP: -15, maxP: 15,
            minQ: -15, maxQ: 15
        };
        Render.drawLattice(viewport, {});
        Render.updateView(-400, -300, Render.getResponsiveZoom());
    },

    // MIDI parser logic (SMF format)
    parseMIDI: function(arrayBuffer) {
        const data = new DataView(arrayBuffer);
        let offset = 0;
        
        function readString(len) {
            let s = '';
            for (let i = 0; i < len; i++) {
                s += String.fromCharCode(data.getUint8(offset++));
            }
            return s;
        }
        
        function readUint32() {
            const val = data.getUint32(offset);
            offset += 4;
            return val;
        }
        
        function readUint16() {
            const val = data.getUint16(offset);
            offset += 2;
            return val;
        }
        
        function readUint8() {
            return data.getUint8(offset++);
        }
        
        function readVarInt() {
            let val = 0;
            while (true) {
                const b = readUint8();
                val = (val << 7) | (b & 0x7f);
                if (!(b & 0x80)) break;
            }
            return val;
        }
        
        const header = readString(4);
        if (header !== 'MThd') throw new Error('Not a valid MIDI file');
        const headerSize = readUint32();
        const format = readUint16();
        const numTracks = readUint16();
        const ticksPerBeat = readUint16(); // Division
        
        const notes = [];
        const tempoChanges = [];
        
        for (let t = 0; t < numTracks; t++) {
            if (offset >= data.byteLength) break;
            const trackHeader = readString(4);
            if (trackHeader !== 'MTrk') {
                // Skip chunk
                const chunkSize = readUint32();
                offset += chunkSize;
                continue;
            }
            const trackSize = readUint32();
            const trackEnd = offset + trackSize;
            
            let ticks = 0;
            let lastStatus = 0;
            const activeNotes = new Map(); // key: channel*256 + note, value: { ticks }
            
            while (offset < trackEnd && offset < data.byteLength) {
                const deltaTime = readVarInt();
                ticks += deltaTime;
                
                let status = readUint8();
                if (status < 0x80) {
                    // Running status
                    status = lastStatus;
                    offset--; // Backtrack one byte
                } else {
                    lastStatus = status;
                }
                
                const eventType = status & 0xf0;
                const channel = status & 0x0f;
                
                if (eventType === 0x80 || (eventType === 0x90 && data.getUint8(offset + 1) === 0)) {
                    // Note Off
                    const note = readUint8();
                    const velocity = readUint8();
                    const key = channel * 256 + note;
                    if (activeNotes.has(key)) {
                        const active = activeNotes.get(key);
                        notes.push({
                            midi: note,
                            startTick: active.ticks,
                            endTick: ticks
                        });
                        activeNotes.delete(key);
                    }
                } else if (eventType === 0x90) {
                    // Note On
                    const note = readUint8();
                    const velocity = readUint8();
                    const key = channel * 256 + note;
                    activeNotes.set(key, { ticks });
                } else if (eventType === 0xa0 || eventType === 0xb0 || eventType === 0xe0) {
                    offset += 2;
                } else if (eventType === 0xc0 || eventType === 0xd0) {
                    offset += 1;
                } else if (status === 0xff) {
                    const type = readUint8();
                    const len = readVarInt();
                    if (type === 0x51 && len === 3) {
                        const tempo = (data.getUint8(offset) << 16) | (data.getUint8(offset + 1) << 8) | data.getUint8(offset + 2);
                        tempoChanges.push({ tick: ticks, tempo: tempo });
                    }
                    offset += len;
                } else if (status === 0xf0 || status === 0xf7) {
                    const len = readVarInt();
                    offset += len;
                }
            }
        }
        
        // Convert ticks to seconds using tempo changes
        tempoChanges.sort((a, b) => a.tick - b.tick);
        
        function tickToSec(tick) {
            let sec = 0;
            let lastTick = 0;
            let lastTempo = 500000; // Default 120 BPM
            for (const change of tempoChanges) {
                if (change.tick > tick) break;
                const deltaTicks = change.tick - lastTick;
                sec += (deltaTicks / ticksPerBeat) * (lastTempo / 1000000);
                lastTick = change.tick;
                lastTempo = change.tempo;
            }
            const deltaTicks = tick - lastTick;
            sec += (deltaTicks / ticksPerBeat) * (lastTempo / 1000000);
            return sec;
        }

        const timedNotes = notes.map(note => ({
            midi: note.midi,
            time: tickToSec(note.startTick),
            duration: Math.max(0.1, tickToSec(note.endTick) - tickToSec(note.startTick))
        }));

        timedNotes.sort((a, b) => a.time - b.time);
        return { notes: timedNotes };
    },

    // Convert polyphonic notes to a single melody sequence (monophonic)
    extractMonophonicMelody: function(parsed) {
        const melody = [];
        let lastTime = -1;

        parsed.notes.forEach(note => {
            // If notes overlap exactly or start within 0.05 seconds of each other,
            // treat them as a chord and keep only the highest pitch note
            if (melody.length > 0 && Math.abs(note.time - lastTime) < 0.08) {
                if (note.midi > melody[melody.length - 1].midi) {
                    melody[melody.length - 1] = note;
                }
            } else {
                melody.push(note);
                lastTime = note.time;
            }
        });

        return melody;
    },

    // Shift melody octave so that its notes center around MIDI 60 (C4)
    centerMelody: function(melody) {
        if (melody.length === 0) return melody;
        
        const sum = melody.reduce((acc, note) => acc + note.midi, 0);
        const avg = sum / melody.length;
        const shift = Math.round((60 - avg) / 12) * 12;

        if (shift !== 0) {
            melody.forEach(note => {
                note.midi += shift;
            });
        }
        return melody;
    }
};
