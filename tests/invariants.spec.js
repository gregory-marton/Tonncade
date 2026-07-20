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
      // pattern) on mobile/tablet widths — it must be opened before mode buttons are reachable,
      // and selecting a mode collapses it again (see INV-20), so it has to be reopened before
      // each subsequent switch. Desktop shows it uncollapsed throughout. This mirrors the real
      // interaction sequence a user follows, not a workaround for a bug.
      const isMobile = await page.evaluate(() => Render.isMobileViewport());

      for (const mode of MODES) {
        if (isMobile) {
          const drawer = page.locator('#top-drawer');
          if (!(await drawer.evaluate(el => el.classList.contains('expanded')))) {
            await page.locator('#drawer-handle').click();
            await expect(drawer).toHaveClass(/expanded/);
          }
        }

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

    // BUG (found live): 'expanded'/'collapsed' are two sides of one state, not independent
    // flags -- setting them via two separate classList.toggle() calls can desync, since the
    // drawer starts with NEITHER class present (see index.html), so the very first toggle adds
    // BOTH at once instead of just one. Checking exact class equality (not just "contains
    // expanded") catches that desync; the old assertion here would have passed even with both
    // classes present simultaneously.
    await handle.click();
    await expect(drawer).toHaveClass('expanded');
    await handle.click();
    await expect(drawer).toHaveClass('collapsed');
    await handle.click();
    await expect(drawer).toHaveClass('expanded');
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

    // Deselecting is the note-play tool's job now — re-clicking the same carousel item
    // commits+reselects instead (see the carousel place-then-select tests in mobile.spec.js).
    await page.locator('.piece-item.note-tool-item').click();
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

  // Every hex within a placed piece must be an equally valid pickup handle — tapping ANY of
  // its cells (not just the one that happens to be the piece's internal (0,0) "anchor") should
  // pick up the WHOLE piece and land the ghost at its true position. This used to be an
  // asymmetry bug: tapping a non-anchor cell left the ghost wherever hoverCell last was,
  // instead of the picked-up piece's actual anchor.
  test('INV-4: picking up a piece by a non-anchor cell still lands the ghost at the piece\'s true position', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    // '-' is anchored at its own (0,0) local cell; its other cell is (-1,0) — a non-anchor cell.
    await page.evaluate(() => {
      SandboxMode.state.selectedPiece = '-';
      SandboxMode.state.rotation = 0;
      SandboxMode.state.hoverCell = { p: 6, q: 6 }; // stale hoverCell, far from the piece
      SandboxMode.placePiece(-4, -4); // does not touch hoverCell — it stays at the stale (6,6)
    });

    // Tap the NON-anchor cell (-5, -4), not (-4, -4).
    const nonAnchorHex = page.locator('polygon.placed-piece[data-p="-5"][data-q="-4"]');
    await nonAnchorHex.click({ force: true });

    const hoverAfter = await page.evaluate(() => SandboxMode.state.hoverCell);
    expect(hoverAfter).toEqual({ p: -4, q: -4 }); // the piece's true anchor, not (-5,-4) or the stale (6,6)

    const ghostCells = await page.evaluate(() =>
      [...document.querySelectorAll('.ghost')].map(g => ({ p: parseInt(g.getAttribute('data-p')), q: parseInt(g.getAttribute('data-q')) }))
    );
    const expectedCells = await page.evaluate(() => Pieces.getAbsoluteCells('-', -4, -4, 0));
    expect(ghostCells.sort((a, b) => a.p - b.p)).toEqual(expectedCells.sort((a, b) => a.p - b.p));
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
  // INV-23: live MIDI hardware input behaves exactly like the equivalent tap. No real MIDI
  // hardware is available in CI, so navigator.requestMIDIAccess is mocked with a fake input
  // device -- everything downstream of that (js/midi-input.js's MidiInput.handleNoteOn onward)
  // is the real, unmocked app code.
  // ────────────────────────────────────────────────────────────────────────

  const installFakeMidiDevice = (page) => page.evaluate(() => {
    const fakeInput = { id: 'fake-1', name: 'Test Keyboard', state: 'connected', onmidimessage: null };
    window.__fakeMidiInput = fakeInput;
    navigator.requestMIDIAccess = () => Promise.resolve({
      inputs: new Map([['fake-1', fakeInput]]),
      outputs: new Map(),
      onstatechange: null,
    });
  });

  const connectFakeMidiDevice = async (page) => {
    await installFakeMidiDevice(page);
    await page.evaluate(() => document.getElementById('midi-connect-btn').click());
    await page.waitForFunction(() => document.getElementById('midi-connect-btn').classList.contains('connected'));
  };

  const sendFakeNoteOn = (page, midi) => page.evaluate((m) => {
    window.__fakeMidiInput.onmidimessage({ data: [0x90, m, 100] });
  }, midi);

  test('INV-23: live MIDI hardware note-on plays and highlights the same note as a Sandbox tap', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await connectFakeMidiDevice(page);

    await page.evaluate(() => {
      window.__played = [];
      Synth.playNote = (midi) => window.__played.push(midi);
    });

    const expectedMidi = await page.evaluate(() => Tonnetz.getMidi(0, 0));
    await sendFakeNoteOn(page, expectedMidi);

    const played = await page.evaluate(() => window.__played);
    expect(played).toEqual([expectedMidi]);

    const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
    await expect(cell).toHaveClass(/active-note/);
  });

  test('INV-23: live MIDI hardware note-on advances Melody mode\'s practice sequence like a tap', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
    await expect(page.locator('#midi-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });
    await connectFakeMidiDevice(page);

    const before = await page.evaluate(() => MidiMode.state.userIndex);
    const targetMidi = await page.evaluate(() => MidiMode.state.melody[MidiMode.state.userIndex].midi);
    await sendFakeNoteOn(page, targetMidi);

    const after = await page.evaluate(() => MidiMode.state.userIndex);
    expect(after).toBe(before + 1);
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
      let inViewport = 0;
      let overlappingCells = 0;
      // Scoped to #tonnetz-svg specifically — Render.createHex() gives every hex it draws
      // class="cell", including the tiny piece-preview icons inside the carousel/queue/chord
      // guide, which aren't board cells at all.
      //
      // Hit-tests each cell's own center via elementFromPoint rather than checking against a
      // manually curated list of overlay selectors — a curated list only catches overlays
      // someone remembered to add to it, which is exactly how the D-pad/next-piece-queue
      // overlap this test was meant to catch slipped through for a real release. Any future
      // overlay is covered automatically, with no list to keep in sync.
      // Bound against the SVG's own rendered box, not the window — preserveAspectRatio
      // letterboxes/insets the fitted board within #tonnetz-svg's CSS box (INV-10's own
      // architecture), so a cell whose computed center falls outside that box but still
      // within the window is off the actually-drawn board, not "visible but covered."
      const svgRect = document.getElementById('tonnetz-svg').getBoundingClientRect();
      document.querySelectorAll('#tonnetz-svg polygon.cell:not(.ghost)').forEach(cell => {
        const rect = cell.getBoundingClientRect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        if (cx < svgRect.left || cy < svgRect.top || cx > svgRect.right || cy > svgRect.bottom) return;
        inViewport++;
        const hit = document.elementFromPoint(cx, cy);
        // Anything that resolves back into #tonnetz-svg itself (the cell, a note/qwerty label,
        // a ghost stacked on top) is the board legitimately covering itself, not a bug.
        const covered = hit && !hit.closest('#tonnetz-svg');
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

  // ────────────────────────────────────────────────────────────────────────
  // INV-13: Primary elements set-identity — the per-mode primary-element inventory in
  // docs/invariants.md's "Primary Elements" table is reachable in BOTH portrait and landscape,
  // not just whichever orientation someone happened to test by hand. Gravity's D-pad is the one
  // documented exception (5 buttons in portrait, 6 in landscape) and is checked separately.
  // ────────────────────────────────────────────────────────────────────────

  const PRIMARY_ELEMENTS = {
    gravity: [
      '#tonnetz-svg', '#m-btn-left', '#m-btn-ccw', '#m-btn-action', '#m-btn-cw', '#m-btn-right',
      '#palette', '#gravity-start-pause', '#gravity-reset', '#gravity-controls .stats-panel', '#drawer-handle',
    ],
    blast: ['#tonnetz-svg', '#blast-stats .stats-panel', '#drawer-handle'],
    snake: [
      '#tonnetz-svg', '#snake-btn-ul', '#snake-btn-ur', '#snake-btn-left', '#snake-btn-right',
      '#snake-btn-dl', '#snake-btn-dr', '#snake-start-pause', '#snake-reset', '#snake-controls .stats-panel', '#drawer-handle',
    ],
    midi: ['#tonnetz-svg', '#drawer-handle', '#midi-play-preview', '#midi-game-restart', '#midi-stats-group', '#midi-game-status'],
    sandbox: ['#tonnetz-svg', '#drawer-handle', '#piece-list', '#chord-guide-select'],
  };

  test('INV-13: every mode\'s primary elements are reachable in both portrait and landscape', async ({ page }) => {
    for (const [mode, selectors] of Object.entries(PRIMARY_ELEMENTS)) {
      for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

        // Primary elements only need to be reachable, not permanently visible — open the
        // collapsible drawer first, same as a real player would (mirrors INV-1's pattern).
        const drawer = page.locator('#top-drawer');
        if (!(await drawer.evaluate(el => el.classList.contains('expanded')))) {
          await page.locator('#drawer-handle').click();
          await expect(drawer).toHaveClass(/expanded/);
        }

        if (mode === 'blast') {
          // Blast's preview/place control only renders once a piece is active.
          await page.evaluate(() => {
            BlastMode.state.hoverCell = { p: 0, q: 0 };
            BlastMode.placePiece(0, 0);
          });
          selectors.push('.active-item');
        }

        for (const selector of selectors) {
          const label = `mode=${mode} viewport=${viewport.width}x${viewport.height} selector=${selector}`;
          const result = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return { present: false };
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return { present: true, width: r.width, height: r.height };
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            const occludedBy = hit && !el.contains(hit)
              ? (hit.id ? `#${hit.id}` : (typeof hit.className === 'string' && hit.className ? `.${hit.className.split(' ')[0]}` : hit.tagName))
              : null;
            return { present: true, width: r.width, height: r.height, occludedBy };
          }, selector);
          // A real bounding box isn't enough — a Playwright boundingBox() check alone missed a
          // real bug (Gravity's landscape next-piece queue sitting on top of its own D-pad's
          // left cluster) because it never checks whether something else is drawn on top.
          // elementFromPoint at the element's own center is what actually answers "can a tap
          // here reach this control."
          expect(result.present, `${label} should be present`).toBe(true);
          expect(result.width, `${label} has zero width`).toBeGreaterThan(0);
          expect(result.height, `${label} has zero height`).toBeGreaterThan(0);
          expect(result.occludedBy, `${label} is covered by something else at its own center point`).toBeNull();
        }

        if (mode === 'blast') selectors.pop(); // undo the push above before the next viewport/mode

        if (mode === 'gravity') {
          const isLandscape = viewport.width > viewport.height;
          const box = await page.locator('#m-btn-action-2').boundingBox();
          const label = `gravity's duplicate down-button @ ${viewport.width}x${viewport.height}`;
          if (isLandscape) {
            expect(box, `${label} should be visible in landscape (documented as a 6th D-pad button there)`).not.toBeNull();
          } else {
            expect(box, `${label} should be hidden in portrait (documented as only 5 D-pad buttons there)`).toBeNull();
          }
        }
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-14: Every ghost motion sounds its own cells — placing, picking up, moving, and turning
  // a candidate must always play the Tonnetz notes it currently corresponds to, not just when
  // it's explicitly rotated. Real-device report: the ghost stayed silent while being dragged
  // into position and only made a sound once you rotated it. Root cause: SandboxMode/
  // BlastMode.updateGhost() itself never played anything — sound was bolted on separately at a
  // few call sites (board-tap rotate, two-finger twist) and simply missing everywhere else
  // (initial selection, drag, keyboard nav, keyboard rotation). Fixed by making updateGhost()
  // the single place this happens, deduped by (piece, p, q, rotation) so redundant redraws at
  // the same position don't replay the chord.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-14: selecting a piece immediately sounds its ghost, before any movement', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(() => {
      window.__played = [];
      Synth.playChord = (midis) => window.__played.push([...midis]);
    });

    await page.locator('.piece-item[data-key]:not(.note-tool-item)').first().click({ force: true });

    const played = await page.evaluate(() => window.__played);
    expect(played.length).toBeGreaterThan(0);
  });

  test('INV-14: moving the ghost to a new cell sounds it; staying on the same cell does not replay it', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.locator('.piece-item[data-key]:not(.note-tool-item)').first().click({ force: true });

    await page.evaluate(() => {
      window.__played = [];
      Synth.playChord = (midis) => window.__played.push([...midis]);
    });

    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: 4, q: 4 };
      SandboxMode.updateGhost();
    });
    let played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(1);

    // Redundant re-render at the SAME cell — no new sound.
    await page.evaluate(() => SandboxMode.updateGhost());
    played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(1);

    // A genuinely new cell sounds again.
    await page.evaluate(() => {
      SandboxMode.state.hoverCell = { p: -4, q: -4 };
      SandboxMode.updateGhost();
    });
    played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(2);
  });

  test('INV-14: rotating the ghost via the keyboard sounds it (previously silent)', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.locator('.piece-item[data-key]:not(.note-tool-item)').first().click({ force: true });

    await page.evaluate(() => {
      window.__played = [];
      Synth.playChord = (midis) => window.__played.push([...midis]);
    });

    await page.keyboard.press('Space');
    const played = await page.evaluate(() => window.__played);
    expect(played.length).toBeGreaterThan(0);

    const rotation = await page.evaluate(() => SandboxMode.state.rotation);
    expect(rotation).toBe(1);
  });

  test('INV-14: Blast\'s active-piece ghost also sounds on movement and rotation, not just placement', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

    await page.evaluate(() => {
      window.__played = [];
      Synth.playChord = (midis) => window.__played.push([...midis]);
    });

    await page.evaluate(() => {
      BlastMode.state.hoverCell = { p: 3, q: 3 };
      BlastMode.updateGhost();
    });
    let played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(1);

    await page.keyboard.press('Space'); // rotate
    played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(2);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-16: Rotation direction matches its icon. Real-device report: "Gravity rotation is
  // backwards." tests/run_tests.js's "rotation direction" test independently verifies, against
  // real screen coordinates, that Pieces.rotate() is counter-clockwise (i.e. `rotation + 1`)
  // and its inverse rotateCCW() is clockwise (i.e. `rotation + 5`, equivalently -1). Given that,
  // Gravity's D-pad buttons — the one place in the app with an explicit ↻/↺ icon promising a
  // specific direction — must dispatch the matching step: ↻ (m-btn-cw) should apply the
  // clockwise step (+5), ↺ (m-btn-ccw) the counter-clockwise step (+1). They were swapped.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-16: Gravity\'s clockwise/counter-clockwise D-pad buttons rotate in their labeled direction', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const rotBefore = await page.evaluate(() => GravityMode.state.rotation);
    await page.locator('#m-btn-cw').click({ force: true });
    const rotAfterCW = await page.evaluate(() => GravityMode.state.rotation);
    // The clockwise step is `rotation + 5` (mod 6) — see tests/run_tests.js's "rotation
    // direction" test for why +5, not +1, is the one that's actually clockwise on screen.
    expect(rotAfterCW).toBe((rotBefore + 5) % 6);

    await page.locator('#m-btn-ccw').click({ force: true });
    const rotAfterCCW = await page.evaluate(() => GravityMode.state.rotation);
    expect(rotAfterCCW).toBe((rotAfterCW + 1) % 6);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-17: window.replay() keeps recording across a mode switch, and carries enough to fully
  // recreate a session -- not just keystrokes/taps, but the RNG seed (every mode that draws
  // random pieces depends on Math.random(); without knowing what it produced, replaying the
  // same inputs against a fresh, differently-random session reproduces nothing) and viewport
  // size (pointer coordinates are meaningless without knowing the screen they were captured on).
  // window.onkeydown gets reassigned by every mode (App.setMode nulls it, each mode's
  // setupEvents() reassigns its own handler) — js/replay.js listens via addEventListener
  // instead, specifically so a player's real input history since page load survives regardless
  // of which mode they were in when a bug happened, letting them report it post-hoc via
  // copy(replay()) with nothing pre-armed.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-17: window.replay() records real keydowns, seed, and viewport, and survives a mode switch', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
    await page.keyboard.press('ArrowLeft');

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.keyboard.press('ArrowRight');

    const replayData = await page.evaluate(() => JSON.parse(window.replay()));
    expect(typeof replayData.seed).toBe('number');
    expect(typeof replayData.meta.version).toBe('string');
    expect(typeof replayData.meta.userAgent).toBe('string');
    expect(typeof replayData.meta.maxTouchPoints).toBe('number');
    expect(typeof replayData.meta.devicePixelRatio).toBe('number');

    const keys = replayData.events.filter(e => e.type === 'keydown').map(e => e.key);
    expect(keys).toContain('ArrowLeft');
    expect(keys).toContain('ArrowRight');

    const resizes = replayData.events.filter(e => e.type === 'resize');
    expect(resizes.length).toBeGreaterThan(0);
    expect(resizes[0]).toHaveProperty('width');
    expect(resizes[0]).toHaveProperty('height');
    expect(resizes[0]).toHaveProperty('orientation');
  });

  test('INV-17: window.replay() records a visibility change (tab focus/blur)', async ({ page }) => {
    // A real tab switch can't be triggered from inside the page, but dispatching the same event
    // the browser would fire is enough to verify the listener is wired and records something --
    // this is what lets a replay explain an otherwise-mysterious gap ("were they even here?").
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    const replayData = await page.evaluate(() => JSON.parse(window.replay()));
    const visibilityEvents = replayData.events.filter(e => e.type === 'visibility');
    expect(visibilityEvents.length).toBeGreaterThan(0);
    expect(typeof visibilityEvents[0].state).toBe('string');
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-18: The mosquito bug-report link (next to the "</> local" code link) exists specifically
  // for players who can't reach a browser console — mostly mobile players, who'd otherwise need
  // a second computer to debug their phone. It must confirm before sending anything to the
  // player's device: accepting downloads the full log (seed, meta, every recorded event) as a
  // file; declining copies that same payload to the clipboard instead. Either way it then opens a
  // real GitHub issue, with nothing pre-armed by the player beforehand.
  //
  // The issue URL itself carries nothing but instructions to the human reporter -- no title, no
  // mode/seed/version/events. All of that already lives in the downloaded/copied payload, so
  // repeating it in the URL is redundant, and keeps the URL short regardless of session length (a
  // real ~2.5 hour session's full log blows well past what a URL, let alone GitHub's 65536-char
  // body limit, can carry).
  // ────────────────────────────────────────────────────────────────────────

  test('INV-18a: accepting the save prompt downloads the full log and opens a minimal GitHub issue', async ({ page }) => {
    // Replace window.open with a recorder instead of letting it actually navigate to github.com.
    await page.evaluate(() => {
      window.__openedUrl = null;
      window.open = (url) => { window.__openedUrl = url; return null; };
    });
    page.on('dialog', dialog => dialog.accept());

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
    await page.keyboard.press('ArrowLeft');

    // The link lives inside the collapsible #top-drawer on mobile/tablet widths (see INV-1) —
    // open it first, same as any real player would.
    const isMobile = await page.evaluate(() => Render.isMobileViewport());
    if (isMobile) {
      const drawer = page.locator('#top-drawer');
      if (!(await drawer.evaluate(el => el.classList.contains('expanded')))) {
        await page.locator('#drawer-handle').click();
        await expect(drawer).toHaveClass(/expanded/);
      }
    }

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#report-bug-link').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^tonncade-replay-\d+\.json$/);

    const openedUrl = await page.evaluate(() => window.__openedUrl);
    expect(openedUrl).toContain('https://github.com/gregory-marton/Tonncade/issues/new?');
    const url = new URL(openedUrl);
    expect(url.searchParams.has('title')).toBe(false);
    const body = url.searchParams.get('body');
    expect(body).toContain('downloaded or copied to your clipboard');
    expect(body).toContain('What happened?');
    expect(body).not.toContain('**Mode:**');
    expect(body).not.toContain('**Seed:**');
  });

  test('INV-18b: declining the save prompt copies the full log to the clipboard instead', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard-write permission grants are Chromium-only in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.evaluate(() => {
      window.__openedUrl = null;
      window.open = (url) => { window.__openedUrl = url; return null; };
    });
    page.on('dialog', dialog => dialog.dismiss());

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
    await page.keyboard.press('ArrowLeft');

    const isMobile = await page.evaluate(() => Render.isMobileViewport());
    if (isMobile) {
      const drawer = page.locator('#top-drawer');
      if (!(await drawer.evaluate(el => el.classList.contains('expanded')))) {
        await page.locator('#drawer-handle').click();
        await expect(drawer).toHaveClass(/expanded/);
      }
    }

    await page.locator('#report-bug-link').click();

    // reportBug() awaits the clipboard write before calling window.open(), so once __openedUrl
    // is set the clipboard is guaranteed to already hold the full log.
    await expect.poll(() => page.evaluate(() => window.__openedUrl)).not.toBeNull();
    const clipboardPayload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(typeof clipboardPayload.seed).toBe('number');
    expect(clipboardPayload.events.some(e => e.key === 'ArrowLeft')).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-19: A recorded seed can actually be fed back in and reproduce the same session -- not
  // just be present in the data. Recording a seed is only half of "full recreation"; the other
  // half is a real mechanism to force that seed on reload (the ?seed= URL param), and that
  // mechanism has to demonstrably work: two independent page loads forced to the identical seed
  // must draw the identical sequence of random Gravity pieces, since that's the entire point of
  // recording the seed in the first place.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-19: forcing a page to a recorded seed reproduces the identical Gravity piece sequence', async ({ page, context }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const original = await page.evaluate(() => {
      const pieces = [GravityMode.state.activePiece, ...GravityMode.state.nextQueue];
      for (let i = 0; i < 5; i++) {
        GravityMode.spawnPiece();
        pieces.push(GravityMode.state.activePiece);
      }
      return { seed: Replay.seed, pieces };
    });

    const page2 = await context.newPage();
    await page2.goto(`/?seed=${original.seed}`);
    await page2.waitForLoadState('networkidle');
    await page2.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    const replayedSeed = await page2.evaluate(() => Replay.seed);
    expect(replayedSeed).toBe(original.seed);

    const replayedPieces = await page2.evaluate(() => {
      const pieces = [GravityMode.state.activePiece, ...GravityMode.state.nextQueue];
      for (let i = 0; i < 5; i++) {
        GravityMode.spawnPiece();
        pieces.push(GravityMode.state.activePiece);
      }
      return pieces;
    });

    expect(replayedPieces).toEqual(original.pieces);
    await page2.close();
  });

  test('INV-19: without a ?seed= param, two page loads draw genuinely different random sequences', async ({ page, context }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
    const seedA = await page.evaluate(() => Replay.seed);

    const page2 = await context.newPage();
    await page2.goto('/');
    await page2.waitForLoadState('networkidle');
    const seedB = await page2.evaluate(() => Replay.seed);
    await page2.close();

    expect(seedA).not.toBe(seedB);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-20: On mobile, picking a mode from the drawer must collapse it afterward. Found via a
  // real bug report's replayed session: App.collapseMobileDrawer() exists and is already wired
  // up for the Sandbox chord-guide picker (js/sandbox.js), but was never called from the
  // mode-option click handler itself (js/main.js's setMode) -- so opening the drawer to switch
  // modes left it expanded, permanently occupying screen space, for the rest of the session.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-20: selecting a mode from the mobile drawer collapses the drawer afterward', async ({ page }) => {
    const isMobile = await page.evaluate(() => Render.isMobileViewport());
    test.skip(!isMobile, 'the drawer only exists at mobile/tablet widths');

    const drawer = page.locator('#top-drawer');
    await page.locator('#drawer-handle').click();
    await expect(drawer).toHaveClass(/expanded/);

    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    await expect(drawer).not.toHaveClass(/expanded/);
    await expect(drawer).toHaveClass(/collapsed/);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-21: see docs/invariants.md for the two compounding CSS/rendering bugs this guards
  // against (both needed fixing together -- fixing only one had no visible effect).
  // ────────────────────────────────────────────────────────────────────────

  test("INV-21: Gravity's board fills a real share of its available height, in portrait and landscape", async ({ page }) => {
    const cases = [
      { viewport: { width: 390, height: 844 }, label: 'portrait', minHeightFraction: 0.35 },
      { viewport: { width: 852, height: 393 }, label: 'landscape', minHeightFraction: 0.65 },
    ];

    for (const { viewport, label, minHeightFraction } of cases) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
      // ResizeObserver (see docs/invariants.md) may need a beat to self-correct a transient
      // too-small measurement from mobile `100dvh` layout still settling.
      await page.waitForTimeout(300);

      const boardHeightFraction = await page.evaluate(() => {
        const svg = document.getElementById('tonnetz-svg');
        const cupCells = [];
        for (let q = 0; q < 20; q++) {
          for (let p = -20; p <= 10; p++) {
            const col = p + Math.floor(q / 2);
            if (col < -5 || col > 4) continue;
            cupCells.push({ p, q });
          }
        }
        let minY = Infinity, maxY = -Infinity;
        cupCells.forEach(c => {
          const pos = Render.getScreenPos(c.p, c.q);
          const pt = svg.createSVGPoint();
          pt.x = pos.x; pt.y = pos.y;
          const screenPt = pt.matrixTransform(svg.getScreenCTM());
          minY = Math.min(minY, screenPt.y);
          maxY = Math.max(maxY, screenPt.y);
        });
        return (maxY - minY) / window.innerHeight;
      });

      expect(
        boardHeightFraction,
        `[${label}, ${viewport.width}x${viewport.height}] Gravity board should fill a real share of the viewport height (got ${(boardHeightFraction * 100).toFixed(1)}%, floor ${minHeightFraction * 100}%)`
      ).toBeGreaterThan(minHeightFraction);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-24: rotating the Tonnetz view (js/main.js's #rotate-view-btn, js/render.js's
  // Render.rotationDeg/getEffectiveRotation) keeps everything else about the board correct --
  // nothing clipped, labels stay upright, and Gravity is immune (see docs/invariants.md).
  // ────────────────────────────────────────────────────────────────────────

  const clickRotateButton = (page, times = 1) => page.evaluate((n) => {
    for (let i = 0; i < n; i++) document.getElementById('rotate-view-btn').click();
  }, times);

  test('INV-24: the rotate button steps the lattice-group transform by exactly 30 degrees per click', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    const readTransform = () => page.evaluate(() =>
      document.getElementById('lattice-group').getAttribute('transform')
    );

    expect(await readTransform()).toBeNull(); // 0 degrees omits the attribute entirely
    await clickRotateButton(page);
    expect(await readTransform()).toBe('rotate(30)');
    await clickRotateButton(page, 2);
    expect(await readTransform()).toBe('rotate(90)');
  });

  test('INV-24: the rotate button wraps from 330 back to 0, and the chosen angle persists across a reload', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    await clickRotateButton(page, 11); // 11 * 30 = 330
    expect(await page.evaluate(() => Render.rotationDeg)).toBe(330);
    await clickRotateButton(page, 1); // 330 + 30 = 360 -> wraps to 0
    expect(await page.evaluate(() => Render.rotationDeg)).toBe(0);

    await clickRotateButton(page, 3); // 90 degrees, a value worth surviving a reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => Render.rotationDeg)).toBe(90);

    // Leave global state clean for any test that runs after this one in the same worker.
    await page.evaluate(() => Render.setRotation(0));
  });

  test('INV-24: rotating the view keeps every playable cell visible and unobscured', async ({ page }) => {
    for (const mode of ['sandbox', 'midi', 'snake', 'blast']) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      await clickRotateButton(page, 3); // 90 degrees
      const { unobscured } = await measureBoardOcclusion(page);
      expect(unobscured, `mode=${mode} at 90 degrees`).toBeGreaterThanOrEqual(20);
      await page.evaluate(() => Render.setRotation(0));
    }
  });

  test('INV-24: a placed Sandbox piece rotates together with the base lattice, not independently of it', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.evaluate(() => {
      SandboxMode.state.selectedPiece = '-';
      SandboxMode.state.rotation = 0;
      SandboxMode.state.hoverCell = { p: 2, q: 2 };
      SandboxMode.placePiece(2, 2);
    });

    const beforeCenter = await page.evaluate(() => {
      const el = document.querySelector('polygon.placed-piece[data-p="2"][data-q="2"]');
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    await clickRotateButton(page, 3); // 90 degrees
    await page.evaluate(() => SandboxMode.refreshLattice());

    const afterCenter = await page.evaluate(() => {
      const el = document.querySelector('polygon.placed-piece[data-p="2"][data-q="2"]');
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    // If the placed piece had stayed fixed while only the base lattice rotated under it (the
    // exact bug appendToLattice fixes), its screen position wouldn't move at all here.
    const moved = Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y);
    expect(moved).toBeGreaterThan(5);

    await page.evaluate(() => Render.setRotation(0));
  });

  test('INV-24: note labels stay upright (same on-screen aspect ratio) regardless of lattice rotation', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

    // Labels don't carry data-p/data-q themselves (only their own x/y position, set from
    // getScreenPos(p, q) BEFORE any rotation is applied -- see createLabel) -- match by that
    // instead of adding attributes solely for this test to read.
    const rectAt = async (deg) => {
      await page.evaluate((d) => { Render.setRotation(d); SandboxMode.refreshLattice(); }, deg);
      return page.evaluate(() => {
        const expectedX = Render.getScreenPos(2, 2).x;
        const target = Array.from(document.querySelectorAll('text.note-label')).find(t =>
          Math.abs(parseFloat(t.getAttribute('x')) - expectedX) < 0.5
        );
        const r = target.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
    };

    const rect0 = await rectAt(0);
    const rect90 = await rectAt(90);

    // A genuinely-rotated (not counter-rotated) label would swap width and height at 90 degrees.
    // Generous tolerance since sub-pixel font rendering isn't perfectly deterministic.
    expect(rect90.width).toBeGreaterThan(rect0.width * 0.5);
    expect(rect90.height).toBeLessThan(rect0.height * 2);

    await page.evaluate(() => Render.setRotation(0));
  });

  test('INV-24: Gravity always renders at 0 degrees and hides the rotate control, regardless of the stored preference', async ({ page }) => {
    await page.evaluate(() => Render.setRotation(90));
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

    expect(await page.evaluate(() => Render.getEffectiveRotation())).toBe(0);
    expect(await page.evaluate(() =>
      document.getElementById('lattice-group').getAttribute('transform')
    )).toBeNull();
    await expect(page.locator('#rotate-view-btn')).toBeHidden();

    // Switching back to a rotatable mode should honor the still-stored preference.
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    expect(await page.evaluate(() => Render.getEffectiveRotation())).toBe(90);
    await expect(page.locator('#rotate-view-btn')).toBeVisible();

    await page.evaluate(() => Render.setRotation(0));
  });
});
