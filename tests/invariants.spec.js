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

// The full mode list, derived from the actual UI (.mode-option[data-mode]) rather than
// hand-maintained here -- a hardcoded copy previously went stale (missing Life entirely) without
// any test catching it. Requires a page already navigated to '/', so callable only from within a
// test body (after beforeEach's page.goto), not at module scope.
const getModes = (page) => page.evaluate(() => [...document.querySelectorAll('.mode-option')].map((el) => el.getAttribute('data-mode')));

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
    const MODES = await getModes(page);
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
    for (const [mode, panelId] of [['sandbox', 'sandbox-mobile-tools'], ['melody', 'melody-mobile-tools']]) {
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

  // The narrower INV-3 test above only checks elements that DID get moved into the
  // always-visible area for being orphaned there afterward -- it can't catch an element that
  // was supposed to be moved but wasn't, since it never looks anywhere else. This is exactly
  // that gap: Melody's mobile-drawer logic (js/main.js) redistributes #melody-controls' children
  // into two destinations (an always-visible dock, a collapsible drawer) and then hides
  // #melody-controls itself outright -- if any interactive control gets left behind because the
  // code that names what to move by id fell out of sync with index.html's own markup (the
  // literal bug this regresses against: a dropdown reorg added #melody-source-group but the
  // relocation code still only knew the old #midi-folder-group/#midi-online-group), it's now
  // stranded, invisible, inside a container that's correctly hidden for an entirely different
  // reason. General on purpose: it doesn't enumerate ids, so it needs no maintenance as
  // Melody's controls change, and it automatically covers any future mode that adopts the same
  // split-relocation pattern -- it just checks the one property that must ALWAYS hold for that
  // pattern to be correct: once a mode decides its own `#<mode>-controls` panel doesn't need to
  // be shown directly (mobile split-relocation), that panel must contain zero remaining
  // interactive elements, because everything in it was supposed to have somewhere else to go.
  test('INV-3: once a mode-controls panel is hidden for mobile split-relocation, nothing interactive is left behind inside it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const MODES = await getModes(page);

    for (const mode of MODES) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      const leftBehind = await page.evaluate((m) => {
        const panel = document.getElementById(`${m}-controls`);
        if (!panel) return null; // this mode's panel isn't named this way -- not what this checks
        if (getComputedStyle(panel).display !== 'none') return null; // not split-hiding -- nothing to check
        return [...panel.querySelectorAll('button, select, input')]
          .filter((el) => el.style.display !== 'none') // still counts as "moved out" conceptually if self-hidden
          .map((el) => el.id || el.tagName);
      }, mode);
      if (leftBehind !== null) expect(leftBehind, `mode=${mode}`).toEqual([]);
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
    // Placed near the origin so the cell is on-screen (and clickable) in the default centered view
    // -- the pannable view now centers on the origin (Render.panView / INV-44), where it used to
    // sit off-center on mobile, which had left a cell this far out (-4,-4) inside the frame only by
    // that old accident.
    await page.evaluate(() => {
      SandboxMode.state.selectedPiece = '-';
      SandboxMode.state.rotation = 0;
      SandboxMode.state.hoverCell = { p: -1, q: -1 };
      SandboxMode.placePiece(-1, -1);
    });

    await page.evaluate(() => {
      window.__played = [];
      Synth.playNote = (midi) => window.__played.push({ type: 'note', midis: [midi] });
      Synth.playChord = (midis) => window.__played.push({ type: 'chord', midis: [...midis] });
    });

    const placedHex = page.locator('polygon.placed-piece[data-p="-1"][data-q="-1"]');
    await placedHex.click({ force: true });

    const played = await page.evaluate(() => window.__played);
    expect(played.length).toBe(1);
    expect(played[0].type).toBe('chord');

    const expectedMidis = await page.evaluate(() =>
      Pieces.getAbsoluteCells('-', -1, -1, 0).map(c => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b)
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
    // Placed near the origin so both cells are on-screen (clickable) in the default centered view
    // (see INV-4 above / Render.panView / INV-44).
    await page.evaluate(() => {
      SandboxMode.state.selectedPiece = '-';
      SandboxMode.state.rotation = 0;
      SandboxMode.state.hoverCell = { p: 6, q: 6 }; // stale hoverCell, far from the piece
      SandboxMode.placePiece(-1, -1); // does not touch hoverCell — it stays at the stale (6,6)
    });

    // Tap the NON-anchor cell (-2, -1), not (-1, -1).
    const nonAnchorHex = page.locator('polygon.placed-piece[data-p="-2"][data-q="-1"]');
    await nonAnchorHex.click({ force: true });

    const hoverAfter = await page.evaluate(() => SandboxMode.state.hoverCell);
    expect(hoverAfter).toEqual({ p: -1, q: -1 }); // the piece's true anchor, not (-2,-1) or the stale (6,6)

    const ghostCells = await page.evaluate(() =>
      [...document.querySelectorAll('.ghost')].map(g => ({ p: parseInt(g.getAttribute('data-p')), q: parseInt(g.getAttribute('data-q')) }))
    );
    const expectedCells = await page.evaluate(() => Pieces.getAbsoluteCells('-', -1, -1, 0));
    expect(ghostCells.sort((a, b) => a.p - b.p)).toEqual(expectedCells.sort((a, b) => a.p - b.p));
  });

  test('INV-5: tapping a cell in Melody mode both sounds its note AND visibly highlights that exact cell', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
    await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });

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

  // With a real (multi-cell) piece selected, MIDI input means something different from the note
  // tool above: hover the piece's ghost (anchor at the nearest cell for the played pitch) and
  // sound it -- a live audition of where it would land -- but never place it. A keyboard has no
  // unambiguous "place" gesture of its own, so committing stays with the existing keyboard/touch
  // controls untouched.
  test('INV-23: live MIDI hardware note-on hovers a selected piece\'s ghost without placing it', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.locator('.piece-item[data-key]:not(.note-tool-item)').first().click({ force: true });
    await connectFakeMidiDevice(page);

    const placedBefore = await page.evaluate(() => SandboxMode.state.placedPieces.length);
    const targetMidi = await page.evaluate(() => Tonnetz.getMidi(3, 3));
    await sendFakeNoteOn(page, targetMidi);

    const after = await page.evaluate(() => ({
      hoverCell: SandboxMode.state.hoverCell,
      placed: SandboxMode.state.placedPieces.length,
      ghostCount: document.querySelectorAll('#tonnetz-svg polygon.ghost').length,
    }));
    expect(after.hoverCell).toEqual({ p: 3, q: 3 }); // ghost anchored exactly where that pitch is
    expect(after.placed).toBe(placedBefore);         // never placed -- still just a preview
    expect(after.ghostCount).toBeGreaterThan(0);      // and the ghost is actually shown
  });

  test('INV-23: live MIDI hardware note-on advances Melody mode\'s practice sequence like a tap', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
    await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });
    await connectFakeMidiDevice(page);

    const before = await page.evaluate(() => MelodyMode.state.userIndex);
    const targetMidi = await page.evaluate(() => MelodyMode.state.melody[MelodyMode.state.userIndex].midi);
    await sendFakeNoteOn(page, targetMidi);

    const after = await page.evaluate(() => MelodyMode.state.userIndex);
    expect(after).toBe(before + 1);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Issue #11: extending live MIDI hardware input to Gravity/Snake/Blast (per the report's own
  // detailed spec for each mode), and beyond it to Life (added later, once Life itself existed --
  // toggle the cell nearest the view center for the played pitch). Generalized from separately
  // hand-written tests (each with its own copy of the connect-device/switch-mode boilerplate --
  // flagged as a gap on the GitHub issue itself) into one shared MIDI_ROUTING_CHECKS config plus a
  // single loop: a future mode gaining MIDI support means adding one entry here, not a new bespoke
  // test. Each mode's own routing logic is still genuinely different -- so each entry supplies its
  // own check; only the harness is shared.
  // ────────────────────────────────────────────────────────────────────────

  const MIDI_ROUTING_CHECKS = {
    gravity: async (page) => {
      const before = await page.evaluate(() => GravityMode.state.p);
      await sendFakeNoteOn(page, 60);
      const after = await page.evaluate(() => GravityMode.state.p);
      expect(after, 'MIDI note 60 (middle C) should move Gravity\'s piece left, matching the D-pad').toBe(before - 1);
    },
    snake: async (page) => {
      const targetDir = await page.evaluate(() => {
        const head = SnakeMode.state.snake[0];
        // The neighbor directly opposite the snake's current direction is never a legal turn, so
        // pick a different one to target -- any neighbor whose own pitch we can request exactly.
        const neighbors = Tonnetz.getNeighbors(head.p, head.q);
        const current = SnakeMode.state.direction;
        const candidate = neighbors.find(n => (n.p - head.p) !== -current.p || (n.q - head.q) !== -current.q);
        return { dp: candidate.p - head.p, dq: candidate.q - head.q, midi: Tonnetz.getMidi(candidate.p, candidate.q) };
      });
      await sendFakeNoteOn(page, targetDir.midi);
      const nextDirection = await page.evaluate(() => SnakeMode.state.nextDirection);
      expect(nextDirection, 'Snake should turn toward the neighbor with the closest pitch').toEqual({ p: targetDir.dp, q: targetDir.dq });
    },
    blast: async (page) => {
      // Derive a real, playable chord from the actual (randomly-chosen) active piece at
      // rotation 0, anchored wherever it already legally sits -- rather than assuming a
      // specific piece shape.
      const chord = await page.evaluate(() => {
        const type = BlastMode.state.activePiece;
        const cells = Pieces.getAbsoluteCells(type, BlastMode.state.hoverCell.p, BlastMode.state.hoverCell.q, 0);
        return cells.map(c => Tonnetz.getMidi(c.p, c.q));
      });
      // Real hardware never fires simultaneous note-ons in the same JS tick -- space them out
      // slightly, still well within MidiInput's chord-buffering window.
      for (const midi of chord) {
        await sendFakeNoteOn(page, midi);
        await page.waitForTimeout(5);
      }
      await page.waitForTimeout(150); // let the chord buffer window (50ms) elapse
      const result = await page.evaluate(() => {
        const cells = Pieces.getAbsoluteCells(BlastMode.state.activePiece, BlastMode.state.hoverCell.p, BlastMode.state.hoverCell.q, BlastMode.state.rotation);
        return cells.map(c => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b);
      });
      expect(result, 'Blast\'s ghost should move to a placement reproducing the played chord').toEqual(chord.slice().sort((a, b) => a - b));
    },
    life: async (page) => {
      await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
      // The exact target the app itself computes (nearest matching cell to the view center) --
      // then confirm playing that pitch actually toggles that specific cell.
      const before = await page.evaluate(() => {
        const W = Render.HEX_W, H = 45;
        const qNear = Math.round(-(LifeMode.state.viewY || 0) / H);
        const pNear = Math.round(((LifeMode.state.viewX || 0) - qNear * (W / 2)) / W);
        const target = Tonnetz.nearestCoordFor(60, { p: pNear, q: qNear });
        const key = `${target.p},${target.q}`;
        return { key, hadLive: LifeMode.state.live.has(key) };
      });
      await sendFakeNoteOn(page, 60);
      const hasLive = await page.evaluate((key) => LifeMode.state.live.has(key), before.key);
      expect(hasLive, 'MIDI note 60 should toggle the cell nearest the view center for that pitch').toBe(!before.hadLive);
    },
  };

  test('issue #11: live MIDI hardware input drives Gravity/Snake/Blast/Life, each per its own spec', async ({ page }) => {
    await connectFakeMidiDevice(page); // hardware connection is session-level, not per-mode
    for (const mode of Object.keys(MIDI_ROUTING_CHECKS)) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      await MIDI_ROUTING_CHECKS[mode](page);
    }
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
  // INV-9 & INV-12 (unified): every mode's meaningful state -- game state for all modes, plus
  // the chosen pan/zoom for the unrestricted ones -- survives a resize, a view rotation, and
  // (where applicable) an actual pan. One matrix over MODES, not a hand-written pair per mode:
  // adding a 7th mode means adding one entry below, not writing a new test.
  //
  // Only one real partition here, not two independent guesses at "which modes support this" --
  // a restricted/bounded board (Blast/Gravity/Snake) always auto-fits on every refresh, so
  // manual panning and exact-view-persistence are both meaningless for it the same way and for
  // the same reason; an unrestricted/free-pan board (Sandbox/Melody/Compose) supports both.
  // PANNABLE_MODES and VIEW_PERSISTS_MODES are therefore the exact same derived set, not two
  // separately hand-picked ones (an earlier version of this test had Blast in PANNABLE_MODES
  // but not VIEW_PERSISTS_MODES, mirroring Render.getPanBounds's own inclusion of Blast -- but
  // since Blast's view resets on every refresh regardless, there's nothing for a "pan" to
  // meaningfully persist there either; corrected per the user's own review).
  // ────────────────────────────────────────────────────────────────────────

  // Every restricted/bounded-board mode, with its own cell-set generator -- adding a new one
  // means adding an entry here, not writing a new centering test. Mirrors the exact per-mode
  // cell logic tests/mobile.spec.js's centering tests already used.
  const RESTRICTED_BOARD_CELLS = {
    blast: () => {
      const cells = [];
      for (let p = -Board.radius; p <= Board.radius; p++) {
        for (let q = -Board.radius; q <= Board.radius; q++) {
          if (Board.isInBounds(p, q)) cells.push({ p, q });
        }
      }
      return cells;
    },
    gravity: () => {
      const cells = [];
      for (let q = 0; q < 20; q++) {
        for (let p = -20; p <= 10; p++) {
          const col = p + Math.floor(q / 2);
          if (col < -5 || col > 4) continue;
          cells.push({ p, q });
        }
      }
      return cells;
    },
    snake: () => {
      const cells = [];
      const radius = 7;
      for (let p = -radius; p <= radius; p++) {
        for (let q = -radius; q <= radius; q++) {
          if (Math.abs(p) <= radius && Math.abs(q) <= radius && Math.abs(p + q) <= radius) cells.push({ p, q });
        }
      }
      return cells;
    },
  };

  async function checkBoardCentered(page, mode) {
    return page.evaluate(({ m, cellsSrc }) => {
      const cells = new Function('Board', `return (${cellsSrc})();`)(Board);
      const positions = cells.map(c => Render.getScreenPos(c.p, c.q));
      const boardCenterX = (Math.min(...positions.map(pos => pos.x)) + Math.max(...positions.map(pos => pos.x))) / 2;
      const boardCenterY = (Math.min(...positions.map(pos => pos.y)) + Math.max(...positions.map(pos => pos.y))) / 2;
      const { refW, refH } = Render.getAspectMatchedRefBox();
      const viewBoxCenterX = Render.viewX + (refW * Render.zoom) / 2;
      const viewBoxCenterY = Render.viewY + (refH * Render.zoom) / 2;
      return {
        xOff: Math.abs(viewBoxCenterX - boardCenterX),
        yOff: Math.abs(viewBoxCenterY - boardCenterY),
      };
    }, { m: mode, cellsSrc: RESTRICTED_BOARD_CELLS[mode].toString() });
  }

  // Each mode's own setup (give it some non-trivial, non-zero state worth checking) and
  // snapshot (read back exactly the fields that must NOT change from a resize/rotate/pan) --
  // run inside the page via a single switch, since closures can't cross the evaluate boundary.
  async function setupModeState(page, mode) {
    await page.evaluate((m) => {
      switch (m) {
        case 'snake':
          SnakeMode.state.score = 42;
          document.getElementById('snake-score').textContent = '42';
          // Snake and Gravity both auto-advance on a real-time timer -- unrelated to what this
          // test checks, but real enough to move the snake/piece during the async work a
          // resize/rotate-view step does (opening the drawer, clicking a button), which would
          // look identical to actual corruption. Pausing removes that real-time race entirely.
          if (!SnakeMode.state.isPaused) SnakeMode.togglePause();
          break;
        case 'gravity':
          if (!GravityMode.state.isPaused) GravityMode.togglePause();
          break;
        case 'blast':
          // Real game state here (placed cells, lines cleared) depends on actual play; the
          // fields themselves (Board.cells, linesCleared) already exist at their initial value,
          // which is exactly what should survive untouched. Blast has no auto-timer.
          break;
        case 'compose':
          ComposeMode.state.notes = [{ midi: Tonnetz.getMidi(0, 0), p: 0, q: 0, time: 0, duration: 0.4 }];
          ComposeMode.state.selectedIndices = [];
          ComposeMode.refreshBoard();
          break;
        case 'life':
          LifeMode.toggleCell(4, 4); // an extra live cell, distinct from the loaded automaton's own
          break;
        default:
          break;
      }
    }, mode);
  }

  async function snapshotModeState(page, mode) {
    return page.evaluate((m) => {
      switch (m) {
        case 'snake': return { score: SnakeMode.state.score, snake: SnakeMode.state.snake };
        case 'blast': return { linesCleared: BlastMode.state.linesCleared, boardCells: Array.from(Board.cells.keys()).sort() };
        case 'gravity': return { linesCleared: GravityMode.state.linesCleared, boardCells: Array.from(GravityBoard.cells.keys()).sort() };
        case 'sandbox': return { placedPieces: SandboxMode.state.placedPieces };
        // userIndex/startIndex are deliberately excluded here -- a pan gesture in Melody also
        // plays whatever note is under the initial click (by design, see INV-5), which can
        // legitimately advance/reset progress. targetLength is untouched by any of that.
        case 'melody': return { targetLength: MelodyMode.state.targetLength };
        case 'compose': return { notes: ComposeMode.state.notes, selectedIndices: ComposeMode.state.selectedIndices };
        case 'life': return { live: [...LifeMode.state.live.entries()], generation: LifeMode.state.generation };
        default: return {};
      }
    }, mode);
  }

  test('INV-9/INV-12: every mode\'s state survives resize, view rotation, and (where pannable) panning', async ({ page }) => {
    const MODES = await getModes(page);
    // Derived from production's own Render.RESTRICTED_MODES, not re-hand-picked here -- everything
    // NOT restricted is free-pan, and free-pan is exactly the set that both supports a manual pan
    // gesture and must preserve its exact view position. Cross-checked against
    // RESTRICTED_BOARD_CELLS's own keys (the per-mode geometry this test needs for restricted
    // boards) so the two can't silently drift apart -- a mode added to one without the other
    // fails loudly here instead of quietly losing coverage.
    const restrictedModeNames = await page.evaluate(() => Render.RESTRICTED_MODES);
    expect(Object.keys(RESTRICTED_BOARD_CELLS).sort()).toEqual([...restrictedModeNames].sort());
    const RESTRICTED_MODES = new Set(restrictedModeNames);
    const VIEW_PERSISTS_MODES = new Set(MODES.filter(m => !RESTRICTED_MODES.has(m)));
    const PANNABLE_MODES = VIEW_PERSISTS_MODES;

    for (const mode of MODES) {
      await page.setViewportSize({ width: 390, height: 844 });
      // Render.rotationDeg is a single global, persisted across mode switches (by design --
      // it's the player's own chosen view angle, not per-mode) -- reset it before each mode's
      // own check so one mode's rotate step doesn't change the STARTING angle (and therefore
      // the pan-bounds clamping) for the next mode's check. Without this, a real product bug
      // and cross-iteration test interference are indistinguishable.
      await page.evaluate(() => Render.setRotation(0));
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      if (mode === 'melody') await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });
      if (mode === 'life') await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
      await setupModeState(page, mode);

      const pannable = PANNABLE_MODES.has(mode);
      const viewPersists = VIEW_PERSISTS_MODES.has(mode);
      const restrictedBoard = mode in RESTRICTED_BOARD_CELLS;

      if (viewPersists) {
        // A MODEST, safely-in-bounds offset -- not an extreme corner value. Resize and rotate
        // both legitimately change the pan-bounds clamping region (different aspect ratio,
        // different rotation angle), so an extreme seed value can get legitimately RE-clamped
        // to a new position under a perturbation this test isn't trying to test -- which would
        // look identical to a real corruption bug. A modest offset stays in-bounds regardless.
        //
        // Pan via the mode's OWN stored view + refresh (not a raw Render.updateView): the pannable
        // modes now hold a view CENTER and fill the container with an aspect-matched viewBox (see
        // Render.panView / INV-44), so a hardcoded 4:3/zoom-1 updateView would seed a baseline the
        // app never actually produces -- the very next refresh would "correct" it and look like a
        // corruption. Offsetting the stored center by a modest amount and refreshing mirrors a real
        // pan exactly.
        await page.evaluate((m) => {
          const modeObj = { sandbox: SandboxMode, melody: MelodyMode, compose: ComposeMode, life: LifeMode }[m];
          const refresh = { sandbox: () => SandboxMode.refreshLattice(), melody: () => MelodyMode.refreshBoard(), compose: () => ComposeMode.refreshBoard(), life: () => LifeMode.refreshLattice() }[m];
          refresh(); // ensure the view center is initialized (null -> origin) before offsetting it
          modeObj.state.viewX -= 60;
          modeObj.state.viewY -= 40;
          refresh();
        }, mode);
      }

      // The view CENTER in lattice units, not the viewBox top-left: the pannable modes now fill
      // the container with an aspect-matched viewBox (Render.panView / INV-44), so the top-left
      // legitimately shifts when the container's aspect changes (resize/device-rotate) even though
      // the content hasn't moved -- it's the center that's held fixed. Comparing the center is the
      // real "the view didn't jump" invariant, robust to the aspect-dependent top-left.
      const viewCenter = () => page.evaluate(() => {
        const vb = Render.svg.getAttribute('viewBox').split(/\s+/).map(Number);
        return { x: vb[0] + vb[2] / 2, y: vb[1] + vb[3] / 2 };
      });
      const closeTo = (a, b) => Math.abs(a - b) < 1;

      const stateBefore = await snapshotModeState(page, mode);
      const viewBefore = viewPersists ? await viewCenter() : null;

      const checkViewOrCentering = async (label) => {
        expect(await snapshotModeState(page, mode), `[${mode}] state ${label}`).toEqual(stateBefore);
        if (viewPersists) {
          const c = await viewCenter();
          expect(closeTo(c.x, viewBefore.x) && closeTo(c.y, viewBefore.y),
            `[${mode}] view center ${label}: got (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), expected (${viewBefore.x.toFixed(1)}, ${viewBefore.y.toFixed(1)})`).toBe(true);
        } else if (restrictedBoard) {
          // Blast/Gravity/Snake deliberately DON'T preserve a manual pan -- they always re-fit
          // to show as much of their own fixed board as the screen allows (confirmed with the
          // user; BlastMode.refreshBoard() always recomputes an auto-fit view). The right
          // invariant for these is "still correctly centered", not "identical to before".
          const { xOff, yOff } = await checkBoardCentered(page, mode);
          expect(xOff, `[${mode}] board x-centering ${label}`).toBeLessThan(1);
          expect(yOff, `[${mode}] board y-centering ${label}`).toBeLessThan(1);
        }
      };

      // 1. Resize (rotate the device). Restricted-board modes re-fit via a ResizeObserver,
      // which fires asynchronously (see INV-30's own comment) -- give it a beat before checking,
      // same convention already used elsewhere in this suite (desktop.spec.js's own INV-30
      // tests, INV-29's pill-transition wait).
      await page.setViewportSize({ width: 852, height: 393 });
      if (restrictedBoard) await page.waitForTimeout(300);
      await checkViewOrCentering('after resize');
      await page.setViewportSize({ width: 390, height: 844 });
      if (restrictedBoard) await page.waitForTimeout(300);

      // 2. Rotate the lattice view -- Gravity is the one documented exception (INV-24: always
      // renders at 0deg, no rotate control at all), so it's skipped here, not silently failed.
      if (mode !== 'gravity') {
        // The rotate button only needs to be REACHABLE, not permanently visible -- open the
        // collapsible drawer first, same as a real player would (mirrors INV-13's own pattern).
        // Skipping this is what made an earlier version of this test misread an unopened
        // drawer's clipped-away button as a genuine overlap with #chord-guide-select.
        const drawer = page.locator('#top-drawer');
        if (!(await drawer.evaluate(el => el.classList.contains('expanded')))) {
          await page.locator('#drawer-handle').click();
        }
        const rotateBtn = page.locator('#rotate-view-btn');
        if (await rotateBtn.count() > 0 && await rotateBtn.isVisible()) {
          await rotateBtn.click();
          await checkViewOrCentering('after rotate-view');
        }
      }

      // 3. An actual pan (pannable modes only) -- game state must still survive; the view
      // position/centering is EXPECTED to change here (that's the point of panning, or -- for a
      // restricted board -- the point of it snapping back on the NEXT refresh, not this one), so
      // only state is checked, not view position/centering.
      if (pannable) {
        const svgBox = await page.locator('#tonnetz-svg').boundingBox();
        const cx = svgBox.x + svgBox.width / 2, cy = svgBox.y + svgBox.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx - 60, cy - 40, { steps: 5 });
        await page.mouse.up();
        expect(await snapshotModeState(page, mode), `[${mode}] state after panning`).toEqual(stateBefore);
      }
    }
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
        // Same settling wait INV-21 already uses, for the same reason (see docs/invariants.md):
        // fitContentBox's fit can need a ResizeObserver-driven correction pass to catch layout
        // that wasn't settled yet at mode-entry's own synchronous call (panel text populated a
        // moment earlier, a CSS transition still animating) -- found live via this exact test
        // flaking without it once INV-40's JS-computed sizing replaced the old CSS-percentage
        // approach, which had no such settling dependency (a browser's own layout is synchronous;
        // recomputing a value in JS in response to it is not).
        await page.waitForTimeout(300);
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
    const MODES = await getModes(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
      await page.setViewportSize(viewport);
      for (const mode of MODES) {
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
        const { unobscured } = await measureBoardOcclusion(page);
        expect(unobscured, `mode=${mode} viewport=${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  // INV-12 (view persists across an unrelated interaction) is now folded into the unified
  // INV-9/INV-12 matrix above, over every mode rather than just Sandbox/Melody -- see there.

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
    blast: ['#tonnetz-svg', '#blast-reset', '#blast-stats .stats-panel', '#drawer-handle'],
    snake: [
      '#tonnetz-svg', '#snake-btn-ul', '#snake-btn-ur', '#snake-btn-left', '#snake-btn-right',
      '#snake-btn-dl', '#snake-btn-dr', '#snake-start-pause', '#snake-reset', '#snake-controls .stats-panel', '#drawer-handle',
    ],
    melody: ['#tonnetz-svg', '#drawer-handle', '#melody-source', '#melody-play-preview', '#melody-game-restart', '#melody-stats-group', '#melody-game-status'],
    sandbox: ['#tonnetz-svg', '#drawer-handle', '#piece-list', '#chord-guide-select'],
    compose: [
      '#tonnetz-svg', '#drawer-handle', '#compose-source', '#compose-record', '#compose-play',
      '#compose-clear', '#compose-save', '#compose-stats-group',
    ],
    life: [
      '#tonnetz-svg', '#drawer-handle', '#life-source', '#life-play-pause', '#life-step',
      '#life-reset', '#life-clear', '#life-save', '#life-generation',
    ],
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
  // INV-13 follow-up: PRIMARY_ELEMENTS (above) can't be derived automatically -- "primary
  // element" is a semantic judgment call (a top-level affordance a player would name), not a
  // structural one. Compose's tempo/subdivision/Quantize/Metronome inputs, for instance, sit at
  // the exact same DOM depth as its Record/Play/Save buttons but are deliberately NOT primary
  // (they're settings, not top-level actions) -- a naive "every visible control is primary"
  // scan would misclassify them, and a human still has to make that call.
  //
  // What CAN be automated is noticing when the call was never made at all: this walks every
  // interactive element (button/select/input) inside each mode's own `#<mode>-controls` /
  // `#<mode>-stats` container and fails if it's neither in PRIMARY_ELEMENTS nor in
  // SECONDARY_ELEMENTS (the explicit "yes, deliberately not primary, here's why" list) nor
  // nested inside a sub-container the static markup itself starts as `display:none` (the
  // existing signal this project already uses for "conditional, shown only in some state" --
  // e.g. Compose's #compose-edit-group, only shown once a note is selected). A newly-added
  // control that fits none of those three buckets fails LOUD instead of silently having no
  // reachability coverage the way #melody-source did for a full day after it was added.
  // ────────────────────────────────────────────────────────────────────────

  // Entries may name a single control's own id, OR a container's id whose entire subtree is
  // covered (matching how PRIMARY_ELEMENTS itself already uses container-scoped selectors like
  // '#gravity-controls .stats-panel') -- Blast/Gravity's Easy/Medium/Hard difficulty buttons
  // have no ids of their own at all (`class="weight-icon"` only), so the group is classified by
  // its own wrapping `#blast-difficulty`/`#gravity-difficulty` container instead.
  const SECONDARY_ELEMENTS = {
    melody: ['#melody-file-input', '#melody-difficulty'], // upload fallback + a setting, not a top-level action
    blast: ['#blast-difficulty'], // Easy/Medium/Hard piece-size setting, not a top-level action
    gravity: ['#gravity-difficulty'], // same setting, Gravity's own copy
    compose: [
      '#compose-file-input', '#compose-tempo', '#compose-subdivision', '#compose-quantize', '#compose-metronome',
    ], // upload fallback + recording settings, not top-level actions
    life: ['#life-file-input'], // upload fallback, not a top-level action
  };

  test('INV-13 coverage: every interactive control in a mode\'s panel is classified as primary or secondary, none forgotten', async ({ page }) => {
    const CONTAINER_ID = {
      gravity: 'gravity-controls', blast: 'blast-stats', snake: 'snake-controls',
      melody: 'melody-controls', compose: 'compose-controls', life: 'life-controls',
    };
    for (const [mode, containerId] of Object.entries(CONTAINER_ID)) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

      const unclassified = await page.evaluate(({ containerId, primary, secondary }) => {
        const container = document.getElementById(containerId);
        if (!container) return [`#${containerId} not found`];
        const primaryIds = primary.map((s) => s.replace(/^#/, '').split(' ')[0]);
        const secondaryIds = secondary.map((s) => s.replace(/^#/, ''));
        const classifiedById = (id) => primaryIds.includes(id) || secondaryIds.includes(id);
        const found = [];
        container.querySelectorAll('button, select, input').forEach((el) => {
          // Classified either directly (own id) or via an ancestor container's id (a group
          // entry, e.g. '#blast-difficulty' covering every button inside it).
          let node = el;
          while (node && node !== container) {
            if (node.id && classifiedById(node.id)) return;
            node = node.parentElement;
          }
          // Conditional sub-panel, e.g. #compose-edit-group -- shown only in some state, not a
          // permanent top-level affordance, so it's outside this check's scope by design.
          let ancestor = el.parentElement;
          while (ancestor && ancestor !== container) {
            if (ancestor.getAttribute('style') && /display:\s*none/.test(ancestor.getAttribute('style'))) return;
            ancestor = ancestor.parentElement;
          }
          found.push(el.id || `unidentified ${el.tagName} (add an id, or an id on a wrapping group, so it can be classified)`);
        });
        return found;
      }, { containerId, primary: PRIMARY_ELEMENTS[mode] || [], secondary: SECONDARY_ELEMENTS[mode] || [] });

      expect(unclassified, `mode=${mode}: found unclassified control(s) -- add each to PRIMARY_ELEMENTS ` +
        `(docs/invariants.md's Primary Elements table too) or to SECONDARY_ELEMENTS with a reason`).toEqual([]);
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
  // INV-29: found live via Compose mode's visual QA -- the mode-slider's active-pill background
  // (css/style.css's .mode-slider-active) hardcoded a width/height sized for exactly 5 options,
  // which silently desynced (wrong size AND wrong position, since App.setMode's translate is a
  // multiple of the pill's OWN width) the moment a 6th option (Compose) was added. Generalized
  // across every mode and both slider orientations so any FUTURE mode count change gets caught
  // here too, not just rediscovered by eye again.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-29: the mode-slider active pill exactly covers the active mode option, for every mode, portrait and landscape', async ({ page }) => {
    const MODES = await getModes(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 852, height: 393 }]) {
      await page.setViewportSize(viewport);
      for (const mode of MODES) {
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
        await page.waitForTimeout(300); // let the pill's 0.25s transition finish

        const { pillRect, optionRect } = await page.evaluate((m) => {
          const pill = document.querySelector('.mode-slider-active');
          const option = document.querySelector(`.mode-option[data-mode="${m}"]`);
          return { pillRect: pill.getBoundingClientRect(), optionRect: option.getBoundingClientRect() };
        }, mode);

        // Checking left/top position (not width/height) is deliberate: .mode-option has its own
        // horizontal padding (content-box, not border-box) that legitimately makes its rendered
        // box wider than the pill's -- that's just text-inset spacing, not a visual gap, since
        // only the absolutely-positioned pill paints a background at all. Position is the real
        // signal of "the pill is under the right label"; it's also exactly what the original bug
        // got wrong (both position AND size were off, since idx*100% translates by multiples of
        // the pill's own -- then-mis-sized -- width).
        const label = `mode=${mode} viewport=${viewport.width}x${viewport.height}`;
        const TOLERANCE = 1; // sub-pixel rounding only
        expect(Math.abs(pillRect.left - optionRect.left), `${label} left`).toBeLessThan(TOLERANCE);
        expect(Math.abs(pillRect.top - optionRect.top), `${label} top`).toBeLessThan(TOLERANCE);
      }
    }
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
  // INV-40: a restricted board's own reference box must match ITS shape, not whatever leftover
  // shape the mobile chrome happened to leave behind -- see docs/invariants.md. Found live via
  // the exploratory "Random taps" matrix and a deterministic 16x16 black-patch sweep: fitting
  // content into a mismatched-aspect reference box wastes space on whichever axis isn't the
  // tight constraint, regardless of how much total leftover area there is.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-40: Snake/Gravity/Blast size #tonnetz-svg to match their own board shape, not the leftover chrome space', async ({ page }) => {
    const cases = [
      { mode: 'snake', viewport: { width: 320, height: 480 } },
      { mode: 'gravity', viewport: { width: 320, height: 480 } },
      { mode: 'blast', viewport: { width: 320, height: 480 } },
      { mode: 'snake', viewport: { width: 852, height: 393 } },
    ];

    for (const { mode, viewport } of cases) {
      await page.setViewportSize(viewport);
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      await page.waitForTimeout(300);

      const result = await page.evaluate((m) => {
        let cells;
        if (m === 'snake') {
          cells = [];
          for (let p = -7; p <= 7; p++) for (let q = -7; q <= 7; q++) if (SnakeMode.isInBounds(p, q)) cells.push({ p, q });
        } else if (m === 'gravity') {
          cells = [];
          for (let q = 0; q < 20; q++) for (let p = -20; p <= 10; p++) {
            const col = p + Math.floor(q / 2);
            if (col >= -5 && col <= 4) cells.push({ p, q });
          }
        } else {
          cells = [];
          for (let p = -5; p <= 5; p++) for (let q = -5; q <= 5; q++) if (Board.isInBounds(p, q)) cells.push({ p, q });
        }
        const bounds = Render.computeCellBounds(cells, Render.HEX_R * 2);
        const contentAspect = (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY);
        const rect = Render.svg.getBoundingClientRect();
        const svgAspect = rect.width / rect.height;
        return { contentAspect, svgAspect };
      }, mode);

      // Within 5% -- fitContentBox derives the element's own box directly from this same
      // content-bounds computation, so any real drift here means something upstream (a resize,
      // a mode switch) skipped calling it, not just floating-point noise.
      const ratio = result.svgAspect / result.contentAspect;
      expect(
        ratio,
        `[${mode}, ${viewport.width}x${viewport.height}] #tonnetz-svg's own aspect ratio (${result.svgAspect.toFixed(3)}) should match its board's natural shape (${result.contentAspect.toFixed(3)}), not leftover chrome space`
      ).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
  });

  // A sharper, more direct restatement of the same property INV-40 checks indirectly via aspect
  // ratio: on whichever axis the board is actually bound by (its own shape vs. the available
  // space's), the rendered board should reach within one hex-diameter of BOTH edges of the
  // available area on that axis -- not just be correctly shaped, but actually maximized within
  // it. Matching an aspect ratio while still being arbitrarily small (a scaling bug elsewhere)
  // would pass INV-40 but fail this. `2 * Render.HEX_R` is the same "one hex diameter" constant
  // every getFitView call already passes as its own `padding` argument, so this is checking that
  // the fit lands where that padding convention already implies it should, not a new number.
  test('INV-41: the restricted board reaches within one hex-diameter of two opposite edges of its available space', async ({ page }) => {
    const cases = [
      { mode: 'snake', viewport: { width: 320, height: 480 } },
      { mode: 'snake', viewport: { width: 397, height: 537 } },
      { mode: 'gravity', viewport: { width: 320, height: 480 } },
      { mode: 'blast', viewport: { width: 320, height: 480 } },
      { mode: 'snake', viewport: { width: 852, height: 393 } },
    ];

    for (const { mode, viewport } of cases) {
      await page.setViewportSize(viewport);
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
      await page.waitForTimeout(300);

      const result = await page.evaluate((m) => {
        let cells;
        if (m === 'snake') {
          cells = [];
          for (let p = -7; p <= 7; p++) for (let q = -7; q <= 7; q++) if (SnakeMode.isInBounds(p, q)) cells.push({ p, q });
        } else if (m === 'gravity') {
          cells = [];
          for (let q = 0; q < 20; q++) for (let p = -20; p <= 10; p++) {
            const col = p + Math.floor(q / 2);
            if (col >= -5 && col <= 4) cells.push({ p, q });
          }
        } else {
          cells = [];
          for (let p = -5; p <= 5; p++) for (let q = -5; q <= 5; q++) if (Board.isInBounds(p, q)) cells.push({ p, q });
        }

        const svg = Render.svg;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        cells.forEach(c => {
          const pos = Render.getRotatedScreenPos(c.p, c.q);
          const pt = svg.createSVGPoint();
          pt.x = pos.x - Render.HEX_R; pt.y = pos.y - Render.HEX_R;
          const s1 = pt.matrixTransform(svg.getScreenCTM());
          pt.x = pos.x + Render.HEX_R; pt.y = pos.y + Render.HEX_R;
          const s2 = pt.matrixTransform(svg.getScreenCTM());
          minX = Math.min(minX, s1.x, s2.x); maxX = Math.max(maxX, s1.x, s2.x);
          minY = Math.min(minY, s1.y, s2.y); maxY = Math.max(maxY, s1.y, s2.y);
        });

        const container = document.getElementById('game-container').getBoundingClientRect();
        const clearance = Render.measureChromeClearance(m);
        const avail = {
          left: container.left + clearance.left, right: container.right - clearance.right,
          top: container.top + clearance.top, bottom: container.bottom - clearance.bottom,
        };

        // One hex diameter, in on-screen pixels at the current zoom -- transform two points
        // 2*HEX_R world-units apart and measure the resulting screen distance, rather than
        // assuming a fixed pixel constant that would drift with zoom/viewport.
        const p1 = svg.createSVGPoint(); p1.x = 0; p1.y = 0;
        const p2 = svg.createSVGPoint(); p2.x = Render.HEX_R * 2; p2.y = 0;
        const s1 = p1.matrixTransform(svg.getScreenCTM());
        const s2 = p2.matrixTransform(svg.getScreenCTM());
        const cellDiameterPx = Math.hypot(s2.x - s1.x, s2.y - s1.y);

        return {
          marginLeft: minX - avail.left, marginRight: avail.right - maxX,
          marginTop: minY - avail.top, marginBottom: avail.bottom - maxY,
          cellDiameterPx,
        };
      }, mode);

      // A small tolerance, not a hard boundary: a scale=1 caller's margin is architecturally
      // EXACTLY one hex diameter (the same padding constant every getFitView call already passes),
      // landing right on this boundary -- floating-point rounding alone can push the measured
      // value a hair past it.
      const tolerance = result.cellDiameterPx * 1.05;
      const horizontalBound = Math.max(result.marginLeft, result.marginRight) <= tolerance;
      const verticalBound = Math.max(result.marginTop, result.marginBottom) <= tolerance;
      expect(
        horizontalBound || verticalBound,
        `[${mode}, ${viewport.width}x${viewport.height}] board should reach within one hex-diameter ` +
        `(${result.cellDiameterPx.toFixed(1)}px) of two opposite edges of its available space -- ` +
        `margins L=${result.marginLeft.toFixed(1)} R=${result.marginRight.toFixed(1)} ` +
        `T=${result.marginTop.toFixed(1)} B=${result.marginBottom.toFixed(1)}`
      ).toBe(true);
    }
  });

  test('INV-42: exactly one of #blast-stats/#gravity-controls/#snake-controls is visible at a time on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await page.goto('/');
    const ids = ['blast-stats', 'gravity-controls', 'snake-controls'];
    for (const activeMode of ['blast', 'gravity', 'snake']) {
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), activeMode);
      await page.waitForTimeout(300);
      const displays = await page.evaluate((ids) =>
        ids.map(id => getComputedStyle(document.getElementById(id)).display), ids);
      ids.forEach((id, i) => {
        const shouldBeVisible = id.startsWith(activeMode);
        expect(displays[i], `mode=${activeMode} #${id}`).toBe(shouldBeVisible ? 'flex' : 'none');
      });
    }
  });

  test('INV-43: Snake portrait board spans nearly the full width, its hexagon points reaching past the corner D-pad columns', async ({ page }) => {
    // Snake's portrait D-pad is two narrow columns hugging the left/right edges with a wide empty
    // center gap; the board is a hexagon whose left/right VERTICES (its widest point) sit at its
    // vertical center. So a correctly-fit board reaches nearly the full container width -- the
    // vertices clear the columns because the hexagon's tapering lower flanks pull inward before
    // reaching the columns' height. The old flat top/bottom/left/right clearance model couldn't
    // express this and shrank the board to a fraction of the width (the reported bug). This checks
    // both that the board is now wide AND that no cell actually overlaps the chrome.
    const sizes = [
      { width: 397, height: 537 },
      { width: 360, height: 560 },
      { width: 412, height: 600 },
      { width: 320, height: 520 },
    ];
    for (const vp of sizes) {
      await page.setViewportSize(vp);
      await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());
      await page.waitForTimeout(300);

      const info = await page.evaluate(() => {
        const cells = [];
        for (let p = -7; p <= 7; p++) for (let q = -7; q <= 7; q++) if (SnakeMode.isInBounds(p, q)) cells.push({ p, q });
        const svg = Render.svg;
        let minX = Infinity, maxX = -Infinity;
        cells.forEach(c => {
          const pos = Render.getRotatedScreenPos(c.p, c.q);
          for (const dx of [-Render.HEX_R, Render.HEX_R]) {
            const pt = svg.createSVGPoint(); pt.x = pos.x + dx; pt.y = pos.y;
            const s = pt.matrixTransform(svg.getScreenCTM());
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
          }
        });
        const container = document.getElementById('game-container').getBoundingClientRect();
        return { boardWidth: maxX - minX, containerWidth: container.width };
      });

      // A full-width hexagon's points reach the side edges; 0.8 comfortably clears the old
      // flat-fit result (~0.67 at 397x537) while leaving room for a slight inward pull when the
      // D-pad columns are the binding constraint.
      expect(
        info.boardWidth / info.containerWidth,
        `[${vp.width}x${vp.height}] board width ${info.boardWidth.toFixed(0)} should span most of container ${info.containerWidth.toFixed(0)}`
      ).toBeGreaterThan(0.8);

      const { overlappingCells } = await measureBoardOcclusion(page);
      expect(overlappingCells, `[${vp.width}x${vp.height}] no cell should overlap chrome`).toBe(0);
    }
  });

  test('INV-44: pannable modes (Sandbox/Melody/Compose/Life) fill the game-container -- viewBox aspect matches the container, no letterbox', async ({ page }) => {
    // A pannable board is effectively infinite, so its visible window should match the
    // game-container's aspect ratio and fill it edge-to-edge. The old fixed 800x600 (4:3) viewBox
    // instead letterboxed inside any non-4:3 container -- wasting the sides of a wide desktop
    // window (Melody at ~2:1 showed the board squished into a 4:3 center band). Restricted modes
    // already aspect-match (INV-40); this extends the same "fill the space" property to the
    // pannable modes.
    const modes = ['sandbox', 'melody', 'compose', 'life'];
    const viewports = [
      { width: 1400, height: 600 },  // wide (2.33)
      { width: 700, height: 1100 },  // tall (0.64)
      { width: 950, height: 900 },   // near-square
    ];
    for (const mode of modes) {
      for (const vp of viewports) {
        await page.setViewportSize(vp);
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
        await page.waitForTimeout(200);
        const { viewAspect, containerAspect } = await page.evaluate(() => {
          const vb = Render.svg.getAttribute('viewBox').split(/\s+/).map(Number);
          const gc = document.getElementById('game-container').getBoundingClientRect();
          return { viewAspect: vb[2] / vb[3], containerAspect: gc.width / gc.height };
        });
        // Within 5%: the viewBox maps onto the container with no letterbox band.
        expect(
          Math.abs(viewAspect - containerAspect) / containerAspect,
          `[${mode} ${vp.width}x${vp.height}] viewBox aspect ${viewAspect.toFixed(2)} should match container ${containerAspect.toFixed(2)}`
        ).toBeLessThan(0.05);
      }
    }
  });

  test('INV-45: a pannable mode entered after a restricted mode does not inherit its inline SVG sizing', async ({ page }) => {
    // On a MOBILE viewport the restricted modes (Gravity/Blast/Snake) size #tonnetz-svg with an
    // inline width/height + position:absolute (Render.fitContentBox) fit to their own board's box.
    // Inline styles beat the CSS `svg { width/height:100% }` AND persist even when the viewport
    // later widens, so a pannable mode entered afterwards would render into that leftover (tiny,
    // off-corner) box unless it clears the inline sizing (Render.panView). Found live via the
    // screenshot fixture: play Gravity, switch to Sandbox, and the lattice stayed stuck at
    // Gravity's board size. (At desktop widths fitContentBox no-ops, so the mobile viewport here
    // is what actually reproduces it.)
    await page.setViewportSize({ width: 390, height: 844 });
    for (const restricted of ['gravity', 'blast', 'snake']) {
      for (const pannable of ['sandbox', 'melody', 'compose', 'life']) {
        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), restricted);
        await page.waitForTimeout(300); // let the restricted ResizeObserver settle its inline fit
        const restrictedInline = await page.evaluate(() => Render.svg.style.width);
        expect(restrictedInline, `${restricted} should have set an inline SVG width (else the test isn't exercising the bug)`).not.toBe('');

        await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), pannable);
        await page.waitForTimeout(100);
        const leftover = await page.evaluate(() => ({
          width: Render.svg.style.width, height: Render.svg.style.height, position: Render.svg.style.position,
        }));
        expect(leftover, `[${restricted}->${pannable}] pannable mode should have cleared the restricted board's inline SVG sizing`)
          .toEqual({ width: '', height: '', position: '' });
      }
    }

    // Same leftover-inline hazard for a restricted mode itself, resized mobile -> desktop: its
    // fitContentBox no-ops at desktop widths, and must clear the inline mobile fit rather than
    // leave the board stranded at the old mobile box (found live: Snake/Blast/Gravity desktop
    // fixture frames were tiny or blank). The SVG must fall back to filling its container.
    for (const restricted of ['gravity', 'blast', 'snake']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), restricted);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => Render.svg.style.width),
        `${restricted} should set an inline SVG width on mobile`).not.toBe('');
      await page.setViewportSize({ width: 1757, height: 1000 });
      await page.waitForTimeout(400); // let the mode's ResizeObserver refit at the new size
      const fill = await page.evaluate(() => {
        const gc = document.getElementById('game-container').getBoundingClientRect();
        const svg = Render.svg.getBoundingClientRect();
        return { inlineW: Render.svg.style.width, fillW: svg.width / gc.width, fillH: svg.height / gc.height };
      });
      expect(fill.inlineW, `${restricted} mobile->desktop should clear the inline SVG width`).toBe('');
      expect(fill.fillW, `${restricted} mobile->desktop SVG should fill container width`).toBeGreaterThan(0.98);
      expect(fill.fillH, `${restricted} mobile->desktop SVG should fill container height`).toBeGreaterThan(0.98);
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
    for (const mode of ['sandbox', 'melody', 'compose', 'snake', 'blast', 'life']) {
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

  // ────────────────────────────────────────────────────────────────────────
  // INV-25: Melody mode's matching is exact-pitch (not just note-NAME), so two different-
  // octave "E"s are genuinely different notes -- and the UI must say so clearly enough that a
  // rejected note reads as "wrong octave," not as a mystifying bug. Real report: a player found
  // it possible to play "the wrong E" against a real MIDI keyboard.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-25: Melody mode rejects a different-octave note with the same name, and accepts the exact pitch', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
    await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });

    const targetMidi = await page.evaluate(() => MelodyMode.state.melody[MelodyMode.state.userIndex].midi);

    // Same pitch class (note name), different octave -- the exact "wrong E" scenario. A wrong
    // note is also real, INTENDED to block further input for ~1.2s and requeue a full replay
    // (mistake-recovery UX) -- irrelevant to what's under test here, so the two halves are
    // checked independently rather than chained through that side effect.
    const wrongOctaveMidi = targetMidi + 12;
    const afterWrong = await page.evaluate((m) => {
      MelodyMode.handleUserInputNote(m);
      return MelodyMode.state.userIndex;
    }, wrongOctaveMidi);
    expect(afterWrong, 'a different-octave note sharing the same name must NOT count as correct').toBe(0);

    await page.evaluate(() => {
      MelodyMode.state.isPlayingSequence = false;
      if (MelodyMode.state.mistakeTimeoutId) {
        clearTimeout(MelodyMode.state.mistakeTimeoutId);
        MelodyMode.state.mistakeTimeoutId = null;
      }
      MelodyMode.state.userIndex = 0;
    });

    const afterCorrect = await page.evaluate((m) => {
      MelodyMode.handleUserInputNote(m);
      return MelodyMode.state.userIndex;
    }, targetMidi);
    expect(afterCorrect, 'the exact target pitch must still count as correct').toBe(1);
  });

  test('INV-25: Melody\'s current-target readout shows an octave-qualified note name', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
    await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });

    const name = await page.evaluate(() => {
      const midi = MelodyMode.state.melody[MelodyMode.state.userIndex].midi;
      return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`; // octave-qualified, e.g. "E4"
    });

    const currentSpan = page.locator('#melody-note-list [data-note-role="current"]');
    await expect(currentSpan).toBeVisible();
    const currentText = (await currentSpan.textContent()).trim();
    expect(currentText, `the current note should read "${name}"`).toBe(name); // qualified name...
    const listText = (await page.locator('#melody-note-list').textContent()).replace(/\s+/g, ' ');
    expect(listText, 'the timeline no longer shows a frequency').not.toMatch(/\d+Hz/); // ...and no Hz
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-46: THE FOUNDING INVARIANT -- a cell always sounds its own pitch.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-46: the synth sounds each note at its own true getFrequency(midi), never octave-shifted', async ({ page }) => {
    // The founding invariant of the whole project: a cell at (p,q) sounds exactly
    // getFrequency(getMidi(p,q)) -- its own pitch, everywhere, always. Timbre/volume/decay may
    // vary; PITCH may not. The synth must therefore command a note's true frequency and never
    // fold it into a "comfortable" octave (which is a different pitch). Whether a device can
    // reproduce an extreme frequency is the device's business -- we still command the true one.
    const results = await page.evaluate(() => {
      // A fake AudioContext that records exactly the frequency our code assigns to each
      // oscillator (a real AudioParam would clamp above Nyquist -- a device limit -- masking
      // what WE commanded; here we capture the raw commanded value).
      const created = [];
      const fakeOsc = () => ({
        type: '', frequency: { value: 0, setValueAtTime() {} },
        connect() {}, start() {}, stop() {},
      });
      const fakeGain = () => ({
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      });
      Synth.ctx = {
        currentTime: 0, sampleRate: 44100,
        createOscillator() { const o = fakeOsc(); created.push(o); return o; },
        createGain: fakeGain,
      };
      Synth.master = {};

      const midis = [0, 15, 21, 60, 69, 108, 127, 130, 135];
      return midis.map((m) => {
        created.length = 0;
        Synth.playNote(m);
        // The FIRST oscillator created in the call is the note's fundamental (any later ones are
        // quiet harmonic reinforcement for low notes).
        return { midi: m, commanded: created[0].frequency.value, expected: Tonnetz.getFrequency(m) };
      });
    });
    for (const r of results) {
      expect(r.commanded, `MIDI ${r.midi} must sound at its own ${r.expected.toFixed(2)}Hz, not a folded pitch`)
        .toBeCloseTo(r.expected, 3);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-47: cross-mode copy/paste preserves true pitch.
  // ────────────────────────────────────────────────────────────────────────

  test('INV-47: copy/paste carries a cell set\'s pitch multiset across a mode switch', async ({ page }) => {
    // Copy a set of cells in Sandbox, switch modes, paste, and assert the pasted cells carry the
    // exact same multiset of pitches -- the corollary of INV-46 for material that travels.
    const copiedPitches = await page.evaluate(() => {
      SandboxMode.state.placedCells = [{ p: 0, q: 0 }, { p: 2, q: -1 }, { p: -1, q: 3 }];
      SandboxMode.refreshLattice();
      App.copy();
      document.querySelector('.mode-option[data-mode="life"]').click();
      return App.clipboard.map((c) => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b);
    });
    await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
    const pastedPitches = await page.evaluate(() => {
      LifeMode.clear();
      App.paste();
      return [...LifeMode.state.live.keys()]
        .map((k) => { const [p, q] = k.split(',').map(Number); return Tonnetz.getMidi(p, q); })
        .sort((a, b) => a - b);
    });
    expect(pastedPitches).toEqual(copiedPitches);
  });

  // ────────────────────────────────────────────────────────────────────────
  // INV-48: mode state is independent, and switching modes pauses it -- never
  // discards or advances it.
  // ────────────────────────────────────────────────────────────────────────
  //
  // A black-box "fingerprint" of a mode's visible state: every meaningfully-classed painted cell
  // on the shared #tonnetz-svg (placed pieces, live Life cells, the Snake body/gem, Gravity's
  // falling piece, Compose's selection rings), plus THIS mode's own on-screen counter/score text
  // (scoped to just this mode -- another mode's counter legitimately changes while you're away
  // interacting with it, and that must not register as a violation here). Built entirely from the
  // DOM a player actually sees -- never from a mode's internal `state` object, and identifying
  // each painted cell by its drawn geometry (`points`/`cx,cy`) rather than `data-p`/`data-q`,
  // since not every overlay hex sets those (Render.createHex only adds `data-*` when the caller
  // passes an explicit `data` option, which Snake's body/gem and Gravity's falling piece don't) --
  // so the test keeps working across internal refactors and genuinely proves what the player would
  // observe, not just what happens to be in memory or how a given mode happens to render it.
  const COUNTER_ID_FOR_MODE = {
    blast: 'lines-count', gravity: 'gravity-lines-count', snake: 'snake-score',
    life: 'life-generation', compose: 'compose-note-count', sandbox: null,
    melody: 'melody-current-streak',
  };
  const paintedFingerprint = async (page, mode) => page.evaluate((counterId) => {
    const MEANINGFUL_CLASSES = [
      'placed-piece', 'placed-cell', 'life-alive', 'snake-body', 'snake-head', 'snake-gem',
      'active-piece', 'compose-selected-note',
    ];
    const cells = [...document.querySelectorAll('#tonnetz-svg polygon, #tonnetz-svg circle')]
      .filter((el) => MEANINGFUL_CLASSES.some((c) => el.classList.contains(c)))
      .map((el) => `${[...el.classList].sort().join('.')}|${el.getAttribute('points') || (el.getAttribute('cx') + ',' + el.getAttribute('cy'))}`)
      .sort();
    const counterEl = counterId && document.getElementById(counterId);
    const counter = counterEl ? counterEl.textContent : null;
    return { cells, counter };
  }, COUNTER_ID_FOR_MODE[mode]);

  const switchTo = (page, mode) => page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

  // Every mode gets an entry here, unconditionally -- there's no such thing as a "stateless"
  // mode to legitimately exempt (previously named STATEFUL_MODES, implying an opt-in category
  // that doesn't actually exist: every mode in this app holds real state a player would notice
  // losing, and even a hypothetical mode with nothing worth preserving couldn't fail "state
  // survives a switch" either -- that holds vacuously when there's nothing to lose). Checked
  // against the live mode list below (INV-48 coverage), so a newly added mode with no entry
  // here fails loud instead of silently going unchecked, the way Melody's own did for a while.
  //
  // Each mutate() is a genuine UI interaction (a click, a keypress, or -- for Snake, whose board
  // advances on its own -- simply letting time pass), never a direct call into a mode's internal
  // API. It must leave the mode's fingerprint different from its own baseline; the test asserts
  // that itself, so a mutate() that silently stops doing anything (e.g. a piece that no longer
  // fits) would be caught rather than passing vacuously.
  const MODE_MUTATIONS = [
    { mode: 'sandbox', mutate: async (page) => {
      // A plain board tap never places a NEW piece on touch devices (sandbox.js's handleAction
      // deliberately excludes that case -- touch relies on the carousel's own place-wedge,
      // a drag, or swipe-down instead). The wedge places at the default hoverCell (0,0).
      const item = page.locator('.piece-item[data-key]:not(.note-tool-item)').first();
      await item.click({ force: true });
      await item.locator('.place-wedge').click({ force: true });
    } },
    { mode: 'blast', mutate: async (page) => {
      // Blast's hoverCell already defaults to (0,0), so a single click there is already a
      // "second click of the already-hovered cell" and places immediately.
      await page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]').first().click();
    } },
    { mode: 'gravity', mutate: async (page) => {
      await page.keyboard.press('ArrowLeft'); // shifts the falling piece one column
    } },
    { mode: 'snake', mutate: async (page) => {
      await page.waitForTimeout(900); // longer than the 700ms default tick -- the snake advances on its own
    } },
    { mode: 'life', mutate: async (page) => {
      await page.locator('#life-step').click();
    } },
    { mode: 'compose', mutate: async (page) => {
      await page.locator('#compose-record').click();
      await page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]').click();
      await page.locator('#compose-record').click();
    } },
    { mode: 'melody', mutate: async (page) => {
      // Wait out the intro "listen" playback (resetGame() -> playTargetSequence() runs on its
      // own timers) before answering, same as a real player would have to. Reads the actual
      // target note/melody rather than assuming one (Melody's own melody is whatever loaded --
      // often the random offline-degrade in a test environment with no network) -- a real tap on
      // the correct cell, not a direct state mutation, matching every other mode's own mutate().
      await page.waitForFunction(() => !MelodyMode.state.isPlayingSequence, { timeout: 5000 });
      const midi = await page.evaluate(() => MelodyMode.state.melody[MelodyMode.state.userIndex].midi);
      const coord = await page.evaluate((m) => Tonnetz.nearestCoordFor(m, { p: 0, q: 0 }), midi);
      await page.locator(`polygon.cell:not(.ghost)[data-p="${coord.p}"][data-q="${coord.q}"]`).click({ force: true });
    } },
  ];

  // INV-48 coverage: MODE_MUTATIONS and COUNTER_ID_FOR_MODE are both hand-maintained (a genuine
  // per-mode mutate() interaction and a genuine "which counter is this mode's own" decision
  // can't be derived from the DOM), but WHETHER every mode has an entry at all can be -- checked
  // here against the same live getModes() every other invariant test already trusts. Unlike
  // INV-13's PRIMARY_ELEMENTS/SECONDARY_ELEMENTS split, there's no legitimate exemption bucket
  // here: this is a plain equality check, not a classify-or-exempt one, since no mode is ever
  // correctly absent from either map (see the comment on MODE_MUTATIONS above for why).
  test('INV-48 coverage: every mode has a registered mutate() and counter, none forgotten', async ({ page }) => {
    await page.goto('/');
    const MODES = await getModes(page);
    expect(MODE_MUTATIONS.map((m) => m.mode).sort(), 'MODE_MUTATIONS').toEqual([...MODES].sort());
    expect(Object.keys(COUNTER_ID_FOR_MODE).sort(), 'COUNTER_ID_FOR_MODE').toEqual([...MODES].sort());
  });

  for (let i = 0; i < MODE_MUTATIONS.length; i++) {
    const { mode, mutate } = MODE_MUTATIONS[i];
    // Paired with the NEXT mode in the list (wrapping around) rather than every possible pair --
    // round-robin still puts every mode through both roles (the one switched away from, and the
    // one switched to) across the full suite, at 1/5th the runtime of a full pairwise sweep.
    // sandbox->blast->gravity->snake->life->compose->(sandbox) deliberately puts the two modes
    // known to have shared a single global Board (Blast, Gravity) back-to-back.
    const other = MODE_MUTATIONS[(i + 1) % MODE_MUTATIONS.length];

    test(`INV-48: ${mode}'s state survives a switch to ${other.mode} and back untouched`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');

      await switchTo(page, mode);
      if (mode === 'life') await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
      const baseline = await paintedFingerprint(page, mode);

      await mutate(page);
      const mutated = await paintedFingerprint(page, mode);
      expect(mutated, `${mode}'s own mutate() should have changed its fingerprint`).not.toEqual(baseline);

      // Switch away, mutate the OTHER mode too (proves the first mode's data can't leak into or
      // get overwritten by the second). Snapshot it IMMEDIATELY and switch on -- a real-time mode
      // like Snake legitimately keeps advancing for as long as it stays the active/displayed
      // mode, so the fingerprint used for later comparison has to be taken before any further
      // real time elapses while it's still on screen, not after.
      await switchTo(page, other.mode);
      if (other.mode === 'life') await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
      await other.mutate(page);
      const otherMutated = await paintedFingerprint(page, other.mode);

      // Back on the original mode: give real time for anything still running in the background (a
      // timer, an in-flight fetch) to misbehave if it were going to, THEN check. The fingerprint
      // must be EXACTLY what mutate() left it as -- not reset to a fresh start, not advanced by
      // whatever ticked while away, and not bled into by the other mode's own mutation.
      await switchTo(page, mode);
      await page.waitForTimeout(1200);
      const resumed = await paintedFingerprint(page, mode);
      expect(resumed, `${mode}'s state must resume exactly as left, not reset or advanced while away`).toEqual(mutated);

      // And the other mode's own state must likewise be untouched by switching back through it --
      // it was hidden (and its own timer, if any, paused) for the whole 1200ms above, so its
      // fingerprint on return must be identical to the moment we left it.
      await switchTo(page, other.mode);
      const otherResumed = await paintedFingerprint(page, other.mode);
      expect(otherResumed, `${other.mode}'s state must be independent of ${mode}'s -- no shared board/object`).toEqual(otherMutated);

      expect(errors).toEqual([]);
    });
  }

  // #46's spaced-repetition auto-advance adds cleanStreak/segmentHadMistake to MelodyMode.state --
  // untouched by cleanup()/init()'s resume branch (only resetGame() touches them, same as
  // targetLength/userIndex/startIndex already were per the INV-48 fix above), so they should
  // survive a switch away and back for free. paintedFingerprint() is deliberately a black-box DOM
  // check (see its own comment) with no visible on-screen representation of cleanStreak to catch
  // this, so it's asserted directly here instead, same spirit as the INV-25 tests that read
  // MelodyMode.state directly.
  test('INV-48: Melody\'s clean-streak survives a switch away and back untouched', async ({ page }) => {
    await page.goto('/');
    await switchTo(page, 'melody');
    await page.waitForFunction(() => !MelodyMode.state.isPlayingSequence, { timeout: 5000 });
    await page.evaluate(() => { MelodyMode.state.cleanStreak = 2; });

    await switchTo(page, 'blast');
    await page.waitForTimeout(300);
    await switchTo(page, 'melody');

    const streak = await page.evaluate(() => MelodyMode.state.cleanStreak);
    expect(streak).toBe(2);
  });

  // Issue #17's undo history (state.undoStack, js/undo-stack.js) is untouched by cleanup()/
  // init()'s resume branch in Sandbox/Blast/Life/Compose -- only an explicit New Game (Blast's
  // reset()) or loading a new automaton/file (Life's loadAutomaton(), Compose's
  // loadMelodyFromArrayBuffer()) clears it, same INV-48 shape as Melody's cleanStreak above.
  // paintedFingerprint() can't see it (no DOM representation), so asserted directly: place/toggle/
  // record something, switch away and back, undo, confirm it still reverses the pre-switch action
  // rather than being silently reset to empty.
  test('INV-48: Sandbox/Blast/Life/Compose\'s undo history survives a switch away and back untouched', async ({ page }) => {
    await page.goto('/');

    await switchTo(page, 'sandbox');
    await page.evaluate(() => {
      SandboxMode.state.selectedPiece = '.';
      SandboxMode.state.rotation = 0;
      SandboxMode.placePiece(2, 2);
    });

    await switchTo(page, 'blast');
    await page.evaluate(() => {
      BlastMode.state.activePiece = '.';
      BlastMode.state.rotation = 0;
      BlastMode.placePiece(1, 1);
    });

    await switchTo(page, 'life');
    await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
    await page.evaluate(() => LifeMode.toggleCell(20, 20));

    await switchTo(page, 'compose');
    await page.evaluate(() => {
      ComposeMode.state.notes = [];
      ComposeMode.state.isRecording = true;
      ComposeMode.tapCell(0, 0);
      ComposeMode.state.isRecording = false;
    });

    await switchTo(page, 'sandbox');
    await page.evaluate(() => SandboxMode.undo());
    expect(await page.evaluate(() => SandboxMode.state.placedPieces.length)).toBe(0);

    await switchTo(page, 'blast');
    await page.evaluate(() => BlastMode.undo());
    expect(await page.evaluate(() => Board.cells.size)).toBe(0);

    await switchTo(page, 'life');
    await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
    await page.evaluate(() => LifeMode.undo());
    expect(await page.evaluate(() => LifeMode.state.live.has('20,20'))).toBe(false);

    await switchTo(page, 'compose');
    await page.evaluate(() => ComposeMode.undo());
    expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(0);
  });
});
