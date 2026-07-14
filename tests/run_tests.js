// Simple browser DOM mocking for Node.js test runner
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;
global.document = {
    createElement: (tag) => ({
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        addEventListener: () => {}
    }),
    createElementNS: (ns, tag) => ({
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} }
    }),
    getElementById: (id) => {
        // Return a mock element. At startup, Render.svg is undefined until Render.init is called
        // to retrieve this element.
        return {
            style: {},
            setAttribute: () => {},
            appendChild: () => {},
            addEventListener: () => {},
            classList: { add: () => {}, remove: () => {} }
        };
    },
    querySelectorAll: (selector) => {
        if (selector === '.mode-option') {
            return [
                { getAttribute: () => 'midi', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'chop', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'snake', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'puzzle', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'gravity', classList: { add: () => {}, remove: () => {} } }
            ];
        }
        return [];
    },
    querySelector: (selector) => {
        return { style: {} };
    }
};
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};
global.navigator = { maxTouchPoints: 0 };
global.AudioContext = function() {
    return {
        createGain: () => ({ connect: () => {}, gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }),
        createOscillator: () => ({ connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } }),
        createBiquadFilter: () => ({ connect: () => {}, frequency: { value: 0 }, gain: { value: 0 } }),
        currentTime: 0
    };
};

// Mock standard browser functions
global.alert = (msg) => console.log("ALERT:", msg);
global.setTimeout = (fn, delay) => {}; // No-op for tests
global.setInterval = (fn, delay) => {};

// Create VM context sharing globals
const context = vm.createContext(global);

// Load the scripts
function loadScript(file) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    vm.runInContext(code, context, { filename: file });
}

loadScript('version.js');
loadScript('tonnetz.js');
loadScript('synth.js');
loadScript('pieces.js');
loadScript('board.js');
loadScript('render.js');
loadScript('chop.js');
loadScript('puzzle.js');
loadScript('gravity.js');
loadScript('midi.js');
loadScript('snake.js');
loadScript('main.js');

const App = vm.runInContext("App", context);

// Run App.init() and assert
console.log("Running App.init() test...");
try {
    App.init();
    console.log("PASS: App.init() succeeded!");
    
    // TDD Gravity Mode cup dimensions test case
    console.log("Running Gravity Mode cup dimensions (10x20 visible, 10x15 playable) test...");
    App.currentMode = 'gravity';
    const Board = vm.runInContext("Board", context);

    Board.cells.clear();

    // Fill row q = 14 (15th row, top playable row)
    const rowQ = 14;
    for (let col = -5; col <= 4; col++) {
        const p = col - Math.floor(rowQ / 2);
        Board.cells.set(`${p},${rowQ}`, { type: 'I', color: '#ffffff' });
    }
    const fullLines = Board.findFullLines();
    if (fullLines.length !== 1) {
        console.error(`FAIL: 15th row (q = ${rowQ}) not detected! Length was: ${fullLines.length}`);
        process.exit(1);
    }
    if (fullLines[0].length !== 10) {
        console.error(`FAIL: Row width was not 10 cells! Width was: ${fullLines[0].length}`);
        process.exit(1);
    }

    // Fill row q = 15 (16th row - spawn/buffer zone)
    Board.cells.clear();
    const bufferQ = 15;
    for (let col = -5; col <= 4; col++) {
        const p = col - Math.floor(bufferQ / 2);
        Board.cells.set(`${p},${bufferQ}`, { type: 'I', color: '#ffffff' });
    }
    const fullLinesBuffer = Board.findFullLines();
    if (fullLinesBuffer.length !== 0) {
        console.error(`FAIL: Row in spawn zone (q = ${bufferQ}) was incorrectly detected as clearable!`);
        process.exit(1);
    }

    Board.cells.clear();
    console.log("PASS: Gravity Mode cup is correctly 10x20 visible, 10x15 playable!");

    // Test Tonnetz Isomorphism
    console.log("Running Tonnetz isomorphism tests...");
    const TonnetzObj = vm.runInContext("Tonnetz", context);

    // Standard Mode Tonnetz Isomorphism Test
    App.currentMode = 'midi'; // Standard mode formula
    for (let p = -50; p <= 50; p++) {
        for (let q = -50; q <= 50; q++) {
            const currentMidi = TonnetzObj.getMidi(p, q);
            const stepP = TonnetzObj.getMidi(p + 1, q) - currentMidi;
            const stepQ = TonnetzObj.getMidi(p, q + 1) - currentMidi;
            const stepResultant = TonnetzObj.getMidi(p - 1, q + 1) - currentMidi;

            if (stepP !== 7) {
                console.error(`FAIL: Standard Tonnetz is not isomorphic at (${p}, ${q}) on p-axis! Step: ${stepP}`);
                process.exit(1);
            }
            if (stepQ !== 3) {
                console.error(`FAIL: Standard Tonnetz is not isomorphic at (${p}, ${q}) on q-axis! Step: ${stepQ}`);
                process.exit(1);
            }
            if (stepResultant !== -4) {
                console.error(`FAIL: Standard Tonnetz is not isomorphic at (${p}, ${q}) on resultant axis! Step: ${stepResultant}`);
                process.exit(1);
            }
        }
    }
    console.log("PASS: Standard Tonnetz remains perfectly translationally isomorphic!");

    // Gravity Mode Tonnetz Isomorphism Test
    App.currentMode = 'gravity'; // Gravity mode formula
    for (let p = -50; p <= 50; p++) {
        for (let q = -50; q <= 50; q++) {
            const currentMidi = TonnetzObj.getMidi(p, q);
            const stepP = TonnetzObj.getMidi(p + 1, q) - currentMidi;
            const stepQ = TonnetzObj.getMidi(p, q + 1) - currentMidi;
            const stepResultant = TonnetzObj.getMidi(p - 1, q + 1) - currentMidi;

            if (stepP !== -3) {
                console.error(`FAIL: Gravity Tonnetz is not isomorphic at (${p}, ${q}) on p-axis! Step: ${stepP}`);
                process.exit(1);
            }
            if (stepQ !== 4) {
                console.error(`FAIL: Gravity Tonnetz is not isomorphic at (${p}, ${q}) on q-axis! Step: ${stepQ}`);
                process.exit(1);
            }
            if (stepResultant !== 7) {
                console.error(`FAIL: Gravity Tonnetz is not isomorphic at (${p}, ${q}) on resultant axis! Step: ${stepResultant}`);
                process.exit(1);
            }
        }
    }
    console.log("PASS: Gravity Tonnetz remains perfectly translationally isomorphic!");
    process.exit(0);
} catch (err) {
    console.error("FAIL: App test failed with error:", err.stack || err.message);
    process.exit(1);
}
