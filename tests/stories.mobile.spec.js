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
    const final = await page.evaluate(() => ({
      linesCleared: BlastMode.state.linesCleared,
      cellCount: Board.cells.size,
      isGameOver: BlastMode.state.isGameOver,
    }));
    expect(final.linesCleared).toBe(1);
    expect(final.cellCount).toBe(52);
    expect(final.isGameOver).toBe(false);

    await page.screenshot({ path: 'test-results/blast-mobile-story-final.png' });
  });
});
