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
 * pieces.js - Tetrahex definitions and rotation logic.
 * 
 * Uses axial coordinates (p, q).
 * Rotation (60°): (p, q) -> (-q, p + q)
 */

const Pieces = {
    // The 10 one-sided tetrahexes
    // Each piece is an array of {p, q} offsets from a center (0,0)
    TYPES: {
        'P': {
            name: 'P',
            color: '#4b4bff',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:0}, {p:-1, q:1}]
        },
        'Q': {
            name: 'Q',
            color: '#ff9c4b',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:0}, {p:0, q:1}]
        },
        'L': {
            name: 'L',
            color: '#4bff4b',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:0}, {p:1, q:1}]
        },
        'J': {
            name: 'J',
            color: '#ff4bff',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:0}, {p:2, q:-1}]
        },
        'S': {
            name: 'S',
            color: '#9c4b4b',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:0, q:1}, {p:1, q:1}]
        },
        'Z': {
            name: 'Z',
            color: '#ff4b9c',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:-1}, {p:2, q:-1}]
        },
        'I': {
            name: 'I',
            color: '#ff4b4b',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:0}, {p:2, q:0}]
        },
        'O': {
            name: 'O',
            color: '#f9ff4b',
            cells: [{p:0, q:0}, {p:1, q:0}, {p:0, q:1}, {p:1, q:1}]
        },
        'C': {
            name: 'C',
            color: '#4bffff',
            cells: [{p:0, q:0}, {p:1, q:0}, {p:1, q:1}, {p:-1, q:1}]
        },
        'X': {
            name: 'X',
            color: '#4b9f4b',
            cells: [{p:0, q:0}, {p:1, q:0}, {p:-1, q:1}, {p:0, q:-1}]
        },
        '|': {
            name: '|',
            color: '#f15bb5',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:0}]
        },
        '>': {
            name: '>',
            color: '#00bbf9',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:0, q:1}]
        },
        '<': {
            name: '<',
            color: '#00f5d4',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:1, q:-1}]
        },
        'V': {
            name: 'V',
            color: '#fee440',
            cells: [{p:-1, q:0}, {p:0, q:0}, {p:-1, q:1}]
        },
        '-': {
            name: '-',
            color: '#9b5de5',
            cells: [{p:-1, q:0}, {p:0, q:0}]
        },
        '.': {
            name: '.',
            color: '#b0b0b0',
            cells: [{p:0, q:0}]
        }
    },

    TETRAHEX_KEYS: ['P', 'Q', 'L', 'J', 'S', 'Z', 'I', 'O', 'C', 'X'],

    // Rotate 60 degrees clockwise
    rotate: function(cells) {
        return cells.map(c => ({
            p: -c.q,
            q: c.p + c.q
        }));
    },

    // Rotate 60 degrees counter-clockwise
    rotateCCW: function(cells) {
        return cells.map(c => ({
            p: c.p + c.q,
            q: -c.p
        }));
    },

    // Get absolute coordinates for a piece at (p, q) with a certain rotation
    getAbsoluteCells: function(typeKey, p, q, rotationSteps = 0) {
        let cells = this.TYPES[typeKey].cells;
        for (let i = 0; i < rotationSteps; i++) {
            cells = this.rotate(cells);
        }
        return cells.map(c => ({
            p: p + c.p,
            q: q + c.q
        }));
    }
};

if (typeof module !== 'undefined') {
    module.exports = Pieces;
}
