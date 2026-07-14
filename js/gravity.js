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
        q: 25,
        rotation: 0,
        dropInterval: 1000, // ms
        timer: null
    },

    init: function() {
        const pauseBtn = document.getElementById('gravity-start-pause');
        const resetBtn = document.getElementById('gravity-reset');
        
        if (pauseBtn) pauseBtn.onclick = () => this.togglePause();
        if (resetBtn) resetBtn.onclick = () => this.reset();

        this.reset();
        this.setupEvents();
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
        const keys = Object.keys(Pieces.TYPES);
        return keys[Math.floor(Math.random() * keys.length)];
    },

    spawnPiece: function() {
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        // Spawn at height 25 (q = 25), centered column index (col = 0)
        // Since col = p + floor(q/2) => 0 = p + 12 => p = -12
        this.state.p = -12;
        this.state.q = 25;
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
        // Decrease drop interval by 50ms per cleared line, min 100ms
        this.state.dropInterval = Math.max(100, 1000 - this.state.linesCleared * 50);
        this.startTimer();
    },

    tick: function() {
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

    dropRowsAbove: function(qClear) {
        const cellsToMove = [];
        Board.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            if (q > qClear) {
                cellsToMove.push({ p, q, val });
            }
        });
        
        // Sort bottom-to-top to prevent overwriting
        cellsToMove.sort((a, b) => a.q - b.q);
        
        // Delete old positions
        cellsToMove.forEach(c => Board.cells.delete(`${c.p},${c.q}`));
        
        // Insert at new vertically dropped positions
        cellsToMove.forEach(c => {
            const down = this.getDown(c.p, c.q);
            Board.cells.set(`${down.p},${down.q}`, c.val);
        });
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
        this.refreshBoard();

        const linesEl = document.getElementById('gravity-lines-count');
        if (linesEl) linesEl.textContent = this.state.linesCleared;

        const best = parseInt(localStorage.getItem('tonntris_gravity_best') || '0');
        if (this.state.linesCleared > best) {
            localStorage.setItem('tonntris_gravity_best', this.state.linesCleared.toString());
        }
        const bestEl = document.getElementById('gravity-best-count');
        if (bestEl) {
            bestEl.textContent = Math.max(best, this.state.linesCleared);
        }

        const speedEl = document.getElementById('gravity-speed-level');
        if (speedEl) speedEl.textContent = (1000 / this.state.dropInterval).toFixed(1) + 'x';
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
            const positions = piece.cells.map(c => Render.getScreenPos(c.p, c.q));
            const minX = Math.min(...positions.map(pos => pos.x));
            const maxX = Math.max(...positions.map(pos => pos.x));
            const minY = Math.min(...positions.map(pos => pos.y));
            const maxY = Math.max(...positions.map(pos => pos.y));
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const padding = 40;
            const size = Math.max(maxX - minX, maxY - minY) + padding * 2;
            svg.setAttribute('viewBox', `${centerX - size/2} ${centerY - size/2} ${size} ${size}`);

            piece.cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: piece.color,
                    stroke: 'white',
                    strokeWidth: 2
                });
                svg.appendChild(hex);
            });
        });
    },

    refreshBoard: function() {
        // Draw 10-wide, 20-high cup background (q from 0 to 19, spawn area up to 27)
        const viewport = { minP: -15, maxP: 15, minQ: -2, maxQ: 27 };
        Render.drawLattice(viewport, { isGravity: true });

        // Render settled cells from Board
        Board.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            if (q < 28) {
                const hex = Render.createHex(p, q, {
                    fill: val.color,
                    stroke: 'white',
                    strokeWidth: 2,
                    className: 'placed-piece',
                    data: { p, q }
                });
                Render.svg.appendChild(hex);
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
                Render.svg.appendChild(hex);
            });

            // Draw active piece labels
            cells.forEach(c => {
                const midi = Tonnetz.getMidi(c.p, c.q);
                const label = Render.createLabel(c.p, c.q, Tonnetz.getNoteName(midi));
                Render.svg.appendChild(label);
            });

            // Render ghost projection
            this.updateGhost();
        }

        // Center viewBox on the cup and spawn area
        Render.updateView(-960, -1280, 2.4);
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
            Render.svg.appendChild(hex);
        });
    },

    setupEvents: function() {
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
                if (Board.checkActivePlacement(this.state.activePiece, this.state.p - 1, this.state.q, this.state.rotation)) {
                    this.state.p -= 1;
                    this.playActivePieceSound(0.06, 0.3);
                    this.refreshUI();
                }
            } else if (key === 'h' || e.key === 'ArrowRight') {
                if (Board.checkActivePlacement(this.state.activePiece, this.state.p + 1, this.state.q, this.state.rotation)) {
                    this.state.p += 1;
                    this.playActivePieceSound(0.06, 0.3);
                    this.refreshUI();
                }
            } else if (key === 'v' || key === 's' || e.key === 'ArrowDown') { // Soft drop
                const down = this.getDown(this.state.p, this.state.q);
                if (Board.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
                    this.state.p = down.p;
                    this.state.q = down.q;
                    this.playActivePieceSound(0.06, 0.3);
                    this.refreshUI();
                }
            }
            
            // 2. Rotate (Space, ArrowUp, or g)
            if (e.code === 'Space') {
                let nextRot = e.shiftKey ? (this.state.rotation + 5) % 6 : (this.state.rotation + 1) % 6;
                if (Board.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
                    this.state.rotation = nextRot;
                    this.playActivePieceSound(0.08, 0.4);
                    this.refreshUI();
                }
            } else if (key === 'g' && !e.shiftKey || e.key === 'ArrowUp') {
                let nextRot = (this.state.rotation + 1) % 6;
                if (Board.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
                    this.state.rotation = nextRot;
                    this.playActivePieceSound(0.08, 0.4);
                    this.refreshUI();
                }
            } else if (e.key === 'ArrowLeft' && e.shiftKey) { // CCW fallback
                let nextRot = (this.state.rotation + 5) % 6;
                if (Board.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
                    this.state.rotation = nextRot;
                    this.playActivePieceSound(0.08, 0.4);
                    this.refreshUI();
                }
            }
        };
    }
};
