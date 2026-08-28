#!/usr/bin/env node
/**
 * Screenshots #top-drawer/#drawer-handle at a representative viewport, both expanded (the
 * default) and collapsed (after clicking #drawer-toggle), for visual QA of the drawer UX.
 *
 * Starts its own static server against the repo root (same command playwright.config.js's own
 * webServer uses) rather than assuming one is already running, so this works standalone.
 *
 * Usage: node scripts/screenshot-drawer.js [outDir]
 *   outDir defaults to test-results/drawer-screenshots/
 */
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('../node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 8099; // distinct from playwright.config.js's own 8001, so this can run alongside a test run
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, 'test-results', 'drawer-screenshots'));

const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
    { name: 'portrait', width: 411, height: 761, isMobile: true, hasTouch: true },
    { name: 'landscape', width: 817, height: 331, isMobile: true, hasTouch: true },
];

function waitForServer(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => fetch(url).then(() => true).catch(() => {
        if (Date.now() > deadline) throw new Error(`Server at ${url} never came up`);
        return new Promise((r) => setTimeout(r, 200)).then(attempt);
    });
    return attempt();
}

async function main() {
    require('fs').mkdirSync(OUT_DIR, { recursive: true });

    const server = spawn('npx', ['http-server', '-p', String(PORT), '-c-1'], { cwd: ROOT, stdio: 'ignore' });
    const stopServer = () => server.kill();
    process.on('exit', stopServer);

    try {
        await waitForServer(`http://localhost:${PORT}`, 15000);

        const browser = await chromium.launch();
        for (const vp of VIEWPORTS) {
            const context = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                isMobile: vp.isMobile,
                hasTouch: vp.hasTouch,
            });
            const page = await context.newPage();
            await page.goto(`http://localhost:${PORT}/`);
            await page.waitForLoadState('networkidle');

            const expandedPath = path.join(OUT_DIR, `${vp.name}_expanded.png`);
            await page.screenshot({ path: expandedPath });

            await page.evaluate(() => document.getElementById('drawer-toggle').click());
            await page.waitForTimeout(400); // let the CSS collapse transition finish

            const collapsedPath = path.join(OUT_DIR, `${vp.name}_collapsed.png`);
            await page.screenshot({ path: collapsedPath });

            console.log(`${vp.name}: ${expandedPath}`);
            console.log(`${vp.name}: ${collapsedPath}`);

            await context.close();
        }
        await browser.close();
    } finally {
        stopServer();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
