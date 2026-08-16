#!/usr/bin/env node
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const { Life, mapFrom, tripletsFrom, canonical, key, rotCW, connectedComponents } = require('./simulate_multi.js');
const fs = require('fs');

// We will search 2-state and 3-state rules.
// For now, let's search 3-state rules (transition tables) because they have rich glider dynamics.

const BEST_RULE = [[0,0,0,2,2,0,0],[0,0,0,1,2,2],[2,2,0,0,0],[1,0,0,0],[0,0,0],[0,0],[2]];

// From our extraction phase:
const GLIDER = [[6,-2,2],[6,-3,2],[7,-2,2],[6,-1,2],[5,0,2],[6,0,1],[4,1,2]]; // Size 7 glider
const BLOCK = [[-1,-2,2],[-2,-1,2],[1,0,2],[2,1,2]]; // Size 4, Period 2 stationary block

console.log("=== Phase 3: Testing Glider-Block Collisions ===");

// Place BLOCK at origin.
const canonBlock = canonical(mapFrom(BLOCK));

let eaters = 0;
let reflectors = 0;

for (let r = 0; r < 6; r++) {
    let G2 = [];
    for (const [p, q, s] of GLIDER) {
        let cp = p, cq = q;
        for (let i=0; i<r; i++) [cp, cq] = rotCW(cp, cq);
        G2.push([cp, cq, s]);
    }
    
    // Test offsets
    for (let op = -15; op <= 15; op++) {
        for (let oq = -15; oq <= 15; oq++) {
            
            let board = new Map();
            for (const [p, q, s] of BLOCK) board.set(key(p, q), s);
            for (const [p, q, s] of G2) board.set(key(p + op, q + oq), s);
            
            // Check if they are already overlapping or too close
            if (board.size < BLOCK.length + G2.length) continue;
            
            let live = board;
            let survived = false;
            let reflected = false;
            
            for (let gen = 0; gen < 80; gen++) {
                live = Life.stepStates(live, BEST_RULE, '21');
                if (live.size === 0 || live.size > 50) break;
                
                // If it collapses back to JUST the block (period 2 means it alternates, but canonical matches)
                const c = canonical(live);
                if (c === canonBlock) {
                    survived = true;
                    break;
                }
                
                // If it splits into the block AND a glider (which we can detect by component sizes: 4 and 7)
                const comps = connectedComponents(live);
                if (comps.length === 2) {
                    if ((comps[0].size === 4 && comps[1].size === 7) || (comps[0].size === 7 && comps[1].size === 4)) {
                        // Could be a reflection or pass-through
                        // We check if it's the block + a glider
                        if (canonical(mapFrom(tripletsFrom(comps[0]))) === canonBlock || canonical(mapFrom(tripletsFrom(comps[1]))) === canonBlock) {
                            reflected = true; // (or just passed through, but we count it)
                        }
                    }
                }
            }
            
            if (survived) {
                console.log(`EATER FOUND! Angle: ${r}, Offset: (${op}, ${oq})`);
                eaters++;
            }
            if (reflected && !survived) {
                console.log(`REFLECTOR/PASSTHROUGH FOUND! Angle: ${r}, Offset: (${op}, ${oq})`);
                reflectors++;
            }
        }
    }
}
console.log(`Phase 3 Complete: ${eaters} Eater collisions, ${reflectors} Reflector/Pass-through collisions.`);
