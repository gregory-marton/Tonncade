#!/usr/bin/env node
const path = require('path');
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const {
    Life, key, mapFrom, tripletsFrom, canonical, connectedComponents
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

const BEEHIVE_GLIDER = [[1, 1, 2], [2, 1, 2], [0, 2, 1], [0, 3, 2], [1, 3, 2]];
const CORE = [[3,-3,2],[4,-4,2],[4,-2,2],[5,-3,2],[5,-4,1]];

let board = mapFrom(CORE);
const startP = 15;
const startQ = -8;

for (const [p, q, s] of BEEHIVE_GLIDER) {
    board.set(key(p + startP, q + startQ), s);
}

const canonCore = canonical(mapFrom(CORE));

for (let gen = 0; gen <= 30; gen++) {
    console.log(`\n=== Gen ${gen} ===`);
    console.log(`Board Size: ${board.size}`);
    const c = canonical(board);
    if (c === canonCore) {
        console.log("Glider successfully eaten! Core restored.");
    }
    board = Life.stepStates(board, RULE_TABLE, ORDER);
}
