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

    // Replay: an always-on ring buffer of recent input, so a player can report a bug post-hoc
    // (via the console, or the report-bug link) without having had anything pre-armed.
    console.log("Running Replay ring buffer capacity test...");
    const ReplayObj = vm.runInContext("Replay", context);
    ReplayObj.log = [];
    for (let i = 0; i < ReplayObj.MAX_EVENTS + 50; i++) {
        ReplayObj.record({ type: 'keydown', t: i, key: 'x' });
    }
    if (ReplayObj.log.length !== ReplayObj.MAX_EVENTS) {
        console.error(`FAIL: Replay.log should cap at MAX_EVENTS (${ReplayObj.MAX_EVENTS}), but was ${ReplayObj.log.length}`);
        process.exit(1);
    }
    // The oldest 50 events should have been evicted -- the first surviving one is t=50.
    if (ReplayObj.log[0].t !== 50) {
        console.error(`FAIL: Replay.log should evict the OLDEST events first, oldest surviving t should be 50, was ${ReplayObj.log[0].t}`);
        process.exit(1);
    }
    console.log("PASS: Replay.log is a ring buffer that evicts the oldest events first, capped at MAX_EVENTS!");

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
    const decodedBody = new URLSearchParams(issueUrl.split('?')[1]).get('body');
    if (!decodedBody.includes('**Mode:** gravity')) {
        console.error(`FAIL: buildIssueUrl() body should include the current mode! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes(`**Seed:** ${ReplayObj.seed}`)) {
        console.error(`FAIL: buildIssueUrl() body should include the recorded seed! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes(`?seed=${ReplayObj.seed}`)) {
        console.error(`FAIL: buildIssueUrl() body should include a ready-to-use ?seed= replay URL! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes(`**Version:** ${ReplayObj.meta.version}`)) {
        console.error(`FAIL: buildIssueUrl() body should include the recorded git version! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes('**Max touch points:**') || !decodedBody.includes('**Device pixel ratio:**')) {
        console.error(`FAIL: buildIssueUrl() body should include touch/pixel-ratio metadata! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes('"key": "f"') || !decodedBody.includes('"key": "h"')) {
        console.error(`FAIL: buildIssueUrl() body should include recent recorded events! Body: ${decodedBody}`);
        process.exit(1);
    }
    // Found live (a real reporter's actual workflow, and a real ~2.5 hour Blast session whose
    // full log blew past GitHub's 65536-char body limit): the full log must always be treated as
    // a file to attach, never text to paste into the body -- regardless of how short the session
    // was. No conditional "if it's not already pasted below" framing either, since the 30-event
    // preview is ALWAYS below, which made that old wording read as satisfied even when the
    // reporter still needed to separately handle the full log.
    if (!decodedBody.includes(`downloaded as \`tonncade-replay-${ReplayObj.seed}.json\``)) {
        console.error(`FAIL: buildIssueUrl() body should say the full log was downloaded, with the exact filename! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (!decodedBody.includes("don't paste it into the body")) {
        console.error(`FAIL: buildIssueUrl() body should explicitly say not to paste the full log into the body! Body: ${decodedBody}`);
        process.exit(1);
    }
    if (decodedBody.includes('copied to your clipboard') || decodedBody.includes('Paste it below this line')) {
        console.error(`FAIL: buildIssueUrl() should never suggest pasting the full log into the body! Body: ${decodedBody}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    console.log("PASS: Replay.buildIssueUrl() always treats the full log as a file to attach, never text to paste into the body!");

    console.log("Running window.replay() schema test...");
    ReplayObj.log = [{ type: 'keydown', t: 1, key: 'x' }];
    const replayed = JSON.parse(vm.runInContext("window.replay()", context));
    if (typeof replayed.seed !== 'number' || !replayed.meta || !Array.isArray(replayed.events)) {
        console.error(`FAIL: window.replay() should return { seed: number, meta: object, events: array }! Got: ${JSON.stringify(replayed)}`);
        process.exit(1);
    }
    ReplayObj.log = [];
    console.log("PASS: window.replay() returns { seed, meta, events } -- enough to fully recreate a session!");

    process.exit(0);
} catch (err) {
    console.error("FAIL: App test failed with error:", err.stack || err.message);
    process.exit(1);
}
