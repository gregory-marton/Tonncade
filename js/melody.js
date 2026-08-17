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

const MelodyMode = {
    state: {
        melody: [],            // List of { midi, time, duration }
        // Set explicitly at both load sites (loadDefault/loadMelodyFromArrayBuffer) -- never
        // inferred from #melody-filename's text or MidiFolder.currentValue, which would couple
        // this file to file-folder.js internals. Random is a memory-quiz sliding window forever
        // (no measures, no auto-advance -- it isn't a piece to progress through, #46); every
        // other branch below reads this flag to pick the Random path or the full-song path.
        isRandom: true,
        // Effective BPM for the CURRENT state.melody -- only meaningful (and only read) when
        // !isRandom. Assume 4/4 throughout (no time-signature parsing exists in this codebase --
        // out of scope). Used by measureOf() for the timeline's measure-tick marks (#46).
        melodyBPM: 120,
        // Auto-detected (Tonnetz.detectKeySignature) whenever a melody loads -- the lightweight
        // key-fit heuristic for the MIDI/Random bucket (docs/melody-notation-design.md), since a
        // MIDI file/Random's generated sequence never carries an authored key signature the way
        // MusicXML does. null means "no detected key" (falls back to Tonnetz.getNoteName's own
        // sharps-only default, unchanged) -- set on every load, see loadDefault/
        // loadMelodyFromArrayBuffer.
        keySignature: null,
        // INV-48: a mode switch must pause the drill, never discard or restart it. gameStarted
        // gates init()'s own resetGame() call so only a genuinely NEW game (first entry, the
        // explicit Restart button, or loading a new song -- all of which call resetGame()
        // directly and unconditionally) resets progress; a mere re-entry after switching away
        // resumes exactly where the player left off instead.
        gameStarted: false,
        targetLength: 1,       // Current number of notes to play/repeat
        userIndex: 0,          // Current progress of user in repeating the sequence
        startIndex: 0,         // Where the drilled segment begins (see #46 scrub control) --
                                // always <= targetLength - 1, letting a player replay from any
                                // note already reached instead of always from note 0.
        isDraggingScrub: false, // Live-drag state for the inline scrub marker (see setupScrubMarker)
        scrubDragIndex: 0,      // The marker's candidate position while mid-drag, before it's committed
        // Spaced-repetition auto-advance (#46, songs only -- see isRandom). cleanStreak counts
        // consecutive full clean playthroughs of the current segment; segmentHadMistake is
        // transient, tracking whether the in-progress pass has had a mistake yet. Neither is
        // touched by cleanup()/init()'s resume branch, so both survive a mode switch away and
        // back for free (INV-48), same as targetLength/userIndex/startIndex already do.
        cleanStreak: 0,
        segmentHadMistake: false,
        isPlayingPreview: false,
        isPlayingSequence: false,
        playbackTimeoutIds: [],// Scheduled timeouts for preview/sequence playback
        userRepeatTimeoutId: null, // Timer for "going ahead" (2s timeout)
        mistakeTimeoutId: null,    // Timer for showing sequence again on mistake
        currentStreak: 0,      // Current streak (drives the stat bar-graph vs bestStreak)
        bestStreak: 0,         // Longest streak achieved
        difficulty: 1,    // 1=full hints .. 3=no hints (see DifficultyBarbell, js/difficulty-barbell.js)
        hoverCell: { p: 0, q: 0 }, // Keyboard navigation hover cell
        reverseQwertyMap: {},      // Reverse mapping built in init()

        // Free-pan state (mouse; see setupKeyboardEvents) -- matches SandboxMode's own
        // viewX/viewY/isPanning/lastMouse fields exactly, so the mouse-drag pattern (play the
        // clicked cell's note on mousedown, ALSO start tracking for a possible drag, update on
        // mousemove if dragging, stop on mouseup) is one already-proven interaction, not a new
        // one invented for this mode.
        // null until the first draw: viewX/viewY center for the current aspect-matched ref box
        // (see Render.panView / INV-44), zoom picks the responsive default. All three then persist
        // across redraws (panning, or wheel/pinch zoom -- see main.js's applyZoomDelta).
        viewX: null,
        viewY: null,
        zoom: null,
        isPanning: false,
        lastMouse: { x: 0, y: 0 },

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

    // No built-in song is bundled anymore -- the online midi/ folder (and a local folder) supply
    // real songs. This is only the OFFLINE degrade: a random 10-note sequence within one octave
    // (C4..B4), so the drill is always playable with no web connection or under file:// (#86).
    randomMelody: function() {
        const base = 60; // C4
        const notes = [];
        for (let i = 0; i < 10; i++) {
            notes.push({ midi: base + Math.floor(Math.random() * 12), time: i * 0.5, duration: 0.4 });
        }
        return notes;
    },

    // The "Random" entry in #melody-source (js/file-folder.js's FileFolder contract: `hasRandom`
    // modes need a `loadDefault()` the dropdown can call to explicitly re-roll it, not just the
    // implicit one-time fallback `init()` sets below).
    loadDefault: function() {
        this.state.melody = this.randomMelody();
        this.state.isRandom = true;
        this.state.keySignature = Tonnetz.detectKeySignature(this.state.melody.map((n) => n.midi));
        const filenameSpan = document.getElementById('melody-filename');
        if (filenameSpan) filenameSpan.textContent = '';
        this.resetGame();
        this.refreshBoard();
    },

    init: function() {
        Render.init('tonnetz-svg');
        
        // Load best streak from localStorage. Reads the OLD key ('tonncade_midi_best', from
        // before the mode's internal identifier was renamed midi -> melody) as a fallback, so a
        // returning player's existing best streak isn't silently lost -- every future write goes
        // only to the new key, so this self-migrates on the player's next best streak.
        this.state.bestStreak = parseInt(
            localStorage.getItem('tonncade_melody_best') || localStorage.getItem('tonncade_midi_best') || '0'
        );
        this.updateStreakUI();

        // Offline degrade if nothing is loaded yet: a random one-octave sequence. The online
        // midi/ folder (populated async by MidiFolder) replaces this with a real song when a
        // connection exists; this only persists offline / under file:// (#86).
        if (this.state.melody.length === 0) {
            this.state.melody = this.randomMelody();
            this.state.keySignature = Tonnetz.detectKeySignature(this.state.melody.map((n) => n.midi));
        }

        // Build reverse map for rendering labels
        this.state.reverseQwertyMap = {};
        for (const key in this.state.qwertyMap) {
            const { p, q } = this.state.qwertyMap[key];
            this.state.reverseQwertyMap[`${p},${q}`] = key;
        }

        this.setupDOMEvents();
        if (!this.state.gameStarted) {
            this.resetGame();
        } else {
            // Resuming after a mode switch (INV-48): repaint exactly where the player left off --
            // no reset, no auto-playing the target sequence. cleanup() (run when Melody was left)
            // already cleared the note-list markup and Tonnetz glow classes without touching
            // targetLength/userIndex/startIndex/the streak or #melody-game-status's text, so
            // rebuilding the note list/ghost/streak bar from that untouched progress is enough to
            // make the resume look exactly like nothing happened.
            this.updateStreakUI();
            this.updateDifficultyUI();
            this.updateGhost();
        }
        this.refreshBoard();
        this.setupKeyboardEvents();
    },

    setupDOMEvents: function() {
        const fileInput = document.getElementById('melody-file-input');
        const playBtn = document.getElementById('melody-play-preview');
        const restartBtn = document.getElementById('melody-game-restart');
        const filenameSpan = document.getElementById('melody-filename');

        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                // Same fileTypes dispatch js/file-folder.js's own folder-browsing tier already
                // uses (MidiFolder.resolveFileType) -- this fallback picker (Safari/Firefox, or
                // Chrome before a folder's been chosen) needs to route .musicxml/.xml/.mxl to
                // their own loaders too, not just .mid. Reusing it here instead of duplicating the
                // pattern match is what a fix for "the direct picker only understands MIDI" (an
                // earlier gap in this file, caught by Codex's review) actually requires -- widening
                // the <input accept> alone wouldn't have been enough, since this handler still
                // would have force-fed the wrong bytes into the MIDI parser.
                const { readAs, loadMethod } = MidiFolder.resolveFileType(file.name);
                const reader = new FileReader();
                reader.onload = (event) => {
                    this[loadMethod](event.target.result, file.name);
                };
                if (readAs === 'text') reader.readAsText(file);
                else reader.readAsArrayBuffer(file);
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

        this.setupScrubMarker();

        // Dumbbell-barbell difficulty picker (js/difficulty-barbell.js, shared with Blast/Gravity)
        // -- click the Nth weight to set the practice-hint level.
        this._difficultyBarbell = DifficultyBarbell.create({
            containerId: 'melody-difficulty',
            levelCount: 3,
            labels: [
                { title: 'Easy — full note list and highlighted upcoming notes', ariaLabel: 'Easy' },
                { title: 'Medium', ariaLabel: 'Medium' },
                { title: 'Hard — no note list, play by ear', ariaLabel: 'Hard' },
            ],
            onSelect: (level) => this.setDifficulty(level),
        });
        this._difficultyBarbell.render();
        this._difficultyBarbell.setLevel(this.state.difficulty);

        if (typeof MidiFolder !== 'undefined') {
            MidiFolder.setup(this, {
                sourceSelect: 'melody-source',
                sourceStatus: 'melody-source-status',
                uploadGroup: 'melody-upload-group',
            }, { hasRandom: true });
        }
    },

    // Parses a Standard MIDI File already read into memory and loads it as the active melody --
    // shared by both the plain <input type=file> picker (fileInput.onchange above) and the
    // File System Access folder browser (js/midi-folder.js), so parsing/centering/reset logic
    // lives in exactly one place regardless of which UI supplied the bytes.
    loadMelodyFromArrayBuffer: function(arrayBuffer, displayName) {
        const filenameSpan = document.getElementById('melody-filename');
        try {
            const parsed = this.parseMIDI(arrayBuffer);
            if (!parsed || parsed.notes.length === 0) {
                alert("No notes found in the MIDI file.");
                return;
            }

            // Filter to a monophonic sequence
            let melodySeq = this.extractMonophonicMelody(parsed);

            // Center notes in the viewport octave range
            melodySeq = this.centerMelody(melodySeq);

            this.state.melody = melodySeq;
            this.state.isRandom = false;
            this.state.melodyBPM = parsed.bpm;
            this.state.keySignature = Tonnetz.detectKeySignature(melodySeq.map((n) => n.midi));
            if (filenameSpan && displayName) filenameSpan.textContent = displayName;
            this.resetGame();
            this.refreshBoard();
        } catch (err) {
            console.error(err);
            alert("Error parsing MIDI file. Please make sure it is a valid Standard MIDI File.");
        }
    },

    // .mxl (compressed MusicXML -- js/mxl.js) counterpart: unzips the archive to get the same
    // plain-text MusicXML loadMelodyFromMusicXML already knows how to load, rather than
    // duplicating any of its parsing/centering/key-detection logic. js/file-folder.js's fileTypes
    // dispatch (js/midi-folder.js) routes any .mxl file here with readAs:'arrayBuffer', since a
    // ZIP container is binary.
    loadMelodyFromMxl: async function(arrayBuffer, displayName) {
        try {
            const text = await Mxl.extractMusicXML(arrayBuffer);
            this.loadMelodyFromMusicXML(text, displayName);
        } catch (err) {
            console.error(err);
            alert('Error reading .mxl file. Please make sure it is a valid compressed MusicXML archive.');
        }
    },

    // MusicXML counterpart to loadMelodyFromArrayBuffer -- js/file-folder.js's fileTypes dispatch
    // (js/midi-folder.js) routes any .musicxml/.xml file here instead. Unlike MIDI, the key
    // signature is AUTHORED (parsed straight from the file's own <key><fifths>), not detected --
    // detectKeySignature is only a fallback for files that genuinely never declared one. No
    // extractMonophonicMelody step: this app's own MusicXML (js/musicxml.js's writer) is already
    // single-voice-plus-chords by construction, the same shape Compose already produces -- a real
    // multi-part external file with genuine polyphony is out of scope (docs/melody-notation-design.md's
    // "Explicitly excluded" list).
    loadMelodyFromMusicXML: function(text, displayName) {
        const filenameSpan = document.getElementById('melody-filename');
        try {
            const parsed = MusicXML.parse(text);
            if (!parsed || parsed.notes.length === 0) {
                alert('No notes found in the MusicXML file.');
                return;
            }
            const melodySeq = this.centerMelody(parsed.notes);
            this.state.melody = melodySeq;
            this.state.isRandom = false;
            this.state.melodyBPM = parsed.bpm;
            this.state.keySignature = parsed.keySignature != null
                ? parsed.keySignature
                : Tonnetz.detectKeySignature(melodySeq.map((n) => n.midi));
            if (filenameSpan && displayName) filenameSpan.textContent = displayName;
            this.resetGame();
            this.refreshBoard();
        } catch (err) {
            console.error(err);
            alert('Error parsing MusicXML file: ' + err.message);
        }
    },

    setupKeyboardEvents: function() {
        const svg = Render.svg;
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        window.onmousemove = (e) => {
            // Panning is just camera movement -- independent of whether the game is currently
            // auto-playing the intro or showing a "wrong note" mistake recovery (both set
            // isPlayingSequence). A click that plays the "wrong" note deliberately sets that
            // flag for ~1.2s (see handleUserInputNote's Mistake! branch) -- gating pan on it too
            // would leave a real player unable to drag the view for over a second after almost
            // any accidental wrong-note click, which is exactly the bug this fix is for.
            if (!isTouch && this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                // panView keeps the aspect-matched viewBox the draw used (a bare updateView would
                // reset it to the fixed 4:3 box and re-letterbox mid-drag). Read back the clamped
                // values so the next delta starts from where we actually are.
                const v = Render.panView(this.state.viewX, this.state.viewY, Render.zoom);
                this.state.viewX = v.viewX;
                this.state.viewY = v.viewY;
            }

            if (this.state.isPlayingPreview || this.state.isPlayingSequence) return;
            this.updateGhost(e);
        };

        window.onmouseup = () => {
            this.state.isPanning = false;
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

            if (!isTouch) {
                this.state.isPanning = true;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
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
        const statusEl = document.getElementById('melody-game-status');
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
        this.state.currentStreak = streak;
        const currentStreakEl = document.getElementById('melody-current-streak');
        if (currentStreakEl) {
            currentStreakEl.textContent = streak;
        }
        if (streak > this.state.bestStreak) {
            this.state.bestStreak = streak;
            localStorage.setItem('tonncade_melody_best', streak.toString());
        }
        this.updateStreakUI();
    },

    // Current/longest streak as a bar-graph (same pattern as Blast/Gravity/Snake, #79) -- the bar
    // fills toward your best, with the current and best counts beside it.
    updateStreakUI: function() {
        const bestStreakEl = document.getElementById('melody-best-streak');
        if (bestStreakEl) {
            bestStreakEl.textContent = this.state.bestStreak;
        }
        Render.setStatBar('melody-streak-fill', this.state.currentStreak, this.state.bestStreak);
    },

    // No persistence (localStorage) -- matches this control's own prior behavior as a plain
    // <select>, always defaulting to level 1 each session; Blast/Gravity's own barbell does
    // persist theirs, but changing that here would be an unrequested behavior change, not part
    // of just swapping the UI control to match their look.
    setDifficulty: function(level) {
        if (level < 1 || level > 3) return;
        this.state.difficulty = level;
        this.updateDifficultyUI();
    },

    // 4/4 assumed throughout (no time-signature parsing exists in this codebase -- out of
    // scope, see next_steps.md). Only meaningful for a real song (see state.melodyBPM).
    measureOf: function(timeSec) {
        const secondsPerMeasure = (60 / this.state.melodyBPM) * 4;
        return Math.floor(timeSec / secondsPerMeasure);
    },

    // Scrolls the timeline so the current note stays visible -- real songs only (Random's short
    // sliding window never overflows). Not called mid-drag; updateScrubDragTarget's own
    // edge-scroll owns scrollLeft while a drag is live, so the two don't fight over it.
    scrollTimelineToCurrent: function(idx) {
        const listEl = document.getElementById('melody-note-list');
        const token = listEl && listEl.querySelector(`.note-token[data-note-idx="${idx}"]`);
        if (!token) return;
        // #melody-notation-scroll (not listEl itself) is what actually scrolls/clips now -- one
        // shared scroll container for the staff/labels/timeline stack (Codex review finding: they
        // used to scroll independently and drift out of alignment). token.offsetLeft is still
        // correctly relative to listEl (offsetLeft isn't affected by an ancestor's scroll
        // position), and listEl sits flush against the scroll container's left edge (no
        // horizontal margin/padding between them), so that part of the math is unchanged --
        // only WHICH element's clientWidth/scrollLeft this reads/writes needed to move.
        const scrollEl = document.getElementById('melody-notation-scroll') || listEl;
        const target = token.offsetLeft - scrollEl.clientWidth / 2 + token.offsetWidth / 2;
        scrollEl.scrollLeft = Math.max(0, target);
    },

    updateDifficultyUI: function(overrideIndex) {
        const listEl = document.getElementById('melody-note-list');
        const diff = this.state.difficulty;

        // Clear old glows (past, generic future, and the three coloured upcoming glows)
        document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
        document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
        for (let r = 0; r < 3; r++) {
            document.querySelectorAll('.glow-next-' + r).forEach(el => el.classList.remove('glow-next-' + r));
        }

        if (!listEl) return;

        if (diff === 3 || this.state.melody.length === 0) {
            listEl.innerHTML = '';
            return;
        }

        const melody = this.state.melody;
        const current = (overrideIndex !== undefined) ? overrideIndex : this.state.userIndex;
        const pastOpacityByDistance = { 1: 0.85, 2: 0.55, 3: 0.3 };

        // Octave-qualified (e.g. "E4", not just "E") -- a big board renders the same note NAME
        // at several different octaves at once (see INV-25), so the bare letter name alone
        // doesn't say which specific cell/pitch is meant. Real bug report: playing the "wrong E"
        // -- an understandable mix-up between two different E's, not a matching-logic bug (exact
        // MIDI equality is the correct rule for a melody, where octave is part of the tune).
        const qualifiedName = (midi) => `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;

        // The next THREE to play each get their own colour, mirrored on the Tonnetz by
        // glow-next-0/1/2 (see css/style.css), so the upcoming notes read as linked between
        // board and timeline. No frequency here -- it isn't useful on the timeline, and the
        // octave-qualified names already disambiguate pitch (INV-25).
        const UPCOMING_COLORS = ['var(--accent)', '#e6b23c', '#d16a8f']; // next, 2nd, 3rd

        // {idx, html} per entry, oldest to newest -- kept as structured entries (not a flat
        // string) so each note token can carry a data-note-idx the drag/marker logic reads.
        // idx is null for a measure-tick entry (part 4), which is never a drag/marker target.
        let displayNotes = [];

        if (this.state.isRandom) {
            // Random is a memory-quiz sliding window forever -- no measures, no full timeline,
            // this isn't a piece to progress through (#46). Byte-for-byte the original behavior.
            const pastWindow = 3;
            const futureWindow = diff === 1 ? 4 : 0; // Current + 3 ahead

            for (let i = Math.max(0, current - pastWindow); i < current; i++) {
                const midi = melody[i].midi;
                const name = qualifiedName(midi);
                const distance = current - i;
                const opacity = pastOpacityByDistance[distance] || 0.3;
                displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="past" data-distance="${distance}" style="opacity: ${opacity};">${name}</span>` });
                document.querySelectorAll(`polygon[data-midi="${midi}"]`).forEach(p => p.classList.add('glow-past'));
            }

            if (diff === 1) {
                for (let i = current; i < Math.min(melody.length, current + futureWindow); i++) {
                    const midi = melody[i].midi;
                    const name = qualifiedName(midi);
                    const rank = i - current; // 0 = next, 1 = 2nd, 2 = 3rd, 3+ = further out
                    const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
                    if (rank <= 2) {
                        const color = UPCOMING_COLORS[rank];
                        const size = rank === 0 ? '1.1em' : '1em';
                        const weight = rank === 0 ? '900' : '700';
                        const role = rank === 0 ? 'current' : 'future';
                        displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="${role}" data-upcoming="${rank}" style="color: ${color}; font-size: ${size}; font-weight: ${weight};">${name}</span>` });
                        polygons.forEach(p => p.classList.add('glow-next-' + rank));
                    } else {
                        displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="future" style="opacity: 0.8;">${name}</span>` });
                        polygons.forEach(p => p.classList.add('glow-future'));
                    }
                }
            }
        } else {
            // #46: a real song renders EVERY note up front, not a small window -- a true
            // seek-bar, scrollable (css/style.css), with measure ticks (part 4) inserted between
            // notes whose computed measure differs. The current note is always highlighted
            // regardless of difficulty; only the "next 2" colored hints are difficulty-gated
            // (Easy/diff===1 only) -- Medium still shows every future note, just as plain dim
            // text with no hint, since the whole timeline is now always visible.
            let lastMeasure = null;
            for (let i = 0; i < melody.length; i++) {
                const measure = this.measureOf(melody[i].time);
                if (lastMeasure !== null && measure !== lastMeasure) {
                    displayNotes.push({ idx: null, html: '<span class="measure-tick" aria-hidden="true"></span>' });
                }
                lastMeasure = measure;

                const midi = melody[i].midi;
                const name = qualifiedName(midi);
                const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
                if (i < current) {
                    const distance = current - i;
                    const opacity = pastOpacityByDistance[distance] || 0.3;
                    displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="past" data-distance="${distance}" style="opacity: ${opacity};">${name}</span>` });
                    polygons.forEach(p => p.classList.add('glow-past'));
                } else if (i === current) {
                    displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="current" data-upcoming="0" style="color: ${UPCOMING_COLORS[0]}; font-size: 1.1em; font-weight: 900;">${name}</span>` });
                    polygons.forEach(p => p.classList.add('glow-next-0'));
                } else if (diff === 1 && i - current <= 2) {
                    const rank = i - current;
                    displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="future" data-upcoming="${rank}" style="color: ${UPCOMING_COLORS[rank]}; font-size: 1em; font-weight: 700;">${name}</span>` });
                    polygons.forEach(p => p.classList.add('glow-next-' + rank));
                } else {
                    displayNotes.push({ idx: i, html: `<span class="note-token" data-note-idx="${i}" data-note-role="future" style="opacity: 0.5;">${name}</span>` });
                }
            }
        }

        // Note tokens (+ measure ticks) only here -- the marker is positioned separately.
        // positionScrubMarker (below) repositions the SAME marker node afterward, since it also
        // runs mid-drag on its own, WITHOUT rebuilding these note-token spans (rebuilding them
        // via innerHTML here happens once per render; rebuilding the scrub marker's own DOM node
        // specifically must not happen mid-drag, or a real touchstart's captured target goes
        // stale -- see positionScrubMarker's own comment).
        listEl.innerHTML = displayNotes.map(n => n.html).join('');

        const markerIdx = this.state.isDraggingScrub ? this.state.scrubDragIndex : this.state.startIndex;
        this.positionScrubMarker(markerIdx);
        if (!this.state.isRandom && !this.state.isDraggingScrub) this.scrollTimelineToCurrent(current);

        // Grand-staff view (docs/melody-notation-design.md) -- renders exactly whatever's showing
        // in the timeline above (displayNotes, minus measure-tick entries which carry no idx),
        // so Random's small sliding window and a real song's whole timeline are handled uniformly
        // by construction, without duplicating either one's own windowing logic here.
        this.refreshStaff(displayNotes.filter((n) => n.idx !== null).map((n) => melody[n.idx]));
    },

    // A deliberately minimal first pass (docs/melody-notation-design.md) -- the lightweight
    // quantizer/speller/measure-inference is a separate, later piece; this just proves the
    // rendering pipeline against whatever's currently on the timeline.
    refreshStaff: function(notes) {
        if (typeof Notation === 'undefined') return;
        const result = Notation.render('melody-staff', notes, { bpm: this.state.melodyBPM, keySignature: this.state.keySignature });
        Notation.renderLabels('melody-staff-labels', result ? result.noteXPositions : [], this.state.keySignature);
    },

    // The scrub marker: a real I-beam (see css/style.css) absolutely positioned over the target
    // note, so it's visually clear which two notes you'd start between -- not a separate,
    // disconnected slider (see INV-26's original version). Only shown if that target note is
    // actually rendered AND there's more than one note reached so far (targetLength > 1) --
    // nothing to scrub to yet on the very first note.
    //
    // Reuses the SAME marker DOM node across calls (created once via appendChild, only ever
    // repositioned via style.left afterward -- never recreated) specifically so a live
    // touch-drag capture on it survives every reposition during the gesture -- found the hard
    // way via this project's own real-touch-event testing discipline: a full re-render
    // (innerHTML) mid-drag would detach whatever a real touchstart captured as its event target,
    // silently breaking the rest of the gesture. Mutating style.left on the same element
    // reference a capture already holds is safe; only innerHTML replacement of the marker
    // itself (never done here) would be the actual hazard.
    positionScrubMarker: function(targetIdx) {
        const listEl = document.getElementById('melody-note-list');
        if (!listEl) return;

        const tokens = Array.from(listEl.querySelectorAll('.note-token'));

        let marker = listEl.querySelector('.scrub-marker');
        const targetToken = tokens.find(t => parseInt(t.getAttribute('data-note-idx'), 10) === targetIdx);
        const showMarker = tokens.length > 0 && this.getMaxStartIndex() > 0 && !!targetToken;

        if (!showMarker) {
            if (marker) marker.remove();
            return;
        }
        if (!marker) {
            marker = document.createElement('span');
            marker.className = 'scrub-marker';
            marker.title = 'Drag to replay from here';
            listEl.appendChild(marker);
        }

        // offsetLeft is relative to listEl's own content box, not the viewport -- stable across
        // scroll position, unlike getBoundingClientRect() (see #46's scrollable timeline).
        // Clamped to 0 -- a negative left would sit outside the scroll container's clipped
        // content box (overflow-x: auto implicitly clips overflow-y too), making the marker
        // unclickable/invisible for the very first token (offsetLeft 0).
        marker.style.left = Math.max(0, targetToken.offsetLeft - 5) + 'px';
    },

    // Marks the drill as genuinely started -- checked by init() so a mere mode SWITCH (away and
    // back) never re-triggers this. Set unconditionally here (not just from init()'s own guard)
    // so every real reset path -- first entry, the explicit Restart button, loading a new song --
    // stays exactly as unconditional as it already was; only re-entering an ALREADY-started game
    // is newly guarded (see init()).
    resetGame: function() {
        this.state.gameStarted = true;
        this.cleanup();
        this.state.targetLength = 1;
        this.state.userIndex = 0;
        this.state.startIndex = 0;
        this.state.cleanStreak = 0;
        this.state.segmentHadMistake = false;
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
        this.state.segmentHadMistake = false; // fresh pass at this segment -- see handleUserInputNote
        this.setStatus("Listen to the notes...", "info");

        // Disable input -- repetition begins at startIndex, not always note 0 (see #46 scrub
        // control), so a player can drill any already-reached stretch of the melody.
        const start = this.state.startIndex;
        this.state.userIndex = start;

        let delayOffset = 0.5; // Initial delay before sequence starts playing

        for (let i = start; i < this.state.targetLength; i++) {
            const note = this.state.melody[i];
            if (!note) break;

            // Calculate timing relative to the first note IN THIS SEGMENT
            const relativeTime = note.time - this.state.melody[start].time;
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
        const lastRelativeTime = lastNote ? (lastNote.time - this.state.melody[start].time + lastNote.duration) : 1;
        const totalDuration = (lastRelativeTime * 1000) + (delayOffset * 1000);

        const tId2 = setTimeout(() => {
            this.state.isPlayingSequence = false;
            this.setStatus("Your turn! Repeat the notes.", "success");
            this.state.userIndex = start;
            this.updateDifficultyUI();
        }, totalDuration);

        this.state.playbackTimeoutIds.push(tId2);
    },

    // #46 scrub control: replay the drilled segment starting from any note already reached.
    // Clamped to [0, targetLength - 1] -- "anywhere you've already played," never ahead into
    // notes not yet drilled.
    getMaxStartIndex: function() {
        return Math.max(0, this.state.targetLength - 1);
    },

    seekTo: function(index) {
        if (this.state.isPlayingPreview) return;
        const clamped = Math.max(0, Math.min(index, this.getMaxStartIndex()));

        if (this.state.userRepeatTimeoutId) {
            clearTimeout(this.state.userRepeatTimeoutId);
            this.state.userRepeatTimeoutId = null;
        }
        if (this.state.mistakeTimeoutId) {
            clearTimeout(this.state.mistakeTimeoutId);
            this.state.mistakeTimeoutId = null;
        }

        // A player-initiated scrub to a different segment breaks the clean-streak (#46) -- it's
        // now drilling a different stretch of the song, not continuing the one the streak counted.
        // The internal auto-advance (handleUserInputNote) sets startIndex directly, not through
        // seekTo, so it's naturally exempt from this reset.
        if (clamped !== this.state.startIndex) this.state.cleanStreak = 0;

        this.state.startIndex = clamped;
        this.playTargetSequence();
    },

    // Drag disambiguation for the scrub marker (setupScrubMarker below) -- mirrors the
    // mousedown-tracks-then-mousemove-updates-then-mouseup-commits shape every other drag
    // gesture in this project already uses (Sandbox's ghost drag, Melody's own pan/pinch fix).
    setupScrubMarker: function() {
        const listEl = document.getElementById('melody-note-list');
        if (!listEl) return;
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        const startDrag = (clientX) => {
            this.state.isDraggingScrub = true;
            this.state.scrubDragIndex = this.state.startIndex;
            this.updateScrubDragTarget(clientX);
        };
        const moveDrag = (clientX) => {
            if (!this.state.isDraggingScrub) return;
            this.updateScrubDragTarget(clientX);
        };
        const endDrag = () => {
            if (!this.state.isDraggingScrub) return;
            this.state.isDraggingScrub = false;
            this.seekTo(this.state.scrubDragIndex);
        };

        listEl.addEventListener('mousedown', (e) => {
            if (isTouch) return;
            if (!e.target.classList.contains('scrub-marker')) return;
            e.preventDefault();
            startDrag(e.clientX);
        });
        window.addEventListener('mousemove', (e) => moveDrag(e.clientX));
        window.addEventListener('mouseup', endDrag);

        listEl.addEventListener('touchstart', (e) => {
            if (!e.target.classList.contains('scrub-marker')) return;
            e.preventDefault();
            startDrag(e.touches[0].clientX);
        }, { passive: false });
        listEl.addEventListener('touchmove', (e) => {
            if (!this.state.isDraggingScrub) return;
            e.preventDefault();
            moveDrag(e.touches[0].clientX);
        }, { passive: false });
        listEl.addEventListener('touchend', endDrag);
    },

    // While dragging, finds whichever rendered note token's horizontal center is closest to the
    // pointer and repositions the marker there via positionScrubMarker -- a live preview of
    // where the drag would land, WITHOUT a full note-list re-render (see that function's own
    // comment for why: it would detach whatever a real touchstart captured as its event target
    // mid-gesture). seekTo() on release re-renders for real once the drag is over.
    updateScrubDragTarget: function(clientX) {
        const listEl = document.getElementById('melody-note-list');

        // Edge-scroll (#46, real songs only -- Random's short window never overflows): nudge
        // scrollLeft while the pointer sits near either edge, driven by this function's own
        // per-mousemove/touchmove firing (no separate rAF loop needed). The closest-token lookup
        // below re-queries live getBoundingClientRect() positions every call, so it already
        // reflects wherever scrollLeft currently is -- no extra plumbing needed there.
        // #melody-notation-scroll (not listEl) is the actual clipping/scrolling viewport now --
        // see scrollTimelineToCurrent's identical comment. Using listEl's own rect/scrollLeft here
        // would read the full unclipped CONTENT extent instead of the visible viewport, breaking
        // edge detection entirely.
        const scrollEl = document.getElementById('melody-notation-scroll') || listEl;
        if (!this.state.isRandom && scrollEl) {
            const rect = scrollEl.getBoundingClientRect();
            const EDGE = 40; // px from either edge that triggers auto-scroll
            const MAX_SPEED = 12; // px per tick
            if (clientX < rect.left + EDGE) {
                scrollEl.scrollLeft -= MAX_SPEED * (1 - Math.max(0, clientX - rect.left) / EDGE);
            } else if (clientX > rect.right - EDGE) {
                scrollEl.scrollLeft += MAX_SPEED * (1 - Math.max(0, rect.right - clientX) / EDGE);
            }
        }

        const tokens = Array.from(document.querySelectorAll('#melody-note-list .note-token'));
        if (tokens.length === 0) return;

        let closest = tokens[0];
        let closestDist = Infinity;
        tokens.forEach(token => {
            const rect = token.getBoundingClientRect();
            const center = rect.left + rect.width / 2;
            const dist = Math.abs(clientX - center);
            if (dist < closestDist) {
                closestDist = dist;
                closest = token;
            }
        });

        const candidateIdx = parseInt(closest.getAttribute('data-note-idx'), 10);
        this.state.scrubDragIndex = Math.max(0, Math.min(candidateIdx, this.getMaxStartIndex()));
        this.positionScrubMarker(this.state.scrubDragIndex);
    },

    // Icon-only transport: ▶ when stopped (click plays the preview), ⏹ while playing (click
    // stops). Keep an English title/aria-label for accessibility and the tests; the visible label
    // is icon-only now (removes English UI text, per the i18n bias -- see task #77/#29).
    setPlayIcon: function(playing) {
        const btn = document.getElementById('melody-play-preview');
        if (!btn) return;
        btn.textContent = playing ? '⏹' : '▶';
        const label = playing ? 'Stop preview' : 'Play melody';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    },

    playPreview: function() {
        this.cleanup();
        this.state.isPlayingPreview = true;

        this.setPlayIcon(true);

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

        this.setPlayIcon(false);

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
                document.getElementById('melody-note-list').innerHTML = '';
                document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
                document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
                this.celebrate();
                return;
            }

            if (this.state.userIndex >= this.state.targetLength) {
                // User has repeated the target sequence and can keep going ahead!
                this.setStatus("Correct! Go ahead! (2s timeout)...", "going-ahead");

                // #46 spaced-repetition auto-advance (songs only): reaching here with no mistake
                // since playTargetSequence's own last call is a complete clean pass of the
                // current segment. After 3 in a row, advance the drilled segment to the next
                // measure instead of just +1 note, and reset the streak.
                if (!this.state.isRandom && !this.state.segmentHadMistake) {
                    this.state.cleanStreak++;
                    if (this.state.cleanStreak >= 3) {
                        const startMeasure = this.measureOf(this.state.melody[this.state.startIndex].time);
                        let nextIdx = this.state.startIndex;
                        while (nextIdx < this.state.melody.length && this.measureOf(this.state.melody[nextIdx].time) <= startMeasure) {
                            nextIdx++;
                        }
                        if (nextIdx < this.state.melody.length) {
                            // Advancing INTO the next measure moves startIndex past whatever's
                            // currently drilled -- unlike a scrub (which only ever moves the
                            // start EARLIER within already-established territory), this needs
                            // targetLength to grow to cover it too, or the existing "startIndex
                            // always <= targetLength - 1" invariant (see state.startIndex) breaks.
                            this.state.startIndex = nextIdx;
                            if (this.state.targetLength <= nextIdx) {
                                this.state.targetLength = nextIdx + 1;
                            }
                        }
                        this.state.cleanStreak = 0;
                    }
                }

                this.state.userRepeatTimeoutId = setTimeout(() => {
                    // Timeout fired: User stopped playing ahead.
                    // Random has no spaced-repetition concept (#46 scopes cleanStreak to songs
                    // only) -- grow by however far they got, same as always. For a song, growth
                    // ONLY ever happens via the cleanStreak>=3 block above (a whole measure); below
                    // that threshold, targetLength/startIndex are deliberately left untouched here
                    // so playTargetSequence() below re-drills the SAME segment again. Previously
                    // this unconditionally grew by one note after every single clean pass
                    // regardless of cleanStreak, silently advancing the whole time and defeating
                    // the point of counting a streak at all (reported live: "the number of times
                    // you have to get it right to advance seems to be 1").
                    if (this.state.isRandom) {
                        this.state.targetLength = this.state.userIndex + 1;
                    }
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
            this.state.segmentHadMistake = true;
            this.state.cleanStreak = 0;

            // If the user made progress up to or beyond the current target,
            // advance the target to show the correct version of the note they missed.
            if (this.state.userIndex >= this.state.targetLength) {
                this.state.targetLength = this.state.userIndex + 1;
            }
            this.state.userIndex = this.state.startIndex;
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
                if (App.currentMode === 'melody' && !this.state.isPlayingPreview) {
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

        this.setPlayIcon(false);

        // Remove any visual cell highlights
        document.querySelectorAll('.active-note').forEach(el => el.classList.remove('active-note'));
        document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
        document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
        const listEl = document.getElementById('melody-note-list');
        if (listEl) listEl.innerHTML = '';
    },

    refreshBoard: function() {
        // Render the full Sandbox Tonnetz layout. -26..26: wide enough that zooming out to
        // Render.MAX_ZOOM never reveals blank space past the drawn edge (matches Sandbox/Life).
        const viewport = {
            minP: -26, maxP: 26,
            minQ: -26, maxQ: 26
        };
        Render.drawLattice(viewport, { keySignature: this.state.keySignature });
        // Reads back the player's own pan position (see setupKeyboardEvents/state.viewX/viewY),
        // not a fixed default -- otherwise every redraw (resetGame, loading a new melody,
        // rotating the view) would silently discard wherever the player last panned to,
        // matching a real report: rotating moved melodies off-screen with no way to pan back,
        // since panning didn't exist here at all until now. Same reasoning for zoom (null until
        // the first draw, then persisted -- see main.js's applyZoomDelta): a redraw must never
        // silently reset a zoom the player set via wheel/pinch back to the responsive default.
        this.state.zoom = this.state.zoom || Render.getResponsiveZoom();
        const v = Render.panView(this.state.viewX, this.state.viewY, this.state.zoom);
        this.state.viewX = v.viewX;
        this.state.viewY = v.viewY;
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
        const defaultTempo = this.DEFAULT_TEMPO_USEC_PER_BEAT;

        function tickToSec(tick) {
            let sec = 0;
            let lastTick = 0;
            let lastTempo = defaultTempo;
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

        // Effective BPM for the whole song (#46 part 4, measure ticks): first tempo event if the
        // file has one, else the shared default -- assumes 4/4 (no time-signature parsing exists
        // in this codebase, genuinely out of scope). Additive to this return shape; js/compose.js
        // only reads .notes from its own call into this function, so this is a safe addition.
        const effectiveTempo = tempoChanges.length > 0 ? tempoChanges[0].tempo : defaultTempo;
        const bpm = 60000000 / effectiveTempo;

        return { notes: timedNotes, bpm: bpm };
    },

    // Standard MIDI File writer -- the inverse of parseMIDI/tickToSec above, for Compose mode's
    // Save. Single track, format 0. Without an explicit tempoBPM (task #52's quantized recordings
    // pass one; ordinary unquantized recordings don't), emits NO tempo meta event: parseMIDI's
    // tickToSec already defaults to 500000 usec/beat (120bpm) whenever no tempo change is
    // present, so omitting one here keeps parseMIDI(writeMIDI(x)) an exact round trip at the
    // fixed WRITE_TICKS_PER_BEAT resolution, not just an equivalent-sounding one -- this is the
    // ONLY behavior for any existing caller that doesn't pass tempoBPM.
    WRITE_TICKS_PER_BEAT: 480,
    // Shared 120bpm/500000usec-per-beat default -- also read by parseMIDI's tickToSec (above) as
    // its own no-tempo-event fallback, so the two stay in sync via one shared constant instead of
    // two independently-hardcoded 500000 literals kept matched only by comment (same
    // consolidation pattern as the difficulty-barbell hoist, see docs/invariants.md's INV-49).
    DEFAULT_TEMPO_USEC_PER_BEAT: 500000, // 120bpm

    writeMIDI: function(melodySeq, tempoBPM) {
        const usecPerBeat = tempoBPM ? Math.round(60000000 / tempoBPM) : this.DEFAULT_TEMPO_USEC_PER_BEAT;
        const ticksPerSec = this.WRITE_TICKS_PER_BEAT * (1000000 / usecPerBeat);

        const events = [];
        melodySeq.forEach(note => {
            events.push({ tick: Math.round(note.time * ticksPerSec), type: 'on', midi: note.midi });
            events.push({ tick: Math.round((note.time + note.duration) * ticksPerSec), type: 'off', midi: note.midi });
        });
        // Note-offs before note-ons at the same tick, so a note ending exactly when the next
        // begins never reads as a (however briefly) overlapping pair of the same pitch.
        events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

        function writeVarInt(value) {
            const out = [value & 0x7f];
            value = Math.floor(value / 128);
            while (value > 0) {
                out.unshift((value & 0x7f) | 0x80);
                value = Math.floor(value / 128);
            }
            return out;
        }

        const trackBytes = [];
        let lastTick = 0;
        if (tempoBPM) {
            // A real tempo meta event, so a reader (including our own parseMIDI/tickToSec) knows
            // the actual BPM instead of silently relying on the same fixed default this writer
            // otherwise assumes implicitly. WRITE_TICKS_PER_BEAT (480) is divisible by both 32
            // and 3, so every grid unit task #52's quantizer supports (straight down to 1/32,
            // triplet down to 1/6) lands on an exact integer tick count -- no rounding drift from
            // the tempo/PPQN choice itself, only from the quantize step's own rounding.
            trackBytes.push(...writeVarInt(0), 0xff, 0x51, 0x03, (usecPerBeat >> 16) & 0xff, (usecPerBeat >> 8) & 0xff, usecPerBeat & 0xff);
        }
        events.forEach(ev => {
            trackBytes.push(...writeVarInt(ev.tick - lastTick));
            lastTick = ev.tick;
            trackBytes.push(ev.type === 'on' ? 0x90 : 0x80, ev.midi, ev.type === 'on' ? 100 : 0);
        });
        trackBytes.push(...writeVarInt(0), 0xff, 0x2f, 0x00); // End of track meta event

        const trackLength = trackBytes.length;
        const bytes = [
            0x4d, 0x54, 0x68, 0x64, // "MThd"
            0x00, 0x00, 0x00, 0x06, // header chunk length = 6
            0x00, 0x00,             // format 0
            0x00, 0x01,             // 1 track
            (this.WRITE_TICKS_PER_BEAT >> 8) & 0xff, this.WRITE_TICKS_PER_BEAT & 0xff,
            0x4d, 0x54, 0x72, 0x6b, // "MTrk"
            (trackLength >>> 24) & 0xff, (trackLength >>> 16) & 0xff, (trackLength >>> 8) & 0xff, trackLength & 0xff,
            ...trackBytes
        ];
        return new Uint8Array(bytes).buffer;
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
