#!/usr/bin/env node
const path = require('path');
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const {
    Life, key, parseKey, mapFrom, tripletsFrom, canonicalForm, connectedComponents
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

const BEEHIVE_GLIDER = [
    [1, 1, 2],
    [2, 1, 2],
    [0, 2, 1],
    [0, 3, 2],
    [1, 3, 2]
];

const GLIDER_CANON = canonicalForm(BEEHIVE_GLIDER);

function isGlider(compTriplets) {
    if (compTriplets.length < 4 || compTriplets.length > 7) return false;
    return canonicalForm(compTriplets) === GLIDER_CANON;
}

function reflectP(p, q, s) {
    return [p, -p - q, s];
}

function applyBilateral(triplets) {
    const m = new Map();
    for (const [p, q, s] of triplets) {
        m.set(key(p, q), s);
        const [rp, rq, rs] = reflectP(p, q, s);
        m.set(key(rp, rq), rs);
    }
    return tripletsFrom(m);
}

function checkPuffer(initialTriplets, maxGens) {
    let live = mapFrom(initialTriplets);
    let maxGliders = 0;

    for (let gen = 1; gen <= maxGens; gen++) {
        live = Life.stepStates(live, RULE_TABLE, ORDER);
        if (live.size === 0 || live.size > 1500) return false;

        const comps = connectedComponents(live);
        if (comps.length > 1) {
            let coreCells = 0;
            let glidersNow = 0;
            for (const comp of comps) {
                if (isGlider(tripletsFrom(comp))) glidersNow++;
                else coreCells += comp.size;
            }
            if (glidersNow > maxGliders) maxGliders = glidersNow;
            if (coreCells === 0) return false;
        }
    }
    // A true puffer will shed a lot of gliders or debris.
    return maxGliders >= 15; 
}

console.log("Searching for 3-state PUFFERS (bilaterally symmetric)...");
let found = 0;

for (let trial = 0; trial < 100000; trial++) {
    const radius = 3 + Math.floor(Math.random() * 2);
    
    const seed = [];
    for (let p = -radius; p <= radius; p++) {
        for (let q = -radius; q <= radius; q++) {
            if (Math.abs(p + q) <= radius) {
                if (Math.random() < 0.3) {
                    const s = Math.random() < 0.5 ? 1 : 2;
                    seed.push([p, q, s]);
                }
            }
        }
    }
    
    if (seed.length === 0) continue;
    
    const symPairs = applyBilateral(seed);
    
    if (checkPuffer(symPairs, 400)) {
        console.log(`PUFFER FOUND! Trial ${trial}, Size: ${symPairs.length}`);
        console.log(JSON.stringify(symPairs));
        found++;
        if (found >= 5) break;
    }
}
if (found === 0) console.log("No puffers found.");
