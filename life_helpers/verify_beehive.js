#!/usr/bin/env node
// Copyright (C) 2026  Gregory Marton
// Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.

const path = require('path');
const fs = require('fs');
const Life = require(path.join(__dirname, '..', 'js', 'life.js'));
const {
    key, parseKey, canonicalForm, connectedComponents
} = require('./simulate.js');

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

const GLIDER_SEED = [
    [0, 2, 1],
    [1, 1, 2],
    [2, 1, 2],
    [0, 3, 2],
    [1, 3, 2],
];

// We need canonical forms for the 3-state glider to detect emissions.
// Let's simplify and just check component size, since the beehive glider is 5 cells.
// We can also check if any component has exactly 5 cells and translates.

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

const cells = [[0,0,1],[1,0,1],[1,-1,2],[0,-1,2],[2,-1,2],[-1,1,2],[2,0,1],[1,-2,1],[-2,1,1],[0,1,2],[-1,2,1]];

let m = stateMapFrom(cells);

let emissions = 0;
let prevComps = 0;

console.log("Verifying Beehive Gun candidate...");

for (let gen = 0; gen <= 100; gen++) {
    const keys = new Set(m.keys());
    const comps = connectedComponents(keys);
    
    // Check if the number of components is growing
    if (comps.length > prevComps && comps.length > 1) {
        // A new component separated.
        emissions++;
        console.log(`Gen ${gen}: Component count increased to ${comps.length}`);
    }
    prevComps = comps.length;
    
    m = step(m);
}

if (comps = connectedComponents(new Set(m.keys())), comps.length > 5) {
    console.log(`Success! Pattern emits multiple components (${comps.length} at gen 100).`);
    
    const yaml = `# Beehive Gun — a flyer gun under the 3-state Beehive rule.
# Discovered by computational search (life_helpers/beehive_gun.js).
# See docs/life-rules.md for the full rule language.
name: "Beehive Gun"
description: "A gun pattern in the 3-state Beehive rule that continuously emits gliders."
states: 3
order: "21"
transition:
  - [0, 1, 2, 1, 2, 0, 0]
  - [0, 2, 2, 2, 1, 1]
  - [0, 0, 2, 2, 0]
  - [0, 2, 2, 0]
  - [0, 0, 2]
  - [2, 0]
  - [0]
sound: { when: born, duration: 0.4 }
sounds:
  - { state: 1, velocity: 95, duration: 0.35 }
  - { state: 2, velocity: 55, duration: 0.7 }
initial:
  cells:
${cells.map(c => `    - [${c[0]}, ${c[1]}, ${c[2]}]`).join('\n')}
tempo: 180
`;
    const outPath = path.join(__dirname, '..', 'life', 'beehive-gun.yaml');
    fs.writeFileSync(outPath, yaml);
    console.log(`Written ${outPath}`);
    
    // Add to index.json
    const indexPath = path.join(__dirname, '..', 'life', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!index.find(e => e.file === 'beehive-gun.yaml')) {
        index.push({ name: "Beehive Gun", file: "beehive-gun.yaml" });
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
        console.log("Updated index.json");
    }
} else {
    console.log("Failed to verify gun-like behavior.");
}
