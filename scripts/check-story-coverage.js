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
 * Cross-checks docs/story-coverage.md's desired matrix against the real test titles in
 * tests/stories*.spec.js, per that file's title convention (see its own header):
 *   '<Mode> story (<Interface>): <what it verifies>'
 *
 * A planning aid, not a CI gate -- run on demand (`node scripts/check-story-coverage.js`), never
 * wired into `npm test`. Flags two kinds of drift: a test exists but the matrix doesn't say
 * "done" for that cell, or the matrix says "done" but no matching test title exists.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const COVERAGE_DOC = path.join(REPO_ROOT, 'docs', 'story-coverage.md');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const TITLE_RE = /test\(\s*'([A-Za-z]+) story \((Desktop|Mobile|Tablet|Safari)\):/g;

function readDesiredMatrix() {
    const md = fs.readFileSync(COVERAGE_DOC, 'utf8');
    const m = md.match(/```json\n([\s\S]*?)\n```/);
    if (!m) {
        console.error(`Couldn't find the machine-readable JSON block in ${COVERAGE_DOC}.`);
        process.exit(1);
    }
    return JSON.parse(m[1]);
}

function findStoryFiles() {
    return fs.readdirSync(TESTS_DIR)
        .filter((f) => /^stories(\..+)?\.spec\.js$/.test(f))
        .map((f) => path.join(TESTS_DIR, f));
}

function findActualTests(files) {
    const found = []; // { mode, interface, title, file }
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        let match;
        TITLE_RE.lastIndex = 0;
        while ((match = TITLE_RE.exec(src))) {
            found.push({ mode: match[1], interface: match[2], file: path.basename(file) });
        }
    }
    return found;
}

function main() {
    const desired = readDesiredMatrix();
    const files = findStoryFiles();
    const actual = findActualTests(files);

    const actualKeys = new Set(actual.map((a) => `${a.mode}/${a.interface}`));
    const problems = [];

    for (const [mode, byInterface] of Object.entries(desired)) {
        for (const [iface, status] of Object.entries(byInterface)) {
            const key = `${mode}/${iface}`;
            const exists = actualKeys.has(key);
            if (status === 'done' && !exists) {
                problems.push(`docs/story-coverage.md says ${key} is done, but no test titled '${mode} story (${iface}): ...' was found.`);
            } else if (status !== 'done' && exists) {
                problems.push(`A test titled '${mode} story (${iface}): ...' exists, but docs/story-coverage.md marks ${key} as "${status}", not "done".`);
            }
        }
    }
    for (const key of actualKeys) {
        const [mode, iface] = key.split('/');
        if (!desired[mode] || !(iface in desired[mode])) {
            problems.push(`A test titled '${mode} story (${iface}): ...' exists, but ${mode}/${iface} isn't in docs/story-coverage.md's matrix at all.`);
        }
    }

    console.log(`Found ${actual.length} story test(s) across ${files.length} file(s): ${files.map((f) => path.basename(f)).join(', ')}`);
    const doneCount = Object.values(desired).reduce((n, byIface) => n + Object.values(byIface).filter((s) => s === 'done').length, 0);
    const desiredCount = Object.values(desired).reduce((n, byIface) => n + Object.values(byIface).filter((s) => s === 'desired').length, 0);
    console.log(`Matrix: ${doneCount} done, ${desiredCount} desired-but-missing.`);

    if (problems.length === 0) {
        console.log('No drift between the matrix and the actual test titles.');
        process.exit(0);
    }
    console.log('\nDrift found:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
}

main();
