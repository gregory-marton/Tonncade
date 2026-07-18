// Simple browser DOM mocking for Node.js test runner
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const svgListeners = {};
global.svgListeners = svgListeners;

global.window = global;
global.window.addEventListener = function() {};
global.window.matchMedia = function(query) {
    return {
        matches: false,
        media: query,
        onchange: null,
        addListener: function() {},
        removeListener: function() {},
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return false; }
    };
};
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
        if (id === 'tonnetz-svg') {
            return {
                style: {},
                setAttribute: () => {},
                appendChild: () => {},
                addEventListener: (type, callback) => {
                    svgListeners[type] = callback;
                },
                classList: { add: () => {}, remove: () => {} },
                querySelectorAll: () => []
            };
        }
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
                { getAttribute: () => 'sandbox', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'midi', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'snake', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'blast', classList: { add: () => {}, remove: () => {} } },
                { getAttribute: () => 'gravity', classList: { add: () => {}, remove: () => {} } }
            ];
        }
        return [];
    },
    querySelector: (selector) => {
        return {
            style: {},
            classList: { add: () => {}, remove: () => {} }
        };
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
loadScript('sandbox.js');
loadScript('blast.js');
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

    // 5. C - Eb - G - B (60, 63, 67, 71) is C m(Maj7)
    const mMaj7All = TonnetzObj.analyzeAllChords([60, 63, 67, 71]);
    if (!mMaj7All.includes('C m(Maj7)')) {
        console.error("FAIL: [60, 63, 67, 71] should yield C m(Maj7)! Got:", mMaj7All);
        process.exit(1);
    }

    // 6. C - Eb - F - Bb (60, 63, 65, 70) is C Quartal Stack
    const quartalAll = TonnetzObj.analyzeAllChords([60, 63, 65, 70]);
    if (!quartalAll.includes('C Quartal Stack')) {
        console.error("FAIL: [60, 63, 65, 70] should yield C Quartal Stack! Got:", quartalAll);
        process.exit(1);
    }

    console.log("PASS: Tonnetz.analyzeAllChords is fully correct!");

    // Test Case: MIDI Mode Touch Input Fix (Red-Green Verification)
    console.log("Running MIDI Mode touch input test...");
    
    // Switch to MIDI mode
    App.currentMode = 'midi';
    
    // Ensure getCellFromTouch works by mocking elementFromPoint
    global.document.elementFromPoint = (x, y) => {
        return {
            tagName: 'polygon',
            getAttribute: (attr) => {
                if (attr === 'data-p') return '1';
                if (attr === 'data-q') return '2';
                return null;
            }
        };
    };

    // Find the touchstart listener captured
    const touchStartHandler = svgListeners['touchstart'];
    if (!touchStartHandler) {
        console.error("FAIL: touchstart listener was not registered on #tonnetz-svg!");
        process.exit(1);
    }

    // Mock a touchstart event
    const mockTouchEvent = {
        touches: [{ clientX: 100, clientY: 100 }],
        preventDefault: () => {}
    };

    // Call the handler. If it has the crash bug (calling handleCellInput), it will throw an error
    touchStartHandler(mockTouchEvent);
    console.log("PASS: MIDI Mode touch input test succeeded without crash!");

    // Test Case: Responsive Mobile Header and Mode Selector (Red-Green Verification)
    console.log("Running Responsive Header CSS rules test...");
    const cssContent = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
    
    if (!cssContent.includes('@media (max-width: 767px)')) {
        console.error("FAIL: style.css does not target max-width: 767px for phones!");
        process.exit(1);
    }
    if (!cssContent.includes('flex-direction: column') || !cssContent.includes('height: 80px')) {
        // Wait, let's verify top-header column stacking is present in style.css
        if (!cssContent.includes('#top-header') || !cssContent.includes('flex-direction: column')) {
            console.error("FAIL: #top-header is not styled as a column on mobile!");
            process.exit(1);
        }
    }
    console.log("PASS: Responsive Header CSS rules test succeeded!");

    // INVARIANT (see docs/invariants.md, "Piece geometry validity"): every piece's cells are
    // connected (no floating sub-parts), non-overlapping, and closed under six 60° rotations
    // (a hex piece rotated a full turn is exactly itself again) — for every type, at every
    // rotation.
    console.log("Running Piece geometry validity (invariants.md) tests...");
    const PiecesObj = vm.runInContext("Pieces", context);
    const cellKey = (c) => `${c.p},${c.q}`;

    for (const typeKey of Object.keys(PiecesObj.TYPES)) {
        for (let rot = 0; rot < 6; rot++) {
            const cells = PiecesObj.getAbsoluteCells(typeKey, 0, 0, rot);

            const keys = cells.map(cellKey);
            if (new Set(keys).size !== keys.length) {
                console.error(`FAIL: Piece '${typeKey}' at rotation ${rot} has overlapping cells: ${keys.join(' ')}`);
                process.exit(1);
            }

            const cellSet = new Set(keys);
            const visited = new Set([keys[0]]);
            const stack = [cells[0]];
            while (stack.length) {
                const cur = stack.pop();
                for (const n of TonnetzObj.getNeighbors(cur.p, cur.q)) {
                    const nk = cellKey(n);
                    if (cellSet.has(nk) && !visited.has(nk)) {
                        visited.add(nk);
                        stack.push(n);
                    }
                }
            }
            if (visited.size !== cells.length) {
                console.error(`FAIL: Piece '${typeKey}' at rotation ${rot} is not connected: ${keys.join(' ')} (reached only ${[...visited].join(' ')})`);
                process.exit(1);
            }
        }

        // Six 60° rotations should return to the piece's original shape (set-equal, not
        // necessarily in the same array order).
        const original = new Set(PiecesObj.TYPES[typeKey].cells.map(cellKey));
        const rotatedSixTimes = new Set(PiecesObj.getAbsoluteCells(typeKey, 0, 0, 6).map(cellKey));
        if (original.size !== rotatedSixTimes.size || [...original].some(k => !rotatedSixTimes.has(k))) {
            console.error(`FAIL: Piece '${typeKey}' is not closed under six rotations — original: ${[...original].join(' ')}, after 6 rotations: ${[...rotatedSixTimes].join(' ')}`);
            process.exit(1);
        }
    }
    console.log("PASS: Every piece is connected, non-overlapping, and closed under rotation at all 6 orientations!");

    // INVARIANT: every wikipedia.org link in the source uses Special:MyLanguage, so a
    // non-English reader lands on their own language's edition (falling back to English if
    // no translation exists) instead of always being forced into English regardless of their
    // browser/OS language. Scans the actual source files rather than checking a couple of
    // rendered links, so any future wikipedia.org link added without the prefix gets caught.
    console.log("Running Wikipedia links use Special:MyLanguage test...");
    const filesToScan = ['index.html', 'js/main.js', 'js/sandbox.js', 'js/blast.js', 'js/gravity.js', 'js/snake.js', 'js/midi.js'];
    const wikiUrlRe = /https?:\/\/[a-z-]+\.wikipedia\.org\/[^\s"'`)]+/g;
    let wikiLinksChecked = 0;
    for (const relPath of filesToScan) {
        const filePath = path.join(__dirname, '..', relPath);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(wikiUrlRe) || [];
        for (const url of matches) {
            // The one legitimate exception: a full-text search fallback isn't a specific
            // article, so Special:MyLanguage (which redirects a known PAGENAME) doesn't apply.
            if (url.includes('/w/index.php?search=')) continue;
            wikiLinksChecked++;
            if (!url.includes('/wiki/Special:MyLanguage/')) {
                console.error(`FAIL: ${relPath} has a Wikipedia link that doesn't use Special:MyLanguage: ${url}`);
                process.exit(1);
            }
        }
    }
    if (wikiLinksChecked === 0) {
        console.error('FAIL: expected to find at least one Special:MyLanguage-eligible Wikipedia link to check, found none — the scan itself may be broken');
        process.exit(1);
    }
    console.log(`PASS: All ${wikiLinksChecked} Wikipedia links use Special:MyLanguage!`);

    process.exit(0);
} catch (err) {
    console.error("FAIL: App test failed with error:", err.stack || err.message);
    process.exit(1);
}
