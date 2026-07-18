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
 * board.js - State management for the bounded Blast board.
 * 
 * Radius 5 Hexagon (11 cells across at widest point).
 * Coordinates are axial (p, q).
 * 
 * Axes (user defined):
 * - f (Fifths): Horizontal (p increases, q constant)
 * - m (Minor Thirds): SW to NE (p constant, q increases)
 * - t (Major Thirds): NW to SE (p increases, q decreases)
 */

const Board = {
    radius: 5,
    cells: new Map(), // Key: "p,q", Value: { type, color }
    
    // Check if a cell is within the active game bounds
    isInBounds: function(p, q) {
        if (typeof App !== 'undefined' && App.currentMode === 'gravity') {
            const col = p + Math.floor(q / 2);
            return q >= 0 && col >= -5 && col <= 4;
        }
        return Math.abs(p) <= this.radius && 
               Math.abs(q) <= this.radius && 
               Math.abs(p + q) <= this.radius;
    },

    isCellEmpty: function(p, q) {
        return this.isInBounds(p, q) && !this.cells.has(`${p},${q}`);
    },

    fillCells: function(pieceCells, type, color) {
        pieceCells.forEach(c => {
            this.cells.set(`${c.p},${c.q}`, { type, color });
        });
    },

    clearCells: function(pieceCells) {
        pieceCells.forEach(c => {
            this.cells.delete(`${c.p},${c.q}`);
        });
    },

    /**
     * Detection logic for the three axes (f, m, t).
     * A line is a straight sequence from one boundary to the other.
     */
    findFullLines: function() {
        const fullLines = [];

        if (typeof App !== 'undefined' && App.currentMode === 'gravity') {
            // Find completed horizontal rows in the cup (q: 0 to 14)
            for (let q = 0; q < 15; q++) {
                const line = [];
                let complete = true;
                for (let col = -5; col <= 4; col++) {
                    const p = col - Math.floor(q / 2);
                    if (this.cells.has(`${p},${q}`)) {
                        line.push({ p, q });
                    } else {
                        complete = false;
                        break;
                    }
                }
                if (complete) {
                    fullLines.push(line);
                }
            }
            return fullLines;
        }

        // 1. f-axis (Fifths): Horizontal (fixed q, p varies)
        for (let q = -this.radius; q <= this.radius; q++) {
            const line = [];
            // Calculate valid p range for this q in the hexagon
            const minP = Math.max(-this.radius, -this.radius - q);
            const maxP = Math.min(this.radius, this.radius - q);
            
            for (let p = minP; p <= maxP; p++) {
                if (this.cells.has(`${p},${q}`)) {
                    line.push({p, q});
                } else {
                    line.length = 0; // Break if gap
                    break;
                }
            }
            if (line.length > 0) fullLines.push(line);
        }

        // 2. m-axis (Minor Thirds): SW to NE (fixed p, q varies)
        for (let p = -this.radius; p <= this.radius; p++) {
            const line = [];
            const minQ = Math.max(-this.radius, -this.radius - p);
            const maxQ = Math.min(this.radius, this.radius - p);
            
            for (let q = minQ; q <= maxQ; q++) {
                if (this.cells.has(`${p},${q}`)) {
                    line.push({p, q});
                } else {
                    line.length = 0;
                    break;
                }
            }
            if (line.length > 0) fullLines.push(line);
        }

        // 3. t-axis (Major Thirds): NW to SE (p + q = constant)
        for (let s = -this.radius; s <= this.radius; s++) {
            const line = [];
            // For a constant s = p + q
            for (let p = -this.radius; p <= this.radius; p++) {
                const q = s - p;
                if (this.isInBounds(p, q)) {
                    if (this.cells.has(`${p},${q}`)) {
                        line.push({p, q});
                    } else {
                        line.length = 0;
                        break;
                    }
                }
            }
            if (line.length > 0) fullLines.push(line);
        }

        return fullLines;
    },

    checkGameOver: function(nextPieceType) {
        const rotations = [0, 1, 2, 3, 4, 5];
        
        if (typeof App !== 'undefined' && App.currentMode === 'gravity') {
            for (let q = 0; q <= 20; q++) {
                for (let col = -6; col <= 5; col++) {
                    const p = col - Math.floor(q / 2);
                    for (const rot of rotations) {
                        if (this.checkActivePlacement(nextPieceType, p, q, rot)) {
                            return false;
                        }
                    }
                }
            }
            return true;
        }

        // Blast Mode default check
        for (let p = -this.radius; p <= this.radius; p++) {
            for (let q = -this.radius; q <= this.radius; q++) {
                if (!this.isInBounds(p, q)) continue;
                
                for (const rot of rotations) {
                    const cells = Pieces.getAbsoluteCells(nextPieceType, p, q, rot);
                    if (cells.every(c => this.isCellEmpty(c.p, c.q))) {
                        return false; // Still a valid move
                    }
                }
            }
        }
        return true; // No moves left
    },

    checkPlacement: function(type, p, q, rotation) {
        const cells = Pieces.getAbsoluteCells(type, p, q, rotation);
        return cells.every(c => this.isCellEmpty(c.p, c.q));
    },

    checkActivePlacement: function(type, p, q, rotation) {
        const cells = Pieces.getAbsoluteCells(type, p, q, rotation);
        return cells.every(c => {
            const col = c.p + Math.floor(c.q / 2);
            const inBounds = c.q >= 0 && col >= -6 && col <= 5;
            return inBounds && !this.cells.has(`${c.p},${c.q}`);
        });
    }
};

if (typeof module !== 'undefined') {
    module.exports = Board;
}
