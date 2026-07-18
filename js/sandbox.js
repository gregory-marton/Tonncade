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
 * sandbox.js - Main controller for Sandbox Mode.
 */

const SandboxMode = {
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
        this.updatePaletteHighlight();
        this.refreshLattice();
        this.setupEvents();
        this.setupGuide();
        this.setupDragToCandidate('piece-list', '.piece-item', item => ({
            key: item.getAttribute('data-key'),
            rotation: 0
        }));
        this.setupDragToCandidate('chord-guide-results', '.chord-match-item', item => ({
            key: item.getAttribute('data-type'),
            rotation: parseInt(item.getAttribute('data-rotation'))
        }));

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

        // Always-present carousel entry for the note-play tool — the default mode where
        // touching any cell plays its note, regardless of any placed piece there. With the
        // place-wedge occupying most of a selected item's own card, tapping that item to
        // toggle it back off is no longer the obvious way back to this mode, so it gets its
        // own dedicated, fixed-position entry instead of having to relocate/scroll to
        // whatever's currently selected. A note glyph rather than words, per the
        // icon-over-text bias.
        const noteToolDiv = document.createElement('div');
        noteToolDiv.className = 'piece-item note-tool-item';
        noteToolDiv.setAttribute('data-key', '');
        noteToolDiv.title = 'Play notes';
        noteToolDiv.innerHTML = `<div class="note-tool-glyph">♪</div>`;
        noteToolDiv.onclick = () => this.selectNoteTool();
        list.appendChild(noteToolDiv);

        for (const key in Pieces.TYPES) {
            const piece = Pieces.TYPES[key];
            const div = document.createElement('div');
            div.className = 'piece-item';
            div.setAttribute('data-key', key);
            div.innerHTML = `
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
                <div class="place-wedge" title="Place">▼</div>
            `;

            div.onclick = () => this.togglePiece(key);
            list.appendChild(div);

            const previewSvg = div.querySelector('.piece-preview');
            this.renderPiecePreview(previewSvg, piece.cells, piece.color);

            // Only visible (via CSS) when this item is the selected candidate — a distinct,
            // always-discoverable tap target for "place it here," alongside swipe-down.
            const wedge = div.querySelector('.place-wedge');
            wedge.onclick = (e) => {
                e.stopPropagation();
                this.placeActiveGhost();
            };
        }
    },

    renderPiecePreview: function(svgEl, cells, color) {
        const positions = cells.map(c => Render.getScreenPos(c.p, c.q));
        const minX = Math.min(...positions.map(pos => pos.x));
        const maxX = Math.max(...positions.map(pos => pos.x));
        const minY = Math.min(...positions.map(pos => pos.y));
        const maxY = Math.max(...positions.map(pos => pos.y));

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const padding = 40;
        const size = Math.max(maxX - minX, maxY - minY) + padding * 2;

        svgEl.setAttribute('viewBox', `${centerX - size / 2} ${centerY - size / 2} ${size} ${size}`);

        cells.forEach(c => {
            const hex = Render.createHex(c.p, c.q, {
                fill: color,
                stroke: 'white',
                strokeWidth: 2
            });
            svgEl.appendChild(hex);
        });
    },

    togglePiece: function(key) {
        if (this.state.selectedPiece === key) {
            this.state.selectedPiece = null;
        } else {
            this.selectPiece(key);
            if (typeof App !== 'undefined' && App.collapseMobileDrawer) {
                App.collapseMobileDrawer();
            }
        }
        this.updatePaletteHighlight();
    },

    selectNoteTool: function() {
        this.state.selectedPiece = null;
        this.updatePaletteHighlight();
    },

    selectPiece: function(key) {
        this.state.selectedPiece = key;
        this.state.rotation = 0;
        this.updatePaletteHighlight();
    },

    // Places the current candidate at its current ghost position, same as swipe-down — no-op
    // if the ghost's position isn't actually a valid placement.
    placeActiveGhost: function() {
        if (!this.state.selectedPiece) return;
        const { p, q } = this.state.hoverCell;
        if (this.canPlace(this.state.selectedPiece, p, q, this.state.rotation)) {
            this.placePiece(p, q);
        }
    },

    updatePaletteHighlight: function() {
        document.querySelectorAll('.piece-item').forEach((item) => {
            const k = item.getAttribute('data-key');
            if (item.classList.contains('note-tool-item')) {
                item.classList.toggle('selected', !this.state.selectedPiece);
            } else {
                item.classList.toggle('selected', k === this.state.selectedPiece);
            }
        });
    },

    refreshLattice: function() {
        this.hidePlacedTooltip();
        const viewport = {
            minP: -15, maxP: 15,
            minQ: -15, maxQ: 15
        };
        Render.drawLattice(viewport, {});
        this.renderPlacedPieces();
        
        // Re-append note and keyboard labels to the end of the SVG so they render on top of placed pieces
        const labels = Array.from(Render.svg.querySelectorAll('.note-label, .qwerty-label'));
        labels.forEach(lbl => Render.svg.appendChild(lbl));

        this.state.zoom = Render.getResponsiveZoom();
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
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

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
            
            if (!isTouch) {
                this.state.isPanning = true;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
            }
        };

        window.onmousemove = (e) => {
            if (!isTouch && this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
                // Read back the clamped values so the next delta starts from where we actually are
                this.state.viewX = Render.viewX;
                this.state.viewY = Render.viewY;
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

    // Pick up ONLY — never places. Returns true if a piece was picked up.
    pickupPieceAt: function(p, q) {
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
            Synth.playChord(midis);
            return true;
        }
        return false;
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
        Synth.playChord(midis);
        
        this.refreshLattice();
    },

    cleanup: function() {
        // Hide the game-tooltip if it exists
        const tooltip = document.querySelector('.game-tooltip');
        if (tooltip && tooltip.classList) {
            tooltip.classList.remove('visible');
        }
        const select = document.getElementById('chord-guide-select');
        if (select) {
            select.value = '';
            this.updateGuideResults('');
        }
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

    setupGuide: function() {
        const select = document.getElementById('chord-guide-select');
        const resetBtn = document.getElementById('chord-guide-reset');
        if (!select) return;

        select.onchange = () => {
            this.updateGuideResults(select.value);
            if (resetBtn) resetBtn.style.display = select.value ? 'inline-block' : 'none';
        };

        if (resetBtn) {
            resetBtn.onclick = () => {
                select.value = '';
                this.updateGuideResults('');
                resetBtn.style.display = 'none';
            };
        }
    },

    setupDragToCandidate: function(containerId, itemSelector, getPieceInfo) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let dragInfo = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let isPlacingDrag = false;

        container.addEventListener('touchstart', (e) => {
            const item = e.target.closest(itemSelector);
            if (!item) return;
            dragInfo = getPieceInfo(item);
            if (!dragInfo.key) { dragInfo = null; return; } // e.g. the note-play tool item
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            isPlacingDrag = false;
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!dragInfo) return;
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - dragStartY;

            if (!isPlacingDrag) {
                // The carousel scrolls vertically in landscape (a tall column) but horizontally
                // in portrait (a wide row) — "drag out to place" is whichever axis ISN'T the
                // native scroll direction, so it doesn't fight the browser's own scroll gesture.
                const dragDelta = Render.isMobileLandscape() ? dx : dy;
                const scrollDelta = Render.isMobileLandscape() ? dy : dx;

                if (Math.abs(dragDelta) > 20 && Math.abs(dragDelta) > Math.abs(scrollDelta) * 1.5) {
                    // Starting a new candidate this way commits whatever's currently active
                    // first — a piece mid-placement is cheap to pick back up if it lands
                    // wrong, and dragging a new piece out is an unambiguous "I'm done with
                    // this one" signal.
                    this.placeActiveGhost();
                    isPlacingDrag = true;
                    this.state.selectedPiece = dragInfo.key;
                    this.state.rotation = dragInfo.rotation;
                    this.updatePaletteHighlight();
                } else {
                    return; // Predominantly along the scroll axis — let the browser scroll the list natively
                }
            }

            e.preventDefault();
            const touch = e.touches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && el.tagName.toLowerCase() === 'polygon') {
                const p = parseInt(el.getAttribute('data-p'));
                const q = parseInt(el.getAttribute('data-q'));
                this.state.hoverCell = { p, q };
                this.updateGhost();
            }
        }, { passive: false });

        container.addEventListener('touchend', () => {
            // Releasing over the board leaves the piece as a selected candidate at the last
            // hovered cell (same state as tapping it in the palette) — the normal board
            // gestures (tap to rotate, swipe down to place) take over from here.
            dragInfo = null;
            isPlacingDrag = false;
        });
    },

    updateGuideResults: function(val) {
        const resultsDiv = document.getElementById('chord-guide-results');
        if (!resultsDiv) return;

        if (!val) {
            resultsDiv.innerHTML = '';
            return;
        }

        const matches = [];
        for (const typeKey of Object.keys(Pieces.TYPES)) {
            for (let r = 0; r < 6; r++) {
                const cells = Pieces.getAbsoluteCells(typeKey, 0, 0, r);
                const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
                const chordNames = Tonnetz.analyzeAllChords(midis);
                for (const chordName of chordNames) {
                    let isMatch = false;
                    if (val === 'major') isMatch = chordName.endsWith('Major');
                    else if (val === 'minor') isMatch = chordName.endsWith('Minor');
                    else if (val === 'm7') isMatch = (chordName.includes('m7') || chordName.includes('m7 (shell)')) && !chordName.includes('m7b5') && !chordName.includes('m(Maj7)');
                    else if (val === 'maj7') isMatch = chordName.includes('Maj7') && !chordName.includes('Maj7#5');
                    else if (val === '7') isMatch = (chordName.includes(' 7') || chordName.includes('7 (shell)')) && !chordName.includes('Maj7') && !chordName.includes('m7') && !chordName.includes('7b5') && !chordName.includes('7#5') && !chordName.includes('7b9') && !chordName.includes('7#9') && !chordName.includes('7sus2') && !chordName.includes('7sus4');
                    else if (val === '5') isMatch = chordName.includes('5') || chordName.includes('Pentatonic Stack');
                    else if (val === 'sus4') isMatch = chordName.includes('Sus4') || chordName.includes('7sus4');
                    else if (val === 'sus2') isMatch = chordName.includes('Sus2') || chordName.includes('7sus2');
                    else if (val === 'mMaj7') isMatch = chordName.includes('m(Maj7)');
                    else if (val === '7b5') isMatch = chordName.includes('7b5');
                    else if (val === '7#5') isMatch = chordName.includes('7#5');
                    else if (val === 'maj7#5') isMatch = chordName.includes('Maj7#5');
                    else if (val === 'add9') isMatch = chordName.includes('add9') && !chordName.includes('madd9');
                    else if (val === 'madd9') isMatch = chordName.includes('madd9');
                    else if (val === '7b9') isMatch = chordName.includes('7b9');
                    else if (val === '7#9') isMatch = chordName.includes('7#9');
                    else if (val === '7sus2') isMatch = chordName.includes('7sus2');
                    else if (val === 'quartal') isMatch = chordName.includes('Quartal Stack');

                    if (isMatch) {
                        const rootPart = chordName.split(' ')[0];
                        const qualityPart = chordName.substring(rootPart.length).trim();
                        const genericName = `Root ${qualityPart}`;
                        
                        if (!matches.some(m => m.type === typeKey && m.genericName === genericName)) {
                            matches.push({
                                type: typeKey,
                                rotation: r,
                                genericName: genericName,
                                originalName: chordName
                            });
                        }
                    }
                }
            }
        }

        if (matches.length === 0) {
            resultsDiv.innerHTML = '<div style="color: var(--dim); margin-top: 10px;">No pieces can create this chord quality.</div>';
            return;
        }

        const getWikipediaUrl = (genericName) => {
            const name = genericName.replace('Root ', '').trim();
            if (name.startsWith('Major') && !name.includes('7') && !name.includes('3rd')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Major_triad';
            if (name.startsWith('minor') && !name.includes('7') && !name.includes('3rd')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Minor_triad';
            if (name.includes('m7b5')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Half-diminished_seventh_chord';
            if (name.includes('m7')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Minor_seventh_chord';
            if (name.includes('Maj7')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Major_seventh_chord';
            if (name.includes('m(Maj7)')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Minor_major_seventh_chord';
            if (name.includes('7')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Dominant_seventh_chord';
            if (name.includes('5 (Fifth)')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Power_chord';
            if (name.includes('Sus4') || name.includes('Sus2')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Suspended_chord';
            if (name.includes('Pentatonic Stack')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Quintal_harmony';
            if (name.includes('dim')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Diminished_triad';
            if (name.includes('aug')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Augmented_triad';
            if (name.includes('Major 3rd') || name.includes('minor 3rd') || name.includes('3rd')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Third_(music)';
            if (name.includes('4th')) return 'https://en.wikipedia.org/wiki/Special:MyLanguage/Fourth';
            return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`;
        };

        resultsDiv.innerHTML = matches.map(match => `
            <div class="chord-match-item" data-type="${match.type}" data-rotation="${match.rotation}" 
                 style="padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; margin-top: 8px; background: #1c202a; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: all 0.15s ease;">
                <div>
                    <strong style="font-size: 13px;">
                        <a href="${getWikipediaUrl(match.genericName)}" target="_blank" rel="noopener noreferrer" 
                           onclick="event.stopPropagation();" 
                           style="color: #7fe0d0; text-decoration: none; border-bottom: 1px dashed rgba(127, 224, 208, 0.4);" 
                           title="Read about this chord type on Wikipedia">
                            ${match.genericName} ↗
                        </a>
                    </strong>
                    <div style="font-size: 11px; color: var(--dim); margin-top: 2px;">Piece: <span style="color: #fff; font-weight: bold;">${match.type}</span> | Rotation: ${match.rotation}</div>
                </div>
                <svg class="chord-match-preview"></svg>
            </div>
        `).join('');

        resultsDiv.querySelectorAll('.chord-match-item').forEach(item => {
            const type = item.getAttribute('data-type');
            const rotation = parseInt(item.getAttribute('data-rotation'));

            const preview = item.querySelector('.chord-match-preview');
            const cells = Pieces.getAbsoluteCells(type, 0, 0, rotation);
            this.renderPiecePreview(preview, cells, Pieces.TYPES[type].color);

            item.onclick = () => {
                this.selectPiece(type);
                this.state.rotation = rotation;
                this.updateGhost();

                if (typeof App !== 'undefined' && App.collapseMobileDrawer) {
                    App.collapseMobileDrawer();
                }

                item.style.borderColor = 'var(--accent)';
                setTimeout(() => {
                    item.style.borderColor = 'var(--border)';
                }, 300);
            };
        });
    }
};
