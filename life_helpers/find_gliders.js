#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// find_gliders.js — Search for gliders (translating patterns) across
// multiple hex Life rules by enumerating small connected polyforms.

const {
    Life, setFrom, pairsFrom, classify,
    enumConnected, canonicalForm,
} = require('./simulate.js');

// Rules to search
const RULES = {
    'B2/S34':  { survival: [3, 4], birth: [2] },
    'B2/S35':  { survival: [3, 5], birth: [2] },
    'B2/S345': { survival: [3, 4, 5], birth: [2] },
    'B2/S3':   { survival: [3], birth: [2] },
    'B2/S45':  { survival: [4, 5], birth: [2] },
    'B2/S4':   { survival: [4], birth: [2] },
    'B2/S5':   { survival: [5], birth: [2] },
    'B2/S36':  { survival: [3, 6], birth: [2] },
    'B23/S35': { survival: [3, 5], birth: [2, 3] },
};

const MAX_SIZE = 6;  // enumerate up to 6-cell polyforms
const MAX_GENS = 200;

console.log(`Enumerating connected hex polyforms up to size ${MAX_SIZE}...`);
const patterns = enumConnected(MAX_SIZE);
console.log(`Found ${patterns.size} distinct connected patterns\n`);

const allGliders = {};

for (const [ruleName, rule] of Object.entries(RULES)) {
    console.log(`--- Testing rule ${ruleName} ---`);
    const gliders = [];
    const oscillators = [];
    let count = 0;

    for (const [cf, pairs] of patterns) {
        count++;
        if (count % 200 === 0) process.stdout.write(`  ${count}/${patterns.size}...\r`);
        const result = classify(pairs, rule, MAX_GENS);
        if (result.type === 'spaceship') {
            gliders.push({ pairs: pairs.slice(), ...result });
        } else if (result.type === 'oscillator' && result.period > 1) {
            oscillators.push({ pairs: pairs.slice(), ...result });
        }
    }

    console.log(`  ${ruleName}: ${gliders.length} gliders, ${oscillators.length} oscillators (period>1)`);

    if (gliders.length > 0) {
        allGliders[ruleName] = gliders;
        console.log(`  GLIDERS under ${ruleName}:`);
        for (const g of gliders) {
            console.log(`    size=${g.pairs.length} period=${g.period} displacement=(${g.dp},${g.dq}) cells=${JSON.stringify(g.pairs)}`);
        }
    }
    console.log();
}

// Summary
console.log('\n=== SUMMARY: Rules with gliders ===');
for (const [ruleName, gliders] of Object.entries(allGliders)) {
    console.log(`${ruleName}: ${gliders.length} glider(s)`);
    for (const g of gliders) {
        console.log(`  size=${g.pairs.length} period=${g.period} disp=(${g.dp},${g.dq}) cells=${JSON.stringify(g.pairs)}`);
    }
}

if (Object.keys(allGliders).length === 0) {
    console.log('No gliders found in any rule at sizes up to ' + MAX_SIZE);
    console.log('Try increasing MAX_SIZE (currently limited for speed).');
}
