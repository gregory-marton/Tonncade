/**
 * Turns a recorded bug-report replay (the JSON a player downloads/copies from the mosquito
 * "report a bug" link -- see js/replay.js) into a numbered-frame GIF, so a real session can be
 * watched and a specific broken frame pinpointed by number, instead of read as raw event JSON.
 *
 * Replaying real recorded (x, y) coordinates verbatim is unreliable for anything that isn't a
 * uniquely-id'd element: headless Chromium's font metrics differ enough from a real device's
 * that the same pixel coordinate can resolve to a different button in a tightly-packed row (this
 * is exactly what made an earlier gravity bug report look like a game-logic freeze when it was
 * actually a replay-script mistake). So targets are resolved by identity where possible:
 *   - "#some-id"            -> click by selector (unambiguous)
 *   - "polygon"              -> resolve via elementFromPoint + data-p/data-q, click by locator
 *   - "tag.class" (ambiguous, multiple instances, e.g. "div.mode-option") -> proportional
 *     position within the group at record time, mapped onto the live group's bounding boxes
 *   - anything else          -> raw coordinate click, best effort
 *
 * Mobile virtual control buttons (#m-btn-*, #snake-btn-*, see js/main.js's bindBtn) dispatch
 * their own synthetic keydown as a direct side effect of being clicked -- replaying the recorded
 * keydown too would double every action, so a keydown immediately following a virtual-button
 * click is treated as that click's echo and skipped.
 *
 * Usage:
 *   node scripts/replay-to-gif.js path/to/replay.json [options]
 *
 * Options:
 *   --out=<path>        Output GIF path (default: <replay-basename>.gif next to the input)
 *   --base-url=<url>    App URL to replay against (default: http://localhost:8001)
 *   --speed=<n>          Playback speed multiplier (default: 1 -- real recorded timing)
 *   --max-wait=<ms>      Cap on any single inter-event virtual-time advance, post-speed
 *                        (default: 300000 = 5min). Time is virtual (see clock.install/runFor
 *                        below), so even a real multi-second thinking-pause costs almost no
 *                        actual wall-clock time to replay -- this cap only guards against truly
 *                        pathological gaps (a session left open for hours) making the tool hang
 *                        while synchronously firing that many interval ticks.
 *   --frame-delay=<ms>   GIF per-frame display time (default: 700)
 *   --keep-frames        Don't delete the intermediate numbered PNGs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

function parseArgs(argv) {
    const opts = { baseUrl: 'http://localhost:8001', speed: 1, maxWait: 300000, frameDelay: 700, keepFrames: false };
    const positional = [];
    for (const arg of argv) {
        if (arg === '--keep-frames') { opts.keepFrames = true; continue; }
        const m = arg.match(/^--([a-z-]+)=(.*)$/);
        if (!m) { positional.push(arg); continue; }
        const key = m[1];
        const val = m[2];
        if (key === 'out') opts.out = val;
        else if (key === 'base-url') opts.baseUrl = val;
        else if (key === 'speed') opts.speed = parseFloat(val);
        else if (key === 'max-wait') opts.maxWait = parseInt(val, 10);
        else if (key === 'frame-delay') opts.frameDelay = parseInt(val, 10);
        else { console.error(`Unknown option: --${key}`); process.exit(1); }
    }
    if (positional.length !== 1) {
        console.error('Usage: node scripts/replay-to-gif.js path/to/replay.json [options]');
        process.exit(1);
    }
    opts.replayPath = positional[0];
    if (!opts.out) {
        const base = path.basename(opts.replayPath).replace(/\.json$/, '');
        opts.out = path.join(path.dirname(opts.replayPath), `${base}.gif`);
    }
    return opts;
}

function checkTool(name) {
    try {
        execFileSync(name, ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// A virtual control button's tap dispatches its own keydown synchronously (js/main.js's
// bindBtn) -- match its id pattern so that echoed keydown can be skipped during replay.
function isVirtualButtonTarget(target) {
    return typeof target === 'string' && /^#(m-btn-|snake-btn-)/.test(target);
}

async function resolveAndClick(page, ev, recordedViewport) {
    const target = ev.target;
    if (!target) {
        await page.mouse.click(ev.x, ev.y);
        return;
    }
    if (target.startsWith('#')) {
        const loc = page.locator(target).first();
        if (await loc.count() > 0) {
            await loc.click({ force: true }).catch(() => page.mouse.click(ev.x, ev.y));
            return;
        }
        await page.mouse.click(ev.x, ev.y);
        return;
    }
    if (target === 'polygon') {
        const cell = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el || el.tagName.toLowerCase() !== 'polygon') return null;
            return { p: el.getAttribute('data-p'), q: el.getAttribute('data-q') };
        }, { x: ev.x, y: ev.y });
        if (cell && cell.p !== null && cell.q !== null) {
            await page.locator(`polygon[data-p="${cell.p}"][data-q="${cell.q}"]`).first()
                .click({ force: true }).catch(() => page.mouse.click(ev.x, ev.y));
            return;
        }
        await page.mouse.click(ev.x, ev.y);
        return;
    }
    // The mode-option row is a small, fixed, always-present set (sandbox/midi/snake/blast/
    // gravity, in that DOM order) -- getting this one right matters more than any other
    // ambiguous target, since picking the wrong mode makes the rest of the replay meaningless.
    // Even "nearest live bounding-box center" (the general fallback below) can pick the wrong
    // button here: headless Chromium's font metrics can render this row with different button
    // widths than the recording device widely enough that the WRONG button is genuinely closer
    // in the replay environment, not just at some ambiguous boundary. Found live: a real
    // session's mode-option tap at x=365 (of 411px) resolved to "blast" by nearest-center in
    // headless, when the recorded session was verifiably in "gravity" (see the js/main.js:291
    // 'v'-keydown trick used to confirm this during investigation). Dividing the RECORDED
    // viewport width into N equal buckets and indexing into the live DOM by position instead
    // sidesteps the cross-environment rendering discrepancy entirely, since it never asks the
    // current browser where the buttons actually are.
    if (target === 'div.mode-option' && recordedViewport) {
        // The mode slider is a horizontal row in portrait, a vertical column in landscape (see
        // js/main.js's setMode, which slides the active-pill indicator along X or Y depending on
        // orientation) -- bucket along whichever axis matches.
        const landscape = recordedViewport.width > recordedViewport.height;
        const coord = landscape ? ev.y : ev.x;
        const span = landscape ? recordedViewport.height : recordedViewport.width;
        const clicked = await page.evaluate(({ coord, span }) => {
            const els = Array.from(document.querySelectorAll('.mode-option'));
            if (els.length === 0) return false;
            const idx = Math.max(0, Math.min(els.length - 1, Math.floor((coord / span) * els.length)));
            els[idx].click();
            return true;
        }, { coord, span });
        if (clicked) return;
        await page.mouse.click(ev.x, ev.y);
        return;
    }
    // "tag.class" selectors are ambiguous (many elements share them: piece-item carousel,
    // chord-match-item results, ...). Resolve by proportional position within the group instead
    // of trusting the raw pixel coordinate -- see file header.
    if (/^[a-z]+\.[\w-]+$/i.test(target) && recordedViewport) {
        const clicked = await page.evaluate(({ selector, x, y, vw, vh }) => {
            const els = Array.from(document.querySelectorAll(selector))
                .filter(el => el.offsetParent !== null); // visible only
            if (els.length === 0) return false;
            const fx = x / vw, fy = y / vh;
            const targetX = fx * window.innerWidth, targetY = fy * window.innerHeight;
            let best = null, bestDist = Infinity;
            for (const el of els) {
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                const d = Math.hypot(cx - targetX, cy - targetY);
                if (d < bestDist) { bestDist = d; best = el; }
            }
            if (best) { best.click(); return true; }
            return false;
        }, { selector: target, x: ev.x, y: ev.y, vw: recordedViewport.width, vh: recordedViewport.height });
        if (clicked) return;
        await page.mouse.click(ev.x, ev.y);
        return;
    }
    await page.mouse.click(ev.x, ev.y);
}

async function run(opts) {
    const data = JSON.parse(fs.readFileSync(opts.replayPath, 'utf8'));
    const events = data.events.filter(e => e.target !== '#report-bug-link');
    const firstResize = events.find(e => e.type === 'resize');
    const viewport = firstResize
        ? { width: firstResize.width, height: firstResize.height }
        : { width: 411, height: 761 };

    const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-frames-'));
    let frameNum = 0;
    let lastCellCount = null;
    let lastCaptureT = null;
    const warnings = [];

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport,
        hasTouch: true,
        userAgent: (data.meta && data.meta.userAgent) || undefined,
    });
    const page = await context.newPage();
    page.on('pageerror', err => warnings.push(`page error: ${err.message}`));
    page.on('dialog', async d => { await d.accept(); });

    // Install a fake clock BEFORE navigating so the page loads under normal (real-time) ticking,
    // then freeze it once loaded. From here on, time only advances via clock.runFor() (see the
    // replay loop below) -- deterministic virtual time, decoupled from how long clicks/evaluate
    // calls actually take in real wall-clock time. This matters a lot: without it, any per-event
    // orchestration overhead (mouse simulation, evaluate() round-trips) inflates real elapsed
    // time beyond the recorded deltas, so a real-time-driven timer (like GravityMode's 1000ms
    // drop interval) fires far more often relative to each dispatched player action than it did
    // in the original session -- pieces plummet past whatever steering got through, faithfully
    // replaying the button presses but not the game they actually produced.
    await page.clock.install({ time: 0 });

    await page.goto(`${opts.baseUrl}/?seed=${data.seed}`);
    await page.waitForLoadState('networkidle');
    // Freeze at whatever the (real-time-ticking-since-install) fake clock currently reads --
    // jumping it backward to a fixed value like 0 would move Date.now() into the past.
    const loadedAt = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(loadedAt);

    const captureFrame = async (label) => {
        frameNum++;
        const filePath = path.join(framesDir, `frame_${String(frameNum).padStart(4, '0')}.png`);
        const snapshot = await page.evaluate(() => ({
            mode: typeof App !== 'undefined' ? App.currentMode : null,
            cellCount: typeof Board !== 'undefined' ? Board.cells.size : null,
        }));
        const text = `#${frameNum}  ${label}${snapshot.cellCount !== null ? `  cells=${snapshot.cellCount}` : ''}`;
        // Stamp the label as a DOM overlay using the page's own already-loaded fonts, then
        // remove it -- avoids depending on ImageMagick/ffmpeg having a system font available,
        // which isn't guaranteed across environments (this tool needs to run anywhere).
        await page.evaluate((labelText) => {
            const el = document.createElement('div');
            el.id = '__replay_frame_label';
            el.textContent = labelText;
            Object.assign(el.style, {
                position: 'fixed', top: '0', left: '0', right: '0', zIndex: '999999',
                background: 'rgba(0,0,0,0.7)', color: '#fff', font: '14px monospace',
                padding: '4px 8px',
            });
            document.body.appendChild(el);
        }, text);
        await page.screenshot({ path: filePath });
        await page.evaluate(() => {
            const el = document.getElementById('__replay_frame_label');
            if (el) el.remove();
        });
        return { frameNum, label, filePath, ...snapshot };
    };

    const frameLog = [await captureFrame('start')];

    let lastVirtualClickT = null;
    let lastT = null;
    for (const ev of events) {
        // Advance virtual time to THIS event's own timestamp before applying its action, not
        // after -- any automatic timers (like GravityMode's 1000ms drop interval) due during a
        // real recorded pause must fire BEFORE the next click, matching the true recorded order.
        // Doing this backwards (click first, catch up on time after) applies each click to
        // whatever state existed at the END of the PREVIOUS event instead of the state that
        // actually existed at the moment the real player clicked -- found live: it made a piece
        // that was still mid-fall when rotated appear to jump straight to a brand-new spawn in a
        // single step, because the ticks that should have run before the click ran after it.
        if (lastT !== null) {
            const dt = Math.min((ev.t - lastT) / opts.speed, opts.maxWait);
            if (dt > 0) await page.clock.runFor(dt);
        }
        lastT = ev.t;

        if (ev.type === 'resize') {
            await page.setViewportSize({ width: ev.width, height: ev.height }).catch(() => {});
        } else if (ev.type === 'pointerdown') {
            await resolveAndClick(page, ev, viewport);
            if (isVirtualButtonTarget(ev.target)) lastVirtualClickT = ev.t;
        } else if (ev.type === 'keydown') {
            const isEcho = lastVirtualClickT !== null && Math.abs(ev.t - lastVirtualClickT) < 50;
            if (!isEcho) {
                const keyName = ev.code === 'Space' ? 'Space' : ev.key;
                if (ev.shiftKey) {
                    await page.keyboard.down('Shift');
                    await page.keyboard.press(keyName);
                    await page.keyboard.up('Shift');
                } else {
                    await page.keyboard.press(keyName);
                }
            }
        }

        // Capture whenever the board's cell count changes (a placement/lock/clear happened),
        // or every 3 real seconds regardless, so idle stretches don't leave a huge frame gap.
        const cellCount = await page.evaluate(() => (typeof Board !== 'undefined' ? Board.cells.size : null));
        const dueForPeriodicCapture = lastCaptureT === null || ev.t - lastCaptureT >= 3000;
        if (cellCount !== lastCellCount || dueForPeriodicCapture) {
            frameLog.push(await captureFrame(cellCount !== lastCellCount ? 'board-changed' : 'periodic'));
            lastCellCount = cellCount;
            lastCaptureT = ev.t;
        }
    }

    await page.clock.runFor(1000);
    frameLog.push(await captureFrame('end'));

    await browser.close();

    const haveFfmpeg = checkTool('ffmpeg');
    if (!haveFfmpeg) {
        console.error('ffmpeg not found -- cannot assemble the GIF. Frames left in:', framesDir);
        process.exit(1);
    }

    const pattern = path.join(framesDir, 'frame_%04d.png');
    execFileSync('ffmpeg', [
        '-y', '-framerate', String(1000 / opts.frameDelay),
        '-i', pattern,
        '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
        opts.out,
    ], { stdio: 'inherit' });

    if (!opts.keepFrames) {
        fs.rmSync(framesDir, { recursive: true, force: true });
    } else {
        console.log('Frames kept at:', framesDir);
    }

    console.log(`\nWrote ${opts.out} (${frameNum} frames).`);
    if (warnings.length) {
        console.log('\nWarnings:');
        warnings.forEach(w => console.log(' -', w));
    }
}

if (require.main === module) {
    const opts = parseArgs(process.argv.slice(2));
    run(opts).catch(err => {
        console.error('replay-to-gif failed:', err.stack || err.message);
        process.exit(1);
    });
}

module.exports = { parseArgs, isVirtualButtonTarget };
