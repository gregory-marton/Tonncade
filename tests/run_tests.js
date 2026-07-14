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
        addEventListener: () => {},
        querySelector: () => ({ setAttribute: () => {}, appendChild: () => {} })
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
            classList: { add: () => {}, remove: () => {} },
            querySelectorAll: () => []
        };
    },
    querySelectorAll: (selector) => {
        if (selector === '.mode-option') {
            return [
                { getAttribute: () => 'chop', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'midi', classList: { add: () => {}, remove: () => {} } },
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

    // Test Tonnetz.analyzeChord
    console.log("Running Tonnetz.analyzeChord tests...");
    if (TonnetzObj.analyzeChord([60]) !== null) {
        console.error("FAIL: Single note [60] should return null");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([60, 61, 62]) !== null) {
        console.error("FAIL: Unnamed combination [60, 61, 62] should return null");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([60, 67]) !== 'C 5 (Fifth) / G 4th') {
        console.error("FAIL: Fifth [60, 67] should be analyzed as 'C 5 (Fifth) / G 4th'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([67, 74]) !== 'G 5 (Fifth) / D 4th') {
        console.error("FAIL: Fifth [67, 74] (G & D) should be analyzed as 'G 5 (Fifth) / D 4th'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([74, 67]) !== 'G 5 (Fifth) / D 4th') {
        console.error("FAIL: Inverted Fifth [74, 67] (D & G) should be analyzed as 'G 5 (Fifth) / D 4th'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([60, 64, 67]) !== 'C Major') {
        console.error("FAIL: Major triad [60, 64, 67] should be analyzed as 'C Major'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([60, 63, 67]) !== 'C Minor') {
        console.error("FAIL: Minor triad [60, 63, 67] should be analyzed as 'C Minor'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([62, 65, 72]) !== 'D m7 (shell)') {
        console.error("FAIL: D F C [62, 65, 72] should be analyzed as 'D m7 (shell)'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([60, 64, 67, 71]) !== 'C Maj7') {
        console.error("FAIL: Major 7th chord [60, 64, 67, 71] should be analyzed as 'C Maj7'");
        process.exit(1);
    }
    if (TonnetzObj.analyzeChord([57, 60, 64, 67]) !== 'A m7 / C 6') {
        console.error("FAIL: Minor 7th chord [57, 60, 64, 67] should be analyzed as 'A m7 / C 6'");
        process.exit(1);
    }
    console.log("PASS: Tonnetz.analyzeChord is fully correct!");

    // Test Tonnetz.analyzeAllChords
    console.log("Running Tonnetz.analyzeAllChords tests...");
    
    // 1. C - G - D (60, 67, 74) is both C Sus2 and G Sus4
    const susAll = TonnetzObj.analyzeAllChords([60, 67, 74]);
    if (!susAll.includes('C Sus2') || !susAll.includes('G Sus4')) {
        console.error("FAIL: [60, 67, 74] should yield both C Sus2 and G Sus4! Got:", susAll);
        process.exit(1);
    }

    // 2. C - G - D - A (60, 67, 74, 81) is C Pentatonic Stack
    const pentAll = TonnetzObj.analyzeAllChords([60, 67, 74, 81]);
    if (!pentAll.includes('C Pentatonic Stack')) {
        console.error("FAIL: [60, 67, 74, 81] should yield C Pentatonic Stack! Got:", pentAll);
        process.exit(1);
    }

    // 3. A - C - Eb - G (57, 60, 63, 67) is A m7b5 (half-diminished)
    const m7b5All = TonnetzObj.analyzeAllChords([57, 60, 63, 67]);
    if (!m7b5All.includes('A m7b5')) {
        console.error("FAIL: [57, 60, 63, 67] should yield A m7b5! Got:", m7b5All);
        process.exit(1);
    }

    // 4. C - F - G - Bb (60, 65, 67, 70) is C 7sus4
    const sus7All = TonnetzObj.analyzeAllChords([60, 65, 67, 70]);
    if (!sus7All.includes('C 7sus4')) {
        console.error("FAIL: [60, 65, 67, 70] should yield C 7sus4! Got:", sus7All);
        process.exit(1);
    }

    console.log("PASS: Tonnetz.analyzeAllChords is fully correct!");
    process.exit(0);
} catch (err) {
    console.error("FAIL: App test failed with error:", err.stack || err.message);
    process.exit(1);
}
