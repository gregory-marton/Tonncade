/*
@licstart  The following is the entire license notice for the
JavaScript code in this file.

Copyright (C) 2026  Gregory Marton

The JavaScript code in this file is free software: you can
redistribute it and/or modify it under the terms of the GNU
General Public License (GNU GPL) as published by the Free Software
Foundation, either version 3 of the License, or (at your option)
any later version.  The code is distributed WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.

As additional permission under GNU GPL version 3 section 7, you
may distribute non-source (e.g., minimized or compacted) forms of
that code without the copy of the GNU GPL normally required by
section 4, provided you include this license notice and a URL
through which recipients can access the Corresponding Source.

@licend  The above is the entire license notice
for the JavaScript code in this file.
*/
/**
 * Shared, framework-agnostic replay driver: given a Playwright `Page` -- either a test's own
 * page fixture or a plain page from a standalone `chromium.launch()` -- faithfully replays a
 * captured session's events (js/replay.js's window.replay() output) against it.
 *
 * Deliberately the ONE mechanism used by every story test (tests/stories*.spec.js). That's
 * load-bearing, not just DRY: the Snake flourish freeze (see js/snake.js's playFlourish history)
 * was originally found because the
 * RECONSTRUCTION mechanism itself was buggy under a frozen replay clock, not because the game was
 * broken -- a simpler/different live-replay path would never have exercised the same code and
 * would have silently missed it. Watching a session live and turning it into a story test later
 * must never diverge in what either would catch.
 *
 * Faithfulness notes (see tests/stories.desktop.spec.js's own file header for the full history/reasoning
 * behind each of these):
 *   - Deterministic tick catch-up when `opts.tickFn` is given: `ev.tick` deltas -> that many
 *     direct calls to the named tick function, no timing involved. This is what makes a
 *     flourish (js/snake.js) or a falling piece (js/gravity.js) replay correctly: both drive
 *     their own sub-steps through the SAME tick() entry point tracked by Replay.recordTick(), so
 *     nothing here needs to know about flourishes/drop-timing specifically.
 *   - `keydown` dispatch tries the recorded key, falling back to the recorded code on an
 *     unrecognized-key error (real sessions can carry non-game keys Playwright can't name, e.g.
 *     the composed character from a DevTools Cmd+Option+I shortcut -- neither is a real game
 *     control, so which one actually fires doesn't affect game state either way).
 *   - `pointerdown` resolves by identity, never a raw coordinate: `#id` (direct locator),
 *     `polygon` (elementFromPoint + the cell's own data-p/data-q, exactly what the app's own
 *     click handler reads), `div.mode-option` (bucketed by position within the LIVE
 *     `.mode-slider`'s own bounding box -- not the full viewport, which a real desktop session
 *     showed drifts wrong once that control isn't full-width -- using the recorded viewport only
 *     to pick portrait/landscape-row orientation, matching Render.isMobileLandscape's breakpoint).
 *   - `resize` sets the viewport at that exact point in the sequence, not just once up front --
 *     lets a session that deliberately changes window size/orientation mid-play actually exercise
 *     that code (ResizeObserver-driven refits) instead of silently flattening it away.
 *   - `reset`/`gameover` are side-effect markers recorded by the game itself the moment they
 *     happen (see e.g. js/snake.js's reset()/gameOver()), not inputs -- a real keydown/pointerdown
 *     already elsewhere in the log is what actually caused them, so these need no action here.
 */

async function resolveModeOptionClick(page, ev, recordedViewport) {
    const numOptions = await page.evaluate(() => document.querySelectorAll('.mode-option').length);
    const rect = await page.evaluate(() => {
        const el = document.querySelector('.mode-slider');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const isMobileLandscape = recordedViewport.width <= 950 && recordedViewport.width > recordedViewport.height;
    const localCoord = isMobileLandscape
        ? ev.y - (rect ? rect.top : 0)
        : ev.x - (rect ? rect.left : 0);
    const localSpan = isMobileLandscape
        ? (rect ? rect.height : recordedViewport.height)
        : (rect ? rect.width : recordedViewport.width);
    const idx = Math.max(0, Math.min(numOptions - 1, Math.floor((localCoord / localSpan) * numOptions)));
    const clicked = await page.evaluate((i) => {
        const els = Array.from(document.querySelectorAll('.mode-option'));
        if (els.length === 0 || i >= els.length) return false;
        els[i].click();
        return true;
    }, idx);
    if (!clicked) {
        await page.mouse.click(ev.x, ev.y).catch(() => {});
    }
}

// Every locator click below is speculative -- the recorded target may not exist or may not be
// actionable in this reconstruction (a transient/conditional element, e.g. a state-gated button).
// Playwright's default actionability wait is 30s; left uncapped, a session with even a handful of
// such misses turns a normal-length replay into a multi-minute-or-more hang, one silent 30s wait
// at a time (found live: a ~2500-event session took long enough to look hung outright). A short
// explicit timeout keeps a genuine miss cheap without weakening the SUCCESSFUL case, which
// resolves almost immediately regardless of the cap.
const CLICK_TIMEOUT_MS = 2000;

async function resolvePointerdown(page, ev, recordedViewport) {
    const target = ev.target;
    if (typeof target === 'string' && target.startsWith('#')) {
        await page.locator(target).click({ timeout: CLICK_TIMEOUT_MS }).catch(() => {});
        return;
    }
    if (target === 'polygon') {
        const cell = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el || el.tagName.toLowerCase() !== 'polygon') return null;
            return { p: el.getAttribute('data-p'), q: el.getAttribute('data-q') };
        }, { x: ev.x, y: ev.y });
        if (cell) {
            await page.locator(`polygon[data-p="${cell.p}"][data-q="${cell.q}"]`).first()
                .click({ force: true, timeout: CLICK_TIMEOUT_MS }).catch(() => {});
        }
        return;
    }
    if (target === 'div.mode-option' && recordedViewport) {
        await resolveModeOptionClick(page, ev, recordedViewport);
        return;
    }
    // Anything else (unrecognized/ambiguous target): best-effort raw coordinate click.
    await page.mouse.click(ev.x, ev.y).catch(() => {});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Array<object>} events - ONLY the events meant to be dispatched (the caller has already
 *   dropped anything handled separately -- e.g. a leading resize/mode-switch done explicitly
 *   before navigation, or a trailing #report-bug-link click).
 * @param {object} [opts]
 * @param {string|null} [opts.tickFn] - e.g. 'GravityMode.tick' or 'SnakeMode.tick'. Omit (null)
 *   for a session with no recorded tick data (e.g. Blast today), which skips catch-up entirely.
 * @param {{width:number,height:number}|null} [opts.recordedViewport] - needed only if `events`
 *   contains a `div.mode-option` pointerdown; used purely to pick the row-vs-column orientation
 *   breakpoint, matching Render.isMobileLandscape.
 * @param {number} [opts.startTick] - the tick count of whatever leading event was dropped by the
 *   caller (default 0 -- true for every session captured so far, all of which start at tick 0).
 */
async function replayEvents(page, events, opts = {}) {
    const { tickFn = null, recordedViewport = null, startTick = 0 } = opts;
    let lastTickSeq = startTick;

    for (const ev of events) {
        if (tickFn) {
            const ticksDue = (typeof ev.tick === 'number' ? ev.tick : lastTickSeq) - lastTickSeq;
            if (ticksDue > 0) {
                // GravityMode/SnakeMode are `const`-declared page globals -- visible as free
                // variables in page scope, but NOT properties of `window` (unlike old-style `var`
                // globals), so a `window[name]` walk always resolves to undefined here. Building
                // the call as a source string and running it via `new Function` resolves `path`
                // through the page's real lexical scope instead, with the correct `this` binding
                // (a normal `Obj.method()` call expression, not a detached reference).
                await page.evaluate(({ path, n }) => {
                    // eslint-disable-next-line no-new-func
                    const runTicks = new Function(`for (let j = 0; j < ${n}; j++) { ${path}(); }`);
                    runTicks();
                }, { path: tickFn, n: ticksDue });
            }
            lastTickSeq = typeof ev.tick === 'number' ? ev.tick : lastTickSeq;
        }

        if (ev.type === 'keydown') {
            const keyName = ev.code === 'Space' ? 'Space' : ev.key;
            if (ev.shiftKey) {
                await page.keyboard.down('Shift');
                try {
                    await page.keyboard.press(keyName);
                } catch (e) {
                    await page.keyboard.press(ev.code);
                }
                await page.keyboard.up('Shift');
            } else {
                try {
                    await page.keyboard.press(keyName);
                } catch (e) {
                    // A handful of real sessions carry non-game keys Playwright can't name (e.g.
                    // a composed accented character from a DevTools Cmd+Option+I shortcut) --
                    // falling back to the raw code is still a genuine keydown, just not the exact
                    // composed character, which doesn't matter since neither is a game control.
                    await page.keyboard.press(ev.code);
                }
            }
        } else if (ev.type === 'pointerdown') {
            await resolvePointerdown(page, ev, recordedViewport);
        } else if (ev.type === 'resize') {
            await page.setViewportSize({ width: ev.width, height: ev.height }).catch(() => {});
        }
        // 'pointerup', 'reset', 'gameover': no action -- see file header.
    }
}

module.exports = { replayEvents };
