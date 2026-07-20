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
        const stored = parseInt(localStorage.getItem('tonncade_rotation_deg') || '0', 10);
        this.rotationDeg = isNaN(stored) ? 0 : ((stored % 360) + 360) % 360;
    },

    rotationDeg: 0,

    // Sets the view rotation (any degrees, normalized into [0, 360)) and persists it. Does not
    // redraw -- callers own their own redraw entrypoint (refreshBoard/refreshLattice/refreshUI
    // differ by mode; see js/main.js's rotate-view button handler).
    setRotation: function(deg) {
        this.rotationDeg = ((deg % 360) + 360) % 360;
        localStorage.setItem('tonncade_rotation_deg', this.rotationDeg);
    },

    // Gravity's falling mechanic is defined entirely in axial (p, q) space ("down" is a fixed
    // direction in that space -- see js/gravity.js), independent of how the lattice happens to
    // be drawn on screen. Rotating gravity's RENDERING without also rotating its game logic would
    // make pieces visibly fall sideways or upward while the code still calls that direction
    // "down" -- so Gravity always renders at 0 regardless of the player's stored preference,
    // rather than trying to keep logic and rendering in sync under an arbitrary render rotation.
    getEffectiveRotation: function() {
        if (typeof App !== 'undefined' && App.currentMode === 'gravity') return 0;
        return this.rotationDeg;
    },

    // getScreenPos(p, q), rotated by the current effective rotation around the origin -- the
    // actual on-screen position once the lattice-group's rotate() transform (see drawLattice) is
    // applied. Bounding-box math (getFitView, getPanBounds) needs THIS, not the raw unrotated
    // position, to correctly fit/clamp against what's actually visible on screen.
    getRotatedScreenPos: function(p, q) {
        const pos = this.getScreenPos(p, q);
        const deg = this.getEffectiveRotation();
        if (deg === 0) return pos;
        const rad = deg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        return {
            x: pos.x * cos - pos.y * sin,
            y: pos.x * sin + pos.y * cos
        };
    },

    // Appends into the lattice's own group (see drawLattice) rather than directly onto the <svg>,
    // so placed pieces/ghosts/gems/labels inherit that group's rotate() transform and turn
    // together with the base lattice, instead of staying fixed in place while the grid rotates
    // under them. Falls back to a direct svg append if drawLattice hasn't run yet.
    appendToLattice: function(el) {
        const group = this.svg.querySelector('#lattice-group');
        (group || this.svg).appendChild(el);
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

    // Flashes every rendered cell sharing a given MIDI pitch (a Tonnetz places the same note at
    // multiple lattice positions by design, so "the cell for this note" is really "every cell for
    // this note" -- see data-midi in drawLattice/createHex). Generic across modes: originally
    // Melody-mode-only (MidiMode.highlightCellByMidi), moved here once Sandbox and live MIDI
    // hardware input needed the exact same behavior with no mode-specific state involved.
    highlightByMidi: function(midi, duration = 300) {
        const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
        polygons.forEach(p => {
            p.classList.remove('active-note');
            void p.offsetWidth; // Force layout flush
            p.classList.add('active-note');

            if (p.activeTimeoutId) {
                clearTimeout(p.activeTimeoutId);
            }

            p.activeTimeoutId = setTimeout(() => {
                p.classList.remove('active-note');
                p.activeTimeoutId = null;
            }, duration);
        });
    },

    // Counter-rotates a label around its own anchor point so it stays upright regardless of the
    // lattice-group's overall rotation -- a child's own rotate(-D) composes with the parent
    // group's rotate(D) to net zero rotation for the glyph itself, while the anchor point (and
    // so the label's position) still moves correctly with the group.
    applyLabelCounterRotation: function(el, x, y) {
        const deg = this.getEffectiveRotation();
        if (deg !== 0) el.setAttribute('transform', `rotate(${-deg} ${x} ${y})`);
    },

    createLabel: function(p, q, text) {
        const pos = this.getScreenPos(p, q);
        const t = document.createElementNS(this.NS, 'text');
        t.setAttribute('x', pos.x);
        t.setAttribute('y', pos.y + 5);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'note-label');
        t.textContent = text;
        this.applyLabelCounterRotation(t, pos.x, pos.y + 5);
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
        this.applyLabelCounterRotation(t, pos.x, pos.y - 7);
        return t;
    },

    drawLattice: function(viewport, options = {}) {
        this.svg.innerHTML = '';
        const group = document.createElementNS(this.NS, 'g');
        group.setAttribute('id', 'lattice-group');
        const rotationDeg = this.getEffectiveRotation();
        if (rotationDeg !== 0) group.setAttribute('transform', `rotate(${rotationDeg})`);

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

    // True for any viewport the mobile CSS breakpoints treat as "mobile" — portrait phones
    // (max-width:767px) or landscape phones (max-width:950px, orientation:landscape). A plain
    // max-width:767px check alone misses landscape phones, since the CSS uses a second,
    // separate breakpoint for that orientation.
    isMobileViewport: function() {
        return window.matchMedia('(max-width: 767px), (max-width: 950px) and (orientation: landscape)').matches;
    },

    // True specifically for the landscape-phone breakpoint — used where mobile UI needs to
    // know which of the two mobile layouts it's in (e.g. the carousel is a horizontal row in
    // portrait but a vertical column in landscape), not just "is this mobile at all."
    isMobileLandscape: function() {
        return window.matchMedia('(max-width: 950px) and (orientation: landscape)').matches;
    },

    // On phones, shrink the viewBox (relative to baseZoom) so each hex renders ~1.5x bigger.
    getResponsiveZoom: function(baseZoom = 1) {
        return this.isMobileViewport() ? baseZoom / 1.5 : baseZoom;
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
                const pos = this.getRotatedScreenPos(p, q);
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

    // Computes {viewX, viewY, zoom} that centers and snugly fits the given {p, q} cells into
    // an 800x600 (or refW x refH, see below) reference viewBox, padded by `padding` screen-
    // space units around the content's bounding box. `scale` makes the result that much bigger
    // on screen (e.g. 1.25 renders 1.25x bigger) while staying centered on the same content
    // midpoint.
    //
    // refW/refH default to the historical fixed 800x600 (4:3) reference frame every mode has
    // always used -- callers that don't pass them get byte-identical behavior to before. A
    // caller whose SVG element is NOT rendered at a 4:3 aspect ratio (e.g. a tall, narrow phone
    // viewport) can instead pass a refW/refH matching its own actual on-screen aspect ratio, so
    // the fitted content fills that box edge-to-edge instead of being centered with wasted
    // letterbox margin inside it (found live: fixing just the CSS box that reserves this
    // element's on-screen space, without ALSO matching the reference box's aspect ratio to it,
    // had zero visible effect -- preserveAspectRatio="xMidYMid meet" just moved the wasted space
    // from outside the SVG's DOM box to inside it). See updateView, which must be called with
    // the SAME refW/refH so the actual viewBox attribute agrees with this math.
    getFitView: function(cells, padding = 0, scale = 1, refW = 800, refH = 600) {
        if (!cells || cells.length === 0) {
            return { viewX: -refW / 2, viewY: -refH / 2, zoom: 1 };
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        cells.forEach(c => {
            const pos = this.getRotatedScreenPos(c.p, c.q);
            minX = Math.min(minX, pos.x - this.HEX_R);
            maxX = Math.max(maxX, pos.x + this.HEX_R);
            minY = Math.min(minY, pos.y - this.HEX_R);
            maxY = Math.max(maxY, pos.y + this.HEX_R);
        });

        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;

        const zoom = Math.max((maxX - minX) / refW, (maxY - minY) / refH) / scale;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        return {
            viewX: centerX - (refW * zoom) / 2,
            viewY: centerY - (refH * zoom) / 2,
            zoom
        };
    },

    // refW/refH must match whatever getFitView (if any) computed viewX/viewY/zoom against --
    // see getFitView's comment. Every existing caller omits them and keeps the historical
    // 800x600 reference frame exactly as before.
    updateView: function(viewX, viewY, zoom = 1, refW = 800, refH = 600) {
        const bounds = this.getPanBounds();
        if (bounds) {
            const vbWidth = refW * zoom;
            const vbHeight = refH * zoom;
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
        const vb = `${viewX} ${viewY} ${refW * zoom} ${refH * zoom}`;
        this.svg.setAttribute('viewBox', vb);
    },

    // The reference box getFitView/updateView should use so fitted content fills #tonnetz-svg's
    // actual on-screen box edge-to-edge instead of being letterboxed inside a mismatched fixed
    // 4:3 shape. Keeps width fixed at 800 (preserving the existing zoom-magnitude scale) and
    // derives height from the SVG element's real current aspect ratio. Falls back to the
    // historical 800x600 if the element isn't laid out yet (e.g. zero size before first paint).
    getAspectMatchedRefBox: function() {
        if (!this.svg) return { refW: 800, refH: 600 };
        const rect = this.svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return { refW: 800, refH: 600 };
        return { refW: 800, refH: 800 * (rect.height / rect.width) };
    }
};
