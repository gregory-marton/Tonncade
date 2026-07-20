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
 * Automatic mode advancement (GravityMode/SnakeMode's setInterval-driven tick()) is reconstructed
 * from each event's `tick` count where available (see js/replay.js's Replay.recordTick) -- call
 * tick() directly that many times between events, no timing involved. This is what makes replay
 * deterministic. Older replays recorded before that instrumentation existed fall back to
 * reconstructing tick timing from wall-clock deltas via Playwright's fake clock -- workable, but
 * found live to be fragile for long sessions with genuine multi-second thinking-pauses: a
 * sub-percent difference in replay timing compounded, over hundreds of state-dependent moves,
 * into a completely different eventual game outcome. Either way, the fake clock stays installed
 * and frozen throughout, so the real setInterval never fires on its own from however long the
 * script's own click/evaluate orchestration actually takes in real wall-clock time.
 *
 * Produces two local outputs, no network/publish step involved: a flat GIF (for pasting into an
 * issue) and a self-contained HTML viewer (embedded frames, scrubber, play/pause, prev/next --
 * open it directly with `file://`, no server needed) for actually stepping through frame by
 * frame to pinpoint a specific broken moment. Both are written next to the input JSON by default,
 * so save a downloaded/pasted replay into replays/ (gitignored, but a durable in-repo location --
 * not a job-scoped tmp dir that disappears when a session ends) and the GIF/viewer land there too.
 *
 * Usage:
 *   node scripts/replay-to-gif.js path/to/replay.json [options]
 *
 * Options:
 *   --out=<path>         Output GIF path (default: <replay-basename>.gif next to the input)
 *   --viewer-out=<path>  Output HTML viewer path (default: <replay-basename>.viewer.html)
 *   --no-gif             Skip GIF assembly (ffmpeg not required if this is set)
 *   --no-viewer          Skip HTML viewer generation
 *   --base-url=<url>     App URL to replay against (default: http://localhost:8001)
 *   --speed=<n>          Playback speed multiplier (default: 1 -- real recorded timing).
 *                        Only affects the wall-clock fallback path (see above); ignored when
 *                        the replay has tick-count data, since that path has no timing to scale.
 *   --max-wait=<ms>      Cap on any single inter-event virtual-time advance, post-speed
 *                        (default: 300000 = 5min). Only affects the wall-clock fallback path.
 *   --frame-delay=<ms>   GIF per-frame display time (default: 700)
 *   --keep-frames        Don't delete the intermediate numbered PNGs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

function parseArgs(argv) {
    const opts = {
        baseUrl: 'http://localhost:8001', speed: 1, maxWait: 300000, frameDelay: 700,
        keepFrames: false, makeGif: true, makeViewer: true,
    };
    const positional = [];
    for (const arg of argv) {
        if (arg === '--keep-frames') { opts.keepFrames = true; continue; }
        if (arg === '--no-gif') { opts.makeGif = false; continue; }
        if (arg === '--no-viewer') { opts.makeViewer = false; continue; }
        const m = arg.match(/^--([a-z-]+)=(.*)$/);
        if (!m) { positional.push(arg); continue; }
        const key = m[1];
        const val = m[2];
        if (key === 'out') opts.out = val;
        else if (key === 'viewer-out') opts.viewerOut = val;
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
    const base = path.basename(opts.replayPath).replace(/\.json$/, '');
    if (!opts.out) opts.out = path.join(path.dirname(opts.replayPath), `${base}.gif`);
    if (!opts.viewerOut) opts.viewerOut = path.join(path.dirname(opts.replayPath), `${base}.viewer.html`);
    return opts;
}

// A minimal, self-contained frame-by-frame viewer -- embedded base64 PNGs, no external
// resources, so it opens correctly straight off disk via file:// with no local server needed.
function buildViewerHtml(frames, seed) {
    const framesJson = JSON.stringify(frames.map(f => ({ num: f.frameNum, dataUri: f.dataUri })));
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Replay viewer -- seed ${seed}</title>
<style>
:root { --bg:#0d0f14; --panel:#171a22; --border:#2a2e3a; --text:#e8e6df; --dim:#8b90a0; --accent:#e0a548; --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace; --sans:-apple-system,"Segoe UI",system-ui,sans-serif; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:var(--sans); min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:32px 16px 64px; }
h1 { font-family:var(--mono); font-size:15px; font-weight:600; letter-spacing:0.02em; color:var(--dim); text-transform:uppercase; margin:0 0 20px; }
.viewer { display:flex; flex-direction:column; align-items:center; gap:16px; width:100%; max-width:460px; }
.stage { position:relative; border:1px solid var(--border); border-radius:10px; overflow:hidden; background:#000; width:100%; }
.stage img { display:block; width:100%; height:auto; }
.status-row { display:flex; justify-content:space-between; width:100%; font-family:var(--mono); font-size:13px; color:var(--dim); }
.controls { display:flex; align-items:center; gap:12px; width:100%; }
button.nav { background:var(--panel); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:13px; padding:8px 14px; border-radius:6px; cursor:pointer; }
button.nav:hover { border-color:var(--accent); }
button.nav:disabled { opacity:0.35; cursor:default; }
input[type="range"] { flex:1; accent-color:var(--accent); }
.hint { font-size:12px; color:var(--dim); margin-top:4px; text-align:center; }
@media (prefers-color-scheme: light) {
  body { --bg:#f4f2ed; --panel:#fff; --border:#ddd8cc; --text:#1c1a15; --dim:#7a7568; --accent:#b3771f; }
}
</style></head>
<body>
<h1>Replay Viewer &mdash; seed ${seed}</h1>
<div class="viewer">
  <div class="stage"><img id="stageImg" src="" alt="frame preview"></div>
  <div class="status-row"><span id="statusLabel"></span></div>
  <div class="controls">
    <button class="nav" id="prevBtn">&larr; Prev</button>
    <button class="nav" id="playBtn">Play</button>
    <input type="range" id="scrubber" min="0" value="0" step="1">
    <button class="nav" id="nextBtn">Next &rarr;</button>
  </div>
  <p class="hint">Arrow keys to step, space to play/pause.</p>
</div>
<script>
const FRAMES = ${framesJson};
let current = 0, playing = false, playTimer = null;
const stageImg = document.getElementById('stageImg');
const statusLabel = document.getElementById('statusLabel');
const scrubber = document.getElementById('scrubber');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const playBtn = document.getElementById('playBtn');
scrubber.max = FRAMES.length - 1;
function render() {
  const f = FRAMES[current];
  stageImg.src = f.dataUri;
  statusLabel.textContent = 'frame ' + f.num + ' / ' + FRAMES.length;
  scrubber.value = current;
  prevBtn.disabled = current === 0;
  nextBtn.disabled = current === FRAMES.length - 1;
}
function goTo(i) { current = Math.max(0, Math.min(FRAMES.length - 1, i)); render(); }
function stopPlaying() { playing = false; playBtn.textContent = 'Play'; if (playTimer) { clearInterval(playTimer); playTimer = null; } }
prevBtn.addEventListener('click', () => { stopPlaying(); goTo(current - 1); });
nextBtn.addEventListener('click', () => { stopPlaying(); goTo(current + 1); });
scrubber.addEventListener('input', () => { stopPlaying(); goTo(parseInt(scrubber.value, 10)); });
playBtn.addEventListener('click', () => {
  if (playing) { stopPlaying(); return; }
  playing = true; playBtn.textContent = 'Pause';
  playTimer = setInterval(() => { if (current >= FRAMES.length - 1) { stopPlaying(); return; } goTo(current + 1); }, 350);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { stopPlaying(); goTo(current - 1); }
  else if (e.key === 'ArrowRight') { stopPlaying(); goTo(current + 1); }
  else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
});
render();
</script>
</body></html>
`;
}

// Runs inside the page. What counts as "a placed cell" differs by mode: Gravity/Blast share the
// Board.cells map, but Sandbox keeps its own state.placedPieces array and never touches
// Board.cells at all -- reading Board.cells.size in Sandbox mode always reads 0, regardless of
// how many pieces have actually been placed, which looks exactly like "nothing ever placed"
// (found live investigating a Sandbox placement bug report -- the replay looked like every
// attempt silently failed, when the very first one had actually succeeded).
function getCellCountSnapshot() {
    const mode = typeof App !== 'undefined' ? App.currentMode : null;
    let cellCount = null;
    if (mode === 'sandbox' && typeof SandboxMode !== 'undefined') {
        cellCount = SandboxMode.state.placedPieces.length;
    } else if (typeof Board !== 'undefined') {
        cellCount = Board.cells.size;
    }
    return { mode, cellCount };
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

// Every real recorded session so far has come from a touch device (meta.maxTouchPoints > 0), and
// a real touchscreen tap has no preceding hover/move phase at all. Playwright's mouse API
// (page.mouse.click / locator.click) always sends a mousemove immediately before mousedown --
// and app code can reasonably hook window.onmousemove to update hover-preview state for
// desktop's mouse-driven UX (js/sandbox.js's updateGhost() does exactly this, moving
// state.hoverCell to match whatever the mouse last passed over). That preceding mousemove can
// satisfy a gate the app never expected a plain tap to satisfy on its own -- found live: this
// made a board tap appear to trigger Sandbox's placement logic, which made a replay-tool
// artifact look exactly like a real "tap places a piece" bug.
//
// page.touchscreen.tap() dispatches a real touchstart/touchend with no preceding move, which
// solves that -- but Chromium's CDP-driven touch injection doesn't reliably synthesize the
// compatibility mousedown/click a real device's touch stack produces afterward, and
// js/sandbox.js's board interaction is wired to onmousedown only (no separate touch listener).
// So the actual fix is a directly-dispatched mousedown/mouseup/click at the target coordinate,
// completely bypassing Playwright's own mouse-movement machinery -- a "cold" click with no
// hover phase, matching what a real device's touch-to-mouse-compatibility synthesis produces.
async function tap(page, x, y) {
    await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
    }, { x, y });
}

async function tapElement(page, locator, fallbackX, fallbackY) {
    try {
        const box = await locator.boundingBox();
        if (box) {
            await tap(page, box.x + box.width / 2, box.y + box.height / 2);
            return;
        }
    } catch {
        // fall through to raw-coordinate tap below
    }
    await tap(page, fallbackX, fallbackY);
}

async function resolveAndClick(page, ev, recordedViewport) {
    const target = ev.target;
    if (!target) {
        await tap(page, ev.x, ev.y);
        return;
    }
    if (target.startsWith('#')) {
        const loc = page.locator(target).first();
        if (await loc.count() > 0) {
            await tapElement(page, loc, ev.x, ev.y);
            return;
        }
        await tap(page, ev.x, ev.y);
        return;
    }
    if (target === 'polygon') {
        const cell = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el || el.tagName.toLowerCase() !== 'polygon') return null;
            return { p: el.getAttribute('data-p'), q: el.getAttribute('data-q') };
        }, { x: ev.x, y: ev.y });
        if (cell && cell.p !== null && cell.q !== null) {
            const loc = page.locator(`polygon[data-p="${cell.p}"][data-q="${cell.q}"]`).first();
            await tapElement(page, loc, ev.x, ev.y);
            return;
        }
        await tap(page, ev.x, ev.y);
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
        await tap(page, ev.x, ev.y);
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
        await tap(page, ev.x, ev.y);
        return;
    }
    await tap(page, ev.x, ev.y);
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
        const snapshot = await page.evaluate(getCellCountSnapshot);
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
        const buffer = await page.screenshot();
        await page.evaluate(() => {
            const el = document.getElementById('__replay_frame_label');
            if (el) el.remove();
        });
        if (opts.makeGif) fs.writeFileSync(filePath, buffer);
        const dataUri = opts.makeViewer ? `data:image/png;base64,${buffer.toString('base64')}` : null;
        return { frameNum, label, filePath, dataUri, ...snapshot };
    };

    const frameLog = [await captureFrame('start')];

    // Events recorded after the tick-counter instrumentation landed carry a `tick` field --
    // the number of automatic mode advances (GravityMode/SnakeMode's tick()) that had fired by
    // the time each event was recorded (see js/replay.js's Replay.recordTick). When present,
    // replay is fully deterministic: call tick() directly exactly that many times between
    // events, no timing involved at all. Older replays (recorded before this existed) fall back
    // to reconstructing tick timing from wall-clock deltas via the fake clock -- workable, but
    // found to be fragile for long sessions with genuine multi-second thinking-pauses: sub-
    // percent differences in replay timing compounded, over hundreds of state-dependent moves,
    // into a completely different eventual game outcome.
    const hasTickData = events.some(e => typeof e.tick === 'number');
    if (!hasTickData) {
        warnings.push('This replay predates tick-count instrumentation (js/replay.js\'s Replay.recordTick) -- falling back to wall-clock timing reconstruction, which is less reliable for long sessions with real pauses.');
    }

    let lastVirtualClickT = null;
    let lastT = null;
    let lastTickSeq = hasTickData ? (events[0].tick || 0) : 0;
    for (const ev of events) {
        if (hasTickData) {
            const ticksDue = (typeof ev.tick === 'number' ? ev.tick : lastTickSeq) - lastTickSeq;
            if (ticksDue > 0) {
                await page.evaluate((n) => {
                    for (let i = 0; i < n; i++) {
                        if (typeof App === 'undefined') continue;
                        if (App.currentMode === 'gravity' && typeof GravityMode !== 'undefined') GravityMode.tick();
                        else if (App.currentMode === 'snake' && typeof SnakeMode !== 'undefined') SnakeMode.tick();
                    }
                }, ticksDue);
            }
            lastTickSeq = typeof ev.tick === 'number' ? ev.tick : lastTickSeq;
        } else if (lastT !== null) {
            // Advance virtual time to THIS event's own timestamp before applying its action, not
            // after -- any automatic timers due during a real recorded pause must fire BEFORE the
            // next click, matching the true recorded order. Doing this backwards (click first,
            // catch up on time after) applies each click to whatever state existed at the END of
            // the PREVIOUS event instead of the state that actually existed at the moment the
            // real player clicked.
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
        const { cellCount } = await page.evaluate(getCellCountSnapshot);
        const dueForPeriodicCapture = lastCaptureT === null || ev.t - lastCaptureT >= 3000;
        if (cellCount !== lastCellCount || dueForPeriodicCapture) {
            frameLog.push(await captureFrame(cellCount !== lastCellCount ? 'board-changed' : 'periodic'));
            lastCellCount = cellCount;
            lastCaptureT = ev.t;
        }
    }

    await page.clock.runFor(1000);
    frameLog.push(await captureFrame('end'));

    // Sound verification: the replayed page runs the real app, so it records its OWN sound
    // trace via the same Replay.wrapSynth() instrumentation that produced the original
    // recording (see js/replay.js) -- every real note/chord played corresponds exactly to a
    // specific game action (INV-4, docs/invariants.md), so comparing the two traces note-by-
    // note finds the EXACT point reconstruction first disagrees with the original session,
    // rather than only ever being able to compare the final board state. Sounds live in their
    // own ring buffer (Replay.soundLog), separate from the raw input-event log, since they're
    // produced at a much higher volume (~8x more sound events than input events in one real
    // session) and would otherwise crowd real input events out of existence on a long session.
    // Replays recorded before this feature existed simply have no `sounds` array to compare, so
    // this silently does nothing for them.
    const originalSounds = data.sounds || [];
    let soundVerification = null;
    if (originalSounds.length > 0) {
        const reconstructedSounds = await page.evaluate(() =>
            typeof Replay !== 'undefined' ? Replay.soundLog : []
        );
        const minLen = Math.min(originalSounds.length, reconstructedSounds.length);
        let firstDivergence = -1;
        for (let i = 0; i < minLen; i++) {
            if (originalSounds[i].midi !== reconstructedSounds[i].midi) { firstDivergence = i; break; }
        }
        if (firstDivergence === -1 && originalSounds.length !== reconstructedSounds.length) {
            firstDivergence = minLen;
        }
        soundVerification = {
            originalCount: originalSounds.length,
            reconstructedCount: reconstructedSounds.length,
            matches: firstDivergence === -1,
            firstDivergenceIndex: firstDivergence,
            original: firstDivergence >= 0 ? (originalSounds[firstDivergence] || null) : null,
            reconstructed: firstDivergence >= 0 ? (reconstructedSounds[firstDivergence] || null) : null,
        };
    }

    await browser.close();

    const written = [];

    if (opts.makeGif) {
        const haveFfmpeg = checkTool('ffmpeg');
        if (!haveFfmpeg) {
            warnings.push('ffmpeg not found -- skipped GIF assembly.');
        } else {
            const pattern = path.join(framesDir, 'frame_%04d.png');
            execFileSync('ffmpeg', [
                '-y', '-framerate', String(1000 / opts.frameDelay),
                '-i', pattern,
                '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                opts.out,
            ], { stdio: 'inherit' });
            written.push(opts.out);
        }
    }

    if (opts.makeViewer) {
        fs.writeFileSync(opts.viewerOut, buildViewerHtml(frameLog, data.seed));
        written.push(opts.viewerOut);
    }

    if (!opts.keepFrames) {
        fs.rmSync(framesDir, { recursive: true, force: true });
    } else {
        console.log('Frames kept at:', framesDir);
    }

    console.log(`\nWrote ${frameNum} frames to:`);
    for (const w of written) {
        console.log(' -', w, w.endsWith('.html') ? `(open with: file://${path.resolve(w)})` : '');
    }
    if (warnings.length) {
        console.log('\nWarnings:');
        warnings.forEach(w => console.log(' -', w));
    }
    if (soundVerification) {
        console.log('\nSound verification (see js/replay.js\'s Replay.wrapSynth):');
        if (soundVerification.matches) {
            console.log(`  MATCH -- all ${soundVerification.originalCount} recorded notes/chords reproduced exactly.`);
        } else {
            console.log(`  DIVERGED at sound event #${soundVerification.firstDivergenceIndex} (of ${soundVerification.originalCount} original / ${soundVerification.reconstructedCount} reconstructed):`);
            console.log('    original:      ', JSON.stringify(soundVerification.original));
            console.log('    reconstructed: ', JSON.stringify(soundVerification.reconstructed));
            console.log('  Everything before this tick reconstructed faithfully; look at what happens at/after it.');
        }
    }
    return { soundVerification };
}

if (require.main === module) {
    const opts = parseArgs(process.argv.slice(2));
    run(opts).catch(err => {
        console.error('replay-to-gif failed:', err.stack || err.message);
        process.exit(1);
    });
}

module.exports = { parseArgs, isVirtualButtonTarget, resolveAndClick, getCellCountSnapshot };
