#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// beehive_gun.js — Construct a flyer gun using the 3-state beehive rule.
//
// The beehive rule has a KNOWN period-1 glider (5 cells, translates by (-1,0)
// each generation). A gun requires finding a finite oscillator that periodically
// emits copies of this glider.
//
// Strategy: Collide two gliders and see what happens. If the collision produces
// debris that includes a glider heading in a different direction, that's a
// reflection. If it produces a periodic emitter, that's a gun.
//
// Alternative: Find a stationary oscillator and launch a glider into it. If the
// collision results in the oscillator regenerating AND a new glider being emitted,
// that's a gun.

const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, bbox, normalize, canonical,
    connectedComponents, translate,
} = require('./simulate.js');

// The beehive rule
const BEEHIVE = {
    table: [
        [0, 1, 2, 1, 2, 0, 0],
        [0, 2, 2, 2, 1, 1],
        [0, 0, 2, 2, 0],
        [0, 2, 2, 0],
        [0, 0, 2],
        [2, 0],
        [0],
    ],
    order: '21',
};

// The known beehive glider: 1 head (state 1) + 4 tails (state 2)
// Translates by (-1, 0) each generation (period-1 spaceship).
const GLIDER_SEED = [
    [0, 2, 1],  // head
    [1, 1, 2],  // tail
    [2, 1, 2],  // tail
    [0, 3, 2],  // tail
    [1, 3, 2],  // tail
];

function stateMapFrom(cells) {
    const m = new Map();
    for (const c of cells) {
        m.set(key(c[0], c[1]), c.length > 2 ? c[2] : 1);
    }
    return m;
}

function cellsFromMap(m) {
    const out = [];
    for (const [k, s] of m) {
        const [p, q] = parseKey(k);
        out.push([p, q, s]);
    }
    return out;
}

function step(stateMap) {
    return Life.stepStates(stateMap, BEEHIVE.table, BEEHIVE.order);
}

// Verify the glider translates
function verifyGlider() {
    let m = stateMapFrom(GLIDER_SEED);
    console.log('Verifying beehive glider...');
    for (let gen = 0; gen < 5; gen++) {
        const cells = cellsFromMap(m);
        const b = bbox(new Set(m.keys()));
        console.log(`  gen ${gen}: ${m.size} cells, bbox p=[${b.minP},${b.maxP}] q=[${b.minQ},${b.maxQ}]`);
        m = step(m);
    }
    console.log(`  After 5 steps: ${m.size} cells`);
    console.log();
}

// Translate a glider seed by (dp, dq)
function translateGlider(dp, dq) {
    return GLIDER_SEED.map(([p, q, s]) => [p + dp, q + dq, s]);
}

// Rotate glider 60° CW: (p,q) -> (p+q, -p)
function rotateGlider60(cells) {
    return cells.map(([p, q, s]) => [p + q, -p, s]);
}

// Rotate N times
function rotateGliderN(cells, n) {
    let c = cells;
    for (let i = 0; i < n; i++) c = rotateGlider60(c);
    return c;
}

// Run a configuration for maxGens, tracking components
function runAndAnalyze(initialCells, maxGens) {
    let m = stateMapFrom(initialCells);
    const history = [];

    for (let gen = 0; gen <= maxGens; gen++) {
        if (m.size === 0) return { outcome: 'dies', gen, history };
        if (m.size > 300) return { outcome: 'explodes', gen, history };

        const comps = connectedComponents(new Set(m.keys()));
        history.push({
            gen,
            size: m.size,
            nComps: comps.length,
            cells: cellsFromMap(m),
        });

        if (gen < maxGens) m = step(m);
    }

    // Analyze: did components separate? Is there a glider among them?
    const lastEntry = history[history.length - 1];
    return { outcome: 'survived', history, lastSize: lastEntry.size, lastComps: lastEntry.nComps };
}

// Search for a gun by colliding two gliders at various offsets and angles
function searchCollisions() {
    console.log('=== Searching for gun via glider collisions ===');
    const results = [];

    // Try collisions with different rotations and offsets
    for (let rot = 0; rot < 6; rot++) {
        const g2base = rotateGliderN(GLIDER_SEED, rot);
        for (let dp = -8; dp <= 8; dp++) {
            for (let dq = -8; dq <= 8; dq++) {
                const g2 = g2base.map(([p, q, s]) => [p + dp, q + dq, s]);
                const combined = [...GLIDER_SEED, ...g2];

                // Check for overlapping cells
                const keys = new Set();
                let overlap = false;
                for (const [p, q] of combined) {
                    const k = key(p, q);
                    if (keys.has(k)) { overlap = true; break; }
                    keys.add(k);
                }
                if (overlap) continue;

                const result = runAndAnalyze(combined, 200);

                if (result.outcome === 'survived' && result.lastComps > 1) {
                    // Check if any generation has 3+ components (possible gun emission)
                    const multiComp = result.history.filter(h => h.nComps >= 3);
                    if (multiComp.length > 0) {
                        results.push({
                            rot, dp, dq,
                            maxComps: Math.max(...result.history.map(h => h.nComps)),
                            lastSize: result.lastSize,
                            lastComps: result.lastComps,
                        });
                        if (results.length <= 5) {
                            console.log(`  rot=${rot} dp=${dp} dq=${dq}: survived, max ${Math.max(...result.history.map(h => h.nComps))} comps, final: ${result.lastSize} cells / ${result.lastComps} comps`);
                        }
                    }
                }
            }
        }
        process.stdout.write(`  rotation ${rot}/6 done (${results.length} interesting results so far)\n`);
    }

    console.log(`\nTotal interesting collision results: ${results.length}`);
    if (results.length > 0) {
        // Sort by max components (more components = more likely gun-like)
        results.sort((a, b) => b.maxComps - a.maxComps);
        console.log('Top 10 by max components:');
        for (const r of results.slice(0, 10)) {
            console.log(`  rot=${r.rot} dp=${r.dp} dq=${r.dq}: maxComps=${r.maxComps} lastSize=${r.lastSize} lastComps=${r.lastComps}`);
        }
    }
    return results;
}

// Now try a different approach: grow from random soups
function searchSoups() {
    console.log('\n=== Soup search: random initial configurations ===');
    const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    const interesting = [];

    for (let trial = 0; trial < 5000; trial++) {
        // Random soup: 8-15 cells in a small region, random states 1 or 2
        const size = 8 + Math.floor(Math.random() * 8);
        const cells = [];
        const used = new Set();
        // Start with a connected cluster
        cells.push([0, 0, Math.random() < 0.3 ? 1 : 2]);
        used.add(key(0, 0));
        while (cells.length < size) {
            const [p, q] = cells[Math.floor(Math.random() * cells.length)];
            const [dp, dq] = NBRS[Math.floor(Math.random() * 6)];
            const np = p + dp, nq = q + dq;
            if (!used.has(key(np, nq))) {
                cells.push([np, nq, Math.random() < 0.3 ? 1 : 2]);
                used.add(key(np, nq));
            }
        }

        const result = runAndAnalyze(cells, 300);
        if (result.outcome === 'survived') {
            // Check for increasing component count over time (gun-like behavior)
            const compCounts = result.history.map(h => h.nComps);
            const maxComps = Math.max(...compCounts);
            const finalComps = compCounts[compCounts.length - 1];

            // A gun would show increasing components over time
            if (maxComps >= 3 && finalComps >= 2) {
                // Check if components keep growing (gun emission pattern)
                const late = compCounts.slice(-50);
                const lateMax = Math.max(...late);
                const lateMin = Math.min(...late);

                if (lateMax > lateMin || lateMax >= 3) {
                    interesting.push({
                        cells: cells.slice(),
                        maxComps,
                        finalComps,
                        lateMax,
                        lateMin,
                        finalSize: result.lastSize,
                    });
                    if (interesting.length <= 10) {
                        console.log(`  Trial ${trial}: maxComps=${maxComps} finalComps=${finalComps} lateRange=[${lateMin},${lateMax}] size=${result.lastSize}`);
                    }
                }
            }
        }

        if (trial % 1000 === 999) {
            process.stdout.write(`  ${trial + 1}/5000 trials, ${interesting.length} interesting...\n`);
        }
    }

    console.log(`\nTotal interesting soups: ${interesting.length}`);
    if (interesting.length > 0) {
        // Sort by sustained component variation (most gun-like)
        interesting.sort((a, b) => (b.lateMax - b.lateMin) - (a.lateMax - a.lateMin) || b.maxComps - a.maxComps);
        console.log('Top 5 most gun-like:');
        for (const s of interesting.slice(0, 5)) {
            console.log(`  maxComps=${s.maxComps} finalComps=${s.finalComps} late=[${s.lateMin},${s.lateMax}] size=${s.finalSize}`);
            console.log(`  cells: ${JSON.stringify(s.cells)}`);
        }
    }
    return interesting;
}

verifyGlider();
searchCollisions();
searchSoups();
