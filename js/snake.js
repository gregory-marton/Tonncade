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
 * snake.js - Snake Game on the Tonnetz lattice.
 */

const SnakeMode = {
    state: {
        snake: [],             // Array of { p, q } representing body (head is index 0)
        direction: { p: 1, q: 0 }, // Current heading vector
        nextDirection: { p: 1, q: 0 }, // Direction to apply on next tick
        gem: null,             // Position of the food gem { p, q }
        extraGems: [],         // Extra food cells pasted in (see App copy/paste) { p, q }
        score: 0,              // Current score
        bestScore: 0,          // High score for snake mode
        isGameOver: false,
        isPaused: false,
        isFlourishing: false,  // True during gem eating arpeggio
        speed: 700,            // Tick speed in ms
        timer: null,           // Movement interval timer ID
        flourishTimeouts: [],  // Scheduled timeouts for arpeggio
        lastHighlightTimeouts: [] // Highlighting timeouts
    },

    init: function() {
        Render.init('tonnetz-svg');

        // Load high score
        this.state.bestScore = parseInt(localStorage.getItem('tonncade_snake_best') || '0');
        this.updateStreakUI();

        this.setupDOMEvents();
        // A mode switch pauses -- it never resets (INV-48/#15/#16's sibling for Blast/Gravity).
        // Only the very first entry (no snake has ever spawned) or the player's own Reset button
        // starts a fresh game; returning to Snake mid-game just rebinds input and repaints exactly
        // where it was left (cleanup() already stopped the timer and marked it paused).
        if (this.state.snake.length === 0) {
            this.reset();
        } else {
            this.setupKeyboardEvents();
            this.updateScoreUI();
            this.refreshBoard();
            this.updateDirectionHighlight();
            this.setPauseIcon(this.state.isPaused);
        }

        // Same ResizeObserver pattern as Gravity (INV-30)/Blast: without this, refreshBoard()'s
        // aspect-matched fit is only ever computed against whatever size the SVG happened to be
        // at mode entry, and never adapts to a later resize (found via a systematic centering
        // check applied uniformly across every restricted-board mode -- Snake never had this at
        // all, unlike Gravity/Blast).
        //
        // Observes #game-container, not Render.svg itself (INV-40): fitContentBox sizes Render.svg
        // FROM #game-container's own box, so #game-container is the real upstream signal. Watching
        // Render.svg directly missed real changes whenever fitContentBox's OWN output size
        // happened to be insensitive to the exact container width (a common case: this board's
        // shape is often height-bound, so its fitted size doesn't change even though its centered
        // X-offset should) -- found live via the mobile drawer's open/close animation leaving the
        // board offset stuck mid-transition, never settling back to its pre-open position.
        if (!this._resizeObserver && typeof ResizeObserver !== 'undefined' && Render.svg) {
            this._resizeObserver = new ResizeObserver(() => this.refreshBoard());
            const container = document.getElementById('game-container');
            this._resizeObserver.observe(container || Render.svg);
        }
    },

    cleanup: function() {
        // Leaving mid-game pauses (INV-48) -- reflect that in isPaused/the icon too, so
        // returning shows an accurate "Resume" rather than a "Pause" that would actually start it
        // from a dead stop.
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
            this.state.isPaused = true;
            this.setPauseIcon(true);
        }
        this.state.flourishTimeouts.forEach(tId => clearTimeout(tId));
        this.state.flourishTimeouts = [];
        this.state.lastHighlightTimeouts.forEach(tId => clearTimeout(tId));
        this.state.lastHighlightTimeouts = [];

        window.onkeydown = null;
        window.onmousemove = null;
        if (Render.svg) {
            Render.svg.onmousedown = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    },

    setupDOMEvents: function() {
        const pauseBtn = document.getElementById('snake-start-pause');
        const resetBtn = document.getElementById('snake-reset');

        if (pauseBtn) {
            pauseBtn.onclick = () => {
                this.togglePause();
            };
        }

        if (resetBtn) {
            resetBtn.onclick = () => {
                this.reset();
            };
        }
    },

    reset: function() {
        this.cleanup();

        // Initial snake: length 3 starting in center going right
        this.state.snake = [
            { p: 0, q: 0 },
            { p: -1, q: 0 },
            { p: -2, q: 0 }
        ];
        this.state.direction = { p: 1, q: 0 };
        this.state.nextDirection = { p: 1, q: 0 };
        this.state.extraGems = [];
        this.state.score = 0;
        this.state.isGameOver = false;
        this.state.isPaused = false;
        this.state.isFlourishing = false;
        this.state.speed = 700;

        this.updateScoreUI();
        this.spawnGem();
        this.refreshBoard();
        this.updateDirectionHighlight();
        
        this.setPauseIcon(false);

        this.setupKeyboardEvents();
        this.startTimer();
    },

    // Icon-only transport: ⏸ while running (click pauses), ▶ while paused (click resumes) --
    // the glyph shows the action the click performs. Keep the id and an English title/aria-label
    // for accessibility and the tests; the visible label is now icon-only (no English UI text --
    // see the i18n bias in task #29).
    setPauseIcon: function(paused) {
        const btn = document.getElementById('snake-start-pause');
        if (!btn) return;
        btn.textContent = paused ? '▶' : '⏸';
        const label = paused ? 'Resume' : 'Pause';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    },

    togglePause: function() {
        if (this.state.isGameOver || this.state.isFlourishing) return;

        this.state.isPaused = !this.state.isPaused;

        if (this.state.isPaused) {
            if (this.state.timer) {
                clearInterval(this.state.timer);
                this.state.timer = null;
            }
            this.setPauseIcon(true);
        } else {
            this.setPauseIcon(false);
            this.startTimer();
        }
    },

    startTimer: function() {
        if (this.state.timer) clearInterval(this.state.timer);
        this.state.timer = setInterval(() => {
            this.tick();
        }, this.state.speed);
    },

    tick: function() {
        if (typeof Replay !== 'undefined') Replay.recordTick();
        if (this.state.isGameOver || this.state.isPaused || this.state.isFlourishing) return;

        // Apply heading update
        this.state.direction = this.state.nextDirection;

        const head = this.state.snake[0];
        const newHead = {
            p: head.p + this.state.direction.p,
            q: head.q + this.state.direction.q
        };

        // Collision check: Arena boundary
        if (!this.isInBounds(newHead.p, newHead.q)) {
            this.gameOver();
            return;
        }

        // Collision check: Self collision
        if (this.state.snake.some(segment => segment.p === newHead.p && segment.q === newHead.q)) {
            this.gameOver();
            return;
        }

        // Move head forward
        this.state.snake.unshift(newHead);

        // Sound the head note at its OWN pitch (INV-46) -- no octave clamp. Snake's board reaches
        // MIDI >108 at its edges; the old clamp into [21,108] played a different pitch there.
        Synth.playNote(Tonnetz.getMidi(newHead.p, newHead.q), 0, 0.35, 0.16);
        this.highlightSegment(newHead.p, newHead.q, 300);

        // Check food collision -- the main gem, or any pasted extra gem
        const extraIdx = this.state.extraGems.findIndex(g => g.p === newHead.p && g.q === newHead.q);
        if (newHead.p === this.state.gem.p && newHead.q === this.state.gem.q) {
            // Eat gem! Grow (don't pop tail)
            this.state.score++;
            this.updateScore(this.state.score);
            this.playFlourish();
            this.spawnGem();

            // Increase speed slightly
            this.state.speed = Math.max(250, 700 - this.state.score * 6);
        } else if (extraIdx >= 0) {
            // Eat a pasted gem: same reward, but it's consumed (not respawned).
            this.state.score++;
            this.updateScore(this.state.score);
            this.playFlourish();
            this.state.extraGems.splice(extraIdx, 1);
            this.state.speed = Math.max(250, 700 - this.state.score * 6);
        } else {
            // Standard step: pop tail
            this.state.snake.pop();
        }

        this.refreshBoard();
    },

    playFlourish: function() {
        this.state.isFlourishing = true;

        // Pause normal timer
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
        }

        const notes = this.state.snake.map(segment => ({
            p: segment.p,
            q: segment.q,
            midi: Tonnetz.getMidi(segment.p, segment.q)
        }));

        const noteDelay = 100; // ms between notes
        notes.forEach((note, index) => {
            const tId = setTimeout(() => {
                const playableMidi = Math.max(21, Math.min(108, note.midi));
                Synth.playNote(playableMidi, 0, 0.4, 0.18);
                this.highlightSegment(note.p, note.q, 300);
            }, index * noteDelay);
            this.state.flourishTimeouts.push(tId);
        });

        // Resume timer after flourish ends
        const totalDuration = notes.length * noteDelay + 250;
        const tIdFinish = setTimeout(() => {
            this.state.isFlourishing = false;
            this.state.flourishTimeouts = [];
            if (!this.state.isGameOver && !this.state.isPaused) {
                this.startTimer();
            }
        }, totalDuration);
        this.state.flourishTimeouts.push(tIdFinish);
    },

    spawnGem: function() {
        const radius = 7;
        const candidates = [];

        for (let p = -radius; p <= radius; p++) {
            for (let q = -radius; q <= radius; q++) {
                if (this.isInBounds(p, q)) {
                    // Filter out cells occupied by the snake
                    const isOccupied = this.state.snake.some(segment => segment.p === p && segment.q === q);
                    if (!isOccupied) {
                        candidates.push({ p, q });
                    }
                }
            }
        }

        if (candidates.length === 0) {
            this.victory();
            return;
        }

        const randIdx = Math.floor(Math.random() * candidates.length);
        this.state.gem = candidates[randIdx];

        // Sound the gem appearance!
        const gemMidi = Tonnetz.getMidi(this.state.gem.p, this.state.gem.q);
        this.playGemSpawnSound(gemMidi);
    },

    playGemSpawnSound: function(midi) {
        const playableMidi = Math.max(21, Math.min(108, midi));
        // Triple sound: three fast notes scheduled via Web Audio API time offsets
        Synth.playNote(playableMidi, 0.0, 0.08, 0.12);
        Synth.playNote(playableMidi, 0.07, 0.08, 0.12);
        Synth.playNote(playableMidi, 0.14, 0.12, 0.18);
    },

    isInBounds: function(p, q) {
        const radius = 7;
        return Math.abs(p) <= radius && 
               Math.abs(q) <= radius && 
               Math.abs(p + q) <= radius;
    },

    highlightSegment: function(p, q, duration = 200) {
        const polygon = document.querySelector(`polygon[data-p="${p}"][data-q="${q}"]`);
        if (polygon) {
            polygon.classList.add('active-segment');
            const timeoutId = setTimeout(() => {
                polygon.classList.remove('active-segment');
            }, duration);
            this.state.lastHighlightTimeouts.push(timeoutId);
        }
    },

    gameOver: function() {
        this.state.isGameOver = true;
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
        }

        // Play sad game over note
        Synth.playNote(36, 0, 0.8, 0.5); // Low C2
    },

    victory: function() {
        this.state.isGameOver = true;
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
        }

        // Play celebratory arpeggio
        const victoryNotes = [60, 64, 67, 72, 76, 79, 84];
        victoryNotes.forEach((note, index) => {
            setTimeout(() => {
                Synth.playNote(note, 0, 0.5, 0.3);
            }, index * 100);
        });
    },

    // Shared by the keyboard/D-pad direction keys and MidiMode's note-on routing (issue #11) --
    // the same "don't reverse directly into your own tail" guard applies regardless of input.
    turnTo: function(newDir) {
        const currentDir = this.state.direction;
        if (newDir.p !== -currentDir.p || newDir.q !== -currentDir.q) {
            this.state.nextDirection = newDir;
            this.updateDirectionHighlight();
        }
    },

    // Issue #11: "totally turn towards whatever note is played, as best you can interpret
    // 'towards'" -- of the snake's 6 immediate neighbor cells (the only 6 directions it can
    // turn), pick whichever one's own pitch is closest to the played note. Most played notes
    // aren't exactly reachable in one step (a hex step only ever changes pitch by a fifth/
    // third), so "closest" is the right reading of "as best you can interpret towards", not an
    // exact-match requirement. This also means repeatedly playing a gem's own note will
    // reliably steer straight at it -- an intentional, accepted shortcut per the report, not a
    // bug to guard against.
    handleMidiNote: function(midi) {
        if (this.state.isGameOver || this.state.isPaused || this.state.isFlourishing) return;
        const head = this.state.snake[0];
        if (!head) return;

        let best = null;
        let bestDist = Infinity;
        Tonnetz.getNeighbors(head.p, head.q).forEach(n => {
            const dist = Math.abs(Tonnetz.getMidi(n.p, n.q) - midi);
            if (dist < bestDist) {
                bestDist = dist;
                best = { p: n.p - head.p, q: n.q - head.q };
            }
        });
        if (best) this.turnTo(best);
    },

    setupKeyboardEvents: function() {
        window.onkeydown = (e) => {
            const key = e.key.toLowerCase();

            // Toggle pause on Escape or P
            if (key === 'escape' || key === 'p') {
                e.preventDefault();
                this.togglePause();
                return;
            }

            // Spacebar: Reset if game over, otherwise toggle pause
            if (e.code === 'Space' || e.key === ' ' || key === 'spacebar') {
                e.preventDefault();
                if (this.state.isGameOver) {
                    this.reset();
                } else {
                    this.togglePause();
                }
                return;
            }

            if (this.state.isGameOver) return;
            if (this.state.isPaused || this.state.isFlourishing) return;

            // Map keys surrounding G:
            // T: Up-Left (p:-1, q:1), Y: Up-Right (p:0, q:1)
            // F: Left (p:-1, q:0),     H: Right (p:1, q:0)
            // V: Down-Left (p:0, q:-1), B: Down-Right (p:1, q:-1)
            const newDir = {
                't': { p: -1, q: 1 },
                'y': { p: 0, q: 1 },
                'f': { p: -1, q: 0 },
                'h': { p: 1, q: 0 },
                'v': { p: 0, q: -1 },
                'b': { p: 1, q: -1 }
            }[key];

            if (newDir) {
                e.preventDefault();
                this.turnTo(newDir);
            }
        };
    },

    // ---- Cross-mode copy/paste (App.copy/App.paste; docs/invariants.md INV-47) ----
    // Snake uses the standard mapping, so its cells are already canonical. Copy = the snake body.
    // Paste = drop each in-bounds canonical cell (not on the snake, not already food) in as an extra
    // food gem -- silly but fun (the user's call).
    copyCells: function() {
        return this.state.snake.map((s) => ({ p: s.p, q: s.q }));
    },
    pasteClipboard: function(cells) {
        const onSnake = (p, q) => this.state.snake.some((s) => s.p === p && s.q === q);
        const isFood = (p, q) => (this.state.gem && this.state.gem.p === p && this.state.gem.q === q) ||
            this.state.extraGems.some((g) => g.p === p && g.q === q);
        const midis = [];
        cells.forEach((c) => {
            if (this.isInBounds(c.p, c.q) && !onSnake(c.p, c.q) && !isFood(c.p, c.q)) {
                this.state.extraGems.push({ p: c.p, q: c.q });
                midis.push(Tonnetz.getMidi(c.p, c.q));
            }
        });
        if (!midis.length) return;
        this.refreshBoard();
        Synth.playChord(midis, false, 0.12, 0.9); // soft confirmation
    },

    refreshBoard: function() {
        // Draw standard radius 7 hex lattice (viewport -8 to 8)
        const viewport = { minP: -8, maxP: 8, minQ: -8, maxQ: 8 };
        Render.drawLattice(viewport, { isSnake: true });

        // Draw gem
        const gem = this.state.gem;
        if (gem) {
            const hex = Render.createHex(gem.p, gem.q, {
                fill: '#ff9c4b',
                stroke: '#ffffff',
                strokeWidth: 2,
                className: 'snake-gem'
            });
            Render.appendToLattice(hex);

            // Gem Label
            const gemMidi = Tonnetz.getMidi(gem.p, gem.q);
            const label = Render.createLabel(gem.p, gem.q, Tonnetz.getNoteName(gemMidi));
            label.setAttribute('class', 'note-label gem-label');
            Render.appendToLattice(label);
            Render.appendToLattice(Render.createOctaveLabel(gem.p, gem.q, gemMidi));
        }

        // Draw pasted extra gems (same look as the main gem)
        this.state.extraGems.forEach((g) => {
            const hex = Render.createHex(g.p, g.q, {
                fill: '#ff9c4b', stroke: '#ffffff', strokeWidth: 2, className: 'snake-gem',
            });
            Render.appendToLattice(hex);
            const extraMidi = Tonnetz.getMidi(g.p, g.q);
            const label = Render.createLabel(g.p, g.q, Tonnetz.getNoteName(extraMidi));
            label.setAttribute('class', 'note-label gem-label');
            Render.appendToLattice(label);
            Render.appendToLattice(Render.createOctaveLabel(g.p, g.q, extraMidi));
        });

        // Draw Snake body (backwards from tail to head, so head lays on top)
        for (let i = this.state.snake.length - 1; i >= 0; i--) {
            const segment = this.state.snake[i];
            const isHead = i === 0;

            const hex = Render.createHex(segment.p, segment.q, {
                fill: isHead ? '#4bff9c' : '#4bff4b',
                stroke: '#ffffff',
                strokeWidth: 1.5,
                className: isHead ? 'snake-head' : 'snake-body'
            });
            Render.appendToLattice(hex);

            // Label segment
            const midi = Tonnetz.getMidi(segment.p, segment.q);
            const label = Render.createLabel(segment.p, segment.q, Tonnetz.getNoteName(midi));
            Render.appendToLattice(label);
            Render.appendToLattice(Render.createOctaveLabel(segment.p, segment.q, midi));
        }

        // Aspect-matched fit against the board's own fixed radius-7 hex, the same treatment
        // Gravity (#44) and Blast (#48) already got -- Snake never did, and had used a fixed
        // Render.updateView(-440, -330, 1.1) ever since, which doesn't adapt to the SVG's actual
        // on-screen aspect ratio the way a restricted board should (found via a systematic
        // centering check applied uniformly across every restricted-board mode).
        const boardCells = [];
        for (let p = -7; p <= 7; p++) {
            for (let q = -7; q <= 7; q++) {
                if (this.isInBounds(p, q)) boardCells.push({ p, q });
            }
        }
        Render.updateChromeInsets();
        Render.fitContentBox(boardCells, Render.HEX_R * 2);
        const { refW, refH } = Render.getAspectMatchedRefBox();
        // A slightly larger scale margin than Blast's 1.25 -- Snake's radius-7 board is bigger
        // than Blast's radius-5 one, and 1.25 left 2 of 169 cells clipped at a narrow tablet
        // portrait width (712px); 1.15 gives enough breathing room at every tested viewport.
        const fit = Render.getFitView(boardCells, Render.HEX_R * 2, 1.15, refW, refH);
        Render.updateView(fit.viewX, fit.viewY, fit.zoom, refW, refH);
    },

    updateScore: function(score) {
        this.state.score = score;
        this.updateScoreUI();

        if (score > this.state.bestScore) {
            this.state.bestScore = score;
            localStorage.setItem('tonncade_snake_best', score.toString());
            this.updateStreakUI();
        }
    },

    updateScoreUI: function() {
        const scoreEl = document.getElementById('snake-score');
        if (scoreEl) {
            scoreEl.textContent = this.state.score;
        }
        Render.setStatBar('snake-score-fill', this.state.score, Math.max(this.state.bestScore, this.state.score));
    },

    updateStreakUI: function() {
        const bestEl = document.getElementById('snake-best-score');
        if (bestEl) {
            bestEl.textContent = this.state.bestScore;
        }
        Render.setStatBar('snake-score-fill', this.state.score, Math.max(this.state.bestScore, this.state.score));
    },

    // Continuously highlights whichever D-pad arrow matches state.nextDirection, so the
    // current heading is always visible at a glance instead of only flashing on press.
    updateDirectionHighlight: function() {
        const dir = this.state.nextDirection;
        const idForDir = {
            '-1,1': 'snake-btn-ul',
            '0,1': 'snake-btn-ur',
            '-1,0': 'snake-btn-left',
            '1,0': 'snake-btn-right',
            '0,-1': 'snake-btn-dl',
            '1,-1': 'snake-btn-dr'
        };
        const activeId = idForDir[`${dir.p},${dir.q}`];
        document.querySelectorAll('#snake-mobile-controls .m-btn').forEach(btn => {
            btn.classList.toggle('active-direction', btn.id === activeId);
        });
    }
};
