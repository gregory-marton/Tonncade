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
 * blast.js - Controller for Blast Mode.
 */

const BlastMode = {
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
        const keys = Pieces.TETRAHEX_KEYS;
        return keys[Math.floor(Math.random() * keys.length)];
    },

    refreshUI: function() {
        this.renderNextQueue();
        this.refreshBoard();
        this.updateGhost();

        const linesEl = document.getElementById('lines-count');
        if (linesEl) linesEl.textContent = this.state.linesCleared;

        const best = parseInt(localStorage.getItem('tonncade_blast_best') || '0');
        if (this.state.linesCleared > best) {
            localStorage.setItem('tonncade_blast_best', this.state.linesCleared.toString());
        }
        const bestEl = document.getElementById('blast-best-count');
        if (bestEl) {
            bestEl.textContent = Math.max(best, this.state.linesCleared);
        }
    },

    renderNextQueue: function() {
        const list = document.getElementById('piece-list');
        if (!list) return;

        list.innerHTML = '';

        if (this.state.activePiece) {
            const piece = Pieces.TYPES[this.state.activePiece];
            const div = document.createElement('div');
            div.className = 'piece-item active-item';
            div.title = 'Tap to place (same as swipe down)';
            div.innerHTML = `
                <div class="active-item-arrow">▼</div>
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;
            div.onclick = () => this.placeActiveGhost();
            list.appendChild(div);

            const svg = div.querySelector('.piece-preview');
            SandboxMode.renderPiecePreview(svg, piece.cells, piece.color);
        }

        const heading = document.createElement('h3');
        heading.textContent = 'Next Pieces';
        list.appendChild(heading);

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

    // Places the active piece's current ghost, same as swipe-down — no-op if the ghost's
    // position isn't actually a valid placement.
    placeActiveGhost: function() {
        if (this.state.isGameOver || !this.state.activePiece) return;
        const { p, q } = this.state.hoverCell;
        if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
            this.placePiece(p, q);
        }
    },

    refreshBoard: function() {
        const viewport = { minP: -6, maxP: 6, minQ: -6, maxQ: 6 };
        Render.drawLattice(viewport, { isBlast: true });
        
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

        const boardCells = [];
        for (let p = -Board.radius; p <= Board.radius; p++) {
            for (let q = -Board.radius; q <= Board.radius; q++) {
                if (Board.isInBounds(p, q)) boardCells.push({ p, q });
            }
        }
        const fit = Render.getFitView(boardCells, Render.HEX_R * 2, 1.25);
        Render.updateView(fit.viewX, fit.viewY, fit.zoom);
    },

    setupEvents: function() {
        const svg = Render.svg;

        const resetBtn = document.getElementById('blast-reset');
        if (resetBtn) {
            resetBtn.onclick = () => {
                this.reset();
            };
        }

        window.onmousemove = (e) => {
            if (this.state.isGameOver) return;
            this.updateGhost(e);
        };

        window.onkeydown = (e) => {
            if (this.state.isGameOver) return;
            
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key) || e.code === 'Space') {
                e.preventDefault();
            }

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
                const isSameCell = this.state.hoverCell.p === p && this.state.hoverCell.q === q;
                
                this.state.hoverCell = { p, q };
                this.updateGhost();

                if (isSameCell) {
                    if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
                        this.placePiece(p, q);
                    }
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
            setTimeout(() => alert(`Game Over! Cannot place piece: ${this.state.activePiece}\nLines cleared: ${this.state.linesCleared}`), 100);
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
