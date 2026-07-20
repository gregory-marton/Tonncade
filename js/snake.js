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
        this.reset();
    },

    cleanup: function() {
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
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
        this.state.score = 0;
        this.state.isGameOver = false;
        this.state.isPaused = false;
        this.state.isFlourishing = false;
        this.state.speed = 700;

        this.updateScoreUI();
        this.spawnGem();
        this.refreshBoard();
        this.updateDirectionHighlight();
        
        const pauseBtn = document.getElementById('snake-start-pause');
        if (pauseBtn) pauseBtn.textContent = "Pause";

        this.setupKeyboardEvents();
        this.startTimer();
    },

    togglePause: function() {
        if (this.state.isGameOver || this.state.isFlourishing) return;

        this.state.isPaused = !this.state.isPaused;
        const pauseBtn = document.getElementById('snake-start-pause');

        if (this.state.isPaused) {
            if (this.state.timer) {
                clearInterval(this.state.timer);
                this.state.timer = null;
            }
            if (pauseBtn) pauseBtn.textContent = "Resume";
        } else {
            if (pauseBtn) pauseBtn.textContent = "Pause";
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

        // Sound the head note (clamp to standard 88-key piano range for audibility)
        const midi = Tonnetz.getMidi(newHead.p, newHead.q);
        const playableMidi = Math.max(21, Math.min(108, midi));
        Synth.playNote(playableMidi, 0, 0.35, 0.16);
        this.highlightSegment(newHead.p, newHead.q, 300);

        // Check food collision
        if (newHead.p === this.state.gem.p && newHead.q === this.state.gem.q) {
            // Eat gem! Grow (don't pop tail)
            this.state.score++;
            this.updateScore(this.state.score);
            this.playFlourish();
            this.spawnGem();

            // Increase speed slightly
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

                // Prevent moving directly into opposite direction (-p, -q)
                const currentDir = this.state.direction;
                if (newDir.p !== -currentDir.p || newDir.q !== -currentDir.q) {
                    this.state.nextDirection = newDir;
                    this.updateDirectionHighlight();
                }
            }
        };
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
        }

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
        }

        Render.updateView(-440, -330, 1.1);
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
    },

    updateStreakUI: function() {
        const bestEl = document.getElementById('snake-best-score');
        if (bestEl) {
            bestEl.textContent = this.state.bestScore;
        }
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
