const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { replayEvents } = require('./helpers/replay-driver');

/**
 * MOBILE STORY TESTS
 *
 * See tests/stories.desktop.spec.js's file header for what a story test is, why it's built from
 * a REAL captured session (never hand-written), and the shared faithfulness mechanism
 * (tests/helpers/replay-driver.js) every story -- desktop or here -- actually replays through.
 * Only runs under Mobile Chrome (see playwright.config.js's testMatch), since that's the real
 * device profile (touch, mobile UA, mobile viewport) the session below was actually captured on.
 *
 * Title convention: same as tests/stories.desktop.spec.js's -- '<Mode> story (<Interface>): ...'.
 */

test.describe('Mobile story tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => { throw err; });
    page.on('dialog', async d => { await d.accept(); });
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

  test('Blast story (Mobile): a real long captured session plays through deterministically, no error', async ({ page }) => {
    // 6644 real pointer events, each its own elementFromPoint + locator round-trip.
    test.setTimeout(120000);

    // Filed live via the bug-report link (github.com/gregory-marton/Tonncade/issues/20) as "just
    // a nice long playthrough on mobile. No error, all went well" -- not a bug report, but real
    // evidence this exact session is worth a permanent regression baseline: real touch taps on a
    // real Android phone (411x761 portrait), captured over several real sessions (note the ~7-hour
    // idle gap partway through, in the raw capture's timestamps -- harmless to replay, since Blast
    // has no automatic tick()-driven advancement to desync from real elapsed time).
    const fixturePath = path.join(__dirname, 'fixtures', 'blast-mobile-story-20260825183234.json');
    const { seed, events } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    // events[0] is the real resize -- viewport set directly (see tests/stories.desktop.spec.js's
    // file header).
    const viewport = events[0];
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/?seed=${seed}`);
    await page.waitForLoadState('networkidle');

    // No mode-switch click to replay -- not because this is a deep-linked session (unlike
    // Gravity/Snake's stories), but because it genuinely happened and then aged out: this
    // session has 6652 total real events, over js/replay.js's own MAX_EVENTS=5000 ring-buffer
    // cap, so its earliest events (including the real tap on "Blast") were already evicted by
    // the time the player filed the bug report. Confirmed real, not a recording gap unique to
    // this file: js/replay.js's Replay.record() trims to MAX_EVENTS on every push, by design.
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
    await expect(page.locator('.mode-option[data-mode="blast"]')).toHaveClass(/active/);

    // The captured session's own tail -- a real #blast-reset tap, then a couple of incidental UI
    // taps (opening the drawer to get to the bug-report link) -- isn't part of playing it, same
    // liberty as dropping the trailing #report-bug-link click elsewhere: replaying the reset
    // would just wipe the board this test is actually asserting on. Everything up to (not
    // including) that reset is real, uninterrupted gameplay.
    const resetIdx = events.findIndex((e) => e.target === '#blast-reset');
    const gameplayEvents = events.slice(1, resetIdx);

    await replayEvents(page, gameplayEvents, { tickFn: null });

    // The exact real outcome of replaying this exact real session -- verified by actually
    // running it (not derived by hand). No error occurred in the real session and none should
    // occur here either (page.on('pageerror') above throws if one does); these specific values
    // are the regression baseline for Blast's placement/rotation/collision/line-clear logic
    // under a long, real, touch-driven mobile session.
    //
    // linesCleared 2->1 (cellCount steady at 53) under the Sandbox/Life mobile-panel pass:
    // #blast-stats's own .stats-panel lost its redundant nested border/background/padding (it
    // already sits inside #blast-stats's own already-framed corner card -- "an outline that's
    // very wide" live feedback, same fix applied to Snake/Gravity/Life), which shifts
    // #blast-stats's real on-screen box a few pixels. Each pointerdown resolves to a cell via
    // document.elementFromPoint() at the ORIGINAL recorded pixel coordinates (see
    // replay-driver.js), so any shift in what's on-screen near those coordinates can shift which
    // cell a tap actually lands on -- inherent to pinning a test to raw screen pixels rather than
    // app state, same as the desktop Blast story's own #48-era precedent. Verified stable across
    // repeated isolated runs (both Tablet Chrome and Mobile Safari) before committing.
    const final = await page.evaluate(() => ({
      linesCleared: BlastMode.state.linesCleared,
      cellCount: Board.cells.size,
      isGameOver: BlastMode.state.isGameOver,
    }));
    expect(final.linesCleared).toBe(1);
    expect(final.cellCount).toBe(53);
    expect(final.isGameOver).toBe(false);

    await page.screenshot({ path: 'test-results/blast-mobile-story-final.png' });
  });

  test('Gravity story (Mobile): a real captured session plays through to Game Over deterministically', async ({ page }) => {
    // 2447 real events, each a real tick catch-up + dispatch round-trip.
    test.setTimeout(120000);

    // Filed live via the bug-report link (github.com/gregory-marton/Tonncade/issues/22) with no
    // written description -- a good real session, not a bug report (see issue #20's own story for
    // the same pattern). Same underlying continuous play session as the Snake mobile story below
    // (identical seed and start timestamp -- the player kept going after this report and filed a
    // second one once they'd moved into Snake); this one covers just the Gravity portion.
    const fixturePath = path.join(__dirname, 'fixtures', 'gravity-mobile-story-20260825225923.json');
    const { seed, events } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    // events[0] is the real resize -- viewport set directly (see tests/stories.desktop.spec.js's
    // file header). Freeze real time BEFORE navigating -- same reasoning as every other
    // tick-based story here: Gravity's own timer would otherwise keep firing tick() on actual
    // wall-clock time throughout this test's own execution, in addition to the explicit tick
    // catch-up below.
    const viewport = events[0];
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.clock.install({ time: 0 });

    // Deep-linked straight into Gravity (no mode-switch click anywhere in the whole capture) --
    // same reasoning as the Desktop Gravity story's file header.
    await page.goto(`/?seed=${seed}#gravity`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.mode-option[data-mode="gravity"]')).toHaveClass(/active/);
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    // The captured session's own tail -- a couple of incidental UI taps opening the drawer to
    // reach the bug-report link -- isn't part of playing it, same liberty taken everywhere else.
    let endIdx = events.length;
    while (endIdx > 1 && typeof events[endIdx - 1].target === 'string'
      && (events[endIdx - 1].target.includes('report-bug-link') || events[endIdx - 1].target === '#drawer-handle')) {
      endIdx--;
    }
    const gameplayEvents = events.slice(1, endIdx);

    // recordedViewport is needed here (unlike the other stories): this real session includes
    // three more real resizes right after the first (address-bar show/hide adjustments) -- now
    // genuinely replayed by replayEvents rather than dropped, per tests/helpers/replay-driver.js's
    // resize handling.
    await replayEvents(page, gameplayEvents, { tickFn: 'GravityMode.tick', recordedViewport: viewport });

    // The exact real outcome of replaying this exact real session -- verified by actually
    // running it (not derived by hand). cellCount was 88 before replay-driver.js's fix for a real
    // double-fire bug (a virtual D-pad button's tap dispatches its own keydown synchronously,
    // which the recorder also captures as a separate log entry -- replaying BOTH double-applied
    // every rotation press). 84 is the corrected, more faithful outcome; the fix's own regression
    // test lives in stories.desktop.spec.js.
    const final = await page.evaluate(() => ({
      linesCleared: GravityMode.state.linesCleared,
      cellCount: GravityBoard.cells.size,
      isGameOver: GravityMode.state.isGameOver,
      difficulty: GravityMode.state.difficulty,
    }));
    expect(final.linesCleared).toBe(0);
    expect(final.cellCount).toBe(84);
    expect(final.isGameOver).toBe(true);
    expect(final.difficulty).toBe(3);

    await page.screenshot({ path: 'test-results/gravity-mobile-story-final.png' });
  });

  test('Snake story (Mobile): a real two-game captured session plays through deterministically', async ({ page }) => {
    // 283 real events -- fast enough not to need an extended timeout.

    // Filed live via the bug-report link (github.com/gregory-marton/Tonncade/issues/23) captioned
    // "Another attempt at a snake story" -- the first two attempts on this same issue (both
    // long, messy multi-mode sessions) turned out to have a real, unrecoverable-in-hindsight gap:
    // reconstructing them required replaying everything since the true start just to consume the
    // same number of Math.random() draws in the same order, and that replay itself depended on
    // UI that had since changed (a virtual D-pad button whose visibility differs by mode) -- see
    // js/replay.js's rngCalls field, added specifically because of this investigation. This
    // session is clean by contrast: starts fresh in Sandbox, switches to Snake once, and both
    // games replay to their exact real recorded outcomes with no divergence.
    const fixturePath = path.join(__dirname, 'fixtures', 'snake-mobile-story-20260827160611.json');
    const { seed, events } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const viewport = events[0];
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.clock.install({ time: 0 });
    await page.goto(`/?seed=${seed}`);
    await page.waitForLoadState('networkidle');
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    // The captured session's own tail -- opening the drawer to reach the bug-report link --
    // isn't part of playing it, same liberty taken everywhere else. Everything else, including
    // the real mode-switch tap into Snake and a couple of incidental Sandbox UI taps right
    // before it, is real and replayed as-is.
    let endIdx = events.length;
    while (endIdx > 1 && typeof events[endIdx - 1].target === 'string'
      && (events[endIdx - 1].target.includes('report-bug-link') || events[endIdx - 1].target === '#drawer-handle')) {
      endIdx--;
    }
    const gameplayEvents = events.slice(1, endIdx);

    await replayEvents(page, gameplayEvents, { tickFn: 'SnakeMode.tick', recordedViewport: viewport });

    // The exact real outcome of replaying this exact real session -- verified by actually running
    // it (not derived by hand). Two full games: the first reaches score 33 before a real death,
    // the second (after a real in-game Reset tap) reaches score 6 before ending the session.
    const final = await page.evaluate(() => ({
      score: SnakeMode.state.score,
      isGameOver: SnakeMode.state.isGameOver,
      snakeLength: SnakeMode.state.snake.length,
    }));
    expect(final.score).toBe(6);
    expect(final.isGameOver).toBe(true);
    expect(final.snakeLength).toBe(9);

    await page.screenshot({ path: 'test-results/snake-mobile-story-final.png' });
  });
});
