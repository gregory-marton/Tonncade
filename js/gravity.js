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
 * gravity.js - Controller for Gravity Mode (falling blocks with slide physics).
 */

const GravityMode = {
    state: {
        nextQueue: [],
        linesCleared: 0,
        isGameOver: false,
        isPaused: false,
        activePiece: null, // Piece type key ('I', 'O', etc.)
        p: 0,
        q: 17,
        rotation: 0,
        dropInterval: 1000, // ms
        timer: null,
        difficulty: (typeof localStorage !== 'undefined' && localStorage.getItem('tonncade_gravity_difficulty')) || 'hard',
    },

    init: function() {
        const pauseBtn = document.getElementById('gravity-start-pause');
        const resetBtn = document.getElementById('gravity-reset');
        
        if (pauseBtn) pauseBtn.onclick = () => this.togglePause();
        if (resetBtn) resetBtn.onclick = () => this.reset();

        // #tonnetz-svg's on-screen box can still be settling the first time refreshBoard() runs
        // here (mobile layout uses `100dvh`, which Chromium can take an extra tick to resolve to
        // its final value) -- refreshBoard()'s aspect-matched fit (see
        // Render.getAspectMatchedRefBox) would otherwise permanently fit against that transient,
        // too-small size, since nothing else re-triggers it once the game is running. A
        // ResizeObserver re-fits whenever the element's actual box changes, for any reason,
        // self-correcting regardless of the specific cause.
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

        this.reset();
        this.setupEvents();
    },

    // Real report (issue #9): the "done" Gravity board stayed on screen after switching to
    // another mode. Root cause was that nothing ever called this -- js/main.js's setMode only
    // ever cleared state.timer inline, leaving the ResizeObserver above watching Render.svg (the
    // one <svg> every mode shares) forever. Since its callback unconditionally repaints Gravity's
    // own viewport + Board.cells, any LATER layout reflow -- e.g. switching to a mode whose
    // sidebar content is a different size -- fired it again and overwrote the new mode's board
    // with Gravity's stale one. Nulling both the timer and the observer here, matching every
    // other mode's own cleanup(), is what actually stops it for good.
    cleanup: function() {
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    },

    reset: function() {
        Board.cells.clear();
        this.state.linesCleared = 0;
        this.state.isGameOver = false;
        this.state.isPaused = false;
        this.state.dropInterval = 1000;
        this.state.nextQueue = [this.randomPiece(), this.randomPiece(), this.randomPiece()];
        
        const pauseBtn = document.getElementById('gravity-start-pause');
        if (pauseBtn) pauseBtn.textContent = 'Pause';

        if (this.state.timer) {
            clearInterval(this.state.timer);
        }
        
        this.spawnPiece();
        this.startTimer();
        this.refreshUI();
    },

    togglePause: function() {
        if (this.state.isGameOver) return;
        
        const pauseBtn = document.getElementById('gravity-start-pause');
        if (this.state.isPaused) {
            this.state.isPaused = false;
            if (pauseBtn) pauseBtn.textContent = 'Pause';
            this.startTimer();
        } else {
            this.state.isPaused = true;
            if (pauseBtn) pauseBtn.textContent = 'Resume';
            if (this.state.timer) clearInterval(this.state.timer);
        }
        this.refreshUI();
    },

    randomPiece: function() {
        const keys = Pieces.DIFFICULTY_KEYS[this.state.difficulty] || Pieces.TETRAHEX_KEYS;
        return keys[Math.floor(Math.random() * keys.length)];
    },

    // Piece-size difficulty (task #39): easy=small pieces .. hard=tetrahexes only. Persisted, and
    // reflected in the dumbbell-triplet control.
    setDifficulty: function(diff) {
        if (!Pieces.DIFFICULTY_KEYS[diff]) return;
        this.state.difficulty = diff;
        try { localStorage.setItem('tonncade_gravity_difficulty', diff); } catch (e) {}
        this.updateDifficultyUI();
    },

    updateDifficultyUI: function() {
        const order = { easy: 1, medium: 2, hard: 3 };
        const lit = order[this.state.difficulty] || 3;
        document.querySelectorAll('#gravity-difficulty .weight-icon').forEach((el, i) => {
            el.classList.toggle('lit', i < lit);
        });
    },

    spawnPiece: function() {
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        // Spawn at height 17 (q = 17), centered column index (col = 0)
        // Since col = p + floor(q/2) => 0 = p + 8 => p = -8
        this.state.p = -8;
        this.state.q = 17;
        this.state.rotation = 0;

        // Check if spawn position is blocked (using active placement with wider bounds)
        if (!Board.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, this.state.rotation)) {
            this.state.isGameOver = true;
            if (this.state.timer) clearInterval(this.state.timer);
            setTimeout(() => alert("Game Over! Lines cleared: " + this.state.linesCleared), 100);
        } else {
            this.playActivePieceSound(0.08, 0.4); // soft sound on spawn
        }
    },

    startTimer: function() {
        if (this.state.timer) clearInterval(this.state.timer);
        this.state.timer = setInterval(() => this.tick(), this.state.dropInterval);
    },

    updateSpeed: function() {
        // Decrease drop interval by 20ms per cleared line, min 100ms
        this.state.dropInterval = Math.max(100, 1000 - this.state.linesCleared * 20);
        this.startTimer();
    },

    tick: function() {
        if (typeof Replay !== 'undefined') Replay.recordTick();
        if (this.state.isGameOver || this.state.isPaused) return;

        const down = this.getDown(this.state.p, this.state.q);
        
        // 1. Try to move straight down
        if (Board.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
            this.state.p = down.p;
            this.state.q = down.q;
            this.playActivePieceSound(0.06, 0.3); // tick sound
            this.refreshUI();
        } else {
            // 2. Straight down path is blocked. Slide down diagonally as a rigid body:
            // If q is odd, straight down was DL (p, q-1), so alternative is DR (p+1, q-1)
            // If q is even, straight down was DR (p+1, q-1), so alternative is DL (p, q-1)
            let slidePos;
            if (this.state.q % 2 !== 0) {
                slidePos = { p: this.state.p + 1, q: this.state.q - 1 };
            } else {
                slidePos = { p: this.state.p, q: this.state.q - 1 };
            }

            if (Board.checkActivePlacement(this.state.activePiece, slidePos.p, slidePos.q, this.state.rotation)) {
                this.state.p = slidePos.p;
                this.state.q = slidePos.q;
                this.playActivePieceSound(0.06, 0.3);
                this.refreshUI();
            } else {
                // Both blocked: lock the piece in place rigidly
                this.lockActivePiece();
            }
        }
    },

    lockActivePiece: function() {
        const cells = Pieces.getAbsoluteCells(this.state.activePiece, this.state.p, this.state.q, this.state.rotation);
        Board.fillCells(cells, this.state.activePiece, Pieces.TYPES[this.state.activePiece].color);

        // Solid placement chord
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        Synth.playChord(midis, true, 0.16, 1.2);

        // Clear completed lines and slide remaining blocks above down vertically
        this.processClears();

        if (!this.state.isGameOver) {
            this.spawnPiece();
            this.refreshUI();
        }
    },

    processClears: function() {
        let lines = Board.findFullLines();
        let clearedCount = 0;
        
        while (lines.length > 0) {
            const allNotes = [];
            // Sort lines by row index q descending (top rows first) to prevent shifting index confusion
            lines.sort((a, b) => b[0].q - a[0].q);

            lines.forEach(line => {
                const qClear = line[0].q;
                line.forEach(c => allNotes.push(Tonnetz.getMidi(c.p, c.q)));
                Board.clearCells(line);
                this.state.linesCleared++;
                clearedCount++;
                
                // Shift all rows above this cleared row vertically down by 1 unit
                this.dropRowsAbove(qClear);
            });

            // Cleared chord sound
            Synth.playChord([...new Set(allNotes)], false, 0.22, 1.5);

            // Re-evaluate if dropping completed new lines
            lines = Board.findFullLines();
        }

        if (clearedCount > 0) {
            this.updateSpeed();
        }
    },

    getDown: function(p, q) {
        if (q % 2 !== 0) {
            return { p: p, q: q - 1 };
        } else {
            return { p: p + 1, q: q - 1 };
        }
    },

    // Shifts every locked cell above the cleared row down by one row -- but as a set of RIGID
    // connected components, not cell-by-cell. getDown(p, q)'s zigzag (p unchanged for odd q,
    // p+1 for even q) is only valid for moving a SINGLE reference point down by one row -- it's
    // how a falling piece's own anchor moves, with the piece's actual shape always recomputed
    // fresh from that one anchor (Pieces.getAbsoluteCells), never touching individual cells.
    // Calling it on every ALREADY-LOCKED cell independently, using each cell's own row parity,
    // tears a structure apart the moment it spans both an even and an odd row: two cells that
    // were hex-neighbors before the shift can land on a non-neighbor relative offset after it
    // (found live, GitHub issue #6 -- a connected mass split into a solid base and a visibly
    // floating fragment the instant a line below it cleared). The fix: group cells into
    // connected components first (matching real physical structure -- pieces locked at
    // different times can end up touching, merging into one mass), then shift each component
    // by a single, uniform (dp, dq) offset -- a uniform translation preserves every relative
    // offset within the component by construction, so its shape can never be sheared.
    dropRowsAbove: function(qClear) {
        const cellsAbove = [];
        Board.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            if (q > qClear) cellsAbove.push({ p, q, val, key });
        });
        if (cellsAbove.length === 0) return;

        const byKey = new Map(cellsAbove.map(c => [c.key, c]));
        const visited = new Set();
        const components = [];
        for (const start of cellsAbove) {
            if (visited.has(start.key)) continue;
            const component = [];
            const stack = [start];
            visited.add(start.key);
            while (stack.length) {
                const cur = stack.pop();
                component.push(cur);
                for (const n of Tonnetz.getNeighbors(cur.p, cur.q)) {
                    const nk = `${n.p},${n.q}`;
                    const neighborCell = byKey.get(nk);
                    if (neighborCell && !visited.has(nk)) {
                        visited.add(nk);
                        stack.push(neighborCell);
                    }
                }
            }
            components.push(component);
        }

        // Delete every old position first, across all components, before inserting any new
        // one -- otherwise one component's insert could land on and overwrite another
        // component's not-yet-relocated old cell.
        cellsAbove.forEach(c => Board.cells.delete(c.key));

        for (const component of components) {
            const ref = component[0];
            const down = this.getDown(ref.p, ref.q);
            const dp = down.p - ref.p;
            const dq = down.q - ref.q;
            component.forEach(c => {
                Board.cells.set(`${c.p + dp},${c.q + dq}`, c.val);
            });
        }
    },

    hardDrop: function() {
        let p = this.state.p;
        let q = this.state.q;
        let moved = true;

        // Simulate falling path with sliding rules to find landing spot
        while (moved) {
            const down = this.getDown(p, q);
            if (Board.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
                p = down.p;
                q = down.q;
            } else {
                let slidePos;
                if (q % 2 !== 0) {
                    slidePos = { p: p + 1, q: q - 1 };
                } else {
                    slidePos = { p: p, q: q - 1 };
                }

                if (Board.checkActivePlacement(this.state.activePiece, slidePos.p, slidePos.q, this.state.rotation)) {
                    p = slidePos.p;
                    q = slidePos.q;
                } else {
                    moved = false;
                }
            }
        }

        this.state.p = p;
        this.state.q = q;
        this.lockActivePiece();
    },

    playActivePieceSound: function(peak = 0.1, dur = 0.8) {
        if (!this.state.activePiece) return;
        const cells = Pieces.getAbsoluteCells(this.state.activePiece, this.state.p, this.state.q, this.state.rotation);
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        Synth.playChord(midis, true, peak, dur);
    },

    refreshUI: function() {
        this.renderNextQueue();

        // #gravity-controls's own text content must be set BEFORE refreshBoard() (which measures
        // its real rendered size via Render.fitContentBox/measureChromeClearance, INV-40) --
        // these used to be populated AFTER refreshBoard(), so the very first fit of a session
        // measured an empty, not-yet-sized panel instead of its true final height, occasionally
        // leaving the board mis-fit until some later, unrelated resize happened to correct it
        // (found live via INV-10 flaking on rapid mode entry).
        const linesEl = document.getElementById('gravity-lines-count');
        if (linesEl) linesEl.textContent = this.state.linesCleared;

        const best = parseInt(localStorage.getItem('tonncade_gravity_best') || '0');
        if (this.state.linesCleared > best) {
            localStorage.setItem('tonncade_gravity_best', this.state.linesCleared.toString());
        }
        const bestVal = Math.max(best, this.state.linesCleared);
        const bestEl = document.getElementById('gravity-best-count');
        if (bestEl) {
            bestEl.textContent = bestVal;
        }
        Render.setStatBar('gravity-lines-fill', this.state.linesCleared, bestVal);

        const speedEl = document.getElementById('gravity-speed-level');
        if (speedEl) speedEl.textContent = (1000 / this.state.dropInterval).toFixed(1) + 'x';

        this.refreshBoard();
    },

    renderNextQueue: function() {
        const list = document.getElementById('piece-list');
        if (!list) return;

        list.innerHTML = '<h3>Next Pieces</h3>';
        this.state.nextQueue.forEach((key) => {
            const piece = Pieces.TYPES[key];
            const div = document.createElement('div');
            div.className = 'piece-item next-item';
            div.innerHTML = `
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;
            list.appendChild(div);

            const svg = div.querySelector('.piece-preview');
            SandboxMode.renderPiecePreview(svg, piece.cells, piece.color);
        });
    },

    refreshBoard: function() {
        // Draw 10-wide, 20-high cup background (q from 0 to 19, spawn area up to 19)
        const viewport = { minP: -20, maxP: 10, minQ: -2, maxQ: 20 };
        Render.drawLattice(viewport, { isGravity: true });

        // Render settled cells from Board
        Board.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            if (q < 20) {
                const hex = Render.createHex(p, q, {
                    fill: val.color,
                    stroke: 'white',
                    strokeWidth: 2,
                    className: 'placed-piece',
                    data: { p, q }
                });
                Render.appendToLattice(hex);
            }
        });

        // Render active falling piece (above-cup cells visible)
        if (this.state.activePiece && !this.state.isGameOver) {
            const cells = Pieces.getAbsoluteCells(this.state.activePiece, this.state.p, this.state.q, this.state.rotation);
            const color = Pieces.TYPES[this.state.activePiece].color;
            cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: color,
                    stroke: 'white',
                    strokeWidth: 2,
                    className: 'active-piece'
                });
                Render.appendToLattice(hex);
            });

            // Draw active piece labels
            cells.forEach(c => {
                const midi = Tonnetz.getMidi(c.p, c.q);
                const label = Render.createLabel(c.p, c.q, Tonnetz.getNoteName(midi));
                Render.appendToLattice(label);
            });

            // Render ghost projection
            this.updateGhost();
        }

        const cupCells = [];
        for (let q = 0; q < 20; q++) {
            for (let p = -20; p <= 10; p++) {
                const col = p + Math.floor(q / 2);
                if (col < -5 || col > 4) continue;
                cupCells.push({ p, q });
            }
        }
        // The cup is much taller than wide -- fit it against #tonnetz-svg's own actual on-screen
        // aspect ratio (see Render.getAspectMatchedRefBox) rather than the historical fixed 4:3
        // reference box, so it fills the element's real box instead of being letterboxed inside
        // a mismatched shape.
        // Choose the sides-vs-top control layout from the cup's width against the viewport (not
        // orientation) BEFORE measuring chrome, so the two chrome-measurement passes below see the
        // controls in their chosen positions. See Render.updateGravityLayout.
        Render.updateGravityLayout(cupCells);
        Render.updateChromeInsets();
        Render.fitContentBox(cupCells, Render.HEX_R * 2);
        const { refW, refH } = Render.getAspectMatchedRefBox();
        // scale 1.15 (like Snake) rather than 1: the board is a tall grid and its aspect-matched
        // box often can't fill both axes of the container, so scale=1 left the cells noticeably
        // shy of the box on the binding axis, wasting reclaimable space (the user's "make it bigger
        // if there's room"). 1.15 zooms the cells to fill the box while keeping the whole cup
        // visible (verified: no cell clipped -- INV-11/35).
        const fit = Render.getFitView(cupCells, Render.HEX_R * 2, 1.15, refW, refH);
        Render.updateView(fit.viewX, fit.viewY, fit.zoom, refW, refH);
    },

    updateGhost: function() {
        if (!this.state.activePiece || this.state.isGameOver) return;
        
        let ghostQ = this.state.q;
        let ghostP = this.state.p;
        let next = this.getDown(ghostP, ghostQ);
        
        // Trace ghost landing using slide physics path
        let moved = true;
        while (moved) {
            const down = this.getDown(ghostP, ghostQ);
            if (Board.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
                ghostP = down.p;
                ghostQ = down.q;
            } else {
                let slidePos;
                if (ghostQ % 2 !== 0) {
                    slidePos = { p: ghostP + 1, q: ghostQ - 1 };
                } else {
                    slidePos = { p: ghostP, q: ghostQ - 1 };
                }

                if (Board.checkActivePlacement(this.state.activePiece, slidePos.p, slidePos.q, this.state.rotation)) {
                    ghostP = slidePos.p;
                    ghostQ = slidePos.q;
                } else {
                    moved = false;
                }
            }
        }

        const cells = Pieces.getAbsoluteCells(this.state.activePiece, ghostP, ghostQ, this.state.rotation);
        const color = Pieces.TYPES[this.state.activePiece].color;
        
        cells.forEach(c => {
            const hex = Render.createHex(c.p, c.q, {
                fill: color,
                className: 'ghost'
            });
            hex.style.pointerEvents = 'none';
            Render.appendToLattice(hex);
        });
    },

    // The 5 actions below (moveLeft/moveRight/softDrop/rotateCW/rotateCCW) are the same 5
    // actions the portrait D-pad exposes (m-btn-left/ccw/action/cw/right) -- named and shared
    // here so both the keyboard handler and MidiInput's note-on routing (see handleMidiNote,
    // issue #11) drive the exact same placement-check-then-mutate-then-sound-then-refresh logic
    // instead of duplicating it.
    moveLeft: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        if (Board.checkActivePlacement(this.state.activePiece, this.state.p - 1, this.state.q, this.state.rotation)) {
            this.state.p -= 1;
            this.playActivePieceSound(0.06, 0.3);
            this.refreshUI();
        }
    },

    moveRight: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        if (Board.checkActivePlacement(this.state.activePiece, this.state.p + 1, this.state.q, this.state.rotation)) {
            this.state.p += 1;
            this.playActivePieceSound(0.06, 0.3);
            this.refreshUI();
        }
    },

    softDrop: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        const down = this.getDown(this.state.p, this.state.q);
        if (Board.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
            this.state.p = down.p;
            this.state.q = down.q;
            this.playActivePieceSound(0.06, 0.3);
            this.refreshUI();
        }
    },

    rotateCW: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        const nextRot = (this.state.rotation + 1) % 6;
        if (Board.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
            this.state.rotation = nextRot;
            this.playActivePieceSound(0.08, 0.4);
            this.refreshUI();
        }
    },

    rotateCCW: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        const nextRot = (this.state.rotation + 5) % 6;
        if (Board.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
            this.state.rotation = nextRot;
            this.playActivePieceSound(0.08, 0.4);
            this.refreshUI();
        }
    },

    // Issue #11: a MIDI keyboard's middle C/D/E/F/G (MIDI 60/62/64/65/67) drive the same 5
    // actions as the portrait D-pad, left-to-right, matching the notes' own left-to-right
    // ascending order on a real keyboard -- C=left, D=CCW, E=soft-drop, F=CW, G=right. Regular
    // keyboard/touch controls stay exactly as they were; this is purely an additional input.
    handleMidiNote: function(midi) {
        const action = { 60: 'moveLeft', 62: 'rotateCCW', 64: 'softDrop', 65: 'rotateCW', 67: 'moveRight' }[midi];
        if (action) this[action]();
    },

    setupEvents: function() {
        // Dumbbell-triplet difficulty picker: click the Nth weight to set easy/medium/hard.
        document.querySelectorAll('#gravity-difficulty .weight-icon').forEach(el => {
            el.onclick = () => this.setDifficulty(el.dataset.difficulty);
        });
        this.updateDifficultyUI();

        window.onkeydown = (e) => {
            const key = e.key.toLowerCase();

            // Allow toggling pause with 'Escape' or 'p' key
            if (e.key === 'Escape' || e.key === 'Esc' || key === 'p') {
                e.preventDefault();
                this.togglePause();
                return;
            }

            if (this.state.isPaused || this.state.isGameOver) return;

            // Prevent default browser scrolling actions on game controls
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key) || e.code === 'Space') {
                e.preventDefault();
            }

            // 1. Move Left/Right (allows half-step columns [-6, 5])
            if (key === 'f' || e.key === 'ArrowLeft') {
                this.moveLeft();
            } else if (key === 'h' || e.key === 'ArrowRight') {
                this.moveRight();
            } else if (key === 'v' || key === 's' || e.key === 'ArrowDown') { // Soft drop
                this.softDrop();
            }

            // 2. Rotate (Space, ArrowUp, or g)
            if (e.code === 'Space') {
                if (e.shiftKey) this.rotateCCW(); else this.rotateCW();
            } else if (key === 'g' && !e.shiftKey || e.key === 'ArrowUp') {
                this.rotateCW();
            } else if (e.key === 'ArrowLeft' && e.shiftKey) { // CCW fallback
                this.rotateCCW();
            }
        };
    }
};
