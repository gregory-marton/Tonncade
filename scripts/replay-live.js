#!/usr/bin/env node
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
 * Plays a captured replay (the JSON a player downloads/copies from the mosquito "report a bug"
 * link -- see js/replay.js) back in a real, visible browser window -- "just let me watch it
 * happen," no GIF/viewer-file generation step (that's scripts/replay-to-gif.js, unchanged and
 * still the right tool for a shareable bug-report artifact).
 *
 * Deliberately reuses tests/helpers/replay-driver.js -- the SAME mechanism every story test
 * (tests/stories*.spec.js) uses to reconstruct a session. That's load-bearing, not just DRY: a
 * genuinely different/simpler live-replay path would never exercise the same frozen-clock/tick-
 * catchup machinery a story test is forced to use, and could easily "work" here while silently
 * misreconstructing what a story test would actually see (this is exactly how Snake's flourish
 * freeze was found in the first place -- see js/snake.js's playFlourish history).
 *
 * Usage:
 *   node scripts/replay-live.js path/to/replay.json [options]
 *   npm run replay:live -- path/to/replay.json [options]
 *
 * Options:
 *   --speed=<n>          Playback pacing multiplier (default 1). Delay between dispatched events
 *                         is BASE_DELAY_MS / speed -- higher is faster. Purely for human watching;
 *                         has no effect on the deterministic tick/game-state reconstruction.
 *   --base-url=<url>     App URL to replay against (default http://localhost:8001)
 *   --start-hash=<mode>  Mode the session actually started in when no click ever switched to it
 *                         (a deep link) -- see scripts/replay-to-gif.js's own doc comment for the
 *                         full reasoning. Also used to auto-select --tick-fn for known
 *                         automatic-tick modes (gravity, snake) unless --tick-fn overrides it.
 *   --tick-fn=<Obj.fn>   Explicit tick function for deterministic replay (e.g. 'GravityMode.tick')
 *                         -- only needed for a mode with automatic tick-driven advancement whose
 *                         --start-hash isn't one of the known ones below, or when there's no
 *                         --start-hash at all (a real mode-switch click resolves the mode instead,
 *                         so this can't be inferred up front).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { replayEvents } = require('../tests/helpers/replay-driver');

// Modes with automatic tick()-driven advancement (js/replay.js's Replay.recordTick()) -- every
// other mode either has no automatic advancement at all (Blast, Sandbox, ...) or isn't wired up
// for deterministic tick replay yet.
const TICK_FN_BY_MODE = {
    gravity: 'GravityMode.tick',
    snake: 'SnakeMode.tick',
};

const BASE_DELAY_MS = 250;

function parseArgs(argv) {
    const opts = { baseUrl: 'http://localhost:8001', speed: 1 };
    const positional = [];
    for (const arg of argv) {
        const m = arg.match(/^--([a-z-]+)=(.*)$/);
        if (!m) { positional.push(arg); continue; }
        const key = m[1];
        const val = m[2];
        if (key === 'speed') opts.speed = parseFloat(val);
        else if (key === 'base-url') opts.baseUrl = val;
        else if (key === 'start-hash') opts.startHash = val;
        else if (key === 'tick-fn') opts.tickFn = val;
        else { console.error(`Unknown option: --${key}`); process.exit(1); }
    }
    if (positional.length !== 1) {
        console.error('Usage: node scripts/replay-live.js path/to/replay.json [options]');
        process.exit(1);
    }
    opts.replayPath = positional[0];
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const data = JSON.parse(fs.readFileSync(opts.replayPath, 'utf8'));
    const events = data.events;
    if (!events || events.length === 0) {
        console.error('No events in this replay file.');
        process.exit(1);
    }

    const tickFn = opts.tickFn || (opts.startHash && TICK_FN_BY_MODE[opts.startHash]) || null;

    const viewport = events[0].type === 'resize'
        ? { width: events[0].width, height: events[0].height }
        : { width: 1280, height: 800 };

    console.log(`Launching a real browser window -- ${path.basename(opts.replayPath)}, seed ${data.seed}${tickFn ? `, deterministic via ${tickFn}` : ''}...`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        viewport,
        hasTouch: !!(data.meta && data.meta.maxTouchPoints > 0),
        userAgent: (data.meta && data.meta.userAgent) || undefined,
    });
    const page = await context.newPage();
    page.on('dialog', async (d) => { await d.accept(); });

    // Same reasoning as scripts/replay-to-gif.js: install before navigating so the page loads
    // under normal real-time ticking, then freeze once loaded -- deterministic virtual time from
    // here on, decoupled from how long this script's own orchestration actually takes.
    await page.clock.install({ time: 0 });
    await page.goto(`${opts.baseUrl}/?seed=${data.seed}`);
    await page.waitForLoadState('networkidle');
    if (opts.startHash) {
        await page.evaluate((h) => { location.hash = '#' + h; }, opts.startHash);
        await page.waitForFunction((h) => location.hash === '#' + h, opts.startHash);
    }
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    // Drop the leading resize (viewport already set above) and any trailing #report-bug-link
    // click, same liberties every story test takes -- see tests/stories.desktop.spec.js's file header.
    const startIdx = events[0].type === 'resize' ? 1 : 0;
    let endIdx = events.length;
    while (endIdx > startIdx && typeof events[endIdx - 1].target === 'string'
        && events[endIdx - 1].target.includes('report-bug-link')) {
        endIdx--;
    }
    const gameplayEvents = events.slice(startIdx, endIdx);

    const delayMs = Math.max(0, BASE_DELAY_MS / opts.speed);
    await replayEvents(page, gameplayEvents, {
        tickFn,
        recordedViewport: viewport,
        delayMs,
    });

    console.log('Replay finished. Window stays open -- Ctrl+C to close it.');
    await new Promise(() => {}); // hang until interrupted
}

process.on('SIGINT', () => process.exit(0));

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
