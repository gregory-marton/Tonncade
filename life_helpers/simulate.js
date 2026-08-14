#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Co-authored-by: Claude Opus 4.6, Aug 2026
//
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
//
// simulate.js — hex Life simulation helpers for pattern search.
// Loads the real Life engine from js/life.js and provides utilities for
// classifying patterns, finding gliders, and searching for guns.

const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));

// ---- Hex neighbour directions (the consonant ring) ----
const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

// ---- Coordinate helpers ----
function key(p, q) { return p + ',' + q; }
function parseKey(k) { const [a, b] = k.split(','); return [+a, +b]; }

function setFrom(pairs) {
    const s = new Set();
    for (const [p, q] of pairs) s.add(key(p, q));
    return s;
}

function pairsFrom(s) { return [...s].map(parseKey); }

function bbox(s) {
    let minP = Infinity, maxP = -Infinity, minQ = Infinity, maxQ = -Infinity;
    for (const k of s) {
        const [p, q] = parseKey(k);
        if (p < minP) minP = p; if (p > maxP) maxP = p;
        if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
    }
    return { minP, maxP, minQ, maxQ };
}

function normalize(s) {
    const b = bbox(s);
    const out = new Set();
    for (const k of s) {
        const [p, q] = parseKey(k);
        out.add(key(p - b.minP, q - b.minQ));
    }
    return { set: out, dp: b.minP, dq: b.minQ };
}

function canonical(s) {
    const { set } = normalize(s);
    return [...set].sort().join(';');
}

function translate(s, dp, dq) {
    const out = new Set();
    for (const k of s) {
        const [p, q] = parseKey(k);
        out.add(key(p + dp, q + dq));
    }
    return out;
}

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const k of a) if (!b.has(k)) return false;
    return true;
}

function isTranslationOf(a, b) {
    if (a.size !== b.size) return null;
    const na = normalize(a);
    const nb = normalize(b);
    const ca = [...na.set].sort().join(';');
    const cb = [...nb.set].sort().join(';');
    if (ca !== cb) return null;
    return { dp: nb.dp - na.dp, dq: nb.dq - na.dq };
}

// ---- Hex transformations (dihedral group D6) ----
// The six rotations and six reflections of the hex grid.
// Rotation by 60° CW on offset-axial hex: (p,q) → (p+q, -p)
// We apply these to get all 12 dihedral images of a pattern.
function rotCW(p, q) { return [p + q, -p]; }

function allTransforms(pairs) {
    // Generate all 12 dihedral images (6 rotations × 2 reflections)
    const images = [];
    let cur = pairs.map(([p, q]) => [p, q]);
    for (let r = 0; r < 6; r++) {
        images.push(cur.slice());
        // reflection: negate q
        images.push(cur.map(([p, q]) => [p + q, -q]));
        cur = cur.map(([p, q]) => rotCW(p, q));
    }
    return images;
}

function canonicalForm(pairs) {
    const images = allTransforms(pairs);
    let best = null;
    for (const img of images) {
        const s = setFrom(img);
        const c = canonical(s);
        if (best === null || c < best) best = c;
    }
    return best;
}

// ---- Pattern classification ----
function classify(pairs, rule, maxGens = 300) {
    let live = setFrom(pairs);
    const history = [canonical(live)];
    const states = [live];

    for (let gen = 1; gen <= maxGens; gen++) {
        live = Life.step(live, rule);
        if (live.size === 0) return { type: 'dies', gen };
        if (live.size > 500) return { type: 'explodes', gen };

        const c = canonical(live);
        const idx = history.indexOf(c);
        if (idx >= 0) {
            const period = gen - idx;
            const disp = isTranslationOf(states[idx], live);
            if (disp && (disp.dp !== 0 || disp.dq !== 0)) {
                return { type: 'spaceship', period, dp: disp.dp, dq: disp.dq, size: live.size, gen };
            }
            return { type: 'oscillator', period, size: live.size, gen };
        }
        history.push(c);
        states.push(live);
    }
    return { type: 'unknown', size: live.size };
}

// ---- Connected pattern enumeration (free polyforms on hex grid) ----
// Enumerates all distinct connected hex polyforms up to `maxSize` cells.
function enumConnected(maxSize) {
    const seen = new Set(); // canonical forms already found
    const results = new Map(); // canonical -> pairs

    function dfs(cells) {
        const cf = canonicalForm(cells);
        if (seen.has(cf)) return;
        seen.add(cf);
        results.set(cf, cells.slice());

        if (cells.length >= maxSize) return;

        const cellSet = new Set(cells.map(([p, q]) => key(p, q)));
        const frontier = [];
        for (const [p, q] of cells) {
            for (const [dp, dq] of NBRS) {
                const k = key(p + dp, q + dq);
                if (!cellSet.has(k)) frontier.push([p + dp, q + dq, k]);
            }
        }
        // Deduplicate frontier
        const fSeen = new Set();
        for (const [p, q, k] of frontier) {
            if (fSeen.has(k)) continue;
            fSeen.add(k);
            cells.push([p, q]);
            dfs(cells);
            cells.pop();
        }
    }

    dfs([[0, 0]]);
    return results;
}

// ---- Multi-generation trace with connected-component tracking ----
// Run a pattern and track when pieces separate (potential gun activity).
function traceWithComponents(pairs, rule, maxGens, opts = {}) {
    const verbose = opts.verbose || false;
    let live = setFrom(pairs);
    const snapshots = [{ gen: 0, size: live.size, set: live }];

    for (let gen = 1; gen <= maxGens; gen++) {
        live = Life.step(live, rule);
        if (live.size === 0) return { outcome: 'dies', gen, snapshots };
        if (live.size > 1000) return { outcome: 'explodes', gen, snapshots };

        // Find connected components
        const comps = connectedComponents(live);
        snapshots.push({ gen, size: live.size, components: comps.length, set: live });

        if (verbose && comps.length > 1) {
            console.log(`  gen ${gen}: ${live.size} cells in ${comps.length} components`);
        }
    }
    return { outcome: 'survived', snapshots };
}

function connectedComponents(liveSet) {
    const visited = new Set();
    const components = [];
    for (const k of liveSet) {
        if (visited.has(k)) continue;
        const comp = new Set();
        const queue = [k];
        while (queue.length > 0) {
            const cur = queue.pop();
            if (visited.has(cur)) continue;
            if (!liveSet.has(cur)) continue;
            visited.add(cur);
            comp.add(cur);
            const [p, q] = parseKey(cur);
            for (const [dp, dq] of NBRS) {
                const nk = key(p + dp, q + dq);
                if (!visited.has(nk) && liveSet.has(nk)) queue.push(nk);
            }
        }
        components.push(comp);
    }
    return components;
}

module.exports = {
    Life, NBRS,
    key, parseKey, setFrom, pairsFrom,
    bbox, normalize, canonical, translate,
    setsEqual, isTranslationOf,
    rotCW, allTransforms, canonicalForm,
    classify, enumConnected,
    traceWithComponents, connectedComponents,
};
