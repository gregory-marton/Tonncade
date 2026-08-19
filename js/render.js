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

    // The single source of truth for "restricted" (fixed/fit-to-its-own-board, no free pan or
    // zoom) vs. every other mode (a free-pan Tonnetz view, ordinary panning/zoom apply). Referenced
    // by getPanBounds below and by main.js's zoom gestures -- neither hand-maintains its own
    // mode list, so the two can't drift apart the way an inline allowlist per call site would.
    RESTRICTED_MODES: ['blast', 'gravity', 'snake'],

    // Zoom range for non-restricted modes' own in-app zoom (wheel/pinch -- see main.js's
    // applyZoomDelta). MAX_ZOOM is chosen so the full audible range (Tonnetz.audibleMinMidi()..
    // audibleMaxMidi()) fits the viewport at once, matching Sandbox's own drawn content bounds
    // (see sandbox.js's _contentViewport). MIN_ZOOM allows a modest zoom-in past the default.
    MIN_ZOOM: 0.5,
    MAX_ZOOM: 3.5,

    // Captured once, at script-parse time (i.e. once per real page load -- Render.init() reruns
    // on every mode switch, so capturing there would need its own guard; parse time needs none).
    // Real browser page-zoom (Ctrl+/Ctrl- and equivalents) changes window.devicePixelRatio
    // proportionally to the zoom level; comparing the CURRENT dPR against this remembered
    // baseline (a RATIO, not an absolute check) is what tells "the user zoomed" apart from "this
    // is just a dense/Retina display" (dPR > 1 even at 100% zoom there) -- the ratio stays
    // exactly 1.0 on a HiDPI display until the user actually changes zoom, regardless of the
    // display's own fixed density.
    _baselineDPR: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,

    // >1 once the browser has zoomed IN since page load, <1 once zoomed OUT. Applied in
    // updateView so cells shrink/grow in sync with the rest of the page's fixed-CSS-px content
    // (buttons, text -- which already do this for free, no JS involved) instead of staying
    // whatever CSS-px size the container's own fluid layout happens to hand them, with zero
    // relation to real browser zoom. The container's own occupied CSS-px area is deliberately
    // NOT touched here -- #game-container growing/shrinking as #sidebar's fixed 300px becomes a
    // smaller/larger proportion of a zoom-resized viewport is #sidebar's own layout responding
    // correctly, not a bug (see docs/invariants.md's INV-53).
    getBrowserZoomFactor: function() {
        if (typeof window === 'undefined' || !window.devicePixelRatio) return 1;
        return window.devicePixelRatio / this._baselineDPR;
    },

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
    // Melody-mode-only (MelodyMode.highlightCellByMidi), moved here once Sandbox and live MIDI
    // hardware input needed the exact same behavior with no mode-specific state involved.
    highlightByMidi: function(midi, duration = 300) {
        const polygons = document.querySelectorAll(`polygon[data-midi="${midi}"]`);
        polygons.forEach(p => {
            if (p.activeTimeoutId) {
                clearTimeout(p.activeTimeoutId);
                p.activeTimeoutId = null;
            }
            p.classList.remove('active-note');
            // Two rAFs, not a synchronous forced-reflow (`void p.offsetWidth`) -- a reflow forces
            // a LAYOUT recalc, but two classList writes in the same synchronous pass never yield
            // to an actual PAINT in between, so an observer (a human eye, or a real test polling
            // between real timer ticks) never sees the "off" frame at all. Two notes at the SAME
            // pitch played back to back (e.g. Happy Birthday's opening "Happy Happy," both G) then
            // just look like ONE continuous highlight across both notes even though two distinct
            // sounds played -- INV-5, reported live. Two rAFs (not one) is the standard "wait for
            // the next real paint" pattern: a single rAF callback can still land before the
            // browser has actually painted the intervening frame in some browsers.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    p.classList.add('active-note');
                    p.activeTimeoutId = setTimeout(() => {
                        p.classList.remove('active-note');
                        p.activeTimeoutId = null;
                    }, duration);
                });
            });
        });
    },

    // Colorblind-accessible "play this one" indicator (reported live: color alone wasn't enough)
    // -- a small triangle drawn on top of the current note's own cell(s), the same shape
    // css/style.css draws on the matching pitch-row token via ::before. Cleared and redrawn
    // together, same pattern as the glow classes it supplements (never replaces -- this is in
    // ADDITION to color, not instead of it).
    clearCurrentNoteMarkers: function() {
        if (!this.svg) return;
        this.svg.querySelectorAll('.current-note-marker').forEach((el) => el.remove());
    },

    // polygons: a NodeList/array of the cell(s) sharing the current note's pitch (typically
    // whatever the caller already queried via data-midi). Positioned via each cell's own
    // data-p/data-q and the SAME (unrotated) getScreenPos cells themselves use -- appended into
    // the lattice group (appendToLattice), so it picks up the group's rotate() transform for
    // free, same as every other lattice-relative element, rather than double-applying rotation.
    markCurrentNote: function(polygons) {
        if (!this.svg) return;
        (polygons || []).forEach((poly) => {
            const p = Number(poly.getAttribute('data-p'));
            const q = Number(poly.getAttribute('data-q'));
            const pos = this.getScreenPos(p, q);
            const marker = document.createElementNS(this.NS, 'polygon');
            const r = 4;
            // Small, and offset well above center -- createLabel's own note-name text sits at
            // pos.y+5 and (in Melody, where this marker is used) createKeyboardLabel's own QWERTY
            // hint sits at pos.y-7, so a marker AT center (found live: too big, sitting right on
            // top of the pitch label) collided with both. This sits above them, near the hex's
            // own top vertex (HEX_R=30) instead, mirroring how the pitch-row's own current-note
            // triangle (css/style.css) sits ABOVE its text, not on top of it.
            const cy = pos.y - 20;
            const points = [
                `${pos.x - r},${cy - r * 0.6}`,
                `${pos.x + r},${cy - r * 0.6}`,
                `${pos.x},${cy + r * 0.8}`,
            ];
            marker.setAttribute('points', points.join(' '));
            marker.setAttribute('class', 'current-note-marker');
            marker.style.pointerEvents = 'none';
            this.appendToLattice(marker);
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

    // A small, low-contrast octave digit beside (not merging into) the centered note-name label
    // above -- the note letter's own centered position must never shift to accommodate this, so
    // this is an independent, left-anchored text element (same pattern as createKeyboardLabel's
    // own sibling label below), not a tspan inside createLabel's centered text run.
    createOctaveLabel: function(p, q, midi) {
        const pos = this.getScreenPos(p, q);
        const t = document.createElementNS(this.NS, 'text');
        t.setAttribute('x', pos.x + 7); // just right of the note-name glyph's own right edge
        t.setAttribute('y', pos.y + 5); // same baseline as the note-name label
        t.setAttribute('text-anchor', 'start');
        t.setAttribute('class', 'octave-label');
        t.textContent = Tonnetz.getOctave(midi);
        this.applyLabelCounterRotation(t, pos.x + 7, pos.y + 5);
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

        // Render range. Pannable modes draw the lattice out to the top of human hearing
        // (Tonnetz.audibleMaxMidi ~= MIDI 135, ~20 kHz) instead of the old MIDI-protocol ceiling of
        // 127 (~12.5 kHz) -- the restricted modes (Snake/Gravity) draw their own fixed boards.
        const audibleCeiling = Tonnetz.audibleMaxMidi();
        for (let p = viewport.minP; p <= viewport.maxP; p++) {
            for (let q = viewport.minQ; q <= viewport.maxQ; q++) {
                const midi = Tonnetz.getMidi(p, q);
                // With grayInaudible (Sandbox inspection view) INAUDIBLE cells are still drawn --
                // in dull gray, so a large pasted Life game can be inspected off the audible band
                // and the way back to hearing stays visible. Otherwise, pannable modes clip to the
                // audible range (0..audibleCeiling).
                const audible = Tonnetz.isAudible(midi);
                if (!options.isSnake && !options.isGravity && !options.grayInaudible &&
                    (midi < 0 || midi > audibleCeiling)) continue;

                // A restricted board's viewport is tightly fit to its own fixed shape (INV-40) --
                // an out-of-bounds cell is never reachable and never inside that fit, so it's
                // never actually seen either; drawing one at all is pure waste. Same reasoning as
                // the isGravity/isSnake checks below.
                if (options.isBlast && !Board.isInBounds(p, q)) {
                    continue;
                }
                let fill = '#1c1f28';
                let opacity = 1;
                if (options.grayInaudible && !audible) {
                    fill = '#34373f'; // dull gray -- outside human hearing, will not sound
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

                // Inaudible gray cells get no note label (they have no sounding pitch to name);
                // audible cells label as usual.
                if (opacity > 0.5 && (audible || !options.grayInaudible)) {
                    // keySignature: absent for every mode with no key concept (Sandbox/Blast/
                    // Gravity/Snake/Life) -- Tonnetz.getNoteName's own default (sharps-only,
                    // unchanged) applies exactly as it always has. Melody/Compose pass their
                    // current key (docs/melody-notation-design.md) so the Tonnetz's own labels
                    // spell notes the same way the staff above it does.
                    const label = this.createLabel(p, q, Tonnetz.getNoteName(midi, options.keySignature));
                    group.appendChild(label);
                    group.appendChild(this.createOctaveLabel(p, q, midi));

                    // Add QWERTY mapping label if in MIDI mode
                    if (typeof App !== 'undefined' && App.currentMode === 'melody' && typeof MelodyMode !== 'undefined') {
                        const key = MelodyMode.getQwertyKey(p, q);
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

    // INV-40: #tonnetz-svg's mobile inset (see the two @media blocks near the end of
    // css/style.css) used to be a flat guess sized to clear the widest possible chrome
    // regardless of how much room it actually needs right now. This measures the CURRENT mode's
    // actual visible stats/controls panel and D-pad, and feeds the real numbers back in as CSS
    // custom properties, so the board reclaims whatever the (now also shrinkable, see the
    // --chrome-* clamp()s in the same CSS) chrome doesn't need. Call after anything that could
    // change either the chrome's own size (a resize, a status message wrapping to another line)
    // or which chrome elements are even visible (setupMobileControls, entering/leaving a mode).
    // The real, currently-visible footprint of the current mode's stats panel and D-pad, as
    // {top, bottom, left, right} clearance needed from #game-container's own edges. Shared by
    // updateChromeInsets (CSS custom properties, a fallback/compat path) and fitContentBox (the
    // real fix, see INV-40) -- one measurement, two consumers.
    // Set a compact "current vs best" stat bar-graph's fill (see .stat-bar in css/style.css):
    // the fill width is current/best, so a full bar == a new personal best. Shared by
    // Blast/Gravity/Snake (task #79). best is passed already max'd with current by the caller.
    setStatBar: function(fillId, current, best) {
        const fill = document.getElementById(fillId);
        if (!fill) return;
        const denom = Math.max(best, current, 0);
        fill.style.width = denom > 0 ? `${Math.min(100, 100 * current / denom)}%` : '0%';
    },

    // Gravity's control layout is chosen by cup-vs-viewport WIDTH, not the orientation media
    // query (see docs/invariants.md / project memory). The cup is a tall well: the board wants
    // height, the stats bar and transport do not. Whenever the viewport is enough wider than the
    // cup-at-full-height to fit a control column on each side, the "sides" layout wins -- stats,
    // queue and the split D-pad live in the left/right gutters, leaving top+bottom entirely free
    // so the cup fills the full height and reaches BOTH those edges. Too narrow for that, and the
    // cup instead spans full width (reaching left+right) with chrome banded on top/bottom. Sets
    // #app[data-gravity-sides] (CSS reads it to position the controls) and this._gravitySides
    // (measureChromeClearance reads it to pick which edges to reserve). Call before
    // updateChromeInsets/fitContentBox so the measured control rects reflect the chosen layout.
    updateGravityLayout: function(cells) {
        const app = document.getElementById('app');
        let sides = false;
        if (app && this.isMobileViewport() && cells && cells.length) {
            const container = document.getElementById('game-container');
            const bounds = this.computeCellBounds(cells, 0);
            if (container && bounds) {
                const cr = container.getBoundingClientRect();
                const aspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
                if (isFinite(aspect) && aspect > 0 && cr.height > 0 && cr.width > 0) {
                    const cupWidthAtFullHeight = cr.height * aspect;
                    // One control column per side: a D-pad button plus a little separation. Read
                    // the live --dpad-btn-size when set, else a sensible default.
                    const btn = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dpad-btn-size')) || 48;
                    const columns = 2 * (btn + 12);
                    sides = (cr.width - cupWidthAtFullHeight) >= columns;
                }
            }
        }
        this._gravitySides = sides;
        if (app) {
            if (sides) app.setAttribute('data-gravity-sides', '1');
            else app.removeAttribute('data-gravity-sides');
        }
        return sides;
    },

    measureChromeClearance: function(mode) {
        const container = document.getElementById('game-container');
        if (!container) return { top: 0, bottom: 0, left: 0, right: 0 };
        const containerRect = container.getBoundingClientRect();
        const GAP = 10;

        const rectOf = (id) => {
            const el = document.getElementById(id);
            if (!el || getComputedStyle(el).display === 'none') return null;
            return el.getBoundingClientRect();
        };

        const STATS_IDS = { snake: 'snake-controls', gravity: 'gravity-controls', blast: 'blast-stats' };
        const statsRect = rectOf(STATS_IDS[mode]);

        let top = 0, bottom = 0, left = 0, right = 0;

        // Blast/Gravity's next-piece queue (#palette.floating-queue) floats independently of the
        // stats panel -- top-right for Blast in portrait (its board is wide, no side room), to
        // the side of the board for Gravity in portrait (its board is tall/narrow, so real side
        // margin exists once the aspect-fit centers it -- see css/style.css), the full left
        // column in landscape for both -- and was missing from this measurement entirely until
        // INV-10's occlusion check caught real overlap: fitContentBox made the board big enough
        // to actually reach the queue's corner, which the old, much-smaller-by-bug board never
        // did.
        const queueRect = (mode === 'blast' || mode === 'gravity') ? rectOf('palette') : null;

        // The "sides" layout (chrome in left/right gutters, board reaches top+bottom) applies in
        // mobile landscape for every restricted mode, and ALSO in a wide-enough portrait for
        // Gravity specifically (its tall cup -- see updateGravityLayout). Both funnel through this
        // same geometry-based branch: it reads wherever the CSS actually placed each control, so
        // it doesn't care which signal turned the sides layout on.
        const sideLayout = this.isMobileLandscape() || (mode === 'gravity' && this._gravitySides);
        if (sideLayout) {
            // The stats/controls panel reserves clearance on the side it actually sits: a wide
            // horizontal bar across the top (Gravity's landscape Pause/Restart/Lines strip)
            // reserves TOP, while a tall narrow side panel reserves LEFT. Treating a top bar as a
            // left obstacle (as this used to) reserved its full width down the whole left edge and
            // shoved the board far to the right with the left half empty (found live via the
            // fixture). Detect by the panel's own shape.
            if (statsRect) {
                if (statsRect.width >= statsRect.height) {
                    top = Math.max(top, statsRect.bottom - containerRect.top + GAP);
                } else {
                    left = Math.max(left, statsRect.right - containerRect.left + GAP);
                }
            }
            // The next-piece queue sits on whichever side its CSS actually places it -- Blast's
            // landscape queue is on the left, but Gravity's is a narrow strip on the RIGHT (see
            // css/style.css). Reserve clearance on the side it's really on: counting a right-side
            // queue as a LEFT obstacle (as this used to, assuming Blast's layout) reported nearly
            // the whole container width as left clearance and squeezed Gravity's board into a
            // sliver on the right (found live via the screenshot fixture).
            if (queueRect) {
                const queueCenterX = (queueRect.left + queueRect.right) / 2;
                if (queueCenterX < (containerRect.left + containerRect.right) / 2) {
                    left = Math.max(left, queueRect.right - containerRect.left + GAP);
                } else {
                    right = Math.max(right, containerRect.right - queueRect.left + GAP);
                }
            }
            // Snake/Gravity's D-pad splits into left/right clusters in landscape -- the shared
            // wrapper (#snake-mobile-controls/#mobile-controls) spans the full width itself
            // (left:10/right:10), so the clusters have to be measured individually, not the
            // wrapper, or every landscape inset would come out as "the whole width."
            const clusterSelectors = mode === 'snake'
                ? ['.snake-pad-cluster.snake-pad-left', '.snake-pad-cluster.snake-pad-right']
                : (mode === 'gravity' ? ['.gravity-pad-cluster.gravity-pad-left', '.gravity-pad-cluster.gravity-pad-right'] : []);
            if (clusterSelectors.length) {
                const wrapper = document.getElementById(mode === 'snake' ? 'snake-mobile-controls' : 'mobile-controls');
                if (wrapper && getComputedStyle(wrapper).display !== 'none') {
                    const leftCluster = document.querySelector(clusterSelectors[0]);
                    const rightCluster = document.querySelector(clusterSelectors[1]);
                    if (leftCluster) left = Math.max(left, leftCluster.getBoundingClientRect().right - containerRect.left + GAP);
                    if (rightCluster) right = Math.max(right, containerRect.right - rightCluster.getBoundingClientRect().left + GAP);
                }
            }
        } else {
            if (statsRect) top = Math.max(top, statsRect.bottom - containerRect.top + GAP);
            // Narrow (non-sides) layout: the cup spans full width to reach left+right, so nothing
            // may sit in a side gutter -- Gravity's queue docks to the TOP band alongside the
            // stats (top-right, like Blast's), not to the right of the board. (The side-gutter
            // placement is the sideLayout branch above.)
            if (queueRect) {
                top = Math.max(top, queueRect.bottom - containerRect.top + GAP);
            }
            const dpadRect = mode === 'snake' ? rectOf('snake-mobile-controls') : (mode === 'gravity' ? rectOf('mobile-controls') : null);
            if (dpadRect) bottom = Math.max(bottom, containerRect.bottom - dpadRect.top + GAP);
        }

        return { top, bottom, left, right };
    },

    // INV-40: #tonnetz-svg's mobile inset (see the two @media blocks near the end of
    // css/style.css) used to be a flat guess sized to clear the widest possible chrome
    // regardless of how much room it actually needs right now. This measures the CURRENT mode's
    // actual visible stats/controls panel and D-pad, and feeds the real numbers back in as CSS
    // custom properties, so the board reclaims whatever the (now also shrinkable, see the
    // --chrome-* clamp()s in the same CSS) chrome doesn't need. Superseded in practice by
    // fitContentBox's own inline-style sizing (which wins over these CSS rules), kept as the
    // fallback for whatever briefly renders before fitContentBox's first call, or an environment
    // where cells/aspect aren't available yet.
    updateChromeInsets: function() {
        if (typeof App === 'undefined') return;
        const mode = App.currentMode;
        if (!this.isMobileViewport()) return; // desktop has no matching inset rule to feed
        const container = document.getElementById('game-container');
        if (!container) return;
        const { top, bottom, left, right } = this.measureChromeClearance(mode);

        container.style.setProperty('--chrome-inset-top', `${Math.round(top)}px`);
        container.style.setProperty('--chrome-inset-bottom', `${Math.round(bottom)}px`);
        container.style.setProperty('--chrome-inset-left', `${Math.round(left)}px`);
        container.style.setProperty('--chrome-inset-right', `${Math.round(right)}px`);

        // Also set on <html>: CSS custom properties only cascade to actual DOM descendants, and
        // #palette (Gravity's side-of-board queue reads these) lives in #sidebar -- a SIBLING of
        // #game-container in the DOM, not a descendant of it -- so it could never see the values
        // above. <html> is a real ancestor of both, so this is the one place both #game-container
        // and #sidebar's own descendants can reliably inherit from. #game-container's own
        // (closer) copy above still wins for its own descendants, same value either way.
        document.documentElement.style.setProperty('--chrome-inset-top', `${Math.round(top)}px`);
        document.documentElement.style.setProperty('--chrome-inset-bottom', `${Math.round(bottom)}px`);
        document.documentElement.style.setProperty('--chrome-inset-left', `${Math.round(left)}px`);
        document.documentElement.style.setProperty('--chrome-inset-right', `${Math.round(right)}px`);
    },

    // The actual fix for INV-40: sizes and positions #tonnetz-svg itself (inline style, which
    // wins over the CSS @media inset rules) to the LARGEST box matching the cells' own natural
    // aspect ratio that fits within the space left after the current mode's real chrome
    // clearance -- instead of stretching to fill whatever oddly-shaped leftover space fixed
    // insets left behind. A reference box forced to match the LEFTOVER SCREEN's shape (rather
    // than the CONTENT's shape) makes getFitView's "contain" math necessarily waste space on
    // whichever axis isn't the tight constraint -- confirmed live: a radius-7 board's own raw
    // bounding shape is close to square (slightly wide), so forcing it into a tall leftover
    // strip (portrait) or a wide one (aggressively-inset landscape) always wasted the axis that
    // wasn't binding. Sizing the element itself to match the content's own shape removes that
    // waste; the margin it frees up becomes free space for chrome instead of being baked into
    // either the viewBox or an aspect-mismatched element box. Desktop is left alone (returns
    // false) -- there's no mobile chrome competing for space there, and the historical fixed
    // 800x600-style fit already fills a normal desktop panel reasonably.
    fitContentBox: function(cells, padding = 0) {
        if (!this.isMobileViewport()) {
            // On desktop the SVG fills its container via CSS (width/height:100%). Clear any inline
            // sizing a PRIOR mobile fit left (position:absolute + fixed width/height), which would
            // otherwise persist and strand the board at the old mobile box after a mobile->desktop
            // resize or a mode switch following a mobile session -- found live via the screenshot
            // fixture (Blast/Gravity desktop frames showed the board tiny or gone). Same
            // leftover-inline hazard panView clears for the pannable modes (INV-45).
            if (this.svg) {
                this.svg.style.position = '';
                this.svg.style.left = '';
                this.svg.style.top = '';
                this.svg.style.right = '';
                this.svg.style.bottom = '';
                this.svg.style.width = '';
                this.svg.style.height = '';
            }
            return false;
        }
        if (typeof App === 'undefined') return false;
        const container = document.getElementById('game-container');
        if (!container || !this.svg) return false;
        const containerRect = container.getBoundingClientRect();
        if (!containerRect.width || !containerRect.height) return false;

        const bounds = this.computeCellBounds(cells, padding);
        if (!bounds) return false;
        const contentAspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
        if (!isFinite(contentAspect) || contentAspect <= 0) return false;

        // Snake (both orientations): its D-pad clusters and stats panel sit in the CORNERS with a
        // wide empty gap between/around them, and the board is a hexagon whose left/right VERTICES
        // -- its widest point -- sit at its vertical center. The flat top/bottom/left/right
        // clearance model below can only reserve rectangular bands, so it shrinks the board to
        // whatever fits clear of the whole D-pad row/columns, wasting the corner gaps and most of
        // the space (found live at tablet/near-square sizes too, not just portrait: the board
        // rendered at ~half size, shoved off-center). A shape-aware fit instead lets the board be
        // nearly as large as the space, its tapering flanks sliding into the corner gaps (the SVG
        // box's own empty corners are what overlap the D-pad, never a real cell). fitBoardShapeAware
        // reads the actual chrome rects, so it adapts to wherever the clusters land in either
        // orientation. See fitBoardShapeAware.
        if (App.currentMode === 'snake') {
            const placed = this.fitBoardShapeAware(cells, bounds, containerRect);
            if (placed) {
                this.svg.style.position = 'absolute';
                this.svg.style.left = `${placed.offsetX}px`;
                this.svg.style.top = `${placed.offsetY}px`;
                this.svg.style.right = 'auto';
                this.svg.style.bottom = 'auto';
                this.svg.style.width = `${placed.boxW}px`;
                this.svg.style.height = `${placed.boxH}px`;
                return true;
            }
            // Fall through to the flat-clearance fit if no shape-aware placement was found (e.g. a
            // viewport so small the chrome leaves no gap at all) -- a smaller centered board is
            // still better than nothing.
        }

        let { top, bottom, left, right } = this.measureChromeClearance(App.currentMode);

        // Gravity's board sits closer to the D-pad than the flat GAP-based clearance
        // (measureChromeClearance) would allow: the SVG box has an empty padding band below the
        // lowest cell (computeCellBounds pads by HEX_R*2 == HEX_H beyond the cells' own extent),
        // and that empty band may safely overlap the D-pad. Reclaim HALF a hex-row -- not the full
        // padding: reclaiming the whole thing lands the lowest cell's CENTER right at the box
        // bottom, so with a full-width bottom D-pad (narrow portrait) those center points fall
        // under the pad (INV-10). Half leaves the lowest cell ~HALF a cell clear of the pad --
        // still noticeably closer than the flat clearance, with breathing room for a fat finger on
        // the D-pad below. approxScale is a one-shot estimate (this mode's OWN previous fit would
        // be exact, but isn't worth the extra render pass this ties into every resize/update).
        if (App.currentMode === 'gravity' && bottom > 0) {
            const boardHeightUnits = bounds.maxY - bounds.minY;
            if (boardHeightUnits > 0) {
                const approxScale = (containerRect.height - top - bottom) / boardHeightUnits;
                bottom = Math.max(0, bottom - this.HEX_R * approxScale);
            }
        }

        const availW = containerRect.width - left - right;
        const availH = containerRect.height - top - bottom;
        if (availW <= 0 || availH <= 0) return false;

        let boxW, boxH;
        if (availW / availH > contentAspect) {
            boxH = availH;
            boxW = availH * contentAspect;
        } else {
            boxW = availW;
            boxH = availW / contentAspect;
        }

        const offsetX = left + (availW - boxW) / 2;
        const offsetY = top + (availH - boxH) / 2;

        this.svg.style.position = 'absolute';
        this.svg.style.left = `${offsetX}px`;
        this.svg.style.top = `${offsetY}px`;
        this.svg.style.right = 'auto';
        this.svg.style.bottom = 'auto';
        this.svg.style.width = `${boxW}px`;
        this.svg.style.height = `${boxH}px`;
        return true;
    },

    // The actual chrome rectangles for Snake portrait, container-relative and expanded by GAP for
    // visible separation. Deliberately the individual D-pad CLUSTERS (.snake-pad-cluster, the two
    // narrow corner columns), not their full-width wrapper (#snake-mobile-controls, which is
    // pointer-events:none and spans edge-to-edge) -- the wide empty gap between the clusters is
    // exactly the space the shape-aware fit reclaims, so treating the wrapper as one obstacle
    // would defeat the whole point.
    getSnakeChromeRects: function(containerRect) {
        const GAP = 10;
        const rects = [];
        const add = (el) => {
            if (!el || getComputedStyle(el).display === 'none') return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            rects.push({
                x0: r.left - containerRect.left - GAP,
                y0: r.top - containerRect.top - GAP,
                x1: r.right - containerRect.left + GAP,
                y1: r.bottom - containerRect.top + GAP,
            });
        };
        add(document.getElementById('snake-controls'));
        document.querySelectorAll('.snake-pad-cluster').forEach(add);
        return rects;
    },

    // Largest board (at its own aspect ratio, horizontally centered) whose ACTUAL cells clear
    // every chrome rectangle, allowing the SVG box's empty corners to overlap the corner D-pad
    // columns. Returns {offsetX, offsetY, boxW, boxH} (container-relative, ready for #tonnetz-svg's
    // inline style) or null if nothing fits.
    //
    // Cell positions are predicted through the EXACT getFitView->viewBox mapping snake.js applies
    // downstream (getAspectMatchedRefBox + getFitView(scale=1.15) + updateView), so this
    // prediction can't drift from what actually renders: with the box aspect matched to the
    // content aspect, preserveAspectRatio="xMidYMid meet" maps the viewBox onto the box with no
    // letterboxing, giving a single uniform pixels-per-lattice-unit on both axes.
    fitBoardShapeAware: function(cells, bounds, containerRect) {
        const chrome = this.getSnakeChromeRects(containerRect);
        const contentAspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
        const cW = containerRect.width, cH = containerRect.height;
        const MARGIN = 4;

        const cellScreens = (offsetX, offsetY, boxW, boxH) => {
            const refW = 800, refH = 800 * (boxH / boxW);
            const fit = this.getFitView(cells, this.HEX_R * 2, 1.15, refW, refH);
            const ppu = boxW / (refW * fit.zoom); // == boxH/(refH*fit.zoom); uniform (square hexes)
            const r = this.HEX_R * ppu;
            return cells.map(c => {
                const p = this.getRotatedScreenPos(c.p, c.q);
                return {
                    cx: offsetX + (p.x - fit.viewX) * ppu,
                    cy: offsetY + (p.y - fit.viewY) * ppu,
                    r,
                };
            });
        };

        const feasibleAt = (boxW, offsetY) => {
            const boxH = boxW / contentAspect;
            const offsetX = (cW - boxW) / 2;
            const screens = cellScreens(offsetX, offsetY, boxW, boxH);
            for (const s of screens) {
                if (s.cx - s.r < MARGIN || s.cx + s.r > cW - MARGIN) return false;
                if (s.cy - s.r < MARGIN || s.cy + s.r > cH - MARGIN) return false;
                for (const rc of chrome) {
                    if (s.cx + s.r > rc.x0 && s.cx - s.r < rc.x1 &&
                        s.cy + s.r > rc.y0 && s.cy - s.r < rc.y1) return false;
                }
            }
            return true;
        };

        // For a given width, the HIGHEST feasible vertical placement -- the board tucked just under
        // the stats panel, where a person expects it -- found by scanning top-down. The box may
        // overhang the container top/bottom (its empty corners), so the scan starts above 0.
        const findOffsetY = (boxW) => {
            const boxH = boxW / contentAspect;
            const STEPS = 160;
            const yMin = -boxH * 0.5, yMax = cH;
            for (let i = 0; i <= STEPS; i++) {
                const offsetY = yMin + (yMax - yMin) * (i / STEPS);
                if (feasibleAt(boxW, offsetY)) return offsetY;
            }
            return null;
        };

        // Binary search the largest feasible box width (full container width is the ceiling for a
        // horizontally-centered board). Feasibility is monotone: any smaller board fits wherever a
        // larger one did, so the search converges on the maximum.
        let lo = 0, hi = cW, best = null;
        for (let iter = 0; iter < 24; iter++) {
            const mid = (lo + hi) / 2;
            const offsetY = findOffsetY(mid);
            if (offsetY !== null) {
                best = { offsetX: (cW - mid) / 2, offsetY, boxW: mid, boxH: mid / contentAspect };
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return best;
    },

    // On phones, shrink the viewBox (relative to baseZoom) so each hex renders ~1.5x bigger.
    getResponsiveZoom: function(baseZoom = 1) {
        return this.isMobileViewport() ? baseZoom / 1.5 : baseZoom;
    },

    // Screen-space bounding box of every audible hex for the current mode, padded by one
    // hex-width of slack. Every non-restricted mode (see RESTRICTED_MODES) allows free panning;
    // restricted modes return null and are left unclamped (their own fit-to-board view never
    // calls panView anyway). Uses the true audible range (Tonnetz.audibleMinMidi()..
    // audibleMaxMidi(), ~16..135), not the MIDI-protocol range (0..127) -- the latter cuts off
    // audible pitches above 127 (up to ~20kHz) that drawLattice already renders and MAX_ZOOM is
    // meant to reveal all of.
    getPanBounds: function() {
        if (typeof App === 'undefined') return null;
        const mode = App.currentMode;
        if (this.RESTRICTED_MODES.includes(mode)) return null;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const audibleMin = Tonnetz.audibleMinMidi(), audibleMax = Tonnetz.audibleMaxMidi();
        for (let p = -26; p <= 26; p++) {
            for (let q = -26; q <= 26; q++) {
                const midi = Tonnetz.getMidi(p, q);
                if (midi < audibleMin || midi > audibleMax) continue;
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
    // Screen-space bounding box of the given {p, q} cells, padded by `padding` on every side.
    // Shared by getFitView and fitContentBox so both always agree on exactly what content needs
    // to fit -- the aspect ratio fitContentBox sizes the element to is otherwise trivially able
    // to drift out of sync with what getFitView actually fits into it.
    computeCellBounds: function(cells, padding = 0) {
        if (!cells || cells.length === 0) return null;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        cells.forEach(c => {
            const pos = this.getRotatedScreenPos(c.p, c.q);
            minX = Math.min(minX, pos.x - this.HEX_R);
            maxX = Math.max(maxX, pos.x + this.HEX_R);
            minY = Math.min(minY, pos.y - this.HEX_R);
            maxY = Math.max(maxY, pos.y + this.HEX_R);
        });
        return { minX: minX - padding, maxX: maxX + padding, minY: minY - padding, maxY: maxY + padding };
    },

    getFitView: function(cells, padding = 0, scale = 1, refW = 800, refH = 600) {
        const bounds = this.computeCellBounds(cells, padding);
        if (!bounds) {
            return { viewX: -refW / 2, viewY: -refH / 2, zoom: 1 };
        }
        const { minX, maxX, minY, maxY } = bounds;

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
        // Real browser zoom changes devicePixelRatio; dividing by that factor here makes cells
        // shrink/grow with the rest of the page instead of staying a constant CSS-px size
        // regardless of browser zoom -- see INV-53. Zoomed out (factor < 1) -> divide -> MORE
        // world-units shown -> smaller cells, more of the lattice visible, exactly like zooming
        // out on a map. Flows through the pan-bounds clamp and the final viewBox string below
        // unchanged, and into `this.zoom` (read back by main.js's two-finger pan-drag math),
        // since both need to match what's actually rendered on screen.
        zoom = zoom / this.getBrowserZoomFactor();
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
    },

    // The pannable modes' (Sandbox/Melody/Compose) view update. A pannable board is effectively
    // infinite, so its visible window should match the game-container's aspect ratio and fill it
    // edge-to-edge -- not sit inside a fixed 4:3 window letterboxed within a wider/taller container
    // (which wasted the sides of any non-4:3 window, e.g. a wide desktop one). refW stays 800 so
    // horizontal span and zoom magnitude are unchanged from before; only refH tracks the real
    // aspect. See INV-44.
    //
    // Works in view-CENTER coordinates (lattice units), NOT the viewBox top-left, so a caller's
    // stored pan position stays fixed on screen when the container reshapes: aspect-matching makes
    // the top-left depend on refH, so preserving the top-left across a resize/rotate would slide
    // the content, whereas the center is stable. The caller passes/stores the center (null/undefined
    // the first time -> origin-centered) and the pan handlers offset it by drag deltas exactly as
    // they used to offset the old top-left. Returns the (clamp-corrected) center as {viewX, viewY}
    // -- named for drop-in compatibility with the inline `state.viewX = ...` the callers already do.
    panView: function(centerX, centerY, zoom) {
        // Clear any inline sizing a previously-active RESTRICTED mode's fitContentBox left on the
        // SVG element (position:absolute + a fixed width/height sized to that board's own box).
        // Inline styles beat the CSS `svg { width:100%; height:100% }`, so without this the
        // pannable board would render into the leftover restricted-board box -- tiny and
        // off-corner -- instead of filling the whole game-container. Found live: play Gravity/
        // Blast/Snake, then switch to Sandbox/Melody/Compose, and the lattice was stuck at the
        // previous board's size. Restricted modes re-set these inline every fit, so clearing them
        // here (pannable-only) is safe.
        this.svg.style.position = '';
        this.svg.style.left = '';
        this.svg.style.top = '';
        this.svg.style.right = '';
        this.svg.style.bottom = '';
        this.svg.style.width = '';
        this.svg.style.height = '';
        const { refW, refH } = this.getAspectMatchedRefBox();
        if (centerX === null || centerX === undefined) centerX = 0;
        if (centerY === null || centerY === undefined) centerY = 0;
        this.updateView(centerX - refW * zoom / 2, centerY - refH * zoom / 2, zoom, refW, refH);
        // updateView may have clamped the top-left against the pan bounds -- re-derive the center
        // from what it actually applied so the stored center reflects any clamp.
        return { viewX: this.viewX + refW * zoom / 2, viewY: this.viewY + refH * zoom / 2 };
    },

    // Was a REAL touch event just fired, as opposed to a device that merely SUPPORTS touch?
    // Several modes' own svg.onmousedown-based pan/drag (melody.js, sandbox.js, compose.js,
    // timeline.js) used to gate on `'ontouchstart' in window || navigator.maxTouchPoints > 0` --
    // a device CAPABILITY check, true on any hybrid touchscreen laptop even while it's being
    // driven by an ordinary mouse, which silently disabled mouse panning/dragging there entirely
    // (reported live: "I can zoom but not pan" -- worked in Life, which uses real Pointer Events
    // instead and never had this problem). wasRecentlyTouched() tracks actual touchstart events
    // instead, so mouse-only interactions on a touch-capable device work exactly like they would
    // on a mouse-only one, while still suppressing DUPLICATE handling from the synthesized
    // compatibility mouse events browsers fire ~300ms after a real touch.
    _lastTouchTs: -Infinity,
    wasRecentlyTouched: function() {
        return (Date.now() - Render._lastTouchTs) < 500;
    }
};

document.addEventListener('touchstart', () => { Render._lastTouchTs = Date.now(); }, { capture: true, passive: true });
