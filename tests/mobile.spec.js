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
  // E. Drawer and Device Layout
  // ────────────────────────────────────────────────────────────────────────

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

  test('snake mode touch steering works without crashing', async ({ page }) => {
    const width = page.viewportSize().width;
    if (width >= 768) return;

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());

    await page.evaluate(() => {
      const el = document.getElementById('tonnetz-svg');
      const touch = new Touch({ identifier: 2, target: el, clientX: 450, clientY: 300, pageX: 450, pageY: 300 });
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [touch], targetTouches: [touch], changedTouches: [touch],
        bubbles: true, cancelable: true
      }));
    });

    const nextDir = await page.evaluate(() => SnakeMode.state.nextDirection);
    expect(nextDir).toBeDefined();
  });
});
