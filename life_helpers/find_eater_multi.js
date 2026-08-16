#!/usr/bin/env node
const path = require('path');
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const {
    Life, key, parseKey, mapFrom, tripletsFrom, canonicalForm, rotCW, bbox, canonical
} = require('./simulate_multi.js');

const RULE_TABLE = [
    [0, 1, 2, 1, 2, 0, 0],
    [0, 2, 2, 2, 1, 1],
    [0, 0, 2, 2, 0],
    [0, 2, 2, 0],
    [0, 0, 2],
    [2, 0],
    [0]
];
const ORDER = '21';

// Generate small soups to find small stationary oscillators (our candidate eaters)
console.log("Generating candidate eaters...");
const candidates = new Map();

for (let trial = 0; trial < 50000; trial++) {
    let m = new Map();
    // 5x5 box
    for (let p=-2; p<=2; p++) {
        for (let q=-2; q<=2; q++) {
            if (Math.random() < 0.4) m.set(key(p,q), Math.random() < 0.5 ? 1 : 2);
        }
    }
    
    // Simulate until stabilization
    let stable = false;
    let period = 0;
    const history = [];
    
    for (let gen = 0; gen < 50; gen++) {
        // Use an absolute hash for history to ensure it doesn't move!
        const pairs = tripletsFrom(m).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
        const absKey = JSON.stringify(pairs);
        
        if (m.size === 0 || m.size > 30) break; // dead or exploded
        
        const idx = history.indexOf(absKey);
        if (idx !== -1) {
            stable = true;
            period = history.length - idx;
            break;
        }
        history.push(absKey);
        m = Life.stepStates(m, RULE_TABLE, ORDER);
    }
    
    if (stable && period > 0 && period <= 4) {
        // Keep it!
        const c = canonical(m);
        if (!candidates.has(c)) {
            candidates.set(c, { triplets: tripletsFrom(m), period: period });
        }
    }
}

console.log(`Found ${candidates.size} unique candidate eaters.`);

const BEEHIVE_GLIDER = [[1, 1, 2], [2, 1, 2], [0, 2, 1], [0, 3, 2], [1, 3, 2]];

// We need the glider's period and step vector
let gMap = mapFrom(BEEHIVE_GLIDER);
let gPeriod = 0;
let dp = 0, dq = 0;
const startCanon = canonical(gMap);
const bStart = bbox(gMap);

for (let i = 1; i <= 20; i++) {
    gMap = Life.stepStates(gMap, RULE_TABLE, ORDER);
    if (canonical(gMap) === startCanon) {
        gPeriod = i;
        const bNow = bbox(gMap);
        dp = bNow.minP - bStart.minP;
        dq = bNow.minQ - bStart.minQ;
        break;
    }
}
console.log(`Glider period: ${gPeriod}, Vector: (${dp}, ${dq})`);

console.log("Testing collisions...");
let eatersFound = 0;

for (const [canon, core] of candidates.entries()) {
    const corePairs = core.triplets;
    
    // Throw the glider from a distance at the core.
    // The glider travels along (dp, dq). We will place it far away (-dp*15, -dq*15)
    // and sweep across perpendicular offsets and phases.
    
    // Sweep phase:
    let gPhaseMap = mapFrom(BEEHIVE_GLIDER);
    for (let phase = 0; phase < gPeriod; phase++) {
        const gPairs = tripletsFrom(gPhaseMap);
        
        // Sweep offset perpendicular to travel. 
        // If travel is (dp, dq), perpendicular is roughly (-dq, dp) or similar.
        for (let offset = -8; offset <= 8; offset++) {
            
            const startP = -dp * 15 + offset * (-dq);
            const startQ = -dq * 15 + offset * (dp);
            
            // Compose board
            const board = mapFrom(corePairs);
            for (const [p, q, s] of gPairs) {
                board.set(key(p + startP, q + startQ), s);
            }
            
            // Simulate collision
            let live = board;
            let maxGens = 150; // enough time to travel 15 steps and settle
            let survived = false;
            
            for (let gen = 0; gen < maxGens; gen++) {
                live = Life.stepStates(live, RULE_TABLE, ORDER);
                if (live.size === 0 || live.size > 50) break; // exploded or died
                
                if (canonical(live) === canon) {
                    survived = true;
                    break; // IT SURVIVED AND ATE THE GLIDER!
                }
            }
            
            if (survived) {
                console.log(`\nEATER FOUND!`);
                console.log(`Core Size: ${corePairs.length}`);
                console.log(`Core Triplets: ${JSON.stringify(corePairs)}`);
                console.log(`Phase: ${phase}, Offset: ${offset}`);
                eatersFound++;
                if (eatersFound >= 5) process.exit(0);
            }
        }
        
        gPhaseMap = Life.stepStates(gPhaseMap, RULE_TABLE, ORDER);
    }
}

if (eatersFound === 0) console.log("No eaters found.");
