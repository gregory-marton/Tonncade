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
 * life.js - Life Mode: cellular automata on the Tonnetz lattice, driven by YAML automaton files
 * (each file carries both a rule and a starting state). The goal is to explore which automata make
 * pretty music on the Tonnetz. See docs/life-rules.md for the rule language.
 *
 * This file is being built bottom-up. Landed so far: the neighbour geometry and the isotropy
 * classifier -- the pure core the rule evaluator keys on. The evaluator, YAML loader, mode UI and
 * sound come next.
 */

const Life = {
    // The 6 adjacent hexes -- the "consonant ring" -- in cyclic order around the hexagon. These
    // are the neighbours `count` and `isotropy` see. Intervals via getMidi(p,q)=60+7p+3q.
    RING: [
        { name: 'fifth_up',         dp: 1,  dq: 0 },   // +7  (P5)
        { name: 'major_third_up',   dp: 1,  dq: -1 },  // +4  (M3)
        { name: 'minor_third_down', dp: 0,  dq: -1 },  // -3  (m3)
        { name: 'fifth_down',       dp: -1, dq: 0 },   // -7  (P5)
        { name: 'major_third_down', dp: -1, dq: 1 },   // -4  (M3)
        { name: 'minor_third_up',   dp: 0,  dq: 1 },   // +3  (m3)
    ],

    // Non-adjacent but musically important neighbours, each the nearest lattice cell at that exact
    // interval (see docs/life-rules.md). Rules can require/forbid these by name.
    INTERVALS: {
        semitone_up:   { dp: 1,  dq: -2 },  // +1
        semitone_down: { dp: -1, dq: 2 },   // -1
        tone_up:       { dp: -1, dq: 3 },   // +2
        tone_down:     { dp: 1,  dq: -3 },  // -2
        tritone_up:    { dp: 0,  dq: 2 },   // +6
        tritone_down:  { dp: 0,  dq: -2 },  // -6
    },

    // Named canonical arrangements of the live consonant ring (see docs/life-rules.md). The
    // canonical form is the lexicographically-largest rotation/reflection of the 6-bit ring, so a
    // block of leading 1s reads out the familiar shapes.
    ISOTROPY_NAMES: {
        '000000': 'empty',
        '100000': 'single',
        '110000': 'ortho',
        '101000': 'meta',
        '100100': 'para',
        '111000': 'vicinal',
        '111111': 'full',
    },

    // Classify a live consonant ring (array of 6 truthy/falsy in RING slot order) by its orbit
    // under the dihedral group -- i.e. up to rotation AND reflection. Returns the active `count`,
    // the `canonical` bit-string, a `name` (a known arrangement or just the count), and whether the
    // arrangement is `symmetric` (has a reflection axis / achiral) vs `chiral` (its mirror is a
    // DISTINCT arrangement) -- and a reflection of the ring is a musical inversion, so chirality
    // carries harmonic meaning.
    classifyRing: function(ring) {
        const n = 6;
        const bits = [];
        for (let i = 0; i < n; i++) bits.push(ring[i] ? 1 : 0);
        const count = bits.reduce((s, b) => s + b, 0);

        const rotate = (a, r) => a.map((_, i) => a[(i + r) % n]);
        const asStr = (a) => a.join('');

        const rotations = [];
        for (let r = 0; r < n; r++) rotations.push(rotate(bits, r));
        const mirror = bits.slice().reverse();
        const reflections = [];
        for (let r = 0; r < n; r++) reflections.push(rotate(mirror, r));

        // Canonical = the largest string over all 12 dihedral forms (rotations + reflections).
        let canonical = asStr(bits);
        for (const f of rotations.concat(reflections)) {
            const s = asStr(f);
            if (s > canonical) canonical = s;
        }

        // Symmetric iff some reflection maps the ring to itself (a reflection axis exists).
        const ringStr = asStr(bits);
        const symmetric = reflections.some((f) => asStr(f) === ringStr);

        const name = this.ISOTROPY_NAMES[canonical] || String(count);
        return { count, canonical, name, symmetric, chiral: !symmetric };
    },
};

if (typeof module !== 'undefined') {
    module.exports = Life;
}
