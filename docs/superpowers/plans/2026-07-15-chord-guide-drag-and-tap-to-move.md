# Chord Guide Draggable Pieces + Tap-to-Move Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Chord Guide's static "Use" badge with a draggable, correctly-oriented piece preview (plus an X to reset the guide), and fix Sandbox/Blast Mode's touch tap so it moves the candidate to wherever you tapped instead of always rotating it.

**Architecture:** Extend `SandboxMode` (`js/sandbox.js`) with a shared piece-preview renderer and a generalized drag-to-candidate gesture handler reused by both the carousel and the chord-guide results. Add an X reset button next to the chord dropdown. Replace the single always-rotates branch in `main.js`'s shared touch-tap handler with a 3-way classification of the tapped cell (own ghost / an existing placed piece / empty elsewhere).

**Tech Stack:** Vanilla JS, no build step. Tests: `node tests/run_tests.js` (unit) and `npx playwright test` (Desktop Chrome / Mobile Chrome / Tablet Chrome).

## Global Constraints

- Spec source: `mobile_redesign_plan.md`, "Next Round: Chord Guide draggable pieces + tap-to-move candidate" section.
- Tap on the candidate's own ghost cells → rotate (unchanged from today).
- Tap on an existing placed piece → pick it up as the new candidate (Sandbox only; Blast has no pickup, so the tap is ignored there).
- Tap on any other cell → move the candidate's anchor there, no rotation, no sound.
- The chord-guide X button only resets the dropdown/results; it must never touch `SandboxMode.state.selectedPiece`.
- Do not touch the background dev servers on ports 8000/8001 — they're already running and must be left alone. Run Playwright against whichever `baseURL` `playwright.config.js` already points at.
- Follow red-green TDD: write the failing test, confirm it fails, implement, confirm it passes, then commit — no skipping or batching steps.

---

### Task 1: Chord Guide results show a draggable-looking, correctly-oriented piece preview

**Files:**
- Modify: `js/sandbox.js` (`renderPalette`, `updateGuideResults`; add new method `renderPiecePreview`)
- Modify: `css/style.css` (add `.chord-match-preview` rule near the existing `.chord-match-item` rules, ~line 865)
- Test: `tests/desktop.spec.js`

**Interfaces:**
- Produces: `SandboxMode.renderPiecePreview(svgEl, cells, color)` — takes an `<svg>` element, an array of `{p, q}` cells (as returned by `Pieces.getAbsoluteCells`), and a fill color hex string; sets the svg's `viewBox` and appends one hex `<polygon>` per cell via `Render.createHex`. No return value.

- [ ] **Step 1: Write the failing test**

Add to `tests/desktop.spec.js`:

```javascript
test('chord guide results show a piece preview matching the correct rotation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const chordSelect = page.locator('#chord-guide-select');
  await chordSelect.selectOption('major');

  const firstMatch = page.locator('.chord-match-item').first();
  await expect(firstMatch).toBeVisible();

  const preview = firstMatch.locator('.chord-match-preview');
  await expect(preview).toBeAttached();

  const info = await page.evaluate(() => {
    const item = document.querySelector('.chord-match-item');
    const type = item.getAttribute('data-type');
    const rotation = parseInt(item.getAttribute('data-rotation'));
    const expectedCells = Pieces.getAbsoluteCells(type, 0, 0, rotation);
    const renderedHexes = item.querySelectorAll('.chord-match-preview polygon');
    return { expectedCount: expectedCells.length, renderedCount: renderedHexes.length };
  });

  expect(info.renderedCount).toBeGreaterThan(0);
  expect(info.renderedCount).toBe(info.expectedCount);

  // The old static "Use" badge text should be gone
  const badgeText = await firstMatch.locator('span').allTextContents();
  expect(badgeText.join('')).not.toContain('Use');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/desktop.spec.js -g "chord guide results show a piece preview"`
Expected: FAIL — `.chord-match-preview` doesn't exist yet, so `toBeAttached()` fails (or `renderedCount` is 0).

- [ ] **Step 3: Extract the shared preview renderer and use it in both places**

In `js/sandbox.js`, add a new method (place it right after `renderPalette`):

```javascript
    renderPiecePreview: function(svgEl, cells, color) {
        const positions = cells.map(c => Render.getScreenPos(c.p, c.q));
        const minX = Math.min(...positions.map(pos => pos.x));
        const maxX = Math.max(...positions.map(pos => pos.x));
        const minY = Math.min(...positions.map(pos => pos.y));
        const maxY = Math.max(...positions.map(pos => pos.y));

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const padding = 40;
        const size = Math.max(maxX - minX, maxY - minY) + padding * 2;

        svgEl.setAttribute('viewBox', `${centerX - size / 2} ${centerY - size / 2} ${size} ${size}`);

        cells.forEach(c => {
            const hex = Render.createHex(c.p, c.q, {
                fill: color,
                stroke: 'white',
                strokeWidth: 2
            });
            svgEl.appendChild(hex);
        });
    },
```

Replace the body of `renderPalette` (the loop that computes bounds and appends hexes) to call it instead:

```javascript
    renderPalette: function() {
        const list = document.getElementById('piece-list');
        list.innerHTML = '';

        for (const key in Pieces.TYPES) {
            const piece = Pieces.TYPES[key];
            const div = document.createElement('div');
            div.className = 'piece-item';
            div.setAttribute('data-key', key);
            div.innerHTML = `
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;

            div.onclick = () => this.togglePiece(key);
            list.appendChild(div);

            const previewSvg = div.querySelector('.piece-preview');
            this.renderPiecePreview(previewSvg, piece.cells, piece.color);
        }
    },
```

In `updateGuideResults`, replace the "Use" badge `<span>` with a preview `<svg>`:

```javascript
                <span style="font-size: 11px; color: var(--accent); font-weight: bold; border: 1px solid var(--accent); padding: 2px 6px; border-radius: 4px; background: rgba(127, 224, 208, 0.05);">Use</span>
```
becomes:
```javascript
                <svg class="chord-match-preview"></svg>
```

Then, right after `resultsDiv.innerHTML = matches.map(...).join('');`, populate each preview before wiring up `onclick` (replace the existing `resultsDiv.querySelectorAll('.chord-match-item').forEach(...)` block):

```javascript
        resultsDiv.querySelectorAll('.chord-match-item').forEach(item => {
            const type = item.getAttribute('data-type');
            const rotation = parseInt(item.getAttribute('data-rotation'));

            const preview = item.querySelector('.chord-match-preview');
            const cells = Pieces.getAbsoluteCells(type, 0, 0, rotation);
            this.renderPiecePreview(preview, cells, Pieces.TYPES[type].color);

            item.onclick = () => {
                this.selectPiece(type);
                this.state.rotation = rotation;
                this.updateGhost();

                if (typeof App !== 'undefined' && App.collapseMobileDrawer) {
                    App.collapseMobileDrawer();
                }

                item.style.borderColor = 'var(--accent)';
                setTimeout(() => {
                    item.style.borderColor = 'var(--border)';
                }, 300);
            };
        });
```

In `css/style.css`, add right after the `.chord-match-item:active` rule (~line 875):

```css
.chord-match-preview {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    margin-left: 8px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/desktop.spec.js -g "chord guide results show a piece preview"`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node tests/run_tests.js && npx playwright test`
Expected: all tests pass (8/8 unit, previously-47 Playwright tests + 1 new).

- [ ] **Step 6: Commit**

```bash
git add js/sandbox.js css/style.css tests/desktop.spec.js
git commit -m "Show a correctly-oriented piece preview in chord guide results instead of a Use badge"
```

---

### Task 2: Drag a chord-guide result onto the board (drag-to-candidate)

**Files:**
- Modify: `js/sandbox.js` (`init`; replace `setupCarouselTouchGestures` with `setupDragToCandidate`)
- Test: `tests/mobile.spec.js`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `SandboxMode.setupDragToCandidate(containerId, itemSelector, getPieceInfo)` where `getPieceInfo(item)` returns `{ key, rotation }`. Called twice from `init()`, replacing the old `setupCarouselTouchGestures()` call.

- [ ] **Step 1: Write the failing test**

Add to `tests/mobile.spec.js`, in section D (near the existing "dragging a carousel piece onto the board..." test, ~line 328):

```javascript
  test('dragging a chord-guide result onto the board shows a candidate at that result\'s specific rotation', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(dispatchAtHelpers);

    const chordSelect = page.locator('#chord-guide-select');
    await chordSelect.selectOption('major');
    await expect(page.locator('.chord-match-item').first()).toBeVisible();

    // Prefer a match with a non-zero rotation so the test actually exercises rotation plumbing;
    // fall back to the first match if every one happens to be rotation 0.
    const matchIndex = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.chord-match-item'));
      const idx = items.findIndex(i => parseInt(i.getAttribute('data-rotation')) !== 0);
      return idx === -1 ? 0 : idx;
    });
    const match = page.locator('.chord-match-item').nth(matchIndex);
    const expected = await match.evaluate(el => ({
      type: el.getAttribute('data-type'),
      rotation: parseInt(el.getAttribute('data-rotation')),
    }));

    const matchBox = await match.boundingBox();
    const startX = matchBox.x + matchBox.width / 2;
    const startY = matchBox.y + matchBox.height / 2;

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    const cellBox = await cell.boundingBox();
    const endX = cellBox.x + cellBox.width / 2;
    const endY = cellBox.y + cellBox.height / 2;

    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchstart', x, y), { x: startX, y: startY });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: startX, y: startY + 40 });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: endX, y: endY });
    await page.waitForTimeout(50);
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchend', x, y), { x: endX, y: endY });

    // Left as a candidate, not placed, with the row's specific rotation
    const placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
    const actual = await page.evaluate(() => ({
      type: SandboxMode.state.selectedPiece,
      rotation: SandboxMode.state.rotation,
    }));
    expect(actual.type).toBe(expected.type);
    expect(actual.rotation).toBe(expected.rotation);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/mobile.spec.js -g "dragging a chord-guide result"`
Expected: FAIL — dragging a `.chord-match-item` does nothing today (no touch listeners on `#chord-guide-results`), so `selectedPiece` stays `null`.

- [ ] **Step 3: Generalize the drag gesture and wire it up for both containers**

In `js/sandbox.js`, replace the entire `setupCarouselTouchGestures` method with:

```javascript
    setupDragToCandidate: function(containerId, itemSelector, getPieceInfo) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let dragInfo = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let isPlacingDrag = false;

        container.addEventListener('touchstart', (e) => {
            const item = e.target.closest(itemSelector);
            if (!item) return;
            dragInfo = getPieceInfo(item);
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            isPlacingDrag = false;
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!dragInfo) return;
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - dragStartY;

            if (!isPlacingDrag) {
                if (Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx) * 1.5) {
                    isPlacingDrag = true;
                    this.state.selectedPiece = dragInfo.key;
                    this.state.rotation = dragInfo.rotation;
                    this.updatePaletteHighlight();
                } else {
                    return; // Predominantly horizontal — let the browser scroll the list natively
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

        container.addEventListener('touchend', () => {
            // Releasing over the board leaves the piece as a selected candidate at the last
            // hovered cell (same state as tapping it in the palette) — the normal board
            // gestures (tap to rotate, swipe down to place) take over from here.
            dragInfo = null;
            isPlacingDrag = false;
        });
    },
```

In `init()`, replace `this.setupCarouselTouchGestures();` with:

```javascript
        this.setupDragToCandidate('piece-list', '.piece-item', item => ({
            key: item.getAttribute('data-key'),
            rotation: 0
        }));
        this.setupDragToCandidate('chord-guide-results', '.chord-match-item', item => ({
            key: item.getAttribute('data-type'),
            rotation: parseInt(item.getAttribute('data-rotation'))
        }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/mobile.spec.js -g "dragging a chord-guide result"`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node tests/run_tests.js && npx playwright test`
Expected: all pass — in particular, re-run the pre-existing carousel drag tests (`-g "dragging a carousel piece"`) to confirm the generalization didn't change carousel behavior.

- [ ] **Step 6: Commit**

```bash
git add js/sandbox.js tests/mobile.spec.js
git commit -m "Generalize carousel drag-to-candidate so chord-guide results support it too"
```

---

### Task 3: X button resets the Chord Guide

**Files:**
- Modify: `index.html` (wrap the chord `<select>` and add a reset `<button>`, ~lines 138-164)
- Modify: `js/sandbox.js` (`setupGuide`)
- Modify: `css/style.css` (the mobile `#sandbox-mobile-tools #chord-guide-select` rule, ~line 536)
- Test: `tests/desktop.spec.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `#chord-guide-reset` button in the DOM, wired up in `SandboxMode.setupGuide()`.

- [ ] **Step 1: Write the failing test**

Add to `tests/desktop.spec.js`:

```javascript
test('chord guide X button resets the dropdown without touching a selected candidate', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const resetBtn = page.locator('#chord-guide-reset');
  await expect(resetBtn).toBeHidden();

  const chordSelect = page.locator('#chord-guide-select');
  await chordSelect.selectOption('major');
  await expect(resetBtn).toBeVisible();

  await page.locator('.chord-match-item').first().click();
  const selectedBefore = await page.evaluate(() => SandboxMode.state.selectedPiece);
  expect(selectedBefore).not.toBeNull();

  await resetBtn.click();

  await expect(resetBtn).toBeHidden();
  expect(await chordSelect.inputValue()).toBe('');
  const resultsText = await page.locator('#chord-guide-results').innerText();
  expect(resultsText.trim()).toBe('');

  const selectedAfter = await page.evaluate(() => SandboxMode.state.selectedPiece);
  expect(selectedAfter).toBe(selectedBefore);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/desktop.spec.js -g "chord guide X button"`
Expected: FAIL — `#chord-guide-reset` doesn't exist, `toBeHidden()`/`toBeVisible()` fail.

- [ ] **Step 3: Add the button and wire it up**

In `index.html`, replace (~lines 138-164):

```html
                    <div class="control-group">
                        <select id="chord-guide-select" style="width: 100%; padding: 6px; background: #1c202a; border: 1px solid var(--border); color: #fff; border-radius: 4px; font-family: monospace; font-size: 13px;">
```

with:

```html
                    <div class="control-group" style="display: flex; gap: 6px; align-items: center;">
                        <select id="chord-guide-select" style="flex: 1; min-width: 0; padding: 6px; background: #1c202a; border: 1px solid var(--border); color: #fff; border-radius: 4px; font-family: monospace; font-size: 13px;">
```

...leave every `<option>`/`<optgroup>` inside unchanged...

and change the select's closing:

```html
                        </select>
                    </div>
```

to:

```html
                        </select>
                        <button id="chord-guide-reset" type="button" title="Clear chord guide" aria-label="Clear chord guide" style="display: none; flex-shrink: 0; width: 28px; height: 28px; padding: 0; border-radius: 4px; border: 1px solid var(--border); background: #1c202a; color: var(--dim); cursor: pointer; font-size: 14px; line-height: 1;">✕</button>
                    </div>
```

In `js/sandbox.js`, replace `setupGuide`:

```javascript
    setupGuide: function() {
        const select = document.getElementById('chord-guide-select');
        if (!select) return;
        select.onchange = () => {
            this.updateGuideResults(select.value);
        };
    },
```

with:

```javascript
    setupGuide: function() {
        const select = document.getElementById('chord-guide-select');
        const resetBtn = document.getElementById('chord-guide-reset');
        if (!select) return;

        select.onchange = () => {
            this.updateGuideResults(select.value);
            if (resetBtn) resetBtn.style.display = select.value ? 'inline-block' : 'none';
        };

        if (resetBtn) {
            resetBtn.onclick = () => {
                select.value = '';
                this.updateGuideResults('');
                resetBtn.style.display = 'none';
            };
        }
    },
```

In `css/style.css`, change the mobile rule (~line 536-546) from:

```css
    #sandbox-mobile-tools #chord-guide-select {
        width: 100%;
```

to:

```css
    #sandbox-mobile-tools #chord-guide-select {
        flex: 1;
        min-width: 0;
```

(leave the rest of that rule's declarations as-is).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/desktop.spec.js -g "chord guide X button"`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node tests/run_tests.js && npx playwright test`
Expected: all pass, including the existing "chord dropdown is visible on mobile" and "selecting a chord type shows matching results" tests (confirms the flex-wrapping didn't break dropdown layout/visibility on mobile).

- [ ] **Step 6: Commit**

```bash
git add index.html js/sandbox.js css/style.css tests/desktop.spec.js
git commit -m "Add an X button to reset the chord guide dropdown and results"
```

---

### Task 4: Tapping elsewhere moves the candidate instead of always rotating it

**Files:**
- Modify: `js/main.js` (`setupTouchGestures`'s `touchend` listener, `isTap` branch, ~lines 696-712)
- Test: `tests/mobile.spec.js`

**Interfaces:**
- Consumes: `SandboxMode.pickupPieceAt(p, q)` (existing), `Board.isCellEmpty(p, q)` (existing), `Pieces.getAbsoluteCells(type, p, q, rotation)` (existing).
- Produces: no new public interface — behavior change only, inside the existing shared `touchend` handler.

- [ ] **Step 1: Write the failing tests**

Add to `tests/mobile.spec.js`, in section D, right after the existing "tap with selected piece rotates it (does not place)" test (~line 423):

```javascript
  test('tap on an empty cell elsewhere moves the candidate there instead of rotating', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(touchHelpers);

    await page.locator('.piece-item').first().click({ force: true });
    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: 0, q: 0 };
      SandboxMode.updateGhost();
    });

    const rotBefore = await page.evaluate(() => SandboxMode.state.rotation);

    const targetCell = page.locator('polygon.cell:not(.ghost)[data-p="4"][data-q="4"]');
    const box = await targetCell.boundingBox();
    if (!box) return; // off-screen at this viewport, skip

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy });

    const rotAfter = await page.evaluate(() => SandboxMode.state.rotation);
    expect(rotAfter).toBe(rotBefore);

    const hoverAfter = await page.evaluate(() => SandboxMode.state.hoverCell);
    expect(hoverAfter).toEqual({ p: 4, q: 4 });

    const placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
  });

  test('tap on an existing placed piece picks it up as the new candidate (Sandbox)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(touchHelpers);

    await page.locator('.piece-item').first().click({ force: true });
    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: 0, q: 0 };
      SandboxMode.placePiece(0, 0);
    });
    let placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBeGreaterThan(0);

    // Select a second candidate, positioned well away from the placed piece
    await page.locator('.piece-item').nth(1).click({ force: true });
    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: 5, q: 5 };
      SandboxMode.updateGhost();
    });
    const secondType = await page.evaluate(() => SandboxMode.state.selectedPiece);

    const placedCell = page.locator('polygon.placed-piece[data-p="0"][data-q="0"]').first();
    const box = await placedCell.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy });

    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);

    const selectedAfter = await page.evaluate(() => SandboxMode.state.selectedPiece);
    expect(selectedAfter).not.toBe(secondType);
  });

  test('tap on a locked cell in Blast Mode is ignored (no pickup, no rotation)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
    await page.evaluate(touchHelpers);

    await page.evaluate(() => {
      BlastMode.state.hoverCell = { p: 0, q: 0 };
      BlastMode.placePiece(0, 0);
    });
    let placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBeGreaterThan(0);

    // Move the new active piece's ghost away so the locked cell isn't part of it
    await page.evaluate(() => {
      BlastMode.state.hoverCell = { p: 5, q: 5 };
      BlastMode.updateGhost();
    });
    const rotBefore = await page.evaluate(() => BlastMode.state.rotation);
    const activeBefore = await page.evaluate(() => BlastMode.state.activePiece);

    const lockedCell = page.locator('polygon.placed-piece[data-p="0"][data-q="0"]').first();
    const box = await lockedCell.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy });

    const rotAfter = await page.evaluate(() => BlastMode.state.rotation);
    const activeAfter = await page.evaluate(() => BlastMode.state.activePiece);
    expect(rotAfter).toBe(rotBefore);
    expect(activeAfter).toBe(activeBefore);

    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/mobile.spec.js -g "tap on an empty cell elsewhere|tap on an existing placed piece|tap on a locked cell"`
Expected: FAIL on all three — today, any tap while a piece is active always rotates, so:
- Test 1: `rotAfter` differs from `rotBefore` (it rotated instead of moving) and `hoverAfter` stays `{p:0,q:0}`.
- Test 2: the placed piece is never picked up (`placedCount` stays `> 0` after the tap instead of hitting `0`) since the shared handler doesn't know about pickup at all.
- Test 3: this one may already incidentally pass since rotating a different active piece still leaves `activeAfter === activeBefore` — that's fine, Step 4 confirms all three are correct after the real fix regardless.

- [ ] **Step 3: Implement the 3-way tap classification**

In `js/main.js`, replace the `isTap` branch inside the `touchend` listener (~lines 696-713):

```javascript
                } else if (isTap) {
                    if (pieceType) {
                        // Tap to rotate clockwise
                        modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                        modeObj.updateGhost();
                        
                        // Sound confirmation of rotation
                        const cells = Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation);
                        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
                        Synth.playChord(midis, true, 0.08, 0.4);
                    } else {
                        // Tap note keyboard behavior when no active piece is selected
                        if (touchStartCell) {
                            const midi = Tonnetz.getMidi(touchStartCell.p, touchStartCell.q);
                            Synth.playNote(midi);
                        }
                    }
                }
```

with:

```javascript
                } else if (isTap) {
                    if (pieceType) {
                        const tapCell = touchStartCell;
                        const ghostCells = tapCell
                            ? Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation)
                            : [];
                        const tappedGhost = tapCell && ghostCells.some(c => c.p === tapCell.p && c.q === tapCell.q);

                        if (!tapCell || tappedGhost) {
                            // Tap on the candidate itself (or couldn't resolve a cell) -> rotate clockwise
                            modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                            modeObj.updateGhost();

                            // Sound confirmation of rotation
                            const cells = Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation);
                            const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
                            Synth.playChord(midis, true, 0.08, 0.4);
                        } else if (this.currentMode === 'sandbox' && SandboxMode.state.placedPieces.some(piece => {
                            const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
                            return cells.some(c => c.p === tapCell.p && c.q === tapCell.q);
                        })) {
                            // Tap on an already-placed piece -> pick it up as the new candidate
                            modeObj.state.hoverCell = tapCell;
                            SandboxMode.pickupPieceAt(tapCell.p, tapCell.q);
                        } else if (this.currentMode === 'blast' && !Board.isCellEmpty(tapCell.p, tapCell.q)) {
                            // Blast has no pickup — ignore taps on locked cells
                        } else {
                            // Tap elsewhere on an empty cell -> move the candidate here instead of rotating
                            modeObj.state.hoverCell = tapCell;
                            modeObj.updateGhost();
                        }
                    } else {
                        // Tap note keyboard behavior when no active piece is selected
                        if (touchStartCell) {
                            const midi = Tonnetz.getMidi(touchStartCell.p, touchStartCell.q);
                            Synth.playNote(midi);
                        }
                    }
                }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test tests/mobile.spec.js -g "tap on an empty cell elsewhere|tap on an existing placed piece|tap on a locked cell"`
Expected: PASS on all three.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `node tests/run_tests.js && npx playwright test`
Expected: all pass — in particular `-g "tap with selected piece rotates it"` and `-g "dragging a carousel piece onto the board"` (both tap on the ghost's own cell, so they must still rotate, not move).

- [ ] **Step 6: Commit**

```bash
git add js/main.js tests/mobile.spec.js
git commit -m "Tap elsewhere moves the candidate instead of always rotating it"
```

---

### Task 5: Update status doc and final full-suite verification

**Files:**
- Modify: `mobile_redesign_plan.md` (Status section)

- [ ] **Step 1: Run the complete test suite one more time**

Run: `node tests/run_tests.js && npx playwright test`
Expected: all pass (8/8 unit; 47 + 4 new Playwright tests = 51).

- [ ] **Step 2: Update the Status section**

In `mobile_redesign_plan.md`, update the "Status as of 2026-07-15" section's test counts and fold the "Next Round: Chord Guide draggable pieces + tap-to-move candidate" heading into a completed-item bullet (mirroring how the previous round was folded in), referencing this plan file (`docs/superpowers/plans/2026-07-15-chord-guide-drag-and-tap-to-move.md`) for history. Remove the now-completed "Next Round" section body since its content is now shipped (same pattern used for the previous round).

- [ ] **Step 3: Commit**

```bash
git add mobile_redesign_plan.md
git commit -m "Mark chord-guide drag/tap-to-move round as done in mobile_redesign_plan.md"
```
