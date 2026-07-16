/**
 * render.js - SVG rendering for Tonncade.
 * Handles lattice drawing, piece ghosting, and labeling.
 */

const Render = {
    NS: 'http://www.w3.org/2000/svg',
    // Hex geometry constants
    HEX_R: 30, // radius
    HEX_W: Math.sqrt(3) * 30, // width
    HEX_H: 2 * 30 * 0.75, // height (vertical spacing for staggered rows)

    init: function(svgId) {
        this.svg = document.getElementById(svgId);
    },

    // Convert axial (p, q) to screen (x, y)
    // Using a "pointy-top" hex orientation
    getScreenPos: function(p, q) {
        // Basis vectors for axial to pixel
        // x = size * (sqrt(3) * p  +  sqrt(3)/2 * q)
        // y = size * (3/2 * q)
        // But we're using the Harmonic Table layout where q is diagonal up-right
        // Let's adapt pos(p,q) from mockup:
        // x = p*W + q*(W/2)
        // y = -q*H
        const W = this.HEX_W;
        const H = 45; // Fixed height step for 3/4 overlap or similar
        return {
            x: p * W + q * (W / 2),
            y: -q * H
        };
    },

    createHex: function(p, q, options = {}) {
        const pos = this.getScreenPos(p, q);
        const poly = document.createElementNS(this.NS, 'polygon');
        
        // Generate points for a "pointy-top" hexagon
        const points = [];
        for (let i = 0; i < 6; i++) {
            const angle_deg = 60 * i - 30;
            const angle_rad = Math.PI / 180 * angle_deg;
            points.push(`${pos.x + this.HEX_R * Math.cos(angle_rad)},${pos.y + this.HEX_R * Math.sin(angle_rad)}`);
        }
        
        poly.setAttribute('points', points.join(' '));
        poly.setAttribute('class', 'cell ' + (options.className || ''));
        poly.setAttribute('fill', options.fill || '#1c1f28');
        poly.setAttribute('stroke', options.stroke || '#2a2e3a');
        poly.setAttribute('stroke-width', options.strokeWidth || '1');
        
        if (options.data) {
            for (const k in options.data) {
                poly.setAttribute('data-' + k, options.data[k]);
            }
        }

        return poly;
    },

    createLabel: function(p, q, text) {
        const pos = this.getScreenPos(p, q);
        const t = document.createElementNS(this.NS, 'text');
        t.setAttribute('x', pos.x);
        t.setAttribute('y', pos.y + 5);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'note-label');
        t.textContent = text;
        return t;
    },

    createKeyboardLabel: function(p, q, text) {
        const pos = this.getScreenPos(p, q);
        const t = document.createElementNS(this.NS, 'text');
        t.setAttribute('x', pos.x);
        t.setAttribute('y', pos.y - 7); // Positioned slightly above the note name
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'qwerty-label');
        t.textContent = text;
        return t;
    },

    drawLattice: function(viewport, options = {}) {
        this.svg.innerHTML = '';
        const group = document.createElementNS(this.NS, 'g');
        group.setAttribute('id', 'lattice-group');
        
        // Render range
        for (let p = viewport.minP; p <= viewport.maxP; p++) {
            for (let q = viewport.minQ; q <= viewport.maxQ; q++) {
                const midi = Tonnetz.getMidi(p, q);
                if (!options.isSnake && !options.isGravity && (midi < 0 || midi > 127)) continue;

                // For Blast Mode, dim cells outside the radius
                let fill = '#1c1f28';
                let opacity = 1;
                if (options.isBlast && !Board.isInBounds(p, q)) {
                    opacity = 0.2;
                }
                if (options.isGravity) {
                    const col = p + Math.floor(q / 2);
                    if (q < 0 || q >= 20 || col < -5 || col > 4) {
                        continue;
                    }
                }
                if (options.isSnake) {
                    if (typeof SnakeMode !== 'undefined' && !SnakeMode.isInBounds(p, q)) {
                        continue;
                    }
                }

                const hex = this.createHex(p, q, {
                    fill: fill,
                    data: { p, q, midi }
                });
                hex.style.opacity = opacity;
                group.appendChild(hex);

                if (opacity > 0.5) {
                    const label = this.createLabel(p, q, Tonnetz.getNoteName(midi));
                    group.appendChild(label);

                    // Add QWERTY mapping label if in MIDI mode
                    if (typeof App !== 'undefined' && App.currentMode === 'midi' && typeof MidiMode !== 'undefined') {
                        const key = MidiMode.getQwertyKey(p, q);
                        if (key) {
                            const qLabel = this.createKeyboardLabel(p, q, key);
                            group.appendChild(qLabel);
                        }
                    }
                }
            }
        }
        
        this.svg.appendChild(group);
    },

    viewX: -400,
    viewY: -300,
    zoom: 1,

    // On phones, shrink the viewBox (relative to baseZoom) so each hex renders ~1.5x bigger.
    getResponsiveZoom: function(baseZoom = 1) {
        const isPhone = window.matchMedia('(max-width: 767px)').matches;
        return isPhone ? baseZoom / 1.5 : baseZoom;
    },

    // Screen-space bounding box of every playable (MIDI 0-127) hex for the current mode,
    // padded by one hex-width of slack. Only Sandbox/Blast/MIDI modes allow free panning;
    // other modes return null and are left unclamped.
    getPanBounds: function() {
        if (typeof App === 'undefined') return null;
        const mode = App.currentMode;
        if (mode !== 'sandbox' && mode !== 'blast' && mode !== 'midi') return null;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let p = -15; p <= 15; p++) {
            for (let q = -15; q <= 15; q++) {
                const midi = Tonnetz.getMidi(p, q);
                if (midi < 0 || midi > 127) continue;
                const pos = this.getScreenPos(p, q);
                minX = Math.min(minX, pos.x - this.HEX_R);
                maxX = Math.max(maxX, pos.x + this.HEX_R);
                minY = Math.min(minY, pos.y - this.HEX_R);
                maxY = Math.max(maxY, pos.y + this.HEX_R);
            }
        }
        if (minX === Infinity) return null;

        const slack = this.HEX_R * 2; // ~1 hex-width of give past the edge
        return { minX: minX - slack, maxX: maxX + slack, minY: minY - slack, maxY: maxY + slack };
    },

    updateView: function(viewX, viewY, zoom = 1) {
        const bounds = this.getPanBounds();
        if (bounds) {
            const vbWidth = 800 * zoom;
            const vbHeight = 600 * zoom;
            const maxViewX = bounds.maxX - vbWidth;
            const maxViewY = bounds.maxY - vbHeight;
            if (bounds.minX <= maxViewX) {
                viewX = Math.min(Math.max(viewX, bounds.minX), maxViewX);
            }
            if (bounds.minY <= maxViewY) {
                viewY = Math.min(Math.max(viewY, bounds.minY), maxViewY);
            }
        }
        this.viewX = viewX;
        this.viewY = viewY;
        this.zoom = zoom;
        const vb = `${viewX} ${viewY} ${800 * zoom} ${600 * zoom}`;
        this.svg.setAttribute('viewBox', vb);
    }
};
