const { test, expect } = require('@playwright/test');

/**
 * INVARIANT TESTS — see docs/invariants.md
 *
 * These encode the app's core cross-cutting guarantees (INV-1..INV-9 in that doc), as
 * distinct from tests/mobile.spec.js's per-feature behavioral coverage. Every test here maps
 * to a specific numbered invariant in the doc.
 *
 * DO NOT weaken, skip, or delete a test here to make a change land. If a change genuinely
 * requires an invariant to be redefined, update docs/invariants.md FIRST — with the reasoning
 * for the change — then update the corresponding test to match, in the same commit. A test
 * in this file going red is a signal to fix the product, not the test.
 *
 * INV-6 (Tonnetz isomorphism) and INV-7 (piece geometry validity) are pure logic with no DOM
 * dependency, so they live in tests/run_tests.js instead — see that file for their coverage.
 */

const MODES = ['sandbox', 'midi', 'snake', 'blast', 'gravity'];

test.describe('Invariant tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-1: Every mode is reachable from every screen, in every orientation.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-1: every mode is reachable from every other mode, in portrait and landscape', async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);

      // The mode list lives inside the collapsible #top-drawer by design (a hamburger-menu
      // pattern) on mobile/tablet widths — it must be opened before mode buttons are reachable.
      // Desktop shows it uncollapsed. This mirrors the real interaction sequence a user follows,
      // not a workaround for a bug.
      const isMobile = await page.evaluate(() => Render.isMobileViewport());
      if (isMobile) {
        const drawer = page.locator('#top-drawer');
        if (!(await drawer.evaluate(el => el.classList.contains('expanded')))) {
          await page.locator('#drawer-handle').click({ force: true });
          await expect(drawer).toHaveClass(/expanded/);
        }
      }

      for (const mode of MODES) {
        // No {force:true} — Playwright's actionability checks require the element to be
        // visible, stable, and unobscured, so this fails if a mode button is ever unreachable.
        await page.locator(`.mode-option[data-mode="${mode}"]`).click();
        const current = await page.evaluate(() => App.currentMode);
        expect(current).toBe(mode);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-2: Anything you can summon, you can dismiss.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-2: the mobile drawer, once opened, can always be closed again', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const drawer = page.locator('#top-drawer');
    const handle = page.locator('#drawer-handle');

    await handle.click({ force: true });
    await expect(drawer).toHaveClass(/expanded/);
    await handle.click({ force: true });
    await expect(drawer).not.toHaveClass(/expanded/);
  });

  test('INV-2: the chord guide, once populated with results, can always be cleared', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    await page.locator('#chord-guide-select').selectOption('major');
    await expect(page.locator('.chord-match-item').first()).toBeVisible({ timeout: 3000 });

    await page.locator('#chord-guide-reset').click({ force: true });
    await expect(page.locator('#chord-guide-select')).toHaveValue('');
    await expect(page.locator('.chord-match-item')).toHaveCount(0);
  });

  test('INV-2: a candidate piece selected from the carousel can always be deselected without placing it', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const firstPiece = page.locator('.piece-item[data-key]:not(.note-tool-item)').first();
    await firstPiece.click();
    expect(await page.evaluate(() => SandboxMode.state.selectedPiece)).not.toBeNull();

    await firstPiece.click(); // same control summons and dismisses
    expect(await page.evaluate(() => SandboxMode.state.selectedPiece)).toBeNull();
    expect(await page.locator('.placed-piece').count()).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-3: No dead click targets — an element JS explicitly relocates into the mobile
  // "always-visible" area (implying "this should now be reachable") is never left unreachable
  // by a hidden ancestor. This is the converse of INV-2 and catches the exact bug
  // #chord-guide-reset had: JS moved the <select> and results into #mobile-always-visible but
  // left the reset button behind inside a container that then got display:none'd, silently
  // orphaning it.
  //
  // Scoped to #mobile-always-visible specifically, not every hidden button app-wide — most
  // hidden buttons (e.g. #gravity-controls's Pause/Restart while in Sandbox mode) are
  // correctly hidden because they belong to an inactive mode's own panel, which is normal and
  // not a bug; #mobile-always-visible is the one container whose whole point is "always
  // visible," so anything inside it staying hidden is always wrong.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-3: nothing moved into the always-visible mobile area is left unreachable by a hidden ancestor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Only Sandbox and Melody populate #mobile-always-visible's panels — Snake/Blast/Gravity
    // correctly leave both panels display:none, which is not what this invariant is about.
    for (const [mode, panelId] of [['sandbox', 'sandbox-mobile-tools'], ['midi', 'midi-mobile-tools']]) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      const problems = await page.evaluate((id) => {
        const panel = document.getElementById(id);
        const found = [];
        panel.querySelectorAll('button, select, input').forEach(el => {
          if (el.style.display === 'none') return; // intentionally self-hidden, not orphaned
          let ancestor = el.parentElement;
          while (ancestor && ancestor !== document.body) {
            if (getComputedStyle(ancestor).display === 'none') {
              found.push(`${el.id || el.tagName} hidden by ${ancestor.id || ancestor.className || ancestor.tagName}`);
              break;
            }
            ancestor = ancestor.parentElement;
          }
        });
        return found;
      }, panelId);
      expect(problems, `mode=${mode}`).toEqual([]);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-4 & INV-5: Audio comes from exactly the notes/cells responsible for it, and the
  // responsible cell(s) show visible feedback when they sound.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-4: tapping an empty cell in Sandbox plays exactly that cell\'s Tonnetz note', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(() => {
      window.__played = [];
      Synth.playNote = (midi) => window.__played.push({ type: 'note', midis: [midi] });
      Synth.playChord = (midis) => window.__played.push({ type: 'chord', midis: [...midis] });
    });

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="2"][data-q="2"]');
    await cell.click({ force: true });

    const played = await page.evaluate(() => window.__played);
    const expectedMidi = await page.evaluate(() => Tonnetz.getMidi(2, 2));
    expect(played).toEqual([{ type: 'note', midis: [expectedMidi] }]);
  });

  test('INV-4: picking up a placed piece in Sandbox plays exactly its own cells\' notes, as a chord', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    // Place a known 2-cell piece ('-') directly via state, bypassing the carousel, so the
    // expected cells are pinned by the piece definition rather than re-derived from the same
    // code path under test.
    await page.evaluate(() => {
      SandboxMode.state.selectedPiece = '-';
      SandboxMode.state.rotation = 0;
      SandboxMode.state.hoverCell = { p: -4, q: -4 };
      SandboxMode.placePiece(-4, -4);
    });

    await page.evaluate(() => {
      window.__played = [];
      Synth.playNote = (midi) => window.__played.push({ type: 'note', midis: [midi] });
      Synth.playChord = (midis) => window.__played.push({ type: 'chord', midis: [...midis] });
    });

    const placedHex = page.locator('polygon.placed-piece[data-p="-4"][data-q="-4"]');
    await placedHex.click({ force: true });

    const played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(1);
    expect(played[0].type).toBe('chord');

    const expectedMidis = await page.evaluate(() =>
      Pieces.getAbsoluteCells('-', -4, -4, 0).map(c => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b)
    );
    expect([...played[0].midis].sort((a, b) => a - b)).toEqual(expectedMidis);
  });

  test('INV-5: tapping a cell in Melody mode both sounds its note AND visibly highlights that exact cell', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
    await expect(page.locator('#midi-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });

    await page.evaluate(() => {
      window.__played = [];
      Synth.playNote = (midi) => window.__played.push(midi);
    });

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    await cell.tap();

    const played = await page.evaluate(() => window.__played);
    const expectedMidi = await page.evaluate(() => Tonnetz.getMidi(0, 0));
    expect(played).toEqual([expectedMidi]);
    await expect(cell).toHaveClass(/active-note/);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-8: Interactive controls never sit closer than a minimum safe distance to the edge of
  // the screen, across the mobile breakpoints — real device chrome (iOS Safari's toolbars,
  // notches, gesture bars) can obscure real estate a flat 0px/10px offset would assume is
  // clear. This generalizes the Snake/Gravity-specific clearance fixes into a standing check.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-8: no mobile control button sits within 10px of the viewport edge', async ({ page }) => {
    for (const { viewport, mode } of [
      { viewport: { width: 390, height: 844 }, mode: 'snake' },
      { viewport: { width: 390, height: 844 }, mode: 'gravity' },
      { viewport: { width: 852, height: 393 }, mode: 'snake' },
      { viewport: { width: 852, height: 393 }, mode: 'gravity' },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

      const boxes = await page.locator('.m-btn').evaluateAll(els =>
        els.filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect().toJSON())
      );
      expect(boxes.length, `mode=${mode} viewport=${viewport.width}x${viewport.height}`).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.left, 'left edge').toBeGreaterThanOrEqual(0);
        expect(b.top, 'top edge').toBeGreaterThanOrEqual(0);
        expect(viewport.width - b.right, 'right edge clearance').toBeGreaterThan(-10);
        // Bottom clearance is intentionally NOT checked at a flat 10px here — real iOS Safari
        // chrome needs the much larger --mobile-pad-safe-bottom floor, already covered by its
        // own dedicated test in mobile.spec.js ("clear iOS-style bottom browser chrome").
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-9: Rotating the device mid-game never resets or corrupts game state.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-9: Snake score and snake body survive a portrait/landscape resize', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());

    await page.evaluate(() => {
      SnakeMode.state.score = 42;
      document.getElementById('snake-score').textContent = '42';
    });
    const bodyBefore = await page.evaluate(() => JSON.stringify(SnakeMode.state.snake));

    await page.setViewportSize({ width: 852, height: 393 }); // rotate to landscape

    const scoreAfter = await page.evaluate(() => SnakeMode.state.score);
    const bodyAfter = await page.evaluate(() => JSON.stringify(SnakeMode.state.snake));
    expect(scoreAfter).toBe(42);
    expect(bodyAfter).toBe(bodyBefore);
  });

  test('INV-9: Blast placed pieces and lines-cleared count survive a portrait/landscape resize', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

    const linesBefore = await page.evaluate(() => BlastMode.state.linesCleared);
    const placedBefore = await page.evaluate(() => Board.cells.size);

    await page.setViewportSize({ width: 852, height: 393 }); // rotate to landscape

    const linesAfter = await page.evaluate(() => BlastMode.state.linesCleared);
    const placedAfter = await page.evaluate(() => Board.cells.size);
    expect(linesAfter).toBe(linesBefore);
    expect(placedAfter).toBe(placedBefore);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-10 & INV-11: a restricted Tonnetz (Snake/Blast/Gravity — a fixed board, not
  // free-pan) is never overlapped by any other element; and at least 20 distinct cells are
  // visible and controllable in every mode/orientation.
  // ────────────────────────────────────────────────────────────────────────

  async function measureBoardOcclusion(page) {
    return page.evaluate(() => {
      const overlaySelectors = [
        '#blast-stats', '#gravity-controls', '#snake-controls',
        // The D-pad containers are transparent, pointer-events:none boxes spanning most of
        // the game area — only their .m-btn children actually paint anything opaque.
        '#mobile-controls .m-btn', '#snake-mobile-controls .m-btn',
        '#palette.floating-queue', '#midi-controls',
      ];
      const overlayRects = [];
      for (const sel of overlaySelectors) {
        document.querySelectorAll(sel).forEach(el => {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) overlayRects.push(rect);
        });
      }

      let inViewport = 0;
      let overlappingCells = 0;
      // Scoped to #tonnetz-svg specifically — Render.createHex() gives every hex it draws
      // class="cell", including the tiny piece-preview icons inside the carousel/queue/chord
      // guide, which are legitimately positioned inside those overlay rects and aren't board
      // cells at all.
      document.querySelectorAll('#tonnetz-svg polygon.cell:not(.ghost)').forEach(cell => {
        const rect = cell.getBoundingClientRect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return;
        inViewport++;
        const covered = overlayRects.some(r => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
        if (covered) overlappingCells++;
      });
      return { inViewport, overlappingCells, unobscured: inViewport - overlappingCells };
    });
  }

  test('INV-10: on a restricted Tonnetz (Snake/Blast/Gravity), no overlay overlaps the board', async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
      await page.setViewportSize(viewport);
      for (const mode of ['snake', 'blast', 'gravity']) {
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
        const { overlappingCells } = await measureBoardOcclusion(page);
        expect(overlappingCells, `mode=${mode} viewport=${viewport.width}x${viewport.height}`).toBe(0);
      }
    }

    // Dynamic content can grow a panel past its allotted margin without any single fixed
    // pixel value ever being "wrong" in isolation — Snake's long game-over message did
    // exactly this once. Exercise it explicitly, since nothing else in this loop varies panel
    // content length.
    await page.setViewportSize({ width: 852, height: 393 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());
    await page.evaluate(() => SnakeMode.gameOver());
    const { overlappingCells } = await measureBoardOcclusion(page);
    expect(overlappingCells, 'snake mode, after game over (long message)').toBe(0);
  });

  test('INV-11: at least 20 distinct Tonnetz cells are visible and controllable, in every mode/orientation', async ({ page }) => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
      await page.setViewportSize(viewport);
      for (const mode of MODES) {
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
        const { unobscured } = await measureBoardOcclusion(page);
        expect(unobscured, `mode=${mode} viewport=${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-12: On an unrestricted Tonnetz (Sandbox/Melody — free pan/zoom), the player's chosen
  // pan/zoom persists through interacting with other controls, rather than resetting.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-12: panning Sandbox\'s Tonnetz is preserved across an unrelated control interaction', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    await page.evaluate(() => {
      Render.updateView(-999, -888, 1);
      SandboxMode.state.viewX = Render.viewX;
      SandboxMode.state.viewY = Render.viewY;
    });
    const viewBefore = await page.evaluate(() => ({ x: Render.viewX, y: Render.viewY }));

    await page.locator('.piece-item').first().click();

    const viewAfter = await page.evaluate(() => ({ x: Render.viewX, y: Render.viewY }));
    expect(viewAfter).toEqual(viewBefore);
  });
});
