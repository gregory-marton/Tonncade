#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// verify_guns.js — Verify discovered gun patterns and generate YAML files
// for the Tonncade Life mode.

const path = require('path');
const fs = require('fs');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, setFrom, pairsFrom,
    classify, canonicalForm,
    bbox, normalize, canonical, connectedComponents,
} = require('./simulate.js');

const RULE = {
    birth: [{ ring_count: [2], isotropy: ['ortho'] }],
    survival: [{ ring_count: [2] }],
};

const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

// Known glider canonical forms
const GLIDER_CANONS = new Set();
const TEST_GLIDERS = [
    [[0,0],[1,0],[0,-1],[2,-1],[-1,-1]],
    [[0,0],[1,0],[0,-1],[2,0],[0,-2]],
    [[0,0],[1,0],[0,-1],[2,-1],[1,-2]],
    [[0,0],[1,0],[1,-1],[-1,0],[1,1],[0,2]],
    [[0,0],[1,0],[1,-1],[-1,0],[1,1],[1,2]],
    [[0,0],[1,0],[0,-1],[2,0],[-1,-1],[2,1]],
    [[0,0],[1,0],[0,-1],[2,-1],[1,-2],[3,-1]],
];
for (const g of TEST_GLIDERS) GLIDER_CANONS.add(canonicalForm(g));

function isGlider(compPairs) {
    if (compPairs.length < 3 || compPairs.length > 8) return false;
    return GLIDER_CANONS.has(canonicalForm(compPairs));
}

// Detailed verification of a gun pattern
function verifyGun(cells, name, maxGens) {
    console.log(`\n=== Verifying "${name}" ===`);
    console.log(`  Initial cells (${cells.length}): ${JSON.stringify(cells)}`);

    let live = setFrom(cells);

    let totalEmissions = 0;
    let emissionGens = [];
    let maxSize = 0;
    let minSize = Infinity;

    for (let gen = 0; gen <= maxGens; gen++) {
        if (live.size === 0) { console.log(`  DIES at gen ${gen}`); return null; }
        if (live.size > 1000) { console.log(`  EXPLODES at gen ${gen}`); return null; }

        if (live.size > maxSize) maxSize = live.size;
        if (live.size < minSize) minSize = live.size;

        const comps = connectedComponents(live);
        if (comps.length > 1) {
            // Check for glider components
            for (const comp of comps) {
                const compPairs = pairsFrom(comp);
                if (isGlider(compPairs)) {
                    totalEmissions++;
                    emissionGens.push(gen);
                    if (emissionGens.length <= 5) {
                        console.log(`  Gen ${gen}: emitted glider! (${comp.size} cells) Total emissions: ${totalEmissions}`);
                    }
                }
            }
        }

        if (gen < maxGens) live = Life.step(live, RULE);
    }

    if (totalEmissions === 0) {
        console.log(`  No glider emissions detected.`);
        return null;
    }

    // Analyze emission periodicity
    const intervals = [];
    for (let i = 1; i < emissionGens.length; i++) {
        intervals.push(emissionGens[i] - emissionGens[i-1]);
    }
    const avgInterval = intervals.length > 0 ? intervals.reduce((a,b) => a+b, 0) / intervals.length : 0;

    // Check for consistent period
    const uniqueIntervals = [...new Set(intervals)];

    console.log(`  Total emissions: ${totalEmissions}`);
    console.log(`  First emission: gen ${emissionGens[0]}`);
    console.log(`  Emission intervals: ${uniqueIntervals.join(', ')}`);
    console.log(`  Average interval: ${avgInterval.toFixed(1)}`);
    console.log(`  Size range: ${minSize} - ${maxSize}`);
    console.log(`  Final size: ${live.size}`);

    return {
        name,
        cells,
        totalEmissions,
        emissionGens,
        intervals,
        avgInterval,
        period: uniqueIntervals.length === 1 ? uniqueIntervals[0] : null,
        maxSize,
    };
}

// ---- Verify candidate guns ----
const candidates = [
    { name: 'Ortho Gun Alpha', cells: [[0,0],[1,0],[1,1],[1,2],[-1,0],[1,-1]] },
    { name: 'Ortho Gun Beta', cells: [[0,0],[-1,0],[1,-1],[2,-2],[3,-2],[4,-3]] },
    { name: 'Ortho Gun Gamma', cells: [[0,0],[-1,1],[-1,2],[-1,3],[-2,4],[0,-1]] },
    { name: 'Ortho Gun Delta', cells: [[0,0],[0,-1],[-1,-1],[-2,-1],[-2,-2],[-3,-2]] },
    { name: 'Ortho Gun Epsilon', cells: [[0,0],[-1,0],[1,-1],[-1,-1],[2,-2],[1,0]] },
    { name: 'Ortho Gun Zeta', cells: [[0,0],[-1,1],[1,0],[1,1],[-1,0],[-2,2]] },
    { name: 'Ortho Gun Eta', cells: [[0,0],[-1,1],[1,-1],[-2,1],[0,1],[-3,1]] },
    { name: 'Ortho Gun Theta', cells: [[0,0],[-1,1],[-2,1],[-2,0],[-2,-1],[-3,1]] },
    { name: 'Ortho Gun Iota', cells: [[0,0],[0,1],[0,2],[1,0],[1,2],[2,-1]] },
    { name: 'Ortho Gun Kappa', cells: [[0,0],[1,0],[-1,0],[-2,1],[-3,2],[-2,0]] },
    // Short period candidate
    { name: 'Ortho Gun Lambda', cells: [[0,0],[-1,0],[1,-1],[-2,1],[-3,1],[-3,2],[-4,2],[1,0]] },
];

const verified = [];
for (const c of candidates) {
    const result = verifyGun(c.cells, c.name, 100);
    if (result) verified.push(result);
}

// ---- Generate YAML files ----
console.log('\n\n=== Generating YAML files ===\n');

function generateYaml(gun) {
    const lines = [];
    lines.push(`# ${gun.name} — a flyer gun under the Ortho2/S2 isotropy-aware rule.`);
    lines.push(`# Born on exactly 2 neighbours in ortho (adjacent-pair) arrangement;`);
    lines.push(`# survive on exactly 2 neighbours. This ${gun.cells.length}-cell pattern periodically`);
    lines.push(`# emits small gliders (flyers) that travel across the Tonnetz.`);
    lines.push(`# Discovered by computational search (life_helpers/build_gun_v2.js).`);
    lines.push(`# See docs/life-rules.md for the full rule language.`);
    lines.push(`name: "${gun.name}"`);
    lines.push(`description: "A ${gun.cells.length}-cell flyer gun: emits gliders every ~${gun.avgInterval.toFixed(0)} generations under the Ortho2/S2 rule."`);
    lines.push(`rule:`);
    lines.push(`  birth:`);
    lines.push(`    - ring_count: [2]`);
    lines.push(`      isotropy: [ortho]`);
    lines.push(`  survival: [2]`);
    lines.push(`sound: { when: born, duration: 0.35 }`);
    lines.push(`initial:`);
    lines.push(`  cells:`);
    for (const [p, q] of gun.cells) {
        lines.push(`    - [${p}, ${q}]`);
    }
    lines.push(`tempo: 240`);
    return lines.join('\n') + '\n';
}

// Pick the best verified guns: prefer small size, consistent period
verified.sort((a, b) => a.cells.length - b.cells.length || b.totalEmissions - a.totalEmissions);

const outputDir = path.join(__dirname, '..', 'life');

for (const gun of verified.slice(0, 3)) {
    const yaml = generateYaml(gun);
    const filename = gun.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.yaml';
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, yaml);
    console.log(`Written: ${filepath}`);
    console.log(yaml);
    console.log('---');
}
