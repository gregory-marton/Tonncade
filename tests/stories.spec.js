const { test, expect } = require('@playwright/test');

/**
 * STORY TESTS
 *
 * Unlike mobile.spec.js/desktop.spec.js/invariants.spec.js, which each verify one narrow
 * mechanism (often by reaching directly into SandboxMode.state/GravityMode.state to set up a
 * scenario quickly), these drive a full, realistic play session through real interaction only —
 * clicking the actual controls a player would click, never assigning game state directly. The
 * point is to catch bugs that only show up across a *sequence* of actions, not in any one of
 * them in isolation (e.g. a control that's perfectly reachable but does the wrong thing when
 * pressed — spatial-reachability checks like INV-13 can't catch that; only actually pressing it
 * and checking the outcome can).
 *
 * Each story here is built from a REAL captured session (js/replay.js's window.replay(), filed
 * live via the bug-report link — see github.com/gregory-marton/Tonncade/issues/1), not a
 * hand-written or purpose-built move sequence. An earlier version of this file drove a story
 * with every next piece forced to 'O' via GravityMode.randomPiece() overridden directly, which
 * was rightly called out live as "wildly unfaithful": it didn't test the code that actually
 * gives players pieces, it replaced it.
 *
 * Two things make a replay actually faithful, both learned the hard way while building this:
 *
 * 1. Seed via the `?seed=` URL param, NOT page.addInitScript(). js/replay.js's own Replay.init()
 *    runs at App.init() and calls seedRandom() unconditionally, which overwrites Math.random()
 *    again with fresh entropy unless it finds ?seed= in the URL -- an addInitScript-set seed
 *    gets silently clobbered on every load. This was confirmed the hard way: the exact same
 *    replay produced a different outcome on every run (cell counts of 28, 32, 36, 44...) until
 *    switching to ?seed= made it land on the identical real outcome every single time.
 * 2. Resolve each tap to its real target cell via document.elementFromPoint() + the cell's own
 *    data-p/data-q (exactly what the app itself reads in its click handler), then use
 *    Playwright's own .click() on that element -- rather than replaying raw coordinates via
 *    manual mouse.move()/down()/up(), which is both less robust and no more faithful (the
 *    coordinates only ever mattered as a way to name which cell was tapped).
 *
 * The only liberties taken from the real recorded events: dropping the leading `resize` (the
 * viewport is set directly instead) and the trailing `#report-bug-link` click (reporting the
 * session isn't part of playing it).
 */

test.describe('Story tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => { throw err; });
    // Game Over fires a real alert() -- accept it so the test doesn't hang waiting on a dialog.
    page.on('dialog', async d => { await d.accept(); });
  });

  test('Blast story: a real captured session plays through deterministically', async ({ page }) => {
    const seed = 2251539051;
    await page.setViewportSize({ width: 1179, height: 868 });
    await page.goto(`/?seed=${seed}`);
    await page.waitForLoadState('networkidle');

    // Exactly window.replay()'s events for this real session (minus the leading resize and
    // trailing bug-report click -- see file header).
    const gameplayEvents = [
      {"type":"pointerdown","t":1784431143747,"x":1016.86328125,"y":30.203125,"target":"div.mode-option"},{"type":"pointerup","t":1784431143749,"x":1016.86328125,"y":30.203125,"target":"div.mode-option"},{"type":"pointerdown","t":1784431146521,"x":959.7734375,"y":494.08203125,"target":"polygon"},{"type":"pointerup","t":1784431146529,"x":959.7734375,"y":494.08203125,"target":"polygon"},{"type":"keydown","t":1784431147844,"key":" ","code":"Space","shiftKey":false},{"type":"pointerdown","t":1784431148575,"x":850.62890625,"y":514.625,"target":"polygon"},{"type":"pointerup","t":1784431148582,"x":850.62890625,"y":514.625,"target":"polygon"},{"type":"pointerdown","t":1784431150299,"x":714.2421875,"y":522.01953125,"target":"polygon"},{"type":"pointerup","t":1784431150307,"x":714.2421875,"y":522.01953125,"target":"polygon"},{"type":"pointerdown","t":1784431151833,"x":842.91796875,"y":462.34375,"target":"polygon"},{"type":"pointerup","t":1784431151840,"x":842.91796875,"y":462.34375,"target":"polygon"},{"type":"pointerdown","t":1784431153826,"x":647.99609375,"y":479.7109375,"target":"polygon"},{"type":"pointerup","t":1784431153832,"x":647.99609375,"y":479.7109375,"target":"polygon"},{"type":"pointerdown","t":1784431155435,"x":546.359375,"y":485.69921875,"target":"polygon"},{"type":"pointerup","t":1784431155443,"x":546.359375,"y":485.69921875,"target":"polygon"},{"type":"pointerdown","t":1784431156587,"x":475.75,"y":482.2421875,"target":"polygon"},{"type":"pointerup","t":1784431156596,"x":475.75,"y":482.2421875,"target":"polygon"},{"type":"keydown","t":1784431157907,"key":" ","code":"Space","shiftKey":false},{"type":"pointerdown","t":1784431162886,"x":422.69921875,"y":538.1796875,"target":"polygon"},{"type":"pointerup","t":1784431162894,"x":422.69921875,"y":538.1796875,"target":"polygon"},{"type":"keydown","t":1784431164490,"key":" ","code":"Space","shiftKey":false},{"type":"keydown","t":1784431164857,"key":" ","code":"Space","shiftKey":false},{"type":"keydown","t":1784431165190,"key":" ","code":"Space","shiftKey":false},{"type":"keydown","t":1784431165590,"key":" ","code":"Space","shiftKey":false},{"type":"keydown","t":1784431167552,"key":" ","code":"Space","shiftKey":false},{"type":"pointerdown","t":1784431169512,"x":933.59765625,"y":371.33984375,"target":"polygon"},{"type":"pointerup","t":1784431169514,"x":933.59765625,"y":371.33984375,"target":"polygon"},{"type":"pointerdown","t":1784431170569,"x":995.21484375,"y":325.78125,"target":"polygon"},{"type":"pointerup","t":1784431170574,"x":995.21484375,"y":325.78125,"target":"polygon"},{"type":"pointerdown","t":1784431171483,"x":1002.8359375,"y":238.84765625,"target":"polygon"},{"type":"pointerup","t":1784431171490,"x":1002.8359375,"y":238.84765625,"target":"polygon"},{"type":"pointerdown","t":1784431172328,"x":968.21875,"y":275.453125,"target":"polygon"},{"type":"pointerup","t":1784431172332,"x":968.21875,"y":275.453125,"target":"polygon"},{"type":"keydown","t":1784431173290,"key":" ","code":"Space","shiftKey":false},{"type":"keydown","t":1784431173515,"key":" ","code":"Space","shiftKey":false},{"type":"keydown","t":1784431173753,"key":" ","code":"Space","shiftKey":false},{"type":"pointerdown","t":1784431174751,"x":542.05859375,"y":278.08203125,"target":"polygon"},{"type":"pointerup","t":1784431174758,"x":542.05859375,"y":278.08203125,"target":"polygon"},{"type":"keydown","t":1784431176061,"key":" ","code":"Space","shiftKey":false},{"type":"pointerdown","t":1784431177316,"x":412.36328125,"y":510.50390625,"target":"polygon"},{"type":"pointerup","t":1784431177325,"x":412.36328125,"y":510.50390625,"target":"polygon"},{"type":"pointerdown","t":1784431180933,"x":585.46875,"y":523.43359375,"target":"polygon"},{"type":"pointerup","t":1784431180941,"x":585.46875,"y":523.43359375,"target":"polygon"},{"type":"pointerdown","t":1784431182921,"x":607.85546875,"y":644.7890625,"target":"polygon"},{"type":"pointerup","t":1784431182929,"x":607.85546875,"y":644.7890625,"target":"polygon"},{"type":"pointerdown","t":1784431183978,"x":616.37890625,"y":763.43359375,"target":"polygon"},{"type":"pointerup","t":1784431183988,"x":616.37890625,"y":763.43359375,"target":"polygon"},{"type":"pointerdown","t":1784431186437,"x":838.55859375,"y":691.09765625,"target":"polygon"},{"type":"pointerup","t":1784431186446,"x":838.55859375,"y":691.09765625,"target":"polygon"},{"type":"pointerdown","t":1784431188701,"x":735.3671875,"y":545.58203125,"target":"polygon"},{"type":"pointerup","t":1784431188709,"x":735.3671875,"y":545.58203125,"target":"polygon"},{"type":"pointerdown","t":1784431191926,"x":911.16796875,"y":635.51171875,"target":"polygon"},{"type":"pointerup","t":1784431191927,"x":911.16796875,"y":635.51171875,"target":"polygon"},{"type":"pointerdown","t":1784431192209,"x":911.16796875,"y":635.51171875,"target":"polygon"},{"type":"pointerup","t":1784431192215,"x":911.16796875,"y":635.51171875,"target":"polygon"},{"type":"pointerdown","t":1784431192916,"x":919.57421875,"y":595.4921875,"target":"polygon"},{"type":"pointerup","t":1784431192923,"x":919.57421875,"y":595.4921875,"target":"polygon"},{"type":"pointerdown","t":1784431194432,"x":998.26953125,"y":464.84765625,"target":"polygon"},{"type":"pointerup","t":1784431194440,"x":998.26953125,"y":464.84765625,"target":"polygon"},{"type":"pointerdown","t":1784431195817,"x":760.00390625,"y":411.6796875,"target":"polygon"},{"type":"pointerup","t":1784431195825,"x":760.00390625,"y":411.6796875,"target":"polygon"},{"type":"pointerdown","t":1784431197583,"x":868.54296875,"y":362.83203125,"target":"polygon"},{"type":"pointerup","t":1784431197591,"x":868.54296875,"y":362.83203125,"target":"polygon"},{"type":"pointerdown","t":1784431199473,"x":905.9921875,"y":216.2890625,"target":"polygon"},{"type":"pointerup","t":1784431199479,"x":905.9921875,"y":216.2890625,"target":"polygon"},{"type":"pointerdown","t":1784431200208,"x":828.578125,"y":208.171875,"target":"polygon"},{"type":"pointerup","t":1784431200214,"x":828.578125,"y":208.171875,"target":"polygon"},{"type":"pointerdown","t":1784431202076,"x":674.19921875,"y":276.03125,"target":"polygon"},{"type":"pointerup","t":1784431202087,"x":674.19921875,"y":276.03125,"target":"polygon"},{"type":"pointerdown","t":1784431203450,"x":618.7578125,"y":181.6875,"target":"polygon"},{"type":"pointerup","t":1784431203460,"x":618.7578125,"y":181.6875,"target":"polygon"}
    ];

    // The first event is the real player tapping "Blast" on the mode slider. Unlike the Tonnetz
    // taps below (where the raw pixel IS the thing under test -- it's what determines which
    // cell got placed), the mode slider is a plain UI button whose on-screen position shifts
    // whenever a mode is added/removed (e.g. Compose mode's addition moved Blast over by one
    // slot) -- pinning this one click to a stale pixel position would just be testing yesterday's
    // layout. A data-mode locator captures the real intent ("click Blast") without depending on
    // where the slider happens to lay it out today.
    await page.locator('.mode-option[data-mode="blast"]').click();
    await expect(page.locator('.mode-option[data-mode="blast"]')).toHaveClass(/active/);

    for (let i = 1; i < gameplayEvents.length; i++) {
      const ev = gameplayEvents[i];
      if (ev.type === 'pointerdown') {
        // Resolve to the real cell that was actually under this coordinate, then click THAT
        // element -- exactly what js/blast.js's own svg.onmousedown reads (data-p/data-q), and
        // more robust than replaying the raw pixel.
        const cell = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el || el.tagName.toLowerCase() !== 'polygon') return null;
          return { p: el.getAttribute('data-p'), q: el.getAttribute('data-q') };
        }, { x: ev.x, y: ev.y });
        if (cell) {
          await page.locator(`polygon[data-p="${cell.p}"][data-q="${cell.q}"]`).first().click({ force: true });
        }
      } else if (ev.type === 'keydown') {
        await page.keyboard.press(ev.code === 'Space' ? 'Space' : ev.key);
      }
      // pointerup needs no separate action -- .click() above already completed the gesture.
    }

    // The exact real outcome of replaying this exact real session -- verified by actually
    // running it (not derived by hand), so this is a regression baseline: if a future change to
    // Blast's placement, rotation, or collision logic ever alters what this specific real
    // sequence of taps and rotations produces, this is the test that catches it.
    //
    // These values changed under #48 (aspect-matched viewBox fit, matching Gravity's #44): each
    // pointerdown is resolved to a cell via document.elementFromPoint() at the ORIGINAL recorded
    // pixel coordinates, so any change to how the board's viewBox maps pixels to cells shifts
    // which cell each recorded coordinate now lands on -- inherent to pinning a test to raw
    // screen pixels rather than app state. Originally this session reached a genuine Game Over
    // (linesCleared: 2, cellCount: 63); under the corrected fit the same real taps now land on
    // different cells and the session ends earlier without clearing a line. Coverage of the
    // Game Over path is lost until a fresh real session is captured under the new layout.
    const final = await page.evaluate(() => ({
      linesCleared: BlastMode.state.linesCleared,
      cellCount: Board.cells.size,
      isGameOver: BlastMode.state.isGameOver,
    }));
    expect(final.linesCleared).toBe(0);
    expect(final.cellCount).toBe(40);
    expect(final.isGameOver).toBe(false);

    await page.screenshot({ path: 'test-results/blast-story-final.png' });
  });
});
