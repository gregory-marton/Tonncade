#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// design_rule.js — Design a custom hex Life rule specifically engineered
// to have small gliders. Then search for gun configurations.
//
// Strategy:
// 1. We know B2/S35 has lots of oscillators. Gliders probably exist but are large.
// 2. Instead: use the isotropy-aware rule language (see docs/life-rules.md) to
//    create a rule where birth/survival depends on the ARRANGEMENT of neighbors,
//    not just the count. This lets us break the D6 symmetry to favor directional
//    propagation — exactly what a glider needs.
//
// Approach: A "directional" rule where:
// - Birth on exactly 2 neighbours IF they are in 'ortho' arrangement (adjacent pair)
//   This favors linear growth in one direction.
// - Survival on 2 or 3 neighbours.
// The idea is that an ortho-birth, moderate-survival rule should produce
// small translating patterns.

const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, setFrom, pairsFrom,
    classify, enumConnected, canonicalForm,
    bbox, normalize, canonical, connectedComponents,
} = require('./simulate.js');

// Rule candidates to test
const RULE_CANDIDATES = [
    // Isotropy-aware rules
    {
        name: 'Ortho2/S23',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['ortho'] }],
            survival: [{ ring_count: [2, 3] }],
        },
    },
    {
        name: 'Ortho2/S2',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['ortho'] }],
            survival: [{ ring_count: [2] }],
        },
    },
    {
        name: 'Ortho2/S3',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['ortho'] }],
            survival: [{ ring_count: [3] }],
        },
    },
    {
        name: 'OrthoMeta2/S23',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['ortho', 'meta'] }],
            survival: [{ ring_count: [2, 3] }],
        },
    },
    {
        name: 'Meta2/S3',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['meta'] }],
            survival: [{ ring_count: [3] }],
        },
    },
    {
        name: 'Meta2/S23',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['meta'] }],
            survival: [{ ring_count: [2, 3] }],
        },
    },
    {
        name: 'Para2/S3',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['para'] }],
            survival: [{ ring_count: [3] }],
        },
    },
    {
        name: 'Para2/S35',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['para'] }],
            survival: [{ ring_count: [3, 5] }],
        },
    },
    // Rules requiring specific named intervals
    {
        name: 'B2req5th/S3',
        rule: {
            birth: [{ ring_count: [2], require: ['fifth_up'] }],
            survival: [{ ring_count: [3] }],
        },
    },
    {
        name: 'B2req5th/S23',
        rule: {
            birth: [{ ring_count: [2], require: ['fifth_up'] }],
            survival: [{ ring_count: [2, 3] }],
        },
    },
    // Chiral rules — break reflection symmetry to favor one rotation direction
    {
        name: 'Asym2/S3',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['asymmetric'] }],
            survival: [{ ring_count: [3] }],
        },
    },
    {
        name: 'Asym2/S23',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['asymmetric'] }],
            survival: [{ ring_count: [2, 3] }],
        },
    },
    // Mixed rules
    {
        name: 'B2ortho_or_3/S35',
        rule: {
            birth: [
                { ring_count: [2], isotropy: ['ortho'] },
                { ring_count: [3] },
            ],
            survival: [{ ring_count: [3, 5] }],
        },
    },
    {
        name: 'B2meta/S35',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['meta'] }],
            survival: [{ ring_count: [3, 5] }],
        },
    },
    {
        name: 'B2para/S24',
        rule: {
            birth: [{ ring_count: [2], isotropy: ['para'] }],
            survival: [{ ring_count: [2, 4] }],
        },
    },
];

console.log('Enumerating connected hex polyforms up to size 8...');
const patterns = enumConnected(8);
console.log(`Found ${patterns.size} distinct connected patterns\n`);

const MAX_GENS = 300;

for (const { name, rule } of RULE_CANDIDATES) {
    const gliders = [];
    const oscillators = [];
    let dies = 0, explodes = 0, still = 0;

    for (const [cf, pairs] of patterns) {
        const result = classify(pairs, rule, MAX_GENS);
        if (result.type === 'spaceship') {
            gliders.push({ pairs: pairs.slice(), ...result });
        } else if (result.type === 'oscillator') {
            if (result.period > 1) oscillators.push({ pairs: pairs.slice(), ...result });
            else still++;
        } else if (result.type === 'dies') {
            dies++;
        } else if (result.type === 'explodes') {
            explodes++;
        }
    }

    const summary = `${name}: ${gliders.length} gliders, ${oscillators.length} osc(p>1), ${still} still, ${dies} die, ${explodes} explode`;
    console.log(summary);

    if (gliders.length > 0) {
        console.log(`  *** GLIDERS FOUND under ${name} ***`);
        for (const g of gliders) {
            console.log(`    size=${g.pairs.length} period=${g.period} disp=(${g.dp},${g.dq}) cells=${JSON.stringify(g.pairs)}`);
        }
    }
}
