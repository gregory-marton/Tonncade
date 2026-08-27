const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { replayEvents } = require('./helpers/replay-driver');

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
 * The only liberty taken from the real recorded events: dropping the trailing `#report-bug-link`
 * click (reporting the session isn't part of playing it). The leading `resize` is still set
 * directly (it's always the very first event, before navigation can even happen) -- but any
 * LATER resize in a session (a deliberate window/orientation change mid-play) genuinely replays
 * now, via tests/helpers/replay-driver.js's shared `replayEvents()`, not dropped as a liberty.
 * That module is also what every story below actually calls to dispatch its events -- see its own
 * file header for the full faithfulness reasoning (tick catch-up, key/click resolution, resize),
 * extracted there once several stories needed the identical logic.
 *
 * Gravity's own story adds two more things, both load-bearing:
 *
 * 3. Deterministic tick replay. Real-time drop intervals (js/gravity.js's updateSpeed) make
 *    wall-clock timing an unreliable way to reconstruct which automatic GravityMode.tick()
 *    advances had fired between two recorded keydowns. js/replay.js's Replay.recordTick() stamps
 *    every event with the running tick count instead, so replay just catches up to that exact
 *    count (calling tick() directly, no timing involved) before applying each event -- the same
 *    mechanism scripts/replay-to-gif.js uses for its own faithful replays.
 * 4. A committed fixture file (tests/fixtures/), not an inline literal. Blast's own story embeds
 *    its ~140 events directly in this file (see above); Gravity sessions run far longer (this one
 *    is 2843 keydowns across 2873 ticks, ending in a genuine Game Over), so the events alone are
 *    ~290KB -- unwieldy as hand-reviewable source. The fixture is still the real, unedited capture
 *    (seed + events only; the CLI-only sound-verification trace is dropped, since this test
 *    asserts final board state instead), just stored where a large real asset belongs -- the same
 *    reasoning as desktop.spec.js's loadFrereJacques fetching a real bundled .mid rather than
 *    inlining its bytes.
 *
 * This session started already inside Gravity via a deep link (`#gravity` in the address bar) --
 * Replay.log only records real events, so a session that opens straight into a non-default mode
 * never has an actual mode-switch click to replay. `?seed=` and `#gravity` in the same navigation
 * is exactly what following a real shared deep-link looks like.
 *
 * Title convention: `'<Mode> story (<Interface>): <what it verifies>'`, Interface being one of
 * Desktop/Mobile/Tablet/Safari, matching playwright.config.js's project names (Mobile Safari's
 * device profile just gets called "Safari" here for brevity). scripts/check-story-coverage.js
 * parses titles against this pattern to cross-check docs/story-coverage.md's matrix, so keep new
 * stories -- here or in the per-interface stories.mobile.spec.js/stories.tablet.spec.js siblings
 * -- titled this way.
 */

test.describe('Story tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => { throw err; });
    // Game Over fires a real alert() -- accept it so the test doesn't hang waiting on a dialog.
    page.on('dialog', async d => { await d.accept(); });
    // A full real play session fires real Synth notes throughout. Chromium gets --mute-audio
    // from Playwright automatically; WebKit has no such flag and was reaching real speakers.
    // Muting at the Web Audio graph (never connecting an oscillator to the destination) stays
    // silent on every browser and doesn't touch .frequency/.type/etc, unlike addInitScript-set
    // Math.random seeding elsewhere in this file (see the file header) -- this isn't that; it's
    // AudioContext.prototype, which Replay.init() never touches.
    await page.addInitScript(() => {
      const proto = (window.AudioContext || window.webkitAudioContext).prototype;
      const realCreateOscillator = proto.createOscillator;
      proto.createOscillator = function(...args) {
        const osc = realCreateOscillator.apply(this, args);
        osc.connect = () => {};
        return osc;
      };
    });
  });

  test('Blast story (Desktop): a real captured session plays through deterministically', async ({ page }) => {
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

    // No tick data on this older capture -- replayEvents skips catch-up entirely (tickFn: null),
    // dispatching pointerdown('polygon')/keydown as fast as Playwright itself can go.
    await replayEvents(page, gameplayEvents.slice(1), { tickFn: null });

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

  test('Gravity story (Desktop): a real captured session plays through to Game Over deterministically', async ({ page }) => {
    // 2843 real keydowns, each its own round-trip -- comfortably over the default 30s.
    test.setTimeout(120000);
    const fixturePath = path.join(__dirname, 'fixtures', 'gravity-story-20260820053007.json');
    const { seed, events } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    // events[0] is the real resize -- viewport set directly (see file header).
    const viewport = events[0];
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // Freeze real time BEFORE navigating -- Gravity's own timer (js/gravity.js's startTimer, a
    // real setInterval) would otherwise keep firing tick() on actual wall-clock time throughout
    // this test's own real execution time, advancing the game uncontrolled and IN ADDITION to the
    // explicit tick catch-up below (confirmed live: without this, the same session reached only
    // linesCleared=20 before an early Game Over, not the real 79 -- extra, untracked ticks fired
    // by the real timer let pieces free-fall further than the recorded player ever steered them).
    await page.clock.install({ time: 0 });

    // Deep-link straight into Gravity, same navigation as the seed -- see file header on why
    // there's no mode-switch click to replay for this particular session.
    await page.goto(`/?seed=${seed}#gravity`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mode-option[data-mode="gravity"]')).toHaveClass(/active/);
    // Freeze at whatever the (real-time-ticking-since-install) fake clock currently reads --
    // jumping it backward to a fixed value like 0 would move Date.now() into the past.
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    // Deterministic tick replay (see file header / replay-driver.js) -- catch up to each event's
    // own recorded tick count before applying it. Drops events[0] (resize, handled above) and the
    // final two events (the report-bug-link pointerdown/pointerup -- reporting the session isn't
    // part of playing it, see file header); every remaining event in this particular capture is a
    // keydown.
    await replayEvents(page, events.slice(1, events.length - 2), {
      tickFn: 'GravityMode.tick',
      startTick: events[0].tick || 0,
    });

    // The exact real outcome of replaying this exact real session -- verified by actually running
    // it (not derived by hand), so this is a regression baseline covering Gravity's falling
    // physics as a whole (piece-origin rigidity, rest-time welding, off-board recovery, whole-line
    // clearing) across a full game reaching a genuine Game Over, not any one mechanism in
    // isolation.
    const final = await page.evaluate(() => ({
      linesCleared: GravityMode.state.linesCleared,
      cellCount: GravityBoard.cells.size,
      isGameOver: GravityMode.state.isGameOver,
      difficulty: GravityMode.state.difficulty,
    }));
    expect(final.linesCleared).toBe(79);
    expect(final.cellCount).toBe(82);
    expect(final.isGameOver).toBe(true);
    expect(final.difficulty).toBe(3);

    await page.screenshot({ path: 'test-results/gravity-story-final.png' });
  });

  test('Snake story (Desktop): a real captured session plays through to a genuine wall death, deterministically', async ({ page }) => {
    // The real recorded session was actually TWO games back to back (a reset in between), but a
    // real gap in the second game's own recorded event log (something real happened between two
    // consecutive keydowns that didn't make it into Replay.log -- confirmed live by tracing the
    // tick math step by step; not a bug in this replay mechanism) makes it impossible to
    // faithfully reconstruct. Using the real, complete, verified FIRST game only -- a genuine
    // contiguous prefix of the actual capture, not a fabricated or edited sequence.
    const seed = 1495698635;

    // The real session's own initial viewport was 975x1309 portrait -- start there; the resize to
    // the settled 1807x1309 landscape happens naturally when replayEvents reaches the real
    // recorded `resize` event a moment into the session (see below), not set directly the way
    // every other story here still does with its own leading resize (those don't carry a resize
    // event this far into gameplay; this one does, so it gets to actually replay it).
    await page.setViewportSize({ width: 975, height: 1309 });

    // Freeze real time BEFORE navigating -- same reasoning as Gravity's story above: Snake's own
    // timer (js/snake.js's startTimer, a real setInterval) would otherwise keep firing tick() on
    // actual wall-clock time throughout this test's own execution, in addition to the explicit
    // tick catch-up below. This also makes flourish steps (js/snake.js's playFlourish/tick, driven
    // at a fixed 100ms cadence while isFlourishing) replay correctly for free: they're driven
    // through this SAME tick() entry point and counted by the SAME Replay.recordTick(), so calling
    // tick() directly the recorded number of times reconstructs them without any special-casing.
    await page.clock.install({ time: 0 });

    // Deep-linked straight into Snake (`#snake`) -- no mode-switch click to replay, same as
    // Gravity's story above. The real session's own leading events -- a Space press (toggling
    // pause once before any real move) and the automatic `reset` marker from first entry -- are
    // dropped: the reset already happens naturally via SnakeMode.init() on this navigation, and
    // isn't itself a replayable input (see js/snake.js's reset()/gameOver(), which record it as a
    // side-effect marker, not something a replay tool should try to re-trigger directly).
    await page.goto(`/?seed=${seed}#snake`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mode-option[data-mode="snake"]')).toHaveClass(/active/);
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    // Exactly window.replay()'s events for this real session's first game (from the first real
    // keydown after the automatic reset, through the `gameover` marker that ends it) -- minus the
    // leading resize/reset and trailing second game (see comments above).
    const gameplayEvents = [{"type":"keydown","t":1787447980650,"key":" ","code":"Space","shiftKey":false,"tick":1},{"type":"keydown","t":1787447982298,"key":"Meta","code":"MetaLeft","shiftKey":false,"tick":1},{"type":"keydown","t":1787447982334,"key":"Alt","code":"AltLeft","shiftKey":false,"tick":1},{"type":"keydown","t":1787447982703,"key":"Ű","code":"KeyI","shiftKey":false,"tick":1},{"type":"resize","t":1787447982722,"width":1807,"height":1309,"orientation":"landscape","tick":1},{"type":"keydown","t":1787447985569,"key":" ","code":"Space","shiftKey":false,"tick":1},{"type":"keydown","t":1787447988206,"key":"b","code":"KeyB","shiftKey":false,"tick":4},{"type":"keydown","t":1787447988974,"key":"f","code":"KeyF","shiftKey":false,"tick":5},{"type":"keydown","t":1787447990181,"key":"v","code":"KeyV","shiftKey":false,"tick":7},{"type":"keydown","t":1787447994631,"key":"h","code":"KeyH","shiftKey":false,"tick":18},{"type":"keydown","t":1787447996113,"key":"y","code":"KeyY","shiftKey":false,"tick":20},{"type":"keydown","t":1787448000170,"key":"t","code":"KeyT","shiftKey":false,"tick":26},{"type":"keydown","t":1787448003491,"key":"f","code":"KeyF","shiftKey":false,"tick":35},{"type":"keydown","t":1787448006526,"key":"v","code":"KeyV","shiftKey":false,"tick":40},{"type":"keydown","t":1787448009530,"key":"t","code":"KeyT","shiftKey":false,"tick":50},{"type":"keydown","t":1787448010711,"key":"y","code":"KeyY","shiftKey":false,"tick":52},{"type":"keydown","t":1787448014034,"key":"h","code":"KeyH","shiftKey":false,"tick":57},{"type":"keydown","t":1787448017122,"key":"v","code":"KeyV","shiftKey":false,"tick":68},{"type":"keydown","t":1787448018848,"key":"f","code":"KeyF","shiftKey":false,"tick":71},{"type":"keydown","t":1787448022189,"key":"y","code":"KeyY","shiftKey":false,"tick":75},{"type":"keydown","t":1787448023217,"key":"f","code":"KeyF","shiftKey":false,"tick":77},{"type":"keydown","t":1787448023885,"key":"y","code":"KeyY","shiftKey":false,"tick":78},{"type":"keydown","t":1787448024931,"key":"h","code":"KeyH","shiftKey":false,"tick":86},{"type":"keydown","t":1787448027437,"key":"b","code":"KeyB","shiftKey":false,"tick":91},{"type":"keydown","t":1787448029219,"key":"y","code":"KeyY","shiftKey":false,"tick":100},{"type":"keydown","t":1787448031881,"key":"h","code":"KeyH","shiftKey":false,"tick":109},{"type":"keydown","t":1787448032546,"key":"b","code":"KeyB","shiftKey":false,"tick":116},{"type":"keydown","t":1787448035335,"key":"v","code":"KeyV","shiftKey":false,"tick":120},{"type":"keydown","t":1787448037297,"key":"t","code":"KeyT","shiftKey":false,"tick":123},{"type":"keydown","t":1787448039189,"key":"y","code":"KeyY","shiftKey":false,"tick":126},{"type":"keydown","t":1787448039616,"key":"t","code":"KeyT","shiftKey":false,"tick":127},{"type":"keydown","t":1787448041457,"key":"v","code":"KeyV","shiftKey":false,"tick":140},{"type":"keydown","t":1787448044061,"key":"b","code":"KeyB","shiftKey":false,"tick":144},{"type":"keydown","t":1787448045217,"key":"v","code":"KeyV","shiftKey":false,"tick":145},{"type":"keydown","t":1787448045581,"key":"b","code":"KeyB","shiftKey":false,"tick":146},{"type":"keydown","t":1787448050610,"key":"y","code":"KeyY","shiftKey":false,"tick":161},{"type":"keydown","t":1787448054497,"key":"t","code":"KeyT","shiftKey":false,"tick":171},{"type":"keydown","t":1787448059672,"key":"v","code":"KeyV","shiftKey":false,"tick":190},{"type":"keydown","t":1787448063092,"key":"b","code":"KeyB","shiftKey":false,"tick":196},{"type":"keydown","t":1787448066204,"key":"y","code":"KeyY","shiftKey":false,"tick":207},{"type":"keydown","t":1787448070406,"key":"h","code":"KeyH","shiftKey":false,"tick":220},{"type":"keydown","t":1787448072843,"key":"t","code":"KeyT","shiftKey":false,"tick":230},{"type":"keydown","t":1787448077105,"key":"f","code":"KeyF","shiftKey":false,"tick":244},{"type":"keydown","t":1787448082555,"key":"b","code":"KeyB","shiftKey":false,"tick":267},{"type":"keydown","t":1787448090001,"key":"y","code":"KeyY","shiftKey":false,"tick":285},{"type":"keydown","t":1787448093513,"key":"t","code":"KeyT","shiftKey":false,"tick":299},{"type":"keydown","t":1787448095029,"key":"y","code":"KeyY","shiftKey":false,"tick":308},{"type":"keydown","t":1787448098237,"key":"t","code":"KeyT","shiftKey":false,"tick":334},{"type":"keydown","t":1787448102452,"key":"v","code":"KeyV","shiftKey":false,"tick":346},{"type":"keydown","t":1787448107651,"key":"b","code":"KeyB","shiftKey":false,"tick":355},{"type":"keydown","t":1787448109470,"key":"y","code":"KeyY","shiftKey":false,"tick":360},{"type":"keydown","t":1787448110334,"key":"h","code":"KeyH","shiftKey":false,"tick":369},{"type":"keydown","t":1787448114467,"key":"y","code":"KeyY","shiftKey":false,"tick":383},{"type":"keydown","t":1787448116847,"key":"f","code":"KeyF","shiftKey":false,"tick":387},{"type":"keydown","t":1787448118216,"key":"y","code":"KeyY","shiftKey":false,"tick":390},{"type":"keydown","t":1787448119200,"key":"t","code":"KeyT","shiftKey":false,"tick":391},{"type":"keydown","t":1787448120394,"key":"v","code":"KeyV","shiftKey":false,"tick":393},{"type":"keydown","t":1787448120872,"key":"t","code":"KeyT","shiftKey":false,"tick":394},{"type":"keydown","t":1787448121566,"key":"v","code":"KeyV","shiftKey":false,"tick":395},{"type":"keydown","t":1787448121902,"key":"t","code":"KeyT","shiftKey":false,"tick":396},{"type":"keydown","t":1787448124396,"key":"f","code":"KeyF","shiftKey":false,"tick":409},{"type":"keydown","t":1787448128794,"key":"y","code":"KeyY","shiftKey":false,"tick":432},{"type":"keydown","t":1787448132396,"key":"h","code":"KeyH","shiftKey":false,"tick":451},{"type":"keydown","t":1787448137425,"key":"v","code":"KeyV","shiftKey":false,"tick":478},{"type":"keydown","t":1787448138689,"key":"f","code":"KeyF","shiftKey":false,"tick":481},{"type":"keydown","t":1787448139738,"key":"b","code":"KeyB","shiftKey":false,"tick":483},{"type":"keydown","t":1787448140540,"key":"y","code":"KeyY","shiftKey":false,"tick":484},{"type":"gameover","t":1787448140585,"score":20,"tick":485}];

    // Deterministic tick replay (see file header / Gravity's story above / replay-driver.js) --
    // catch up to each event's own recorded tick count before applying it. The mid-session resize
    // in here (portrait -> landscape) now genuinely replays too (see replay-driver.js), though for
    // THIS particular session it's a same-size no-op either way, since the starting viewport above
    // is already the settled 1807x1309.
    await replayEvents(page, gameplayEvents, { tickFn: 'SnakeMode.tick', startTick: 0 });

    // The exact real outcome of replaying this exact real session -- verified by actually running
    // it (not derived by hand) -- covering movement, gem-eating/growth, the flourish arpeggio
    // (driven through the same tick() entry point as movement), and a genuine wall death.
    const final = await page.evaluate(() => ({
      score: SnakeMode.state.score,
      isGameOver: SnakeMode.state.isGameOver,
      snakeLength: SnakeMode.state.snake.length,
    }));
    expect(final.score).toBe(20);
    expect(final.isGameOver).toBe(true);
    expect(final.snakeLength).toBe(23);

    await page.screenshot({ path: 'test-results/snake-story-final.png' });
  });

  // Real bug found while investigating issue #23/#29: a virtual D-pad button's click handler
  // (js/main.js's bindBtn) dispatches its own synthetic keydown SYNCHRONOUSLY, which
  // Replay.record()'s window-level keydown listener also captures as its own separate log entry
  // -- so one physical tap leaves BOTH a pointerdown and a keydown in the log, even though they're
  // the same action, not two inputs. scripts/replay-to-gif.js already accounts for this
  // (isVirtualButtonTarget + a 50ms "echo" window that skips the redundant keydown), but this
  // shared replayEvents() never did, silently double-firing every #m-btn-*/#snake-btn-* press.
  // Snake's steering (an assignment, not an increment) and Gravity's wall-clamped movement happen
  // to be idempotent enough that this stayed invisible in the existing stories above -- Blast's
  // free-roaming, unclamped hoverCell (this.state.hoverCell.p += move.p) is not: double-firing a
  // movement press compounds every single time, and a long D-pad-heavy session drifts the hover
  // cell far off-board within a few hundred presses (found live while deriving a seed for a
  // Snake mobile story, via a Blast session's own board state visibly running away to
  // p=-32,q=-263). Uses Gravity's rotation (a real increment, `(rotation+1)%6`) as the smallest
  // reproducible case of the same underlying bug.
  test('replayEvents does not double-fire a virtual D-pad button\'s action from its echoed keydown', async ({ page }) => {
    // #m-btn-cw only exists (is visible/clickable) on a mobile-width viewport (.mobile-only) --
    // on desktop's default viewport the pointerdown's own .click() silently no-ops (caught by
    // resolvePointerdown's .catch()), leaving only the explicit keydown to apply a single,
    // falsely-reassuring rotation that looks correct by accident, not because double-firing
    // isn't happening. Found live debugging this exact test.
    await page.setViewportSize({ width: 411, height: 761 });
    await page.clock.install({ time: 0 });
    await page.goto('/#gravity');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mode-option[data-mode="gravity"]')).toHaveClass(/active/);
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    const before = await page.evaluate(() => GravityMode.state.rotation);
    // Exactly what a real recorded #m-btn-cw press looks like: pointerdown (which itself
    // dispatches this same keydown synchronously via bindBtn), the echoed keydown, pointerup.
    await replayEvents(page, [
      { type: 'pointerdown', t: 1000, target: '#m-btn-cw' },
      { type: 'keydown', t: 1000, key: ' ', code: 'Space', shiftKey: true },
      { type: 'pointerup', t: 1050, target: '#m-btn-cw' },
    ], {});
    const after = await page.evaluate(() => GravityMode.state.rotation);

    // Gravity's shiftKey=true handler applies (rotation + 5) % 6 per press (see js/gravity.js) --
    // a real screen-coordinate-vs-lattice-rotation-direction quirk, not a typo (see js/main.js's
    // own "rotation direction" comment next to this same bindBtn call). One real press should
    // land here; double-firing would instead give (5+5)%6 = 4.
    expect((after - before + 6) % 6, 'one recorded press should rotate exactly once, not twice').toBe(5);
  });
});
