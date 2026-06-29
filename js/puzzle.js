/**
 * puzzle.js - Controller for Puzzle Mode.
 */

const PuzzleMode = {
    state: {
        nextQueue: [],
        linesCleared: 0,
        isGameOver: false,
        activePiece: null,
        rotation: 0,
        hoverCell: { p: 0, q: 0 }
    },

    init: function() {
        this.reset();
        this.setupEvents();
    },

    reset: function() {
        Board.cells.clear();
        this.state.linesCleared = 0;
        this.state.isGameOver = false;
        this.state.nextQueue = [this.randomPiece(), this.randomPiece(), this.randomPiece()];
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        this.refreshUI();
    },

    randomPiece: function() {
        const keys = Object.keys(Pieces.TYPES);
        return keys[Math.floor(Math.random() * keys.length)];
    },

    refreshUI: function() {
        this.renderNextQueue();
        this.refreshBoard();
        
        const linesEl = document.getElementById('lines-count');
        if (linesEl) linesEl.textContent = this.state.linesCleared;
    },

    renderNextQueue: function() {
        const list = document.getElementById('piece-list');
        if (!list) return;
        
        list.innerHTML = '<h3>Next Pieces</h3>';
        this.state.nextQueue.forEach((key, i) => {
            const piece = Pieces.TYPES[key];
            const div = document.createElement('div');
            div.className = 'piece-item next-item';
            div.innerHTML = `
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;
            list.appendChild(div);
            
            // Preview logic
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
        const viewport = { minP: -6, maxP: 6, minQ: -6, maxQ: 6 };
        Render.drawLattice(viewport, { isPuzzle: true });
        
        // Render placed cells from Board state
        Board.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            const hex = Render.createHex(p, q, {
                fill: val.color,
                stroke: 'white',
                strokeWidth: 2,
                className: 'placed-piece',
                data: { p, q }
            });
            Render.svg.appendChild(hex);
        });

        Render.updateView(-400, -300, 1);
    },

    setupEvents: function() {
        const svg = Render.svg;

        window.onmousemove = (e) => {
            if (this.state.isGameOver) return;
            this.updateGhost(e);
        };

        window.onkeydown = (e) => {
            if (this.state.isGameOver) return;
            
            const key = e.key.toLowerCase();

            // 1. Navigation (ftyhbv cluster)
            const move = {
                'f': {p:-1, q:0}, 'h': {p:1, q:0},
                'y': {p:0, q:1},  'v': {p:0, q:-1},
                't': {p:-1, q:1}, 'b': {p:1, q:-1}
            }[key];

            if (move) {
                this.state.hoverCell.p += move.p;
                this.state.hoverCell.q += move.q;
                this.updateGhost();
                return;
            }

            // 2. Rotation (Space, Arrows, or g)
            if (e.code === 'Space') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.state.rotation = (this.state.rotation + 5) % 6; // CCW
                } else {
                    this.state.rotation = (this.state.rotation + 1) % 6; // CW
                }
                this.updateGhost();
            } else if ((key === 'g' && !e.shiftKey) || e.key === 'ArrowRight') {
                this.state.rotation = (this.state.rotation + 1) % 6;
                this.updateGhost();
            } else if (e.key === 'ArrowLeft') {
                this.state.rotation = (this.state.rotation + 5) % 6;
                this.updateGhost();
            }

            // 3. Action (Shift-G)
            if (key === 'g' && e.shiftKey) {
                const {p, q} = this.state.hoverCell;
                if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
                    this.placePiece(p, q);
                }
            }
        };

        svg.onmousedown = (e) => {
            if (this.state.isGameOver) return;
            
            const isHex = e.target.tagName.toLowerCase() === 'polygon';
            const p = isHex ? parseInt(e.target.getAttribute('data-p')) : null;
            const q = isHex ? parseInt(e.target.getAttribute('data-q')) : null;

            if (isHex && this.state.activePiece) {
                this.state.hoverCell = { p, q };
                if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
                    this.placePiece(p, q);
                }
            }
        };
    },

    updateGhost: function(e) {
        const oldGhosts = document.querySelectorAll('.ghost');
        oldGhosts.forEach(g => g.remove());

        if (this.state.isGameOver || !this.state.activePiece) return;

        let p, q;
        if (e && e.target && e.target.getAttribute('data-p')) {
            p = parseInt(e.target.getAttribute('data-p'));
            q = parseInt(e.target.getAttribute('data-q'));
            this.state.hoverCell = {p, q};
        } else {
            p = this.state.hoverCell.p;
            q = this.state.hoverCell.q;
        }

        if (p !== undefined) {
            const cells = Pieces.getAbsoluteCells(this.state.activePiece, p, q, this.state.rotation);
            const canPlace = cells.every(c => Board.isCellEmpty(c.p, c.q));
            const color = canPlace ? Pieces.TYPES[this.state.activePiece].color : '#555555';
            
            cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: color,
                    className: 'ghost',
                    data: { p: c.p, q: c.q }
                });
                hex.style.pointerEvents = 'none';
                Render.svg.appendChild(hex);
            });
        }
    },

    placePiece: function(p, q) {
        const cells = Pieces.getAbsoluteCells(this.state.activePiece, p, q, this.state.rotation);
        Board.fillCells(cells, this.state.activePiece, Pieces.TYPES[this.state.activePiece].color);
        
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        Synth.playChord(midis);
        
        this.processClears();
        
        // Next piece
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        if (Board.checkGameOver(this.state.activePiece)) {
            this.state.isGameOver = true;
            setTimeout(() => alert("Game Over! Lines cleared: " + this.state.linesCleared), 100);
        }
        
        this.refreshUI();
    },

    processClears: function() {
        const lines = Board.findFullLines();
        if (lines.length > 0) {
            const allNotes = [];
            lines.forEach(line => {
                line.forEach(c => allNotes.push(Tonnetz.getMidi(c.p, c.q)));
                Board.clearCells(line);
                this.state.linesCleared++;
            });
            // Simultaneous playback of all cleared notes
            Synth.playChord([...new Set(allNotes)], false);
        }
    }
};
