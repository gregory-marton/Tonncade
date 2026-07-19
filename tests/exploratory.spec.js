const { test, expect } = require('@playwright/test');

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

  test('Random taps (small): Sandbox mobile portrait — 100 seeded random taps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
    await page.waitForTimeout(200);

    const seed = 12345;
    console.log(`Random tap seed: ${seed} (rerun with this exact seed to reproduce)`);
    const rand = mulberry32(seed);
    const N = 100;

    // Only the count/labels cross back to Node -- the live element refs eval() produces can't be
    // serialized (and aren't needed here; only the grid sweep needs live-element hit-testing).
    const initialControls = await page.evaluate((s) => eval(s).map(c => c.label), buildDiscoverScript());

    let tonnetzHits = 0;
    const hitLabels = new Set();
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const x = Math.floor(rand() * 390);
      const y = Math.floor(rand() * 844);
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
    const elapsedMs = Date.now() - t0;

    // The app should still be alive and responsive after 100 random taps — the most direct
    // "nothing got stuck" check: can we still reach a different mode?
    await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
    const modeAfter = await page.evaluate(() => App.currentMode);
    expect(modeAfter, 'app should still respond to mode switching after 100 random taps').toBe('gravity');

    const tonnetzShare = tonnetzHits / N;
    console.log(`Random taps: ${N} taps in ${elapsedMs}ms, ${(tonnetzShare * 100).toFixed(1)}% on Tonnetz, ${hitLabels.size} distinct control labels touched (of ${initialControls.length} discovered at start)`);
    expect(tonnetzShare, `Tonnetz should get roughly half of random taps (got ${(tonnetzShare * 100).toFixed(1)}%)`).toBeGreaterThan(0.3);
  });
});
