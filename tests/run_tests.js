// Simple browser DOM mocking for Node.js test runner
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const svgListeners = {};
global.svgListeners = svgListeners;

global.window = global;
global.window.addEventListener = function() {};
global.location = { origin: 'http://localhost', pathname: '/', search: '' };
global.window.location = global.location;
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
        querySelector: () => ({ setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} })
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
    },
    addEventListener: () => {},
    visibilityState: 'visible'
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
loadScript('replay.js');
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

    // INVARIANT (GitHub issue #3): every piece SIZE the game defines has COMPLETE coverage of
    // all distinct "one-sided" polyhexes of that size -- every connected hex shape achievable
    // with N cells, distinct under rotation only (not reflection, since pieces here never flip)
    // -- with no duplicates and no gaps. This is what actually went wrong with the 3-cell
    // "bendy" pieces '<'/'>': coded as byte-identical shapes, a straight-up duplicate rather
    // than the two real trihex bend shapes (only one 120-degree bend exists, since it's
    // self-mirroring under this rotation-only system -- verified directly: no geometrically
    // distinct mirror image is reachable). Enumerating the full shape space and comparing
    // against it, rather than just checking pairwise for THIS ONE known duplicate, catches
    // every future case at once -- including a missing shape, not just a repeated one -- and
    // needs no updates if a future size (e.g. 5-cell pentahexes) gets added: it reads which
    // sizes actually exist from Pieces.TYPES itself.
    console.log("Running complete-polyhex-coverage test...");
    const canonicalShapeKey = (cells) => {
        const sorted = [...cells].sort((a, b) => a.p - b.p || a.q - b.q);
        const { p: dp, q: dq } = sorted[0];
        return cells.map(c => cellKey({ p: c.p - dp, q: c.q - dq })).sort().join('|');
    };
    const canonicalRotationInvariantKey = (cells) => {
        let cur = cells;
        const candidates = [];
        for (let i = 0; i < 6; i++) {
            candidates.push(canonicalShapeKey(cur));
            cur = PiecesObj.rotate(cur);
        }
        return candidates.sort()[0];
    };

    const piecesBySize = {};
    for (const [typeKey, def] of Object.entries(PiecesObj.TYPES)) {
        const size = def.cells.length;
        (piecesBySize[size] = piecesBySize[size] || []).push(typeKey);
    }
    const maxSize = Math.max(...Object.keys(piecesBySize).map(Number));

    // Enumerate every distinct one-sided polyhex shape from size 1 up to maxSize, growing each
    // size's shapes from the previous size's by trying every way to attach one more cell.
    let currentShapes = [[{ p: 0, q: 0 }]];
    const enumeratedBySize = { 1: [canonicalRotationInvariantKey(currentShapes[0])] };
    for (let size = 2; size <= maxSize; size++) {
        const seen = new Set();
        const nextShapes = [];
        for (const shape of currentShapes) {
            const inShape = new Set(shape.map(cellKey));
            for (const c of shape) {
                for (const n of TonnetzObj.getNeighbors(c.p, c.q)) {
                    const nk = cellKey(n);
                    if (inShape.has(nk)) continue;
                    const candidate = [...shape, n];
                    const ck = canonicalRotationInvariantKey(candidate);
                    if (!seen.has(ck)) {
                        seen.add(ck);
                        nextShapes.push(candidate);
                    }
                }
            }
        }
        enumeratedBySize[size] = [...seen];
        currentShapes = nextShapes;
    }

    for (const size of Object.keys(piecesBySize).map(Number).sort((a, b) => a - b)) {
        const actualKeys = piecesBySize[size].map(typeKey => canonicalRotationInvariantKey(PiecesObj.TYPES[typeKey].cells));
        const actualSet = new Set(actualKeys);
        if (actualSet.size !== actualKeys.length) {
            const seenAlready = new Set();
            let dupeTypeKey = null;
            for (let i = 0; i < piecesBySize[size].length; i++) {
                if (seenAlready.has(actualKeys[i])) { dupeTypeKey = piecesBySize[size][i]; break; }
                seenAlready.add(actualKeys[i]);
            }
            console.error(`FAIL: size-${size} pieces have a duplicate shape -- '${dupeTypeKey}' is the same reachable shape as an earlier piece of the same size`);
            process.exit(1);
        }
        const enumeratedSet = new Set(enumeratedBySize[size]);
        const missing = [...enumeratedSet].filter(k => !actualSet.has(k));
        if (missing.length > 0) {
            console.error(`FAIL: size-${size} pieces are missing ${missing.length} of the ${enumeratedSet.size} possible distinct one-sided shapes -- coverage is incomplete!`);
            process.exit(1);
        }
        const extra = [...actualSet].filter(k => !enumeratedSet.has(k));
        if (extra.length > 0) {
            console.error(`FAIL: size-${size} pieces include a shape the enumeration didn't produce -- either an invalid/disconnected piece, or an enumeration bug`);
            process.exit(1);
        }
        console.log(`  size ${size}: ${actualSet.size}/${enumeratedSet.size} distinct shapes -- complete, no duplicates, no gaps`);
    }
    console.log("PASS: every piece size has complete coverage of all distinct one-sided polyhex shapes!");

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

    // BUG (reported live): a piece sliding toward the Gravity cup's left/right wall should be
    // able to overhang as far as it likes, as long as it keeps at least one hex ("a toe-hold")
    // on the actual playable columns (-5..4). Previously checkActivePlacement required EVERY
    // cell to be within a fixed window only one column wider than the cup (-6..5), so any
    // piece longer than 2 cells could only ever overhang by exactly one column, well short of
    // "down to a single hex on the grid."
    console.log("Running Gravity single-hex-toehold overhang test...");
    App.currentMode = 'gravity';
    Board.cells.clear();

    // I piece "laying flat" (rotation 0): local cells (-1,0),(0,0),(1,0),(2,0), i.e. 4 cells in
    // a row. At q=10 (even, so floor(10/2)=5), col = p + 5.
    // Anchor p=0 -> cols 4,5,6,7: only the leftmost cell (col 4) is on-grid, the other three
    // hang off the RIGHT edge (col > 4). This should be a legal position (one toe-hold cell).
    if (!Board.checkActivePlacement('I', 0, 10, 0)) {
        console.error("FAIL: a piece with exactly one hex on the grid (hanging 3 off the right edge) should be a legal position!");
        process.exit(1);
    }

    // Anchor p=-12 -> cols -8,-7,-6,-5: only the rightmost cell (col -5) is on-grid, the other
    // three hang off the LEFT edge. Also legal (one toe-hold cell, other side).
    if (!Board.checkActivePlacement('I', -12, 10, 0)) {
        console.error("FAIL: a piece with exactly one hex on the grid (hanging 3 off the left edge) should be a legal position!");
        process.exit(1);
    }

    // Anchor p=-13 -> cols -9,-8,-7,-6: ALL four cells off-grid, zero toe-hold. Must be illegal
    // — a piece can't float entirely off the playable columns.
    if (Board.checkActivePlacement('I', -13, 10, 0)) {
        console.error("FAIL: a piece with NO hex on the grid (fully off the left edge) should be illegal (no toe-hold)!");
        process.exit(1);
    }

    // The floor (q < 0) must stay a hard limit regardless of toe-hold elsewhere: a piece can't
    // dip below q=0 even if the rest of it has plenty of room on-grid.
    if (Board.checkActivePlacement('I', 0, -1, 0)) {
        console.error("FAIL: a piece with any cell below the floor (q < 0) should always be illegal, toe-hold or not!");
        process.exit(1);
    }

    Board.cells.clear();
    console.log("PASS: Gravity pieces can overhang the side walls down to a single toe-hold hex, and the floor stays solid!");

    // INVARIANT (see docs/invariants.md): rotation direction is a shared foundation used by
    // every mode (tap-to-rotate, keyboard Space/G, two-finger twist, Gravity's D-pad) — get it
    // wrong once and it's wrong everywhere. Verify against real screen coordinates (not just
    // "whatever the code currently does") that Pieces.rotate() is counter-clockwise and its
    // inverse, rotateCCW(), is clockwise — this is the exact opposite of what their names claim,
    // a real mislabeling caught live via Gravity's D-pad (whose ↻/↺ icons make the wrong
    // direction immediately obvious, unlike Sandbox/Blast's un-iconed rotation).
    console.log("Running rotation direction (invariants.md) test...");
    const RenderObj = vm.runInContext("Render", context);
    // Degrees clockwise from 12 o'clock (screen-up), matching a clock face.
    const clockAngle = (p, q) => {
        const pos = RenderObj.getScreenPos(p, q);
        let a = Math.atan2(pos.x, -pos.y) * 180 / Math.PI;
        if (a < 0) a += 360;
        return a;
    };
    const angleBefore = clockAngle(1, 0); // due east, 90 degrees clockwise from 12
    const afterRotate = PiecesObj.rotate([{ p: 1, q: 0 }])[0];
    const afterRotateCCW = PiecesObj.rotateCCW([{ p: 1, q: 0 }])[0];
    const angleAfterRotate = clockAngle(afterRotate.p, afterRotate.q);
    const angleAfterRotateCCW = clockAngle(afterRotateCCW.p, afterRotateCCW.q);
    // A 60-degree step; mod 360 so e.g. 90 -> 30 (CCW) doesn't get confused with 90 -> 390.
    const stepCCW = ((angleBefore - angleAfterRotate) % 360 + 360) % 360;
    const stepCW = ((angleAfterRotateCCW - angleBefore) % 360 + 360) % 360;
    if (stepCCW !== 60) {
        console.error(`FAIL: Pieces.rotate() should move a cell 60 degrees counter-clockwise on screen! Measured step: ${stepCCW}`);
        process.exit(1);
    }
    if (stepCW !== 60) {
        console.error(`FAIL: Pieces.rotateCCW() should move a cell 60 degrees clockwise on screen! Measured step: ${stepCW}`);
        process.exit(1);
    }
    console.log("PASS: Pieces.rotate() is counter-clockwise and Pieces.rotateCCW() is clockwise, matching real screen coordinates!");

    // BUG (reported live, twice, via real play -- a horizontal I piece, then an L piece, each
    // visibly overlapping an existing piece): a piece is allowed to lock while overhanging past
    // the true playable columns (-5..4) -- that's the intentional toe-hold rule tested above.
    // But once locked, those overhanging cells get written into Board.cells exactly like any
    // other cell (fillCells doesn't bounds-check), and findFullLines only ever scans cols
    // -5..4, so that off-grid debris is never part of a clearable line and never gets removed
    // -- it persists forever. checkActivePlacement's toe-hold loop skips collision checking
    // entirely for any cell outside -5..4 ("nothing out there to collide with" -- true only
    // before anything had ever locked out there). A later piece can then lock directly on top
    // of that leftover debris.
    console.log("Running Gravity overhang-debris collision test...");
    App.currentMode = 'gravity';
    Board.cells.clear();

    // Simulate leftover debris from an earlier overhanging lock: one off-grid cell at col 5,
    // one column past the right wall (col 4).
    Board.cells.set('0,10', { type: 'X', color: '#ffffff' });

    // A fresh I piece laying flat, anchor p=-1,q=10: cells land at cols 3,4,5,6 -- two genuine
    // on-grid toe-hold cells (3 and 4, both empty) plus a cell at col 5 landing exactly on the
    // debris placed above.
    if (Board.checkActivePlacement('I', -1, 10, 0)) {
        console.error("FAIL: a piece overlapping leftover off-grid overhang debris should be illegal, even though the debris itself sits off-grid!");
        process.exit(1);
    }

    Board.cells.clear();
    console.log("PASS: Gravity pieces can no longer lock on top of leftover off-grid overhang debris!");

    // BUG (flagged live): checkGameOver's gravity-mode anchor scan only tries anchor columns
    // -6..5, but a piece can legally overhang past either wall while keeping a toe-hold on the
    // true grid (-5..4). Empirically scanning every piece x rotation x row on an empty board
    // (see scratchpad verification) confirms the true necessary range is -7..6, not -6..5 -- one
    // column short on each side. If the ONLY legal placement left on a nearly-full board
    // requires an anchor outside -6..5, the old scan misses it and falsely declares game over.
    //
    // 'L' rotation 0 at anchor col -7, row 1 is used here (not 'I') because 'I' is
    // rotationally symmetric: its own col-7 overhang is also reachable via rotation+3 at col-6,
    // which sits inside the old range and would mask the bug. 'L' has no such symmetric twin
    // inside -6..5 for this placement (verified empirically), so it isolates the range gap.
    console.log("Running Gravity checkGameOver overhang-anchor range test...");
    App.currentMode = 'gravity';
    Board.cells.clear();

    // 'L' rotation 0 at anchor p=-7, q=1 occupies (-8,2),(-7,1),(-6,0),(-5,0) -- only (-5,0) is
    // on-grid (col -5, the toe-hold). Fill every other cell in a wide margin around the cup
    // solid, leaving only this piece's own footprint free.
    const footprint = new Set(['-8,2', '-7,1', '-6,0', '-5,0']);
    for (let q = 0; q <= 20; q++) {
        for (let col = -14; col <= 13; col++) {
            const p = col - Math.floor(q / 2);
            const key = `${p},${q}`;
            if (footprint.has(key)) continue;
            Board.cells.set(key, { type: 'X', color: '#ffffff' });
        }
    }

    if (Board.checkGameOver('L')) {
        console.error("FAIL: checkGameOver('L') should be false -- a legal far-left-overhang placement exists (anchor col -7), outside the old -6..5 scan range!");
        process.exit(1);
    }

    Board.cells.clear();
    console.log("PASS: checkGameOver's anchor-column scan reaches far enough to find legal far-overhang placements!");

    // Replay: an always-on capped log of recent input, so a player can report a bug post-hoc
    // (via the console, or the report-bug link) without having had anything pre-armed. Eviction
    // is amortized (see Replay.trimToCapacity): the log is allowed to grow up to 2x MAX_EVENTS
    // before a single bulk trim brings it back down to exactly MAX_EVENTS, rather than paying an
    // O(n) shift() on every single push once at capacity.
    console.log("Running Replay capped-log eviction test...");
    const ReplayObj = vm.runInContext("Replay", context);
    ReplayObj.log = [];
    // Push exactly one past the 2x threshold, landing precisely at the post-trim state: this
    // triggers exactly one trim, converging the log to exactly MAX_EVENTS.
    for (let i = 0; i <= ReplayObj.MAX_EVENTS * 2; i++) {
        ReplayObj.record({ type: 'keydown', t: i, key: 'x' });
        if (ReplayObj.log.length > ReplayObj.MAX_EVENTS * 2) {
            console.error(`FAIL: Replay.log should never exceed 2x MAX_EVENTS (${ReplayObj.MAX_EVENTS * 2}), but was ${ReplayObj.log.length} after push #${i}`);
            process.exit(1);
        }
    }
    if (ReplayObj.log.length !== ReplayObj.MAX_EVENTS) {
        console.error(`FAIL: Replay.log should converge to exactly MAX_EVENTS (${ReplayObj.MAX_EVENTS}) right after crossing the 2x trim threshold, but was ${ReplayObj.log.length}`);
        process.exit(1);
    }
    // The oldest surviving event should be t = MAX_EVENTS + 1 (everything from 0..MAX_EVENTS,
    // inclusive, was evicted by the single trim).
    if (ReplayObj.log[0].t !== ReplayObj.MAX_EVENTS + 1) {
        console.error(`FAIL: Replay.log should evict the OLDEST events first, oldest surviving t should be ${ReplayObj.MAX_EVENTS + 1}, was ${ReplayObj.log[0].t}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    console.log("PASS: Replay.log stays bounded (never exceeds 2x MAX_EVENTS) and evicts the oldest events first, converging to exactly MAX_EVENTS after each amortized trim!");

    // Deterministic replay reconstruction: wall-clock timing turned out to be fragile for long
    // real sessions (small timing differences during replay compounded into a completely
    // different eventual game outcome), so every recorded event is stamped with a running count
    // of automatic-tick advances instead -- a replay tool calls tick() directly that many times
    // between events, with no timing involved at all.
    console.log("Running Replay.recordTick() event-stamping test...");
    ReplayObj.log = [];
    ReplayObj.tickSeq = 0;
    ReplayObj.record({ type: 'keydown', t: 1, key: 'a' });
    ReplayObj.recordTick();
    ReplayObj.recordTick();
    ReplayObj.record({ type: 'keydown', t: 2, key: 'b' });
    ReplayObj.recordTick();
    ReplayObj.record({ type: 'keydown', t: 3, key: 'c' });
    if (ReplayObj.log[0].tick !== 0 || ReplayObj.log[1].tick !== 2 || ReplayObj.log[2].tick !== 3) {
        console.error(`FAIL: each recorded event should be stamped with the tick count AT THE MOMENT it was recorded! Got: ${JSON.stringify(ReplayObj.log.map(e => e.tick))}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    ReplayObj.tickSeq = 0;
    console.log("PASS: Replay.record() stamps every event with the current tick count, so the delta between two events is exactly how many automatic ticks fired in between!");

    // Keystrokes/taps alone can't recreate a session: Gravity/Blast draw random pieces via
    // Math.random(), so replaying the same inputs against a fresh (differently-random) session
    // reproduces nothing without also knowing what Math.random() itself produced. seedRandom()
    // patches Math.random() with a seeded PRNG (seeded from real entropy, so gameplay is exactly
    // as unpredictable to the player as before) and records the seed used -- reproducing that
    // seed must reproduce the exact same sequence.
    console.log("Running Replay.seedRandom() determinism test...");
    ReplayObj.seedRandom();
    if (typeof ReplayObj.seed !== 'number') {
        console.error(`FAIL: Replay.seedRandom() should set Replay.seed to a number, got: ${ReplayObj.seed}`);
        process.exit(1);
    }
    const sequenceA = [Math.random(), Math.random(), Math.random()];
    // Reconstruct the exact same PRNG externally, seeded with the recorded value, and confirm
    // it reproduces the identical sequence -- the core promise of recording the seed at all.
    let state = ReplayObj.seed;
    const reconstructed = function() {
        state |= 0; state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const sequenceB = [reconstructed(), reconstructed(), reconstructed()];
    if (JSON.stringify(sequenceA) !== JSON.stringify(sequenceB)) {
        console.error(`FAIL: reseeding with Replay.seed should reproduce the identical Math.random() sequence! Got ${JSON.stringify(sequenceA)} vs ${JSON.stringify(sequenceB)}`);
        process.exit(1);
    }
    console.log("PASS: Replay.seedRandom()'s recorded seed exactly reproduces its Math.random() sequence!");

    // Recording a seed is only half of "full recreation" -- the other half is being able to
    // feed a previously-recorded seed back in via ?seed= and actually get it to take effect.
    console.log("Running Replay.seedRandom() ?seed= forcing test...");
    global.location.search = '?seed=123456789';
    ReplayObj.seedRandom();
    if (ReplayObj.seed !== 123456789) {
        console.error(`FAIL: seedRandom() should use the ?seed= URL param when present, got seed ${ReplayObj.seed} instead of 123456789`);
        process.exit(1);
    }
    global.location.search = '';
    console.log("PASS: Replay.seedRandom() honors a forced ?seed= URL param!");

    console.log("Running Replay.buildIssueUrl() test...");
    ReplayObj.recordMeta();
    ReplayObj.log = [{ type: 'keydown', t: 1, key: 'f' }, { type: 'keydown', t: 2, key: 'h' }];
    App.currentMode = 'gravity';
    const issueUrl = ReplayObj.buildIssueUrl();
    if (!issueUrl.startsWith('https://github.com/gregory-marton/Tonncade/issues/new?')) {
        console.error(`FAIL: buildIssueUrl() should target the real repo's new-issue page, got: ${issueUrl}`);
        process.exit(1);
    }
    const urlParams = new URLSearchParams(issueUrl.split('?')[1]);
    if (urlParams.has('title')) {
        console.error(`FAIL: buildIssueUrl() should not set a title -- keep the URL minimal, all detail lives in the clipboard payload! Got title: ${urlParams.get('title')}`);
        process.exit(1);
    }
    const decodedBody = urlParams.get('body');
    // The URL carries nothing but instructions to the human reporter -- mode, seed, version,
    // and events all live in the downloaded/copied payload (see downloadFullLog and
    // copyFullLogToClipboard) instead, so they shouldn't be duplicated here.
    if (!decodedBody.includes('downloaded or copied to your clipboard')) {
        console.error(`FAIL: buildIssueUrl() body should tell the reporter the debug data was downloaded or copied to their clipboard! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes('What happened?')) {
        console.error(`FAIL: buildIssueUrl() body should prompt the reporter to describe what happened! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (decodedBody.includes('**Mode:**') || decodedBody.includes('**Seed:**') || decodedBody.includes('**Version:**') || decodedBody.includes('"key"')) {
        console.error(`FAIL: buildIssueUrl() body should not duplicate mode/seed/version/events -- that's redundant with the clipboard payload! Body: ${decodedBody}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    console.log("PASS: Replay.buildIssueUrl() keeps the URL minimal, deferring all detail to the downloaded/copied payload!");

    console.log("Running Replay.copyFullLogToClipboard() test...");
    ReplayObj.log = [{ type: 'keydown', t: 1, key: 'x' }];
    let clipboardWritten = null;
    // global.navigator is a getter-only built-in as of Node 21+ -- plain assignment silently
    // no-ops, so defineProperty is required to stub it out.
    Object.defineProperty(global, 'navigator', {
        value: { clipboard: { writeText: (text) => { clipboardWritten = text; return Promise.resolve(); } } },
        configurable: true,
    });
    vm.runInContext("Replay.copyFullLogToClipboard()", context);
    const clipboardPayload = JSON.parse(clipboardWritten);
    if (clipboardPayload.seed !== ReplayObj.seed || !Array.isArray(clipboardPayload.events) || clipboardPayload.events[0].key !== 'x') {
        console.error(`FAIL: copyFullLogToClipboard() should write { seed, meta, events } to the clipboard! Got: ${clipboardWritten}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    console.log("PASS: Replay.copyFullLogToClipboard() writes the full { seed, meta, events } log to the clipboard!");

    console.log("Running window.replay() schema test...");
    ReplayObj.log = [{ type: 'keydown', t: 1, key: 'x' }];
    const replayed = JSON.parse(vm.runInContext("window.replay()", context));
    if (typeof replayed.seed !== 'number' || !replayed.meta || !Array.isArray(replayed.events)) {
        console.error(`FAIL: window.replay() should return { seed: number, meta: object, events: array }! Got: ${JSON.stringify(replayed)}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    console.log("PASS: window.replay() returns { seed, meta, events } -- enough to fully recreate a session!");

    // Sound is the one signal that corresponds exactly to game state (INV-4: every sound the
    // app plays corresponds exactly to the Tonnetz note(s) actually responsible for it), so
    // recording it gives replay verification a checkpoint that raw input events alone can't:
    // a fresh reconstruction's own sound log can be diffed against the original to find the
    // exact tick where they first disagree, instead of only comparing final board state.
    console.log("Running Replay.wrapSynth() sound-event recording test...");
    ReplayObj.soundLog = [];
    const Synth = vm.runInContext("Synth", context);
    Synth.playNote(60);
    Synth.playChord([60, 64, 67]);
    if (ReplayObj.soundLog.length !== 4) {
        console.error(`FAIL: Replay.wrapSynth() should record one sound event per real playNote() call (1 direct + 3 from playChord's 3 notes) in its OWN soundLog (not the input-event log), got ${ReplayObj.soundLog.length}: ${JSON.stringify(ReplayObj.soundLog)}`);
        process.exit(1);
    }
    if (ReplayObj.soundLog[0].midi !== 60) {
        console.error(`FAIL: sound event should record the exact midi note played! Got: ${JSON.stringify(ReplayObj.soundLog[0])}`);
        process.exit(1);
    }
    const chordMidis = ReplayObj.soundLog.slice(1).map(e => e.midi);
    if (JSON.stringify(chordMidis) !== JSON.stringify([60, 64, 67])) {
        console.error(`FAIL: playChord()'s individual notes should each be recorded! Got: ${JSON.stringify(chordMidis)}`);
        process.exit(1);
    }
    // Sound events must NOT compete with the raw-input ring buffer -- a single Gravity session
    // was found to produce ~2100 sound events (89% of a 2349-event combined log) against a
    // MAX_EVENTS of 5000, which would evict real early-session input events out of existence on
    // any longer session. They get their own, separate, much larger ring buffer instead.
    if (ReplayObj.log.some(e => e.type === 'sound')) {
        console.error(`FAIL: sound events must go into Replay.soundLog, NOT Replay.log (the raw-input ring buffer) -- they'd crowd out real input events on long sessions.`);
        process.exit(1);
    }
    // Bass-boost harmonics (playNote's own recursive call for low notes, isHarmonic=true) are
    // an audio-engineering implementation detail, not a distinct game event -- recording them
    // would pollute the comparison signal with near-duplicate entries for every low note.
    ReplayObj.soundLog = [];
    Synth.playNote(30); // low enough to trigger the internal harmonic recursive call
    if (ReplayObj.soundLog.length !== 1 || ReplayObj.soundLog[0].midi !== 30) {
        console.error(`FAIL: a low note's internal bass-boost harmonic call should NOT be separately recorded! Got: ${JSON.stringify(ReplayObj.soundLog)}`);
        process.exit(1);
    }
    ReplayObj.soundLog = [];
    console.log("PASS: Replay.wrapSynth() records every real note played (not internal bass-boost harmonics) into its own soundLog!");

    console.log("Running Replay soundLog capped-eviction test...");
    ReplayObj.soundLog = [];
    for (let i = 0; i <= ReplayObj.MAX_SOUND_EVENTS * 2; i++) {
        ReplayObj.recordSound(i);
    }
    if (ReplayObj.soundLog.length !== ReplayObj.MAX_SOUND_EVENTS) {
        console.error(`FAIL: Replay.soundLog should converge to exactly MAX_SOUND_EVENTS (${ReplayObj.MAX_SOUND_EVENTS}) right after crossing the 2x trim threshold, but was ${ReplayObj.soundLog.length}`);
        process.exit(1);
    }
    if (ReplayObj.soundLog[0].midi !== ReplayObj.MAX_SOUND_EVENTS + 1) {
        console.error(`FAIL: Replay.soundLog should evict the OLDEST sound events first, oldest surviving midi should be ${ReplayObj.MAX_SOUND_EVENTS + 1}, was ${ReplayObj.soundLog[0].midi}`);
        process.exit(1);
    }
    ReplayObj.soundLog = [];
    console.log("PASS: Replay.soundLog is its own capped, amortized-eviction log, independent of the input-event log!");

    console.log("Running scripts/replay-to-gif.js option parsing test...");
    const { parseArgs, isVirtualButtonTarget } = require('../scripts/replay-to-gif.js');
    const defaultOpts = parseArgs(['session.json']);
    if (defaultOpts.out !== 'session.gif' || defaultOpts.viewerOut !== 'session.viewer.html') {
        console.error(`FAIL: parseArgs() should default --out to <basename>.gif and --viewer-out to <basename>.viewer.html, both next to the input! Got: out=${defaultOpts.out} viewerOut=${defaultOpts.viewerOut}`);
        process.exit(1);
    }
    if (defaultOpts.baseUrl !== 'http://localhost:8001' || defaultOpts.speed !== 1 || defaultOpts.maxWait !== 300000 || defaultOpts.frameDelay !== 700 || defaultOpts.keepFrames !== false) {
        console.error(`FAIL: parseArgs() defaults are wrong! Got: ${JSON.stringify(defaultOpts)}`);
        process.exit(1);
    }
    // The viewer is the primary local, no-publish-step way to actually step through frames --
    // it and the GIF both default to on, since a fresh bug report should never require deciding
    // up front which output you'll want.
    if (defaultOpts.makeGif !== true || defaultOpts.makeViewer !== true) {
        console.error(`FAIL: parseArgs() should default to producing both the GIF and the local HTML viewer! Got: ${JSON.stringify(defaultOpts)}`);
        process.exit(1);
    }
    const customOpts = parseArgs(['a/session.json', '--out=b/out.gif', '--speed=2', '--keep-frames']);
    if (customOpts.out !== 'b/out.gif' || customOpts.speed !== 2 || customOpts.keepFrames !== true) {
        console.error(`FAIL: parseArgs() should honor explicit flags! Got: ${JSON.stringify(customOpts)}`);
        process.exit(1);
    }
    const noGifOpts = parseArgs(['session.json', '--no-gif', '--viewer-out=custom.html']);
    if (noGifOpts.makeGif !== false || noGifOpts.makeViewer !== true || noGifOpts.viewerOut !== 'custom.html') {
        console.error(`FAIL: parseArgs() should honor --no-gif and --viewer-out! Got: ${JSON.stringify(noGifOpts)}`);
        process.exit(1);
    }
    const noViewerOpts = parseArgs(['session.json', '--no-viewer']);
    if (noViewerOpts.makeViewer !== false || noViewerOpts.makeGif !== true) {
        console.error(`FAIL: parseArgs() should honor --no-viewer without disabling the GIF! Got: ${JSON.stringify(noViewerOpts)}`);
        process.exit(1);
    }
    console.log("PASS: scripts/replay-to-gif.js's parseArgs() applies sane defaults and honors overrides!");

    console.log("Running scripts/replay-to-gif.js virtual-button detection test...");
    if (!isVirtualButtonTarget('#m-btn-left') || !isVirtualButtonTarget('#snake-btn-ul')) {
        console.error("FAIL: isVirtualButtonTarget() should recognize #m-btn-* and #snake-btn-* ids!");
        process.exit(1);
    }
    if (isVirtualButtonTarget('#drawer-handle') || isVirtualButtonTarget('div.mode-option') || isVirtualButtonTarget('polygon')) {
        console.error("FAIL: isVirtualButtonTarget() should NOT match non-virtual-button targets!");
        process.exit(1);
    }
    console.log("PASS: scripts/replay-to-gif.js's isVirtualButtonTarget() only matches #m-btn-*/#snake-btn-* ids!");

    process.exit(0);
} catch (err) {
    console.error("FAIL: App test failed with error:", err.stack || err.message);
    process.exit(1);
}
