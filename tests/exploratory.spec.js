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
// same principle as controlling which piece comes next in stories.desktop.spec.js.
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
    // These tests fire hundreds of real taps across every mode (gravity, snake, blast, ...),
    // each triggering a real Synth note -- audible, overlapping, cutting each other off.
    // Chromium gets --mute-audio from Playwright automatically; WebKit (the Mobile Safari
    // project) has no such flag, so it was the one actually reaching real speakers. Muting at
    // the Web Audio graph itself (never actually connecting an oscillator to the destination)
    // is what stays silent on every browser, Chromium's own mute or not, and doesn't touch
    // .frequency/.type/etc, so tests that inspect a created oscillator's own properties (see
    // INV-46) are unaffected -- only whether sound reaches real speakers changes.
    await page.addInitScript(() => {
      const proto = (window.AudioContext || window.webkitAudioContext).prototype;
      const realCreateOscillator = proto.createOscillator;
      proto.createOscillator = function(...args) {
        const osc = realCreateOscillator.apply(this, args);
        osc.connect = () => {};
        return osc;
      };
    });
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
    // Navigate fresh for this scenario's exact size, rather than reusing the page across scenarios.
    // A reused page fits the board while the previous scenario's layout is still reflowing to the
    // new size (worst for the pannable modes, whose tall control stacks change the play area's
    // height as the viewport changes), capturing a board sized to a STALE container -- the black
    // space seen in the fixture. A fresh load lays everything out once, at the right size.
    await page.goto('/');
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    await page.waitForTimeout(150);
    // Life's default automaton loads asynchronously (LifeFolder.autoLoadFirstBundled) -- without
    // waiting for it, #life-rule-panel's content (and so whether it's tall enough to trigger the
    // drawer-clipping check below) can still be a placeholder at measurement time, same async
    // race several other tests in this codebase already guard against.
    if (mode === 'life') {
      await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 }).catch(() => {});
    }

    const openDrawerIfNeeded = async () => {
      const isMobile = await page.evaluate(() => Render.isMobileViewport());
      if (!isMobile) return;
      const drawer = page.locator('#top-drawer');
      const expanded = await drawer.evaluate(el => el.classList.contains('expanded'));
      let toggled = false;
      if (drawerOpen && !expanded) { await page.locator('#drawer-toggle').click(); toggled = true; }
      if (!drawerOpen && expanded) { await page.locator('#drawer-toggle').click(); toggled = true; }
      // The collapse/expand transition (#top-drawer's own height/max-width, 0.3s ease) was still
      // mid-animation when a screenshot/measurement immediately followed a toggle click here --
      // found live: a scenario captured a transient wide mid-collapse frame as if it were the
      // settled state (a real user request: "wait longer during screenshot generation so I get
      // stable screenshots"). 400ms comfortably clears every transition duration this drawer uses.
      if (toggled) await page.waitForTimeout(400);
    };
    await openDrawerIfNeeded();

    // Force this mode to re-fit to THIS scenario's exact viewport before measuring/screenshotting.
    // Selecting an already-active mode early-returns without redrawing, and the board's own
    // resize refit (a ResizeObserver -- see js/main.js / the restricted modes) is asynchronous, so
    // without this a consecutive same-mode scenario would capture the board still fit to the
    // PREVIOUS scenario's size (a letterboxed/stale frame). This makes each captured image and
    // tonnetz-share measurement deterministically reflect the current size.
    await page.evaluate((m) => {
      // Recenter the pannable modes on the origin first: their view center persists across
      // consecutive same-mode scenarios, so an earlier scenario's interactions would otherwise
      // leave the board panned off to one side in this scenario's frame. Each captured image
      // should show the clean default centered view (null -> origin, see Render.panView).
      const modeObj = { sandbox: SandboxMode, melody: MelodyMode, compose: ComposeMode }[m];
      if (modeObj) { modeObj.state.viewX = null; modeObj.state.viewY = null; }
      const fns = {
        sandbox: () => SandboxMode.refreshLattice(),
        melody: () => MelodyMode.refreshBoard(),
        compose: () => ComposeMode.refreshBoard(),
        snake: () => SnakeMode.refreshBoard(),
        blast: () => BlastMode.refreshUI(),
        gravity: () => GravityMode.refreshBoard(),
      };
      if (fns[m]) fns[m]();
    }, mode);

    // Melody/Compose start genuinely empty (Melody's own Random default is a tiny few-note
    // sliding window; Compose has no starting content at all) -- their grand-staff view
    // (docs/melody-notation-design.md) has nothing to show in that state, so every screenshot of
    // either mode showed a bare board with no staff at all, regardless of scenario (reported
    // live: "I have no chance to see staffs"). Seeded here, through the SAME controls a real
    // player would use (Melody: picking a song from its source list; Compose: Record + real cell
    // taps via tapCell, not direct state injection) so the fixture reflects actual usage, not a
    // synthetic shortcut. Compose's taps are pseudo-random (drawn from this scenario's own seeded
    // `rand()`, so still exactly reproducible) rather than a fixed phrase -- literally random
    // pitches don't need to be musical for this purpose, just present.
    if (mode === 'melody') {
      // Varies scenario to scenario (seeded, so still reproducible) rather than always the same
      // state: Random alone is a legitimate, real thing the fixture should also show, but ALWAYS
      // showing it meant no scenario ever exercised a real loaded song at all. About 2/3 of
      // scenarios pick a random bundled song and play a few of its notes correctly first (via the
      // real handleUserInputNote path, not direct state injection -- an actual "game in
      // progress," streak and all), not just a freshly-loaded, untouched song.
      if (rand() < 0.67) {
        const songIndex = Math.floor(rand() * 6); // 6 bundled songs, see midi/index.json
        // MelodyFolder.setup() (called from MelodyMode.init(), itself just triggered by the mode
        // click above) fetches midi/index.json asynchronously -- onlineIndex isn't populated yet
        // at this exact point, so checking it immediately and skipping when empty (as an earlier
        // version of this code did) silently fell through to "leave it on Random" every single
        // time, regardless of the dice roll above. Wait for it for real instead of guessing a
        // fixed delay.
        await page.waitForFunction(() => typeof MelodyFolder !== 'undefined' && MelodyFolder.onlineIndex && MelodyFolder.onlineIndex.length > 0);
        await page.evaluate(async (songIndex) => {
          await MelodyFolder.loadOnlineFile(songIndex % MelodyFolder.onlineIndex.length);
        }, songIndex);
        await page.waitForFunction(() => !MelodyMode.state.isRandom); // loadOnlineFile's own fetch + parse is async too
        const notesToPlay = 1 + Math.floor(rand() * 4); // a few notes in, not the whole song
        await page.evaluate((notesToPlay) => {
          for (let i = 0; i < notesToPlay && MelodyMode.state.melody[MelodyMode.state.userIndex]; i++) {
            MelodyMode.handleUserInputNote(MelodyMode.state.melody[MelodyMode.state.userIndex].midi);
          }
        }, notesToPlay);
      }
      // The remaining ~1/3 of scenarios: leave Melody on its real Random default, untouched --
      // also a legitimate state the fixture should keep showing sometimes.
    } else if (mode === 'compose') {
      const taps = Array.from({ length: 5 }, () => ({
        p: Math.floor(rand() * 7) - 3,
        q: Math.floor(rand() * 7) - 3,
      }));
      await page.evaluate((taps) => {
        ComposeMode.startRecording();
        taps.forEach(({ p, q }) => ComposeMode.tapCell(p, q));
        ComposeMode.stopRecording();
      }, taps);
    }

    // Edge-reach: the essential fill metric (applies to EVERY mode). The board's rendered cells
    // should come within ~2 cell-diameters of at least two edges of the play area -- a board
    // floating with a wide margin all around, or reaching only one edge, is under-filling. Measured
    // directly off the drawn cells (no random sampling), in cell-diameters so it's zoom/size
    // independent, against #game-container (the actual play area). Reused by the assertion and the
    // fixture flag below.
    const edge = await page.evaluate(() => {
      const gc = document.getElementById('game-container').getBoundingClientRect();
      const svg = Render.svg; const svgR = svg.getBoundingClientRect();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
      svg.querySelectorAll('polygon.cell:not(.ghost)').forEach(c => {
        const r = c.getBoundingClientRect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        // Only cells actually inside the SVG's rendered box count (a pannable lattice extends far
        // past it; those off-screen cells aren't part of what fills the play area).
        if (cx < svgR.left || cx > svgR.right || cy < svgR.top || cy > svgR.bottom) return;
        minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.width);
        minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.height);
        n++;
      });
      if (!n) return { reaches: 0, reachesLenient: 0, margins: null };
      // One hex diameter on screen, at the current zoom.
      const p1 = svg.createSVGPoint(); p1.x = 0; p1.y = 0;
      const p2 = svg.createSVGPoint(); p2.x = Render.HEX_R * 2; p2.y = 0;
      const cellPx = Math.hypot(...(() => { const a = p1.matrixTransform(svg.getScreenCTM()), b = p2.matrixTransform(svg.getScreenCTM()); return [b.x - a.x, b.y - a.y]; })());
      const m = {
        left: (minX - gc.left) / cellPx, right: (gc.right - maxX) / cellPx,
        top: (minY - gc.top) / cellPx, bottom: (gc.bottom - maxY) / cellPx,
      };
      // Two tiers, deliberately different from each other (live feedback -- several real
      // screenshots reaching within 3 cell-diameters but not 2 read as genuinely well-filled, not
      // as defects): `reaches` (<=2) stays the STRICT ideal, still used for the visual yellow flag
      // in screenshots/index.html so a human reviewer keeps seeing the finer distinction; the
      // actual pass/fail floor below relaxes to `reachesLenient` (<=3) instead, so "reaches
      // within 3" no longer fails the automated suite even though it still shows yellow.
      const reaches = [m.left, m.right, m.top, m.bottom].filter(v => v <= 2).length;
      const reachesLenient = [m.left, m.right, m.top, m.bottom].filter(v => v <= 3).length;
      return { reaches, reachesLenient, margins: { left: +m.left.toFixed(1), right: +m.right.toFixed(1), top: +m.top.toFixed(1), bottom: +m.bottom.toFixed(1) }, cells: n };
    });

    // Flood-fill of the EMPTY (black) play area (the user's metric): a well-placed board bisects the
    // play area, so its empty space is broken into pieces and no single contiguous black region can
    // be large; a floating/undersized board leaves ONE big black region. Sample #game-container on a
    // ~cell-diameter grid (so sub-cell gaps between hexes don't register as empty), classify each
    // point board / chrome / black via elementFromPoint, 4-connected flood-fill the black, and report
    // the largest black region as a fraction of the sampled play area. Aspect-independent, and (unlike
    // edge-reach vs the raw container) it does NOT penalise legitimate chrome -- the D-pad/stats area
    // is "chrome", not "black", so a board that fills the space between them passes.
    const flood = await page.evaluate(() => {
      const gc = document.getElementById('game-container').getBoundingClientRect();
      const svg = Render.svg;
      const p1 = svg.createSVGPoint(); p1.x = 0; p1.y = 0;
      const p2 = svg.createSVGPoint(); p2.x = Render.HEX_R * 2; p2.y = 0;
      const a = p1.matrixTransform(svg.getScreenCTM()), b = p2.matrixTransform(svg.getScreenCTM());
      const step = Math.max(12, Math.hypot(b.x - a.x, b.y - a.y)); // one cell diameter, min 12px
      const cols = Math.max(1, Math.floor(gc.width / step)), rows = Math.max(1, Math.floor(gc.height / step));
      // classify: 0 = board, 1 = chrome/other, 2 = black(empty)
      const grid = [];
      for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
          const x = gc.left + (c + 0.5) * (gc.width / cols), y = gc.top + (r + 0.5) * (gc.height / rows);
          const el = document.elementFromPoint(x, y);
          if (!el) { grid[r][c] = 2; continue; }
          // Board = an ACTUAL cell (a polygon.cell, or a note label sitting on one), NOT merely
          // "inside #tonnetz-svg": the <svg> element fills its whole container, so its empty
          // interior -- the hexagon's black corners and any letterboxed margin around a
          // centered board -- is between cells, not on them. Counting that interior as board (as
          // `el.closest('#tonnetz-svg')` did) reported 0% black for a centered board with wide
          // empty margins. Empty SVG interior now correctly falls through to black.
          const onCell = el.closest('polygon.cell') != null;
          const onLabel = /^(text|tspan)$/i.test(el.tagName || '') && el.closest('#tonnetz-svg') != null;
          if (onCell || onLabel) grid[r][c] = 0;
          else if (el.closest('button, select, input, .mode-option, [id$="-controls"], [id$="-stats"], #palette, #mobile-controls, #snake-mobile-controls, #sidebar, #top-header')) grid[r][c] = 1;
          else grid[r][c] = 2;
        }
      }
      // largest 4-connected component of black(2)
      const seen = grid.map(row => row.map(() => false));
      let largest = 0, totalBlack = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 2) totalBlack++;
        if (grid[r][c] !== 2 || seen[r][c]) continue;
        let size = 0; const stack = [[r, c]]; seen[r][c] = true;
        while (stack.length) {
          const [cr, cc] = stack.pop(); size++;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc] && grid[nr][nc] === 2) { seen[nr][nc] = true; stack.push([nr, nc]); }
          }
        }
        largest = Math.max(largest, size);
      }
      const total = rows * cols;
      return { largestBlackFrac: +(largest / total).toFixed(2), totalBlackFrac: +(totalBlack / total).toFixed(2), gridSamples: total };
    });

    // Two general layout-correctness checks, covering the exact CLASS of bug behind two real
    // live reports (Life's rule panel silently wrapped out of the drawer's own visible column at
    // specific landscape/portrait widths; Sandbox/Life's floating controls panel stretched to
    // fill the whole screen at a specific landscape width, leaving a big blank gap below the
    // actual content) -- rather than pinning regression tests to the exact reported viewports
    // (which only proves THOSE sizes stay fixed), these run for every (mode, drawer-state, size)
    // scenario the matrix already visits, so a similar defect at some OTHER size gets caught here
    // instead of needing another live report first.
    //
    // A) No visible drawer content clipped out of the drawer's own box. Both real bugs above
    // stemmed from flex-wrap silently starting a second row/column once content overflowed
    // #top-drawer's available space, pushing part of it out past the drawer's own bounds (then
    // clipped away by its overflow-x/y:hidden) -- not actually missing, just invisible. Checking
    // "every visible child's box is within its own container's box" generalizes past this one
    // flex-wrap mechanism to any future cause of the same visible symptom.
    const drawerClipping = await page.evaluate(() => {
      const drawer = document.getElementById('top-drawer');
      if (!drawer || !drawer.classList.contains('expanded')) return [];
      const d = drawer.getBoundingClientRect();
      if (d.width === 0 || d.height === 0) return [];
      const offenders = [];
      drawer.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        // Skip anything inside its OWN legitimate horizontal scroller (e.g. portrait's
        // #mode-controls, overflow-x:auto around a wider .mode-slider, by design) -- found live:
        // a 337px-wide phone flagged a real, correctly-horizontally-scrolling .mode-option as a
        // false positive. Only #top-drawer's own overflow-x:hidden clipping (nothing between here
        // and the drawer opts into scrolling itself) is the actual defect this check targets.
        let ancestor = el.parentElement, ownScroller = false;
        while (ancestor && ancestor !== drawer) {
          const acs = getComputedStyle(ancestor);
          if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') { ownScroller = true; break; }
          ancestor = ancestor.parentElement;
        }
        if (ownScroller) return;
        // Horizontal containment only, by center-x -- the drawer's own overflow-y:auto makes
        // vertical scroll-past-the-fold completely normal (content below the visible window is
        // SUPPOSED to report a rect below the drawer's visible bottom edge; that's not a bug).
        // The real defect this check exists for -- flex-wrap starting a second COLUMN once
        // content overflows -- pushes content out HORIZONTALLY instead, past overflow-x:hidden,
        // which center-x containment catches without false-flagging ordinary scrolled content.
        // Center point (not edge-touching) so an element merely touching the drawer's edge from
        // a legitimately-wrapped second column (most of its area still outside) isn't missed.
        const cx = r.left + r.width / 2;
        const within = cx >= d.left - 2 && cx <= d.right + 2;
        if (!within) offenders.push(el.id || el.className || el.tagName);
      });
      return [...new Set(offenders)];
    });

    // A2) The current mode's own control panel (#<mode>-controls) shouldn't dominate a
    // mobile/tablet viewport -- catches the OTHER shape the same real bug took: at a breakpoint
    // where the intended floating-panel treatment didn't apply at all (rather than applying but
    // rendering with blank space, which (B) below catches), #sidebar falls back to
    // display:contents (zero-sized, invisible to a check ON #sidebar itself) and its real child
    // -- the actual visible box -- stretches to fill the whole row/column height instead.
    // Mechanism-agnostic on purpose: whatever CSS produces "the controls panel eats most of the
    // screen" should be caught here even if a future regression takes a different shape entirely.
    const controlsDominance = await page.evaluate((m) => {
      const el = document.getElementById(`${m}-controls`);
      if (!el || !Render.isMobileViewport()) return null;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      // Height fraction, not area: the real defect is stretching to fill the FULL available
      // height regardless of content (width is already naturally narrow either way, so an
      // area-based fraction stayed small/inconclusive even in the buggy case).
      return { id: el.id, heightFrac: +(r.height / window.innerHeight).toFixed(2) };
    }, mode);

    // B) No floating panel (the position:absolute overlay treatment several modes' #sidebar use
    // on mobile/tablet -- Sandbox/Life/Blast/Gravity/Snake's own corner cards) with a large blank
    // gap between its real content and its own rendered bottom edge -- the "controls float, but
    // stretch to fill a fixed cap regardless of how little they actually contain" defect.
    const floatingPanelGap = await page.evaluate(() => {
      const panels = ['sidebar', 'blast-stats', 'gravity-controls', 'snake-controls'].map((id) => document.getElementById(id)).filter(Boolean);
      let worst = null;
      panels.forEach((panel) => {
        const cs = getComputedStyle(panel);
        if (cs.position !== 'absolute' && cs.position !== 'fixed') return; // only the floating treatment is meant to cap tightly
        const r = panel.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        let maxBottom = r.top;
        panel.querySelectorAll('*').forEach((el) => {
          const ecs = getComputedStyle(el);
          if (ecs.display === 'none' || ecs.visibility === 'hidden') return;
          const er = el.getBoundingClientRect();
          if (er.width === 0 || er.height === 0) return;
          if (er.bottom > maxBottom) maxBottom = er.bottom;
        });
        const blankBelow = r.bottom - maxBottom;
        if (!worst || blankBelow > worst.blankBelow) worst = { id: panel.id, panelHeight: r.height, blankBelow };
      });
      return worst;
    });

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
      edgeReaches: edge.reaches,
      edgeReachesLenient: edge.reachesLenient,
      edgeMargins: edge.margins,
      cellCount: edge.cells || 0, // how many cells are actually visible in this exact scenario --
                                   // already computed by the edge-reach measurement above, just
                                   // not previously surfaced (see screenshots/index.html's
                                   // per-mode cell-count histogram).
      largestBlackFrac: flood.largestBlackFrac,
      totalBlackFrac: flood.totalBlackFrac,
      drawerClipping,
      controlsDominance,
      floatingPanelGap,
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

  const WIDTH_RANGE = [320, 1920];
  const HEIGHT_RANGE = [480, 1080];
  const SIZES_PER_SCENARIO = 5;
  const TAPS_PER_RUN = 100;

  test('Random taps (full matrix): every mode x drawer-state x 5 random screen sizes', async ({ page }) => {
    test.setTimeout(600000);
    // Derived from the actual UI (.mode-option[data-mode]), not hand-maintained here -- a
    // hardcoded copy previously went stale (missing Life entirely) with nothing to catch it.
    const MATRIX_MODES = await page.evaluate(() => [...document.querySelectorAll('.mode-option')].map((el) => el.getAttribute('data-mode')));
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

    // Per-profile fixture namespacing. This test runs on several Playwright projects -- Desktop
    // Chrome, Mobile Chrome (Android/Pixel), Tablet Chrome, Mobile Safari (iOS/WebKit) -- and we
    // want ALL of them visible in the viewer, not just whichever finished last. So each project
    // writes its OWN prefixed screenshots and its OWN manifest-<slug>.js, and clears only its own
    // images. The profiles therefore ACCUMULATE: a given run refreshes just its own profile and
    // leaves the others' last-known screenshots in place.
    const projectName = test.info().project.name;
    const profileSlug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const PROFILE_LABELS = {
      'desktop-chrome': 'Desktop',
      'mobile-chrome': 'Android phone',
      'tablet-chrome': 'Tablet',
      'mobile-safari': 'iOS (Safari)',
    };
    const profileLabel = PROFILE_LABELS[profileSlug] || projectName;

    // The fill-quality assertions (flood-fill, edge-reach, responsiveness) are development gates
    // for the PRIMARY targets -- the touch Chromium profiles the board-fit was designed and
    // validated against. Desktop (a centered-hexagon layout the mobile fill metrics weren't meant
    // for) and iOS/Safari (which surfaces real, separately-tracked Safari fit differences) are
    // fixture-generation profiles: they still capture every screenshot and record every metric
    // (so the viewer flags issues visually), but they don't FAIL the suite -- a missing or
    // less-polished secondary profile must never break development. See playwright.config.js.
    const gatedProfile = profileSlug === 'mobile-chrome' || profileSlug === 'tablet-chrome';

    // Clear only THIS profile's previous images (prefixed with its slug); leave other profiles'.
    for (const f of fs.readdirSync(screenshotDir)) {
      if (f.startsWith(`${profileSlug}__`) && f.endsWith('.png')) fs.unlinkSync(path.join(screenshotDir, f));
    }
    const manifest = [];

    const results = [];
    try {
      for (const mode of MATRIX_MODES) {
        for (const drawerOpen of [false, true]) {
          for (let i = 0; i < SIZES_PER_SCENARIO; i++) {
            const width = Math.floor(WIDTH_RANGE[0] + rand() * (WIDTH_RANGE[1] - WIDTH_RANGE[0]));
            const height = Math.floor(HEIGHT_RANGE[0] + rand() * (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]));
            const label = `[${profileLabel}] ${mode}, drawer ${drawerOpen ? 'open' : 'closed'}, ${width}x${height}`;
            // Prefixed with the profile slug so profiles don't collide on disk or in the manifest.
            const fileLabel = `${profileSlug}__${mode}_drawer-${drawerOpen ? 'open' : 'closed'}_${width}x${height}_${i}`;

            const result = await runRandomTaps(page, {
              mode, drawerOpen, width, height, rand, N: TAPS_PER_RUN,
              screenshot: { dir: screenshotDir, label: fileLabel },
            });
            results.push({ label, ...result });
            manifest.push({
              profile: profileLabel, profileSlug,
              mode, drawerOpen, width, height, file: `${fileLabel}.png`,
              // Two essential fill metrics, both asserted and both flagged in the fixture:
              //  - flood-fill: largest contiguous black (empty) region as a fraction of the play
              //    area. A well-placed board bisects the play area so no black region dominates;
              //    >50% means the board is floating/undersized.
              //  - edge-reach: the Tonnetz must come within ~2 cells of at least TWO screen edges.
              //    Applies to every mode -- the board is the one thing that needs room, so whatever
              //    doesn't need height (stats bars, transport) belongs out of its way against an
              //    edge, leaving the board free to reach two edges itself.
              largestBlackFrac: result.largestBlackFrac, totalBlackFrac: result.totalBlackFrac,
              edgeReaches: result.edgeReaches, edgeMargins: result.edgeMargins,
              // belowFloor still drives the screenshot viewer's yellow flag at the STRICT <=2
              // threshold (live feedback: several real screenshots reaching within 3 but not 2
              // read as genuinely well-filled -- worth a human glance, not worth failing CI over,
              // so the visual flag stays fine-grained even though the assertion below relaxed).
              belowFloor: result.largestBlackFrac > 0.5 || result.edgeReaches < 2,
              tonnetzShare: Number(result.tonnetzShare.toFixed(2)),
              cellCount: result.cellCount, // how many cells are visible in this exact scenario --
                                            // see screenshots/index.html's per-mode histogram.
              drawerClipping: result.drawerClipping,
              controlsDominance: result.controlsDominance,
              floatingPanelGap: result.floatingPanelGap,
            });

            console.log(`[${label}] largest-black ${(result.largestBlackFrac*100).toFixed(0)}% (total ${(result.totalBlackFrac*100).toFixed(0)}%)  edges ${result.edgeReaches}/4  ${(result.tonnetzShare*100).toFixed(0)}% taps  ${result.cellCount} cells`);
            // Layout-correctness checks (not fill-quality/rendering-nuance) -- these describe an
            // actual CSS bug (content clipped outside its own container; a floating panel
            // stretched well past its content) regardless of which profile's rendering quirks are
            // in play, so unlike the fill-quality metrics below, they run on every profile.
            expect.soft(result.drawerClipping, `[${label}] the expanded drawer's own content should stay within the drawer's box, not wrapped/pushed out of it and clipped away (found: ${JSON.stringify(result.drawerClipping)})`).toEqual([]);
            if (result.floatingPanelGap) {
              // 60px tolerance for a panel's own padding/border/gap -- anything past that is real
              // unused blank space, not chrome. Relative floor too, so a large panel with a
              // proportionally small gap (ordinary breathing room) doesn't false-positive.
              const gap = result.floatingPanelGap;
              expect.soft(gap.blankBelow, `[${label}] #${gap.id} (floating panel) has ${gap.blankBelow.toFixed(0)}px of blank space below its real content (panel height ${gap.panelHeight.toFixed(0)}px) -- it should shrink to fit, not stretch to a fixed cap`)
                .toBeLessThan(Math.max(60, gap.panelHeight * 0.35));
            }
            if (result.controlsDominance) {
              // 0.75 is a generous ceiling -- legitimately taller control panels (Compose's own
              // tempo/quantize/transport/stats stack, say) can reasonably use most of the height
              // at some sizes; the real bug this catches rendered at a flat 1.0 (the entire
              // viewport height, regardless of how little content there actually was).
              const cd = result.controlsDominance;
              expect.soft(cd.heightFrac, `[${label}] #${cd.id} occupies ${(cd.heightFrac*100).toFixed(0)}% of the viewport's height -- it should size to its own content, not stretch to fill whatever's available (the "controls float, but eat the whole screen" defect)`)
                .toBeLessThanOrEqual(0.75);
            }
            // Soft assertions (not hard) so a single failing scenario doesn't abort the whole
            // matrix loop -- this test doubles as the screenshots/ fixture generator (see the
            // screenshotDir block above), and a hard throw partway through would leave the fixture
            // populated with only the modes before the failure (Sandbox is first, so its own
            // pre-existing wide/short-viewport defect -- see next_steps.md #76 -- would otherwise
            // strand every other mode). Soft failures still fail the test at the end, and report
            // EVERY bad scenario rather than just the first.
            if (gatedProfile) {
            expect.soft(result.respondedToModeSwitch, `[${label}] app should still respond to mode switching after ${TAPS_PER_RUN} random taps`).toBe(true);
            // The essential fill invariant: no single contiguous black region may cover more than
            // half the play area. A well-placed board bisects the play area, so its empty space is
            // broken up; one big black region means the board is floating/undersized -- the real
            // "doesn't fill the space" defect. Robust to aspect and to legitimate chrome (unlike the
            // edge-reach metric, which the user noted mis-flags Gravity's chrome-on-two-edges case),
            // so it's uniform across every mode. Soft so the loop still captures the whole fixture;
            // look at the attached failure screenshot.
            expect.soft(result.largestBlackFrac, `[${label}] the largest empty (black) region should be <=50% of the play area (was ${(result.largestBlackFrac*100).toFixed(0)}%; the board isn't bisecting the space)`).toBeLessThanOrEqual(0.5);
            // The edge-reach invariant, applied to EVERY mode: the Tonnetz must come within ~3
            // cells of at least two screen edges. Whatever chrome doesn't need height (a stats bar,
            // transport buttons) belongs against a single edge, not stacked above AND below the one
            // thing that needs the room. Measured off the drawn cells vs #game-container, in
            // cell-diameters, so it's zoom/size independent. Floor relaxed from 2 to 3 cells (live
            // feedback: several real screenshots reaching within 3 but not 2 -- e.g. Snake at a
            // narrow-ish landscape width -- read as genuinely well-filled boards, not defects; the
            // stricter 2-cell threshold still drives the screenshot viewer's yellow flag above, so
            // that finer distinction stays visible to a human reviewer even though it no longer
            // fails the automated suite on its own).
            expect.soft(result.edgeReachesLenient, `[${label}] the Tonnetz should reach at least 2 screen edges within 3 cell-diameters (reached ${result.edgeReachesLenient}: margins ${JSON.stringify(result.edgeMargins)} in cell-diameters); move non-height chrome out of the board's way`).toBeGreaterThanOrEqual(2);
            }
          }
        }
      }
    } finally {
      // Written even on a mid-loop assertion failure -- that's exactly when having screenshots of
      // everything captured so far is most useful for a human to look at.
      // Per-profile manifest that APPENDS to the shared global, so index.html loading every
      // profile's manifest accumulates them all (rather than one overwriting the rest).
      fs.writeFileSync(
        path.join(screenshotDir, `manifest-${profileSlug}.js`),
        `window.SCREENSHOT_MANIFEST = (window.SCREENSHOT_MANIFEST || []).concat(${JSON.stringify(manifest, null, 2)});\n`
      );
    }

    // Not yet asserted on -- distinct-controls-touched is still being calibrated (see the small
    // prototype's own low count). Reported in aggregate for now so it's visible across the full
    // matrix without gating the run on a bar that hasn't been set yet.
    const avgDistinct = results.reduce((s, r) => s + r.distinctControlsHit, 0) / results.length;
    console.log(`Matrix summary: ${results.length} scenarios, avg ${avgDistinct.toFixed(1)} distinct controls touched per scenario`);
  });
});
