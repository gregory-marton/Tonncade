#!/usr/bin/env node
/**
 * Checks that every literal DOM id referenced from js/*.js (via getElementById('x'),
 * querySelector('#x'), or querySelectorAll('#x')) actually exists as an id="x" attribute
 * somewhere in index.html.
 *
 * Exists because of a real, silent regression: js/main.js's mobile-drawer relocation logic
 * referenced #midi-folder-group and #midi-online-group by string literal. When index.html's
 * markup was later reorganized and those ids were removed, every one of those lookups quietly
 * returned null (getElementById on a missing id never throws), and the already-existing
 * `if (el) ...` guards swallowed it completely -- no console error, no crash, nothing any
 * runtime test happened to exercise would catch. The actual symptom (an element that should
 * have been relocated stayed hidden inside a now-display:none container) only became visible
 * live, on mobile, days later. This check catches the root cause directly and immediately, at
 * edit time, independent of viewport, mode, or runtime code path -- a stale id reference is
 * always a bug the moment it's introduced, whether or not any test happens to exercise the
 * code path that dereferences it.
 *
 * Deliberately does NOT try to catch every possible way an id could be referenced (template
 * literals with interpolation, ids built by concatenation, etc.) -- those need a human reading
 * the code anyway. It catches the overwhelmingly common case (a quoted string literal), which
 * is what this project's codebase uses almost universally for DOM lookups.
 *
 * Usage: node scripts/check-dom-ids.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const JS_DIR = path.join(ROOT, 'js');

const indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');

// Every id="..." (or id='...') attribute literally present in index.html, plus every id set
// dynamically in JS itself (e.g. `el.id = 'foo'` or `opt.id = 'bar'`) -- some ids (like the
// mobile-always-visible dock's injected children) aren't in the static markup at all.
const knownIds = new Set();
for (const m of indexHtml.matchAll(/\bid=["']([^"']+)["']/g)) knownIds.add(m[1]);

const jsFiles = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
for (const file of jsFiles) {
    const text = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    for (const m of text.matchAll(/\.id\s*=\s*['"]([^'"]+)['"]/g)) knownIds.add(m[1]);
    for (const m of text.matchAll(/\.setAttribute\(\s*['"]id['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)) knownIds.add(m[1]);
}

// Every id js/*.js actually LOOKS UP by literal string, paired with which file(s) and how many
// times, so a failure report is immediately actionable.
const references = new Map(); // id -> Set(filenames)
const LOOKUP_PATTERN = /\b(?:document\.)?(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\))/g;

for (const file of jsFiles) {
    const text = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    for (const m of text.matchAll(LOOKUP_PATTERN)) {
        const id = m[1] || m[2];
        if (!references.has(id)) references.set(id, new Set());
        references.get(id).add(file);
    }
}

const missing = [...references.keys()].filter((id) => !knownIds.has(id)).sort();

if (missing.length === 0) {
    console.log(`PASS: every literal DOM id referenced from js/*.js (${references.size} distinct ids checked) exists in index.html.`);
    process.exit(0);
}

console.error(`FAIL: ${missing.length} DOM id(s) referenced from js/*.js do not exist anywhere in index.html:\n`);
for (const id of missing) {
    console.error(`  "${id}" -- referenced from: ${[...references.get(id)].join(', ')}`);
}
console.error('\nEither the id was renamed/removed in index.html and these references were never updated\n(the actual regression this check exists to catch), or it really is dead code worth deleting.');
process.exit(1);
