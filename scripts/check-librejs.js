/**
 * Runs the REAL GNU LibreJS compliance checker (not a reimplementation of its detection
 * logic) against the local dev server, and reports pass/fail by reading its own output.
 *
 * Requires a sibling checkout of https://github.com/gnu/librejs (or savannah.gnu.org's
 * librejs.git) with librejs.xpi already built (see that repo's build.sh) and its own
 * `npm install` run (selenium-webdriver + geckodriver), plus Firefox installed locally.
 *
 * Usage:
 *   node scripts/check-librejs.js
 *   LIBREJS_DIR=/path/to/librejs TARGET_URL=http://localhost:8001 node scripts/check-librejs.js
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const libreJsDir = process.env.LIBREJS_DIR || path.join(__dirname, '..', '..', 'librejs');
const targetUrl = process.env.TARGET_URL || 'http://localhost:8001';

if (!fs.existsSync(path.join(libreJsDir, 'utilities', 'compliance.js'))) {
    console.error(`FAIL: could not find utilities/compliance.js under LIBREJS_DIR (${libreJsDir}).`);
    console.error('Set LIBREJS_DIR to your local checkout of https://github.com/gnu/librejs, with librejs.xpi built.');
    process.exit(1);
}

console.log(`Running the real LibreJS compliance tool against ${targetUrl}...`);
let output;
try {
    output = execSync(`node utilities/compliance.js ${targetUrl}`, {
        cwd: libreJsDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
} catch (err) {
    console.error('FAIL: the LibreJS compliance tool itself errored out (Firefox/geckodriver/librejs.xpi setup issue?).');
    console.error(err.stdout || err.message);
    process.exit(1);
}

console.log(output);

if (output.includes('No BLOCKED scripts on this page.')) {
    console.log('PASS: LibreJS reports no blocked scripts.');
    process.exit(0);
} else {
    console.error('FAIL: LibreJS blocked one or more scripts on this page — see the "BLOCKED scripts" section above.');
    process.exit(1);
}
