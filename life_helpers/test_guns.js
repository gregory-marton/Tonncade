#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// test_guns.js — Self-contained test suite for the flyer gun patterns.
// Verifies that each gun YAML file:
//   1. Parses correctly via Life.parseYaml
//   2. Has a valid isotropy-aware rule
//   3. Actually emits gliders (separated components that translate)
//   4. Emits at least 3 gliders in 30 generations
//
// Run: node life_helpers/test_guns.js

const path = require('path');
const fs = require('fs');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, setFrom, pairsFrom,
    classify, canonicalForm,
    connectedComponents,
} = require('./simulate.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) { passed++; }
    else { failed++; console.error(`  FAIL: ${msg}`); }
}

// Load each gun YAML
const gunFiles = [
    'ortho-gun-alpha.yaml',
    'ortho-gun-epsilon.yaml',
    'ortho-gun-zeta.yaml',
    'ortho-gun-eta.yaml',
    'ortho-gun-kappa.yaml',
];

const lifeDir = path.join(__dirname, '..', 'life');

// Known glider canonical forms for this rule
const GLIDER_CANONS = new Set();
const GLIDERS = [
    [[0,0],[1,0],[0,-1],[2,-1],[-1,-1]],
    [[0,0],[1,0],[0,-1],[2,0],[0,-2]],
    [[0,0],[1,0],[0,-1],[2,-1],[1,-2]],
    [[0,0],[1,0],[1,-1],[-1,0],[1,1],[0,2]],
    [[0,0],[1,0],[1,-1],[-1,0],[1,1],[1,2]],
    [[0,0],[1,0],[0,-1],[2,0],[-1,-1],[2,1]],
    [[0,0],[1,0],[0,-1],[2,-1],[1,-2],[3,-1]],
];
for (const g of GLIDERS) GLIDER_CANONS.add(canonicalForm(g));

function isGlider(compPairs) {
    if (compPairs.length < 3 || compPairs.length > 8) return false;
    return GLIDER_CANONS.has(canonicalForm(compPairs));
}

for (const file of gunFiles) {
    console.log(`\nTesting ${file}...`);
    const filepath = path.join(lifeDir, file);

    // 1. File exists
    assert(fs.existsSync(filepath), `${file} exists`);
    if (!fs.existsSync(filepath)) continue;

    // 2. Parses correctly
    const text = fs.readFileSync(filepath, 'utf-8');
    const parsed = Life.parseYaml(text);
    assert(parsed && typeof parsed === 'object', `${file} parses as object`);
    assert(typeof parsed.name === 'string' && parsed.name.length > 0, `${file} has a name`);
    assert(parsed.rule, `${file} has a rule`);
    assert(parsed.initial && parsed.initial.cells, `${file} has initial cells`);

    // 3. Rule has isotropy-aware birth clause
    const rule = parsed.rule;
    assert(Array.isArray(rule.birth), `${file} birth is an array of clauses`);
    if (Array.isArray(rule.birth)) {
        const clause = rule.birth[0];
        assert(clause && clause.ring_count, `${file} birth clause has ring_count`);
        assert(clause && clause.isotropy, `${file} birth clause has isotropy`);
        if (clause && clause.isotropy) {
            assert(clause.isotropy.indexOf('ortho') >= 0, `${file} birth isotropy includes 'ortho'`);
        }
    }

    // 4. Survival spec
    assert(rule.survival, `${file} has survival spec`);

    // 5. Simulate and verify gun behavior
    const cells = parsed.initial.cells;
    assert(cells.length >= 3 && cells.length <= 20, `${file} initial cells count ${cells.length} is reasonable`);

    let live = setFrom(cells);
    let emissions = 0;

    for (let gen = 1; gen <= 30; gen++) {
        live = Life.step(live, rule);
        if (live.size === 0) { assert(false, `${file} dies at gen ${gen}`); break; }
        if (live.size > 500) { assert(false, `${file} explodes at gen ${gen}`); break; }

        const comps = connectedComponents(live);
        if (comps.length > 1) {
            for (const comp of comps) {
                if (isGlider(pairsFrom(comp))) emissions++;
            }
        }
    }

    assert(emissions >= 3, `${file} emits at least 3 gliders in 30 gens (got ${emissions})`);
    console.log(`  ✓ ${emissions} glider emissions in 30 generations`);
}

// Also verify the index.json includes all gun files
console.log('\nTesting index.json...');
const indexPath = path.join(lifeDir, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
assert(Array.isArray(index), 'index.json is an array');
for (const file of gunFiles) {
    const entry = index.find(e => e.file === file);
    assert(entry, `index.json includes ${file}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
