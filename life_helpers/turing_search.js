#!/usr/bin/env node
global.FileFolder = { create: () => ({ on: () => {} }) };
global.AudioFolder = { create: () => ({ on: () => {} }) };

const { Life, mapFrom, tripletsFrom, canonical, key } = require('./simulate_multi.js');
const fs = require('fs');

// We will search 2-state and 3-state rules.
// For now, let's search 3-state rules (transition tables) because they have rich glider dynamics.

function randomRule3State() {
    const table = [];
    for (let c2 = 0; c2 <= 6; c2++) {
        const row = [];
        for (let c1 = 0; c1 <= 6 - c2; c1++) {
            // Bias towards 0 to prevent explosive rules (like Conway: mostly dead)
            const r = Math.random();
            if (c1 === 0 && c2 === 0) row.push(0); // empty space stays empty
            else if (r < 0.7) row.push(0);
            else if (r < 0.85) row.push(1);
            else row.push(2);
        }
        table.push(row);
    }
    return table;
}

function evaluateRule(ruleTable) {
    let gliders = 0;
    let stationary = 0;
    let explodes = 0;
    let dies = 0;

    // Run 500 soups to evaluate the rule's ecosystem
    for (let trial = 0; trial < 500; trial++) {
        let m = new Map();
        // 5x5 soup
        for (let p=-2; p<=2; p++) {
            for (let q=-2; q<=2; q++) {
                if (Math.random() < 0.4) m.set(key(p,q), Math.random() < 0.5 ? 1 : 2);
            }
        }

        const history = [];
        const absHistory = [];
        let stable = false;
        let period = 0;
        
        for (let gen = 0; gen < 50; gen++) {
            if (m.size === 0) { dies++; break; }
            if (m.size > 100) { explodes++; break; }
            
            const c = canonical(m);
            const pairs = tripletsFrom(m).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
            const absKey = JSON.stringify(pairs);

            const absIdx = absHistory.indexOf(absKey);
            if (absIdx !== -1) {
                // It's strictly stationary!
                stationary++;
                stable = true;
                break;
            }

            const cIdx = history.indexOf(c);
            if (cIdx !== -1) {
                // It repeats its shape, but didn't match absolute coords -> it moved!
                gliders++;
                stable = true;
                break;
            }

            history.push(c);
            absHistory.push(absKey);
            m = Life.stepStates(m, ruleTable, '21');
        }
    }
    
    return { gliders, stationary, explodes, dies };
}

console.log("Searching space of 3-state rules for Turing components...");
let bestScore = 0;
let bestRule = null;
let bestStats = null;

for (let ruleIdx = 0; ruleIdx < 1000; ruleIdx++) {
    const rule = randomRule3State();
    const stats = evaluateRule(rule);
    
    // We want a rule that supports BOTH gliders and stationary blocks!
    // A healthy rule shouldn't explode 100% of the time, nor die 100% of the time.
    if (stats.gliders > 0 && stats.stationary > 0 && stats.explodes < 450) {
        const score = stats.gliders * stats.stationary; // incentivize having both
        if (score > bestScore) {
            bestScore = score;
            bestRule = rule;
            bestStats = stats;
            console.log(`\nNew best rule found! Score: ${score}`);
            console.log(`Stats: Gliders=${stats.gliders}, Stationary=${stats.stationary}, Explodes=${stats.explodes}, Dies=${stats.dies}`);
            console.log(JSON.stringify(rule));
        }
    }
}

if (bestRule) {
    console.log("\n=== BEST RULE ===");
    console.log(JSON.stringify(bestRule));
    console.log("Stats:", bestStats);
} else {
    console.log("\nNo rules found that support both gliders and stationary blocks.");
}
