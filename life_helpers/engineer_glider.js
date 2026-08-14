#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// engineer_glider.js — Engineer a hex Life rule that guarantees a specific
// small pattern translates. Then build a gun from it.
//
// Approach: Start with a desired 3-cell glider shape and work out what
// birth/survival conditions make it translate. Then check that the rule
// also supports oscillators (needed for a gun).
//
// The hex grid neighbors are:
//   0: (1,0)  fifth_up          +7 semitones
//   1: (1,-1) major_third_up    +4
//   2: (0,-1) minor_third_down  -3
//   3: (-1,0) fifth_down        -7
//   4: (-1,1) major_third_down  -4
//   5: (0,1)  minor_third_up    +3

const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, setFrom, pairsFrom, classify,
    bbox, normalize, canonical, connectedComponents,
    isTranslationOf, canonicalForm,
} = require('./simulate.js');

const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

// =====================================================================
// Try to find a rule where a SPECIFIC small pattern is a glider.
// Test candidate patterns and for each, derive what rule would make it work.
// =====================================================================

// Small candidate glider shapes (connected 3-4 cell patterns)
const CANDIDATES = [
    // 3-cell patterns
    [[0,0], [1,0], [1,-1]],           // L-shape along fifths/thirds
    [[0,0], [1,0], [0,1]],            // angle
    [[0,0], [1,-1], [0,-1]],          // angle down
    [[0,0], [1,0], [-1,1]],           // bent
    // 4-cell patterns
    [[0,0], [1,0], [1,-1], [2,-1]],   // zigzag
    [[0,0], [1,0], [0,1], [1,1]],     // diamond
    [[0,0], [1,0], [1,-1], [0,1]],    // Y-shape
    [[0,0], [0,1], [1,0], [2,0]],     // J-shape
    [[0,0], [1,0], [2,0], [2,-1]],    // L along fifths
];

// For a given pattern, compute what each cell needs in terms of birth/survival
// to make the pattern advance by one step in a specific direction.
function analyzeTranslation(pattern, dp, dq) {
    const live = setFrom(pattern);
    const translated = pattern.map(([p, q]) => [p + dp, q + dq]);
    const target = setFrom(translated);

    const isAlive = (p, q) => live.has(key(p, q));

    // For cells that need to be BORN (in target but not in live):
    const births = [];
    for (const [p, q] of translated) {
        if (!live.has(key(p, q))) {
            const nb = Life.neighbourhood(p, q, isAlive);
            const cls = Life.classifyRing(nb.ring);
            births.push({ p, q, count: cls.count, name: cls.name, ring: nb.ring.join('') });
        }
    }

    // For cells that need to SURVIVE (in both live and target):
    const survivors = [];
    for (const [p, q] of translated) {
        if (live.has(key(p, q))) {
            const nb = Life.neighbourhood(p, q, isAlive);
            const cls = Life.classifyRing(nb.ring);
            survivors.push({ p, q, count: cls.count, name: cls.name, ring: nb.ring.join('') });
        }
    }

    // For cells that need to DIE (in live but not in target):
    const deaths = [];
    for (const [p, q] of pattern) {
        if (!target.has(key(p, q))) {
            const nb = Life.neighbourhood(p, q, isAlive);
            const cls = Life.classifyRing(nb.ring);
            deaths.push({ p, q, count: cls.count, name: cls.name, ring: nb.ring.join('') });
        }
    }

    // For empty cells near the pattern that must NOT be born:
    const mustNotBorn = [];
    const allRelevant = new Set([...live, ...target]);
    for (const k of live) {
        const [p, q] = parseKey(k);
        for (const [dp2, dq2] of NBRS) {
            const nk = key(p + dp2, q + dq2);
            if (!allRelevant.has(nk)) {
                // This empty cell near the pattern must stay empty
                const nb = Life.neighbourhood(p + dp2, q + dq2, isAlive);
                const cls = Life.classifyRing(nb.ring);
                if (cls.count > 0) {
                    mustNotBorn.push({ p: p + dp2, q: q + dq2, count: cls.count, name: cls.name });
                }
            }
        }
    }

    return { births, survivors, deaths, mustNotBorn };
}

// Try all 6 translation directions for each pattern
console.log('=== Analyzing candidate glider shapes ===\n');

const viable = [];

for (const pattern of CANDIDATES) {
    for (let dir = 0; dir < 6; dir++) {
        const [dp, dq] = NBRS[dir];
        const analysis = analyzeTranslation(pattern, dp, dq);

        // Check feasibility: can we find birth/survival counts that work?
        const birthCounts = new Set(analysis.births.map(b => b.count));
        const survivalCounts = new Set(analysis.survivors.map(s => s.count));
        const deathCounts = new Set(analysis.deaths.map(d => d.count));
        const nobirthCounts = new Set(analysis.mustNotBorn.map(n => n.count));

        // Birth counts must not overlap with nobirth counts
        const birthOk = [...birthCounts].every(c => !nobirthCounts.has(c));
        // Death counts must not overlap with survival counts
        const deathOk = [...deathCounts].every(c => !survivalCounts.has(c));

        if (birthOk && deathOk && birthCounts.size > 0 && survivalCounts.size > 0) {
            viable.push({
                pattern,
                dir,
                dp, dq,
                birthCounts: [...birthCounts],
                survivalCounts: [...survivalCounts],
                deathCounts: [...deathCounts],
                nobirthCounts: [...nobirthCounts],
                birthIsotropy: analysis.births.map(b => b.name),
                analysis,
            });
        }
    }
}

console.log(`Found ${viable.length} potentially viable pattern-direction-rule combinations\n`);

// Now try each viable combination: construct the simplest rule and verify
const verified = [];

for (const v of viable) {
    // Construct the simplest possible rule
    const rule = {
        birth: v.birthCounts,
        survival: v.survivalCounts,
    };

    // Verify: does this pattern actually translate under this rule?
    const result = classify(v.pattern, rule, 100);

    if (result.type === 'spaceship') {
        console.log(`✓ GLIDER VERIFIED: ${JSON.stringify(v.pattern)} dir=(${v.dp},${v.dq})`);
        console.log(`  Rule: B${v.birthCounts.join(',')}/S${v.survivalCounts.join(',')}`);
        console.log(`  Period: ${result.period}, displacement: (${result.dp},${result.dq})`);
        console.log(`  Birth isotropy: ${v.birthIsotropy.join(', ')}`);
        verified.push({ ...v, result });
    }
}

console.log(`\nVerified gliders: ${verified.length}`);

// For each verified glider, check what oscillators the rule supports
for (const v of verified) {
    const rule = { birth: v.birthCounts, survival: v.survivalCounts };
    console.log(`\n=== Rule B${v.birthCounts.join(',')}/S${v.survivalCounts.join(',')} — oscillator survey ===`);

    const oscPeriods = {};
    const stillLifes = [];
    let dies = 0, explodes = 0;

    // Test all patterns up to size 8
    const patterns = require('./simulate.js').enumConnected(7);
    for (const [cf, pairs] of patterns) {
        const r = classify(pairs, rule, 200);
        if (r.type === 'oscillator' && r.period > 1) {
            const pk = r.period;
            if (!oscPeriods[pk]) oscPeriods[pk] = [];
            oscPeriods[pk].push(pairs);
        } else if (r.type === 'oscillator') {
            stillLifes.push(pairs);
        } else if (r.type === 'dies') dies++;
        else if (r.type === 'explodes') explodes++;
    }

    console.log(`  Still lifes: ${stillLifes.length}, dies: ${dies}, explodes: ${explodes}`);
    for (const [period, oscs] of Object.entries(oscPeriods).sort((a,b) => +a[0] - +b[0])) {
        console.log(`  Period ${period}: ${oscs.length} oscillator(s)`);
        if (oscs.length <= 3) {
            for (const o of oscs) console.log(`    ${JSON.stringify(o)}`);
        }
    }
}
