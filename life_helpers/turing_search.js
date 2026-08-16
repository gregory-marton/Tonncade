#!/usr/bin/env node
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const { Life, mapFrom, tripletsFrom, canonical, key, rotCW, connectedComponents } = require('./simulate_multi.js');
const fs = require('fs');

// We will search 2-state and 3-state rules.
// For now, let's search 3-state rules (transition tables) because they have rich glider dynamics.

const BEST_RULE = [[0,0,0,2,2,0,0],[0,0,0,1,2,2],[2,2,0,0,0],[1,0,0,0],[0,0,0],[0,0],[2]];

console.log("=== Phase 4: Full Component Cross-Testing ===");
const gliders = [];
const stationaries = [];

for (let trial = 0; trial < 1000; trial++) {
    let m = new Map();
    for (let p=-2; p<=2; p++) {
        for (let q=-2; q<=2; q++) {
            if (Math.random() < 0.4) m.set(key(p,q), Math.random() < 0.5 ? 1 : 2);
        }
    }

    const history = [];
    const absHistory = [];
    
    for (let gen = 0; gen < 50; gen++) {
        if (m.size === 0 || m.size > 100) break;
        
        const c = canonical(m);
        const pairs = tripletsFrom(m).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
        const absKey = JSON.stringify(pairs);

        const absIdx = absHistory.indexOf(absKey);
        if (absIdx !== -1) {
            const period = absHistory.length - absIdx;
            if (m.size <= 10 && !stationaries.some(s => s.c === c)) {
                stationaries.push({ c, triplets: tripletsFrom(m), period });
            }
            break;
        }

        const cIdx = history.indexOf(c);
        if (cIdx !== -1) {
            if (m.size <= 12 && !gliders.some(g => g.c === c)) {
                gliders.push({ c, triplets: tripletsFrom(m) });
            }
            break;
        }

        history.push(c);
        absHistory.push(absKey);
        m = Life.stepStates(m, BEST_RULE, '21');
    }
}

console.log(`Extracted ${gliders.length} gliders and ${stationaries.length} stationary blocks.`);
if (gliders.length === 0 || stationaries.length === 0) process.exit(0);

// Test the first extracted glider against itself (rotated) for mutual annihilation
const GLIDER = gliders[0].triplets;
let annihilations = 0;

console.log("=== Phase 5: Synthesizing Logic Gates (Glider-Glider Annihilation) ===");

for (let r = 1; r < 6; r++) { // Don't test angle 0, they would just tail-chase
    let G2 = [];
    for (const [p, q, s] of GLIDER) {
        let cp = p, cq = q;
        for (let i=0; i<r; i++) [cp, cq] = rotCW(cp, cq);
        G2.push([cp, cq, s]);
    }
    
    // Sweep offsets
    for (let op = -15; op <= 15; op++) {
        for (let oq = -15; oq <= 15; oq++) {
            
            let board = new Map();
            // Place G1 at a distance
            for (const [p, q, s] of GLIDER) board.set(key(p + 15, q), s);
            
            // Place G2 at an offset
            for (const [p, q, s] of G2) board.set(key(p + op, q + oq), s);
            
            if (board.size < GLIDER.length * 2) continue;
            
            let live = board;
            let annihilated = false;
            
            for (let gen = 0; gen < 80; gen++) {
                live = Life.stepStates(live, BEST_RULE, '21');
                if (live.size === 0) {
                    annihilated = true;
                    break;
                }
                if (live.size > 50) break;
            }
            
            if (annihilated) {
                console.log(`LOGIC GATE (Mutual Annihilation) FOUND! Angle: ${r}, Offset: (${op}, ${oq})`);
                annihilations++;
            }
        }
    }
}
console.log(`Phase 5 Complete: ${annihilations} annihilation vectors found.`);
