/**
 * render.js - SVG rendering for Tonnetz Tetris.
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

    drawLattice: function(viewport, options = {}) {
        this.svg.innerHTML = '';
        const group = document.createElementNS(this.NS, 'g');
        group.setAttribute('id', 'lattice-group');
        
        // Render range
        for (let p = viewport.minP; p <= viewport.maxP; p++) {
            for (let q = viewport.minQ; q <= viewport.maxQ; q++) {
                const midi = Tonnetz.getMidi(p, q);
                if (midi < 0 || midi > 127) continue;

                // For Puzzle Mode, dim cells outside the radius
                let fill = '#1c1f28';
                let opacity = 1;
                if (options.isPuzzle && !Board.isInBounds(p, q)) {
                    opacity = 0.2;
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
                }
            }
        }
        
        this.svg.appendChild(group);
    },

    updateView: function(viewX, viewY, zoom = 1) {
        const vb = `${viewX} ${viewY} ${800 * zoom} ${600 * zoom}`;
        this.svg.setAttribute('viewBox', vb);
    }
};
