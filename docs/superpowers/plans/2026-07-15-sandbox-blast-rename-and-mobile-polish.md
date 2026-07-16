# Sandbox/Blast Rename and Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish renaming Chop→Sandbox and Puzzle→Blast throughout the codebase, catch up remaining Tonntris→Tonncade references, then ship four small mobile UX fixes (chord-guide text removal, 1.5x bigger mobile cells, pan clamping, and carousel scroll/drag-to-place).

**Architecture:** No new subsystems. This is a sequence of surgical edits to the existing single-page app (`index.html` + `js/*.js` + `css/style.css`), verified by the existing Node unit test suite (`tests/run_tests.js`) and Playwright suite (`tests/desktop.spec.js`, `tests/mobile.spec.js`). Task 1 (the rename) must land first since every later task's code/tests reference the new names (`SandboxMode`, `js/sandbox.js`, `BlastMode`, `js/blast.js`, mode strings `'sandbox'`/`'blast'`).

**Tech Stack:** Vanilla JS (no build step, no framework), SVG rendering, Playwright for browser tests, Node's built-in `assert` for unit tests (`tests/run_tests.js`).

## Global Constraints

- Dev machine is macOS (Darwin) — use BSD `sed` syntax: `sed -i '' ...` (not GNU `sed -i ...`).
- Full spec lives in `mobile_redesign_plan.md` (repo root) under "Next Round: Renames, Polish, and Carousel Fixes" — refer back to it for the "why" behind each task.
- Never touch the `oldKeys`/`tonntris_*` → `tonncade_*` localStorage migration block in `js/main.js` (`App.init`) — those are literal old key names from real users' browsers, not identifiers to rename.
- Never rename the English word "puzzle" where it's used as prose (not the mode name) — it appears legitimately in `package.json`'s `description` and in `README.md`. Leave both files' prose untouched.
- Playwright's `baseURL` is `http://localhost:8001` (see `playwright.config.js`). Tests assume something is already serving the app there — if nothing responds on port 8001, start `python3 -m http.server 8001` from the repo root, but do not kill/restart a server that's already running (there may be one in use from manual testing).
- Keep both test suites green after every task: `node tests/run_tests.js` (8 tests) and `npx playwright test` (35 tests, growing to 38 after Task 5 and 40 after Task 6).
- Commit after every task (not after every step) — each task is the reviewable unit.

---

### Task 1: Rename Chop→Sandbox and Puzzle→Blast everywhere

**Files:**
- Rename: `js/chop.js` → `js/sandbox.js`
- Rename: `js/puzzle.js` → `js/blast.js`
- Modify: `index.html`, `css/style.css`, `js/sandbox.js`, `js/main.js`, `js/midi.js`, `js/blast.js`, `js/render.js`, `sw.js`, `tests/run_tests.js`, `tests/mobile.spec.js`, `tests/test.html`

**Interfaces:**
- Produces (used by every later task): global `SandboxMode` (was `ChopMode`), global `BlastMode` (was `PuzzleMode`), mode strings `'sandbox'` (was `'chop'`) and `'blast'` (was `'puzzle'`), file `js/sandbox.js`, file `js/blast.js`.

This is a mechanical, repo-wide rename with no behavior change, so the "test" here is the existing test suite acting as a regression net rather than a new test written up front — there's no new behavior to write a failing test for.

- [ ] **Step 1: Confirm the baseline is green**

Ensure the app is being served at `http://localhost:8001` (start `python3 -m http.server 8001` from the repo root if nothing responds there), then run:

```bash
node tests/run_tests.js
npx playwright test
```

Expected: `node tests/run_tests.js` prints 8 `PASS:` lines with no `FAIL:`. `npx playwright test` prints `35 passed`.

- [ ] **Step 2: Rename the two files with git**

```bash
git mv js/chop.js js/sandbox.js
git mv js/puzzle.js js/blast.js
```

- [ ] **Step 3: Apply the rename across every reference**

Run this from the repo root (macOS `sed`, note the `-i ''`):

```bash
FILES=(
  index.html
  css/style.css
  js/sandbox.js
  js/main.js
  js/midi.js
  js/blast.js
  js/render.js
  sw.js
  tests/run_tests.js
  tests/mobile.spec.js
  tests/test.html
)

for f in "${FILES[@]}"; do
  sed -i '' \
    -e 's/ChopMode/SandboxMode/g' \
    -e 's/PuzzleMode/BlastMode/g' \
    -e 's/chop-controls/sandbox-controls/g' \
    -e 's/chopCtrls/sandboxCtrls/g' \
    -e 's/puzzle-stats/blast-stats/g' \
    -e 's/puzzle-best-count/blast-best-count/g' \
    -e 's/puzzle-active/blast-active/g' \
    -e 's/isPuzzle/isBlast/g' \
    -e 's/data-mode="chop"/data-mode="sandbox"/g' \
    -e 's/data-mode="puzzle"/data-mode="blast"/g' \
    -e "s/'chop'/'sandbox'/g" \
    -e "s/'puzzle'/'blast'/g" \
    -e 's/chop\.js/sandbox.js/g' \
    -e 's/puzzle\.js/blast.js/g' \
    -e 's/tonncade_puzzle_best/tonncade_blast_best/g' \
    -e 's/Chop Mode/Sandbox Mode/g' \
    -e 's/Chop Tonnetz/Sandbox Tonnetz/g' \
    -e 's/Blast (Puzzle) Mode/Blast Mode/g' \
    -e 's/Sandbox Mode (Infinite Sandbox)/Sandbox Mode/g' \
    "$f"
done
```

This deliberately does **not** use a blanket `chop`/`Chop`/`puzzle`/`Puzzle` replace — those bare patterns would corrupt the `tonntris_puzzle_best` literal inside `js/main.js`'s migration array. Every pattern above is a specific, previously-verified token (id, class, global name, quoted mode string, or exact comment/filename), so nothing outside the intended targets changes.

- [ ] **Step 2b (do by hand, not via sed): add a migration for the renamed localStorage key**

`js/blast.js` (was `js/puzzle.js`) persists a "best" score under the key `tonncade_puzzle_best` (now renamed to `tonncade_blast_best` by the sed pass above). Existing players have scores saved under the *old* key name — without a migration they'd silently reset to zero. Open `js/main.js` and find the existing migration block (already updated by the sed pass to say `SandboxMode`/`sandbox` elsewhere, but this specific block is untouched since it only contains `tonntris_*` strings):

```javascript
    init: function() {
        // Migrate localStorage keys from Tonntris to Tonncade to preserve player scores
        const oldKeys = ['tonntris_gravity_best', 'tonntris_midi_best', 'tonntris_puzzle_best', 'tonntris_snake_best'];
        oldKeys.forEach(oldKey => {
            const val = localStorage.getItem(oldKey);
            if (val !== null) {
                const newKey = oldKey.replace('tonntris', 'tonncade');
                localStorage.setItem(newKey, val);
                localStorage.removeItem(oldKey);
            }
        });
```

Add a second migration pass immediately after it, for the `puzzle` → `blast` rename specifically:

```javascript
    init: function() {
        // Migrate localStorage keys from Tonntris to Tonncade to preserve player scores
        const oldKeys = ['tonntris_gravity_best', 'tonntris_midi_best', 'tonntris_puzzle_best', 'tonntris_snake_best'];
        oldKeys.forEach(oldKey => {
            const val = localStorage.getItem(oldKey);
            if (val !== null) {
                const newKey = oldKey.replace('tonntris', 'tonncade');
                localStorage.setItem(newKey, val);
                localStorage.removeItem(oldKey);
            }
        });

        // Migrate the Puzzle Mode -> Blast Mode rename's localStorage key too
        const oldBlastKey = 'tonncade_puzzle_best';
        const blastVal = localStorage.getItem(oldBlastKey);
        if (blastVal !== null) {
            localStorage.setItem('tonncade_blast_best', blastVal);
            localStorage.removeItem(oldBlastKey);
        }
```

- [ ] **Step 4: Verify no stray references remain**

```bash
grep -rn "chop\|Chop\|puzzle\|Puzzle" --include="*.js" --include="*.html" --include="*.css" . \
  | grep -v node_modules \
  | grep -v "mobile_redesign_plan.md" \
  | grep -v "js/main.js.*tonntris_puzzle_best" \
  | grep -v "js/main.js.*oldBlastKey = 'tonncade_puzzle_best'"
```

Expected: no output (the two `grep -v` lines above intentionally allow the two literal old-key-name occurrences in `js/main.js`'s migration code, which must stay as-is). Also confirm `package.json` and `README.md` still contain their original prose "puzzle" word, untouched:

```bash
grep -n "puzzle" package.json README.md
```

Expected: one match in each, both inside the description sentence about "a spatial geometry puzzle".

- [ ] **Step 5: Run both test suites again**

```bash
node tests/run_tests.js
npx playwright test
```

Expected: same counts as Step 1 (8 unit tests passing, 35 Playwright tests passing) — this is a pure rename, so nothing should newly fail or newly skip.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Rename Chop Mode to Sandbox Mode and Puzzle Mode to Blast Mode in code"
```

---

### Task 2: Update remaining Tonntris references now that the repo is Tonncade

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing later tasks depend on (this is metadata only).

- [ ] **Step 1: Edit `package.json`**

Current relevant fields:

```json
  "name": "tonntris",
  ...
  "repository": {
    "type": "git",
    "url": "git+https://github.com/gregory-marton/Tonntris.git"
  },
  "keywords": [],
  "type": "commonjs",
  "bugs": {
    "url": "https://github.com/gregory-marton/Tonntris/issues"
  },
  "homepage": "https://github.com/gregory-marton/Tonntris#readme"
```

Change to:

```json
  "name": "tonncade",
  ...
  "repository": {
    "type": "git",
    "url": "git+https://github.com/gregory-marton/Tonncade.git"
  },
  "keywords": [],
  "type": "commonjs",
  "bugs": {
    "url": "https://github.com/gregory-marton/Tonncade/issues"
  },
  "homepage": "https://github.com/gregory-marton/Tonncade#readme"
```

(Leave `description` untouched — its "puzzle" is prose, not the mode name.)

- [ ] **Step 2: Update the local git remote**

```bash
git remote set-url origin https://github.com/gregory-marton/Tonncade.git
git remote -v
```

Expected: both `origin` lines now show `.../gregory-marton/Tonncade.git`.

- [ ] **Step 3: Sanity check `npm install` still works with the renamed package**

```bash
npm install
```

Expected: completes without error (only `package.json`'s `name` changed, no dependency changes).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "Update package.json and git remote to the Tonncade repo name"
```

---

### Task 3: Remove the chord-guide explanation text

**Files:**
- Modify: `index.html`
- Modify: `js/sandbox.js`
- Test: `tests/desktop.spec.js`

**Interfaces:**
- Consumes: `SandboxMode.updateGuideResults` (Task 1's renamed `js/sandbox.js`).

- [ ] **Step 1: Write the failing test**

Open `tests/desktop.spec.js` (currently 6 lines, one test). Add a second test:

```javascript
const { test, expect } = require('@playwright/test');

test('desktop page title is correct', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Tonncade/);
});

test('chord guide has no placeholder explanation text before a chord is chosen', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('#chord-guide-results').innerText();
  expect(text.trim()).toBe('');
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx playwright test tests/desktop.spec.js
```

Expected: FAIL — `#chord-guide-results` currently contains `"Select a chord to see which pieces and rotations create it."`, so `text.trim()` is not `''`.

- [ ] **Step 3: Remove the static text from `index.html`**

Find (around line 165):

```html
                    <div id="chord-guide-results" style="margin-top: 10px; font-size: 12px; color: var(--dim); line-height: 1.4;">
                        Select a chord to see which pieces and rotations create it.
                    </div>
```

Replace with:

```html
                    <div id="chord-guide-results" style="margin-top: 10px; font-size: 12px; color: var(--dim); line-height: 1.4;"></div>
```

- [ ] **Step 4: Remove the same text from the JS default in `js/sandbox.js`**

Find `updateGuideResults`:

```javascript
    updateGuideResults: function(val) {
        const resultsDiv = document.getElementById('chord-guide-results');
        if (!resultsDiv) return;

        if (!val) {
            resultsDiv.innerHTML = 'Select a chord to see which pieces and rotations create it.';
            return;
        }
```

Change the placeholder line to:

```javascript
    updateGuideResults: function(val) {
        const resultsDiv = document.getElementById('chord-guide-results');
        if (!resultsDiv) return;

        if (!val) {
            resultsDiv.innerHTML = '';
            return;
        }
```

- [ ] **Step 5: Run the test again to confirm it passes**

```bash
npx playwright test tests/desktop.spec.js
```

Expected: `2 passed`.

- [ ] **Step 6: Run the full suite to check for regressions**

```bash
node tests/run_tests.js
npx playwright test
```

Expected: 8 unit tests pass, 36 Playwright tests pass (35 + the new one).

- [ ] **Step 7: Commit**

```bash
git add index.html js/sandbox.js tests/desktop.spec.js
git commit -m "Remove self-evident chord guide placeholder text"
```

---

### Task 4: Make mobile hexagon cells 1.5x bigger

**Files:**
- Modify: `js/render.js`
- Modify: `js/sandbox.js`
- Modify: `js/blast.js`
- Modify: `js/midi.js`
- Test: `tests/mobile.spec.js`

**Interfaces:**
- Produces: `Render.getResponsiveZoom(baseZoom = 1)` — returns `baseZoom / 1.5` on phone-width viewports (`matchMedia('(max-width: 767px)')`), else `baseZoom` unchanged. Later tasks (5, 6) don't depend on this directly, but must not regress it.
- Consumes: `SandboxMode`/`BlastMode` (Task 1).

Root cause (see `mobile_redesign_plan.md` §3): `Render.updateView` always builds an `800×600`-unit `viewBox`, and `zoom` is never set to anything but `1` for Sandbox/Blast/MIDI modes — so phones (narrow CSS viewport) end up showing ~25 rows of hexes where ~16-17 would be comfortable.

- [ ] **Step 1: Write the failing test**

Add to `tests/mobile.spec.js`, in the "Visual Smoke Tests" section (after the `tonnetz SVG fills most of the screen height on mobile` test around line 59):

```javascript
  test('mobile hexagons are big enough that at most ~19 rows are visible', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const visibleRowCount = await page.evaluate(() => {
      const svg = document.getElementById('tonnetz-svg');
      const containerRect = document.getElementById('game-container').getBoundingClientRect();
      const hexes = Array.from(svg.querySelectorAll('polygon.cell'));
      const qSet = new Set();
      for (const h of hexes) {
        const r = h.getBoundingClientRect();
        const cy = (r.top + r.bottom) / 2;
        const cx = (r.left + r.right) / 2;
        if (cy >= containerRect.top && cy <= containerRect.bottom && cx >= containerRect.left && cx <= containerRect.right) {
          qSet.add(h.getAttribute('data-q'));
        }
      }
      return qSet.size;
    });

    expect(visibleRowCount).toBeLessThanOrEqual(19);
    expect(visibleRowCount).toBeGreaterThanOrEqual(10);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx playwright test tests/mobile.spec.js -g "mobile hexagons are big enough"
```

Expected: FAIL — currently ~25 rows are visible, over the `toBeLessThanOrEqual(19)` bound.

- [ ] **Step 3: Add `Render.getResponsiveZoom` to `js/render.js`**

Find the `viewX`/`viewY`/`zoom`/`updateView` block near the end of the file:

```javascript
    viewX: -400,
    viewY: -300,
    zoom: 1,

    updateView: function(viewX, viewY, zoom = 1) {
        this.viewX = viewX;
        this.viewY = viewY;
        this.zoom = zoom;
        const vb = `${viewX} ${viewY} ${800 * zoom} ${600 * zoom}`;
        this.svg.setAttribute('viewBox', vb);
    }
};
```

Add the new method right before `updateView`:

```javascript
    viewX: -400,
    viewY: -300,
    zoom: 1,

    // On phones, shrink the viewBox (relative to baseZoom) so each hex renders ~1.5x bigger.
    getResponsiveZoom: function(baseZoom = 1) {
        const isPhone = window.matchMedia('(max-width: 767px)').matches;
        return isPhone ? baseZoom / 1.5 : baseZoom;
    },

    updateView: function(viewX, viewY, zoom = 1) {
        this.viewX = viewX;
        this.viewY = viewY;
        this.zoom = zoom;
        const vb = `${viewX} ${viewY} ${800 * zoom} ${600 * zoom}`;
        this.svg.setAttribute('viewBox', vb);
    }
};
```

- [ ] **Step 4: Use it in `js/sandbox.js`'s `refreshLattice`**

Find:

```javascript
    refreshLattice: function() {
        this.hidePlacedTooltip();
        const viewport = {
            minP: -15, maxP: 15,
            minQ: -15, maxQ: 15
        };
        Render.drawLattice(viewport, {});
        this.renderPlacedPieces();

        // Re-append note and keyboard labels to the end of the SVG so they render on top of placed pieces
        const labels = Array.from(Render.svg.querySelectorAll('.note-label, .qwerty-label'));
        labels.forEach(lbl => Render.svg.appendChild(lbl));
        Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
    },
```

Replace the last two lines with:

```javascript
        const labels = Array.from(Render.svg.querySelectorAll('.note-label, .qwerty-label'));
        labels.forEach(lbl => Render.svg.appendChild(lbl));
        this.state.zoom = Render.getResponsiveZoom();
        Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
    },
```

- [ ] **Step 5: Use it in `js/blast.js`'s `refreshBoard`**

Find:

```javascript
        Render.updateView(-400, -300, 1);
    },
```

(within `refreshBoard`, right after the `Board.cells.forEach` loop) and replace with:

```javascript
        Render.updateView(-400, -300, Render.getResponsiveZoom());
    },
```

- [ ] **Step 6: Use it in `js/midi.js`'s `refreshBoard`**

Find:

```javascript
    refreshBoard: function() {
        // Render the full Sandbox Tonnetz layout
        const viewport = {
            minP: -15, maxP: 15,
            minQ: -15, maxQ: 15
        };
        Render.drawLattice(viewport, {});
        Render.updateView(-400, -300, 1);
    },
```

Replace the last line with:

```javascript
        Render.updateView(-400, -300, Render.getResponsiveZoom());
    },
```

- [ ] **Step 7: Run the test again to confirm it passes**

```bash
npx playwright test tests/mobile.spec.js -g "mobile hexagons are big enough"
```

Expected: PASS.

- [ ] **Step 8: Run the full suite to check for regressions**

```bash
node tests/run_tests.js
npx playwright test
```

Expected: 8 unit tests pass, 37 Playwright tests pass. Pay attention to the existing `tonnetz SVG fills most of the screen height on mobile` test — it only checks the SVG's own bounding box (unaffected by viewBox internals), so it should still pass.

- [ ] **Step 9: Commit**

```bash
git add js/render.js js/sandbox.js js/blast.js js/midi.js tests/mobile.spec.js
git commit -m "Make mobile hexagon cells 1.5x bigger by shrinking the viewBox on phone widths"
```

---

### Task 5: Clamp panning to the edge of the audible tonnetz

**Files:**
- Modify: `js/render.js`
- Modify: `js/sandbox.js`
- Modify: `js/main.js`
- Test: `tests/desktop.spec.js`

**Interfaces:**
- Produces: `Render.getPanBounds()` — returns `{ minX, maxX, minY, maxY }` (screen-space units, with ~1 hex-width of slack) describing how far `viewX`/`viewY` may range for the current mode, or `null` if the mode isn't Sandbox/Blast/MIDI (the only modes with free panning). `Render.updateView(viewX, viewY, zoom)` now clamps its inputs against these bounds before applying them and before returning — every caller must treat `Render.viewX`/`Render.viewY` as the source of truth *after* calling `updateView`, not their own pre-computed values.
- Consumes: `Tonnetz.getMidi`, `Render.getScreenPos`, `Render.HEX_R` (all pre-existing), `App.currentMode` (Task 1's renamed mode strings), `SandboxMode.state` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `tests/desktop.spec.js`:

```javascript
test('panning cannot scroll far past the edge of the audible tonnetz', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const result = await page.evaluate(() => {
    Render.updateView(-1000000, -1000000, 1);
    const afterNegative = { x: Render.viewX, y: Render.viewY };
    Render.updateView(1000000, 1000000, 1);
    const afterPositive = { x: Render.viewX, y: Render.viewY };
    const bounds = Render.getPanBounds();
    return { afterNegative, afterPositive, bounds };
  });

  expect(result.bounds).not.toBeNull();
  expect(result.afterNegative.x).toBeCloseTo(result.bounds.minX, 0);
  expect(result.afterNegative.y).toBeCloseTo(result.bounds.minY, 0);
  expect(result.afterPositive.x).toBeCloseTo(result.bounds.maxX - 800, 0);
  expect(result.afterPositive.y).toBeCloseTo(result.bounds.maxY - 600, 0);
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx playwright test tests/desktop.spec.js -g "panning cannot scroll"
```

Expected: FAIL — `Render.getPanBounds` doesn't exist yet, and `Render.updateView(-1000000, -1000000, 1)` currently sets `Render.viewX` to exactly `-1000000` (no clamping).

- [ ] **Step 3: Add `Render.getPanBounds` and clamp inside `updateView`**

In `js/render.js`, add `getPanBounds` right before `getResponsiveZoom` (added in Task 4), and rewrite `updateView`:

```javascript
    // On phones, shrink the viewBox (relative to baseZoom) so each hex renders ~1.5x bigger.
    getResponsiveZoom: function(baseZoom = 1) {
        const isPhone = window.matchMedia('(max-width: 767px)').matches;
        return isPhone ? baseZoom / 1.5 : baseZoom;
    },

    // Screen-space bounding box of every playable (MIDI 0-127) hex for the current mode,
    // padded by one hex-width of slack. Only Sandbox/Blast/MIDI modes allow free panning;
    // other modes return null and are left unclamped.
    getPanBounds: function() {
        if (typeof App === 'undefined') return null;
        const mode = App.currentMode;
        if (mode !== 'sandbox' && mode !== 'blast' && mode !== 'midi') return null;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let p = -15; p <= 15; p++) {
            for (let q = -15; q <= 15; q++) {
                const midi = Tonnetz.getMidi(p, q);
                if (midi < 0 || midi > 127) continue;
                const pos = this.getScreenPos(p, q);
                minX = Math.min(minX, pos.x - this.HEX_R);
                maxX = Math.max(maxX, pos.x + this.HEX_R);
                minY = Math.min(minY, pos.y - this.HEX_R);
                maxY = Math.max(maxY, pos.y + this.HEX_R);
            }
        }
        if (minX === Infinity) return null;

        const slack = this.HEX_R * 2; // ~1 hex-width of give past the edge
        return { minX: minX - slack, maxX: maxX + slack, minY: minY - slack, maxY: maxY + slack };
    },

    updateView: function(viewX, viewY, zoom = 1) {
        const bounds = this.getPanBounds();
        if (bounds) {
            const vbWidth = 800 * zoom;
            const vbHeight = 600 * zoom;
            const maxViewX = bounds.maxX - vbWidth;
            const maxViewY = bounds.maxY - vbHeight;
            if (bounds.minX <= maxViewX) {
                viewX = Math.min(Math.max(viewX, bounds.minX), maxViewX);
            }
            if (bounds.minY <= maxViewY) {
                viewY = Math.min(Math.max(viewY, bounds.minY), maxViewY);
            }
        }
        this.viewX = viewX;
        this.viewY = viewY;
        this.zoom = zoom;
        const vb = `${viewX} ${viewY} ${800 * zoom} ${600 * zoom}`;
        this.svg.setAttribute('viewBox', vb);
    }
};
```

(The `bounds.minX <= maxViewX` guard skips clamping on an axis where the playable content is smaller than the current viewport — avoids an inverted/nonsensical clamp range in that edge case.)

- [ ] **Step 4: Fix `js/sandbox.js`'s mouse-drag pan to read back the clamped value**

Find (inside `setupEvents`):

```javascript
        window.onmousemove = (e) => {
            if (this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
            }
```

Replace with:

```javascript
        window.onmousemove = (e) => {
            if (this.state.isPanning) {
                const dx = e.clientX - this.state.lastMouse.x;
                const dy = e.clientY - this.state.lastMouse.y;
                this.state.viewX -= dx;
                this.state.viewY -= dy;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
                Render.updateView(this.state.viewX, this.state.viewY, this.state.zoom);
                // Read back the clamped values so the next delta starts from where we actually are
                this.state.viewX = Render.viewX;
                this.state.viewY = Render.viewY;
            }
```

- [ ] **Step 5: Fix `js/main.js`'s two-finger touch pan the same way**

Find:

```javascript
                // 2. Panning drag logic
                if (twoFingerStartCenter && twoFingerStartView) {
                    const currentCenter = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                    const dx = currentCenter.x - twoFingerStartCenter.x;
                    const dy = currentCenter.y - twoFingerStartCenter.y;

                    // Multiply delta by zoom since zoom scales coordinates
                    Render.viewX = twoFingerStartView.x - dx * Render.zoom;
                    Render.viewY = twoFingerStartView.y - dy * Render.zoom;

                    // Keep ChopMode.state in sync
                    if (this.currentMode === 'chop') {
                        ChopMode.state.viewX = Render.viewX;
                        ChopMode.state.viewY = Render.viewY;
                    }

                    Render.updateView(Render.viewX, Render.viewY, Render.zoom);
                }
```

(Note: Task 1's rename already turned `'chop'` into `'sandbox'` and `ChopMode` into `SandboxMode` here — the block above is shown post-rename.) Replace with:

```javascript
                // 2. Panning drag logic
                if (twoFingerStartCenter && twoFingerStartView) {
                    const currentCenter = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                    const dx = currentCenter.x - twoFingerStartCenter.x;
                    const dy = currentCenter.y - twoFingerStartCenter.y;

                    // Multiply delta by zoom since zoom scales coordinates
                    const newViewX = twoFingerStartView.x - dx * Render.zoom;
                    const newViewY = twoFingerStartView.y - dy * Render.zoom;

                    Render.updateView(newViewX, newViewY, Render.zoom);

                    // Keep SandboxMode.state in sync with the (possibly clamped) result
                    if (this.currentMode === 'sandbox') {
                        SandboxMode.state.viewX = Render.viewX;
                        SandboxMode.state.viewY = Render.viewY;
                    }
                }
```

- [ ] **Step 6: Run the test again to confirm it passes**

```bash
npx playwright test tests/desktop.spec.js -g "panning cannot scroll"
```

Expected: PASS.

- [ ] **Step 7: Run the full suite to check for regressions**

```bash
node tests/run_tests.js
npx playwright test
```

Expected: 8 unit tests pass, 38 Playwright tests pass. Pay particular attention to the existing `drag repositions ghost WITHOUT placing or picking up` and `swipe DOWN places a piece, swipe UP picks it back up` tests — both pan-adjacent, should be unaffected since they operate well within bounds.

- [ ] **Step 8: Commit**

```bash
git add js/render.js js/sandbox.js js/main.js tests/desktop.spec.js
git commit -m "Clamp tonnetz panning to the edge of the audible (MIDI 0-127) range"
```

---

### Task 6: Piece carousel — native scroll + drag-to-place

**Files:**
- Modify: `js/sandbox.js`
- Test: `tests/mobile.spec.js`

**Interfaces:**
- Consumes: `SandboxMode.selectPiece`, `SandboxMode.canPlace`, `SandboxMode.placePiece`, `SandboxMode.updateGhost`, `SandboxMode.state` (all pre-existing, renamed in Task 1).

**Diagnosis** (see `mobile_redesign_plan.md` §5): `js/sandbox.js`'s desktop pan logic (`svg.onmousedown` sets `state.isPanning = true`; `window.onmousemove` — a **global**, not SVG-scoped, listener — pans the board while `isPanning` is true; `window.onmouseup` clears it) runs unconditionally, including on touch devices. Touch interactions on real mobile browsers can fire synthetic compatibility `mousedown`/`mousemove`/`mouseup` events, and `window.onmousemove` reacts to those regardless of what element they originated on — including the piece carousel, which lives outside the `<svg>` entirely. If a prior interaction ever leaves `isPanning` stuck `true` (e.g. a touch sequence whose synthetic `mouseup` doesn't fire cleanly), any later drag anywhere on the page — including over the carousel — would pan the board. This can't be reproduced with Playwright's synthetic `TouchEvent` dispatch (synthetic events don't trigger a browser's own mouse-compatibility-event synthesis), so Step 3 below removes the hazard structurally instead of chasing an exact repro, matching the existing `isTouch` guard pattern already used elsewhere in this codebase (e.g. `main.js`'s `setupMobileControls`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/mobile.spec.js`, inside `test.describe('Mobile Viewport and Layout Tests', ...)`, near the existing `touchHelpers` constant (around line 166). First add a second dispatch helper right after `touchHelpers` — this one targets whatever's actually under the coordinates (via `elementFromPoint`) instead of always targeting `#tonnetz-svg`, since these tests start on the carousel, not the board:

```javascript
  const dispatchAtHelpers = `
    window.__dispatchTouchAt = function(type, x, y) {
      const el = document.elementFromPoint(x, y) || document.body;
      const touch = new Touch({ identifier: 2, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      const config = { bubbles: true, cancelable: true };
      if (type === 'touchend') {
        config.touches = [];
        config.targetTouches = [];
      } else {
        config.touches = [touch];
        config.targetTouches = [touch];
      }
      config.changedTouches = [touch];
      el.dispatchEvent(new TouchEvent(type, config));
    };
  `;
```

Then, in the "D. Touch Gesture Semantics" section (after the existing swipe tests), add:

```javascript
  test('dragging a carousel piece downward onto the board places it', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(dispatchAtHelpers);

    let placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);

    const firstPiece = page.locator('.piece-item').first();
    const pieceBox = await firstPiece.boundingBox();
    const startX = pieceBox.x + pieceBox.width / 2;
    const startY = pieceBox.y + pieceBox.height / 2;

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    const cellBox = await cell.boundingBox();
    const endX = cellBox.x + cellBox.width / 2;
    const endY = cellBox.y + cellBox.height / 2;

    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchstart', x, y), { x: startX, y: startY });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: startX, y: startY + 40 });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: endX, y: endY });
    await page.waitForTimeout(50);
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchend', x, y), { x: endX, y: endY });

    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(1);
  });

  test('dragging a carousel piece horizontally does not pan the board or place a piece', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(dispatchAtHelpers);

    const viewXBefore = await page.evaluate(() => Render.viewX);
    const viewYBefore = await page.evaluate(() => Render.viewY);

    const firstPiece = page.locator('.piece-item').first();
    const pieceBox = await firstPiece.boundingBox();
    const startX = pieceBox.x + pieceBox.width / 2;
    const startY = pieceBox.y + pieceBox.height / 2;

    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchstart', x, y), { x: startX, y: startY });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: startX - 60, y: startY + 5 });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: startX - 120, y: startY + 5 });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchend', x, y), { x: startX - 120, y: startY + 5 });

    const viewXAfter = await page.evaluate(() => Render.viewX);
    const viewYAfter = await page.evaluate(() => Render.viewY);
    expect(viewXAfter).toBe(viewXBefore);
    expect(viewYAfter).toBe(viewYBefore);

    const placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
  });
```

- [ ] **Step 2: Run them to confirm both fail**

```bash
npx playwright test tests/mobile.spec.js -g "carousel piece"
```

Expected: FAIL on `dragging a carousel piece downward onto the board places it` (`placedCount` stays `0` — no such gesture exists yet; `window.__dispatchTouchAt` is fine, but nothing in the app reacts to a touch starting on `.piece-item`). The horizontal test may or may not already pass by coincidence (nothing currently listens for touch on the carousel at all) — that's fine, Step 3-4 build the real behavior both tests check.

- [ ] **Step 3: Guard `js/sandbox.js`'s mouse-based panning to skip touch devices**

In `setupEvents`, find the top of the function and the three handlers:

```javascript
    setupEvents: function() {
        const svg = Render.svg;
```

Add the touch-capability check right after:

```javascript
    setupEvents: function() {
        const svg = Render.svg;
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
```

Then find:

```javascript
            this.state.isPanning = true;
            this.state.lastMouse = { x: e.clientX, y: e.clientY };
        };

        window.onmousemove = (e) => {
            if (this.state.isPanning) {
```

Replace with:

```javascript
            if (!isTouch) {
                this.state.isPanning = true;
                this.state.lastMouse = { x: e.clientX, y: e.clientY };
            }
        };

        window.onmousemove = (e) => {
            if (!isTouch && this.state.isPanning) {
```

Touch devices already have their own panning path (the two-finger touch gesture in `main.js`, clamped by Task 5), so disabling the mouse-drag path on touch devices loses nothing — it removes the hazard described above at its source. (Trade-off: a touch-capable laptop with a real mouse would also lose single-finger mouse-drag panning and fall back to two-finger touch panning; this matches the existing `isTouch`-gating convention already used elsewhere in the app.)

- [ ] **Step 4: Add the carousel drag gesture**

In `js/sandbox.js`, find `init`:

```javascript
    init: function() {
        Render.init('tonnetz-svg');
        this.renderPalette();
        this.refreshLattice();
        this.setupEvents();
        this.setupGuide();
```

Add a call to a new setup function:

```javascript
    init: function() {
        Render.init('tonnetz-svg');
        this.renderPalette();
        this.refreshLattice();
        this.setupEvents();
        this.setupGuide();
        this.setupCarouselTouchGestures();
```

Then add the new method (anywhere in the object, e.g. right after `setupGuide`'s closing `},`):

```javascript
    setupCarouselTouchGestures: function() {
        const list = document.getElementById('piece-list');
        if (!list) return;

        let dragKey = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let isPlacingDrag = false;

        list.addEventListener('touchstart', (e) => {
            const item = e.target.closest('.piece-item');
            if (!item) return;
            dragKey = item.getAttribute('data-key');
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            isPlacingDrag = false;
        }, { passive: true });

        list.addEventListener('touchmove', (e) => {
            if (!dragKey) return;
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - dragStartY;

            if (!isPlacingDrag) {
                if (Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx) * 1.5) {
                    isPlacingDrag = true;
                    this.selectPiece(dragKey);
                } else {
                    return; // Predominantly horizontal — let the browser scroll the carousel natively
                }
            }

            e.preventDefault();
            const touch = e.touches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && el.tagName.toLowerCase() === 'polygon') {
                const p = parseInt(el.getAttribute('data-p'));
                const q = parseInt(el.getAttribute('data-q'));
                this.state.hoverCell = { p, q };
                this.updateGhost();
            }
        }, { passive: false });

        list.addEventListener('touchend', () => {
            if (isPlacingDrag && this.state.selectedPiece) {
                const { p, q } = this.state.hoverCell;
                if (this.canPlace(this.state.selectedPiece, p, q, this.state.rotation)) {
                    this.placePiece(p, q);
                }
            }
            dragKey = null;
            isPlacingDrag = false;
        });
    },
```

- [ ] **Step 5: Run the tests again to confirm both pass**

```bash
npx playwright test tests/mobile.spec.js -g "carousel piece"
```

Expected: `2 passed`.

- [ ] **Step 6: Run the full suite to check for regressions**

```bash
node tests/run_tests.js
npx playwright test
```

Expected: 8 unit tests pass, 40 Playwright tests pass.

- [ ] **Step 7: Commit**

```bash
git add js/sandbox.js tests/mobile.spec.js
git commit -m "Fix carousel touch handling: native horizontal scroll + drag-to-place"
```

- [ ] **Step 8: Note the remaining manual-verification item**

Synthetic `TouchEvent` dispatch (used by the tests above) cannot exercise a real browser's native touch-scroll machinery — only genuine OS-level touch input triggers it. The horizontal-scroll half of this fix (`touch-action: pan-x`, already present in `css/style.css`, combined with Step 4 correctly not calling `preventDefault()` on the horizontal branch) should still be confirmed on a real phone or the Chrome DevTools device emulator per `mobile_redesign_plan.md`'s existing "Manual Verification" section — no code action needed here, just flag it when reporting this plan's completion.

---

## Final Verification

After all six tasks:

```bash
node tests/run_tests.js
npx playwright test
```

Expected: 8/8 unit tests pass, 40/40 Playwright tests pass (35 original + 1 from Task 3 + 1 from Task 4 + 1 from Task 5 + 2 from Task 6).

Then do a quick manual pass per `mobile_redesign_plan.md`'s Verification Plan: load the app in Chrome DevTools' Pixel 5 emulation, confirm Sandbox/Blast mode names and hex cell size look right, try panning past the edge (should stop with a little give), and try dragging a carousel piece both sideways (scrolls) and down onto the board (places it).
