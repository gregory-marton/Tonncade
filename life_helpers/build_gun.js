#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// build_gun.js — Construct a flyer gun for the Ortho2/S2 rule.
//
// The Ortho2/S2 rule (birth on 2 ortho-arranged neighbors, survive on exactly 2)
// has 63 gliders and 326 oscillators among patterns up to size 8.
//
// Strategy for gun construction:
// 1. Take the smallest glider(s) and nearby oscillators
// 2. Try colliding a glider with each oscillator — if the oscillator survives
//    and a new glider is emitted, we have a gun!
// 3. Also try two-glider collisions that produce an oscillator + glider stream

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

// Key gliders from the search
const GLIDERS = [
    { cells: [[0,0],[1,0],[0,-1],[2,-1],[-1,-1]], period: 6, dp: -3, dq: 3 },
    { cells: [[0,0],[1,0],[1,-1],[-1,0],[1,1],[0,2]], period: 6, dp: 3, dq: 0 },
    { cells: [[0,0],[1,0],[1,-1],[-1,0],[1,1],[1,2]], period: 6, dp: 3, dq: -3 },
    { cells: [[0,0],[1,0],[0,-1],[2,0],[-1,-1],[2,1]], period: 6, dp: -3, dq: 3 },
    { cells: [[0,0],[1,0],[0,-1],[2,-1],[1,-2],[3,-1]], period: 6, dp: 0, dq: 3 },
];

// Find oscillators
console.log('Finding oscillators...');
const patterns = enumConnected(7);
const oscillators = [];
const stillLifes = [];

for (const [cf, pairs] of patterns) {
    const r = classify(pairs, RULE, 200);
    if (r.type === 'oscillator') {
        if (r.period > 1) oscillators.push({ cells: pairs.slice(), period: r.period, size: r.size });
        else stillLifes.push({ cells: pairs.slice() });
    }
}

console.log(`Found ${oscillators.length} oscillators (period>1), ${stillLifes.length} still lifes`);
console.log('Oscillator periods:', [...new Set(oscillators.map(o => o.period))].sort((a,b) => a-b).join(', '));

// Show all oscillators
for (const o of oscillators) {
    console.log(`  period=${o.period} size=${o.cells.length}: ${JSON.stringify(o.cells)}`);
}

// ---- GUN SEARCH: Collide gliders with oscillators ----
console.log('\n=== Gun search: glider + oscillator collisions ===');

function runForGun(initialCells, maxGens) {
    let live = setFrom(initialCells);

    // Track: does the pattern periodically emit separated components?
    const history = [];

    for (let gen = 0; gen <= maxGens; gen++) {
        if (live.size === 0) return { type: 'dies', gen };
        if (live.size > 500) return { type: 'explodes', gen };

        const comps = connectedComponents(live);
        history.push({
            gen,
            size: live.size,
            nComps: comps.length,
            compSizes: comps.map(c => c.size).sort((a,b) => b-a),
        });

        if (gen < maxGens) live = Life.step(live, RULE);
    }

    // Analyze for gun-like behavior:
    // A gun should show component count increasing over time (new gliders emitted)
    const compCounts = history.map(h => h.nComps);
    const maxComps = Math.max(...compCounts);

    // Check if components keep getting added
    const earlyMax = Math.max(...compCounts.slice(0, 50));
    const lateMax = Math.max(...compCounts.slice(-50));

    // Check for periodicity in the "core" component size
    // A gun's core oscillates while emitting gliders
    const lateSizes = history.slice(-100).map(h => h.size);
    const sizeGrows = lateSizes[lateSizes.length - 1] > lateSizes[0];

    return {
        type: 'analyzed',
        maxComps,
        earlyMax,
        lateMax,
        sizeGrows,
        finalSize: history[history.length - 1].size,
        finalComps: history[history.length - 1].nComps,
        history,
    };
}

const gunCandidates = [];

for (const glider of GLIDERS) {
    for (const osc of oscillators) {
        // Place the glider at various offsets from the oscillator, aimed at it
        // The glider moves by (dp, dq) per period. Place it so it will collide.
        for (let t = 1; t <= 5; t++) {
            // Place glider t periods away from the oscillator
            const gp = -glider.dp * t;
            const gq = -glider.dq * t;

            const gliderCells = glider.cells.map(([p, q]) => [p + gp, q + gq]);

            // Check for overlap
            const allCells = [...osc.cells, ...gliderCells];
            const keys = new Set();
            let overlap = false;
            for (const [p, q] of allCells) {
                const k = key(p, q);
                if (keys.has(k)) { overlap = true; break; }
                keys.add(k);
            }
            if (overlap) continue;

            const result = runForGun(allCells, 300);

            if (result.type === 'analyzed' && result.sizeGrows && result.lateMax >= 3) {
                gunCandidates.push({
                    glider: glider.cells,
                    osc: osc.cells,
                    t,
                    gp, gq,
                    ...result,
                });
                if (gunCandidates.length <= 20) {
                    console.log(`  Candidate: glider at t=${t} offset=(${gp},${gq}), maxComps=${result.maxComps}, finalComps=${result.finalComps}, finalSize=${result.finalSize}, sizeGrows=${result.sizeGrows}`);
                }
            }
        }
    }
    console.log(`  Tested glider ${JSON.stringify(glider.cells)} against ${oscillators.length} oscillators`);
}

console.log(`\nTotal gun candidates: ${gunCandidates.length}`);

if (gunCandidates.length > 0) {
    // Find the best candidate: most growing, most components
    gunCandidates.sort((a, b) => b.finalComps - a.finalComps || b.maxComps - a.maxComps);

    console.log('\n=== TOP GUN CANDIDATES ===');
    for (const g of gunCandidates.slice(0, 10)) {
        console.log(`  finalComps=${g.finalComps} maxComps=${g.maxComps} finalSize=${g.finalSize}`);
        console.log(`    oscillator: ${JSON.stringify(g.osc)}`);
        console.log(`    glider: ${JSON.stringify(g.glider)} at offset (${g.gp},${g.gq})`);

        // Print the full initial cell list for the gun
        const gliderMoved = g.glider.map(([p,q]) => [p + g.gp, q + g.gq]);
        const allCells = [...g.osc, ...gliderMoved];
        console.log(`    ALL CELLS: ${JSON.stringify(allCells)}`);
    }
}

// ---- PLAN B: Glider-glider collisions ----
console.log('\n=== Plan B: Two-glider collisions ===');

const collision_results = [];

for (let i = 0; i < GLIDERS.length; i++) {
    for (let j = i; j < GLIDERS.length; j++) {
        const g1 = GLIDERS[i];
        const g2 = GLIDERS[j];

        for (let dp = -10; dp <= 10; dp += 2) {
            for (let dq = -10; dq <= 10; dq += 2) {
                const g2cells = g2.cells.map(([p,q]) => [p + dp, q + dq]);
                const allCells = [...g1.cells, ...g2cells];

                const keys = new Set();
                let overlap = false;
                for (const [p,q] of allCells) {
                    const k = key(p,q);
                    if (keys.has(k)) { overlap = true; break; }
                    keys.add(k);
                }
                if (overlap) continue;

                const result = runForGun(allCells, 300);
                if (result.type === 'analyzed' && result.sizeGrows && result.finalComps >= 3) {
                    collision_results.push({
                        g1: g1.cells, g2: g2.cells, dp, dq,
                        ...result,
                    });
                }
            }
        }
    }
    process.stdout.write(`  Tested glider ${i+1}/${GLIDERS.length}\r`);
}

console.log(`\nGlider-glider collision results: ${collision_results.length}`);

if (collision_results.length > 0) {
    collision_results.sort((a, b) => b.finalComps - a.finalComps);
    console.log('\nTop 5:');
    for (const r of collision_results.slice(0, 5)) {
        console.log(`  finalComps=${r.finalComps} maxComps=${r.maxComps} finalSize=${r.finalSize}`);
        console.log(`    g1: ${JSON.stringify(r.g1)}`);
        console.log(`    g2 at (${r.dp},${r.dq}): ${JSON.stringify(r.g2.map(([p,q])=>[p+r.dp,q+r.dq]))}`);
    }
}
