#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// engineer_glider_v2.js — Engineer gliders using isotropy-aware rules.
//
// The first version showed that pure count-based rules can't support 3-4 cell
// gliders because the birth and "must not born" counts always collide. Isotropy
// (the ARRANGEMENT of live neighbors, not just the count) can break that tie.
//
// Strategy: For each candidate pattern + direction, analyze not just the counts
// but the full isotropy class at each cell. Then construct a rule using
// isotropy constraints that allow the right births while blocking the wrong ones.

const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, setFrom, pairsFrom, classify,
    bbox, normalize, canonical, connectedComponents,
    enumConnected,
} = require('./simulate.js');

const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

// Candidate glider shapes
const CANDIDATES = [
    [[0,0], [1,0], [1,-1]],
    [[0,0], [1,0], [0,1]],
    [[0,0], [1,-1], [0,-1]],
    [[0,0], [1,0], [-1,1]],
    [[0,0], [0,1], [0,-1]],
    [[0,0], [1,0], [-1,0]],
    [[0,0], [1,0], [1,-1], [2,-1]],
    [[0,0], [1,0], [0,1], [1,1]],
    [[0,0], [1,0], [1,-1], [0,1]],
    [[0,0], [0,1], [1,0], [2,0]],
    [[0,0], [1,0], [2,0], [2,-1]],
    [[0,0], [1,0], [2,-1], [1,-1]],
    [[0,0], [1,0], [0,1], [-1,1]],
    [[0,0], [1,-1], [2,-1], [2,-2]],
];

function analyzeTranslation(pattern, dp, dq) {
    const live = setFrom(pattern);
    const translated = pattern.map(([p, q]) => [p + dp, q + dq]);
    const target = setFrom(translated);
    const isAlive = (p, q) => live.has(key(p, q));

    const births = [];
    for (const [p, q] of translated) {
        if (!live.has(key(p, q))) {
            const nb = Life.neighbourhood(p, q, isAlive);
            const cls = Life.classifyRing(nb.ring);
            births.push({ p, q, count: cls.count, iso: cls.name, sym: cls.symmetric, ring: nb.ring.join('') });
        }
    }

    const survivors = [];
    for (const [p, q] of translated) {
        if (live.has(key(p, q))) {
            const nb = Life.neighbourhood(p, q, isAlive);
            const cls = Life.classifyRing(nb.ring);
            survivors.push({ p, q, count: cls.count, iso: cls.name, sym: cls.symmetric, ring: nb.ring.join('') });
        }
    }

    const deaths = [];
    for (const [p, q] of pattern) {
        if (!target.has(key(p, q))) {
            const nb = Life.neighbourhood(p, q, isAlive);
            const cls = Life.classifyRing(nb.ring);
            deaths.push({ p, q, count: cls.count, iso: cls.name, sym: cls.symmetric });
        }
    }

    // Cells that must NOT be born
    const mustNotBorn = [];
    const checked = new Set();
    for (const k of live) {
        const [p, q] = parseKey(k);
        for (const [dp2, dq2] of NBRS) {
            const np = p + dp2, nq = q + dq2;
            const nk = key(np, nq);
            if (!live.has(nk) && !target.has(nk) && !checked.has(nk)) {
                checked.add(nk);
                const nb = Life.neighbourhood(np, nq, isAlive);
                const cls = Life.classifyRing(nb.ring);
                if (cls.count > 0) {
                    mustNotBorn.push({ p: np, q: nq, count: cls.count, iso: cls.name, sym: cls.symmetric });
                }
            }
        }
    }

    return { births, survivors, deaths, mustNotBorn };
}

// Try to construct a rule using isotropy constraints
function tryConstructRule(analysis) {
    const { births, survivors, deaths, mustNotBorn } = analysis;
    if (births.length === 0 || survivors.length === 0) return null;

    // Collect birth requirements (count + isotropy)
    const birthSigs = births.map(b => `${b.count}:${b.iso}`);
    const nobirthSigs = mustNotBorn.map(n => `${n.count}:${n.iso}`);

    // Check if isotropy can separate births from no-births
    const birthSigSet = new Set(birthSigs);
    const nobirthSigSet = new Set(nobirthSigs);

    // If any birth sig appears in nobirth, isotropy alone can't save us
    const overlap = [...birthSigSet].filter(s => nobirthSigSet.has(s));
    if (overlap.length > 0) return null;

    // Build birth clauses grouped by count
    const birthByCount = {};
    for (const b of births) {
        if (!birthByCount[b.count]) birthByCount[b.count] = new Set();
        birthByCount[b.count].add(b.iso);
    }

    const birthClauses = [];
    for (const [count, isos] of Object.entries(birthByCount)) {
        birthClauses.push({
            ring_count: [+count],
            isotropy: [...isos],
        });
    }

    // Build survival: need to survive at specified counts/isotropies
    // BUT also need deaths to NOT survive
    const survSigs = survivors.map(s => `${s.count}:${s.iso}`);
    const deathSigs = deaths.map(d => `${d.count}:${d.iso}`);

    const survSigSet = new Set(survSigs);
    const deathSigSet = new Set(deathSigs);

    // Check if any survival sig appears in death sigs
    const survOverlap = [...survSigSet].filter(s => deathSigSet.has(s));
    if (survOverlap.length > 0) return null;

    const survByCount = {};
    for (const s of survivors) {
        if (!survByCount[s.count]) survByCount[s.count] = new Set();
        survByCount[s.count].add(s.iso);
    }

    const survClauses = [];
    for (const [count, isos] of Object.entries(survByCount)) {
        survClauses.push({
            ring_count: [+count],
            isotropy: [...isos],
        });
    }

    return { birth: birthClauses, survival: survClauses };
}

console.log('=== Engineering gliders with isotropy-aware rules ===\n');

const verified = [];

for (const pattern of CANDIDATES) {
    for (let dir = 0; dir < 6; dir++) {
        const [dp, dq] = NBRS[dir];
        const analysis = analyzeTranslation(pattern, dp, dq);
        const rule = tryConstructRule(analysis);

        if (!rule) continue;

        // Verify: does this actually produce a glider?
        const result = classify(pattern, rule, 200);

        if (result.type === 'spaceship') {
            console.log(`✓ GLIDER VERIFIED!`);
            console.log(`  Pattern: ${JSON.stringify(pattern)}`);
            console.log(`  Direction: (${dp},${dq}), actual disp: (${result.dp},${result.dq})`);
            console.log(`  Period: ${result.period}`);
            console.log(`  Rule:`);
            console.log(`    Birth: ${JSON.stringify(rule.birth)}`);
            console.log(`    Survival: ${JSON.stringify(rule.survival)}`);
            verified.push({ pattern, dp, dq, rule, result });
        }
    }
}

console.log(`\nTotal verified gliders: ${verified.length}\n`);

// For each verified glider, survey the rule for oscillators
for (const v of verified) {
    console.log(`\n=== Oscillator survey for rule with glider ${JSON.stringify(v.pattern)} ===`);
    console.log(`Rule: B=${JSON.stringify(v.rule.birth)} S=${JSON.stringify(v.rule.survival)}`);

    const patterns = enumConnected(7);
    const oscPeriods = {};
    const stillLifes = [];
    let spaceships = 0, dies = 0, explodes = 0;

    for (const [cf, pairs] of patterns) {
        const r = classify(pairs, v.rule, 200);
        if (r.type === 'spaceship') spaceships++;
        else if (r.type === 'oscillator' && r.period > 1) {
            const pk = r.period;
            if (!oscPeriods[pk]) oscPeriods[pk] = [];
            oscPeriods[pk].push({ pairs, size: r.size });
        } else if (r.type === 'oscillator') {
            stillLifes.push(pairs);
        } else if (r.type === 'dies') dies++;
        else if (r.type === 'explodes') explodes++;
    }

    console.log(`  Spaceships: ${spaceships}, Still lifes: ${stillLifes.length}, Dies: ${dies}, Explodes: ${explodes}`);
    for (const [period, oscs] of Object.entries(oscPeriods).sort((a,b) => +a[0] - +b[0])) {
        console.log(`  Period ${period}: ${oscs.length} oscillator(s)`);
        for (const o of oscs.slice(0, 3)) {
            console.log(`    size ${o.pairs.length}: ${JSON.stringify(o.pairs)}`);
        }
    }
}
