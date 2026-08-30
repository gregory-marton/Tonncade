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

// Melody's own file source (js/file-folder.js): the bundled midi/ songs plus a local folder the
// player sets once. Used to be one instance shared with Compose (js/midi-folder.js's MidiFolder,
// now deleted) so the two modes "browsed together" -- but that meant `currentValue` (which file
// is CURRENTLY SELECTED) was the same mutable object both modes read and wrote, a direct INV-48
// violation ("no shared mutable state between modes"): picking a real song in Melody silently
// carried it into Compose's own dropdown instead of Compose's own "Record your own…" default
// (reported live). Split into two independent instances, one per mode -- each still browses (and
// remembers) the SAME underlying folder, since FileFolder's IndexedDB persistence
// (DB_NAME/STORE_NAME/HANDLE_KEY) is declared at the shared namespace level, not per-instance;
// only the per-mode SELECTION state (currentValue/fileHandles) is no longer shared.
const MelodyFolder = FileFolder.create({
    onlineIndexUrl: './midi/index.json',
    bundledPathPrefix: './midi/',
    // All three listable/browsable in the SAME folder -- MusicXML is the canonical format going
    // forward (docs/melody-notation-design.md), MIDI stays a fully-supported import for files that
    // already exist, and .mxl (compressed MusicXML -- a ZIP container, js/mxl.js) is the format
    // real notation software (MuseScore, Finale, Sibelius) actually exports by default.
    // extensionPattern governs the LOCAL FOLDER listing filter; the bundled online tier's own
    // files are whatever midi/index.json says regardless of this regex.
    extensionPattern: /\.(midi?|musicxml|mxl|xml)$/i,
    readAs: 'arrayBuffer',              // default for anything NOT matched by fileTypes below (.mid)
    mimeType: 'audio/midi',
    loadMethod: 'loadMelodyFromArrayBuffer',
    fileTypes: [
        { pattern: /\.musicxml$/i, readAs: 'text', loadMethod: 'loadMelodyFromMusicXML' },
        { pattern: /\.xml$/i, readAs: 'text', loadMethod: 'loadMelodyFromMusicXML' },
        { pattern: /\.mxl$/i, readAs: 'arrayBuffer', loadMethod: 'loadMelodyFromMxl' },
    ],
    autoLoadFirstBundled: false,
});

const MelodyMode = {
    // Recovery starts promptly, then gives a learner progressively more time to inspect and
    // remember the target after repeated mistakes. The cap prevents an accidental long pause from
    // becoming a dead end; these are deliberately named constants so a future learner preference
    // can replace them without changing matching behavior.
    RECOVERY_BASE_DELAY_MS: 1200,
    RECOVERY_MAX_DELAY_MS: 4800,
    SILENCE_BEFORE_REPROMPT_MS: 700,
    PROMPT_SLOW_FACTORS: [1, 2, 3, 4],
    TIMING_TOLERANCE_MS: { 2: 350, 3: 150 },
    state: {
        melody: [],            // List of { midi, time, duration }
        // Set explicitly at both load sites (loadDefault/loadMelodyFromArrayBuffer) -- never
        // inferred from #melody-filename's text or MelodyFolder.currentValue, which would couple
        // this file to file-folder.js internals. Random is a memory-quiz sliding window forever
        // (no measures, no auto-advance -- it isn't a piece to progress through, #46); every
        // other branch below reads this flag to pick the Random path or the full-song path.
        isRandom: true,
        // Effective BPM for the CURRENT state.melody -- only meaningful (and only read) when
        // !isRandom. Assume 4/4 throughout (no time-signature parsing exists in this codebase --
        // out of scope). Used by measureOf() for the Timeline's barline overlay (#46) and the
        // start marker's own measure-mastery streak (INV-26).
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
        // INV-26: the drilled segment is [startIndex, endIndex], BOTH INCLUSIVE -- endIndex IS
        // the last included note's index (not a count/exclusive bound the way the old
        // targetLength was), symmetric with startIndex and matching how the Timeline's end
        // marker visually sits on a specific note, same as the start marker.
        endIndex: 0,
        userIndex: 0,          // Current progress of user in repeating the sequence
        matchedChordNotes: [], // Absolute note indices already supplied for the current onset event
        pendingUserNotes: [],   // MIDI/UI notes played while Melody is demonstrating a target
        extraNotes: [],         // Extra pitches heard during the active practice attempt
        liveInputNotes: new Set(), // MIDI pitches currently held by the learner
        notePerformance: {},   // note index -> { correct, misses }; retained for the active song
        mistakeFlashNotes: {}, // note index -> expiry timestamp for brief red staff feedback
        timingPerformance: {}, // note index -> early/on-time/late, enabled above Easy
        lastPracticeInputAt: null,
        lastPracticeEventStart: null,
        startIndex: 0,         // Where the drilled segment begins -- always <= endIndex, letting
                                // a player replay from any note already reached instead of
                                // always from note 0.
        // INV-26/53: the two ends auto-advance independently. endIndex grows immediately on
        // every correct play that reaches new territory (see handleUserInputNote) -- no streak
        // involved. startIndex jumps forward past every CONSECUTIVE measure (starting from
        // wherever it currently sits) that's individually been played cleanly through to ITS
        // OWN end `k`=3 times, stopping at the first one that hasn't yet -- not always exactly
        // one measure at a time (reported live: playing a 2-measure stretch cleanly 3 times
        // should skip both, not require separately re-proving the second one). Each measure's
        // count lives independently in measureCleanStreak (keyed by measureOf(...) -- see
        // handleUserInputNote), so a mistake only zeroes the ONE measure the wrong note actually
        // fell in; every other measure's already-banked progress (earlier OR later) is
        // untouched. Not reset by cleanup()/init()'s resume branch, so it survives a mode switch
        // away and back for free (INV-48), same as endIndex/userIndex/startIndex already do.
        measureCleanStreak: {},
        isPlayingPreview: false,
        isPlayingSequence: false,
        playbackTimeoutIds: [],// Scheduled timeouts for preview/sequence playback
        userRepeatTimeoutId: null, // Timer for "going ahead" (2s timeout)
        mistakeTimeoutId: null,    // Timer for showing sequence again on mistake
        waitingForSilence: false,  // Mistake recovery waits here without blocking child input
        lastUserInputAt: null,
        mistakeRetryCount: 0,
        lastMistakeDelayMs: 0,
        promptSlowFactor: 1,
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
        return [{ midi: 60 + Math.floor(Math.random() * 12), time: 0, duration: 0.4 }];
    },

    appendRandomEvent: function() {
        const previous = this.state.melody[this.state.melody.length - 1];
        this.state.melody.push({
            midi: 60 + Math.floor(Math.random() * 12),
            time: previous ? previous.time + 0.5 : 0,
            duration: 0.4,
        });
        this.state.endIndex = this.state.melody.length - 1;
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
        // midi/ folder (populated async by MelodyFolder) replaces this with a real song when a
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
            // endIndex/userIndex/startIndex/the streak, so rebuilding the note list/ghost/streak
            // bar from that untouched progress is enough to make the resume look exactly like
            // nothing happened.
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
                // uses (MelodyFolder.resolveFileType) -- this fallback picker (Safari/Firefox, or
                // Chrome before a folder's been chosen) needs to route .musicxml/.xml/.mxl to
                // their own loaders too, not just .mid. Reusing it here instead of duplicating the
                // pattern match is what a fix for "the direct picker only understands MIDI" (an
                // earlier gap in this file, caught by Codex's review) actually requires -- widening
                // the <input accept> alone wouldn't have been enough, since this handler still
                // would have force-fed the wrong bytes into the MIDI parser.
                const { readAs, loadMethod } = MelodyFolder.resolveFileType(file.name);
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

        // The shared Timeline (INV-55, js/timeline.js) -- Melody's own practice-strip decoration
        // (color hints, Tonnetz glow) is layered on in updateDifficultyUI via the decorate hook,
        // not here. onStartCommit mirrors the old scrub marker's seekTo commit; onEndCommit lets
        // the player drag the end forward directly, same as the existing auto-advance does
        // (INV-26 -- no gate on either).
        this.timeline = Timeline.create({
            staffContainerId: 'melody-staff',
            labelsContainerId: 'melody-staff-labels',
            scrollContainerId: 'melody-notation-scroll',
            onStartCommit: (idx) => this.seekTo(idx),
            onEndCommit: (idx) => {
                // The real invariant is endIndex >= startIndex + 1, always -- <= here (not just
                // <), so dragging end to land EXACTLY ON the current start also pushes the start
                // back, not just past it. Symmetric with seekTo's own push-the-end-forward.
                // Doesn't touch measureCleanStreak -- each measure's own banked credit is a
                // historical record independent of where the drilled segment currently sits.
                if (idx <= this.state.startIndex) {
                    this.state.startIndex = Math.max(0, idx - 1);
                }
                this.state.endIndex = idx;
                this.updateDifficultyUI();
            },
        });
        this.timeline.setupDrag();

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

        if (typeof MelodyFolder !== 'undefined') {
            MelodyFolder.setup(this, {
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

            // Center notes in the viewport octave range
            // Keep every parsed note. A monophonic passage is simply a sequence with one note at
            // each onset; simultaneous notes are chord members and must remain available to
            // Melody's event-aware matcher (MIDI is polyphonic, issue #46).
            const melodySeq = this.centerMelody(parsed.notes);

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

        window.onmousemove = (e) => {
            // Panning is just camera movement -- independent of whether the game is currently
            // auto-playing the intro or showing a "wrong note" mistake recovery (both set
            // isPlayingSequence). A click that plays the "wrong" note deliberately sets that
            // flag for ~1.2s (see handleUserInputNote's Mistake! branch) -- gating pan on it too
            // would leave a real player unable to drag the view for over a second after almost
            // any accidental wrong-note click, which is exactly the bug this fix is for.
            if (!Render.wasRecentlyTouched() && this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                // panView keeps the aspect-matched viewBox the draw used (a bare updateView would
                // reset it to the fixed 4:3 box and re-letterbox mid-drag). Read back the clamped
                // values so the next delta starts from where we actually are. this.state.zoom, not
                // Render.zoom (a global "whatever was last rendered ANYWHERE") -- the two can
                // easily differ, and using the wrong one snapped the view to a different zoom
                // level on the very first move event of a drag (reported live: "dragging zoomed
                // out instead of dragging... even a tiny drag zoomed out a lot").
                const v = Render.panView(this.state.viewX, this.state.viewY, this.state.zoom);
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

            if (!Render.wasRecentlyTouched()) {
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
        this.state.liveInputNotes.add(midi);
        Render.highlightByMidi(midi, 250);
        Synth.playNote(midi);
        this.renderLiveInputNotes();
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
                if (this._activeHighlight && this._activeHighlight.p === p && this._activeHighlight.q === q) {
                    this._activeHighlight = null;
                }
            }, duration);
        }
        // Tracked separately from the polygon's own timeout so a resize-triggered refreshBoard
        // (main.js's ResizeObserver on #game-container -- e.g. the drawer auto-collapsing on the
        // very first board tap) can re-apply the highlight to the freshly redrawn polygon; a
        // full redraw creates new elements, silently discarding the class (and pending timeout)
        // on the old one. See restoreHighlightIfActive below.
        this._activeHighlight = { p, q, expiresAt: Date.now() + duration };
    },

    // Called after a resize-triggered refreshBoard (see js/main.js's ResizeObserver) --
    // refreshBoard rebuilds the lattice's polygon elements from scratch, which would otherwise
    // silently drop an in-flight highlightCell flash mid-animation. No-ops once the highlight's
    // own duration has actually elapsed.
    restoreHighlightIfActive: function() {
        const h = this._activeHighlight;
        if (!h || Date.now() >= h.expiresAt) return;
        this.highlightCell(h.p, h.q, h.expiresAt - Date.now());
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

    performanceColor: function(index) {
        const stats = this.state.notePerformance[index];
        if (!stats || (!stats.correct && !stats.misses)) return null;
        if (stats.misses > 0 && stats.correct === 0) return '#e05a4f';
        if (stats.misses > 0) return '#f0a35e';
        if (stats.correct >= 4) return '#36d46b';
        if (stats.correct >= 2) return '#89d68a';
        return '#e6d36a';
    },

    recordNotePerformance: function(index, kind) {
        const stats = this.state.notePerformance[index] || { correct: 0, misses: 0 };
        stats[kind]++;
        this.state.notePerformance[index] = stats;
    },

    flashMistakeNotes: function(indices) {
        const expiresAt = Date.now() + 450;
        indices.forEach((index) => { this.state.mistakeFlashNotes[index] = expiresAt; });
        this.updateDifficultyUI();
        setTimeout(() => {
            indices.forEach((index) => {
                if (this.state.mistakeFlashNotes[index] <= Date.now()) delete this.state.mistakeFlashNotes[index];
            });
            this.updateDifficultyUI();
        }, 460);
    },

    // Draw a soft, non-interactive column over the current event and a few following events. The
    // boundaries come from Timeline's own VexFlow x readback, so this cue stays aligned with the
    // staff, pitch row, and marker stack instead of maintaining a second layout calculation.
    updateCurrentEventRegions: function(index) {
        const scroll = document.getElementById('melody-notation-scroll');
        if (!scroll) return;
        scroll.querySelectorAll('.melody-current-event-region').forEach((el) => el.remove());
        if (index == null || !this.timeline || !this.timeline._lastRender) return;
        const positions = this.timeline._lastRender.noteXPositions || [];
        const byId = new Map(positions.map((entry) => [entry.id, entry]));
        let eventStart = index;
        for (let rank = 0; rank < 4 && eventStart < this.state.melody.length; rank++) {
            const event = this.getEventBounds(eventStart);
            const first = byId.get(event.start);
            const next = byId.get(event.end);
            const last = byId.get(event.end - 1) || first;
            if (!first) break;
            const left = Math.max(0, first.x - 16);
            const right = next ? next.x - 16 : last.x + 32;
            if (right > left) {
                const region = document.createElement('div');
                region.className = 'melody-current-event-region';
                region.dataset.eventRank = String(rank);
                region.style.left = left + 'px';
                region.style.width = (right - left) + 'px';
                region.style.opacity = String(rank === 0 ? 0.18 : 0.1 / rank);
                scroll.appendChild(region);
            }
            eventStart = event.end;
        }
    },

    // Show held learner pitches on the staff without replacing the target notation. The x anchor
    // is the current event; the y position is computed from the active clef's actual staff bounds.
    renderLiveInputNotes: function() {
        const staff = document.getElementById('melody-staff');
        if (!staff || !this.timeline || !this.timeline._lastRender) return;
        staff.querySelectorAll('.melody-live-note').forEach((el) => el.remove());
        staff.style.position = 'relative';
        const current = this.getEventBounds(this.state.userIndex).start;
        const anchor = this.timeline._lastRender.noteXPositions.find((entry) => entry.id === current)
            || this.timeline._lastRender.noteXPositions[0];
        if (!anchor) return;
        const bounds = this.timeline._lastRender.staveBounds;
        this.state.liveInputNotes.forEach((midi) => {
            const clef = midi >= (Notation.CLEF_SPLIT_MIDI || 60) ? 'treble' : 'bass';
            const y = Notation.staffYForMidi(midi, clef, bounds, this.state.keySignature);
            if (y == null) return;
            const note = document.createElement('span');
            note.className = 'melody-live-note';
            note.dataset.midi = String(midi);
            note.textContent = Tonnetz.getNoteName(midi, this.state.keySignature) + Tonnetz.getOctave(midi);
            note.style.left = (anchor.x + 3) + 'px';
            note.style.top = (y - 13) + 'px';
            staff.appendChild(note);
        });
    },

    releaseUserNoteByMidi: function(midi) {
        this.state.liveInputNotes.delete(midi);
        this.renderLiveInputNotes();
    },

    // 4/4 assumed throughout (no time-signature parsing exists in this codebase -- out of
    // scope, see next_steps.md). Only meaningful for a real song (see state.melodyBPM).
    measureOf: function(timeSec) {
        const secondsPerMeasure = (60 / this.state.melodyBPM) * 4;
        return Math.floor(timeSec / secondsPerMeasure);
    },

    // Melody's practice strip (docs/invariants.md INV-25/55): the shared Timeline (staff +
    // aligned pitch row + two draggable markers) plus this mode's own past/current/upcoming
    // color hints and Tonnetz glow-linkage, layered on via Notation.renderLabels' decorate hook
    // (js/notation.js) instead of building a second, separate HTML list the way the old
    // #melody-note-list did.
    updateDifficultyUI: function(overrideIndex) {
        const diff = this.state.difficulty;

        // Clear old glows (past, generic future, and the three coloured upcoming glows)
        document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
        document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
        for (let r = 0; r < 3; r++) {
            document.querySelectorAll('.glow-next-' + r).forEach(el => el.classList.remove('glow-next-' + r));
        }
        Render.clearCurrentNoteMarkers();

        if (this.state.melody.length === 0) {
            this.timeline.refresh([], { bpm: this.state.melodyBPM, keySignature: this.state.keySignature });
            return;
        }

        const melody = this.state.melody;
        // Keep a stale cursor harmless while a song is being replaced or a test/consumer is
        // restoring state. The Timeline cannot render an event outside the loaded melody.
        const requestedCurrent = (overrideIndex !== undefined) ? overrideIndex : this.state.userIndex;
        const current = Math.max(0, Math.min(requestedCurrent, melody.length - 1));
        const currentEvent = this.getEventBounds(current);
        const pastOpacityByDistance = { 1: 0.85, 2: 0.55, 3: 0.3 };
        // The next THREE to play each get their own colour, mirrored on the Tonnetz by
        // glow-next-0/1/2 (see css/style.css), so the upcoming notes read as linked between
        // board and pitch row.
        const UPCOMING_COLORS = ['var(--accent)', '#e6b23c', '#d16a8f']; // next, 2nd, 3rd

        // decorations[melody index] = the {className, style, data} Notation.renderLabels' own
        // decorate hook applies to that note's pitch-row label -- built in the same per-note
        // loop this function always used, just feeding the shared Timeline instead of building a
        // second HTML list.
        const decorations = {};
        const decorate = (entry) => {
            const base = decorations[entry.id] || {};
            const stats = this.state.notePerformance[entry.id];
            const timing = this.state.timingPerformance[entry.id];
            const flashing = this.state.mistakeFlashNotes[entry.id] > Date.now();
            const color = flashing ? '#ff5b5b' : this.performanceColor(entry.id);
            if (color) base.style = Object.assign({}, base.style, { color });
            if (stats || flashing) {
                base.data = Object.assign({}, base.data, {
                    'note-status': flashing ? 'miss' : (stats.misses > 0 ? 'mixed' : 'correct'),
                });
            }
            if (timing) {
                base.data = Object.assign({}, base.data, { 'note-timing': timing });
            }
            return base;
        };
        // The same per-note performance color reaches VexFlow's notehead/stem and the aligned
        // pitch-row label. A flashing miss temporarily overrides the accumulated color.
        const decorateNote = (entry) => {
            const flashing = this.state.mistakeFlashNotes[entry.id] > Date.now();
            const color = flashing ? '#ff5b5b' : this.performanceColor(entry.id);
            return color ? { style: { fillStyle: color, strokeStyle: color } } : null;
        };
        let notesForTimeline;
        let startIndex = this.state.startIndex;
        let endIndex = this.state.endIndex;

        if (this.state.isRandom) {
            // Random is Simon over a growing prefix, not a moving content window. Keep every
            // generated event in the shared scrollable Timeline and keep the logical start at 0.
            const windowStart = 0;
            const windowEnd = melody.length;
            notesForTimeline = melody.map((note, i) => Object.assign({}, note, { id: i }));

            const pastEnd = Math.min(current, melody.length);
            for (let i = 0; i < pastEnd; i++) {
                const midi = melody[i].midi;
                const distance = current - i;
                const opacity = pastOpacityByDistance[distance] || 0.3;
                decorations[i] = { style: { opacity: String(opacity) }, data: { 'note-role': 'past', distance: String(distance) } };
                document.querySelectorAll(`polygon[data-midi="${midi}"]`).forEach(p => p.classList.add('glow-past'));
            }
            for (let i = current; i < melody.length; i++) {
                const midi = melody[i].midi;
                const rank = i - current;
                const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
                if (i === current) {
                    decorations[i] = {
                        style: { color: UPCOMING_COLORS[0], fontSize: '1.1em', fontWeight: '900' },
                        data: { 'note-role': 'current', upcoming: '0' },
                    };
                    polygons.forEach(p => p.classList.add('glow-next-0'));
                    Render.markCurrentNote(polygons);
                } else if (diff === 1 && rank <= 3) {
                    decorations[i] = {
                        style: { color: UPCOMING_COLORS[Math.min(rank, 2)], fontSize: '1em', fontWeight: '700' },
                        data: { 'note-role': 'future', upcoming: String(rank) },
                    };
                    polygons.forEach(p => p.classList.add('glow-next-' + Math.min(rank, 2)));
                } else {
                    decorations[i] = { style: { opacity: '0.5' }, data: { 'note-role': 'future' } };
                }
            }
            startIndex = 0;
            endIndex = windowEnd - 1;
        } else {
            // #46: a real song renders EVERY note up front, not a small window -- the whole
            // piece, scrollable (css/style.css). Measure boundaries are the barline overlay's
            // job now (Task #12), not a separate tick entry threaded through this list. The
            // current note is always highlighted regardless of difficulty; only the "next 2"
            // colored hints are difficulty-gated (Easy/diff===1 only).
            notesForTimeline = melody.map((n, i) => Object.assign({}, n, { id: i }));
            for (let i = 0; i < melody.length; i++) {
                const midi = melody[i].midi;
                const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
                if (i < current) {
                    const distance = current - i;
                    const opacity = pastOpacityByDistance[distance] || 0.3;
                    decorations[i] = { style: { opacity: String(opacity) }, data: { 'note-role': 'past', distance: String(distance) } };
                    polygons.forEach(p => p.classList.add('glow-past'));
                } else if (i >= currentEvent.start && i < currentEvent.end) {
                    decorations[i] = {
                        style: { color: UPCOMING_COLORS[0], fontSize: '1.1em', fontWeight: '900' },
                        data: { 'note-role': 'current', upcoming: '0' },
                    };
                    polygons.forEach(p => p.classList.add('glow-next-0'));
                    if (i === currentEvent.start) Render.markCurrentNote(polygons);
                } else if (diff === 1 && i - currentEvent.end <= 2) {
                    const rank = i - currentEvent.end;
                    decorations[i] = {
                        style: { color: UPCOMING_COLORS[rank], fontSize: '1em', fontWeight: '700' },
                        data: { 'note-role': 'future', upcoming: String(rank) },
                    };
                    polygons.forEach(p => p.classList.add('glow-next-' + rank));
                } else {
                    decorations[i] = { style: { opacity: '0.5' }, data: { 'note-role': 'future' } };
                }
            }
        }

        this.timeline.refresh(notesForTimeline, {
            bpm: this.state.melodyBPM,
            keySignature: this.state.keySignature,
            startIndex,
            endIndex,
            decorate,
            decorateNote,
            showBarlines: !this.state.isRandom,
        });
        this.updateCurrentEventRegions(current);
        this.renderLiveInputNotes();
        // Both authored songs and Random render their complete current sequence/prefix, so
        // playback may pull the shared viewport along with the current event.
        this.timeline.scrollToCurrent(current);
    },

    // Marks the drill as genuinely started -- checked by init() so a mere mode SWITCH (away and
    // back) never re-triggers this. Set unconditionally here (not just from init()'s own guard)
    // so every real reset path -- first entry, the explicit Restart button, loading a new song --
    // stays exactly as unconditional as it already was; only re-entering an ALREADY-started game
    // is newly guarded (see init()).
    resetGame: function() {
        this.state.gameStarted = true;
        this.cleanup();
        // Authored songs start at [0, 1] when possible so the two moveable markers do not
        // coincide. Random starts at [0, 0] because its prefix begins with one event and grows
        // from the fixed logical start at zero.
        this.state.endIndex = this.state.isRandom
            ? 0
            : Math.min(1, Math.max(0, this.state.melody.length - 1));
        this.state.userIndex = 0;
        this.state.startIndex = 0;
        this.state.measureCleanStreak = {};
        this.state.matchedChordNotes = [];
        this.state.pendingUserNotes = [];
        this.state.extraNotes = [];
        this.state.liveInputNotes = new Set();
        this.state.notePerformance = {};
        this.state.mistakeFlashNotes = {};
        this.state.timingPerformance = {};
        this.state.lastPracticeInputAt = null;
        this.state.lastPracticeEventStart = null;
        this.state.lastUserInputAt = null;
        this.state.waitingForSilence = false;
        this.state.mistakeRetryCount = 0;
        this.state.lastMistakeDelayMs = 0;
        this.updateStreak(0);
        this.updateGhost();
        this.updateDifficultyUI();

        setTimeout(() => {
            this.playTargetSequence();
        }, 1000);
    },

    playTargetSequence: function() {
        this.cleanupPlayback();
        this.state.waitingForSilence = false;
        this.state.isPlayingSequence = true;

        // Disable input -- repetition begins at startIndex, not always note 0 (see #46 scrub
        // control), so a player can drill any already-reached stretch of the melody.
        const start = this.state.startIndex;
        this.state.userIndex = start;

        const plan = this.getPromptPlaybackPlan(start, this.state.endIndex, this.state.promptSlowFactor);

        for (let i = start; i <= this.state.endIndex; i++) {
            const note = this.state.melody[i];
            if (!note) break;
            const scheduledTime = plan.scheduledTimes[i - start];

            // Schedule note sound and visual highlight
            const tId1 = setTimeout(() => {
                Synth.playNote(note.midi);
                Render.highlightByMidi(note.midi, note.duration * 1000 * plan.factor);
                this.updateDifficultyUI(i);
            }, scheduledTime);

            this.state.playbackTimeoutIds.push(tId1);
        }

        // Calculate when the sequence finishes playing
        const totalDuration = plan.totalDuration;

        const tId2 = setTimeout(() => {
            this.state.isPlayingSequence = false;
            this.state.userIndex = start;
            this.updateDifficultyUI();
            this.flushPendingUserNotes();
        }, totalDuration);

        this.state.playbackTimeoutIds.push(tId2);
    },

    // Return the timing plan used by prompt playback. Slowing is deliberately capped at 4x:
    // longer waits can make the prompt less useful than a voluntary replay or isolated practice.
    getPromptPlaybackPlan: function(start, end, requestedFactor) {
        const melody = this.state.melody;
        const first = melody[start];
        const factor = this.PROMPT_SLOW_FACTORS.reduce((chosen, allowed) =>
            Math.abs(allowed - requestedFactor) < Math.abs(chosen - requestedFactor) ? allowed : chosen,
        1);
        const delayOffsetMs = 500;
        const scheduledTimes = [];
        for (let i = start; i <= end; i++) {
            const note = melody[i];
            if (!note || !first) break;
            scheduledTimes.push(delayOffsetMs + (note.time - first.time) * 1000 * factor);
        }
        const lastNote = melody[end];
        const relativeEnd = lastNote && first
            ? (lastNote.time - first.time + lastNote.duration) * 1000 * factor
            : 1000;
        return { factor, scheduledTimes, totalDuration: delayOffsetMs + relativeEnd };
    },

    setPromptSlowFactor: function(factor) {
        this.state.promptSlowFactor = this.getPromptPlaybackPlan(0, 0, factor).factor;
        return this.state.promptSlowFactor;
    },

    // #46 scrub control: replay the drilled segment starting from any note in the song --
    // both markers are always freely draggable (INV-26), no proof-of-mastery gate on either.
    // Dragging the start past the current end pushes the end forward (to one note ahead of the
    // new start) instead of clamping the start backward to the old end, symmetric with
    // onEndCommit's own push-the-start-back below.
    seekTo: function(index) {
        if (this.state.isPlayingPreview) return;
        const clamped = Math.max(0, Math.min(index, this.state.melody.length - 1));

        if (this.state.userRepeatTimeoutId) {
            clearTimeout(this.state.userRepeatTimeoutId);
            this.state.userRepeatTimeoutId = null;
        }
        if (this.state.mistakeTimeoutId) {
            clearTimeout(this.state.mistakeTimeoutId);
            this.state.mistakeTimeoutId = null;
        }
        this.state.waitingForSilence = false;

        // Doesn't touch measureCleanStreak (#46) -- each measure's own banked credit is a
        // historical record independent of where the drilled segment currently sits, so
        // scrubbing to a different stretch doesn't erase progress on any measure.
        this.state.startIndex = clamped;
        // The real invariant is endIndex >= startIndex + 1, always -- >= here (not just >), so
        // dragging start to land EXACTLY ON the current end also pushes the end forward, not
        // just past it.
        if (clamped >= this.state.endIndex) {
            this.state.endIndex = Math.min(this.state.melody.length - 1, clamped + 1);
        }
        this.playTargetSequence();
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

        this.updateDifficultyUI();
    },

    // A chord is represented by the existing flat note list: adjacent notes whose starts are
    // within the same onset tolerance are one logical event, while a single note is simply an
    // event with one member. Returning absolute indices keeps Timeline/Notation's established
    // note-index contract intact while allowing the matcher to award each chord member once.
    getEventBounds: function(index) {
        const melody = this.state.melody;
        if (!melody[index]) return { start: index, end: index };
        const start = index;
        const onset = melody[index].time;
        let end = start + 1;
        const tolerance = (typeof Notation !== 'undefined' && Notation.EVENT_ONSET_TOLERANCE_SECONDS != null)
            ? Notation.EVENT_ONSET_TOLERANCE_SECONDS
            : 0.08;
        while (end < melody.length && Math.abs(melody[end].time - onset) < tolerance) end++;
        return { start, end };
    },

    // Do not throw away a learner's playing just because the guide is still sounding. Process in
    // order once the guide ends; if one queued note triggers recovery, leave the remainder queued
    // for the next quiet moment rather than silently losing it.
    flushPendingUserNotes: function() {
        const queued = this.state.pendingUserNotes.splice(0);
        for (let i = 0; i < queued.length; i++) {
            if (this.state.isPlayingSequence || this.state.isPlayingPreview) {
                this.state.pendingUserNotes.unshift(...queued.slice(i));
                return;
            }
            this.handleUserInputNote(queued[i]);
        }
    },

    // Recovery is allowed to replay only after the child has stopped playing. The adaptive delay
    // remains a minimum pause, while a later note pushes the silence boundary out without
    // converting the child’s continued performance into blocked/queued input.
    scheduleMistakeReplay: function() {
        if (this.state.mistakeTimeoutId) clearTimeout(this.state.mistakeTimeoutId);
        this.state.waitingForSilence = true;
        const retryDelay = Math.min(
            this.RECOVERY_MAX_DELAY_MS,
            this.RECOVERY_BASE_DELAY_MS * Math.pow(2, this.state.mistakeRetryCount)
        );
        this.state.promptSlowFactor = this.PROMPT_SLOW_FACTORS[Math.min(this.state.mistakeRetryCount + 1, 3)];
        this.state.mistakeRetryCount++;
        this.state.lastMistakeDelayMs = retryDelay;
        const earliestReplayAt = Date.now() + retryDelay;
        const tryReplay = () => {
            const now = Date.now();
            const silenceRemaining = this.SILENCE_BEFORE_REPROMPT_MS - (now - (this.state.lastUserInputAt || now));
            const delayRemaining = earliestReplayAt - now;
            if (silenceRemaining > 0 || delayRemaining > 0) {
                this.state.mistakeTimeoutId = setTimeout(tryReplay, Math.max(20, silenceRemaining, delayRemaining));
                return;
            }
            this.state.mistakeTimeoutId = null;
            this.state.waitingForSilence = false;
            if (App.currentMode === 'melody' && !this.state.isPlayingPreview) this.playTargetSequence();
        };
        this.state.mistakeTimeoutId = setTimeout(tryReplay, retryDelay);
    },

    cancelMistakeReplay: function() {
        if (this.state.mistakeTimeoutId) {
            clearTimeout(this.state.mistakeTimeoutId);
            this.state.mistakeTimeoutId = null;
        }
        this.state.waitingForSilence = false;
    },

    // Judge relative spacing only after Easy. The first accepted event establishes a baseline;
    // each later event gets the same result copied to all of its members, so a chord is one timing
    // decision while pitch feedback remains per member. This intentionally does not affect credit.
    recordEventTiming: function(event) {
        const now = this.now ? this.now() : Date.now();
        if (this.state.lastPracticeEventStart != null && this.state.lastPracticeEventStart !== event.start && this.state.difficulty > 1) {
            const previous = this.state.melody[this.state.lastPracticeEventStart];
            const expectedMs = (this.state.melody[event.start].time - previous.time) * 1000;
            const actualMs = now - this.state.lastPracticeInputAt;
            const tolerance = this.TIMING_TOLERANCE_MS[this.state.difficulty] || this.TIMING_TOLERANCE_MS[3];
            const status = actualMs < expectedMs - tolerance ? 'early'
                : actualMs > expectedMs + tolerance ? 'late' : 'on-time';
            for (let index = event.start; index < event.end; index++) this.state.timingPerformance[index] = status;
        }
        this.state.lastPracticeInputAt = now;
        this.state.lastPracticeEventStart = event.start;
    },

    handleUserInputNote: function(midi) {
        this.state.lastUserInputAt = Date.now();
        if (this.state.isPlayingSequence) {
            if (this.state.pendingUserNotes.length < 64) this.state.pendingUserNotes.push(midi);
            return;
        }
        if (this.state.isPlayingPreview) return;

        const event = this.getEventBounds(this.state.userIndex);
        if (event.start >= event.end) return;
        const matched = this.state.matchedChordNotes || [];
        const targetIndex = this.state.melody
            .slice(event.start, event.end)
            .findIndex((note, offset) => note.midi === midi && !matched.includes(event.start + offset));

        // Compare exact pitch
        if (targetIndex >= 0) {
            // Correct note!
            const matchedIndex = event.start + targetIndex;
            this.cancelMistakeReplay();
            if (!matched.includes(matchedIndex)) this.recordEventTiming(event);
            matched.push(matchedIndex);
            this.recordNotePerformance(matchedIndex, 'correct');
            this.state.matchedChordNotes = matched;

            // Partial chord credit stays on the same event until every member is supplied. No
            // progression, streak, measure banking, or idle replay is triggered for a partial
            // event; the accepted members remain available as feedback while the missing members
            // stay actionable.
            if (matched.length < event.end - event.start) {
                this.updateDifficultyUI();
                return;
            }

            this.state.userIndex = event.end;
            this.state.matchedChordNotes = [];
            this.state.mistakeRetryCount = 0;
            this.state.promptSlowFactor = 1;
            this.updateStreak(this.state.userIndex);

            // INV-26: the end advances immediately with every correct play that reaches the
            // current frontier -- no streak gate. (The old coupled version, where the end waited
            // on the same streak the start needed, was a real regression: nothing visibly
            // advanced between reps.) Random grows its prefix immediately below.
            // Note the >= (via userIndex > endIndex, not userIndex-1 > endIndex): playing the
            // LAST note of the current segment (userIndex-1 === endIndex) is exactly the moment
            // that segment is fully mastered and must grow -- a strict > here was the actual bug
            // behind the regression: it left endIndex frozen at 0 forever after playing note 0,
            // since userIndex-1 (0) is never strictly greater than endIndex (0).
            if (this.state.isRandom && this.state.userIndex > this.state.endIndex) {
                // Simon grows by one event after the complete current prefix is repeated. The
                // logical start remains zero and the generated sequence has no fixed endpoint.
                this.appendRandomEvent();
            } else if (!this.state.isRandom && this.state.userIndex > this.state.endIndex) {
                this.state.endIndex = this.state.userIndex;
            }

            // Clear any existing "going ahead" timeout
            if (this.state.userRepeatTimeoutId) {
                clearTimeout(this.state.userRepeatTimeoutId);
                this.state.userRepeatTimeoutId = null;
            }

            if (this.state.userIndex >= this.state.melody.length) {
                if (this.state.isRandom) {
                // This is unreachable for normal Random play because completion appends an event
                // first; retain the guard for malformed/legacy state rather than celebrating a
                // finite fallback sequence (issue #31).
                    this.loadDefault();
                    return;
                }
                // Reported live: the flourish is for a COMPLETE playthrough. Reaching the last
                // note when the drilled segment didn't start at the very beginning isn't that --
                // send the start back to 0 instead, so the next pass is a genuine start-to-finish
                // attempt, and skip the celebration.
                if (this.state.startIndex !== 0) {
                    // Also reset the end to 1 (matching a freshly loaded song's own starting
                    // state) and clear every measure's banked clean-play credit -- seekTo alone
                    // deliberately leaves both of those untouched (a normal scrub's credit is a
                    // historical record), but here that stale credit would immediately re-trigger
                    // the consecutive-mastered-measures advance (INV-26) on the very next correct
                    // note, jumping the start straight back ahead of the playhead the instant it
                    // was reset to 0.
                    this.state.endIndex = Math.min(1, Math.max(0, this.state.melody.length - 1));
                    this.state.measureCleanStreak = {};
                    this.seekTo(0);
                    return;
                }
                // Completed the entire song, start to finish! (celebrate() below is the payoff --
                // flourish + confetti -- self-explanatory without a status line spelling it out too.)
                document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
                document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
                this.celebrate();
                return;
            }

            // INV-26/53: bank clean-play credit for whichever measure just got fully, cleanly
            // played through -- the note just played (userIndex-1) is still within its own
            // measure, but the next one (guaranteed to exist: the userIndex >= melody.length
            // branch above already returned otherwise) is in a later measure. Each measure's
            // count lives independently (measureCleanStreak, keyed by measureOf(...)), not one
            // shared counter -- a single continuous pass can cross several measure boundaries in
            // a row, each banking its OWN credit, and a later mistake (see the mistake branch
            // below) only zeroes the ONE measure it actually happened in.
            if (!this.state.isRandom) {
                const justPlayedMeasure = this.measureOf(this.state.melody[this.state.userIndex - 1].time);
                const nextNoteMeasure = this.measureOf(this.state.melody[this.state.userIndex].time);
                if (nextNoteMeasure > justPlayedMeasure) {
                    this.state.measureCleanStreak[justPlayedMeasure] = (this.state.measureCleanStreak[justPlayedMeasure] || 0) + 1;

                    // Advance start past every CONSECUTIVE measure (starting from wherever it
                    // currently sits) that's individually reached k=3 -- not just one at a time --
                    // stopping at the first one that hasn't (reported live: "stop at the beginning
                    // of the first measure that wasn't quite right"; also: a 2-measure stretch
                    // played cleanly 3 times should skip both measures, not just the first).
                    let idx = this.state.startIndex;
                    let m = this.measureOf(this.state.melody[idx].time);
                    while ((this.state.measureCleanStreak[m] || 0) >= 3) {
                        let nextIdx = idx;
                        while (nextIdx < this.state.melody.length && this.measureOf(this.state.melody[nextIdx].time) <= m) {
                            nextIdx++;
                        }
                        if (nextIdx >= this.state.melody.length) break; // that was the last measure
                        idx = nextIdx;
                        m = this.measureOf(this.state.melody[idx].time);
                    }
                    if (idx !== this.state.startIndex) {
                        this.state.startIndex = idx;
                        // endIndex should already be ahead of idx (it tracks live), but guard the
                        // startIndex <= endIndex invariant regardless.
                        if (this.state.endIndex < idx) this.state.endIndex = idx;
                    }
                }
            }

            // Placed AFTER the measure-mastery block above, not before it -- this is the call
            // that repositions the start marker (via state.startIndex), so rendering it any
            // earlier in this function would draw the marker at its PRE-advance position on
            // exactly the note that advances it, landing it one note late (reported live: on a
            // 2-note measure, "the start marker landed at half a measure").
            this.updateDifficultyUI();

            // The idle-replay reminder must fire regardless of whether the player is at the
            // frontier or still mid-segment: a real song's end now grows immediately on every
            // correct play (see above), so "at the frontier" (userIndex > endIndex) is no longer
            // a distinct, occasional state the way it was before that change -- it's the norm
            // after every single correct note. Scheduling the reminder only in that branch, as
            // before, silently made it unreachable for any real song: nothing ever re-prompted
            // the player again after their first correct note, exactly the regression reported
            // live ("not timing out ... consequently not showing me what to do next").
            this.state.userRepeatTimeoutId = setTimeout(() => {
                // Timeout fired: player paused. This re-drills the current segment as a reminder
                // of what comes next; Random's prefix was already extended on completion above.
                this.playTargetSequence();
            }, 2000);
        } else {
            // Mistake! (the board's own mistake-flash / replay-from-start is the feedback --
            // deliberately no status text; the wrong note flashing red already says it.)
            // Reset only the ONE measure the mistake actually fell in -- every other measure's
            // own banked credit (including ones already fully mastered and skipped past) is
            // untouched (reported live: "if I make an error later, that shouldn't count against
            // the three consecutive good plays of an earlier measure").
            const eventIndices = Array.from({ length: event.end - event.start }, (_, offset) => event.start + offset);
            eventIndices.filter((index) => !matched.includes(index)).forEach((index) => this.recordNotePerformance(index, 'misses'));
            this.flashMistakeNotes(eventIndices.filter((index) => !matched.includes(index)));
            this.state.extraNotes.push(midi);

            if (!this.state.isRandom) {
                const mistakeMeasure = this.measureOf(this.state.melody[this.state.userIndex].time);
                this.state.measureCleanStreak[mistakeMeasure] = 0;
            }

            // Random's end only grows via the timeout above, so a mistake can still land past it
            // -- show the correct version of the note they missed. (For a real song this is a
            // no-op: the end already tracks userIndex live, so userIndex can never exceed it here.)
            if (this.state.userIndex > this.state.endIndex) {
                this.state.endIndex = this.state.userIndex;
            }
            // A partially completed chord remains the active event: its accepted members are
            // retained for the retry, while an ordinary single-note mistake keeps the established
            // behavior of rewinding to the drill's start marker.
            if (matched.length === 0) this.state.userIndex = this.state.startIndex;
            this.updateDifficultyUI();
            
            if (this.state.userRepeatTimeoutId) {
                clearTimeout(this.state.userRepeatTimeoutId);
                this.state.userRepeatTimeoutId = null;
            }

            // Do not block or interrupt an ongoing child performance. The replay remains pending
            // until both the adaptive delay and a genuine silence period have elapsed.
            this.scheduleMistakeReplay();
        }
    },

    celebrate: function() {
        const songNotes = [...new Set(this.state.melody.map(n => n.midi))];
        songNotes.sort((a, b) => a - b);

        // The tonic major triad of the song's own DETECTED key (not just whichever pitch
        // classes happen to appear in the melody) -- a real "you win" cadence resolving home,
        // picked into whichever octave sits nearest the melody's own tessitura so it reads as
        // part of the same piece rather than a jarring register jump.
        const root = this.state.keySignature != null ? (((7 * this.state.keySignature) % 12) + 12) % 12 : 0;
        const triadPCs = [root, (root + 4) % 12, (root + 7) % 12];
        const refMidi = songNotes.length > 0 ? songNotes[Math.floor(songNotes.length / 2)] : 60;
        const victoryChord = triadPCs.map((pc) => this._nearestMidiForPitchClass(pc, refMidi));

        // Purely decorative, over the practice strip -- makes no claim about which Tonnetz cell
        // is sounding, so unlike the old per-cell flash flourish (see the highlight comment
        // below), it can't violate INV-5 by construction.
        this.spawnConfetti();

        // INV-5: a cell's visible feedback must correspond to that cell actually sounding at
        // that instant. The old flourish flashed every victory-chord cell together, 5 times, on
        // a fixed 300ms cadence unrelated to Synth.playChord's own per-note roll timing -- almost
        // every flash showed a cell that wasn't actually sounding. Timing each highlight to that
        // SAME rolled per-note delay (js/synth.js) keeps the two in sync instead.
        const rolled = true, dur = 2.0;
        Synth.playChord(victoryChord, rolled, 0.18, dur);
        victoryChord.forEach((note, i) => {
            const delay = rolled ? i * 0.06 * 1000 : 0;
            setTimeout(() => Render.highlightByMidi(note, dur * 1000), delay);
        });
    },

    // The octave-shifted MIDI note nearest refMidi whose pitch class is `pc` -- lets celebrate()
    // build a real chord voicing near the melody's own register instead of an arbitrary fixed
    // octave that might sit far from what was just played (or outside the audible range).
    _nearestMidiForPitchClass: function(pc, refMidi) {
        const base = refMidi - (((refMidi % 12) + 12) % 12) + pc;
        let best = base;
        for (const cand of [base - 12, base, base + 12]) {
            if (Math.abs(cand - refMidi) < Math.abs(best - refMidi)) best = cand;
        }
        return best;
    },

    // Decorative only -- see celebrate()'s comment on why this replaced the old per-cell flash
    // flourish. Pieces are plain DOM spans, CSS-animated (see css/style.css's .confetti-piece),
    // and self-removing after the animation ends so a repeat win doesn't accumulate stale nodes.
    spawnConfetti: function() {
        const host = document.getElementById('melody-notation-scroll');
        if (!host) return;
        const COLORS = ['#7fe0d0', '#e6b23c', '#d16a8f', '#8fb3f2', '#ffffff'];
        const COUNT = 24;
        for (let i = 0; i < COUNT; i++) {
            const piece = document.createElement('span');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.background = COLORS[i % COLORS.length];
            piece.style.animationDelay = (Math.random() * 0.3) + 's';
            piece.style.transform = `rotate(${Math.random() * 360}deg)`;
            host.appendChild(piece);
            piece.addEventListener('animationend', () => piece.remove());
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
        this.state.waitingForSilence = false;
        this.state.isPlayingSequence = false;
        this.state.isPlayingPreview = false;
        this.state.pendingUserNotes = [];
        this.state.liveInputNotes = new Set();
        this.state.lastPracticeInputAt = null;
        this.state.lastPracticeEventStart = null;
        this.state.lastUserInputAt = null;

        this.setPlayIcon(false);

        // Remove any visual cell highlights
        document.querySelectorAll('.active-note').forEach(el => el.classList.remove('active-note'));
        document.querySelectorAll('.glow-past').forEach(el => el.classList.remove('glow-past'));
        document.querySelectorAll('.glow-future').forEach(el => el.classList.remove('glow-future'));
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
        // drawLattice rebuilds the whole lattice group from scratch -- a fresh set of <polygon>
        // elements with none of updateDifficultyUI's own glow classes/markers, so anything that
        // triggers a redraw AFTER the initial one (the pan-resize ResizeObserver, rotating the
        // view, a window resize) silently wiped the practice-strip decoration entirely. Found
        // live while adding the current-note shape marker (js/render.js's markCurrentNote) --
        // it kept vanishing shortly after appearing.
        this.updateDifficultyUI();
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
