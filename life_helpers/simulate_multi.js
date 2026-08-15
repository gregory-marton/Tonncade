const path = require('path');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));

const NBRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

function key(p, q) { return p + ',' + q; }
function parseKey(k) { const [a, b] = k.split(','); return [+a, +b]; }

function mapFrom(triplets) {
    const m = new Map();
    for (const [p, q, s] of triplets) {
        if (s > 0) m.set(key(p, q), s);
    }
    return m;
}

function tripletsFrom(m) {
    const arr = [];
    for (const [k, s] of m.entries()) {
        const [p, q] = parseKey(k);
        arr.push([p, q, s]);
    }
    return arr;
}

function bbox(m) {
    let minP = Infinity, maxP = -Infinity, minQ = Infinity, maxQ = -Infinity;
    for (const k of m.keys()) {
        const [p, q] = parseKey(k);
        if (p < minP) minP = p; if (p > maxP) maxP = p;
        if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
    }
    return { minP, maxP, minQ, maxQ };
}

function normalize(m) {
    const b = bbox(m);
    const out = new Map();
    for (const [k, s] of m.entries()) {
        const [p, q] = parseKey(k);
        out.set(key(p - b.minP, q - b.minQ), s);
    }
    return { map: out, dp: b.minP, dq: b.minQ };
}

function canonical(m) {
    const { map } = normalize(m);
    // Sort keys and include states
    const items = [];
    for (const [k, s] of map.entries()) {
        items.push(`${k}:${s}`);
    }
    return items.sort().join(';');
}

function rotCW(p, q) { return [p + q, -p]; }

function allTransforms(triplets) {
    const images = [];
    let cur = triplets.map(([p, q, s]) => [p, q, s]);
    for (let r = 0; r < 6; r++) {
        images.push(cur.slice());
        images.push(cur.map(([p, q, s]) => [p + q, -q, s]));
        cur = cur.map(([p, q, s]) => [...rotCW(p, q), s]);
    }
    return images;
}

function canonicalForm(triplets) {
    const images = allTransforms(triplets);
    let best = null;
    for (const img of images) {
        const m = mapFrom(img);
        const c = canonical(m);
        if (best === null || c < best) best = c;
    }
    return best;
}

function connectedComponents(m) {
    const visited = new Set();
    const components = [];
    for (const k of m.keys()) {
        if (visited.has(k)) continue;
        const comp = new Map();
        const queue = [k];
        while (queue.length > 0) {
            const cur = queue.pop();
            if (visited.has(cur)) continue;
            if (!m.has(cur)) continue;
            visited.add(cur);
            comp.set(cur, m.get(cur));
            const [p, q] = parseKey(cur);
            for (const [dp, dq] of NBRS) {
                const nk = key(p + dp, q + dq);
                if (!visited.has(nk) && m.has(nk)) queue.push(nk);
            }
        }
        components.push(comp);
    }
    return components;
}

module.exports = {
    Life, NBRS,
    key, parseKey, mapFrom, tripletsFrom,
    bbox, normalize, canonical,
    rotCW, allTransforms, canonicalForm,
    connectedComponents
};
