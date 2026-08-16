#!/usr/bin/env node
const path = require('path');
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const {
    Life, key, parseKey, mapFrom, tripletsFrom, canonicalForm, connectedComponents, rotCW, bbox
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

const BEEHIVE_GLIDER = [[1, 1, 2], [2, 1, 2], [0, 2, 1], [0, 3, 2], [1, 3, 2]];
const GLIDER_CANON = canonicalForm(BEEHIVE_GLIDER);

function isGlider(compTriplets) {
    if (compTriplets.length < 4 || compTriplets.length > 7) return false;
    return canonicalForm(compTriplets) === GLIDER_CANON;
}

function rot120(p, q, s) {
    const [p1, q1] = rotCW(p, q);
    const [p2, q2] = rotCW(p1, q1);
    return [p2, q2, s];
}

function rot180(p, q, s) {
    return [-p, -q, s];
}

function applySymmetry(triplets, symType) {
    const m = new Map();
    for (const [p, q, s] of triplets) {
        m.set(key(p, q), s);
        if (symType === 'rot180') {
            const [rp, rq, rs] = rot180(p, q, s);
            m.set(key(rp, rq), rs);
        } else if (symType === 'rot120') {
            const [p1, q1, s1] = rot120(p, q, s);
            const [p2, q2, s2] = rot120(p1, q1, s1);
            m.set(key(p1, q1), s1);
            m.set(key(p2, q2), s2);
        } else if (symType === 'rot60') {
            let cp = p, cq = q, cs = s;
            for (let i=0; i<5; i++) {
                const [np, nq] = rotCW(cp, cq);
                cp = np; cq = nq;
                m.set(key(cp, cq), cs);
            }
        }
    }
    return tripletsFrom(m);
}

function checkSymmetricGun(initialTriplets, maxGens) {
    let live = mapFrom(initialTriplets);
    const gliderHistory = [];

    for (let gen = 1; gen <= maxGens; gen++) {
        live = Life.stepStates(live, RULE_TABLE, ORDER);
        if (live.size === 0 || live.size > 2000) return false;

        if (gen % 50 === 0) {
            const comps = connectedComponents(live);
            let coreCells = 0;
            let glidersNow = 0;
            for (const comp of comps) {
                if (isGlider(tripletsFrom(comp))) glidersNow++;
                else coreCells += comp.size;
            }
            if (coreCells === 0) return false;
            gliderHistory.push(glidersNow);
        }
    }
    
    if (gliderHistory.length < 8) return false;
    
    // Ensure the number of gliders strictly increased at the end of the simulation
    const last = gliderHistory.length - 1;
    if (gliderHistory[last] > gliderHistory[last-1] && 
        gliderHistory[last-1] > gliderHistory[last-2] &&
        gliderHistory[last-2] > 4) {
        
        // Ensure the non-glider core is small and stationary
        const comps = connectedComponents(live);
        let coreMap = new Map();
        for (const comp of comps) {
            if (!isGlider(tripletsFrom(comp))) {
                for (const [k, v] of comp.entries()) coreMap.set(k, v);
            }
        }
        const b = bbox(coreMap);
        const w = b.maxP - b.minP;
        const h = b.maxQ - b.minQ;
        
        // A true stationary core shouldn't be larger than a small area
        if (w < 40 && h < 40) return true;
    }
    return false;
}

console.log("Searching for 3-state TRUE GUNS (rotationally symmetric)...");
let found = 0;
const symTypes = ['rot180', 'rot120', 'rot60'];

for (let trial = 0; trial < 100000; trial++) {
    const sym = symTypes[Math.floor(Math.random() * symTypes.length)];
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
    
    const symPairs = applySymmetry(seed, sym);
    
    if (checkSymmetricGun(symPairs, 400)) {
        console.log(`TRUE GUN FOUND! Trial ${trial}, Sym: ${sym}, Size: ${symPairs.length}`);
        console.log(JSON.stringify(symPairs));
        found++;
        if (found >= 5) break;
    }
}
if (found === 0) console.log("No true guns found.");
