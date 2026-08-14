#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// find_gliders_large.js — Search for gliders in hex Life rules using
// larger patterns (7-10 cells) via random sampling rather than exhaustive
// enumeration (which is too slow at these sizes).

const {
    Life, NBRS, key, parseKey, setFrom, pairsFrom,
    classify, canonicalForm, bbox, normalize,
} = require('./simulate.js');

const RULES = {
    'B2/S34':  { survival: [3, 4], birth: [2] },
    'B2/S35':  { survival: [3, 5], birth: [2] },
    'B2/S345': { survival: [3, 4, 5], birth: [2] },
    'B2/S3':   { survival: [3], birth: [2] },
};

// Generate a random connected polyform of given size
function randomPoly(size) {
    const cells = [[0, 0]];
    const cellSet = new Set([key(0, 0)]);

    while (cells.length < size) {
        // Pick a random existing cell and grow from it
        const [p, q] = cells[Math.floor(Math.random() * cells.length)];
        const [dp, dq] = NBRS[Math.floor(Math.random() * 6)];
        const np = p + dp, nq = q + dq;
        const k = key(np, nq);
        if (!cellSet.has(k)) {
            cells.push([np, nq]);
            cellSet.add(k);
        }
    }
    return cells;
}

// Random search for gliders
const SAMPLES = 100000;
const MAX_GENS = 300;

for (const [ruleName, rule] of Object.entries(RULES)) {
    console.log(`\n=== Random search for gliders under ${ruleName} ===`);
    const seen = new Set();
    const gliders = [];

    for (let size = 3; size <= 12; size++) {
        let found = 0;
        let tested = 0;
        const samplesForSize = Math.min(SAMPLES, size <= 7 ? 50000 : 20000);

        for (let i = 0; i < samplesForSize; i++) {
            const pairs = randomPoly(size);
            const cf = canonicalForm(pairs);
            if (seen.has(cf)) continue;
            seen.add(cf);
            tested++;

            const result = classify(pairs, rule, MAX_GENS);
            if (result.type === 'spaceship') {
                found++;
                gliders.push({ size, pairs: pairs.slice(), ...result, rule: ruleName });
                console.log(`  GLIDER! size=${size} period=${result.period} disp=(${result.dp},${result.dq}) cells=${JSON.stringify(pairs)}`);
            }
        }
        if (tested > 0) {
            process.stdout.write(`  size ${size}: tested ${tested} unique patterns, found ${found} glider(s)\n`);
        }
    }

    if (gliders.length > 0) {
        console.log(`\n  All gliders under ${ruleName}:`);
        for (const g of gliders) {
            console.log(`    ${JSON.stringify(g.pairs)} period=${g.period} disp=(${g.dp},${g.dq})`);
        }
    }
}
