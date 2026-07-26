const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * EXPLORATORY TESTS (prototype)
 *
 * Unlike invariants.spec.js's INV-13 (a fixed, hand-maintained list of primary elements), these
 * discover "what's interactive right now" straight from the DOM at test time — a control that's
 * added later, or that only exists in some states, is covered automatically with no list to
 * keep in sync. Two distinct techniques, deliberately kept small here to measure real cost and
 * see what they actually catch before deciding whether to expand them or retire narrower tests
 * these end up covering more generally:
 *
 * 1. Grid sweep: a batched elementFromPoint() pass over every Nth pixel. Answers "right now, is
 *    anything covering a control?" — exhaustive but a single snapshot in time.
 * 2. Random taps/drags: a seeded sequence of real dispatched interactions. Answers "after a long
 *    undirected sequence of real use, is everything still reachable, and did most of what's
 *    discoverable actually get exercised?" — probabilistic, but the only one of the two that can
 *    catch a control that becomes unreachable only *after* some other action changes state.
 */

// Simple seeded PRNG (mulberry32) so a failing run's seed can be logged and replayed exactly —
// same principle as controlling which piece comes next in stories.spec.js.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Discovers "what's interactive right now" from the DOM, rather than a curated list — a
// control this misses is a real gap in the selector below, not a stale list entry.
//
// Tonnetz cells are included individually (one control per grid position), not aggregated as
// "the Tonnetz" -- but a position can be covered by several stacked polygons at once (the base
// grid cell, plus a ghost/placed-piece/active-piece overlay, all sharing the same data-p/data-q
// via js/render.js's createHex), so DISCOVER groups by position and keeps one control per unique
// (p, q), matching whichever polygon is currently on top -- a tap there reaches "that cell"
// regardless of what's drawn on it.
//
// Returns live DOM element references, not serialized copies -- hit-testing needs real element
// identity (elementFromPoint() returns a live element; comparing it against a POJO copy is
// always false), so discovery and hit-testing must both run inside the same page.evaluate call.
// minVisible: a control only counts as "discovered right now" if its visible-within-viewport
// area is at least this large in both dimensions -- a thin edge sliver smaller than the sweep's
// own sampling step can genuinely fall between grid points and never get hit, which is a
// resolution limit of a coarse sweep, not a real occlusion bug. Defaults to matching the sweep
// step used below so discovery and sampling resolution stay consistent by construction.
const buildDiscoverScript = (minVisible = 10) => `
  (function() {
    // Sandbox's Tonnetz supports free pan/zoom, so the DOM can hold cells far outside the
    // current viewport -- those have a real (nonzero) bounding box, just positioned off-screen,
    // so a zero-size check alone doesn't exclude them. A control only counts as "discovered
    // right now" if a meaningful part of its box actually overlaps the viewport.
    const inViewport = (r) => {
      const visW = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      const visH = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      return visW >= ${minVisible} && visH >= ${minVisible};
    };

    const nonCellSelector = 'button, a[href], select, input, .mode-option, [data-key]';
    const nonCellControls = Array.from(document.querySelectorAll(nonCellSelector))
      .filter(el => {
        if (!inViewport(el.getBoundingClientRect())) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      })
      .map(el => ({ el, label: el.id ? '#' + el.id : (el.className || el.tagName) }));

    const cellByPos = new Map();
    document.querySelectorAll('#tonnetz-svg .cell[data-p]').forEach(el => {
      if (!inViewport(el.getBoundingClientRect())) return;
      const key = el.getAttribute('data-p') + ',' + el.getAttribute('data-q');
      if (!cellByPos.has(key)) cellByPos.set(key, { el, label: 'cell(' + key + ')' });
    });

    return nonCellControls.concat(Array.from(cellByPos.values()));
  })()
`;

// A control is "gated" (legitimately unreachable from a single static tap, not a defect) if
// it's inside a not-currently-open drawer, or positioned outside its nearest scrollable
// ancestor's visible clip area (e.g. a carousel item that needs a swipe to bring into view
// first). The drawer's actual visibility is governed by the 'expanded' class alone (see
// css/style.css) -- 'collapsed' is set explicitly once the player closes it, but the drawer
// starts with NEITHER class present, so "not expanded" is the real gating condition, not
// "explicitly collapsed".
const GATE_REASON_SCRIPT = `
  function gateReason(el) {
    const drawer = el.closest('#top-drawer');
    if (drawer && !drawer.classList.contains('expanded')) return 'drawer-not-open';
    let node = el.parentElement;
    while (node) {
      const cs = getComputedStyle(node);
      const scrollableX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      const scrollableY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      if (scrollableX || scrollableY) {
        const containerRect = node.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        if (scrollableX && (elRect.right <= containerRect.left || elRect.left >= containerRect.right)) return 'scrolled-out-of-view';
        if (scrollableY && (elRect.bottom <= containerRect.top || elRect.top >= containerRect.bottom)) return 'scrolled-out-of-view';
      }
      node = node.parentElement;
    }
    return null;
  }
`;

test.describe('Exploratory tests (prototype)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Grid sweep (small): Sandbox mobile portrait — Tonnetz dominance + control coverage', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.waitForTimeout(200);

    const step = 10;
    const t0 = Date.now();
    const result = await page.evaluate(({ discoverScript, gateReasonScript, step }) => {
      eval(gateReasonScript);
      const controls = eval(discoverScript);
      const controlSet = new Set(controls.map(c => c.el));
      let total = 0, tonnetz = 0;
      const hitElements = new Set(); // live elements, matched by reference -- no serialization

      for (let x = 0; x < window.innerWidth; x += step) {
        for (let y = 0; y < window.innerHeight; y += step) {
          total++;
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          if (el.closest('#tonnetz-svg')) tonnetz++;
          // Walk up from the swept point to its nearest matching control ancestor -- handles a
          // point landing on something nested inside a control (an icon inside a button, a
          // label inside a cell), not just the control element itself.
          let node = el;
          while (node) {
            if (controlSet.has(node)) { hitElements.add(node); break; }
            node = node.parentElement;
          }
        }
      }

      // Cell misses and non-cell-control misses get different bars below: INV-10/INV-11 already
      // establish that an UNRESTRICTED Tonnetz (Sandbox/Melody -- free pan/zoom) is allowed some
      // cells covered by the app's own floating UI (there's always more board to pan to), while
      // a RESTRICTED Tonnetz (Snake/Blast/Gravity) must have zero overlap. Buttons/links/mode-
      // options/carousel-items aren't subject to that same allowance -- every one of those that
      // isn't gated should be reachable, full stop.
      const unexplainedMissed = [];
      const unexplainedCellsMissed = [];
      const gatedMissed = [];
      let hitCount = 0, cellHitCount = 0, cellCount = 0;
      for (const c of controls) {
        const isCell = c.label.startsWith('cell(');
        if (isCell) cellCount++;
        if (hitElements.has(c.el)) { hitCount++; if (isCell) cellHitCount++; continue; }
        const reason = gateReason(c.el);
        if (reason) gatedMissed.push(`${c.label} (${reason})`);
        else if (isCell) unexplainedCellsMissed.push(c.label);
        else unexplainedMissed.push(c.label);
      }

      return { total, tonnetz, controlCount: controls.length, hitCount, cellCount, cellHitCount, gatedCount: gatedMissed.length, unexplainedMissed, unexplainedCellsMissed, gatedMissed };
    }, { discoverScript: buildDiscoverScript(step), gateReasonScript: GATE_REASON_SCRIPT, step });
    const elapsedMs = Date.now() - t0;

    console.log(`Grid sweep: ${result.total} points, ${elapsedMs}ms, ${result.controlCount} controls discovered (${result.cellCount} cells), ${result.hitCount} reachable (${result.cellHitCount} cells), ${result.gatedCount} legitimately gated, unexplained non-cell: ${JSON.stringify(result.unexplainedMissed)}, unexplained cells: ${result.unexplainedCellsMissed.length}`);

    const tonnetzShare = result.tonnetz / result.total;
    expect(tonnetzShare, `Tonnetz should dominate the sweep (got ${(tonnetzShare * 100).toFixed(1)}%)`).toBeGreaterThan(0.5);

    // Same floor as INV-11 -- an unrestricted Tonnetz is allowed to have cells covered by the
    // app's own floating UI, as long as there's still plenty of pannable board left reachable.
    expect(result.cellHitCount, `at least 20 Tonnetz cells should be reachable (got ${result.cellHitCount})`).toBeGreaterThanOrEqual(20);

    // Gated controls (behind the collapsed drawer, or scrolled out of the carousel) are expected
    // to be unreachable from a single static tap sweep -- that's the app's real navigation model,
    // not a defect. Only unexplained misses -- a control that's visible, not gated, and still
    // never got hit -- indicate a real occlusion bug.
    expect(result.unexplainedMissed, `every visible, non-gated control should be reachable by some point in the sweep`).toEqual([]);
  });

  // A single tap-and-observe run against one (mode, drawer-state, screen-size) scenario. Shared
  // by the small single-scenario test and the full matrix below so the two can't drift apart.
  async function runRandomTaps(page, { mode, drawerOpen, width, height, rand, N, screenshot }) {
    await page.setViewportSize({ width, height });
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    await page.waitForTimeout(100);

    const openDrawerIfNeeded = async () => {
      const isMobile = await page.evaluate(() => Render.isMobileViewport());
      if (!isMobile) return;
      const drawer = page.locator('#top-drawer');
      const expanded = await drawer.evaluate(el => el.classList.contains('expanded'));
      if (drawerOpen && !expanded) await page.locator('#drawer-handle').click();
      if (!drawerOpen && expanded) await page.locator('#drawer-handle').click();
    };
    await openDrawerIfNeeded();

    // Captured here, before any random tap has a chance to disturb the layout — a clean view of
    // this exact (mode, drawer-state, size) scenario, the same one the assertions below check.
    if (screenshot) {
      await page.screenshot({ path: path.join(screenshot.dir, `${screenshot.label}.png`) });
    }

    const initialControls = await page.evaluate((s) => eval(s).map(c => c.label), buildDiscoverScript());

    let tonnetzHits = 0;
    const hitLabels = new Set();
    for (let i = 0; i < N; i++) {
      const x = Math.floor(rand() * width);
      const y = Math.floor(rand() * height);
      const info = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const onTonnetz = !!el.closest('#tonnetz-svg');
        const owner = el.closest('button, a[href], select, input, .mode-option, [data-key]');
        return { onTonnetz, ownerLabel: owner ? (owner.id || owner.className || owner.tagName) : null };
      }, { x, y });
      if (!info) continue;
      if (info.onTonnetz) tonnetzHits++;
      if (info.ownerLabel) hitLabels.add(info.ownerLabel);
      // Real tap, not just a hit-test — exercises whatever's actually there.
      await page.mouse.click(x, y).catch(() => {});
    }

    // The app should still be alive and responsive after N random taps — the most direct
    // "nothing got stuck" check: can we still reach a different mode?
    const nextMode = mode === 'gravity' ? 'sandbox' : 'gravity';
    await openDrawerIfNeeded();
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), nextMode);
    const modeAfter = await page.evaluate(() => App.currentMode);

    return {
      tonnetzShare: tonnetzHits / N,
      distinctControlsHit: hitLabels.size,
      controlsDiscovered: initialControls.length,
      respondedToModeSwitch: modeAfter === nextMode,
    };
  }

  test('Random taps (small): Sandbox mobile portrait — 100 seeded random taps', async ({ page }) => {
    const seed = 12345;
    console.log(`Random tap seed: ${seed} (rerun with this exact seed to reproduce)`);
    const t0 = Date.now();
    const result = await runRandomTaps(page, {
      mode: 'sandbox', drawerOpen: false, width: 390, height: 844, rand: mulberry32(seed), N: 100,
    });
    const elapsedMs = Date.now() - t0;

    console.log(`Random taps: 100 taps in ${elapsedMs}ms, ${(result.tonnetzShare * 100).toFixed(1)}% on Tonnetz, ${result.distinctControlsHit} distinct control labels touched (of ${result.controlsDiscovered} discovered at start)`);
    expect(result.respondedToModeSwitch, 'app should still respond to mode switching after 100 random taps').toBe(true);
    expect(result.tonnetzShare, `Tonnetz should get roughly half of random taps (got ${(result.tonnetzShare * 100).toFixed(1)}%)`).toBeGreaterThan(0.3);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Full matrix: every mode x whether the drawer starts open or closed x 5 random screen sizes
  // (width and height sampled independently and uniformly, which also stands in for desktop
  // window resizing, not just device presets). One continuing seeded stream drives every random
  // choice in the whole matrix -- screen sizes AND tap positions -- so any single scenario's
  // failure is exactly reproducible by rerunning with the same top-level seed.
  //
  // Width/height ranges: 320 (iPhone SE-class, the narrowest realistic target) to 1920 (a wide
  // desktop window) for width; 480 (a short landscape phone) to 1080 (full HD desktop height)
  // for height -- chosen to span real mobile devices through ordinary desktop window sizes.
  // ────────────────────────────────────────────────────────────────────────

  const MATRIX_MODES = ['sandbox', 'midi', 'snake', 'blast', 'gravity'];
  const WIDTH_RANGE = [320, 1920];
  const HEIGHT_RANGE = [480, 1080];
  const SIZES_PER_SCENARIO = 5;
  const TAPS_PER_RUN = 100;

  test('Random taps (full matrix): every mode x drawer-state x 5 random screen sizes', async ({ page }) => {
    test.setTimeout(600000);
    // A fresh seed each run, not a fixed constant, so the sampled sizes vary run to run instead
    // of a fixed seed permanently fixating on whichever one scenario happened to be chosen first.
    // Whatever seed a given run draws is logged here so any specific failure is still exactly
    // reproducible afterward. A failure here is a real signal, not expected noise (see the floor
    // comment below) -- look at the automatically-attached failure screenshot (playwright.config's
    // screenshot:'only-on-failure') before assuming it's an artifact of the sampled size.
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    console.log(`Random tap matrix seed: ${seed} (rerun with this exact seed to reproduce any specific scenario)`);
    const rand = mulberry32(seed);

    // This matrix already walks every mode across a wide, realistic range of screen sizes
    // (portrait, landscape, and everything between) -- a standing visual fixture for "what does
    // the app actually look like right now" piggybacks on it directly rather than sampling its
    // own separate, narrower set of sizes. See screenshots/index.html to browse the results;
    // gitignored (regenerated by this test, not meant to accumulate in git history).
    const screenshotDir = path.join(__dirname, '..', 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    // Clear any previous run's images first -- this test runs once per Playwright project (Mobile
    // Chrome, Tablet Chrome), and without this, a later project's run would leave the EARLIER
    // project's images sitting on disk unlisted in the new manifest.js (orphaned, not shown in
    // the viewer, just silently accumulating).
    for (const f of fs.readdirSync(screenshotDir)) {
      if (f.endsWith('.png')) fs.unlinkSync(path.join(screenshotDir, f));
    }
    const manifest = [];

    const results = [];
    try {
      for (const mode of MATRIX_MODES) {
        for (const drawerOpen of [false, true]) {
          for (let i = 0; i < SIZES_PER_SCENARIO; i++) {
            const width = Math.floor(WIDTH_RANGE[0] + rand() * (WIDTH_RANGE[1] - WIDTH_RANGE[0]));
            const height = Math.floor(HEIGHT_RANGE[0] + rand() * (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]));
            const label = `${mode}, drawer ${drawerOpen ? 'open' : 'closed'}, ${width}x${height}`;
            const fileLabel = `${mode}_drawer-${drawerOpen ? 'open' : 'closed'}_${width}x${height}_${i}`;

            const result = await runRandomTaps(page, {
              mode, drawerOpen, width, height, rand, N: TAPS_PER_RUN,
              screenshot: { dir: screenshotDir, label: fileLabel },
            });
            results.push({ label, ...result });
            manifest.push({ mode, drawerOpen, width, height, file: `${fileLabel}.png` });

            console.log(`[${label}] ${(result.tonnetzShare * 100).toFixed(1)}% on Tonnetz, ${result.distinctControlsHit}/${result.controlsDiscovered} distinct controls touched`);
            // Soft assertions (not hard) so a single failing scenario doesn't abort the whole
            // matrix loop -- this test doubles as the screenshots/ fixture generator (see the
            // screenshotDir block above), and a hard throw partway through would leave the fixture
            // populated with only the modes before the failure (Sandbox is first, so its own
            // pre-existing wide/short-viewport defect -- see next_steps.md #76 -- would otherwise
            // strand every other mode). Soft failures still fail the test at the end, and report
            // EVERY bad scenario rather than just the first.
            expect.soft(result.respondedToModeSwitch, `[${label}] app should still respond to mode switching after ${TAPS_PER_RUN} random taps`).toBe(true);
            // A genuinely open drawer is expected to take a real bite out of the Tonnetz's share --
            // that's the point of having it open, not a defect -- so it gets a lower floor than the
            // normal-play (drawer closed) case. Found live while building this matrix: the
            // landscape drawer's CSS width is a FIXED 320px (see next_steps.md #49), so at narrow
            // landscape widths it can eat over half the screen; 10% still catches "the Tonnetz is
            // effectively gone", just not "the drawer is unusually wide right now".
            //
            // A failure here means the Tonnetz genuinely isn't getting a fair share of the
            // available space -- confirmed live (see docs/invariants.md's INV-40) that this is a
            // real space-filling defect (getFitView/getAspectMatchedRefBox can fit tightly on one
            // axis while leaving the other mostly empty, when the reference box's aspect ratio
            // doesn't match the board's own shape), not sampling noise from an unlucky size. Look
            // at the attached failure screenshot -- don't assume it's expected and move on.
            const floor = drawerOpen ? 0.1 : 0.3;
            expect.soft(result.tonnetzShare, `[${label}] Tonnetz should get a meaningful share of random taps (got ${(result.tonnetzShare * 100).toFixed(1)}%, floor ${floor * 100}%)`).toBeGreaterThan(floor);
          }
        }
      }
    } finally {
      // Written even on a mid-loop assertion failure -- that's exactly when having screenshots of
      // everything captured so far is most useful for a human to look at.
      fs.writeFileSync(
        path.join(screenshotDir, 'manifest.js'),
        `window.SCREENSHOT_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`
      );
    }

    // Not yet asserted on -- distinct-controls-touched is still being calibrated (see the small
    // prototype's own low count). Reported in aggregate for now so it's visible across the full
    // matrix without gating the run on a bar that hasn't been set yet.
    const avgDistinct = results.reduce((s, r) => s + r.distinctControlsHit, 0) / results.length;
    console.log(`Matrix summary: ${results.length} scenarios, avg ${avgDistinct.toFixed(1)} distinct controls touched per scenario`);
  });
});
