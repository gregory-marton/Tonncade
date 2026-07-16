const { test, expect } = require('@playwright/test');

/**
 * BEHAVIORAL TESTING STRATEGY
 * 
 * Every test verifies what the user SEES or what HAPPENS when they interact.
 * No test merely checks that a DOM element "exists" — each verifies:
 * - Visible content (text, bounding boxes, pixel counts)
 * - Interaction outcomes (piece counts change, rotation state changes)
 * - Absence of bad states (no off-screen elements, no accidental placements)
 */

test.describe('Mobile Viewport and Layout Tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ────────────────────────────────────────────────────────────────────────
  // A. Visual Smoke Tests — what you SEE on load
  // ────────────────────────────────────────────────────────────────────────

  test('hexagons and note names are visible on screen', async ({ page }) => {
    // The Tonnetz grid should contain visible polygon hexagons
    const hexagons = page.locator('polygon.cell');
    const count = await hexagons.count();
    expect(count).toBeGreaterThan(20); // Should have many hexagons rendered

    // At least one hexagon should be on-screen with a real bounding box
    const firstHex = hexagons.first();
    const hexBox = await firstHex.boundingBox();
    expect(hexBox).not.toBeNull();
    expect(hexBox.width).toBeGreaterThan(5);
    expect(hexBox.height).toBeGreaterThan(5);

    // Note labels (C, D, E, F#, etc.) should be visible as text elements
    const noteLabels = page.locator('.note-label');
    const labelCount = await noteLabels.count();
    expect(labelCount).toBeGreaterThan(10); // Many note labels should exist

    // Verify actual note name content is present (not just empty elements)
    const firstLabel = noteLabels.first();
    const labelText = await firstLabel.textContent();
    expect(labelText.trim().length).toBeGreaterThan(0); // Has actual text like "C" or "F#"
  });

  test('tonnetz SVG fills most of the screen height on mobile', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    const svg = page.locator('#tonnetz-svg');
    const svgBox = await svg.boundingBox();
    expect(svgBox).not.toBeNull();
    // The tonnetz should take up at least 40% of screen height
    expect(svgBox.height).toBeGreaterThan(page.viewportSize().height * 0.4);
    // And should be fully within the viewport
    expect(svgBox.y + svgBox.height).toBeLessThanOrEqual(page.viewportSize().height + 5);
  });

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

  test('piece carousel is visible with piece names in Sandbox mode on phone', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    // Piece items should be visible
    const pieceItems = page.locator('.piece-item');
    const count = await pieceItems.count();
    expect(count).toBeGreaterThan(3); // Multiple pieces available

    // First piece should have a visible bounding box on screen
    const firstPiece = pieceItems.first();
    const pieceBox = await firstPiece.boundingBox();
    expect(pieceBox).not.toBeNull();
    expect(pieceBox.y).toBeLessThan(page.viewportSize().height); // On screen

    // Piece should contain an SVG preview (not empty)
    const preview = firstPiece.locator('.piece-preview');
    await expect(preview).toBeAttached();
  });

  // ────────────────────────────────────────────────────────────────────────
  // B. Chord Guide Accessibility
  // ────────────────────────────────────────────────────────────────────────

  test('chord dropdown is visible on mobile WITHOUT opening the drawer in Sandbox mode', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    // The chord guide dropdown should be visible without touching the drawer
    const chordSelect = page.locator('#chord-guide-select');
    await expect(chordSelect).toBeVisible();

    // It should be within the viewport (not hidden behind a collapsed drawer)
    const selectBox = await chordSelect.boundingBox();
    expect(selectBox).not.toBeNull();
    expect(selectBox.y).toBeLessThan(page.viewportSize().height);
    expect(selectBox.y).toBeGreaterThan(0);

    // The drawer should still be collapsed (dropdown is OUTSIDE it)
    const drawer = page.locator('#top-drawer');
    await expect(drawer).not.toHaveClass(/expanded/);
  });

  test('selecting a chord type shows matching results', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const chordSelect = page.locator('#chord-guide-select');
    await chordSelect.selectOption('major');

    // Results should appear with chord match items
    const results = page.locator('.chord-match-item');
    await expect(results.first()).toBeVisible({ timeout: 3000 });
    const resultCount = await results.count();
    expect(resultCount).toBeGreaterThan(0);
  });

  test('chord dropdown is NOT visible in non-Sandbox modes', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    // Switch to Melody mode
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
    
    // The sandbox-mobile-tools area should be hidden
    const sandboxTools = page.locator('#sandbox-mobile-tools');
    await expect(sandboxTools).toBeHidden();
  });

  // ────────────────────────────────────────────────────────────────────────
  // C. Carousel Scrollability
  // ────────────────────────────────────────────────────────────────────────

  test('piece carousel extends beyond viewport and last item can be scrolled into view', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const pieceList = page.locator('#piece-list');
    const pieceItems = page.locator('.piece-item');
    const totalPieces = await pieceItems.count();
    expect(totalPieces).toBeGreaterThan(3);

    // The piece-list should be wider than the viewport (requires scrolling)
    const listWidth = await pieceList.evaluate(el => el.scrollWidth);
    expect(listWidth).toBeGreaterThan(width);

    // The last piece should be scrollable into view
    const lastPiece = pieceItems.last();
    await lastPiece.scrollIntoViewIfNeeded();
    await expect(lastPiece).toBeInViewport();
  });

  test('carousel piece icons allow native touch scrolling (not touch-action: none)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const touchActions = await page.evaluate(() => {
      const preview = document.querySelector('.piece-item .piece-preview');
      const board = document.getElementById('tonnetz-svg');
      return {
        preview: getComputedStyle(preview).touchAction,
        board: getComputedStyle(board).touchAction,
      };
    });

    // A touch's effective touch-action is the intersection across the touched element and its
    // ancestors, so a "none" on the piece icon (which covers most of each carousel item) blocks
    // native pan-x scrolling on #palette regardless of the ancestor's own touch-action.
    expect(touchActions.preview).not.toBe('none');
    // The interactive board itself should still block native browser gestures.
    expect(touchActions.board).toBe('none');
  });

  test('#palette actually clips its overflow instead of ballooning past the viewport', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const widths = await page.evaluate(() => {
      const palette = document.getElementById('palette');
      const tools = document.getElementById('sandbox-mobile-tools');
      return {
        paletteClientWidth: palette.clientWidth,
        paletteScrollWidth: palette.scrollWidth,
        toolsClientWidth: tools.clientWidth,
      };
    });

    // If #sandbox-mobile-tools (a flex row-item) isn't constrained to the viewport, it and
    // #palette balloon to the carousel's full content width instead of clipping/scrolling it —
    // the rest of the pieces become permanently unreachable, with no scroll affordance anywhere.
    expect(widths.toolsClientWidth).toBeLessThanOrEqual(width + 1);
    expect(widths.paletteClientWidth).toBeLessThan(widths.paletteScrollWidth);
  });

  // ────────────────────────────────────────────────────────────────────────
  // D. Touch Gesture Semantics — the core behavioral tests
  // ────────────────────────────────────────────────────────────────────────

  // Helper: dispatch touch events programmatically
  const touchHelpers = `
    window.__dispatchTouch = function(type, x, y) {
      const el = document.getElementById('tonnetz-svg');
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
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

  // Helper: dispatch touch events, capturing the touchstart's target and reusing it for the
  // rest of the gesture (matching real touch-event "implicit capture" semantics) instead of
  // re-resolving elementFromPoint on every move, which would break once the finger moves off
  // its starting element (e.g. from the carousel onto the board).
  const dispatchAtHelpers = `
    window.__dispatchTouchAt = function(type, x, y) {
      if (type === 'touchstart') {
        window.__touchAtTarget = document.elementFromPoint(x, y) || document.body;
      }
      const el = window.__touchAtTarget || document.body;
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

  test('dragging a carousel piece onto the board shows a candidate placement, still tappable/rotatable, and only places on swipe down', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(dispatchAtHelpers);
    await page.evaluate(touchHelpers);

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

    // Drag from the carousel onto the board
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchstart', x, y), { x: startX, y: startY });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: startX, y: startY + 40 });
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchmove', x, y), { x: endX, y: endY });
    await page.waitForTimeout(50);
    await page.evaluate(({ x, y }) => window.__dispatchTouchAt('touchend', x, y), { x: endX, y: endY });

    // Releasing over the board should leave a candidate (selected + ghosted), not place it
    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
    const selectedPiece = await page.evaluate(() => SandboxMode.state.selectedPiece);
    expect(selectedPiece).not.toBeNull();

    // A tap on the candidate should still rotate it, not place it
    const rotBefore = await page.evaluate(() => SandboxMode.state.rotation);
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: endX, y: endY });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: endX, y: endY });
    const rotAfter = await page.evaluate(() => SandboxMode.state.rotation);
    expect(rotAfter).toBe((rotBefore + 1) % 6);
    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);

    // A swipe down should place it, same as any other candidate
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: endX, y: endY });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchmove', x, y), { x: endX, y: endY + 70 });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: endX, y: endY + 70 });
    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBeGreaterThan(0);
  });

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

  test('drag repositions ghost WITHOUT placing or picking up', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(touchHelpers);

    // Select a piece
    const pieceItem = page.locator('.piece-item').first();
    await pieceItem.click({ force: true });

    // Verify no pieces placed initially
    let placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);

    // Find a cell to start from
    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    await expect(cell).toBeVisible();
    const box = await cell.boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Drag: touchstart, touchmove sideways, then touchend (NOT a vertical swipe)
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: startX, y: startY });
    // Move slowly (>10px to count as drag, but horizontal so not a vertical swipe)
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchmove', x, y), { x: startX + 40, y: startY + 10 });
    await page.waitForTimeout(50);
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: startX + 40, y: startY + 10 });

    // After drag, NO piece should be placed — ghost just moved
    placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
  });

  test('tap with selected piece rotates it (does not place)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(touchHelpers);

    // Select a piece
    await page.locator('.piece-item').first().click({ force: true });

    // Get initial rotation
    const rotBefore = await page.evaluate(() => SandboxMode.state.rotation);

    // Find a cell
    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    const box = await cell.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Quick tap: touchstart + immediate touchend at same position
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy });

    // Rotation should have changed
    const rotAfter = await page.evaluate(() => SandboxMode.state.rotation);
    expect(rotAfter).toBe((rotBefore + 1) % 6);

    // And NO piece should be placed
    const placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
  });

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

    // Find an on-screen, non-ghost cell to tap — coordinates must actually be within the
    // viewport for elementFromPoint (and thus getCellFromTouch) to resolve anything at all.
    // Find an on-screen, non-ghost, non-occluded cell to tap: getBoundingClientRect() alone
    // isn't enough since hex axial coordinates can "wrap" into on-screen pixels for cells far
    // outside the actually-rendered board area, and other page chrome (e.g. the carousel) can
    // occlude that pixel — elementFromPoint at the candidate's own center is the real test.
    const target = await page.evaluate(() => {
      const ghostCells = Pieces.getAbsoluteCells(SandboxMode.state.selectedPiece, 0, 0, SandboxMode.state.rotation);
      const cells = Array.from(document.querySelectorAll('#tonnetz-svg polygon.cell:not(.ghost)'));
      for (const el of cells) {
        const p = parseInt(el.getAttribute('data-p'));
        const q = parseInt(el.getAttribute('data-q'));
        if (ghostCells.some(c => c.p === p && c.q === q)) continue;
        const r = el.getBoundingClientRect();
        if (r.left < 0 || r.right > window.innerWidth || r.top < 0 || r.bottom > window.innerHeight) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el) {
          return { p, q, cx, cy };
        }
      }
      return null;
    });
    expect(target).not.toBeNull();
    const targetPQ = { p: target.p, q: target.q };
    const cx = target.cx;
    const cy = target.cy;

    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy });

    const rotAfter = await page.evaluate(() => SandboxMode.state.rotation);
    expect(rotAfter).toBe(rotBefore);

    const hoverAfter = await page.evaluate(() => SandboxMode.state.hoverCell);
    expect(hoverAfter).toEqual(targetPQ);

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

  test('swipe DOWN places a piece, swipe UP picks it back up', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(touchHelpers);

    // Select a piece
    await page.locator('.piece-item').first().click({ force: true });

    // Position the ghost by setting hoverCell directly
    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: 0, q: 0 };
      SandboxMode.updateGhost();
    });

    // Find cell coordinates on screen
    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    const box = await cell.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // SWIPE DOWN to place: fast vertical flick downward (> 50px in < 400ms)
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchmove', x, y), { x: cx, y: cy + 70 });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy + 70 });

    // Piece should now be placed
    const placedAfterDown = await page.locator('.placed-piece').count();
    expect(placedAfterDown).toBeGreaterThan(0);

    // SWIPE UP to pick up: fast vertical flick upward
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy + 10 });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchmove', x, y), { x: cx, y: cy - 60 });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy - 60 });

    // Piece should be picked back up (no placed pieces remaining)
    const placedAfterUp = await page.locator('.placed-piece').count();
    expect(placedAfterUp).toBe(0);
  });

  test('swipe UP over empty space does NOT accidentally place a piece', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(touchHelpers);

    // Select a piece
    await page.locator('.piece-item').first().click({ force: true });

    // Position ghost at an empty location
    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: 3, q: 3 };
      SandboxMode.updateGhost();
    });

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="3"][data-q="3"]');
    const box = await cell.boundingBox();
    if (!box) return; // Cell might be off-screen, skip test

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Swipe UP over empty space
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchstart', x, y), { x: cx, y: cy });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchmove', x, y), { x: cx, y: cy - 70 });
    await page.evaluate(({ x, y }) => window.__dispatchTouch('touchend', x, y), { x: cx, y: cy - 70 });

    // NOTHING should happen — no piece placed
    const placedCount = await page.locator('.placed-piece').count();
    expect(placedCount).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F. Blast Mode Mobile Layout
  // ────────────────────────────────────────────────────────────────────────

  test('blast board is centered within its viewBox on mobile', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

    const result = await page.evaluate(() => {
      const cells = [];
      for (let p = -Board.radius; p <= Board.radius; p++) {
        for (let q = -Board.radius; q <= Board.radius; q++) {
          if (Board.isInBounds(p, q)) cells.push({ p, q });
        }
      }
      const positions = cells.map(c => Render.getScreenPos(c.p, c.q));
      const boardCenterX = (Math.min(...positions.map(pos => pos.x)) + Math.max(...positions.map(pos => pos.x))) / 2;
      const boardCenterY = (Math.min(...positions.map(pos => pos.y)) + Math.max(...positions.map(pos => pos.y))) / 2;

      const viewBoxCenterX = Render.viewX + (800 * Render.zoom) / 2;
      const viewBoxCenterY = Render.viewY + (600 * Render.zoom) / 2;

      return { boardCenterX, boardCenterY, viewBoxCenterX, viewBoxCenterY };
    });

    expect(result.viewBoxCenterX).toBeCloseTo(result.boardCenterX, 0);
    expect(result.viewBoxCenterY).toBeCloseTo(result.boardCenterY, 0);
  });

  test('every playable Blast board cell is visible on screen (none clipped by an undersized viewBox)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

    const svgBox = await page.locator('#tonnetz-svg').boundingBox();

    const result = await page.evaluate((containerRect) => {
      const cells = [];
      for (let p = -Board.radius; p <= Board.radius; p++) {
        for (let q = -Board.radius; q <= Board.radius; q++) {
          if (Board.isInBounds(p, q)) cells.push({ p, q });
        }
      }
      let visible = 0;
      cells.forEach(({ p, q }) => {
        const el = document.querySelector(`#tonnetz-svg polygon.cell[data-p="${p}"][data-q="${q}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const inView = cx >= containerRect.x && cx <= containerRect.x + containerRect.width &&
          cy >= containerRect.y && cy <= containerRect.y + containerRect.height;
        if (inView) visible++;
      });
      return { total: cells.length, visible };
    }, svgBox);

    expect(result.total).toBeGreaterThan(0);
    expect(result.visible).toBe(result.total);
  });

  const gravityCupCells = () => {
    const cells = [];
    for (let q = 0; q < 20; q++) {
      for (let p = -20; p <= 10; p++) {
        const col = p + Math.floor(q / 2);
        if (col < -5 || col > 4) continue;
        cells.push({ p, q });
      }
    }
    return cells;
  };

  test('gravity board is centered within its viewBox on mobile', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const result = await page.evaluate((cells) => {
      const positions = cells.map(c => Render.getScreenPos(c.p, c.q));
      const boardCenterX = (Math.min(...positions.map(pos => pos.x)) + Math.max(...positions.map(pos => pos.x))) / 2;
      const boardCenterY = (Math.min(...positions.map(pos => pos.y)) + Math.max(...positions.map(pos => pos.y))) / 2;

      const viewBoxCenterX = Render.viewX + (800 * Render.zoom) / 2;
      const viewBoxCenterY = Render.viewY + (600 * Render.zoom) / 2;

      return { boardCenterX, boardCenterY, viewBoxCenterX, viewBoxCenterY };
    }, gravityCupCells());

    expect(result.viewBoxCenterX).toBeCloseTo(result.boardCenterX, 0);
    expect(result.viewBoxCenterY).toBeCloseTo(result.boardCenterY, 0);
  });

  test('every playable Gravity cup cell is visible on screen (none clipped by an undersized viewBox)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const svgBox = await page.locator('#tonnetz-svg').boundingBox();

    const result = await page.evaluate(({ cells, containerRect }) => {
      let visible = 0;
      cells.forEach(({ p, q }) => {
        const el = document.querySelector(`#tonnetz-svg polygon.cell[data-p="${p}"][data-q="${q}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const inView = cx >= containerRect.x && cx <= containerRect.x + containerRect.width &&
          cy >= containerRect.y && cy <= containerRect.y + containerRect.height;
        if (inView) visible++;
      });
      return { total: cells.length, visible };
    }, { cells: gravityCupCells(), containerRect: svgBox });

    expect(result.total).toBeGreaterThan(0);
    expect(result.visible).toBe(result.total);
  });

  test('gravity board zoom is fit to the cup, not a fixed value unrelated to its size', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const result = await page.evaluate((cells) => {
      const fit = Render.getFitView(cells, Render.HEX_R * 2);
      return { actualZoom: Render.zoom, fitZoom: fit.zoom };
    }, gravityCupCells());

    expect(result.actualZoom).toBeCloseTo(result.fitZoom, 1);
  });

  test('switching Sandbox -> Gravity -> Sandbox on mobile leaves the piece palette visible in both', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(page.locator('.piece-item').first()).toBeVisible();

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
    // Gravity's next-piece queue reuses #piece-list too — it should now be visible, not stuck
    // inside the (now-hidden) Sandbox carousel container.
    const paletteBox = await page.locator('#palette').boundingBox();
    expect(paletteBox).not.toBeNull();
    expect(paletteBox.width).toBeGreaterThan(0);
    expect(paletteBox.height).toBeGreaterThan(0);
    const pieceListChildCount = await page.evaluate(() => document.getElementById('piece-list').children.length);
    expect(pieceListChildCount).toBeGreaterThan(0);

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(page.locator('.piece-item').first()).toBeVisible();
  });

  test('switching Sandbox -> Blast -> Sandbox on mobile leaves the piece palette visible in both', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(page.locator('.piece-item').first()).toBeVisible();

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
    // Blast's next-piece queue reuses #piece-list too — it should now be visible, not stuck
    // inside the (now-hidden) Sandbox carousel container. getComputedStyle(el).display only
    // reflects the element's own rule, not an ancestor's display:none, so check actual
    // rendered size instead.
    const paletteBox = await page.locator('#palette').boundingBox();
    expect(paletteBox).not.toBeNull();
    expect(paletteBox.width).toBeGreaterThan(0);
    expect(paletteBox.height).toBeGreaterThan(0);
    const pieceListChildCount = await page.evaluate(() => document.getElementById('piece-list').children.length);
    expect(pieceListChildCount).toBeGreaterThan(0);

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(page.locator('.piece-item').first()).toBeVisible();
  });

  test('blast-stats and the next-piece queue are positioned within the visible game area, not behind the header', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

    const headerBottom = await page.evaluate(() => document.getElementById('top-header').getBoundingClientRect().bottom);

    const statsBox = await page.locator('#blast-stats').boundingBox();
    expect(statsBox).not.toBeNull();
    expect(statsBox.y).toBeGreaterThanOrEqual(headerBottom - 5);

    const queueBox = await page.locator('#palette').boundingBox();
    expect(queueBox).not.toBeNull();
    expect(queueBox.y).toBeGreaterThanOrEqual(headerBottom - 5);
  });

  test('blast next-piece queue reorients vertically under the score, active item at bottom-left, in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

    const mainContentBox = await page.locator('#main-content').boundingBox();
    const statsBox = await page.locator('#blast-stats').boundingBox();
    const activeItemBox = await page.locator('.active-item').boundingBox();
    const nextItemBox = await page.locator('.next-item').first().boundingBox();
    const secondNextItemBox = await page.locator('.next-item').nth(1).boundingBox();

    // Active item (the place button) sits near the bottom-left of the game area
    expect(activeItemBox.x - mainContentBox.x).toBeLessThan(100);
    expect(mainContentBox.y + mainContentBox.height - (activeItemBox.y + activeItemBox.height)).toBeLessThan(100);

    // Queue sits below the score, not overlapping it
    expect(nextItemBox.y).toBeGreaterThan(statsBox.y + statsBox.height - 5);

    // Queue items stack vertically now (second item is below, not beside, the first)
    expect(secondNextItemBox.y).toBeGreaterThan(nextItemBox.y + nextItemBox.height - 5);
  });

  // ────────────────────────────────────────────────────────────────────────
  // E. Drawer and Device Layout
  // ────────────────────────────────────────────────────────────────────────

  test('drawer and carousel initialize correctly at landscape widths between the portrait and landscape breakpoints (768-950px)', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    // Drawer handle should be a real, sized element — not collapsed to 0x0 because JS's
    // narrower max-width:767px check thought this landscape width was "desktop" and skipped
    // its setup, even though the CSS's separate 950px landscape breakpoint applies here.
    const handleBox = await page.locator('#drawer-handle').boundingBox();
    expect(handleBox).not.toBeNull();
    expect(handleBox.width).toBeGreaterThan(0);
    expect(handleBox.height).toBeGreaterThan(0);

    // Clicking it should actually toggle the drawer (proves the click handler got bound)
    const drawer = page.locator('#top-drawer');
    await expect(drawer).not.toHaveClass(/expanded/);
    await page.locator('#drawer-handle').click({ force: true });
    await expect(drawer).toHaveClass(/expanded/);

    // The piece carousel should have been relocated into the always-visible area and be visible
    const pieceItem = page.locator('#sandbox-mobile-tools .piece-item').first();
    await expect(pieceItem).toBeVisible();
  });

  test('drawer handle is visible on phone, hidden on tablet; clicking it reveals title and modes', async ({ page }) => {
    const width = page.viewportSize().width;
    const drawerHandle = page.locator('#drawer-handle');
    const drawer = page.locator('#top-drawer');
    const title = page.locator('#game-title');
    const modeControls = page.locator('#mode-controls');

    if (width < 768) {
      // Phone: handle visible, drawer collapsed
      await expect(drawerHandle).toBeVisible();
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox.height).toBeLessThan(10);

      // Click handle -> drawer expands, title and modes become visible
      await drawerHandle.click({ force: true });
      await expect(drawer).toHaveClass(/expanded/);
      await page.waitForTimeout(350);
      const expandedBox = await drawer.boundingBox();
      expect(expandedBox.height).toBeGreaterThan(40);
      await expect(title).toBeVisible();
      await expect(modeControls).toBeVisible();

      // Verify title contains actual text
      const titleText = await title.textContent();
      expect(titleText).toContain('Tonncade');
    } else {
      // Tablet: handle hidden, title and modes always visible
      await expect(drawerHandle).toBeHidden();
      await expect(title).toBeVisible();
      await expect(modeControls).toBeVisible();
    }
  });

  test('keyboard controls are hidden on mobile/touch in all modes', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(page.locator('#controls')).toBeHidden();

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
    await expect(page.locator('#midi-keyboard-instructions')).toBeHidden();

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());
    await expect(page.locator('#snake-keyboard-instructions')).toBeHidden();
  });

  test('gravity mobile down button triggers soft-drop; other modes keep their place-piece label', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
    const actionBtn = page.locator('#m-btn-action');
    await expect(actionBtn).toBeVisible();
    await expect(actionBtn).toHaveText('▼');

    const qBefore = await page.evaluate(() => GravityMode.state.q);
    await actionBtn.click();
    const qAfter = await page.evaluate(() => GravityMode.state.q);
    expect(qAfter).toBeLessThan(qBefore);

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(actionBtn).toHaveText('Place / Pick up');
  });

  test('gravity mobile pad stays a single 5-button row in portrait (duplicate down button hidden)', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    await expect(page.locator('#m-btn-action')).toBeVisible();
    await expect(page.locator('#m-btn-action-2')).toBeHidden();

    const visibleButtons = await page.locator('#mobile-controls .m-btn:visible').count();
    expect(visibleButtons).toBe(5);
  });

  test('gravity mobile pad splits into two clusters in landscape, both down buttons trigger soft-drop', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const leftBtn = page.locator('#m-btn-action');
    const rightBtn = page.locator('#m-btn-action-2');
    await expect(leftBtn).toBeVisible();
    await expect(rightBtn).toBeVisible();

    // Left cluster hugs the left edge of the game area, right cluster hugs the right edge —
    // relative to #main-content (not the raw viewport), same reasoning as Snake's pad test:
    // the landscape header is a real side column, not a 0-width unwrapped element.
    const mainContentBox = await page.locator('#main-content').boundingBox();
    const leftBox = await leftBtn.boundingBox();
    const rightBox = await rightBtn.boundingBox();
    expect(leftBox.x - mainContentBox.x).toBeLessThan(100);
    expect(rightBox.x + rightBox.width).toBeGreaterThan(mainContentBox.x + mainContentBox.width - 100);

    // Both duplicate down buttons should trigger a soft-drop, avoiding handedness bias
    let qBefore = await page.evaluate(() => GravityMode.state.q);
    await leftBtn.click();
    let qAfter = await page.evaluate(() => GravityMode.state.q);
    expect(qAfter).toBeLessThan(qBefore);

    qBefore = qAfter;
    await rightBtn.click();
    qAfter = await page.evaluate(() => GravityMode.state.q);
    expect(qAfter).toBeLessThan(qBefore);
  });

  test('Snake and Gravity mobile pads clear iOS-style bottom browser chrome in portrait', async ({ page }) => {
    const width = page.viewportSize().width;
    const height = page.viewportSize().height;
    if (width >= 768) return;

    for (const { mode, selector } of [
      { mode: 'snake', selector: '#snake-mobile-controls .m-btn' },
      { mode: 'gravity', selector: '#mobile-controls .m-btn' },
    ]) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      const boxes = await page.locator(selector).evaluateAll(els =>
        els.filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect().toJSON())
      );
      expect(boxes.length).toBeGreaterThan(0);
      const lowestBottom = Math.max(...boxes.map(b => b.bottom));
      // The old bottom:10px offset left buttons within ~60px of the viewport edge, which real
      // iOS Safari chrome (address bar / tab controls) can fully obscure. Require real clearance
      // even with env(safe-area-inset-bottom) unavailable in this headless test environment.
      expect(height - lowestBottom).toBeGreaterThan(60);
    }
  });

  test('Gravity and Snake pause buttons are visible and positioned below the header on mobile', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    for (const { mode, btnId } of [
      { mode: 'gravity', btnId: '#gravity-start-pause' },
      { mode: 'snake', btnId: '#snake-start-pause' },
    ]) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      // Header height varies by mode (e.g. shrinks once sandbox/midi-specific mobile tools are
      // hidden), so measure it fresh per mode rather than once up front.
      const headerBottom = await page.evaluate(() => document.getElementById('top-header').getBoundingClientRect().bottom);
      const box = await page.locator(btnId).boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.y).toBeGreaterThanOrEqual(headerBottom - 5);
    }
  });

  test('mobile controls pad only visible in Gravity mode on phones', async ({ page }) => {
    const controls = page.locator('#mobile-controls');
    const width = page.viewportSize().width;

    if (width < 768) {
      await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
      await expect(controls).toBeHidden();
      await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
      await expect(controls).toBeVisible();
    } else {
      await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
      await expect(controls).toBeHidden();
    }
  });

  test('MIDI mode touch plays a note without crashing', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

    const status = page.locator('#midi-game-status');
    await expect(status).toHaveText(/Your turn!/, { timeout: 8000 });

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    await expect(cell).toBeVisible();
    await cell.tap();
    await expect(cell).toHaveClass(/active-note/);
  });

  test('selecting a piece from drawer collapses it on mobile', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const drawer = page.locator('#top-drawer');
    const drawerHandle = page.locator('#drawer-handle');

    // Open drawer
    await drawerHandle.click({ force: true });
    await expect(drawer).toHaveClass(/expanded/);
    await page.waitForTimeout(350);

    // Tap a piece (pieces are in #sandbox-mobile-tools, outside drawer,
    // but the piece selection calls collapseMobileDrawer)
    const pieceItem = page.locator('.piece-item').first();
    await pieceItem.tap();

    // Drawer should collapse
    await expect(drawer).not.toHaveClass(/expanded/);
  });

  test('tapping the board in Snake mode no longer changes direction', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());

    const before = await page.evaluate(() => SnakeMode.state.nextDirection);

    await page.evaluate(() => {
      const el = document.getElementById('tonnetz-svg');
      const touch = new Touch({ identifier: 2, target: el, clientX: 450, clientY: 300, pageX: 450, pageY: 300 });
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [touch], targetTouches: [touch], changedTouches: [touch],
        bubbles: true, cancelable: true
      }));
    });

    const after = await page.evaluate(() => SnakeMode.state.nextDirection);
    expect(after).toEqual(before);
  });

  test('snake mobile pad visible only in Snake mode on phones', async ({ page }) => {
    const controls = page.locator('#snake-mobile-controls');
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await expect(controls).toBeHidden();

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());
    await expect(controls).toBeVisible();
  });

  test('snake mobile pad buttons each set the correct direction', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());

    const cases = [
      { id: '#snake-btn-ul', expected: { p: -1, q: 1 } },
      { id: '#snake-btn-ur', expected: { p: 0, q: 1 } },
      { id: '#snake-btn-left', expected: { p: -1, q: 0 } },
      { id: '#snake-btn-right', expected: { p: 1, q: 0 } },
      { id: '#snake-btn-dl', expected: { p: 0, q: -1 } },
      { id: '#snake-btn-dr', expected: { p: 1, q: -1 } },
    ];

    for (const { id, expected } of cases) {
      // A zero vector is never the reverse of any real direction, so this never trips the
      // no-reversal rule regardless of which case runs next.
      await page.evaluate(() => {
        SnakeMode.state.direction = { p: 0, q: 0 };
        SnakeMode.state.nextDirection = { p: 0, q: 0 };
      });

      await page.locator(id).click();
      const nextDir = await page.evaluate(() => SnakeMode.state.nextDirection);
      expect(nextDir).toEqual(expected);
    }
  });

  test('snake mobile pad clusters move to left/right edges in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());

    // The pad hugs the edges of the game area (#main-content), not the raw viewport — in
    // landscape the header is a real side column (not a 0-width unwrapped element like in
    // portrait), so the game area's left edge isn't at viewport x=0.
    const mainContentBox = await page.locator('#main-content').boundingBox();
    const leftBox = await page.locator('.snake-pad-left').boundingBox();
    const rightBox = await page.locator('.snake-pad-right').boundingBox();

    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    expect(leftBox.x - mainContentBox.x).toBeLessThan(30);
    expect(rightBox.x + rightBox.width).toBeGreaterThan(mainContentBox.x + mainContentBox.width - 30);
    // Should span roughly the vertical middle of the screen, not hug the bottom
    expect(leftBox.y).toBeLessThan(393 * 0.4);
    expect(leftBox.y + leftBox.height).toBeGreaterThan(393 * 0.4);
  });
});
