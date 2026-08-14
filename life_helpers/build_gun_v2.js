#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// build_gun_v2.js — Targeted gun construction for Ortho2/S2.
//
// Strategy: A gun = an oscillator that periodically separates a glider.
// We search for initial configurations where:
//   1. Run N generations
//   2. Split the result into connected components
//   3. Check if any component is a known glider (matches a glider's canonical form)
//   4. Remove glider components and check if the remaining core is periodic
//   5. If the core returns to its initial state AND emits a glider, it's a gun!
//
// We try two approaches:
//   A. Collision synthesis: smash two gliders together
//   B. Random core search: random small clusters that naturally emit gliders

const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, setFrom, pairsFrom,
    classify, enumConnected, canonicalForm,
    bbox, normalize, canonical, connectedComponents,
    isTranslationOf,
} = require('./simulate.js');

const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

const RULE = {
    birth: [{ ring_count: [2], isotropy: ['ortho'] }],
    survival: [{ ring_count: [2] }],
};

// The smallest glider: 5 cells, period 6, disp (-3,3)
const GLIDER_5 = [[0,0],[1,0],[0,-1],[2,-1],[-1,-1]];
const GLIDER_5_CANON = canonicalForm(GLIDER_5);

// Also check the 5-cell gliders that go in other directions
const GLIDER_5B = [[0,0],[1,0],[0,-1],[2,0],[0,-2]]; // disp (-3,0)
const GLIDER_5B_CANON = canonicalForm(GLIDER_5B);
const GLIDER_5C = [[0,0],[1,0],[0,-1],[2,-1],[1,-2]]; // disp (-3,0)
const GLIDER_5C_CANON = canonicalForm(GLIDER_5C);

// All known glider canonical forms
const KNOWN_GLIDER_CANONS = new Set([GLIDER_5_CANON, GLIDER_5B_CANON, GLIDER_5C_CANON]);

// Also include 6-cell gliders
const GLIDER_6A = [[0,0],[1,0],[1,-1],[-1,0],[1,1],[0,2]]; // period 6, disp (3,0)
const GLIDER_6B = [[0,0],[1,0],[1,-1],[-1,0],[1,1],[1,2]]; // period 6, disp (3,-3)
const GLIDER_6C = [[0,0],[1,0],[0,-1],[2,0],[-1,-1],[2,1]]; // period 6, disp (-3,3)
const GLIDER_6D = [[0,0],[1,0],[0,-1],[2,-1],[1,-2],[3,-1]]; // period 6, disp (0,3)
KNOWN_GLIDER_CANONS.add(canonicalForm(GLIDER_6A));
KNOWN_GLIDER_CANONS.add(canonicalForm(GLIDER_6B));
KNOWN_GLIDER_CANONS.add(canonicalForm(GLIDER_6C));
KNOWN_GLIDER_CANONS.add(canonicalForm(GLIDER_6D));

console.log(`Tracking ${KNOWN_GLIDER_CANONS.size} known glider canonical forms`);

function isGliderComponent(compSet) {
    const pairs = pairsFrom(compSet);
    if (pairs.length < 3 || pairs.length > 8) return false;
    const cf = canonicalForm(pairs);
    return KNOWN_GLIDER_CANONS.has(cf);
}

// Check if a configuration is a gun: does it periodically emit gliders?
function checkForGun(initialPairs, maxGens) {
    let live = setFrom(initialPairs);
    const initCanon = canonical(live);

    let gliderEmissions = 0;
    let firstEmission = -1;
    let lastEmission = -1;
    let coreReturned = false;
    let coreReturnGen = -1;

    for (let gen = 1; gen <= maxGens; gen++) {
        live = Life.step(live, RULE);
        if (live.size === 0) return { isGun: false, reason: 'dies' };
        if (live.size > 500) return { isGun: false, reason: 'explodes' };

        // Split into components
        const comps = connectedComponents(live);
        if (comps.length < 2) continue;

        // Check if any component is a glider
        for (const comp of comps) {
            if (isGliderComponent(comp)) {
                gliderEmissions++;
                if (firstEmission < 0) firstEmission = gen;
                lastEmission = gen;

                // Check if the remaining core (non-glider part) matches the initial pattern
                const core = new Set();
                for (const c of comps) {
                    if (c !== comp) for (const k of c) core.add(k);
                }
                const coreCanon = canonical(core);
                if (coreCanon === initCanon) {
                    coreReturned = true;
                    coreReturnGen = gen;
                }
            }
        }
    }

    if (gliderEmissions >= 2 && firstEmission !== lastEmission) {
        return {
            isGun: true,
            emissions: gliderEmissions,
            firstEmission,
            lastEmission,
            period: lastEmission - firstEmission,
            coreReturned,
            coreReturnGen,
        };
    }

    return {
        isGun: false,
        emissions: gliderEmissions,
        reason: gliderEmissions === 0 ? 'no gliders emitted' : 'only one emission',
    };
}

// ---- Approach A: Systematic random search for gun-like initial configs ----
console.log('\n=== Approach A: Random small cluster search ===');
const guns = [];

for (let trial = 0; trial < 50000; trial++) {
    // Random connected cluster of 6-12 cells
    const size = 6 + Math.floor(Math.random() * 7);
    const cells = [[0, 0]];
    const cellSet = new Set([key(0, 0)]);
    while (cells.length < size) {
        const [p, q] = cells[Math.floor(Math.random() * cells.length)];
        const [dp, dq] = NBRS[Math.floor(Math.random() * 6)];
        const np = p + dp, nq = q + dq;
        if (!cellSet.has(key(np, nq))) {
            cells.push([np, nq]);
            cellSet.add(key(np, nq));
        }
    }

    const result = checkForGun(cells, 500);
    if (result.isGun) {
        guns.push({ cells: cells.slice(), ...result });
        console.log(`  GUN FOUND! trial=${trial} size=${cells.length} emissions=${result.emissions} period=${result.period} coreReturned=${result.coreReturned}`);
        console.log(`    cells: ${JSON.stringify(cells)}`);
    }

    if (trial % 5000 === 4999) {
        process.stdout.write(`  ${trial + 1}/50000 trials, ${guns.length} guns found...\n`);
    }
}

console.log(`\nTotal guns found via random search: ${guns.length}`);

// ---- Approach B: Two-glider collisions ----
console.log('\n=== Approach B: Two-glider collision search ===');

const ALL_GLIDERS = [GLIDER_5, GLIDER_5B, GLIDER_5C, GLIDER_6A, GLIDER_6B, GLIDER_6C, GLIDER_6D];

for (let i = 0; i < ALL_GLIDERS.length; i++) {
    for (let j = i; j < ALL_GLIDERS.length; j++) {
        const g1 = ALL_GLIDERS[i];
        const g2 = ALL_GLIDERS[j];

        for (let dp = -15; dp <= 15; dp++) {
            for (let dq = -15; dq <= 15; dq++) {
                const g2moved = g2.map(([p,q]) => [p + dp, q + dq]);
                const allCells = [...g1, ...g2moved];

                // Reject if overlap
                const keys = new Set();
                let overlap = false;
                for (const [p,q] of allCells) {
                    const k = key(p,q);
                    if (keys.has(k)) { overlap = true; break; }
                    keys.add(k);
                }
                if (overlap) continue;

                // Quick pre-filter: skip if the two clusters are too far apart
                const b1 = bbox(setFrom(g1));
                const b2 = bbox(setFrom(g2moved));
                const dist = Math.max(
                    Math.abs((b1.minP + b1.maxP)/2 - (b2.minP + b2.maxP)/2),
                    Math.abs((b1.minQ + b1.maxQ)/2 - (b2.minQ + b2.maxQ)/2),
                );
                if (dist > 10) continue;

                const result = checkForGun(allCells, 500);
                if (result.isGun) {
                    guns.push({ cells: allCells.slice(), source: 'collision', g1idx: i, g2idx: j, dp, dq, ...result });
                    console.log(`  COLLISION GUN! g1=${i} g2=${j} offset=(${dp},${dq}) emissions=${result.emissions} period=${result.period}`);
                    console.log(`    cells: ${JSON.stringify(allCells)}`);
                }
            }
        }
        process.stdout.write(`  Tested glider pair (${i},${j})\r`);
    }
}

console.log(`\nTotal guns found: ${guns.length}`);

if (guns.length > 0) {
    // Sort by smallest + most emissions
    guns.sort((a, b) => a.cells.length - b.cells.length || b.emissions - a.emissions);
    console.log('\n=== BEST GUNS ===');
    for (const g of guns.slice(0, 20)) {
        console.log(`  size=${g.cells.length} emissions=${g.emissions} period=${g.period} coreReturned=${g.coreReturned}`);
        console.log(`    ${JSON.stringify(g.cells)}`);
    }
}
