#!/usr/bin/env node
const path = require('path');
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const {
    Life, setFrom, mapFrom, connectedComponents, bbox
} = require('./simulate_multi.js');

const RULE_TABLE = [
    [0, 1, 2, 1, 2, 0, 0],
    [0, 2, 2, 2, 1, 1],
    [0, 0, 2, 2, 0],
    [0, 2, 2, 0],
    [0, 0, 2],
    [2, 0],
    [0]
];
const ORDER = '21';

const cells = [[-2,-1,1],[-2,3,1],[-1,-1,1],[-1,2,1],[0,-1,2],[0,1,2],[0,2,2],[0,-2,2],[1,1,2],[1,-2,2],[2,-2,2],[2,0,2],[2,1,1],[2,-3,1],[3,0,1],[3,-3,1]];
let live = mapFrom(cells);

for (let gen = 0; gen <= 100; gen++) {
    if (gen % 5 === 0) {
        const comps = connectedComponents(live);
        console.log(`\n=== Gen ${gen} ===`);
        console.log(`Components: ${comps.length}, Total Size: ${live.size}`);
        for (const comp of comps) {
            console.log(`  Size ${comp.size}: BBox:`, JSON.stringify(bbox(comp)));
        }
    }
    live = Life.stepStates(live, RULE_TABLE, ORDER);
}
