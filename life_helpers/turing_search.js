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

// Phase 6: Fast Glider Gun Search via Glider-Block Collisions
console.log("=== Phase 6: Fast Glider Gun Search (Glider + Block Collisions) ===");

let guns = 0;
const GLIDER = gliders[0].triplets;
const maxB = Math.min(20, stationaries.length);

for (let bIdx = 0; bIdx < maxB; bIdx++) {
    const BLOCK = stationaries[bIdx].triplets;
    
    for (let r = 0; r < 6; r++) {
        let G2 = [];
        for (const [p, q, s] of GLIDER) {
            let cp = p, cq = q;
            for (let i=0; i<r; i++) [cp, cq] = rotCW(cp, cq);
            G2.push([cp, cq, s]);
        }
        
        for (let op = -12; op <= 12; op++) {
            for (let oq = -12; oq <= 12; oq++) {
                
                let board = new Map();
                for (const [p, q, s] of BLOCK) board.set(key(p, q), s);
                for (const [p, q, s] of G2) board.set(key(p + op, q + oq), s);
                
                if (board.size < BLOCK.length + G2.length) continue;
                
                let live = board;
                let isGun = false;
                
                let pop100 = 0, pop150 = 0, pop200 = 0;
                
                for (let gen = 0; gen < 250; gen++) {
                    live = Life.stepStates(live, BEST_RULE, '21');
                    if (live.size === 0 || live.size > 200) break;
                    
                    if (gen === 100) pop100 = live.size;
                    if (gen === 150) pop150 = live.size;
                    if (gen === 200) pop200 = live.size;
                    
                    // A gun should continuously increase the population as it ejects gliders.
                    if (gen === 249 && pop100 > 0 && pop150 > pop100 && pop200 > pop150 && live.size > pop200) {
                        // Linear growth! Highly likely to be a Glider Gun!
                        isGun = true;
                    }
                }
                
                if (isGun) {
                    console.log(`GLIDER GUN FOUND! Block ${bIdx} + Glider 0 | Angle: ${r}, Offset: (${op}, ${oq})`);
                    guns++;
                    
                    if (guns === 1) {
                        const yaml = `name: "Turing Glider Gun Candidate"
states: 3
order: "21"
transition:
  - [0, 0, 0, 2, 2, 0, 0]
  - [0, 0, 0, 1, 2, 2]
  - [2, 2, 0, 0, 0]
  - [1, 0, 0, 0]
  - [0, 0, 0]
  - [0, 0]
  - [2]
initial:
  cells:
${BLOCK.map(c => `    - [${c[0]}, ${c[1]}, ${c[2]}]`).join('\\n')}
${G2.map(c => `    - [${c[0] + op}, ${c[1] + oq}, ${c[2]}]`).join('\\n')}
tempo: 120
`;
                        require('fs').writeFileSync('life/turing-gun-demo.yaml', yaml);
                        console.log("Wrote life/turing-gun-demo.yaml!");
                        process.exit(0);
                    }
                }
            }
        }
    }
}
console.log(`Phase 6 Complete: ${guns} Glider Guns found.`);
