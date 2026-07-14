/**
 * chop.js - Main controller for Chop Mode (Infinite Sandbox).
 */

const ChopMode = {
    state: {
        viewX: -400,
        viewY: -300,
        zoom: 1,
        selectedPiece: null,
        rotation: 0,
        placedPieces: [], // { type, p, q, rotation }
        isPanning: false,
        lastMouse: { x: 0, y: 0 },
        hoverCell: { p: 0, q: 0 }
    },

    init: function() {
        Render.init('tonnetz-svg');
        this.renderPalette();
        this.refreshLattice();
        this.setupEvents();

        // Ensure single game-tooltip exists in DOM
        if (!document.querySelector('.game-tooltip')) {
            const tip = document.createElement('div');
            tip.className = 'game-tooltip';
            document.body.appendChild(tip);
        }
    },

    renderPalette: function() {
        const list = document.getElementById('piece-list');
        list.innerHTML = '';
        
        for (const key in Pieces.TYPES) {
            const piece = Pieces.TYPES[key];
            const div = document.createElement('div');
            div.className = 'piece-item';
            div.setAttribute('data-key', key);
            div.innerHTML = `
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;
            
            div.onclick = () => this.togglePiece(key);
            list.appendChild(div);
            
            // Render small preview
            const previewSvg = div.querySelector('.piece-preview');
            
            // Find bounds of the piece to center it
            const positions = piece.cells.map(c => Render.getScreenPos(c.p, c.q));
            const minX = Math.min(...positions.map(pos => pos.x));
            const maxX = Math.max(...positions.map(pos => pos.x));
            const minY = Math.min(...positions.map(pos => pos.y));
            const maxY = Math.max(...positions.map(pos => pos.y));
            
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const padding = 40;
            const size = Math.max(maxX - minX, maxY - minY) + padding * 2;
            
            previewSvg.setAttribute('viewBox', `${centerX - size/2} ${centerY - size/2} ${size} ${size}`);

            piece.cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: piece.color,
                    stroke: 'white',
                    strokeWidth: 2
                });
                previewSvg.appendChild(hex);
            });
        }
    },

    togglePiece: function(key) {
        if (this.state.selectedPiece === key) {
            this.state.selectedPiece = null;
        } else {
            this.selectPiece(key);
        }
        this.updatePaletteHighlight();
    },

    selectPiece: function(key) {
        this.state.selectedPiece = key;
        this.state.rotation = 0;
        this.updatePaletteHighlight();
    },

    updatePaletteHighlight: function() {
        document.querySelectorAll('.piece-item').forEach((item) => {
            const k = item.getAttribute('data-key');
            item.classList.toggle('selected', k === this.state.selectedPiece);
        });
    },

    refreshLattice: function() {
        const viewport = {
            minP: -15, maxP: 15,
            minQ: -15, maxQ: 15
        };
        Render.drawLattice(viewport, {});
        this.renderPlacedPieces();
        
        // Re-append note and keyboard labels to the end of the SVG so they render on top of placed pieces
        const labels = Array.from(Render.svg.querySelectorAll('.note-label, .qwerty-label'));
        labels.forEach(lbl => Render.svg.appendChild(lbl));

        Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
    },

    renderPlacedPieces: function() {
        this.state.placedPieces.forEach(piece => {
            const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
            const color = Pieces.TYPES[piece.type].color;
            cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: color,
                    stroke: 'white',
                    strokeWidth: 2,
                    className: 'placed-piece',
                    data: { placed: true, p: c.p, q: c.q }
                });
                
                // Attach hover listeners for placed piece chord tooltips
                hex.onmouseenter = (e) => this.showPlacedTooltip(e, piece, cells);
                hex.onmouseleave = () => this.hidePlacedTooltip();
                hex.onmousemove = (e) => this.movePlacedTooltip(e);

                Render.svg.appendChild(hex);
            });
        });
    },

    setupEvents: function() {
        const svg = Render.svg;

        window.onkeydown = (e) => {
            const key = e.key.toLowerCase();
            const upperKey = e.key.toUpperCase();
            
            // 1. Piece selection
            if (Pieces.TYPES[upperKey]) {
                this.selectPiece(upperKey);
                this.updateGhost();
                return;
            }

            // 2. Navigation (ftyhbv cluster)
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

            // 3. Rotation (Space, Arrows, or g)
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

            // 4. Action (Shift-G)
            if (key === 'g' && e.shiftKey) {
                this.handleAction(this.state.hoverCell.p, this.state.hoverCell.q);
            }
        };

        svg.onmousedown = (e) => {
            const isHex = e.target.tagName.toLowerCase() === 'polygon';
            const p = isHex ? parseInt(e.target.getAttribute('data-p')) : null;
            const q = isHex ? parseInt(e.target.getAttribute('data-q')) : null;

            if (isHex) {
                const isSameCell = this.state.hoverCell.p === p && this.state.hoverCell.q === q;
                
                this.state.hoverCell = { p, q };
                if (this.state.selectedPiece) {
                    this.updateGhost();
                }

                // Instantly pick up existing pieces on tap, but require double tap to place a new one
                const isExistingPiece = this.state.placedPieces.some(piece => {
                    const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
                    return cells.some(c => c.p === p && c.q === q);
                });

                if (isSameCell || isExistingPiece || !this.state.selectedPiece) {
                    this.handleAction(p, q);
                }
            }
            
            this.state.isPanning = true;
            this.state.lastMouse = { x: e.clientX, y: e.clientY };
        };

        window.onmousemove = (e) => {
            if (this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
            }
            
            if (this.state.selectedPiece) {
                this.updateGhost(e);
            }
        };

        window.onmouseup = () => {
            this.state.isPanning = false;
        };
    },

    handleAction: function(p, q) {
        // 1. Pickup/Swap check
        const pieceIndex = this.state.placedPieces.findIndex(piece => {
            const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
            return cells.some(c => c.p === p && c.q === q);
        });

        if (pieceIndex !== -1) {
            const piece = this.state.placedPieces.splice(pieceIndex, 1)[0];
            this.selectPiece(piece.type);
            this.state.rotation = piece.rotation;
            this.refreshLattice();
            this.updateGhost();
            
            const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
            const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
            const chordName = Tonnetz.analyzeChord(midis);
            if (chordName) {
                this.spawnTransientTooltip('Removed: ' + chordName, piece.p, piece.q, 'removed');
            }
            
            Synth.playChord(midis);
            return;
        }

        // 2. Placement
        if (this.state.selectedPiece) {
            if (this.canPlace(this.state.selectedPiece, p, q, this.state.rotation)) {
                this.placePiece(p, q);
            }
        } else {
            // 3. Play note
            const midi = Tonnetz.getMidi(p, q);
            Synth.playNote(midi);
        }
    },

    updateGhost: function(e) {
        const oldGhosts = document.querySelectorAll('.ghost');
        oldGhosts.forEach(g => g.remove());

        if (!this.state.selectedPiece) return;

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
            const cells = Pieces.getAbsoluteCells(this.state.selectedPiece, p, q, this.state.rotation);
            const canPlace = this.canPlace(this.state.selectedPiece, p, q, this.state.rotation);
            const color = canPlace ? Pieces.TYPES[this.state.selectedPiece].color : '#555555';
            
            cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: color,
                    className: 'ghost',
                    data: { p: c.p, q: c.q }
                });
                hex.style.pointerEvents = 'none';
                Render.svg.appendChild(hex);
            });

            // Re-append note and keyboard labels so they stay on top of the ghost piece
            const labels = Array.from(Render.svg.querySelectorAll('.note-label, .qwerty-label'));
            labels.forEach(lbl => Render.svg.appendChild(lbl));
        }
    },

    canPlace: function(type, p, q, rotation) {
        const newCells = Pieces.getAbsoluteCells(type, p, q, rotation);
        for (const placed of this.state.placedPieces) {
            const existingCells = Pieces.getAbsoluteCells(placed.type, placed.p, placed.q, placed.rotation);
            for (const nc of newCells) {
                if (existingCells.some(ec => ec.p === nc.p && ec.q === nc.q)) {
                    return false;
                }
            }
        }
        return true;
    },

    placePiece: function(p, q) {
        if (!this.canPlace(this.state.selectedPiece, p, q, this.state.rotation)) {
            return;
        }

        const piece = {
            type: this.state.selectedPiece,
            p: p,
            q: q,
            rotation: this.state.rotation
        };
        this.state.placedPieces.push(piece);
        
        const cells = Pieces.getAbsoluteCells(piece.type, p, q, piece.rotation);
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        const chordName = Tonnetz.analyzeChord(midis);
        if (chordName) {
            this.spawnTransientTooltip('Placed: ' + chordName, p, q, 'placed');
        }
        
        Synth.playChord(midis);
        
        this.refreshLattice();
    },

    cleanup: function() {
        // Hide the game-tooltip if it exists
        const tooltip = document.querySelector('.game-tooltip');
        if (tooltip && tooltip.classList) {
            tooltip.classList.remove('visible');
        }
        // Remove any remaining transient tooltips
        document.querySelectorAll('.transient-tooltip').forEach(el => {
            if (el && typeof el.remove === 'function') el.remove();
        });
    },

    showPlacedTooltip: function(e, piece, cells) {
        // Highlight the entire placed piece's cells
        const placedHexes = document.querySelectorAll('.placed-piece');
        placedHexes.forEach(hex => {
            const hp = parseInt(hex.getAttribute('data-p'));
            const hq = parseInt(hex.getAttribute('data-q'));
            if (cells.some(c => c.p === hp && c.q === hq)) {
                hex.style.stroke = '#7fe0d0';
                hex.style.strokeWidth = '3';
            }
        });

        // Populate and show tooltip
        const tooltip = document.querySelector('.game-tooltip');
        if (tooltip) {
            const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
            const chordName = Tonnetz.analyzeChord(midis);
            if (chordName) {
                tooltip.textContent = chordName;
                if (tooltip.classList) tooltip.classList.add('visible');
                this.movePlacedTooltip(e);
            }
        }
    },

    hidePlacedTooltip: function() {
        // Reset stroke styles on placed pieces
        const placedHexes = document.querySelectorAll('.placed-piece');
        placedHexes.forEach(hex => {
            hex.style.stroke = 'white';
            hex.style.strokeWidth = '2';
        });

        const tooltip = document.querySelector('.game-tooltip');
        if (tooltip && tooltip.classList) {
            tooltip.classList.remove('visible');
        }
    },

    movePlacedTooltip: function(e) {
        const tooltip = document.querySelector('.game-tooltip');
        if (tooltip && tooltip.classList && tooltip.classList.contains('visible')) {
            tooltip.style.left = `${e.pageX}px`;
            tooltip.style.top = `${e.pageY}px`;
        }
    },

    spawnTransientTooltip: function(text, p, q, type = 'placed') {
        const tip = document.createElement('div');
        tip.className = `transient-tooltip ${type}`;
        tip.textContent = text;
        document.body.appendChild(tip);

        // Position at cell screen coordinates converted to page viewport coordinates
        const pos = Render.getScreenPos(p, q);
        const svgEl = Render.svg;
        if (svgEl && svgEl.createSVGPoint) {
            const pt = svgEl.createSVGPoint();
            pt.x = pos.x;
            pt.y = pos.y;
            try {
                const clientPt = pt.matrixTransform(svgEl.getScreenCTM());
                tip.style.left = `${clientPt.x + window.scrollX}px`;
                tip.style.top = `${clientPt.y + window.scrollY}px`;
            } catch (err) {
                // Fallback client/page coordinates
                const rect = svgEl.getBoundingClientRect();
                tip.style.left = `${rect.left + pos.x + window.scrollX}px`;
                tip.style.top = `${rect.top + pos.y + window.scrollY}px`;
            }
        }

        // Trigger transition
        setTimeout(() => {
            if (tip && tip.classList) tip.classList.add('fade-up');
        }, 10);

        // Remove element after animation finishes
        setTimeout(() => {
            if (tip && typeof tip.remove === 'function') tip.remove();
        }, 1200);
    }
};
