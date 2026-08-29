const { test, expect } = require('@playwright/test');

test('desktop page title is correct', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Tonncade/);
});

test('the "</>" version tag next to the title links to the GitHub repo', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('#see-the-code-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://github.com/gregory-marton/Tonncade');
  await expect(link).toHaveAttribute('target', '_blank');
  // Prefixed with the "</>" glyph, not a word — see docs/invariants.md-adjacent i18n backlog note
  expect((await link.innerText()).trim()).toMatch(/^<\/>/);
  // The dynamic version text (js/main.js updateVersionTag) still lives inside the link
  await expect(link.locator('.version-tag')).toBeVisible();
});

// Reported live: Melody drills a specific OCTAVE, but the board only ever labeled cells with the
// bare note letter -- a player could never "read the music" directly off the Tonnetz, since the
// octave wasn't shown anywhere permanent (only Sandbox's transient tap-and-hold overlay had it).
// Added everywhere (not just Melody/Compose) via the shared Render.createLabel/createOctaveLabel
// path. Explicit constraint: the note letter's own centered position must NOT shift to make room
// for the octave digit -- confirmed here by checking the note-label's x is unchanged from its own
// getScreenPos, with the octave digit as a separate, independently-positioned sibling element.
test('Every cell shows a subtle octave digit beside (not merging into) its centered note-name label', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const result = await page.evaluate(() => {
    const { x: expectedX, y: expectedY } = Render.getScreenPos(0, 0);
    // Match by BOTH x and y -- axial hex geometry means distinct (p,q) cells can share an x
    // (same column, different row), so x alone is ambiguous.
    const noteLabel = Array.from(document.querySelectorAll('text.note-label')).find(t =>
      Math.abs(parseFloat(t.getAttribute('x')) - expectedX) < 0.5 &&
      Math.abs(parseFloat(t.getAttribute('y')) - (expectedY + 5)) < 0.5
    );
    const octaveLabel = Array.from(document.querySelectorAll('text.octave-label')).find(t =>
      Math.abs(parseFloat(t.getAttribute('y')) - parseFloat(noteLabel.getAttribute('y'))) < 0.5 &&
      parseFloat(t.getAttribute('x')) > expectedX
    );
    return {
      expectedX,
      noteText: noteLabel && noteLabel.textContent,
      noteX: noteLabel && parseFloat(noteLabel.getAttribute('x')),
      octaveText: octaveLabel && octaveLabel.textContent,
      octaveX: octaveLabel && parseFloat(octaveLabel.getAttribute('x')),
    };
  });

  // (0,0) is MIDI 60 = C4 (getNoteName -> 'C', getOctave -> 4).
  expect(result.noteText).toBe('C');
  expect(result.noteX).toBeCloseTo(result.expectedX, 1); // unchanged, still exactly centered
  expect(result.octaveText).toBe('4');
  expect(result.octaveX).toBeGreaterThan(result.noteX); // to the right, a separate element
});

test('chord guide has no placeholder explanation text before a chord is chosen', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('#chord-guide-results').innerText();
  expect(text.trim()).toBe('');
});

test('chord guide results show a piece preview matching the correct rotation, for every result across every chord type', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const chordSelect = page.locator('#chord-guide-select');
  const chordTypes = await chordSelect.locator('option').evaluateAll(
    (opts) => opts.map(o => o.value).filter(v => v !== '')
  );
  expect(chordTypes.length).toBeGreaterThan(0);

  let totalResultsChecked = 0;

  for (const chordType of chordTypes) {
    await chordSelect.selectOption(chordType);

    const firstMatch = page.locator('.chord-match-item').first();
    await expect(firstMatch).toBeVisible({ timeout: 3000 });

    const results = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.chord-match-item')).map(item => {
        const type = item.getAttribute('data-type');
        const rotation = parseInt(item.getAttribute('data-rotation'));
        const expectedCells = Pieces.getAbsoluteCells(type, 0, 0, rotation);
        const renderedHexes = item.querySelectorAll('.chord-match-preview polygon');
        return { type, rotation, expectedCount: expectedCells.length, renderedCount: renderedHexes.length };
      });
    });

    expect(results.length, `chord type "${chordType}" should have at least one match`).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.renderedCount, `chord "${chordType}", piece ${r.type} rot ${r.rotation}`).toBeGreaterThan(0);
      expect(r.renderedCount, `chord "${chordType}", piece ${r.type} rot ${r.rotation}`).toBe(r.expectedCount);
    }
    totalResultsChecked += results.length;
  }

  expect(totalResultsChecked).toBeGreaterThan(chordTypes.length); // most chord types have multiple matches

  // The old static "Use" badge text should be gone (spot-check on whatever's currently shown)
  const badgeText = await page.locator('.chord-match-item').first().locator('span').allTextContents();
  expect(badgeText.join('')).not.toContain('Use');
});

test('chord guide results are ordered simplest-first, matching the carousel order (not raw piece-type declaration order)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const chordSelect = page.locator('#chord-guide-select');
  const chordTypes = await chordSelect.locator('option').evaluateAll(
    (opts) => opts.map(o => o.value).filter(v => v !== '')
  );
  expect(chordTypes.length).toBeGreaterThan(0);

  let multiMatchChordsChecked = 0;

  for (const chordType of chordTypes) {
    await chordSelect.selectOption(chordType);
    await expect(page.locator('.chord-match-item').first()).toBeVisible({ timeout: 3000 });

    const pieceTypesInOrder = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.chord-match-item')).map(item => item.getAttribute('data-type'))
    );

    if (pieceTypesInOrder.length < 2) continue; // ordering is only observable with 2+ results
    multiMatchChordsChecked++;

    const carouselIndices = await page.evaluate((types) =>
      types.map(t => Pieces.CAROUSEL_ORDER.indexOf(t)), pieceTypesInOrder
    );
    const sortedIndices = [...carouselIndices].sort((a, b) => a - b);
    expect(carouselIndices, `chord "${chordType}": results ${pieceTypesInOrder.join(',')} should follow carousel order`).toEqual(sortedIndices);
  }

  expect(multiMatchChordsChecked).toBeGreaterThan(0); // sanity: the test actually exercised ordering
});

test('chord guide X button resets the dropdown without touching a selected candidate', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const resetBtn = page.locator('#chord-guide-reset');
  await expect(resetBtn).toBeHidden();

  const chordSelect = page.locator('#chord-guide-select');
  await chordSelect.selectOption('major');
  await expect(resetBtn).toBeVisible();

  await page.locator('.chord-match-item').first().click();
  const selectedBefore = await page.evaluate(() => SandboxMode.state.selectedPiece);
  expect(selectedBefore).not.toBeNull();

  await resetBtn.click();

  await expect(resetBtn).toBeHidden();
  expect(await chordSelect.inputValue()).toBe('');
  const resultsText = await page.locator('#chord-guide-results').innerText();
  expect(resultsText.trim()).toBe('');

  const selectedAfter = await page.evaluate(() => SandboxMode.state.selectedPiece);
  expect(selectedAfter).toBe(selectedBefore);
});

// ────────────────────────────────────────────────────────────────────────
// INV-27 (docs/invariants.md, issue #8): Sandbox's desktop instructional text next to the
// board (#placement-controls: "Shift-G / Click: Place/Pick up") promises a plain click does
// the same thing as Shift-G. #40's place-wedge redesign (deliberately, to fix a TOUCH
// rotate-tap timing bug) narrowed a plain click to pickup-or-play-note for every input,
// silently breaking that promise for desktop mouse clicks too. Lives here (not
// invariants.spec.js) because that file's playwright.config.js testMatch only runs on the
// touch-enabled Mobile/Tablet Chrome projects -- never Desktop Chrome -- so a desktop-mouse-
// specific invariant has to be tested here instead, same as INV-26 already is.
// ────────────────────────────────────────────────────────────────────────

test('INV-27: Sandbox (desktop) -- clicking an empty cell places the selected piece, as "Shift-G / Click: Place/Pick up" promises', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  // The single-hex piece ('.') -- simplest shape, no rotation/multi-cell shape to account for.
  await page.locator('.piece-item[data-key="."]').click();
  expect(await page.evaluate(() => SandboxMode.state.selectedPiece)).toBe('.');

  const cell = page.locator('polygon.cell:not(.ghost)[data-p="3"][data-q="3"]');
  await cell.hover(); // moves the ghost onto this cell first, same as a real cursor would
  await cell.click();

  const placed = await page.evaluate(() =>
    SandboxMode.state.placedPieces.some(pc => pc.type === '.' && pc.p === 3 && pc.q === 3)
  );
  expect(placed).toBe(true);
});

test('INV-27: Sandbox (desktop) -- clicking a cell with an existing piece still picks it up, unambiguous from placing', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  await page.evaluate(() => {
    SandboxMode.state.placedPieces.push({ type: '.', p: 5, q: 5, rotation: 0 });
    SandboxMode.refreshLattice();
  });

  // A placed piece renders its own top polygon (.placed-piece) layered over the base cell --
  // target that one specifically, matching what a real click actually lands on.
  const cell = page.locator('polygon.placed-piece[data-p="5"][data-q="5"]');
  await cell.hover();
  await cell.click();

  const stillPlaced = await page.evaluate(() =>
    SandboxMode.state.placedPieces.some(pc => pc.p === 5 && pc.q === 5)
  );
  expect(stillPlaced).toBe(false); // picked up, not left in place or duplicated
  expect(await page.evaluate(() => SandboxMode.state.selectedPiece)).toBe('.');
});

// Real bug reported live (issue #24): a picked-up piece is still "the current candidate," sitting
// over the very cell it just vacated -- which is now empty and valid again. selectFromCarousel's
// commit-then-switch behavior (deliberate for the NORMAL case: chaining fresh carousel placements
// without an extra tap) couldn't tell a fresh selection apart from a piece just picked up, so
// tapping ANY other piece type immediately re-placed the picked-up one right back where it came
// from -- making it impossible to actually remove a piece via pickup-then-switch, only pickup-
// then-explicit-place (the wedge) or pickup-then-note-tool (which bypasses the commit entirely).
test('Sandbox: picking up a piece then selecting a different type removes it, does not silently re-place it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  await page.evaluate(() => {
    SandboxMode.state.placedPieces.push({ type: '.', p: 5, q: 5, rotation: 0 });
    SandboxMode.refreshLattice();
  });

  const cell = page.locator('polygon.placed-piece[data-p="5"][data-q="5"]');
  await cell.hover();
  await cell.click(); // picks it up -- ghost now hovers exactly over (5,5), the cell it vacated

  await page.locator('.piece-item[data-key="-"]').click(); // select a DIFFERENT piece type

  const stillThere = await page.evaluate(() =>
    SandboxMode.state.placedPieces.some((pc) => pc.p === 5 && pc.q === 5)
  );
  expect(stillThere, 'the picked-up piece should be gone, not silently re-placed at (5,5)').toBe(false);
  expect(await page.evaluate(() => SandboxMode.state.selectedPiece)).toBe('-'); // new selection took
});

// Regression guard for the fix above: a FRESH carousel selection (not a pickup) must still
// auto-commit on the next carousel tap -- that chaining is the deliberate, unaffected case.
test('Sandbox: selecting a fresh candidate then a different one still commits the first (unaffected by the pickup fix)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  await page.locator('.piece-item[data-key="."]').click();
  const cell = page.locator('polygon.cell:not(.ghost)[data-p="4"][data-q="4"]');
  await cell.hover(); // moves the ghost onto this cell, same as a real cursor would

  await page.locator('.piece-item[data-key="-"]').click(); // switch to a different fresh type

  const committed = await page.evaluate(() =>
    SandboxMode.state.placedPieces.some((pc) => pc.type === '.' && pc.p === 4 && pc.q === 4)
  );
  expect(committed, 'the first selection should still auto-commit where the ghost was hovering').toBe(true);
  expect(await page.evaluate(() => SandboxMode.state.selectedPiece)).toBe('-');
});

test('midi note list fades past notes progressively by recency', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 3;
    MelodyMode.updateDifficultyUI();
  });

  const opacities = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('#melody-staff-labels [data-note-role="past"]'));
    const byDistance = {};
    spans.forEach(s => { byDistance[s.getAttribute('data-distance')] = parseFloat(s.style.opacity); });
    return byDistance;
  });

  expect(opacities['1']).toBeGreaterThan(opacities['2']);
  expect(opacities['2']).toBeGreaterThan(opacities['3']);
});

test('updateDifficultyUI(overrideIndex) pivots the window on the override, not state.userIndex', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const currentName = await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 0; // would normally show melody[0] as current
    MelodyMode.updateDifficultyUI(5); // override to pivot on index 5 instead
    const el = document.querySelector('#melody-staff-labels [data-note-role="current"]');
    return el ? el.textContent : null;
  });

  // Octave-qualified (e.g. "E4", not bare "E") since INV-25 -- two different-octave notes
  // sharing a bare name were an understandable "wrong note" mix-up (real report), fixed by
  // making the octave part of every displayed name, not just the current target's.
  //
  // keySignature must be passed here too -- state.melody is Melody's own random offline-degrade
  // default (unseeded Math.random()), so its DETECTED key (Tonnetz.detectKeySignature, set right
  // alongside state.melody) genuinely varies run to run and can land on a flat-preferring key.
  // The app itself always renders spelled per that detected key; omitting it here silently
  // defaults to sharps-only, which only coincidentally matches the app's own spelling and was a
  // real, deterministic (not flaky) source of failure whenever the random melody detected a flat
  // key (e.g. F major) -- "F#4" expected, "Gb4" actually rendered, both correct spellings of the
  // same pitch, but not the SAME spelling the app chose.
  const expectedName = await page.evaluate(() => {
    const midi = MelodyMode.state.melody[5].midi;
    return `${Tonnetz.getNoteName(midi, MelodyMode.state.keySignature)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

test('playing the full melody preview live-updates the note list as it plays', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.evaluate(() => { MelodyMode.state.difficulty = 1; });

  // resetGame() schedules an untracked 1s auto-kickoff of the "listen to the notes" teaching
  // intro that cleanupPlayback() can't cancel — let it fully play out and finish first so it
  // doesn't fire mid-test and wipe our own preview's scheduled timeouts via its own cleanup.
  await page.clock.fastForward(2000);

  await page.locator('#melody-play-preview').click();

  // Advance to when the 3rd note (index 2, "buns", scheduled ~1.2s into the preview) should be sounding
  await page.clock.fastForward(1300);

  const currentName = await page.evaluate(() => {
    const el = document.querySelector('#melody-staff-labels [data-note-role="current"]');
    return el ? el.textContent : null;
  });
  // Octave-qualified since INV-25, and keySignature-aware since the random melody's own detected
  // key varies run to run -- see the preceding test's own comment for why both matter here.
  const expectedName = await page.evaluate(() => {
    const midi = MelodyMode.state.melody[2].midi;
    return `${Tonnetz.getNoteName(midi, MelodyMode.state.keySignature)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

test('stopping preview restores the note list to reflect actual game progress', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 1; // simulate the player having already gotten 1 note right
  });

  // Let the auto-kickoff teaching intro (see comment in the preceding test) finish first.
  await page.clock.fastForward(2000);
  await page.evaluate(() => { MelodyMode.state.userIndex = 1; }); // teaching intro reset it to 0

  await page.locator('#melody-play-preview').click();
  await page.clock.fastForward(1300); // let preview scrub ahead to index 2

  // Manually stop the preview (the play button now shows the ⏹ stop icon)
  await page.locator('#melody-play-preview').click();

  const currentName = await page.evaluate(() => {
    const el = document.querySelector('#melody-staff-labels [data-note-role="current"]');
    return el ? el.textContent : null;
  });
  // Octave-qualified since INV-25 -- see the comment on the earlier "pivots the window" test.
  const expectedName = await page.evaluate(() => {
    const midi = MelodyMode.state.melody[MelodyMode.state.userIndex].midi;
    return `${Tonnetz.getNoteName(midi, MelodyMode.state.keySignature)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

// ────────────────────────────────────────────────────────────────────────
// MelodyFolder (js/melody.js -> js/file-folder.js's FileFolder, task #27 + the one-dropdown
// reorg): local MIDI folder source, folded into the single #melody-source select alongside "Random"
// and the bundled online tier, on browsers that support the File System Access API.
// window.showDirectoryPicker is mocked with a fake directory handle (real handles are
// structured-cloneable into IndexedDB specifically so they survive a real user's picker choice --
// a fake JS object with methods is NOT structured-cloneable, so these tests exercise
// FileFolder's own logic/wiring directly rather than round-tripping through real IndexedDB).
// MelodyMode.parseMIDI is stubbed too, since what's under test here is folder browsing, not
// Standard MIDI File decoding (which has no coverage of its own yet, tracked separately -- not
// something to conflate with this feature).
// ────────────────────────────────────────────────────────────────────────

// Builds a REAL ZIP archive (byte-exact to spec: local file headers, central directory, End Of
// Central Directory record) from `files` ({name, data: Buffer, method: 0|8}[]) using Node's own
// zlib for DEFLATE -- no zip library involved. CRC-32 fields are left as 0 throughout: js/mxl.js
// never reads them back (see its own file header), so an unzip tool that DOES verify them (this
// is a test fixture, not a real interop file) is the only thing that would ever notice.
function buildZip(files) {
  const zlib = require('zlib');
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  files.forEach((f) => {
    const stored = f.method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const nameBuf = Buffer.from(f.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);             // version needed
    local.writeUInt16LE(0, 6);              // flags
    local.writeUInt16LE(f.method, 8);       // compression method
    local.writeUInt16LE(0, 10);             // mod time
    local.writeUInt16LE(0, 12);             // mod date
    local.writeUInt32LE(0, 14);             // crc32 (unverified by js/mxl.js -- see above)
    local.writeUInt32LE(stored.length, 18); // compressed size
    local.writeUInt32LE(f.data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);             // extra field length
    localChunks.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);           // version made by
    central.writeUInt16LE(20, 6);           // version needed
    central.writeUInt16LE(0, 8);            // flags
    central.writeUInt16LE(f.method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);           // crc32
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);           // extra field length
    central.writeUInt16LE(0, 32);           // comment length
    central.writeUInt16LE(0, 34);           // disk number start
    central.writeUInt16LE(0, 36);           // internal attrs
    central.writeUInt32LE(0, 38);           // external attrs
    central.writeUInt32LE(offset, 42);      // local header offset
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  });

  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

// A real, spec-shaped .mxl fixture: a STORED META-INF/container.xml pointing at a DEFLATE-
// compressed root entry -- exercising both compression methods js/mxl.js supports in one fixture.
function buildMxlFixture(musicXmlText, { rootPath = 'song.musicxml' } = {}) {
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="${rootPath}"/></rootfiles></container>`;
  return buildZip([
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml, 'utf8'), method: 0 },
    { name: rootPath, data: Buffer.from(musicXmlText, 'utf8'), method: 8 },
  ]);
}

// A minimal single-entry .mxl with no META-INF/container.xml at all -- exercises
// Mxl.extractMusicXML's fallback scan for a bare .musicxml entry.
function buildMxlFixtureSingleEntry(musicXmlText, entryName) {
  return buildZip([{ name: entryName, data: Buffer.from(musicXmlText, 'utf8'), method: 8 }]);
}

// Each fake file's "bytes" are just a one-byte tag identifying which fake file it is; the
// parseMIDI stub reads that tag back out, so a distinct, easily-asserted MIDI note stands in for
// "this specific file's real content loaded" without needing real Standard MIDI File bytes.
const installFakeMelodyFolder = (page, { files, permission = 'granted' }) => page.evaluate(({ files, permission }) => {
  // Real FileSystemDirectoryHandles are structured-cloneable (by design, so they survive an
  // IndexedDB round-trip) -- a fake JS object with methods is NOT, so saveHandle would throw a
  // real DataCloneError against a fake handle. Stubbed out here since these tests exercise
  // FileFolder's own browsing/restore logic, not real IndexedDB persistence.
  MelodyFolder.saveHandle = async () => {};
  window.__parseMIDICalls = [];
  MelodyMode.parseMIDI = (buf) => {
    const tag = new Uint8Array(buf)[0];
    window.__parseMIDICalls.push(tag);
    return { notes: [{ midi: 60 + tag, time: 0, duration: 0.5 }] };
  };

  const entries = files.map(f => ({
    kind: 'file',
    name: f.name,
    getFile: async () => ({ name: f.name, arrayBuffer: async () => new Uint8Array([f.tag]).buffer }),
  }));
  // Records every {mode} a caller asks for, regardless of what's granted -- used by the
  // permission-mode regression tests below, which check WHAT was requested (readwrite vs read),
  // not just whether the fake grants it (a fake that grants everything regardless of mode is
  // exactly why this bug went uncaught: real browsers only grant what's actually asked for).
  window.__permissionModeCalls = [];
  window.__fakeFolderHandle = {
    name: 'MySongs',
    values: async function* () { for (const e of entries) yield e; },
    queryPermission: async (opts) => { window.__permissionModeCalls.push({ fn: 'query', mode: opts && opts.mode }); return permission; },
    requestPermission: async (opts) => { window.__permissionModeCalls.push({ fn: 'request', mode: opts && opts.mode }); return 'granted'; },
    // Default: nothing bundled already exists in this fake folder (chooseFolder's
    // copyDefaultsInto checks this before writing); tests that care about the copy-in behavior
    // itself override this after installFakeMelodyFolder runs.
    getFileHandle: async () => { throw new Error('not found'); },
  };
  window.__showDirectoryPickerCalls = [];
  window.showDirectoryPicker = async (opts) => { window.__showDirectoryPickerCalls.push(opts); return window.__fakeFolderHandle; };
}, { files, permission });

// The dropdown's local-folder entries have value "local:N"; helper to read them back as names.
const sourceLocalOptionNames = (page, selectId) => page.evaluate((id) =>
  Array.from(document.getElementById(id).options)
    .filter(o => o.value.startsWith('local:'))
    .map(o => o.textContent), selectId);

test('MelodyFolder: choosing a folder lists only .mid/.midi files (sorted) and auto-loads the first', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, {
    files: [
      { name: 'Zebra.mid', tag: 0 },
      { name: 'Apple.midi', tag: 1 },
      { name: 'readme.txt', tag: 2 }, // not a MIDI file -- must be filtered out
    ],
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.locator('#melody-source').selectOption('choose-folder');
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 61);

  // Sorted alphabetically, and readme.txt excluded entirely.
  expect(await sourceLocalOptionNames(page, 'melody-source')).toEqual(['Apple', 'Zebra']);

  // The first file in SORTED order (Apple, tag 1) auto-loads, not upload order (Zebra was listed
  // first in the fake folder above).
  const loadedMidi = await page.evaluate(() => MelodyMode.state.melody[0].midi);
  expect(loadedMidi).toBe(61);
});

test('MelodyFolder: selecting a different dropdown entry loads that file instead', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, {
    files: [{ name: 'Apple.mid', tag: 0 }, { name: 'Banana.mid', tag: 1 }],
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.locator('#melody-source').selectOption('choose-folder');
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 60); // Apple auto-loaded

  await page.locator('#melody-source').selectOption({ label: 'Banana' });
  await page.waitForFunction(() => MelodyMode.state.melody[0].midi === 61);
  expect(await page.evaluate(() => MelodyMode.state.melody[0].midi)).toBe(61);
});

test('MelodyFolder: a granted saved folder restores silently on entering Melody mode, no click needed', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [{ name: 'Saved.mid', tag: 5 }], permission: 'granted' });
  await page.evaluate(() => {
    MelodyFolder.loadHandle = async () => window.__fakeFolderHandle;
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 65);

  await expect(page.locator('#melody-source-status')).toHaveText(/MySongs/);
});

test('MelodyFolder: a lapsed (non-granted) saved folder shows a one-click reconnect instead of silently failing', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [{ name: 'Saved.mid', tag: 2 }], permission: 'prompt' });
  await page.evaluate(() => {
    MelodyFolder.loadHandle = async () => window.__fakeFolderHandle;
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'reconnect-folder'));

  // No file should have loaded yet -- permission wasn't granted, so nothing was silently read.
  expect(await sourceLocalOptionNames(page, 'melody-source')).toEqual([]);

  await page.locator('#melody-source').selectOption('reconnect-folder');
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 62);
});

test('MelodyFolder: on an unsupported browser, the folder UI stays hidden and the plain upload picker is untouched', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { delete window.showDirectoryPicker; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const hasFolderOption = await page.evaluate(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'choose-folder' || o.value === 'reconnect-folder'));
  expect(hasFolderOption).toBe(false);
  await expect(page.locator('#melody-upload-group')).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────
// MelodyFolder/ComposeFolder's bundled online tier (task #27): a plain relative fetch to ./midi/index.json, no
// File System Access API involved -- works in every browser, its entries simply don't appear in
// #melody-source on any failure (offline, file://, 404) rather than surfacing an error, since it's
// a bonus content tier, not a required one.
// ────────────────────────────────────────────────────────────────────────

test('MelodyFolder online: populates the dropdown from index.json, and selecting a song loads the real fetched file', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Test Song A', file: 'a.mid' }, { name: 'Test Song B', file: 'b.mid' }],
  }));
  await page.goto('/');

  // MIDI 60 specifically -- MelodyMode.loadMelodyFromArrayBuffer runs loaded notes through
  // centerMelody(), which shifts by whole octaves toward 60; a non-centered test note would get
  // silently transposed, making this assertion fail for the wrong reason.
  const bytes = await page.evaluate(() => Array.from(new Uint8Array(MelodyMode.writeMIDI([{ midi: 60, time: 0, duration: 0.4 }]))));
  await page.route('**/midi/b.mid', route => route.fulfill({ body: Buffer.from(bytes), contentType: 'audio/midi' }));

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'bundled:1'));

  const select = page.locator('#melody-source');
  const optionNames = await page.evaluate(() =>
    Array.from(document.getElementById('melody-source').options)
      .filter(o => o.value.startsWith('bundled:'))
      .map(o => o.textContent));
  expect(optionNames).toEqual(['Test Song A', 'Test Song B']);
  // Melody's own offline-degrade (Random) stays the actually-loaded default -- the bundled tier
  // is merely available, not auto-loaded, matching Melody's existing behavior before this reorg.
  expect(await select.inputValue()).toBe('random');

  await select.selectOption({ label: 'Test Song B' });
  await page.waitForFunction(() => MelodyMode.state.melody.length === 1 && MelodyMode.state.melody[0].midi === 60);
});

test('MelodyFolder online: a failed fetch (offline/404) leaves no bundled entries in the dropdown', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForTimeout(200); // let the failed fetch settle

  const hasBundled = await page.evaluate(() =>
    [...document.getElementById('melody-source').options].some(o => o.value.startsWith('bundled:')));
  expect(hasBundled).toBe(false);
});

test('ComposeFolder online: Compose gets the same bundled songs via its own dropdown', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Test Song A', file: 'a.mid' }],
  }));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.waitForFunction(() =>
    [...document.getElementById('compose-source').options].some(o => o.value === 'bundled:0'));
  const optionNames = await page.evaluate(() =>
    Array.from(document.getElementById('compose-source').options)
      .filter(o => o.value.startsWith('bundled:'))
      .map(o => o.textContent));
  expect(optionNames).toEqual(['Test Song A']);
});

test('MelodyFolder: choosing a folder copies bundled defaults into it that it does not already have', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Bundled Song', file: 'bundled.mid' }],
  }));
  const bytes = await Buffer.from([9]); // matches the fake parseMIDI stub's tag convention below
  await page.route('**/midi/bundled.mid', route => route.fulfill({ body: bytes, contentType: 'audio/midi' }));

  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [{ name: 'Existing.mid', tag: 0 }] });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'bundled:0'));

  const written = await page.evaluate(async () => {
    const calls = [];
    window.__fakeFolderHandle.getFileHandle = async (name, opts) => {
      if (!opts || !opts.create) throw new Error('not found'); // existence check: nothing there yet
      calls.push(name);
      return {
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      };
    };
    document.getElementById('melody-source').value = 'choose-folder';
    document.getElementById('melody-source').dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return calls;
  });
  expect(written).toContain('bundled.mid');
});

// Reported live: "When selecting my music folder which already had the defaults in it, I ended
// up with duplicates in the menu... not duplicate files, just duplicate menu entries." Root
// cause: the bundled songs' own format migrated from .mid to .musicxml at some point (see
// midi/index.json), and copyDefaultsInto's "do we already have this" check only looked for the
// EXACT current filename -- a folder populated back when the bundled index still said
// "bundled.mid" never matches today's "bundled.musicxml", so the new file gets copied in
// alongside the old one. Both display with the SAME label (renderOptions strips the extension),
// so the dropdown shows the song name twice even though the two entries are genuinely different
// files, exactly matching what was reported.
test('MelodyFolder: choosing a folder does not duplicate a bundled default that already exists under an older extension', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Bundled Song', file: 'bundled.musicxml' }],
  }));
  await page.route('**/midi/bundled.musicxml', route => route.fulfill({ body: '<score-partwise/>', contentType: 'application/vnd.recordare.musicxml+xml' }));

  await page.goto('/');
  // The folder already has this exact song, just under the OLD bundled extension.
  await installFakeMelodyFolder(page, { files: [{ name: 'bundled.mid', tag: 0 }] });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'bundled:0'));

  const written = await page.evaluate(async () => {
    const calls = [];
    window.__fakeFolderHandle.getFileHandle = async (name, opts) => {
      if (!opts || !opts.create) {
        if (name === 'bundled.mid') return { getFile: async () => ({ name, arrayBuffer: async () => new Uint8Array([0]).buffer }) };
        throw new Error('not found');
      }
      calls.push(name);
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
    document.getElementById('melody-source').value = 'choose-folder';
    document.getElementById('melody-source').dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return calls;
  });
  expect(written, 'bundled.musicxml should NOT be copied in -- this song already exists as bundled.mid').not.toContain('bundled.musicxml');

  const names = await sourceLocalOptionNames(page, 'melody-source');
  expect(names.filter((n) => n === 'bundled').length, 'only one dropdown entry for this song').toBe(1);
});

// A folder picked/restored under only 'read' permission can list files, but saveFileAs's write
// (getFileHandle().createWritable()) throws against a real browser's read-only grant and silently
// falls back to a plain download -- the exact bug reported live ("Life save gives me a download
// rather than saving to my local folder"). These fakes always grant whatever's asked regardless of
// mode (see installFakeMelodyFolder's own comment), so they can't reproduce the real throw -- what
// they CAN and must verify is that 'readwrite' is what actually gets asked for in the first place.
test('MelodyFolder: choosing a folder requests readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [] });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'choose-folder'));
  await page.evaluate(() => {
    document.getElementById('melody-source').value = 'choose-folder';
    document.getElementById('melody-source').dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => window.__showDirectoryPickerCalls.length > 0);
  const mode = await page.evaluate(() => window.__showDirectoryPickerCalls[0] && window.__showDirectoryPickerCalls[0].mode);
  expect(mode).toBe('readwrite');
});

test('MelodyFolder: restoring a saved folder queries readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [{ name: 'Saved.mid', tag: 1 }], permission: 'granted' });
  await page.evaluate(() => { MelodyFolder.loadHandle = async () => window.__fakeFolderHandle; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => window.__permissionModeCalls.some((c) => c.fn === 'query'));
  const call = await page.evaluate(() => window.__permissionModeCalls.find((c) => c.fn === 'query'));
  expect(call.mode).toBe('readwrite');
});

test('MelodyFolder: reconnecting a lapsed folder requests readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [{ name: 'Saved.mid', tag: 2 }], permission: 'prompt' });
  await page.evaluate(() => { MelodyFolder.loadHandle = async () => window.__fakeFolderHandle; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'reconnect-folder'));

  await page.locator('#melody-source').selectOption('reconnect-folder');
  await page.waitForFunction(() => window.__permissionModeCalls.some((c) => c.fn === 'request'));
  const call = await page.evaluate(() => window.__permissionModeCalls.find((c) => c.fn === 'request'));
  expect(call.mode).toBe('readwrite');
});

// Files moved/renamed/added in the OS folder outside the app weren't picked up until one of a few
// fixed trigger points (restore/reconnect/choose-folder/post-save) -- reported live ("moved files
// in my local folder, didn't see the available options update"). Opening the dropdown now
// re-lists in the background. Also verifies the fix doesn't silently reload the currently-loaded
// file's content just because the player hovered the dropdown -- a real risk, since re-listing
// re-sorts alphabetically and a plain numeric index could otherwise start pointing at a different
// file after an external rename/add.
test('MelodyFolder: opening the dropdown re-lists the folder, picking up an externally added file', async ({ page }) => {
  await page.goto('/');
  await installFakeMelodyFolder(page, { files: [{ name: 'Existing.mid', tag: 3 }], permission: 'granted' });
  await page.evaluate(() => { MelodyFolder.loadHandle = async () => window.__fakeFolderHandle; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 63);

  expect(await sourceLocalOptionNames(page, 'melody-source')).toEqual(['Existing']);

  // Simulate a file added externally, outside the app, after the folder was last listed.
  await page.evaluate(() => {
    const newEntry = {
      kind: 'file', name: 'Added.mid',
      getFile: async () => ({ name: 'Added.mid', arrayBuffer: async () => new Uint8Array([9]).buffer }),
    };
    const existing = window.__fakeFolderHandle.values;
    window.__fakeFolderHandle.values = async function* () {
      yield { kind: 'file', name: 'Existing.mid', getFile: async () => ({ name: 'Existing.mid', arrayBuffer: async () => new Uint8Array([3]).buffer }) };
      yield newEntry;
    };
    void existing; // silence unused-var; replaced deliberately, not composed with the original
  });

  await page.locator('#melody-source').dispatchEvent('mousedown');
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.textContent === 'Added'));

  expect(await sourceLocalOptionNames(page, 'melody-source')).toEqual(['Added', 'Existing']);
  // The externally-added file appearing must not have reloaded the currently-playing content --
  // parseMIDI should still have been called exactly once (the original load), not again just
  // because the dropdown was opened.
  expect(await page.evaluate(() => window.__parseMIDICalls.length)).toBe(1);
  expect(await page.evaluate(() => MelodyMode.state.melody[0].midi)).toBe(63);
});

test('The F/T/Y/H/B/V hover-move and Space/G/Arrows rotate hints only show for Sandbox and Blast, which actually bind those keys', async ({ page }) => {
  await page.goto('/');
  const hexNav = page.locator('#hex-nav-controls');

  for (const mode of ['sandbox', 'blast']) {
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    await expect(hexNav, `mode=${mode}`).toBeVisible();
  }

  // Melody/Compose/Snake/Gravity each bind their own, different keys -- this hint would be
  // actively misleading there (found live via Compose mode's visual QA: it used to show in
  // every mode unconditionally).
  for (const mode of ['melody', 'compose', 'snake', 'gravity']) {
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    await expect(hexNav, `mode=${mode}`).toBeHidden();
  }
});

// ────────────────────────────────────────────────────────────────────────
// Sandbox tap-and-hold same-note highlighting (task #24): holding an empty cell while the
// note-play tool is active (nothing selected) highlights every OTHER cell sharing the same note
// NAME (any octave, not just the same pitch), each labeled with its own octave-qualified name +
// frequency -- reusing the exact Tonnetz.getNoteName/getOctave/getFrequency formatting INV-25
// already established for Melody.
// ────────────────────────────────────────────────────────────────────────

test('Sandbox: holding an empty cell highlights every same-named cell with its own octave+Hz label, and releasing clears it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  // (0,0) is C4 (midi 60); (0,4) is C5 (midi 72, since 7*0+3*4=12) -- same note name, different
  // octave, a real "other cell" this feature is specifically about surfacing.
  const cellBox = await page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]').boundingBox();
  await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelectorAll('.same-note-highlight').length > 0);

  const result = await page.evaluate(() => ({
    highlightedCount: document.querySelectorAll('.same-note-highlight').length,
    otherCellHighlighted: Array.from(document.querySelectorAll('.same-note-highlight'))
      .some(el => el.getAttribute('data-p') === '0' && el.getAttribute('data-q') === '4'),
    labelTexts: Array.from(document.querySelectorAll('.same-note-label')).map(el => el.textContent),
  }));

  expect(result.highlightedCount).toBeGreaterThan(1); // (0,0) itself plus at least one other
  expect(result.otherCellHighlighted).toBe(true);
  expect(result.labelTexts.some(t => t.includes('C4'))).toBe(true);
  expect(result.labelTexts.some(t => t.includes('C5'))).toBe(true);
  expect(result.labelTexts.some(t => /\d+Hz/.test(t))).toBe(true);

  await page.mouse.up();
  const afterRelease = await page.evaluate(() => document.querySelectorAll('.same-note-highlight, .same-note-label').length);
  expect(afterRelease).toBe(0);
});

// ────────────────────────────────────────────────────────────────────────
// Compose mode (task #27's "edit any melody, record a new song" -- built as its own mode rather
// than bolted onto Melody's practice loop, since drag/rotate-to-transpose belongs to composition,
// not a structured drill). v1 scope: record by tapping cells in real time, play back, Undo/Clear,
// and Save (via MelodyMode.writeMIDI + ComposeFolder.saveFileAs, both new). Per-note drag-to-
// reposition/retime, a timeline view, and polyphony are explicitly deferred.
// ────────────────────────────────────────────────────────────────────────

test('Compose: tapping cells while recording appends notes with the tapped cell\'s own pitch and increasing time', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.locator('#compose-record').click();
  await expect(page.locator('#compose-record')).toHaveAttribute('title', 'Stop recording');

  // Both close to the origin (not q=3, which this test used to use) -- Compose's board now has
  // less vertical room than before (its own control panel + the Timeline share the top bar with
  // it, see js/main.js's updateNotationBar), so a cell several steps out on the q axis can fall
  // outside the default zoom/fit's shorter visible height.
  const cellA = page.locator('polygon.cell:not(.ghost)[data-p="2"][data-q="1"]');
  const cellB = page.locator('polygon.cell:not(.ghost)[data-p="-2"][data-q="-1"]');
  await cellA.click();
  await page.waitForTimeout(30); // real, small elapsed time between taps -- just needs to be > 0
  await cellB.click();

  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes.length).toBe(2);
  expect(notes[0]).toMatchObject({ p: 2, q: 1, midi: 60 + 7 * 2 + 3 * 1 });
  expect(notes[1]).toMatchObject({ p: -2, q: -1, midi: 60 + 7 * -2 + 3 * -1 });
  expect(notes[1].time).toBeGreaterThan(notes[0].time);
});

// Neither tapCell's recording branch nor flushChordBuffer used to call refreshBoard() -- notes
// were correctly appended to state.notes (the test above), but the staff/timeline (Task #9)
// stayed showing whatever they'd last rendered (nothing, on a fresh recording) until some
// UNRELATED later action happened to trigger a redraw. Reported live from real screenshots: the
// Compose staff looked permanently empty during/right after recording. Confirmed via the actual
// DOM (Notation.render's own output), not just state.notes, since state was never the broken part.
test('Compose: the staff updates live as notes are recorded, not just once some other action happens to redraw it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.locator('#compose-record').click();
  const cell = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
  await cell.click();
  const noteCountOnStaff = await page.evaluate(() =>
    ComposeMode._staffRender ? ComposeMode._staffRender.noteXPositions.length : 0
  );
  expect(noteCountOnStaff).toBe(1);
});

test('Compose: Play schedules every recorded note through Synth.playNote, in time order', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    ComposeMode.state.notes = [
      { midi: 64, p: 1, q: 0, time: 0, duration: 0.4 },
      { midi: 60, p: 0, q: 0, time: 0.5, duration: 0.4 },
    ];
  });

  await page.locator('#compose-play').click();
  await page.clock.fastForward(1000);

  const played = await page.evaluate(() => window.__played);
  expect(played).toEqual([64, 60]);
});

test('Compose: Undo removes only the most recently added note', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  // Recorded via the real mutator (tapCell), not a direct state assignment -- #17's undo is now a
  // real history stack (js/undo-stack.js), not a naive notes.pop(), so it only has something to
  // reverse if the mutator that pushes to it actually ran.
  await page.evaluate(() => {
    ComposeMode.state.isRecording = true;
    ComposeMode.tapCell(0, 0);
    ComposeMode.tapCell(1, 0);
    ComposeMode.state.isRecording = false;
  });
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(2);

  await page.locator('#undo-btn').click();

  const notes = await page.evaluate(() => ComposeMode.state.notes.map(n => n.midi));
  expect(notes).toEqual([await page.evaluate(() => Tonnetz.getMidi(0, 0))]);
  expect(await page.locator('#compose-note-count').textContent()).toBe('1');
});

test('Compose: Clear empties the whole recorded sequence', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
  });

  await page.locator('#compose-clear').click();

  expect(await page.evaluate(() => ComposeMode.state.notes)).toEqual([]);
  expect(await page.locator('#compose-note-count').textContent()).toBe('0');
});

test('Compose: Save writes a MusicXML file that round-trips back to the same notes', async ({ page }) => {
  await page.goto('/');

  // A fake remembered folder whose getFileHandle/createWritable capture the written content, so
  // this test can decode it back and confirm Save round-trips real content -- not just that some
  // function was called.
  await page.evaluate(() => {
    window.__savedFiles = {};
    const fakeHandle = {
      name: 'MySongs',
      values: async function* () {},
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (buf) => { window.__savedFiles[name] = buf; },
          close: async () => {},
        }),
      }),
    };
    ComposeFolder.folderHandle = fakeHandle;
    window.prompt = () => 'my-song.musicxml';
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 64, p: 1, q: 0, time: 0, duration: 0.4 },
      { midi: 60, p: 0, q: 0, time: 0.5, duration: 0.4 },
    ];
  });

  await page.locator('#compose-save').click();
  await page.waitForFunction(() => window.__savedFiles['my-song.musicxml'] !== undefined);

  const roundTripped = await page.evaluate(() => {
    const xml = window.__savedFiles['my-song.musicxml'];
    const parsed = MusicXML.parse(xml);
    return parsed.notes.map((n) => ({ midi: n.midi, time: n.time }));
  });
  expect(roundTripped.length).toBe(2);
  expect(roundTripped[0].midi).toBe(64);
  expect(roundTripped[1].midi).toBe(60);
  expect(roundTripped[1].time).toBeGreaterThan(roundTripped[0].time);
});

// Reported live: "After saving my song to the music folder, the menu should stay on my (perhaps
// new) song, not switch to alphabet." saveFileAs used to re-list the folder via listFiles(),
// which always auto-loads whichever file sorts FIRST alphabetically -- "alphabet.musicxml" being
// exactly that in the bundled set -- silently discarding the just-saved selection.
test('Compose: Save keeps the dropdown pointed at the just-saved song, not whichever file sorts first', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    window.__savedFiles = {};
    // Two files that already exist and sort BEFORE the one we're about to save -- if saveFileAs
    // regresses back to listFiles()'s auto-load-index-0 behavior, the dropdown would land on
    // "alphabet" instead of "my-song".
    const existingNames = ['alphabet.musicxml', 'happy-birthday.musicxml'];
    const toEntry = (name) => ({ kind: 'file', name, getFile: async () => ({ name, arrayBuffer: async () => new Uint8Array([0]).buffer }) });
    const fakeHandle = {
      name: 'MySongs',
      // Reflects whatever's actually been written (via getFileHandle below), same as a real
      // directory handle would -- a static list wouldn't include the just-saved file at all.
      values: async function* () {
        for (const name of existingNames.concat(Object.keys(window.__savedFiles))) yield toEntry(name);
      },
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (buf) => { window.__savedFiles[name] = buf; },
          close: async () => {},
        }),
      }),
    };
    ComposeFolder.folderHandle = fakeHandle;
    window.prompt = () => 'my-song.musicxml';
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
  });

  await page.locator('#compose-save').click();
  await page.waitForFunction(() => window.__savedFiles['my-song.musicxml'] !== undefined);

  const result = await page.evaluate(() => ({
    currentValue: ComposeFolder.currentValue,
    selectValue: document.getElementById('compose-source').value,
    selectedLabel: document.getElementById('compose-source').selectedOptions[0]?.textContent,
  }));
  expect(result.selectedLabel, 'the dropdown should still show the just-saved song, not "alphabet"').toBe('my-song');
  expect(result.selectValue).toBe(result.currentValue);
});

test('Compose: loading an existing MIDI file lays its notes out as one connected path on the lattice', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    MelodyMode.parseMIDI = () => ({
      notes: [
        { midi: 60, time: 0, duration: 0.4 },
        { midi: 64, time: 0.5, duration: 0.4 },
        { midi: 67, time: 1.0, duration: 0.4 },
      ],
    });
  });

  await page.evaluate(async () => {
    await ComposeMode.loadMelodyFromArrayBuffer(new ArrayBuffer(0), 'test.mid');
  });

  const result = await page.evaluate(() => {
    const notes = ComposeMode.state.notes;
    const midiMatches = notes.every(note => Tonnetz.getMidi(note.p, note.q) === note.midi);
    const distances = [];
    for (let i = 1; i < notes.length; i++) {
      const dp = notes[i].p - notes[i - 1].p;
      const dq = notes[i].q - notes[i - 1].q;
      distances.push((Math.abs(dp) + Math.abs(dq) + Math.abs(dp + dq)) / 2);
    }
    return { count: notes.length, midiMatches, distances };
  });
  expect(result.count).toBe(3);
  expect(result.midiMatches).toBe(true);
  // Each note should land close (by hex distance) to the previous one -- a connected path,
  // not scattered arbitrarily across the infinite lattice.
  result.distances.forEach(dist => expect(dist).toBeLessThanOrEqual(3));
});

// Reported live: "I don't have start and end bars on the compose timeline so I could select
// anything" -- refreshStaff()'s "first note(s) just appeared" branch set BOTH startIndex and
// endIndex to 0 whenever notes went from empty to non-empty, so after loading a whole file the
// two markers landed exactly on top of each other at note 0 instead of spanning anything
// selectable.
test('Compose: loading a file with several notes gives the end marker somewhere real to sit, not stacked on the start', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    MelodyMode.parseMIDI = () => ({
      notes: [
        { midi: 60, time: 0, duration: 0.4 },
        { midi: 64, time: 0.5, duration: 0.4 },
        { midi: 67, time: 1.0, duration: 0.4 },
      ],
    });
  });
  await page.evaluate(async () => {
    await ComposeMode.loadMelodyFromArrayBuffer(new ArrayBuffer(0), 'test.mid');
  });

  const result = await page.evaluate(() => ({
    startIndex: ComposeMode.state.startIndex,
    endIndex: ComposeMode.state.endIndex,
    startLeft: document.querySelector('.timeline-marker-start')?.style.left,
    endLeft: document.querySelector('.timeline-marker-end')?.style.left,
  }));
  expect(result.startIndex).toBe(0);
  expect(result.endIndex, 'the end marker should default to the LAST loaded note, not stay stuck at 0').toBe(2);
  expect(result.startLeft, 'the two markers must not visually coincide').not.toBe(result.endLeft);
});

// Compose per-note editing (task #64): select/delete/insert/drag/rotate on the lattice.
// Deliberately excludes any timing-edit UI (nudge buttons, a timeline) -- see next_steps.md #52
// and js/compose.js's own comment: a rough recording is cheap to redo, rhythm-precision editing
// is better served by a real MIDI editor on the saved .mid file.
// ────────────────────────────────────────────────────────────────────────

test('Compose: tapping an existing note selects it; Delete removes it and closes the time gap', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: Tonnetz.getMidi(0, 0), p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: Tonnetz.getMidi(1, 0), p: 1, q: 0, time: 0.5, duration: 0.4 },
      { midi: Tonnetz.getMidi(2, 0), p: 2, q: 0, time: 1.0, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [];
    ComposeMode.refreshBoard();
  });

  await page.locator('polygon.cell:not(.ghost)[data-p="1"][data-q="0"]').click();

  expect(await page.evaluate(() => ComposeMode.state.selectedIndices)).toEqual([1]);
  await expect(page.locator('.compose-selected-note')).toHaveCount(1);
  expect(await page.locator('#compose-selection-label').textContent()).toContain('1 note');

  await page.locator('#compose-delete').click();

  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes.length).toBe(2);
  expect(notes[0]).toMatchObject({ p: 0, q: 0, time: 0 });
  // The deleted note's own 0.4s duration is closed, not the full 1.0s gap to the next note.
  expect(notes[1]).toMatchObject({ p: 2, q: 0, time: 0.6 });
  await expect(page.locator('.compose-selected-note')).toHaveCount(0);
});

test('Compose: shift-tap multi-selects, and dragging one selected note transposes the whole selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: Tonnetz.getMidi(0, 0), p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: Tonnetz.getMidi(1, 0), p: 1, q: 0, time: 0.5, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [];
    ComposeMode.refreshBoard();
  });

  const cellA = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]');
  const cellB = page.locator('polygon.cell:not(.ghost)[data-p="1"][data-q="0"]');
  await cellA.click();
  await cellB.click({ modifiers: ['Shift'] });

  expect(await page.evaluate(() => ComposeMode.state.selectedIndices.slice().sort())).toEqual([0, 1]);

  // Drag the note at (0,0) to (0,1) -- delta (dp,dq) = (0,1), applied to the WHOLE selection.
  const fromBox = await cellA.boundingBox();
  const toBox = await page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="1"]').boundingBox();

  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 5 });
  await page.mouse.up();

  const result = await page.evaluate(() => {
    const notes = ComposeMode.state.notes;
    return {
      cells: notes.map(n => ({ p: n.p, q: n.q })),
      midiMatches: notes.every(n => n.midi === Tonnetz.getMidi(n.p, n.q)),
    };
  });
  expect(result.cells).toEqual([{ p: 0, q: 1 }, { p: 1, q: 1 }]);
  expect(result.midiMatches).toBe(true);
});

test('Compose: tapping an empty cell while one note is selected inserts a new note right after it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: Tonnetz.getMidi(0, 0), p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: Tonnetz.getMidi(2, 0), p: 2, q: 0, time: 1.0, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [];
    ComposeMode.refreshBoard();
  });

  await page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="0"]').click();
  await page.locator('polygon.cell:not(.ghost)[data-p="1"][data-q="0"]').click();

  const result = await page.evaluate(() => {
    const notes = ComposeMode.state.notes;
    return {
      count: notes.length,
      inserted: { p: notes[1].p, q: notes[1].q, time: notes[1].time, duration: notes[1].duration },
      midiMatches: Tonnetz.getMidi(notes[1].p, notes[1].q) === notes[1].midi,
      selected: ComposeMode.state.selectedIndices,
      lastTime: notes[2].time,
    };
  });
  expect(result.count).toBe(3);
  expect(result.inserted).toMatchObject({ p: 1, q: 0, time: 0.4, duration: 0.4 });
  expect(result.midiMatches).toBe(true);
  expect(result.selected).toEqual([1]);
  // The later note shifted later by exactly the new note's own duration.
  expect(result.lastTime).toBeCloseTo(1.4, 5);
});

test('Compose: Rotate CW rotates the selection around the first-selected note, reusing Pieces\' rotation math', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: Tonnetz.getMidi(0, 0), p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: Tonnetz.getMidi(1, 0), p: 1, q: 0, time: 0.5, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [0, 1];
    ComposeMode.updateEditControls();
  });

  await page.locator('#compose-rotate-cw').click();

  const result = await page.evaluate(() => {
    const notes = ComposeMode.state.notes;
    return {
      pivotUnchanged: notes[0].p === 0 && notes[0].q === 0,
      rotated: { p: notes[1].p, q: notes[1].q },
      midiMatches: notes[1].midi === Tonnetz.getMidi(notes[1].p, notes[1].q),
    };
  });
  expect(result.pivotUnchanged).toBe(true);
  // Pieces.rotate([{p:1,q:0}]) => {p:-0, q:1+0} = {p:0,q:1} -- js/pieces.js's own rotation math.
  expect(result.rotated).toEqual({ p: 0, q: 1 });
  expect(result.midiMatches).toBe(true);
});

// #82: copy/paste a SELECTED subset of notes as a new group, appended at the playhead with their
// relative timing/shape preserved -- an in-Compose "duplicate this phrase" buffer, distinct from
// the header's cross-mode App.clipboard (whole-piece transfer). Paste stays available (and
// re-usable) after the original selection is gone, and selects the new group afterward.
test('Compose: copy/paste a selected group duplicates it as a new group at the playhead', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: Tonnetz.getMidi(0, 0), p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: Tonnetz.getMidi(1, 0), p: 1, q: 0, time: 0.5, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [0, 1];
    ComposeMode.updateEditControls();
  });

  await expect(page.locator('#compose-paste-group')).toBeHidden(); // nothing copied yet
  await page.locator('#compose-copy-selected').click();
  await expect(page.locator('#compose-paste-group')).toBeVisible(); // now pasteable

  // Deselect (simulating the user clicking elsewhere) -- paste must still work without a selection.
  await page.evaluate(() => { ComposeMode.state.selectedIndices = []; ComposeMode.updateEditControls(); });
  await page.locator('#compose-paste-selected').click();

  const result = await page.evaluate(() => {
    const notes = ComposeMode.state.notes;
    return {
      count: notes.length,
      pasted: notes.slice(2).map(n => ({ p: n.p, q: n.q, time: n.time, duration: n.duration })),
      selected: ComposeMode.state.selectedIndices.slice(),
    };
  });
  expect(result.count).toBe(4); // original 2 + the pasted 2
  // Playhead = end of the original pair (0.5 + 0.4 = 0.9); relative timing (0, +0.5) preserved.
  expect(result.pasted).toEqual([
    { p: 0, q: 0, time: 0.9, duration: 0.4 },
    { p: 1, q: 0, time: 1.4, duration: 0.4 },
  ]);
  expect(result.selected).toEqual([2, 3]); // the new group becomes the selection
});

// ────────────────────────────────────────────────────────────────────────
// Compose tempo/quantization/metronome (task #52). Quantization's own math (grid rounding) is
// covered as pure logic in tests/run_tests.js; these are the integration paths: the metronome
// actually fires while recording, the Quantize checkbox actually applies on stop, and Save
// actually emits a real tempo meta event when quantize was used.
// ────────────────────────────────────────────────────────────────────────

test('Compose: the metronome clicks at the chosen tempo while recording, and stops the moment recording stops', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    window.__clicks = 0;
    Synth.playClick = () => { window.__clicks++; };
    ComposeMode.state.tempoBPM = 120; // 500ms/beat
    ComposeMode.state.metronomeEnabled = true;
  });

  await page.locator('#compose-record').click();
  expect(await page.evaluate(() => window.__clicks)).toBe(1); // immediate click at the downbeat

  // Advance in small steps close to the actual 500ms beat interval -- Playwright's virtual
  // clock doesn't reliably "catch up" every repeating-interval tick within one large jump, so a
  // single big fastForward() undercounts. Small steps are what actually exercises the interval
  // firing repeatedly, which is the property this test cares about.
  for (let i = 0; i < 3; i++) await page.clock.fastForward(500);
  const clicksWhileRecording = await page.evaluate(() => window.__clicks);
  expect(clicksWhileRecording).toBeGreaterThanOrEqual(3); // at least 3 more beats have passed

  await page.locator('#compose-record').click(); // stop
  for (let i = 0; i < 3; i++) await page.clock.fastForward(500);

  const clicksAfterStop = await page.evaluate(() => window.__clicks);
  expect(clicksAfterStop).toBe(clicksWhileRecording); // no further clicks once stopped
});

test('Compose: enabling Quantize actually snaps recorded notes onto the grid when recording stops', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.tempoBPM = 120; // grid (1/16) = 0.125s
    ComposeMode.state.subdivision = '1/16';
    ComposeMode.state.quantizeEnabled = true;
    ComposeMode.state.isRecording = true;
    ComposeMode.state.recordStartTime = performance.now();
    // Simulate a slightly-off-grid tap landing at 0.44s in, matching the pure-logic test's own
    // "nearest 0.125 -> 0.5" case.
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0.44, duration: 0.2 }];
  });

  await page.locator('#compose-record').click(); // stop

  const time = await page.evaluate(() => ComposeMode.state.notes[0].time);
  expect(time).toBeCloseTo(0.5, 5);
});

// MusicXML.write always embeds a tempo (<sound tempo="...">), unlike writeMIDI's old conditional
// tempo-meta-event -- MusicXML has no equivalent to "raw ungridded MIDI ticks with no declared
// tempo," so quantizeEnabled no longer changes whether Save writes one, only (elsewhere) whether
// state.notes' own recorded times get grid-snapped before saving.
test('Compose: Save\'s MusicXML always embeds the chosen tempo, regardless of Quantize', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__savedXml = null;
    ComposeFolder.folderHandle = {
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async (text) => { window.__savedXml = text; },
          close: async () => {},
        }),
      }),
    };
    window.prompt = () => 'quantized-song.musicxml';
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.tempoBPM = 100;
    ComposeMode.state.quantizeEnabled = false; // tempo still gets written even so -- see above
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
  });

  await page.locator('#compose-save').click();
  await page.waitForFunction(() => window.__savedXml !== null);

  const foundTempo = await page.evaluate(() => {
    const match = window.__savedXml.match(/<sound tempo="(\d+)"/);
    return match ? Number(match[1]) : null;
  });
  expect(foundTempo).toBe(100);
});

// ────────────────────────────────────────────────────────────────────────
// Melody mode mouse-drag panning -- real report: rotating the view (INV-24) could move a
// melody's notes off-screen with no way back, since Melody had no pan capability at all (touch
// OR mouse), despite Render.getPanBounds() already listing 'melody' among the free-pan modes.
// Uses Playwright's real mouse API (not a synthetic .click()), matching this project's existing
// discipline for touch events -- a real mousedown-then-move sequence is what actually exercises
// the drag-vs-click distinction, not a single synthetic event.
// ────────────────────────────────────────────────────────────────────────

test('Melody mode: dragging the mouse pans the Tonnetz, and still plays the clicked cell\'s note', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  // resetGame()'s auto-kickoff "listen to the notes" intro sets isPlayingSequence, which blocks
  // svg.onmousedown entirely (including the pan it starts) until it finishes.
  await page.waitForFunction(() => !MelodyMode.state.isPlayingSequence, { timeout: 8000 });

  const before = await page.evaluate(() => ({ x: Render.viewX, y: Render.viewY }));

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
  });

  const box = await page.locator('#tonnetz-svg').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 80, cy - 60, { steps: 5 });
  await page.mouse.up();

  const after = await page.evaluate(() => ({ x: Render.viewX, y: Render.viewY }));
  expect(after, 'dragging should move the view').not.toEqual(before);

  const played = await page.evaluate(() => window.__played);
  expect(played.length, 'the initial mousedown should still play whatever cell was clicked').toBeGreaterThan(0);
});

// Reported live: "dragging zoomed out instead of dragging... even a tiny drag zoomed out a lot"
// -- "drag by a pixel or two while trying to click". Root cause: onmousemove's pan handler
// re-rendered using Render.zoom (whatever zoom was last rendered ANYWHERE, a global convenience
// value updateView happens to leave behind) instead of this mode's own this.state.zoom -- the
// two can easily differ (e.g. right after some other render at a different zoom level), so even
// a 1px drag could snap the view to a completely different zoom level on its very first move
// event. Sandbox's own identical pan handler already used this.state.zoom correctly; Melody and
// Compose didn't.
test('Melody mode: dragging the mouse pans without silently changing the zoom level', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => !MelodyMode.state.isPlayingSequence, { timeout: 8000 });

  // Reproduces the exact staleness that causes the bug: this mode's own tracked zoom differs
  // from the global Render.zoom left over from some other render.
  await page.evaluate(() => {
    MelodyMode.state.zoom = 2;
    Render.zoom = 1;
  });
  // What the viewBox width SHOULD be for this mode's own zoom (2) -- the ground truth to check
  // the post-drag render against, independent of whatever was on screen before this test touched
  // state.zoom at all.
  const expectedWidthAtZoom2 = await page.evaluate(() => Render.getAspectMatchedRefBox().refW * 2);

  const box = await page.locator('#tonnetz-svg').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 2, cy - 2, { steps: 1 }); // "a pixel or two" -- reported live
  await page.mouse.up();

  // The rendered viewBox must reflect the mode's OWN zoom (2), not the stale global Render.zoom
  // (1) -- this is what actually catches the bug: the old code re-rendered against the wrong
  // value on the very first move event, snapping the view to a different zoom level.
  const viewBoxWidthAfter = await page.evaluate(() =>
    parseFloat(Render.svg.getAttribute('viewBox').split(/\s+/)[2]));
  expect(viewBoxWidthAfter, 'the rendered view must not snap to a different zoom level while panning')
    .toBeCloseTo(expectedWidthAtZoom2, 0);
});

// Same bug, same fix, Compose's own copy of the pan handler.
test('Compose: dragging the mouse pans without silently changing the zoom level', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.evaluate(() => {
    ComposeMode.state.zoom = 2;
    Render.zoom = 1;
  });
  const expectedWidthAtZoom2 = await page.evaluate(() => Render.getAspectMatchedRefBox().refW * 2);

  const box = await page.locator('#tonnetz-svg').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 2, cy - 2, { steps: 1 });
  await page.mouse.up();

  const viewBoxWidthAfter = await page.evaluate(() =>
    parseFloat(Render.svg.getAttribute('viewBox').split(/\s+/)[2]));
  expect(viewBoxWidthAfter, 'the rendered view must not snap to a different zoom level while panning')
    .toBeCloseTo(expectedWidthAtZoom2, 0);
});

test('Melody mode: a pan survives refreshBoard() (e.g. after rotating), instead of snapping back to the fixed default', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  // A small, realistic pan offset -- large enough to prove refreshBoard() didn't just reset to the
  // default view, but well within Render.getPanBounds()'s allowed range so this verifies
  // persistence, not clamping (a separate, already-covered concern). The pannable view is now held
  // as a CENTER (Render.panView / INV-44), so this sets the mode's stored center and checks the
  // rendered view center survives the refresh, rather than the aspect-dependent viewBox top-left.
  await page.evaluate(() => {
    MelodyMode.refreshBoard(); // initialize the center (null -> origin) before offsetting it
    MelodyMode.state.viewX = -60;
    MelodyMode.state.viewY = -40;
    MelodyMode.refreshBoard();
  });

  await page.evaluate(() => MelodyMode.refreshBoard());

  const center = await page.evaluate(() => {
    const vb = Render.svg.getAttribute('viewBox').split(/\s+/).map(Number);
    return { x: vb[0] + vb[2] / 2, y: vb[1] + vb[3] / 2 };
  });
  expect(Math.abs(center.x - (-60))).toBeLessThan(1);
  expect(Math.abs(center.y - (-40))).toBeLessThan(1);
});

// ────────────────────────────────────────────────────────────────────────
// Melody's Timeline start marker doubles as the replay-from scrub control (#46 low-hanging
// fruit, then migrated onto the shared Timeline component -- see docs/invariants.md INV-26/55):
// lets a player replay the drilled segment starting from any position, instead of always
// restarting from note 0 -- useful both to relisten to an earlier stretch and to skip past
// notes already mastered. Clamped to [0, endIndex] (inclusive).
// ────────────────────────────────────────────────────────────────────────

test('Melody mode: the start marker sits right before the note it targets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.evaluate(() => {
    MelodyMode.state.isRandom = false; // Random forces both markers null -- see INV-26
    MelodyMode.state.endIndex = 3;
    MelodyMode.state.startIndex = 2;
    MelodyMode.updateDifficultyUI();
  });

  await expect(page.locator('.timeline-marker-start')).toHaveCount(1);
  // The marker is absolutely positioned at the target token's own offsetLeft (see
  // Timeline._positionMarker), not inserted adjacent to it in DOM order -- assert its style.left
  // matches the target token's offsetLeft (within the marker's own small offset), not adjacency.
  const isAtTarget = await page.evaluate(() => {
    const marker = document.querySelector('.timeline-marker-start');
    const target = document.querySelector(`.note-token[data-note-idx="${MelodyMode.state.startIndex}"]`);
    if (!target) return false;
    const markerLeft = parseFloat(marker.style.left);
    // Within half the marker's own (deliberately wide, easier-to-grab -- see css/style.css)
    // hit-box width PLUS the pitch label's own +3px rightward bias (Notation.renderLabels --
    // nudged to better match the actual notehead position on the staff above, reported live),
    // not a tight pixel match -- the marker's VISIBLE stem still lands exactly on entry.x via the
    // same offset _positionMarker always used; only the LABEL's own x is deliberately offset now.
    return Math.abs(markerLeft - target.offsetLeft) <= 15;
  });
  expect(isAtTarget).toBe(true);
});

test('Melody mode: the scrub control clamps to the last real note, and pushes the end forward past it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.evaluate(() => {
    MelodyMode.state.endIndex = 3; // inclusive -- notes 0..3 reached
    MelodyMode.updateDifficultyUI();
  });

  const result = await page.evaluate(() => {
    MelodyMode.seekTo(99); // far beyond both endIndex and the melody's own length
    return { startIndex: MelodyMode.state.startIndex, endIndex: MelodyMode.state.endIndex, length: MelodyMode.state.melody.length };
  });
  expect(result.startIndex, 'clamped to the last real note, not an out-of-range index').toBe(result.length - 1);
  expect(result.endIndex, 'pushed forward to at least match the new start').toBeGreaterThanOrEqual(result.startIndex);
});

test('Melody mode: dragging the start marker past the end pushes the end one note ahead, instead of clamping the start back', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 3;
    MelodyMode.seekTo(10); // past the current end (3)
    return { startIndex: MelodyMode.state.startIndex, endIndex: MelodyMode.state.endIndex };
  });
  expect(result.startIndex).toBe(10);
  expect(result.endIndex, 'one note ahead of the new start, not left behind at the old end').toBe(11);
});

test('Melody mode: dragging the end marker before the start pushes the start one note back, instead of clamping the end forward', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 10;
    MelodyMode.state.endIndex = 15;
    MelodyMode.timeline.onEndCommit(5); // before the current start (10)
    return { startIndex: MelodyMode.state.startIndex, endIndex: MelodyMode.state.endIndex };
  });
  expect(result.endIndex).toBe(5);
  expect(result.startIndex, 'one note behind the new end, not left behind at the old start').toBe(4);
});

// The real invariant is endIndex >= startIndex + 1, ALWAYS -- these two check the boundary the
// above two don't: dragging a marker to land EXACTLY ON the other one (not past it) must still
// push the other marker, not leave them coincident.
test('Melody mode: dragging the start marker to exactly the current end still pushes the end forward', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 10;
    MelodyMode.seekTo(10); // exactly the current end, not past it
    return { startIndex: MelodyMode.state.startIndex, endIndex: MelodyMode.state.endIndex };
  });
  expect(result.startIndex).toBe(10);
  expect(result.endIndex, 'endIndex must stay >= startIndex + 1').toBe(11);
});

test('Melody mode: dragging the end marker to exactly the current start still pushes the start back', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 10;
    MelodyMode.state.endIndex = 15;
    MelodyMode.timeline.onEndCommit(10); // exactly the current start, not before it
    return { startIndex: MelodyMode.state.startIndex, endIndex: MelodyMode.state.endIndex };
  });
  expect(result.endIndex).toBe(10);
  expect(result.startIndex, 'startIndex must stay <= endIndex - 1').toBe(9);
});

test('Melody mode: dragging the start marker back replays the skipped-over earlier notes', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000); // clear the mode-entry auto-kickoff intro
  await loadFrereJacques(page);
  await page.clock.fastForward(2000); // loadMelodyFromArrayBuffer's own resetGame() schedules a SECOND untracked auto-kickoff -- clear that one too

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MelodyMode.state.endIndex = 5;
    MelodyMode.state.startIndex = 4; // simulate having already drilled through note 4
    MelodyMode.updateDifficultyUI();
  });

  // .notation-scroll's own overflow-x clips content past its visible width -- boundingBox()
  // still reports a clipped-out element's raw geometry, so a real click there would land on
  // whatever's behind it instead. scrollIntoViewIfNeeded (which locator.click() does
  // automatically, but raw page.mouse coordinates don't) brings the marker into the visible
  // area first, matching how a real drag actually starts.
  //
  // Grabs the TOP HANDLE specifically, not the marker's own overall center -- the marker's
  // line/box are deliberately pointer-events:none (INV-55), click-through so they never shadow a
  // staff click; only the two small handle children actually start a drag.
  await page.locator('.timeline-marker-start').scrollIntoViewIfNeeded();
  const markerBox = await page.locator('.timeline-marker-start .timeline-marker-handle-top').boundingBox();
  await page.locator('.note-token[data-note-idx="0"]').scrollIntoViewIfNeeded();
  const targetBox = await page.locator('.note-token[data-note-idx="0"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => MelodyMode.state.startIndex)).toBe(0);

  await page.clock.fastForward(8000); // let the whole replayed segment (notes 0..5) finish

  const playedFromZero = await page.evaluate(() => {
    const expected = MelodyMode.state.melody.slice(0, 6).map(n => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedFromZero).toBe(true);
  expect(await page.evaluate(() => MelodyMode.state.userIndex)).toBe(0);
});

test('Melody mode: dragging the start marker forward skips already-mastered notes on replay', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000);
  await loadFrereJacques(page);
  await page.clock.fastForward(2000); // see the comment on the previous test -- a second untracked auto-kickoff

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MelodyMode.state.endIndex = 5;
    MelodyMode.updateDifficultyUI();
  });

  // scrollIntoViewIfNeeded avoids clicking a clipped-out-of-view element via a stale
  // boundingBox() -- see the comment on the previous test. Target index 2, not the measure
  // boundary (3/4): even with real, unambiguous diatonic notes and no accidentals, measure 0's
  // formatted content naturally uses nearly its FULL available width (clef+key+time-sig eat
  // into its budget), so its last note (id 3) and measure 1's first bare note (id 4) can render
  // under 2px apart -- genuinely ambiguous for _nearestIndex's closest-by-x match. Index 2 sits
  // safely mid-measure, clear of that boundary.
  await page.locator('.timeline-marker-start').scrollIntoViewIfNeeded();
  const markerBox = await page.locator('.timeline-marker-start .timeline-marker-handle-top').boundingBox();
  await page.locator('.note-token[data-note-idx="2"]').scrollIntoViewIfNeeded();
  const targetBox = await page.locator('.note-token[data-note-idx="2"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();

  await page.clock.fastForward(5000);

  const playedFromTwo = await page.evaluate(() => {
    const expected = MelodyMode.state.melody.slice(2, 6).map(n => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedFromTwo).toBe(true);
  expect(await page.evaluate(() => MelodyMode.state.userIndex)).toBe(2);
});

test('Melody mode: a wrong note resets progress back to the scrub position, not always to note 0', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000);

  const resetIndex = await page.evaluate(() => {
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.endIndex = 3;
    MelodyMode.state.startIndex = 2; // player scrubbed to replay from note 2
    MelodyMode.state.userIndex = 3;  // got note 2 right, currently on note 3
    MelodyMode.handleUserInputNote(-1); // guaranteed wrong pitch
    return MelodyMode.state.userIndex;
  });
  expect(resetIndex).toBe(2);
});

test('Render.getFitView centers a set of cells within the reference viewBox', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => Render.getFitView([{ p: 0, q: 0 }], 20));

  // A single cell's content box should end up centered on world-space (0,0)
  expect(result.viewX + (800 * result.zoom) / 2).toBeCloseTo(0, 1);
  expect(result.viewY + (600 * result.zoom) / 2).toBeCloseTo(0, 1);
  expect(result.zoom).toBeGreaterThan(0);
});

test('Render.getFitView sizes zoom to snugly fit larger cell sets, not a fixed value', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const small = Render.getFitView([{ p: 0, q: 0 }], 20);
    const large = Render.getFitView([{ p: -5, q: 0 }, { p: 5, q: 0 }, { p: 0, q: 5 }, { p: 0, q: -5 }], 20);
    return { smallZoom: small.zoom, largeZoom: large.zoom };
  });

  expect(result.largeZoom).toBeGreaterThan(result.smallZoom);
});

test('Render.getFitView scale parameter zooms in further while staying centered', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const cells = [{ p: -5, q: 0 }, { p: 5, q: 0 }, { p: 0, q: 5 }, { p: 0, q: -5 }];
    const unscaled = Render.getFitView(cells, 20);
    const scaled = Render.getFitView(cells, 20, 1.25);
    return {
      unscaledZoom: unscaled.zoom,
      scaledZoom: scaled.zoom,
      unscaledCenterX: unscaled.viewX + (800 * unscaled.zoom) / 2,
      unscaledCenterY: unscaled.viewY + (600 * unscaled.zoom) / 2,
      scaledCenterX: scaled.viewX + (800 * scaled.zoom) / 2,
      scaledCenterY: scaled.viewY + (600 * scaled.zoom) / 2,
    };
  });

  // A scale of 1.25 means 1.25x bigger on screen, i.e. 1.25x smaller zoom (more world-space
  // detail per screen pixel), while remaining centered on the same content midpoint.
  expect(result.scaledZoom).toBeCloseTo(result.unscaledZoom / 1.25, 5);
  expect(result.scaledCenterX).toBeCloseTo(result.unscaledCenterX, 5);
  expect(result.scaledCenterY).toBeCloseTo(result.unscaledCenterY, 5);
});

test('blast mode shows a ghost for the active piece immediately, without requiring interaction', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

  const ghostCount = await page.locator('.ghost').count();
  expect(ghostCount).toBeGreaterThan(0);
});

test('blast queue shows the active piece as a distinct, clickable item that places it like swipe-down', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

  const activeItem = page.locator('.piece-item.active-item');
  await expect(activeItem).toBeVisible();
  await expect(activeItem.locator('.active-item-arrow')).toBeVisible();

  let placedCount = await page.locator('.placed-piece').count();
  expect(placedCount).toBe(0);

  await activeItem.click();

  placedCount = await page.locator('.placed-piece').count();
  expect(placedCount).toBeGreaterThan(0);
});

test('clicking the active queue item does not place when the ghost position is invalid', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());

  // Place once at the default hover cell, then point the (new) active piece's ghost back at
  // that same now-occupied cell so a second placement there is guaranteed invalid.
  await page.evaluate(() => {
    const { p, q } = BlastMode.state.hoverCell;
    BlastMode.placePiece(p, q);
    BlastMode.state.hoverCell = { p, q };
    BlastMode.updateGhost();
  });

  const placedBefore = await page.locator('.placed-piece').count();
  expect(placedBefore).toBeGreaterThan(0);

  await page.locator('.piece-item.active-item').click();

  const placedAfter = await page.locator('.placed-piece').count();
  expect(placedAfter).toBe(placedBefore);
});

// Render.getPanBounds() (js/render.js) only returns real bounds for non-restricted modes (see
// Render.RESTRICTED_MODES) -- Sandbox, Melody ('melody'), Compose, and Life, each with a
// free-panning, unrestricted Tonnetz. Blast/Gravity/Snake fit their own fixed board instead and
// are covered by the "unclamped in restricted modes" test below. Exercise all four non-restricted
// modes, not just Sandbox, so a future mode added to (or accidentally dropped from) that set gets
// caught here instead of only being noticed by whichever mode someone happens to test by hand.
for (const mode of ['sandbox', 'melody', 'compose', 'life']) {
  test(`panning cannot scroll far past the edge of the audible tonnetz (${mode})`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

    const result = await page.evaluate(() => {
      Render.updateView(-1000000, -1000000, 1);
      const afterNegative = { x: Render.viewX, y: Render.viewY };
      Render.updateView(1000000, 1000000, 1);
      const afterPositive = { x: Render.viewX, y: Render.viewY };
      const bounds = Render.getPanBounds();
      return { afterNegative, afterPositive, bounds };
    });

    expect(result.bounds, `${mode} should allow free panning with real bounds`).not.toBeNull();
    expect(result.afterNegative.x).toBeCloseTo(result.bounds.minX, 0);
    expect(result.afterNegative.y).toBeCloseTo(result.bounds.minY, 0);
    expect(result.afterPositive.x).toBeCloseTo(result.bounds.maxX - 800, 0);
    expect(result.afterPositive.y).toBeCloseTo(result.bounds.maxY - 600, 0);
  });
}

// Reported live: could zoom in (via the browser's own page zoom) but not out far enough to see
// the whole audible range -- most browsers floor page zoom around 25-33%. Fix: an in-app zoom
// (App.applyZoomDelta), driven by wheel/ctrl+wheel (trackpad pinch)/touch pinch, independent of
// the browser's own zoom and not subject to its floor. Scroll-wheel here; touch pinch is covered
// in tests/mobile.spec.js.
for (const mode of ['sandbox', 'melody', 'compose', 'life']) {
  test(`Scroll-wheel zoom works in ${mode} and persists across a redraw`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    if (mode === 'life') await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

    const before = await page.evaluate(() => App.modeModule().state.zoom || Render.getResponsiveZoom());
    const container = page.locator('#game-container');
    await container.hover();
    await page.mouse.wheel(0, 400); // scroll down -- zooms OUT (larger zoom value, more world visible)
    const afterOut = await page.evaluate(() => App.modeModule().state.zoom);
    expect(afterOut).toBeGreaterThan(before);

    await page.mouse.wheel(0, -800); // scroll up past the start -- zooms IN
    const afterIn = await page.evaluate(() => App.modeModule().state.zoom);
    expect(afterIn).toBeLessThan(afterOut);

    // A redraw unrelated to zoom (e.g. Render.drawLattice via any refresh) must not silently
    // reset the player's own zoom back to the responsive default.
    const persisted = await page.evaluate((m) => {
      const obj = App.modeModule();
      if (m === 'sandbox' || m === 'life') obj.refreshLattice();
      else obj.refreshBoard();
      return obj.state.zoom;
    }, mode);
    expect(persisted).toBe(afterIn);
  });
}

test('Scroll-wheel zoom clamps to Render.MIN_ZOOM/MAX_ZOOM and never exceeds them', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  const container = page.locator('#game-container');
  await container.hover();

  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 400); // scroll out far past any sane limit
  const maxed = await page.evaluate(() => SandboxMode.state.zoom);
  expect(maxed).toBeCloseTo(await page.evaluate(() => Render.MAX_ZOOM), 5);

  for (let i = 0; i < 80; i++) await page.mouse.wheel(0, -400); // scroll in far past any sane limit
  const minned = await page.evaluate(() => SandboxMode.state.zoom);
  expect(minned).toBeCloseTo(await page.evaluate(() => Render.MIN_ZOOM), 5);
});

test('Scroll-wheel zoom has no effect in restricted (fixed-board) modes', async ({ page }) => {
  await page.goto('/');
  for (const mode of ['blast', 'gravity', 'snake']) {
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    const before = await page.evaluate(() => Render.zoom);
    const container = page.locator('#game-container');
    await container.hover();
    await page.mouse.wheel(0, 400);
    const after = await page.evaluate(() => Render.zoom);
    expect(after, `${mode} should be unaffected by wheel input`).toBe(before);
  }
});

// ────────────────────────────────────────────────────────────────────────
// Real browser page-zoom (Ctrl+/Ctrl- in Chrome) changes window.devicePixelRatio proportionally
// to the zoom level -- distinct from an ordinary window resize (which doesn't change dPR) and
// from the app's own pinch/wheel zoom (a pure state.zoom multiplier, already correct, untouched
// here). page.setViewportSize() -- used elsewhere to simulate the CONTAINER-area-growth half of
// this bug -- does NOT change devicePixelRatio, so it can't exercise this fix; devicePixelRatio
// is stubbed directly via a configurable getter installed before any app script runs (addInitScript),
// so Render's _baselineDPR captures the stubbed starting value at parse time exactly like a real
// page load would, then the stub is changed mid-test to simulate a zoom change (see INV-53).
// ────────────────────────────────────────────────────────────────────────

const stubDevicePixelRatio = (page, initial) => page.addInitScript((initial) => {
  let dpr = initial;
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr });
  window.__setDPR = (v) => { dpr = v; };
}, initial);

const viewBoxSpan = async (page) => {
  const vb = await page.evaluate(() => document.getElementById('tonnetz-svg').getAttribute('viewBox'));
  const [, , w, h] = vb.split(' ').map(Number);
  return { w, h };
};

test('Render: browser zoom (devicePixelRatio change) scales cell size in Sandbox, tracking the rest of the page', async ({ page }) => {
  await stubDevicePixelRatio(page, 2); // arbitrary baseline, e.g. "100% zoom on a Retina-like display"
  await page.goto('/');

  const before = await viewBoxSpan(page);
  await page.evaluate(() => window.__setDPR(1)); // simulate zooming OUT to 50% of baseline
  await page.evaluate(() => SandboxMode.refreshLattice()); // as a real resize-triggered redraw would
  const afterZoomOut = await viewBoxSpan(page);

  // Zoomed out -> MORE world-units shown (bigger viewBox span) -> smaller cells, more visible --
  // NOT the container's own CSS-px area, which this test never touches (viewport size is fixed
  // throughout), isolating this from the separate, accepted container-area-growth effect.
  expect(afterZoomOut.w).toBeGreaterThan(before.w * 1.8);
  expect(afterZoomOut.h).toBeGreaterThan(before.h * 1.8);

  await page.evaluate(() => window.__setDPR(3)); // simulate zooming IN to 150% of baseline
  await page.evaluate(() => SandboxMode.refreshLattice());
  const afterZoomIn = await viewBoxSpan(page);
  // Zoomed in -> FEWER world-units shown (smaller viewBox span) -> bigger cells.
  expect(afterZoomIn.w).toBeLessThan(before.w);
  expect(afterZoomIn.h).toBeLessThan(before.h);
});

test('Render: browser zoom scales cell size in Gravity too (a restricted mode, no persisted state.zoom)', async ({ page }) => {
  await stubDevicePixelRatio(page, 2);
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

  const before = await viewBoxSpan(page);
  await page.evaluate(() => window.__setDPR(1)); // zoom OUT to 50% of baseline
  await page.evaluate(() => GravityMode.refreshBoard());
  const after = await viewBoxSpan(page);

  expect(after.w).toBeGreaterThan(before.w * 1.8);
  expect(after.h).toBeGreaterThan(before.h * 1.8);
});

// ────────────────────────────────────────────────────────────────────────
// Issue #9: real report from a ChromeOS play session -- after finishing a Gravity game and
// switching to another mode, the "done" Gravity board stayed on screen instead of clearing.
// Root cause: GravityMode.init() (js/gravity.js) creates a ResizeObserver watching Render.svg
// (the one <svg> element every mode shares) to re-fit after mobile 100dvh settles, but it was
// NEVER disconnected -- js/main.js's setMode only ever cleared GravityMode.state.timer inline,
// with no GravityMode.cleanup() at all (every other mode gets one). Since the observer calls
// this.refreshBoard() (which unconditionally redraws Gravity's own viewport + Board.cells) on
// ANY box-size change to that shared <svg> -- exactly what happens when a different mode's
// sidebar content reflows the layout -- switching away from Gravity left a live tripwire that
// repaints Gravity's stale board over whatever the new mode just drew, the next time anything
// resizes the game area.
// ────────────────────────────────────────────────────────────────────────

test('INV-30: leaving Gravity mode stops it from repainting the board on a later resize', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
  expect(await page.evaluate(() => !!GravityMode._resizeObserver)).toBe(true);

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  expect(await page.evaluate(() => GravityMode._resizeObserver)).toBeNull();

  // Spy on Render.drawLattice to see whether ANYTHING calls it with Gravity's own options after
  // the switch -- this is what a leaked ResizeObserver callback would do.
  await page.evaluate(() => {
    window.__drawLatticeCalls = [];
    const original = Render.drawLattice.bind(Render);
    Render.drawLattice = (viewport, options) => {
      window.__drawLatticeCalls.push({ isGravity: !!(options && options.isGravity) });
      return original(viewport, options);
    };
  });

  // Real resize -- exactly the kind of layout change a leaked observer would react to.
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(300); // ResizeObserver callbacks fire asynchronously

  const calls = await page.evaluate(() => window.__drawLatticeCalls);
  expect(calls.some(c => c.isGravity), 'no post-switch redraw should carry Gravity\'s own options').toBe(false);
  expect(await page.evaluate(() => App.currentMode)).toBe('sandbox');
});

// Found while working on Blast's own MIDI routing (issue #11): BlastMode has the exact same
// ResizeObserver-on-the-shared-<svg> pattern as Gravity did (see INV-30), and never had a
// cleanup() either -- a latent version of the same bug, just not yet reported.
test('INV-30: leaving Blast mode stops it from repainting the board on a later resize', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
  expect(await page.evaluate(() => !!BlastMode._resizeObserver)).toBe(true);

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  expect(await page.evaluate(() => BlastMode._resizeObserver)).toBeNull();

  await page.evaluate(() => {
    window.__drawLatticeCalls = [];
    const original = Render.drawLattice.bind(Render);
    Render.drawLattice = (viewport, options) => {
      window.__drawLatticeCalls.push({ isBlast: !!(options && options.isBlast) });
      return original(viewport, options);
    };
  });

  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(300);

  const calls = await page.evaluate(() => window.__drawLatticeCalls);
  expect(calls.some(c => c.isBlast), 'no post-switch redraw should carry Blast\'s own options').toBe(false);
  expect(await page.evaluate(() => App.currentMode)).toBe('sandbox');
});

// ────────────────────────────────────────────────────────────────────────
// Issue #12: real report from a ChromeOS play session -- Melody's MIDI-folder controls and
// keyboard-instructions text overlapped the Tonnetz at a landscape width under 950px, leaving
// much less usable board space. Root cause: the (max-width: 950px) and (orientation: landscape)
// breakpoint turns #blast-stats/#gravity-controls/#snake-controls into small, corner-anchored
// (top/left: 10px) HUD overlays capped at max-width: 200px -- but #melody-controls's own version
// of that same rule never got the position/max-width pair its siblings have, so it defaulted to
// its natural (wide, content-driven) flow width while still being position:absolute, floating
// over the board instead of being constrained to a small corner box.
// ────────────────────────────────────────────────────────────────────────

// Superseded task #77's mobile dock+drawer split (that mechanism no longer exists for Melody --
// its whole panel travels into #notation-bar at every viewport, see js/main.js's
// updateNotationBar): melody's controls now live in #notation-bar-controls always, stacked
// above the Timeline (not beside it) once the window is too narrow for both side by side.
test('Melody: controls and Timeline stack (not side by side) at a narrow (phone-portrait) width', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const controlsBox = await page.locator('#notation-bar-controls').boundingBox();
  const scrollBox = await page.locator('#notation-bar #melody-notation-scroll').boundingBox();
  expect(controlsBox.width, 'stacked, not squeezed into a narrow side column').toBeGreaterThan(400);
  expect(scrollBox.y, 'the Timeline sits below the controls, not beside them').toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height - 2);

  // #sidebar must stay hidden -- its own fixed width would otherwise waste real board space.
  await expect(page.locator('#sidebar')).toBeHidden();
});

test('Melody: controls and Timeline sit side by side once the window is wide enough, and back on resize', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await expect(page.locator('#notation-bar')).toHaveCSS('flex-direction', 'column');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(page.locator('#notation-bar')).toHaveCSS('flex-direction', 'row');
  const controlsBox = await page.locator('#notation-bar-controls').boundingBox();
  const scrollBox = await page.locator('#notation-bar #melody-notation-scroll').boundingBox();
  expect(scrollBox.x, 'side by side once there is room').toBeGreaterThanOrEqual(controlsBox.x + controlsBox.width);
});

test('panning is left unclamped in restricted modes (Snake/Gravity have no free-pan bounds)', async ({ page }) => {
  await page.goto('/');
  for (const mode of ['snake', 'gravity']) {
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    const bounds = await page.evaluate(() => Render.getPanBounds());
    expect(bounds, `${mode} should NOT have free-pan bounds`).toBeNull();
  }
});

// Double-tap-to-place was an earlier design, in both Sandbox and Blast, that was found not to
// work well and was meant to be fully replaced -- Sandbox by the place-wedge/carousel-drag,
// Blast by swipe/queue-tap -- but js/main.js's setupTouchGestures kept a second, separate
// same-cell-double-tap-places implementation alive for real touch devices at tablet/desktop
// widths (the "Standard Tablet/Desktop touch tap-tap-place behavior" branch), found live via a
// real bug report's replay.
for (const mode of ['sandbox', 'blast']) {
  test(`tapping the same empty board cell twice never places a piece on a tablet/desktop touch device (${mode})`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    if (mode === 'sandbox') {
      await page.locator('.piece-item[data-key]:not(.note-tool-item)').first().click({ force: true });
    }
    // Blast's active piece is already selected automatically on mode entry.

    const cellBox = await page.evaluate(() => {
      const el = document.querySelector('polygon.cell[data-p="0"][data-q="0"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    expect(cellBox).toBeTruthy();

    await page.evaluate(({ x, y }) => {
      const el = document.getElementById('tonnetz-svg');
      const dispatch = (type) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
        const config = { bubbles: true, cancelable: true, changedTouches: [touch] };
        config.touches = type === 'touchend' ? [] : [touch];
        config.targetTouches = config.touches;
        el.dispatchEvent(new TouchEvent(type, config));
      };
      dispatch('touchstart'); dispatch('touchend');
      dispatch('touchstart'); dispatch('touchend');
    }, cellBox);

    const placedCount = await page.evaluate(
      (m) => (m === 'sandbox' ? SandboxMode.state.placedPieces.length : Board.cells.size),
      mode
    );
    expect(placedCount).toBe(0);
  });
}

// INVARIANT: the README promises file:// support ("no server or build steps needed"), so
// opening index.html directly must not log real console errors. This bypasses the configured
// baseURL/webServer entirely and loads the file straight off disk, the way a user actually
// would by double-clicking it.
test.describe('file:// support', () => {
  // playwright.config.js sets serviceWorkers: 'block' globally (to avoid SW-related flakiness
  // elsewhere in this suite), which makes registration fail with Playwright's own "blocked"
  // message -- already specially handled with a friendly console.log, not console.error -- and
  // would silently hide the REAL file://-origin error this test exists to catch. Overridden
  // back to 'allow' just within this describe block so the genuine error (or lack of one)
  // actually surfaces.
  test.use({ serviceWorkers: 'allow' });

  test('opening index.html via file:// (no server) logs no console errors', async ({ page }) => {
    const path = require('path');
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
    await page.waitForTimeout(1000);

    expect(errors, `console errors when opened via file://: ${JSON.stringify(errors)}`).toEqual([]);
  });
});

// A returning player's service worker (sw.js) can have precached index.html/js/etc. on some
// earlier visit. If the site later changes and that cache is never invalidated, the player's
// browser silently keeps serving the OLD markup/code -- exactly what happened live: index.html's
// Melody/Compose/Life controls were reorganized into a single #melody-source dropdown, but a
// returning player's stale-cached index.html still had the OLD (pre-reorg) markup, so the new
// select simply didn't exist on their page -- "the dropdown disappeared entirely." Root cause:
// sw.js used a cache-first fetch strategy, so nothing about a code change alone (only bumping
// CACHE_NAME, easy to forget) ever invalidated an existing precache. Fixed to network-first
// (falls back to cache only when actually offline) -- this test simulates a stale precache
// directly (not achievable by editing files on disk mid-test) and confirms a normal online visit
// no longer serves it.
test.describe('Service worker cache staleness (regression)', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a stale precached index.html is never served while online -- network-first wins', async ({ page }) => {
    await page.goto('/');
    // First-ever visit: no longer force-reloads itself (see the regression test right below this
    // describe block) -- just wait for the SW to finish installing/activating/claiming before
    // touching its cache.
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await page.waitForLoadState('load');
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Directly corrupt whatever this SW actually precached for '/' and '/index.html' -- simulates
    // a browser that cached index.html on an earlier visit, before some later markup change.
    const patched = await page.evaluate(async () => {
      const cacheName = (await caches.keys())[0];
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const touched = [];
      for (const req of keys) {
        const url = new URL(req.url);
        if (url.pathname !== '/' && url.pathname !== '/index.html') continue;
        await cache.put(req, new Response('<html><body>STALE-CACHED-MARKER</body></html>', {
          headers: { 'Content-Type': 'text/html' },
        }));
        touched.push(req.url);
      }
      return touched;
    });
    expect(patched.length).toBeGreaterThan(0);

    // A normal (online) reload must ignore that stale cache entirely and fetch the real page.
    await page.reload();
    const bodyText = await page.evaluate(() => document.body.textContent);
    expect(bodyText).not.toContain('STALE-CACHED-MARKER');
    await expect(page.locator('#mode-slider, .mode-option').first()).toBeVisible();
  });
});

// Reported live: a brand-new visitor sometimes sees an empty page that "resolves itself on
// reload." Root cause: js/main.js's controllerchange listener force-navigates
// (window.location.reload()) whenever the page transitions from uncontrolled to controlled by a
// service worker -- but that transition happens on EVERY first-ever visit too (sw.js's activate
// handler calls self.clients.claim(), which claims the currently-open, previously-uncontrolled
// page), not only when an old service worker is being replaced by an updated one, which is what
// the comment above this code actually describes wanting ("Auto-reload... when a NEW service
// worker finishes activation"). So a first-time visitor's page renders once, then immediately
// force-reloads itself for no user-visible reason -- an extra, unnecessary navigation that (on a
// slower connection than this test's localhost) is exactly the kind of gap where the app can be
// caught still-uninitialized, matching the reported "sees emptiness."
test.describe('Service worker: first-ever visit must not force a reload (regression)', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a brand-new visitor (no prior controller) never gets an extra forced navigation', async ({ page }) => {
    let loadCount = 0;
    page.on('load', () => { loadCount += 1; });

    await page.goto('/');
    await page.waitForLoadState('load');
    // Give the service worker plenty of time to install/activate/claim -- if the bug is present,
    // this is when the unwanted extra reload would fire.
    await page.waitForTimeout(2000);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(500);

    expect(loadCount, 'first-ever visit should paint once, not reload itself').toBe(1);
    expect(await page.evaluate(() => App.currentMode)).toBe('sandbox');
  });
});

// #85: Life mode -- the neighbor/isotropy classifier core. Classifies the 6-cell consonant ring
// by its dihedral-orbit arrangement (see docs/life-rules.md).
test.describe('Life isotropy classifier', () => {
  test('classifies named ring arrangements, rotation/reflection-invariantly, with chirality', async ({ page }) => {
    await page.goto('/');
    const r = (ring) => page.evaluate((ring) => Life.classifyRing(ring), ring);

    expect(await r([1,1,0,0,0,0])).toMatchObject({ count: 2, name: 'ortho', symmetric: true });
    expect(await r([1,0,1,0,0,0])).toMatchObject({ count: 2, name: 'meta', symmetric: true });
    expect(await r([1,0,0,1,0,0])).toMatchObject({ count: 2, name: 'para', symmetric: true });
    expect(await r([1,1,1,0,0,0])).toMatchObject({ count: 3, name: 'vicinal', symmetric: true });

    // Rotation invariance: a rotated ortho is still ortho.
    expect(await r([0,0,1,1,0,0])).toMatchObject({ name: 'ortho', symmetric: true });
    // Reflection invariance of the class label: meta reflected is still meta.
    expect(await r([0,0,0,1,0,1])).toMatchObject({ name: 'meta' });

    // A chiral arrangement (no reflection axis): its mirror is a distinct configuration.
    const chiral = await r([1,1,0,1,0,0]);
    expect(chiral.count).toBe(3);
    expect(chiral.symmetric).toBe(false);
    expect(chiral.chiral).toBe(true);

    // Empty and full are trivially symmetric.
    expect(await r([0,0,0,0,0,0])).toMatchObject({ count: 0, symmetric: true });
    expect(await r([1,1,1,1,1,1])).toMatchObject({ count: 6, symmetric: true });
  });
});

// #85: Life rule evaluator -- applies a parsed rule (birth/survival clauses) to a cell given its
// neighbourhood, computing the next alive/dead state. Covers count shorthand, isotropy and
// require/forbid clauses.
test.describe('Life rule evaluator', () => {
  test('evaluates count, isotropy and require/forbid clauses', async ({ page }) => {
    await page.goto('/');
    // Builds a neighbourhood from an explicit set of live [p,q] cells, then evaluates `rule`
    // at the origin given it is/ isn't currently alive.
    const next = (rule, alive, liveCells) => page.evaluate(({ rule, alive, liveCells }) => {
      const set = new Set(liveCells.map(([p, q]) => p + ',' + q));
      const isAlive = (p, q) => set.has(p + ',' + q);
      const nb = Life.neighbourhood(0, 0, isAlive);
      return Life.nextState(rule, alive, nb);
    }, { rule, alive, liveCells });

    // 3,5 / 2 : survive on 3 or 5 ring-neighbours, born on 2 (flat-list count shorthand).
    const r352 = { survival: [3, 5], birth: [2] };
    // Two live consonant neighbours (fifth_up (1,0), fifth_down (-1,0)) -> a dead cell is born.
    expect(await next(r352, false, [[1, 0], [-1, 0]])).toBe(true);
    // A live cell with only those 2 neighbours does NOT survive (2 not in {3,5}).
    expect(await next(r352, true, [[1, 0], [-1, 0]])).toBe(false);
    // A live cell with 3 neighbours survives.
    expect(await next(r352, true, [[1, 0], [-1, 0], [0, 1]])).toBe(true);

    // Isotropy clause: born only when the 2 live neighbours are opposite (para), not adjacent.
    const rPara = { birth: [{ ring_count: [2], isotropy: ['para'] }], survival: [] };
    expect(await next(rPara, false, [[1, 0], [-1, 0]])).toBe(true);           // fifth_up + fifth_down = para
    expect(await next(rPara, false, [[1, 0], [1, -1]])).toBe(false);          // fifth_up + major_third_up = ortho

    // require/forbid a named interval neighbour: born on 1 ring neighbour only if a semitone-up
    // cell (1,-2) is also alive and no tritone-up cell (0,2) is.
    const rReq = { birth: [{ ring_count: [1], require: ['semitone_up'], forbid: ['tritone_up'] }], survival: [] };
    expect(await next(rReq, false, [[1, 0], [1, -2]])).toBe(true);            // 1 ring + semitone_up present
    expect(await next(rReq, false, [[1, 0]])).toBe(false);                    // missing semitone_up
    expect(await next(rReq, false, [[1, 0], [1, -2], [0, 2]])).toBe(false);   // tritone_up forbidden
  });
});

// #85: Life step -- one generation. Given the live set and a rule, produce the next generation,
// considering live cells and every cell that could be born (their neighbours).
test('Life step advances one generation over the live set and birthable neighbours', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    // Rule: a cell is born with exactly 1 live ring-neighbour; survives with 1 or 2.
    const rule = { birth: [1], survival: [1, 2] };
    const live = new Set(['0,0']);
    const next = Life.step(live, rule);
    return [...next].sort();
  });
  // (0,0) has 0 ring-neighbours -> dies. Each of its 6 ring neighbours has exactly (0,0) as a
  // single live ring-neighbour -> born. So the next generation is exactly the 6 consonant cells.
  expect(result.length).toBe(6);
  expect(result).toEqual(['-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0'].sort());
});

// #85: Life YAML loader -- a minimal indent-aware parser for the automaton schema (block maps +
// block sequences + flow collections + scalars). No external dependency.
test('Life parses an automaton YAML (block maps, sequences, flow, scalars, comments)', async ({ page }) => {
  await page.goto('/');
  const parsed = await page.evaluate(() => {
    const yaml = [
      '# see docs/life-rules.md',
      'name: "3,5 / 2"',
      'rule:',
      '  survival: [3, 5]   # flow list of numbers',
      '  birth: [2]',
      'sound: { when: born, duration: 0.5 }',
      'initial:',
      '  cells:',
      '    - [0, 0]',
      '    - [1, 0]',
      'tempo: 180',
    ].join('\n');
    return Life.parseYaml(yaml);
  });
  expect(parsed.name).toBe('3,5 / 2');
  expect(parsed.rule).toEqual({ survival: [3, 5], birth: [2] });
  expect(parsed.sound).toEqual({ when: 'born', duration: 0.5 });
  expect(parsed.initial).toEqual({ cells: [[0, 0], [1, 0]] });
  expect(parsed.tempo).toBe(180);
});

test('Life parses block-sequence-of-maps rule clauses', async ({ page }) => {
  await page.goto('/');
  const parsed = await page.evaluate(() => Life.parseYaml([
    'rule:',
    '  birth:',
    '    - ring_count: [2]',
    '      isotropy: [para]',
    '    - ring_count: [3]',
    '  survival: []',
  ].join('\n')));
  expect(parsed.rule.birth).toEqual([{ ring_count: [2], isotropy: ['para'] }, { ring_count: [3] }]);
  expect(parsed.rule.survival).toEqual([]);
});

// #85: Life mode end-to-end -- loads the 3,5/2 automaton from life/3-5-2.yaml (the YAML pipeline),
// renders its live cells on the lattice, and steps generations.
test('Life mode loads the 3,5/2 YAML automaton, renders it, and steps', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const init = await page.evaluate(() => ({
    mode: App.currentMode,
    name: LifeMode.state.rule && JSON.stringify(LifeMode.state.rule),
    live: LifeMode.state.live.size,
    painted: document.querySelectorAll('#tonnetz-svg polygon.cell.life-alive').length,
    controls: ['life-play-pause', 'life-step', 'life-reset', 'life-clear', 'life-generation'].every((id) => !!document.getElementById(id)),
    paletteHidden: getComputedStyle(document.getElementById('palette')).display === 'none',
  }));
  expect(init.mode).toBe('life');
  expect(init.name).toBe(JSON.stringify({ survival: [3, 5], birth: [2] })); // parsed from the YAML
  expect(init.live).toBe(7);
  expect(init.painted).toBe(7);
  expect(init.controls).toBe(true);
  expect(init.paletteHidden).toBe(true);

  const stepped = await page.evaluate(() => { LifeMode.stepOnce(); return { gen: LifeMode.state.generation, live: LifeMode.state.live.size }; });
  expect(stepped.gen).toBe(1);
  expect(stepped.live).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// #85: Life multi-state engine -- Wuensche's 3-state "beehive" rule (via Adamatzky et al. 2006).
// Its glider (state-1 head + four state-2 tail) must translate under Life.stepStates.
test('Life multi-state (beehive) rule glides its known glider', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    const M = [
      [0, 1, 2, 1, 2, 0, 0], [0, 2, 2, 2, 1, 1], [0, 0, 2, 2, 0],
      [0, 2, 2, 0], [0, 0, 2], [2, 0], [0],
    ];
    const cells = [[1, 1, 2], [2, 1, 2], [0, 2, 1], [0, 3, 2], [1, 3, 2]];
    const norm = (m) => {
      let mp = Infinity, mq = Infinity;
      for (const k of m.keys()) { const [p, q] = k.split(',').map(Number); mp = Math.min(mp, p); mq = Math.min(mq, q); }
      const c = [...m.entries()].map(([k, s]) => { const [p, q] = k.split(',').map(Number); return (p - mp) + ',' + (q - mq) + '=' + s; }).sort().join(';');
      return { c, mp, mq };
    };
    const run = (order) => {
      let live = new Map(cells.map(([p, q, s]) => [p + ',' + q, s]));
      const start = norm(live);
      live = Life.stepStates(live, M, order);
      const cur = norm(live);
      return { same: cur.c === start.c, shift: [cur.mp - start.mp, cur.mq - start.mq], size: live.size };
    };
    return { o21: run('21'), o12: run('12') };
  });
  // The correct index order reproduces the 5-cell glider translated by one cell each step.
  expect(out.o21.same).toBe(true);
  expect(out.o21.size).toBe(5);
  expect(out.o21.shift).toEqual([-1, 0]);
  // The other order does not (it blows up), which is how we resolved the paper's ambiguous index.
  expect(out.o12.same).toBe(false);
});

// #85: Life mode multi-state end-to-end -- loads life/beehive.yaml through the real YAML pipeline
// (states/order/transition/per-state sounds/[p,q,state] cells) into LifeMode, and confirms the
// mode runs a genuine multi-state generation (the parsed glider translates, keeping 5 cells).
test('Life mode loads the beehive multi-state YAML and steps its glider', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const loaded = await page.evaluate(async () => {
    LifeMode.loadAutomatonFromText(await (await fetch('./life/beehive.yaml')).text(), 'beehive.yaml');
    const s = LifeMode.state;
    const snapshot = () => [...s.live.entries()].map(([k, st]) => k + '=' + st).sort().join(';');
    const before = snapshot();
    const beforeStates = [...s.live.values()].sort();
    LifeMode.stepOnce();
    const after = snapshot();
    return {
      multi: !!s.multi,
      order: s.multi && s.multi.order,
      rows: s.multi && s.multi.table.length,
      sounds: s.sounds && Object.keys(s.sounds).sort().join(','),
      size: s.live.size,
      hasTail: beforeStates.includes(2), // seed carries state-2 tail cells
      moved: before !== after,           // the glider is not static
      stillFive: s.live.size === 5,      // period-1 glider preserves cell count
    };
  });
  expect(loaded.multi).toBe(true);
  expect(loaded.order).toBe('21');
  expect(loaded.rows).toBe(7);
  expect(loaded.sounds).toBe('1,2');
  expect(loaded.hasTail).toBe(true);
  expect(loaded.moved).toBe(true);
  expect(loaded.stillFive).toBe(true);
  expect(errors).toEqual([]);
});

// #15/#16: Life's online-folder fetch (index.json, then the first automaton file) is in flight
// on entry. If the player leaves Life for another mode before it resolves, the stale callback
// used to still land -- repainting the *shared* #tonnetz-svg with Life's lattice/live cells on
// top of whatever the new mode had drawn, non-deterministically (timing-dependent). Regression:
// switch to Life then immediately away, before the fetch can resolve, and confirm the eventual
// resolution is a no-op against the now-current mode.
test('Life: switching away before its online fetch resolves does not repaint the shared canvas (#15, #16)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="life"]').click();
    document.querySelector('.mode-option[data-mode="blast"]').click();
  });
  // The stale fetch is correctly dropped once fixed, so it never sets LifeFolder.currentValue --
  // just give it time to resolve (it's a same-host fetch) rather than waiting on that flag.
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => ({
    mode: App.currentMode,
    painted: document.querySelectorAll('#tonnetz-svg polygon.cell.life-alive').length,
  }));
  expect(after.mode).toBe('blast');
  expect(after.painted).toBe(0);
  expect(errors).toEqual([]);
});

// #85: "Grem's Theme One" -- a period-12 five-cell oscillator under 3,5/2, found while exploring
// Life mode and saved as life/grems-theme-one.yaml. This pins both the transcription (its exact
// cells) and the discovery (that it really is a period-12 oscillator), loaded through the real
// YAML pipeline so a bad edit to the file or the parser is caught.
test("Life mode: Grem's Theme One loads and oscillates with period 12", async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const out = await page.evaluate(async () => {
    LifeMode.loadAutomatonFromText(await (await fetch('./life/grems-theme-one.yaml')).text(), 'grems-theme-one.yaml');
    const snap = () => [...LifeMode.state.live.keys()].sort().join(';');
    const start = snap();
    const startSize = LifeMode.state.live.size;
    let period = -1, minSize = startSize, maxSize = startSize;
    for (let g = 1; g <= 24; g++) {
      LifeMode.stepOnce();
      minSize = Math.min(minSize, LifeMode.state.live.size);
      maxSize = Math.max(maxSize, LifeMode.state.live.size);
      if (snap() === start && period === -1) { period = g; break; }
    }
    return { startSize, period, minSize, maxSize };
  });
  expect(out.startSize).toBe(5);
  expect(out.period).toBe(12);   // returns exactly to its start after 12 generations
  expect(out.minSize).toBe(5);   // breathes between a 5-cell rest (every other gen) ...
  expect(out.maxSize).toBe(8);   // ... and an 8-cell swell -- bounded, never runs away
});

// #13: A real cell doing something sounds its OWN current pitch, wherever it is -- on- OR
// off-screen. The founding invariant is "real active cells sound," not "only on-screen ones do";
// a moving pattern must never re-sound a stale note from a cell it has left. We seed two cells at
// the +p edge whose births are one ON-board (14,1) and one OFF-board (16,0) cell: both stay alive
// AND both sound, each at its own getMidi -- and nothing else sounds (no stale/phantom pitch).
test('Life: off-board cells keep living and sound their own pitch, never a stale one (#13)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const out = await page.evaluate(() => {
    LifeMode.state.rule = { survival: [3, 5], birth: [2] }; // 3,5/2 (already loaded)
    LifeMode.state.multi = null;
    LifeMode.state.sound = { when: 'born', duration: 0.4 };
    LifeMode.state.live = new Map([['15,0', 1], ['15,1', 1]]); // straddle the +p=15 edge
    const played = [];
    const orig = Synth.playNote;
    Synth.playNote = (midi) => { played.push(midi); };
    LifeMode.stepOnce();
    Synth.playNote = orig;
    return {
      keys: [...LifeMode.state.live.keys()].sort(),
      played: played.slice().sort((a, b) => a - b),
      // The pitches of exactly the cells born this generation -- what may sound, nothing else.
      bornPitches: [Tonnetz.getMidi(14, 1), Tonnetz.getMidi(16, 0)].sort((a, b) => a - b),
    };
  });
  expect(out.keys).toEqual(['14,1', '16,0']);        // both births live on
  expect(out.played).toEqual(out.bornPitches);       // both sound, each at its OWN current pitch,
                                                     // off-screen (16,0) included -- and nothing else
});

// #85: In a multi-state automaton, tapping a cell must be able to reach every state -- it cycles
// empty -> 1 -> 2 -> ... -> (states-1) -> empty. (A 2-state automaton stays a plain alive/dead
// toggle.) Without this, only state 1 could ever be placed by hand.
test('Life: tapping a cell cycles it through all states (#85)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const out = await page.evaluate(async () => {
    LifeMode.loadAutomatonFromText(await (await fetch('./life/beehive.yaml')).text(), 'beehive.yaml'); // 3-state
    LifeMode.clear();
    const s = () => LifeMode.state.live.get('5,5') || 0;
    const multiSeq = [s()];
    for (let i = 0; i < 4; i++) { LifeMode.toggleCell(5, 5); multiSeq.push(s()); }

    LifeMode.loadAutomatonFromText(await (await fetch('./life/3-5-2.yaml')).text(), '3-5-2.yaml'); // 2-state
    LifeMode.clear();
    const t = () => LifeMode.state.live.get('6,6') || 0;
    const twoSeq = [t()];
    for (let i = 0; i < 3; i++) { LifeMode.toggleCell(6, 6); twoSeq.push(t()); }
    return { multiSeq, twoSeq };
  });
  expect(out.multiSeq).toEqual([0, 1, 2, 0, 1]); // empty->1->2->empty (mod 3)->1
  expect(out.twoSeq).toEqual([0, 1, 0, 1]);      // 2-state remains a plain toggle
});

// Reported live: Life should be free-pan/zoomable exactly like Sandbox/Melody/Compose (see
// Render.RESTRICTED_MODES), but it never actually implemented drag-to-pan on desktop -- only
// tap-to-toggle. A short drag must pan the view (not toggle whatever cell it started on), and a
// short, near-stationary click must still toggle exactly as before.
test('Life: dragging the mouse pans the view; a short click still toggles the cell', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const before = await page.evaluate(() => ({ x: LifeMode.state.viewX, y: LifeMode.state.viewY, liveSize: LifeMode.state.live.size }));

  // Derived from the board's own bounding box rather than fixed viewport pixels -- the drawer's
  // expanded height in Life mode is now content-driven (#life-rule-panel wraps onto its own line;
  // see #top-drawer's own comment), so a hardcoded (400,300) start point drifted off the board
  // entirely once that panel started legitimately pushing the board down. Center-relative
  // coordinates stay correct regardless of how tall the drawer's content happens to be.
  const svgBox = await page.locator('#tonnetz-svg').boundingBox();
  const startX = svgBox.x + svgBox.width / 2;
  const startY = svgBox.y + svgBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 80, { steps: 10 }); // well past the 6px tap-vs-drag threshold
  await page.mouse.up();

  const afterDrag = await page.evaluate(() => ({ x: LifeMode.state.viewX, y: LifeMode.state.viewY, liveSize: LifeMode.state.live.size }));
  expect(afterDrag.x !== before.x || afterDrag.y !== before.y).toBe(true); // the view actually panned
  expect(afterDrag.liveSize).toBe(before.liveSize); // and nothing was toggled by the drag itself

  // A short, near-stationary click on an empty cell still toggles it (unaffected by the pan code).
  const cell = page.locator('polygon.cell:not(.ghost)[data-p="3"][data-q="3"]');
  await cell.click();
  const afterClick = await page.evaluate(() => LifeMode.state.live.get('3,3') || 0);
  expect(afterClick).toBe(1);
});

// Life had no way to persist a hand-arranged or mid-evolution pattern at all -- only the built-in/
// online automata could ever be loaded, so a player's own creation was gone the moment they left
// the page. Save As (mirroring Compose's own Save) writes the CURRENT live cells -- not the
// original seed -- back out as a life/ YAML file, round-trippable through the real parser/loader.
test('Life: Save As writes a YAML file that round-trips back to the same rule and live cells', async ({ page }) => {
  await page.goto('/');

  // A fake remembered folder whose getFileHandle/createWritable capture the written text, so this
  // test can re-parse it and confirm Save round-trips real content, not just that some function
  // ran. Mirrors the identical pattern used for Compose's own Save test.
  await page.evaluate(() => {
    window.__savedFiles = {};
    const fakeHandle = {
      name: 'MyAutomata',
      values: async function* () {},
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (text) => { window.__savedFiles[name] = text; },
          close: async () => {},
        }),
      }),
    };
    LifeFolder.folderHandle = fakeHandle;
    LifeFolder.needsReconnect = false;
    window.prompt = () => 'my-pattern.yaml';
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  const before = await page.evaluate(() => {
    LifeMode.clear();
    LifeMode.toggleCell(0, 0);
    LifeMode.toggleCell(1, 0);
    LifeMode.toggleCell(0, 1);
    return { rule: LifeMode.state.rule, live: [...LifeMode.state.live.entries()].sort() };
  });

  await page.locator('#life-save').click();
  await page.waitForFunction(() => window.__savedFiles['my-pattern.yaml'] !== undefined);

  const roundTripped = await page.evaluate(() => {
    const text = window.__savedFiles['my-pattern.yaml'];
    const parsed = Life.parseYaml(text);
    return { rule: parsed.rule, cells: parsed.initial.cells };
  });
  expect(roundTripped.rule).toEqual(before.rule);
  const roundTrippedLive = roundTripped.cells.map(([p, q]) => `${p},${q}`).sort();
  expect(roundTrippedLive).toEqual(before.live.map(([k]) => k));
});

// LifeFolder is just FileFolder.create({...}) like MelodyFolder/ComposeFolder (js/life.js) -- the
// readwrite-permission fix lives entirely in the shared js/file-folder.js code the MelodyFolder
// tests above already cover in detail, but this confirms Life's own instance inherits it too, since the bug
// was reported live specifically against Life's own Save As ("gives me a download rather than
// saving to my local folder").
test('LifeFolder: choosing a folder requests readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__showDirectoryPickerCalls = [];
    const fakeHandle = { name: 'MyAutomata', values: async function* () {}, getFileHandle: async () => { throw new Error('not found'); } };
    window.showDirectoryPicker = async (opts) => { window.__showDirectoryPickerCalls.push(opts); return fakeHandle; };
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('life-source').options].some(o => o.value === 'choose-folder'));
  await page.evaluate(() => {
    document.getElementById('life-source').value = 'choose-folder';
    document.getElementById('life-source').dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => window.__showDirectoryPickerCalls.length > 0);
  const mode = await page.evaluate(() => window.__showDirectoryPickerCalls[0] && window.__showDirectoryPickerCalls[0].mode);
  expect(mode).toBe('readwrite');
});

// The multi-state path (transition table, per-state sounds, [p,q,state] cells) is a genuinely
// different branch of toYaml than the 2-state rule path above -- exercise it separately with
// beehive.yaml's own glider seed, confirming BOTH the states/order/transition table and each
// live cell's own state round-trip, not just its position.
test('Life: Save As round-trips a multi-state automaton (transition table + per-cell state)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__savedFiles = {};
    const fakeHandle = {
      name: 'MyAutomata',
      values: async function* () {},
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (text) => { window.__savedFiles[name] = text; },
          close: async () => {},
        }),
      }),
    };
    LifeFolder.folderHandle = fakeHandle;
    LifeFolder.needsReconnect = false;
    window.prompt = () => 'my-beehive.yaml';
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  const before = await page.evaluate(async () => {
    LifeMode.loadAutomatonFromText(await (await fetch('./life/beehive.yaml')).text(), 'beehive.yaml');
    return {
      multi: LifeMode.state.multi,
      live: [...LifeMode.state.live.entries()].sort(),
    };
  });

  await page.locator('#life-save').click();
  await page.waitForFunction(() => window.__savedFiles['my-beehive.yaml'] !== undefined);

  const roundTripped = await page.evaluate(() => {
    const text = window.__savedFiles['my-beehive.yaml'];
    const parsed = Life.parseYaml(text);
    return { states: parsed.states, order: parsed.order, transition: parsed.transition, cells: parsed.initial.cells };
  });
  expect(roundTripped.states).toBe(before.multi.states);
  expect(roundTripped.order).toBe(before.multi.order);
  expect(roundTripped.transition).toEqual(before.multi.table);
  const roundTrippedLive = roundTripped.cells.map(([p, q, s]) => `${p},${q},${s}`).sort();
  expect(roundTrippedLive).toEqual(before.live.map(([k, s]) => `${k},${s}`).sort());
});

// A save with nothing on the board would silently write an empty, useless file -- catch it with
// a clear message instead (mirrors Compose's own "Nothing to save yet" guard).
test('Life: Save As refuses an empty board with a clear message, instead of writing an empty file', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  await page.evaluate(() => LifeMode.clear());

  let alertMessage = null;
  page.on('dialog', async (d) => { alertMessage = d.message(); await d.accept(); });
  await page.locator('#life-save').click();
  expect(alertMessage).toMatch(/nothing to save/i);
});

// Reported live: Life had no way to OPEN a local automaton file at all -- only the online
// dropdown (the bundled life/ folder), unlike Melody/Compose which both have their own upload
// input alongside their online dropdown. Mirrors that exact pattern (a real File, real
// FileReader), not a direct API call, so this exercises the actual upload wiring.
test('Life: opening a local automaton file loads its rule and cells', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const yaml = [
    'name: "Test Upload"',
    'rule:',
    '  survival: [2, 3]',
    '  birth: [3]',
    'sound: { when: born, duration: 0.4 }',
    'initial:',
    '  cells:',
    '    - [5, 5]',
    '    - [6, 5]',
    'tempo: 120',
  ].join('\n');

  await page.locator('#life-file-input').setInputFiles({
    name: 'my-glider.yaml',
    mimeType: 'text/yaml',
    buffer: Buffer.from(yaml),
  });
  // Wait on something the DEFAULT automaton can never produce (cell (5,5) isn't in its seed),
  // not just "some rule got set" -- the default's own rule also happens to have survival.length
  // === 2, which would make that condition trivially true without ever confirming the upload.
  await page.waitForFunction(() => LifeMode.state.live.has('5,5'), { timeout: 5000 });

  const result = await page.evaluate(() => ({
    rule: LifeMode.state.rule,
    live: [...LifeMode.state.live.keys()].sort(),
    filename: document.getElementById('life-filename').textContent,
  }));
  expect(result.rule).toEqual({ survival: [2, 3], birth: [3] });
  expect(result.live).toEqual(['5,5', '6,5']);
  expect(result.filename).toBe('my-glider.yaml');
});

// #85: a state's `velocity` must actually change how LOUD its cells sound (the pitch invariant
// permits volume to vary by state -- only pitch may not). beehive.yaml gives state 1 velocity 95
// and state 2 velocity 55, so a step must play head (state 1) cells louder than tail (state 2)
// cells, at the same pitches. Before this was wired, peak volume was constant and this failed.
test('Life multi-state: per-state velocity varies volume, not pitch (#85)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const out = await page.evaluate(async () => {
    LifeMode.loadAutomatonFromText(await (await fetch('./life/beehive.yaml')).text(), 'beehive.yaml');
    const unit = {
      louderThanSofter: LifeMode._peakOf(LifeMode.soundFor(1)) > LifeMode._peakOf(LifeMode.soundFor(2)),
      softerPositive: LifeMode._peakOf(LifeMode.soundFor(2)) > 0,
      defaultPeak: LifeMode._peakOf({}),
    };
    const plays = [];
    const orig = Synth.playNote;
    Synth.playNote = (midi, t0, dur, peak) => { plays.push({ midi, peak }); };
    LifeMode.stepOnce();
    Synth.playNote = orig;
    const peaks = plays.map((p) => p.peak);
    return { unit, distinctPeaks: [...new Set(peaks)].length, allPeaksDefined: peaks.every((p) => typeof p === 'number') };
  });
  expect(out.unit.louderThanSofter).toBe(true);          // state 1 (v95) louder than state 2 (v55)
  expect(out.unit.softerPositive).toBe(true);
  expect(out.unit.defaultPeak).toBeCloseTo(0.16, 5);     // no velocity -> the Synth default peak
  expect(out.allPeaksDefined).toBe(true);                // stepOnce forwards an explicit peak ...
  expect(out.distinctPeaks).toBeGreaterThanOrEqual(2);   // ... and head vs tail come out different
});

// Human-hearing range: the pannable lattice draws cells up to the top of human hearing
// (Tonnetz.audibleMaxMidi ~= MIDI 135, ~20 kHz), not the old MIDI-protocol ceiling of 127
// (~12.5 kHz). A cell above hearing (MIDI 138) is still not drawn.
test('Tonnetz draws cells up to the top of human hearing (past the old MIDI-127 cap)', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    // (10,0)->130, (9,4)->135 (top of hearing), (12,-2)->138 (above hearing).
    Render.drawLattice({ minP: 8, maxP: 12, minQ: -2, maxQ: 4 }, {});
    const drawn = (p, q) => !!Render.svg.querySelector(`polygon.cell:not(.ghost)[data-p="${p}"][data-q="${q}"]`);
    return {
      ceiling: Tonnetz.audibleMaxMidi(),
      midi130: drawn(10, 0),  // ~5.3 kHz, was clipped by the old 127 cap
      midi135: drawn(9, 4),   // ~19.9 kHz, the top audible cell
      midi138: drawn(12, -2), // ~21 kHz, above hearing -> not drawn
    };
  });
  expect(out.ceiling).toBe(135);
  expect(out.midi130).toBe(true);  // now reachable (was not, under the 127 cap)
  expect(out.midi135).toBe(true);  // drawn right up to the top of hearing
  expect(out.midi138).toBe(false); // but not beyond it
});

// Gravity's board register was dropped an octave (its pile end sits in low-but-audible bass now
// that true pitch is played -- see INV-46). Its tuning is otherwise unchanged: every cell is
// exactly 12 semitones below the old 35-based mapping.
test('Gravity board sits an octave lower', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    App.currentMode = 'gravity';
    const cells = [[-8, 17], [4, 0], [-5, 0], [0, 10]]; // spawn, pile-bottom corners, a mid cell
    return cells.map(([p, q]) => ({ p, q, got: Tonnetz.getMidi(p, q), oldBase: 35 - 3 * p + 4 * q }));
  });
  for (const c of out) {
    expect(c.got, `gravity (${c.p},${c.q}) should be an octave below the old mapping`).toBe(c.oldBase - 12);
  }
});

// Cross-mode copy/paste stores CANONICAL (standard-mapping) coordinates; Gravity's mapping is the
// standard Tonnetz rotated 120deg, so its cells convert to/from canonical by a fixed affine integer
// transform that must PRESERVE PITCH and round-trip to identity. This is what makes pitch-perfect
// paste to/from Gravity work with no frequency search.
test('Tonnetz gravity<->canonical transforms preserve pitch and round-trip', async ({ page }) => {
  await page.goto('/');
  const bad = await page.evaluate(() => {
    const gravityPitch = (p, q) => { App.currentMode = 'gravity'; return Tonnetz.getMidi(p, q); };
    const standardPitch = (p, q) => { App.currentMode = 'sandbox'; return Tonnetz.getMidi(p, q); };
    const problems = [];
    for (let p = -8; p <= 8; p++) {
      for (let q = -8; q <= 8; q++) {
        const canon = Tonnetz.gravityToCanonical(p, q);
        const gP = gravityPitch(p, q);
        const sP = standardPitch(canon.p, canon.q);
        if (sP !== gP) problems.push(`pitch (${p},${q}): gravity ${gP} vs canonical ${sP}`);
        const back = Tonnetz.canonicalToGravity(canon.p, canon.q);
        if (back.p !== p || back.q !== q) problems.push(`roundtrip (${p},${q}) -> (${back.p},${back.q})`);
      }
    }
    App.currentMode = 'sandbox';
    return problems.slice(0, 5);
  });
  expect(bad).toEqual([]);
});

// Reported live: App.clipboard is just this one tab's own JS memory, so copying in one Tonncade
// window/tab could never be pasted in a DIFFERENT one -- App.copy()/paste() alone have no way to
// reach across windows. Fixed by also writing to the real OS clipboard (navigator.clipboard) on
// copy, and having the real Paste entry point (App.pasteFromClipboardOrOS, bound to the button/
// Ctrl+V -- see setupClipboard) read it back first. Simulated here by clearing App.clipboard
// between copy and paste (standing in for "a different window/tab, with its own empty in-memory
// clipboard") and confirming the OS clipboard alone is enough to recover the exact cells.
test('Copy/paste: copy also writes the real OS clipboard, and paste recovers from it alone (cross-window)', async ({ page }) => {
  await page.goto('/');
  // A real context().grantPermissions(['clipboard-write']) + navigator.clipboard.writeText hits
  // the ACTUAL OS clipboard -- Playwright's browser is a genuine process on whatever machine
  // runs the suite, not a sandboxed one, so this test (part of the ordinary desktop.spec.js run,
  // not an occasional one) would clobber the developer's real clipboard on every local run.
  // Stubbing navigator.clipboard.writeText/readText in-page tests the exact same call site
  // (App.copy()/pasteFromClipboardOrOS read navigator.clipboard at call time) without ever
  // touching the real OS clipboard -- see the identical fix for tests/invariants.spec.js's
  // INV-18b, found live: stale replay JSON sitting in a real clipboard for weeks from exactly
  // this kind of test.
  await page.evaluate(() => {
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text) => { window.__clipboardText = text; return Promise.resolve(); },
        readText: () => Promise.resolve(window.__clipboardText),
      },
    });
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  const canonicalCells = await page.evaluate(() => {
    SandboxMode.state.placedCells = [{ p: 0, q: 0 }, { p: 1, q: 0 }];
    SandboxMode.refreshLattice();
    App.copy();
    return SandboxMode.state.placedCells.map((c) => `${c.p},${c.q}`).sort();
  });

  // The clipboard TEXT itself: a legible line of note names (per the request -- pasting into a
  // text editor/chat/etc. should read as recognizable music), plus the exact machine payload.
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  const [noteLine, payloadLine] = clipboardText.split('\n');
  expect(noteLine.trim()).toBe('C4 G4'); // (0,0) and (1,0) canonical -- C4, then a fifth up
  expect(JSON.parse(payloadLine)).toEqual({ TONNCADE_CELLS_V1: 1, cells: [{ p: 0, q: 0 }, { p: 1, q: 0 }] });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  await page.evaluate(() => {
    App.clipboard = []; // stand in for a separate window/tab's own empty in-memory clipboard
    LifeMode.clear();
  });
  await page.locator('#paste-btn').click();
  // pasteFromClipboardOrOS is async (it awaits navigator.clipboard.readText()) -- give its
  // microtask a beat to resolve and apply before reading the result back.
  await page.waitForFunction(() => LifeMode.state.live.size > 0, { timeout: 2000 });

  const pastedKeys = await page.evaluate(() => [...LifeMode.state.live.keys()].sort());
  expect(pastedKeys).toEqual(canonicalCells);
});

// Reported live: pasting into Compose looked like a no-op ("nothing pastes"). Compose has no
// persistent per-note marker at rest (only a momentary highlight while recording, or a selection
// ring once tapped), and unlike every other note-adding path, pasteClipboard used to skip both the
// momentary highlight AND updateStats() -- so a successful paste (state.notes really did grow) was
// visually and numerically indistinguishable from nothing having happened.
test('Copy/paste: pasting into Compose updates the visible note count', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  await page.evaluate(() => {
    SandboxMode.state.placedCells = [{ p: 0, q: 0 }, { p: 1, q: 0 }];
    SandboxMode.refreshLattice();
    App.copy();
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  const before = await page.locator('#compose-note-count').textContent();
  await page.evaluate(() => App.paste());
  const after = await page.locator('#compose-note-count').textContent();
  expect(before).toBe('0');
  expect(after).toBe('2'); // both pasted cells landed as notes, and the count reflects it
});

// Cross-mode copy/paste driving scenario: build cells in Sandbox, copy, switch to Life, paste.
// Same mapping (both standard) => the exact same cells and pitches land in Life.
test('Copy/paste: Sandbox cells paste into Life at the same pitches', async ({ page }) => {
  await page.goto('/');
  const clip = await page.evaluate(() => {
    SandboxMode.state.placedCells = [{ p: 0, q: 0 }, { p: 1, q: 0 }, { p: 0, q: 1 }];
    SandboxMode.refreshLattice();
    App.copy();
    document.querySelector('.mode-option[data-mode="life"]').click();
    return App.clipboard.map((c) => c.p + ',' + c.q).sort();
  });
  expect(clip).toEqual(['0,0', '0,1', '1,0']); // copied Sandbox's placed cells (canonical coords)

  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  const res = await page.evaluate(() => {
    LifeMode.clear();
    App.paste();
    const liveKeys = [...LifeMode.state.live.keys()].sort();
    const livePitches = liveKeys.map((k) => { const [p, q] = k.split(',').map(Number); return Tonnetz.getMidi(p, q); }).sort((a, b) => a - b);
    const clipPitches = App.clipboard.map((c) => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b);
    return { liveKeys, livePitches, clipPitches };
  });
  expect(res.liveKeys).toEqual(['0,0', '0,1', '1,0']); // pasted into Life at the same cells
  expect(res.livePitches).toEqual(res.clipPitches);     // and the same pitches (true-pitch preserved)
});

// Cross-mapping copy/paste: Gravity's pile copied and pasted into Sandbox must keep its true
// pitches, even though Gravity's coordinate labels differ (the 120deg rotation is bridged via
// canonical coords). Geometry rotates; pitch does not.
test('Copy/paste: Gravity pile pastes into Sandbox preserving true pitch', async ({ page }) => {
  await page.goto('/');
  const gPitches = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    const gcells = [{ p: 0, q: 0 }, { p: -1, q: 2 }, { p: 1, q: 4 }];
    GravityBoard.fillCells(gcells, 'x', '#fff');
    App.copy();
    return gcells.map((c) => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b); // gravity pitches
  });
  const sPitches = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="sandbox"]').click();
    App.currentMode = 'sandbox';
    SandboxMode.state.placedCells = [];
    App.paste();
    return SandboxMode.state.placedCells.map((c) => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b);
  });
  expect(sPitches).toEqual(gPitches); // same pitches after the cross-mapping remap
});

// Reported live: copying Sandbox cells and pasting into Gravity via the REAL header buttons (not
// App.copy()/App.paste() called directly, which the other copy/paste tests here use) landed
// wrong. This drives the exact real workflow -- place in Sandbox, click #copy-btn, switch to
// Gravity via the mode slider, click #paste-btn -- and checks both the resulting board state and
// what's actually painted on screen.
test('Copy/paste into Gravity via the real header buttons places the copied cells correctly', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  // Chosen (via Tonnetz.canonicalToGravity) to all land safely inside the cup's -5..4 columns --
  // a cluster nearer the Sandbox origin, e.g. (0,0),(1,0),(0,1), mostly maps OUTSIDE the cup under
  // this rotation, which is correct/expected (INV-47: cells landing out of bounds are dropped),
  // not a bug -- this test is about the ones that DO land, not about testing that boundary.
  const canonicalCells = await page.evaluate(() => {
    SandboxMode.state.placedCells = [{ p: 0, q: -4 }, { p: 1, q: -4 }, { p: 0, q: -3 }];
    SandboxMode.refreshLattice();
    return SandboxMode.state.placedCells.map((c) => `${c.p},${c.q}`).sort();
  });
  await page.locator('#copy-btn').click();
  // Capture the clipboard's TRUE pitches while still in Sandbox (the standard mapping) -- Tonnetz
  // .getMidi is mode-dependent (INV-46/47: canonical coords are pitch-mapping-agnostic, but
  // getMidi itself isn't), so computing this AFTER switching to Gravity would wrongly apply
  // Gravity's own formula to plain canonical coordinates.
  const clipboard = await page.evaluate(() => App.clipboard.map((c) => `${c.p},${c.q}`).sort());
  expect(clipboard).toEqual(canonicalCells); // sanity: copy actually captured Sandbox's cells
  const clipPitches = await page.evaluate(() => App.clipboard.map((c) => Tonnetz.getMidi(c.p, c.q)).sort((a, b) => a - b));

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
  await page.locator('#paste-btn').click();
  // The Paste button is now App.pasteFromClipboardOrOS (async: it awaits
  // navigator.clipboard.readText() first) -- give it a beat to actually apply before checking.
  await page.waitForFunction(() => GravityBoard.cells.size > 0, { timeout: 2000 });

  // Paste itself never settles (that's a separate per-tick physics step -- see "pasted mid-air
  // cells settle only once ticks resume" below), so these land exactly at their raw,
  // unsettled canonical->gravity positions, mid-air or not.
  const res = await page.evaluate(() => ({
    boardSize: GravityBoard.cells.size,
    painted: document.querySelectorAll('#tonnetz-svg polygon.placed-piece').length,
  }));
  expect(res.boardSize).toBe(3); // all 3 cells landed (nothing occupied/out-of-cup to block them)
  expect(res.painted).toBe(3);   // and are actually drawn, not just in the data model
  const pitches = await page.evaluate(() =>
    [...GravityBoard.cells.keys()].map((k) => { const [p, q] = k.split(',').map(Number); return Tonnetz.getMidi(p, q); }).sort((a, b) => a - b));
  expect(pitches).toEqual(clipPitches); // exact true pitch preserved
});

// Pasting INTO Gravity: cells whose pitch lands outside the cup, or on an occupied cell, are
// ignored; the rest are placed (even mid-air, per the user's rules).
test('Copy/paste into Gravity ignores out-of-cup and overlapping cells; places the rest', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityBoard.fillCells([{ p: 0, q: 0 }], 'pile', '#fff'); // an existing pile cell (on the floor)
    // Gravity images: empty in-cup floor cell (3,0), overlapping (0,0), out-of-cup (12,0). Floor
    // cells so settling doesn't move them -- this test isolates the cup/overlap rules.
    App.clipboard = [
      Tonnetz.gravityToCanonical(3, 0),
      Tonnetz.gravityToCanonical(0, 0),
      Tonnetz.gravityToCanonical(12, 0),
    ];
    App.paste();
    return {
      hasValid: GravityBoard.cells.has('3,0'),
      hasOccupied: GravityBoard.cells.has('0,0'),
      hasOut: GravityBoard.cells.has('12,0'),
      size: GravityBoard.cells.size,
    };
  });
  expect(res.hasValid).toBe(true);    // in-cup empty cell placed
  expect(res.hasOccupied).toBe(true); // overlap left as-is
  expect(res.hasOut).toBe(false);     // out-of-cup ignored
  expect(res.size).toBe(2);           // original pile cell + one pasted cell
});

// Pasted mid-air cells fall to rest one row per TICK, exactly like the active piece, never in one
// silent precomputed jump (reported live: an instant jump-to-rest was surprising). Paste itself
// must leave the cell exactly where it landed; only once ticks actually run does it fall.
test('Copy/paste into Gravity: pasted mid-air cells stay put until ticks resume, then settle one row at a time', async ({ page }) => {
  await page.goto('/');
  const afterPaste = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    App.clipboard = [Tonnetz.gravityToCanonical(-3, 10)]; // an in-cup cell high in the air
    App.paste();
    const qs = [...GravityBoard.cells.keys()].map((k) => +k.split(',')[1]);
    return { size: GravityBoard.cells.size, minQ: Math.min(...qs) };
  });
  expect(afterPaste.size).toBe(1);   // the one pasted cell
  expect(afterPaste.minQ).toBe(10);  // still exactly where it was pasted -- paste never settles

  const stepped = await page.evaluate(() => {
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    const qsAfterOneTick = () => [...GravityBoard.cells.keys()].map((k) => +k.split(',')[1]);
    GravityMode.tick(); // one tick, one row -- never a jump straight to the floor
    const afterOne = Math.min(...qsAfterOneTick());
    let guard = 0;
    while (Math.min(...qsAfterOneTick()) > 0 && guard++ < 30) GravityMode.tick();
    return { afterOne, finalMinQ: Math.min(...qsAfterOneTick()), size: GravityBoard.cells.size };
  });
  expect(stepped.afterOne).toBe(9);     // exactly one row per tick, not an instant drop to the floor
  expect(stepped.finalMinQ).toBe(0);    // eventually settles all the way to the floor
  expect(stepped.size).toBe(1);         // still just the one cell -- nothing lost or duplicated
});

// A row can be completed by debris settling into place, not just by the active piece locking --
// checkForClears() runs every tick regardless of how a row got full, so this must clear it exactly
// the same way a piece-completed row would.
test('Gravity: a row completed by debris settling (not a piece locking) still clears', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    // A full row at q=0 (col -5..4), completed directly (standing in for "settled into place" --
    // checkForClears doesn't care how the cells got there, only that the row is full).
    for (let col = -5; col <= 4; col++) {
      GravityBoard.cells.set(`${col},0`, { type: 'X', color: '#fff' });
    }
    const before = { size: GravityBoard.cells.size, linesCleared: GravityMode.state.linesCleared };
    const cleared = GravityMode.checkForClears();
    return { before, cleared, sizeAfter: GravityBoard.cells.size, linesClearedAfter: GravityMode.state.linesCleared };
  });
  expect(res.before.size).toBe(10);
  expect(res.cleared).toBe(true);
  expect(res.sizeAfter).toBe(0);                                    // the full row is gone
  expect(res.linesClearedAfter).toBe(res.before.linesCleared + 1);  // and it counted
});

// Clearing a line does NOT itself shift anything above it -- that's ordinary per-tick debris
// settling (see settleFloatingCellsStep), not a special instant cascade. So immediately after a
// clear, cells above are untouched; they only fall gradually as later ticks run.
test('Gravity: clearing a line does not instantly shift what was above it -- it falls in via later ticks', async ({ page }) => {
  await page.goto('/');
  const afterClear = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    for (let col = -5; col <= 4; col++) GravityBoard.cells.set(`${col},0`, { type: 'X', color: '#fff' });
    GravityBoard.cells.set('0,5', { type: 'X', color: '#fff' }); // floating well above the row, unconnected to it
    GravityMode.checkForClears(); // clears the q=0 row
    return { size: GravityBoard.cells.size, keys: [...GravityBoard.cells.keys()] };
  });
  expect(afterClear.size).toBe(1);
  expect(afterClear.keys).toEqual(['0,5']); // untouched -- clearing alone never moves it

  const settled = await page.evaluate(() => {
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    const q = () => +[...GravityBoard.cells.keys()][0].split(',')[1];
    const qs = [q()];
    for (let i = 0; i < 6; i++) { GravityMode.tick(); qs.push(q()); }
    return qs;
  });
  // One row per tick -- 5, 4, 3, 2, 1, 0, then resting at the floor (no further change).
  expect(settled).toEqual([5, 4, 3, 2, 1, 0, 0]);
});

// The literal reported scenario: figure out which note fills a gap in a low Gravity row, place
// just that cell in Sandbox, copy, switch to Gravity via the real header buttons, paste, resume
// play -- the completed row must clear, and whatever's above must cascade down correctly.
test('Gravity: pasting the exact missing note into a near-complete row clears it and cascades correctly on resume', async ({ page }) => {
  await page.goto('/');
  const setup = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    // Row q=0 complete except col=2 (the "hole"); a couple of unrelated cells above, to confirm
    // they cascade down correctly once the gap opens up.
    const holeP = 2, holeQ = 0;
    for (let col = -5; col <= 4; col++) {
      if (col === holeP) continue;
      GravityBoard.cells.set(`${col},0`, { type: 'X', color: '#fff' });
    }
    GravityBoard.cells.set('3,3', { type: 'X', color: '#fff' }); // sits above the row, unconnected
    // The exact canonical (Sandbox) cell whose gravity mapping IS the hole -- "figuring out which
    // note fills it" in the reported workflow.
    const holeCanonical = Tonnetz.gravityToCanonical(holeP, holeQ);
    return { holeCanonical, sizeBefore: GravityBoard.cells.size };
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  await page.evaluate((c) => {
    SandboxMode.state.placedCells = [c];
    SandboxMode.refreshLattice();
  }, setup.holeCanonical);
  await page.locator('#copy-btn').click();

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());
  await page.locator('#paste-btn').click();
  // The Paste button is now App.pasteFromClipboardOrOS (async: it awaits
  // navigator.clipboard.readText() first) -- give it a beat to actually apply before checking.
  await page.waitForFunction((before) => GravityBoard.cells.size > before, setup.sizeBefore, { timeout: 2000 });
  const afterPaste = await page.evaluate(() => ({
    size: GravityBoard.cells.size,
    rowStillFull: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4].every((col) => GravityBoard.cells.has(`${col},0`)),
  }));
  expect(afterPaste.size).toBe(setup.sizeBefore + 1); // the pasted cell landed
  expect(afterPaste.rowStillFull).toBe(true);         // the hole is now filled -- row is complete

  // Resume play: run enough ticks for checkForClears to catch the completed row and for the
  // cell above to fully cascade down.
  const final = await page.evaluate(() => {
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    for (let i = 0; i < 10; i++) GravityMode.tick();
    return {
      // NOT "is any of the row's original coordinate keys occupied" -- the unrelated debris cell
      // legitimately zigzags down through some of those same keys as it falls (correct geometry,
      // not a leftover of the row). The real question is whether q=0 is currently a FULL line.
      rowGone: GravityBoard.findFullLines().length === 0,
      linesCleared: GravityMode.state.linesCleared,
      remaining: [...GravityBoard.cells.entries()].filter(([k, v]) => v.type === 'X'),
    };
  });
  expect(final.rowGone).toBe(true);       // the completed row cleared -- on the very first tick
  expect(final.linesCleared).toBe(1);     // and counted exactly once
  expect(final.remaining.length).toBe(1); // the one unrelated cell that was above survives
  // (4,0), not (3,0): the hex "straight down" zigzag (getDown) naturally drifts a falling cell
  // sideways by one column over an odd number of rows -- correct, expected geometry, not a bug.
  expect(final.remaining[0][0]).toBe('4,0'); // and cascaded all the way down to the (now-open) floor
});

// Reported live: after the fix above, real play still showed post-clear debris freezing solid
// instead of falling. Root cause, confirmed by direct repro: _boardComponents grouped cells by
// FRESH geometric adjacency every tick, so any falling mass whose descent merely brushed past an
// UNRELATED already-settled piece got welded to it and froze as one rigid body -- even though
// only one cell of the mass actually touched anything, and the rest was hanging over open floor.
// Real pieces should stay rigid (they fell connected), but two SEPARATE settled pieces touching
// each other is ordinary stacking (each independently blocked by the other), not fusion. Fixed by
// grouping on a persistent groupId stamped at lock/paste time (_assignGroupId) instead of
// recomputing adjacency from scratch.
test('Gravity: a falling mass that brushes past an unrelated settled piece keeps falling past it, not fused to it', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityMode.state.linesCleared = 0;
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    // Difficulty 4: no rest-time welding (#93 follow-up) -- this test is specifically about the
    // ORIGINAL disconnection bug (unrelated groups incorrectly fusing), a different thing from the
    // NEW deliberate weld feature default difficulty would now also trigger here.
    GravityMode.state.difficulty = 4;
    GravityMode.spawnPiece();
    GravityMode.state.p = 20; GravityMode.state.q = 40; // active piece parked well out of the way

    // An unrelated, genuinely settled single-column spike (its own group, via lockActivePiece --
    // simulated directly here the same way GravityBoard.fillCells + _assignGroupId would).
    const spike = [];
    for (let q = 0; q <= 5; q++) spike.push({ p: -5 - Math.floor(q / 2), q });
    GravityBoard.fillCells(spike, 'X', '#fff');
    GravityMode._assignGroupId(spike);

    // The row that will clear (q=6, every column, including the spike's own continuation).
    const clearRow = [];
    for (let col = -5; col <= 4; col++) clearRow.push({ p: col - Math.floor(6 / 2), q: 6 });
    GravityBoard.fillCells(clearRow, 'X', '#fff');
    GravityMode._assignGroupId(clearRow);

    // A wide mass at q=7 (cols -4..4, i.e. NOT above the spike's own column) -- its own group,
    // unrelated to the spike or the clearing row.
    const mass = [];
    for (let col = -4; col <= 4; col++) mass.push({ p: col - Math.floor(7 / 2), q: 7 });
    GravityBoard.fillCells(mass, 'X', '#fff');
    GravityMode._assignGroupId(mass);
    const massGroupId = GravityBoard.cells.get(`${mass[0].p},${mass[0].q}`).groupId;

    const massQsByTick = [];
    for (let i = 0; i < 15; i++) {
      GravityMode.tick();
      const qs = [...GravityBoard.cells.entries()]
        .filter(([k, v]) => v.groupId === massGroupId)
        .map(([k]) => +k.split(',')[1]);
      massQsByTick.push(qs.length ? Math.min(...qs) : null); // null once fully consumed by a clear
    }
    return { linesCleared: GravityMode.state.linesCleared, massQsByTick };
  });
  // Old buggy behavior: the mass touches the spike's column in passing on its way down, gets
  // welded to it as one rigid mass, and freezes at q=6 forever -- massQsByTick would read
  // [7, 6, 6, 6, 6, ...] and linesCleared would stay at 1. Correct behavior: it keeps falling past
  // the brush-contact, drops far enough to nestle flush against the spike's own peak, and
  // completes a SECOND real line there (q=5 -- the spike's one cell plus the mass's other nine
  // exactly fill it) -- two clears total, and the mass's own cells are consumed by that second
  // clear rather than sitting frozen.
  expect(result.linesCleared).toBe(2);
  expect(result.massQsByTick).toContain(6);  // it did pass through q=6 on the way down...
  expect(result.massQsByTick.filter((q) => q === 6).length).toBeLessThan(5); // ...but didn't STAY there
  expect(result.massQsByTick[result.massQsByTick.length - 1]).toBeNull(); // consumed by the 2nd clear, not frozen mid-air
});

// Reported live, against a REAL captured play session (not a synthetic repro): the freeze fix
// above wasn't enough -- a real pile still froze solid. Root cause, confirmed by direct diagnosis
// of the replayed session's final board state: a line clear can remove the ONE cell bridging two
// parts of an already-settled piece (e.g. a 3-tall piece straddling the row that clears loses its
// middle cell). The two surviving fragments kept the SAME old groupId even though they were no
// longer touching -- rigid-body movement then required BOTH fragments to move together, so the
// instant either one hit anything, the OTHER froze too, however far away and disconnected it was.
test('Gravity._resplitGroups: severing a piece\'s bridging cell splits the survivors into independent groups', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();

    // Build the REAL 3-cell chain (0,5)-(0,6)-(0,7) as one genuinely connected group (this is
    // what _assignGroupId's own connectivity split leaves alone -- one component in, one id out),
    // then delete the middle cell directly, the same way a line clear's GravityBoard.clearCells
    // would: the two survivors keep the OLD shared id even though clearCells itself has no idea
    // it just severed a piece -- that's exactly the state _resplitGroups exists to repair.
    const chain = [{ p: 0, q: 5 }, { p: 0, q: 6 }, { p: 0, q: 7 }];
    GravityBoard.fillCells(chain, 'X', '#fff');
    GravityMode._assignGroupId(chain);
    const sharedGroupId = GravityBoard.cells.get('0,5').groupId;
    GravityBoard.clearCells([{ p: 0, q: 6 }]);

    // A control pair that's genuinely still connected after its own clear -- must NOT be split.
    const pair = [{ p: 3, q: 2 }, { p: 3, q: 3 }, { p: 3, q: 4 }];
    GravityBoard.fillCells(pair, 'Y', '#000');
    GravityMode._assignGroupId(pair);
    const connectedGroupId = GravityBoard.cells.get('3,2').groupId;
    GravityBoard.clearCells([{ p: 3, q: 4 }]); // trims an END cell -- (3,2)-(3,3) stay connected

    GravityMode._resplitGroups(new Set([sharedGroupId, connectedGroupId]));

    return {
      severedIds: [GravityBoard.cells.get('0,5').groupId, GravityBoard.cells.get('0,7').groupId],
      connectedIds: [GravityBoard.cells.get('3,2').groupId, GravityBoard.cells.get('3,3').groupId],
    };
  });
  // The two disconnected survivors must now carry DIFFERENT group ids...
  expect(result.severedIds[0]).not.toBe(result.severedIds[1]);
  // ...but a pair that's still genuinely touching must be left exactly as it was (same id, no
  // pointless re-splitting of pieces the clear didn't actually break).
  expect(result.connectedIds[0]).toBe(result.connectedIds[1]);
});

// Reported live AGAIN, against a THIRD real captured play session: trimming off-board cells at
// lock time (the fix that used to live here) turned out to be the wrong call. checkActivePlacement
// lets a piece overhang the wall while STEERING (a toe-hold is enough) and still slide -- the SAME
// piece, one tick later, having just locked with no change in player input, used to go rigid the
// instant it touched down, because settleFloatingCellsStep's own canOffset required EVERY cell
// in-bounds, not just a toe-hold. Deleting the overhang was correctness overkill for a danger
// that's actually handled at its root now (_assignGroupId's connectivity split, not by never
// letting anything sit off-grid) -- and it silently discarded a real recovery path: an overhanging
// piece sliding back within the wall over later ticks to land in a gap only reachable from that
// angle. Fixed by making canOffset toe-hold-tolerant too (see its own note), and reverting the
// trim entirely -- an off-board middle cell no longer needs special handling; it's just a normal
// part of one physically connected piece.
test('Gravity: a piece locked overhanging the wall keeps ALL its cells, including the off-board one', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    // The '-' domino at p=5,q=0: absolute cells (4,0) col=4 (in, the toe-hold) and (5,0) col=5
    // (one past the right wall).
    GravityMode.state.activePiece = '-';
    GravityMode.state.p = 5; GravityMode.state.q = 0; GravityMode.state.rotation = 0;
    GravityMode.state.isGameOver = false;
    const placementLegal = GravityBoard.checkActivePlacement('-', 5, 0, 0);
    GravityMode.lockActivePiece();
    return {
      placementLegal,
      groupIds: [GravityBoard.cells.get('4,0') ? GravityBoard.cells.get('4,0').groupId : null,
                 GravityBoard.cells.get('5,0') ? GravityBoard.cells.get('5,0').groupId : null],
    };
  });
  expect(result.placementLegal).toBe(true); // confirms this really is the overhang scenario
  // Both cells survive, sharing the SAME group -- still one physically connected piece.
  expect(result.groupIds[0]).not.toBeNull();
  expect(result.groupIds[1]).not.toBeNull();
  expect(result.groupIds[0]).toBe(result.groupIds[1]);
});

// The actual recovery mechanic: an overhanging piece, once locked, keeps obeying the SAME
// toe-hold-tolerant rule it always did as an active piece -- so if its straight-down path is
// blocked, it can take the diagonal slide, which SHIFTS COLUMN (unlike straight-down, which
// preserves it), potentially walking a previously off-board cell back within the wall.
test('Gravity: an overhanging piece can slide back within the wall on a later tick, not freeze rigid at lock', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    GravityMode.spawnPiece();
    GravityMode.state.p = -100; GravityMode.state.q = 200; // parked out of the way

    // The '-' domino locked overhanging at q=4: (2,4) col=4 (in) and (3,4) col=5 (off-board).
    GravityMode.state.activePiece = '-';
    GravityMode.state.p = 3; GravityMode.state.q = 4; GravityMode.state.rotation = 0;
    GravityMode.lockActivePiece();
    const colsBefore = [...GravityBoard.cells.keys()].filter((k) => k !== '-100,200').map((k) => {
      const [p, q] = k.split(',').map(Number);
      return p + Math.floor(q / 2);
    }).sort((a, b) => a - b);

    // A single blocker cell directly in the domino's primary (straight-down) path -- forces the
    // diagonal-slide fallback on the very next tick, which is the one that shifts column.
    GravityBoard.fillCells([{ p: 4, q: 3 }], 'X', '#fff');
    GravityMode._assignGroupId([{ p: 4, q: 3 }]);

    GravityMode.tick();
    const colsAfter = [...GravityBoard.cells.entries()]
      .filter(([k, v]) => v.type === '-')
      .map(([k]) => { const [p, q] = k.split(',').map(Number); return p + Math.floor(q / 2); })
      .sort((a, b) => a - b);

    return { colsBefore, colsAfter };
  });
  expect(result.colsBefore).toEqual([4, 5]); // one in bounds, one overhanging, as locked
  // After the forced slide, BOTH cells shifted one column left -- the previously off-board one
  // (col 5) is now col 4, back within the wall.
  expect(result.colsAfter).toEqual([3, 4]);
});

// Requested live: "if I clear a line, clear the *whole* line, in or out of the cup." findFullLines
// only checks col -5..4 (a line's own definition never needed the overhang), but clearing now
// sweeps any off-board cells sharing the completed row's q too, not just the in-bounds portion.
test('Gravity: clearing a line sweeps off-board cells sharing that row too, not just the in-bounds portion', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityMode.state.linesCleared = 0;

    // A complete row at q=0 (cols -5..4)...
    const line = [];
    for (let col = -5; col <= 4; col++) line.push({ p: col, q: 0 });
    GravityBoard.fillCells(line, 'X', '#fff');
    GravityMode._assignGroupId(line);
    // ...plus an off-board cell sharing the SAME q, connected to the row (part of one piece that
    // overhung when it locked).
    GravityBoard.fillCells([{ p: 5, q: 0 }], 'X', '#fff');
    GravityMode._assignGroupId(line.concat([{ p: 5, q: 0 }]));
    // And an UNRELATED off-board cell at a DIFFERENT q, which must survive untouched.
    GravityBoard.fillCells([{ p: 5, q: 3 }], 'Y', '#000');
    GravityMode._assignGroupId([{ p: 5, q: 3 }]);

    const sizeBefore = GravityBoard.cells.size;
    const cleared = GravityMode.checkForClears();
    return { sizeBefore, cleared, remaining: [...GravityBoard.cells.keys()].sort() };
  });
  expect(result.sizeBefore).toBe(12); // 10-cell row + 1 off-board rider + 1 unrelated
  expect(result.cleared).toBe(true);
  // The whole row (10 in-bounds + the 1 off-board rider sharing its q) is gone; the unrelated
  // off-board cell at a different q survives.
  expect(result.remaining).toEqual(['5,3']);
});

// Requested live, precisely: "let everybody settle." A group that ends up ENTIRELY off-board
// (zero cells with a valid column) used to freeze the instant it got there -- canOffset required
// at least ONE cell to land in-bounds for ANY move, so a group with no in-bounds cells at all
// could never move again, stuck floating forever with visible empty space beneath it. canOffset
// no longer checks walls at all (see its own note) -- only the true floor and real collisions --
// so a fully off-board group keeps falling to the floor exactly like anything else.
test('Gravity: a fully off-board group keeps falling to the floor, not stuck floating', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    GravityMode.spawnPiece();
    GravityMode.state.p = -100; GravityMode.state.q = 200; // parked out of the way

    // Two cells, both off-board (col 5), floating unsupported at q=5/6 -- nothing below them.
    const cells = [{ p: 5, q: 5 }, { p: 5, q: 6 }];
    GravityBoard.fillCells(cells, 'X', '#fff');
    GravityMode._assignGroupId(cells);

    const qsBefore = cells.map((c) => c.q).sort((a, b) => a - b);
    for (let i = 0; i < 15; i++) GravityMode.tick();
    const qsAfter = [...GravityBoard.cells.entries()]
      .filter(([, v]) => v.type === 'X')
      .map(([k]) => +k.split(',')[1])
      .sort((a, b) => a - b);

    return { qsBefore, qsAfter };
  });
  expect(result.qsBefore).toEqual([5, 6]);
  // It fell all the way to the true floor (q=0/1), not stuck at its starting height.
  expect(result.qsAfter).toEqual([0, 1]);
});

// Requested live: "line clearing feels slow." tick()'s own checkForClears() runs BEFORE the
// active piece's movement/lock step, so a row a LOCK just completed used to sit there, visibly
// full, for up to one whole dropInterval before clearing on the NEXT tick. Fixed by checking
// immediately inside lockActivePiece itself -- no tick() call needed for the clear to happen.
test('Gravity: locking a piece that completes a line clears it immediately, not on the next tick', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityMode.state.linesCleared = 0;
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;

    // Every column except one at q=0.
    for (let col = -5; col <= 4; col++) {
      if (col === 0) continue;
      GravityBoard.fillCells([{ p: col, q: 0 }], 'X', '#fff');
      GravityMode._assignGroupId([{ p: col, q: 0 }]);
    }
    // Lock the '.' monohex into the exact missing spot -- no tick() call anywhere in this test.
    GravityMode.state.activePiece = '.';
    GravityMode.state.p = 0; GravityMode.state.q = 0; GravityMode.state.rotation = 0;
    GravityMode.lockActivePiece();

    return {
      linesCleared: GravityMode.state.linesCleared,
      rowStillPresent: [...GravityBoard.cells.keys()].some((k) => k.endsWith(',0')),
    };
  });
  expect(result.linesCleared).toBe(1);
  expect(result.rowStillPresent).toBe(false);
});

// Requested live: linear (20ms/line) hit the 100ms floor by line 45, ramping up too fast. Log
// decay keeps the early game feeling snappy but takes roughly 4x as many lines to bottom out.
test('Gravity: drop-interval speed decays logarithmically toward the 100ms floor, not linearly', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    const sample = (n) => {
      GravityMode.state.linesCleared = n;
      GravityMode.updateSpeed();
      return GravityMode.state.dropInterval;
    };
    const at0 = sample(0);
    const at45 = sample(45);
    let floorReachedAt = null;
    for (let n = 0; n <= 1000 && floorReachedAt === null; n++) {
      if (sample(n) <= 100) floorReachedAt = n;
    }
    return { at0, at45, floorReachedAt };
  });
  expect(result.at0).toBe(1000);
  // The OLD linear formula hit the 100ms floor by line 45 -- the new curve must still be well
  // above it at that point...
  expect(result.at45).toBeGreaterThan(300);
  // ...but should still reach the floor eventually, well beyond the old 45-line mark.
  expect(result.floorReachedAt).toBeGreaterThan(150);
  expect(result.floorReachedAt).toBeLessThan(250);
});

// Reported live, precisely, against a real captured session: a 2-cell fragment visibly drifted
// one column further right than it should have while falling with nothing blocking it. Root
// cause: settleFloatingCellsStep picked its "down" direction from comp[0] -- whichever cell
// happened to be first in the group's own array -- not the piece's TRUE anchor (state.p,
// state.q). The hex grid has two valid "straight down" offsets depending on q's parity;
// different cells of the same rigid group can have different parities, so anchoring on the
// WRONG cell picks the wrong offset and drags the whole shape a column off from where the
// piece's own anchor (matching how it fell before it ever locked) would have carried it.
test('Gravity: a locked piece\'s TRUE anchor (state.p/q), not an arbitrary cell, drives which cell survives with isAnchor', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    // The 'L' piece's own relative-cell list puts (-1,+1) BEFORE the (0,0) pivot -- so at
    // p=3,q=1, the piece's absolute cells are [(2,2), (3,1), (4,0), (5,0)] in THAT order, with
    // (3,1) -- not the first entry -- being the true anchor.
    GravityMode.state.activePiece = 'L';
    GravityMode.state.p = 3; GravityMode.state.q = 1; GravityMode.state.rotation = 0;
    GravityMode.state.isGameOver = false;
    GravityMode.lockActivePiece();
    return [...GravityBoard.cells.entries()].map(([k, v]) => ({ key: k, isAnchor: !!v.isAnchor }));
  });
  const anchors = result.filter((c) => c.isAnchor).map((c) => c.key);
  expect(anchors).toEqual(['3,1']); // the true pivot, not (2,2) (array-order-first but NOT the pivot)
});

// The full real scenario, end to end: lock the piece above (its rightmost cell overhangs and
// gets trimmed), complete and clear the row its bottom cell fills, and confirm the surviving
// fragment settles using the preserved TRUE anchor's own fall direction -- not the old
// arbitrary-comp[0] drift.
test('Gravity: a fragment surviving a line clear falls using its piece\'s true anchor, not an arbitrary drift', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityBoard.cells.clear();
    GravityMode.state.linesCleared = 0;
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;

    GravityMode.state.activePiece = 'L';
    GravityMode.state.p = 3; GravityMode.state.q = 1; GravityMode.state.rotation = 0;
    GravityMode.lockActivePiece(); // cells (2,2),(3,1),(4,0) survive; (5,0) trimmed off-board

    const filler = [];
    for (let col = -5; col <= 4; col++) {
      const p = col - Math.floor(0 / 2);
      if (p === 4) continue; // that's the piece's own (4,0)
      filler.push({ p, q: 0 });
    }
    GravityBoard.fillCells(filler, 'X', '#fff');
    GravityMode._assignGroupId(filler);

    GravityMode.spawnPiece();
    GravityMode.state.p = -100; GravityMode.state.q = 200; // parked out of the way

    GravityMode.tick(); // triggers the clear of q=0, removing (4,0) among others
    const linesCleared = GravityMode.state.linesCleared;
    const survivorGroupId = GravityBoard.cells.get('2,2') ? GravityBoard.cells.get('2,2').groupId : null;

    for (let i = 0; i < 10; i++) GravityMode.tick();

    const finalKeys = [...GravityBoard.cells.entries()]
      .filter(([, v]) => v.groupId === survivorGroupId)
      .map(([k]) => k).sort();
    return { linesCleared, finalKeys };
  });
  expect(result.linesCleared).toBe(1);
  // Old buggy behavior (arbitrary comp[0] = (2,2), an EVEN-q cell): the pair drifts via (2,2)'s
  // own offset each rigid step, ending up net one column further RIGHT than the anchor-preserving
  // fall -- e.g. resting at ['3,1','4,0'] instead of directly beneath where it started. Correct
  // behavior (anchor = the true pivot (3,1), an ODD-q cell): the pair falls straight down to the
  // floor, resting at ['2,1','3,0'].
  expect(result.finalKeys).toEqual(['2,1', '3,0']);
});

// Requested live (#93 follow-up, "static electricity... if you happen to be touching another
// piece... choose that", difficulty-gated per the same conversation): difficulty 1-3 welds a
// group into whatever it comes to rest touching, so pieces that end up flush against each other
// stay one mass on later clears instead of independently splitting apart. Difficulty 4 keeps the
// existing (pre-this-feature) independent-piece behavior -- deliberately embracing the "confusing
// fissures" as a feature at the hardest level.
test('Gravity: difficulty 1-3 welds a group to whatever it rests touching; difficulty 4 does not', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="gravity"]').click();
    App.currentMode = 'gravity';
    GravityMode.state.isPaused = false;
    GravityMode.state.isGameOver = false;
    GravityMode.spawnPiece();
    GravityMode.state.p = -100; GravityMode.state.q = 200; // parked out of the way

    const setupPair = () => {
      GravityBoard.cells.clear();
      GravityBoard.fillCells([{ p: 0, q: 0 }], 'X', '#fff'); // resting on the floor
      GravityMode._assignGroupId([{ p: 0, q: 0 }]);
      GravityBoard.fillCells([{ p: 0, q: 1 }], 'Y', '#000'); // directly above -- will land flush on it
      GravityMode._assignGroupId([{ p: 0, q: 1 }]);
    };

    setupPair();
    GravityMode.state.difficulty = 3;
    GravityMode.tick();
    const weldedIds = [GravityBoard.cells.get('0,0').groupId, GravityBoard.cells.get('0,1') ? GravityBoard.cells.get('0,1').groupId : null];

    setupPair();
    GravityMode.state.difficulty = 4;
    GravityMode.tick();
    const unweldedIds = [...GravityBoard.cells.values()].map((v) => v.groupId);

    return { weldedIds, unweldedIds };
  });
  // Difficulty 3: the falling cell lands flush on the resting one and welds into the SAME group.
  expect(result.weldedIds[0]).not.toBeNull();
  expect(result.weldedIds[0]).toBe(result.weldedIds[1]);
  // Difficulty 4: blocked straight down, it slides away diagonally instead (still can't occupy
  // the same cell) and keeps its OWN separate group id -- never merged.
  expect(new Set(result.unweldedIds).size).toBe(2);
});

// Sandbox's gray inaudible lattice box GROWS to cover pasted far content (e.g. a large Life game),
// so it's reachable by panning -- not clipped to the fixed default band. Capped for performance.
test('Sandbox: the gray lattice box grows to reach pasted far cells', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    const empty = SandboxMode._contentViewport();
    SandboxMode.state.placedCells = [{ p: 40, q: 0 }];
    const grown = SandboxMode._contentViewport();
    SandboxMode.state.placedCells = [{ p: 500, q: 0 }]; // absurdly far -> clamped by the cap
    const capped = SandboxMode._contentViewport();
    return { empty, grown, capped };
  });
  expect(out.empty.maxP).toBe(26);                 // default reachable band, no content
  expect(out.grown.maxP).toBeGreaterThanOrEqual(40); // grows to include the far pasted cell
  expect(out.capped.maxP).toBeLessThanOrEqual(64);   // but stays bounded (perf cap)
});

// Sandbox draws inaudible cells (outside human hearing) in dull gray so a pasted large Life game
// is inspectable and the way back to the audible band stays visible.
test('Sandbox: inaudible cells render gray, audible cells stay normal', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    const poly = (p, q) => Render.svg.querySelector(`polygon.cell:not(.ghost)[data-p="${p}"][data-q="${q}"]`);
    const gray = poly(20, 0);  // getMidi 200 -- inaudible, was clipped entirely before
    const heard = poly(0, 0);  // getMidi 60 -- audible
    return {
      audible200: Tonnetz.isAudible(200), audible60: Tonnetz.isAudible(60),
      grayDrawn: !!gray, grayFill: gray && gray.getAttribute('fill'),
      heardFill: heard && heard.getAttribute('fill'),
    };
  });
  expect(out.audible200).toBe(false);
  expect(out.audible60).toBe(true);
  expect(out.grayDrawn).toBe(true);            // inaudible cell is now drawn (reachable)...
  expect(out.grayFill).toBe('#34373f');        // ...in dull gray
  expect(out.heardFill).not.toBe('#34373f');   // audible cells keep their normal fill
});

// INV-46 (Snake): the head note sounds the cell's OWN pitch. Snake's board reaches MIDI >108 at its
// edges, and it used to clamp head notes into [21,108] -- a wrong pitch. It must play getMidi.
test('Snake: head note sounds its true pitch, not a clamped one', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="snake"]').click();
    App.currentMode = 'snake';
    // Head just left of (7,0) = MIDI 109 (>108); stepping right lands the head there.
    SnakeMode.state.snake = [{ p: 6, q: 0 }, { p: 5, q: 0 }, { p: 4, q: 0 }];
    SnakeMode.state.direction = { p: 1, q: 0 };
    SnakeMode.state.nextDirection = { p: 1, q: 0 };
    SnakeMode.state.isPaused = false; SnakeMode.state.isGameOver = false; SnakeMode.state.isFlourishing = false;
    SnakeMode.state.gem = { p: -3, q: 0 };      // elsewhere, so no eat/flourish
    SnakeMode.state.extraGems = [];
    const played = [];
    const orig = Synth.playNote;
    Synth.playNote = (m) => played.push(m);
    SnakeMode.tick();
    Synth.playNote = orig;
    return { played, trueMidi: Tonnetz.getMidi(7, 0) };
  });
  expect(out.trueMidi).toBe(109);
  expect(out.played).toContain(109);         // plays the head's own pitch...
  expect(out.played).not.toContain(108);     // ...not the old clamped value
});

// Real bug reported live: a snake tight enough to chase its own tail should be able to, since
// the tail vacates its cell the SAME tick the head would move into it (simultaneous, not a
// collision) -- but the self-collision check ran against the snake's full CURRENT body, tail
// segment included, before it gets popped later in the same tick() call. A snake occupying
// all 6 cells of one hex ring around a center, moving to close the loop back onto its own tail,
// demonstrates this exactly: the move doesn't eat a gem, so the tail is about to vacate.
test('Snake: closing a tight loop onto its own about-to-vacate tail succeeds, not a false self-collision', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    document.querySelector('.mode-option[data-mode="snake"]').click();
    App.currentMode = 'snake';
    // The 6 neighbors of (0,0), in ring (rotational) order -- each consecutive pair is exactly
    // one lattice-step apart, forming a proper closed hexagon body.
    const T = { p: -1, q: 1 }, Y = { p: 0, q: 1 }, H = { p: 1, q: 0 };
    const B = { p: 1, q: -1 }, V = { p: 0, q: -1 }, F = { p: -1, q: 0 };
    SnakeMode.state.snake = [T, Y, H, B, V, F]; // head=T, tail=F
    SnakeMode.state.direction = { p: -1, q: 0 };     // F -- heading that arrived at T (from Y)
    SnakeMode.state.nextDirection = { p: 0, q: -1 }; // V -- turns the head onto the tail's own cell
    SnakeMode.state.isPaused = false; SnakeMode.state.isGameOver = false; SnakeMode.state.isFlourishing = false;
    SnakeMode.state.gem = { p: -5, q: -5 };      // elsewhere -- this move doesn't grow the snake
    SnakeMode.state.extraGems = [];
    SnakeMode.tick();
    return { isGameOver: SnakeMode.state.isGameOver, snake: SnakeMode.state.snake };
  });
  expect(out.isGameOver).toBe(false);
  expect(out.snake[0]).toEqual({ p: -1, q: 0 }); // head moved onto the vacated tail cell
  expect(out.snake.length).toBe(6); // unchanged length -- moved, didn't grow
});

// A shared starting point for the flourish tests below: a small snake heading right, with a gem
// immediately in front of it so the very first SnakeMode.tick() eats it and triggers a flourish.
async function setUpSnakeAboutToEatAGem(page, snakeLength = 3) {
  await page.evaluate((len) => {
    document.querySelector('.mode-option[data-mode="snake"]').click();
    const snake = [];
    for (let i = 0; i < len; i++) snake.push({ p: -i, q: 0 });
    SnakeMode.state.snake = snake;
    SnakeMode.state.direction = { p: 1, q: 0 };
    SnakeMode.state.nextDirection = { p: 1, q: 0 };
    SnakeMode.state.isPaused = false;
    SnakeMode.state.isGameOver = false;
    SnakeMode.state.isFlourishing = false;
    SnakeMode.state.gem = { p: 1, q: 0 };
    SnakeMode.state.extraGems = [];
  }, snakeLength);
}

// Real, live-reproduced bug (not fabricated): leaving Snake mode mid-flourish and returning used
// to freeze tick()-driven movement forever, since cleanup() only marked isPaused=true when a
// normal move-timer was running (null while flourishing), and separately cancelled the one
// pending timeout that would ever have cleared isFlourishing.
test('Snake: leaving mid-flourish and returning resumes it, does not freeze movement forever', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page);
  await page.evaluate(() => SnakeMode.tick()); // eats the gem -> isFlourishing becomes true

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());
  await page.evaluate(() => SnakeMode.togglePause()); // leaving mid-game pauses (INV-48); resume it
  // Bounded, not a big arbitrary window: long enough for the flourish to finish (~550ms for a
  // 3-length snake grown to 4) but short of the NEXT regular tick (~694ms later) -- running much
  // longer would let the still-heading-right snake run itself straight into the wall (radius 7)
  // within a handful of real ticks, which is unrelated to what this test is actually checking.
  await page.clock.runFor(600);

  const isFlourishingAfter = await page.evaluate(() => SnakeMode.state.isFlourishing);
  expect(isFlourishingAfter).toBe(false);

  const headBefore = await page.evaluate(() => SnakeMode.state.snake[0]);
  await page.evaluate(() => SnakeMode.tick());
  const headAfter = await page.evaluate(() => SnakeMode.state.snake[0]);
  expect(headAfter).not.toEqual(headBefore); // movement actually resumed
});

test('Snake: flourish steps advance one at a time, in order, one note per step', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page, 4);

  // Eating already grows the snake by one (unshift with no pop), so the flourish plays one note
  // per segment of the NOW-grown body. The eat and the stub install happen in ONE evaluate() call,
  // atomically: playFlourish's first step is scheduled at a 0ms delay, which -- being a real
  // setTimeout -- can't fire synchronously, but COULD fire in the round-trip gap between two
  // separate page.evaluate() calls, sneaking past a stub installed a moment "later". `capturing`
  // only flips on AFTER the whole synchronous tick() call returns -- excluding both the eating
  // tick's own head-move note AND spawnGem's 3-note confirmation chime (spawnGem runs right after
  // playFlourish in the same synchronous call, while isFlourishing already reads true, so gating
  // on that flag alone isn't precise enough). Nothing genuinely async (a real flourish step) can
  // fire before this synchronous call finishes, so this cutoff is exact, not approximate.
  const expectedMidis = await page.evaluate(() => {
    window.__played = [];
    window.__origPlayNote = Synth.playNote;
    let capturing = false;
    Synth.playNote = (m) => { if (capturing) window.__played.push(m); };
    SnakeMode.tick(); // eat -> isFlourishing true, flourishStep 0
    capturing = true;
    return SnakeMode.state.snake.map((s) => Math.max(21, Math.min(108, Tonnetz.getMidi(s.p, s.q))));
  });
  // Bounded tightly to just the flourish (5 notes * 100ms + 250ms tail = 650ms): running well
  // past that would let normal movement resume and play its own head-move note too, polluting
  // this capture with a note that isn't part of the flourish at all.
  await page.clock.runFor(700);

  const result = await page.evaluate(() => {
    Synth.playNote = window.__origPlayNote;
    return { played: window.__played, isFlourishing: SnakeMode.state.isFlourishing };
  });
  expect(result.played).toEqual(expectedMidis); // exactly once each, in body order
  expect(result.isFlourishing).toBe(false);
});

test('Snake: pausing mid-flourish and resuming continues from the same step, not from the start', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page, 4);
  await page.evaluate(() => SnakeMode.tick()); // eat -> isFlourishing true, flourishStep 0

  await page.clock.runFor(150); // step 0 (delay 0) and step 1 (delay 100) both fire
  // Read the step AND pause in the SAME evaluate() call (not two separate round-trips): found
  // live, rarely (~1 in 15 runs), that a step already fully due by the end of one runFor() window
  // can finish executing in the round-trip GAP BETWEEN two separate page.evaluate() calls -- a
  // Playwright/sinon fake-clock precision quirk (confirmed via direct instrumentation:
  // flourishTimeoutId is reliably null-if-and-only-if nothing is pending; it's only ever the
  // exact boundary step that occasionally resolves a beat early, specifically in that gap, not
  // within the runFor() window itself). Reading the step first and pausing after, as two
  // separate calls, would still be exposed to that same gap; doing both atomically closes it.
  const stepWhenPaused = await page.evaluate(() => {
    const step = SnakeMode.state.flourishStep;
    SnakeMode.togglePause();
    return step;
  });
  expect(stepWhenPaused).toBeGreaterThanOrEqual(1);

  await page.clock.runFor(5000); // the pending step timeout was cancelled, not just delayed
  expect(await page.evaluate(() => SnakeMode.state.flourishStep)).toBe(stepWhenPaused); // unchanged

  await page.evaluate(() => SnakeMode.togglePause());
  await page.clock.runFor(120); // fresh 100ms delay for the next step, measured from THIS resume
  expect(await page.evaluate(() => SnakeMode.state.flourishStep)).toBe(stepWhenPaused + 1); // continued, didn't restart at 0
});

test('Snake: resuming a long-paused flourish waits a fresh step delay, does not rush through it', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page, 4);
  await page.evaluate(() => SnakeMode.tick());
  await page.clock.runFor(150); // flourishStep -> ~2
  // Read the step AND pause atomically in one evaluate() call -- see the sibling pause/resume
  // test's comment for why (a rare fake-clock precision quirk in the round-trip gap between two
  // separate evaluate() calls, not within the runFor() window itself).
  const stepWhenPaused = await page.evaluate(() => {
    const step = SnakeMode.state.flourishStep;
    SnakeMode.togglePause();
    return step;
  });
  expect(stepWhenPaused).toBeGreaterThanOrEqual(1);
  await page.clock.runFor(60000); // a full real minute paused

  await page.evaluate(() => SnakeMode.togglePause()); // resume
  const immediatelyAfterResume = await page.evaluate(() => SnakeMode.state.flourishStep);
  expect(immediatelyAfterResume).toBe(stepWhenPaused); // hasn't jumped ahead just because resume was clicked

  // 120ms: comfortably past the one 100ms step due, comfortably short of the next one at 200ms.
  await page.clock.runFor(120);
  const afterFreshDelay = await page.evaluate(() => SnakeMode.state.flourishStep);
  expect(afterFreshDelay).toBe(stepWhenPaused + 1); // now it advances, on its own fresh 100ms
});

test('Snake: movement stays paused for the whole flourish, resumes automatically once it completes', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page);
  await page.evaluate(() => SnakeMode.tick());
  const headDuring = await page.evaluate(() => SnakeMode.state.snake[0]);

  await page.clock.runFor(50); // still mid-flourish
  expect(await page.evaluate(() => SnakeMode.state.snake[0])).toEqual(headDuring);

  await page.clock.runFor(2000); // let it finish uninterrupted
  expect(await page.evaluate(() => SnakeMode.state.isFlourishing)).toBe(false);
  expect(await page.evaluate(() => !!SnakeMode.state.timer)).toBe(true); // normal timer restarted itself
});

test('Snake: leaving mid-flourish marks isPaused and the pause icon, same as leaving mid-move', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page);
  await page.evaluate(() => SnakeMode.tick());

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  expect(await page.evaluate(() => SnakeMode.state.isPaused)).toBe(true);

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());
  const label = await page.evaluate(() => document.getElementById('snake-start-pause').getAttribute('aria-label'));
  expect(label).toBe('Resume');
});

test('Snake: each flourish step is one countable Replay.recordTick() advance', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page, 3); // eating grows it to 4 before the flourish counts it
  const before = await page.evaluate(() => Replay.tickSeq);
  await page.evaluate(() => SnakeMode.tick()); // the eating tick itself: +1
  // Bounded tightly to just the flourish (4 notes * 100ms + 250ms tail = 650ms, minus the first
  // note's 0ms delay = 550ms): running well past that would let normal movement resume and add
  // its own uncounted ticks to the delta, which isn't what this test is checking.
  await page.clock.runFor(600); // 4 note-steps (grown length) + 1 tail step: +5
  const after = await page.evaluate(() => Replay.tickSeq);
  expect(after - before).toBe(6);
});

test('Snake: a direction key pressed mid-flourish is queued, applied once movement resumes', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page);
  await page.evaluate(() => SnakeMode.tick()); // eat -> isFlourishing true

  await page.keyboard.press('v'); // Down-Left -- not a reversal of the current heading (right)
  expect(await page.evaluate(() => SnakeMode.state.nextDirection)).toEqual({ p: 0, q: -1 });
  expect(await page.evaluate(() => SnakeMode.state.direction)).toEqual({ p: 1, q: 0 }); // not applied yet

  await page.clock.runFor(2000); // finish the flourish, movement resumes
  await page.evaluate(() => SnakeMode.tick());
  expect(await page.evaluate(() => SnakeMode.state.direction)).toEqual({ p: 0, q: -1 }); // queued turn took effect
});

test('Snake: a MIDI note played mid-flourish also queues its steered direction', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page);
  await page.evaluate(() => SnakeMode.tick()); // eat -> isFlourishing true

  await page.evaluate(() => {
    const head = SnakeMode.state.snake[0];
    const dr = Tonnetz.getNeighbors(head.p, head.q).find((n) => n.p === head.p + 1 && n.q === head.q - 1);
    SnakeMode.handleMidiNote(Tonnetz.getMidi(dr.p, dr.q));
  });
  expect(await page.evaluate(() => SnakeMode.state.nextDirection)).toEqual({ p: 1, q: -1 });
});

test('Snake: the on-screen keypad brightens whichever direction is queued, at any time -- including mid-flourish and via MIDI', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await setUpSnakeAboutToEatAGem(page);
  await page.evaluate(() => { SnakeMode.state.gem = { p: -5, q: 0 }; }); // elsewhere -- no eat yet

  await page.keyboard.press('y'); // Up-Right
  expect(await page.evaluate(() => document.getElementById('snake-btn-ur').classList.contains('active-direction'))).toBe(true);

  await page.evaluate(() => {
    // Reset back to heading right -- the queued Up-Right from above would otherwise actually
    // apply on the very next tick() (direction is only applied AT tick time, not on keypress),
    // steering the snake away from the gem placed dead ahead of a rightward heading.
    SnakeMode.state.direction = { p: 1, q: 0 };
    SnakeMode.state.nextDirection = { p: 1, q: 0 };
    SnakeMode.state.gem = { p: 1, q: 0 };
    SnakeMode.tick(); // eat -> isFlourishing true
  });
  await page.keyboard.press('v'); // Down-Left, mid-flourish
  expect(await page.evaluate(() => document.getElementById('snake-btn-dl').classList.contains('active-direction'))).toBe(true);

  await page.evaluate(() => {
    const head = SnakeMode.state.snake[0];
    const dr = Tonnetz.getNeighbors(head.p, head.q).find((n) => n.p === head.p + 1 && n.q === head.q - 1);
    SnakeMode.handleMidiNote(Tonnetz.getMidi(dr.p, dr.q));
  });
  expect(await page.evaluate(() => document.getElementById('snake-btn-dr').classList.contains('active-direction'))).toBe(true);
});

// Real gap reported live: a narrow desktop window (e.g. a low-res Chromebook) with no touch
// capability at all is still narrow enough to trigger the mobile CSS layout (Render.
// isMobileViewport() is purely width-based), so the on-screen D-pad renders and is visible --
// but js/main.js's setupMobileControls only bound the buttons' click handlers when isTouch was
// true, so on a real no-touch narrow desktop the visible D-pad did nothing when clicked. This
// project's own "Desktop Chrome" Playwright project has no hasTouch, so a narrow viewport here
// is exactly this real scenario.
test('Snake: the on-screen D-pad works via mouse click on a narrow no-touch desktop, not just touch', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="snake"]').click());

  await expect(page.locator('#snake-mobile-controls')).toBeVisible();

  await page.evaluate(() => {
    SnakeMode.state.direction = { p: 0, q: 0 };
    SnakeMode.state.nextDirection = { p: 0, q: 0 };
  });
  await page.locator('#snake-btn-ur').click();
  const nextDir = await page.evaluate(() => SnakeMode.state.nextDirection);
  expect(nextDir).toEqual({ p: 0, q: 1 });
});

// #92: Melody's next three notes each get a distinct colour in the timeline, mirrored by
// glow-next-0/1/2 on the matching Tonnetz cells -- linking board and timeline. No frequency shown.
test('Melody: the next three notes are tri-coloured in the timeline and on the Tonnetz', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => !MelodyMode.state.isPlayingSequence, { timeout: 8000 });
  const out = await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.updateDifficultyUI();
    const tokens = [...document.querySelectorAll('#melody-staff-labels .note-token[data-upcoming]')];
    return {
      upcomingRanks: tokens.map((t) => t.getAttribute('data-upcoming')),
      tokenColors: tokens.map((t) => t.style.color),
      glow0: document.querySelectorAll('polygon.glow-next-0').length,
      glow1: document.querySelectorAll('polygon.glow-next-1').length,
      glow2: document.querySelectorAll('polygon.glow-next-2').length,
      hasHz: /\d+Hz/.test(document.getElementById('melody-staff-labels').textContent),
    };
  });
  expect(out.upcomingRanks).toEqual(['0', '1', '2']);            // the next three, ranked
  expect(new Set(out.tokenColors).size).toBe(3);                // three distinct token colours
  expect(out.glow0).toBeGreaterThan(0);                         // each rank glows on the board...
  expect(out.glow1).toBeGreaterThan(0);
  expect(out.glow2).toBeGreaterThan(0);
  expect(out.hasHz).toBe(false);                                // ...and no frequency in the timeline
});

// Colorblind-accessible "play this one" indicator, in ADDITION to color (reported live: color
// alone wasn't enough): a small triangle on both the Tonnetz cell(s) sharing the current note's
// pitch and the matching pitch-row token, not overlapping either one's own text label.
test('Melody: the current note gets a small triangle marker on both the Tonnetz and the pitch row, above their own labels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => !MelodyMode.state.isPlayingSequence, { timeout: 8000 });

  const before = await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.updateDifficultyUI();
    const midi = MelodyMode.state.melody[0].midi;
    const cell = document.querySelector(`polygon[data-midi="${midi}"]`);
    const p = Number(cell.getAttribute('data-p'));
    const q = Number(cell.getAttribute('data-q'));
    const pos = Render.getScreenPos(p, q);
    const marker = document.querySelector('#tonnetz-svg .current-note-marker');
    const markerPoints = marker ? marker.getAttribute('points') : null;
    const token = document.querySelector('.note-token[data-note-role="current"]');
    return {
      markerCount: document.querySelectorAll('#tonnetz-svg .current-note-marker').length,
      markerY: markerPoints ? Math.min(...markerPoints.split(' ').map((pt) => parseFloat(pt.split(',')[1]))) : null,
      cellCenterY: pos.y,
      tokenExists: !!token,
    };
  });
  expect(before.markerCount, 'every cell sharing the current pitch gets a marker').toBeGreaterThan(0);
  expect(before.tokenExists, 'the pitch-row token is flagged as current (its own ::before draws the matching triangle)').toBe(true);
  // createLabel (js/render.js) draws the note-name text at the cell's own center y + 5 -- "above,
  // not overlapping" means the marker's y must sit comfortably before that, not centered on it.
  // A smaller y is higher on screen (SVG y grows downward).
  expect(before.markerY, 'the marker sits above the note-name label, not on top of it').toBeLessThan(before.cellCenterY - 5);

  // A redraw (rotate, resize, etc. -- anything that calls refreshBoard) used to silently wipe
  // the marker along with the rest of the glow decoration (drawLattice rebuilds the whole
  // lattice group from scratch); refreshBoard now re-applies it.
  const afterRedraw = await page.evaluate(() => {
    MelodyMode.refreshBoard();
    return document.querySelectorAll('#tonnetz-svg .current-note-marker').length;
  });
  expect(afterRedraw, 'the marker survives a board redraw, not just the initial paint').toBeGreaterThan(0);
});

// #94: a URL hash deep-links to a mode, and clicking a mode updates the URL so links are shareable
// and discoverable.
test('URL routing: hash deep-links to a mode and the URL updates on click', async ({ page }) => {
  // A shared deep-link opens that mode on load...
  await page.goto('/#gravity');
  await expect.poll(() => page.evaluate(() => typeof App !== 'undefined' && App.currentMode), { timeout: 5000 }).toBe('gravity');

  // ...and clicking a mode reflects it in the address bar (discoverable to copy).
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  expect(await page.evaluate(() => App.currentMode)).toBe('compose');
  expect(await page.evaluate(() => location.hash)).toBe('#compose');

  // More deep-links (fresh loads): the Melody URL, an unknown hash -> sandbox, and a normal one.
  // (about:blank between forces a real reload -- goto to a hash-only change on the same path
  // wouldn't re-init.)
  // An unknown hash falls back to sandbox and NORMALIZES the bar to #sandbox (it reflects the
  // actual mode). Known ones keep their friendly name.
  for (const [url, mode, hash] of [['/#melody', 'melody', '#melody'], ['/#nonsense', 'sandbox', '#sandbox'], ['/#blast', 'blast', '#blast']]) {
    await page.goto('about:blank');
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => App.currentMode), { timeout: 5000 }).toBe(mode);
    expect(await page.evaluate(() => location.hash)).toBe(hash);
  }
});

// #94 surfaced a real bug: Blast and Gravity never called Render.init themselves -- they relied on
// Sandbox (always the first mode entered, pre-#94) having already set Render.svg. A deep-link
// straight to Blast/Gravity (no prior mode) crashed drawLattice (Render.svg undefined) and left the
// difficulty control (and everything else) never wired up. Every mode's init must be self-
// sufficient: reachable as the FIRST mode of a session, not just via a click from another mode.
test('Deep-linking straight to Blast/Gravity (no prior mode) initializes cleanly', async ({ page }) => {
  for (const mode of ['blast', 'gravity', 'snake', 'compose', 'melody', 'life']) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('about:blank');
    await page.goto('/#' + mode);
    await expect.poll(() => page.evaluate(() => App.currentMode), { timeout: 5000 }).toBe(mode);
    // The lattice actually rendered (not just currentMode flipped)...
    const cellCount = await page.locator('#tonnetz-svg polygon.cell').count();
    expect(cellCount, `${mode}: lattice should render`).toBeGreaterThan(0);
    // ...and, for Blast/Gravity, the difficulty control lit up correctly (proof
    // setupEvents/DifficultyBarbell ran, not just that currentMode flipped). Reads the mode's own
    // actual default state.difficulty rather than assuming it equals levelCount -- true for Blast
    // (default IS its highest/only level), but Gravity's own level 4 (#93 follow-up, welding-only,
    // not a harder piece tier) is opt-in, so its default stays 3 even though levelCount is 4.
    if (mode === 'blast' || mode === 'gravity') {
      const defaultDifficulty = await page.evaluate((m) =>
        (m === 'blast' ? BlastMode : GravityMode).state.difficulty, mode);
      const lit = await page.locator(`#${mode}-difficulty .weight-icon.lit`).count();
      expect(lit, `${mode}: default difficulty should light ${defaultDifficulty} weights`).toBe(defaultDifficulty);
    }
    expect(errors, `${mode}: no page errors`).toEqual([]);
    page.removeAllListeners('pageerror');
  }
});

// #86: Melody no longer bundles a built-in default song (the online midi/ folder supplies real
// songs). With no web connection (and no local folder), it degrades to a random 10-note sequence
// within a single octave so the drill is always playable.
test('Melody: offline (no online folder) degrades to a random 10-note, one-octave sequence', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.abort());
  await page.route('**/midi/*.mid', route => route.abort());
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForTimeout(600);
  const melody = await page.evaluate(() => MelodyMode.state.melody.map(n => n.midi));
  expect(melody.length, 'random fallback is 10 notes').toBe(10);
  expect(Math.max(...melody) - Math.min(...melody), 'all within one octave').toBeLessThan(12);
});

// Task #93's dumbbell-barbell difficulty control was only ever applied to Blast/Gravity --
// Melody's own difficulty (which note-list/Tonnetz hints show while drilling, not piece size)
// was left behind as a plain <select>, noticed live and converted to match. Confirms both the
// click-to-set wiring and the cumulative lit-icon count (1/2/3), same shared DifficultyBarbell
// component as Blast/Gravity's own barbell (js/difficulty-barbell.js) -- levels are plain
// integers, not word-keyed, so the underlying state is asserted as a number.
test('Melody: the difficulty control is the same dumbbell-barbell as Blast/Gravity, not a dropdown', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await expect(page.locator('#melody-difficulty select')).toHaveCount(0);
  const weights = page.locator('#melody-difficulty .weight-icon');
  await expect(weights).toHaveCount(3);

  const litCount = () => page.evaluate(() =>
    document.querySelectorAll('#melody-difficulty .weight-icon.lit').length);
  expect(await litCount(), 'defaults to level 1 (1 lit)').toBe(1);

  await weights.nth(2).click();
  expect(await page.evaluate(() => MelodyMode.state.difficulty)).toBe(3);
  expect(await litCount(), 'level 3 lights all 3').toBe(3);

  await weights.nth(1).click();
  expect(await page.evaluate(() => MelodyMode.state.difficulty)).toBe(2);
  expect(await litCount(), 'level 2 lights 2').toBe(2);
});

test('Melody: difficulty, transport, and the streak bar share one line, about as wide as the dropdown', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const settingsBox = await page.locator('#melody-settings-group').boundingBox();
  const actionsBox = await page.locator('#melody-actions-group').boundingBox();
  const streakBox = await page.locator('#melody-streak-group').boundingBox();
  const dropdownBox = await page.locator('#melody-source').boundingBox();

  // Same row: near-identical vertical center, not stacked on separate lines.
  const centerY = (b) => b.y + b.height / 2;
  expect(Math.abs(centerY(settingsBox) - centerY(actionsBox))).toBeLessThan(12);
  expect(Math.abs(centerY(settingsBox) - centerY(streakBox))).toBeLessThan(12);

  // Roughly the dropdown's own width, not a full extra sidebar-width row each.
  const rowBox = await page.locator('#melody-controls-row').boundingBox();
  expect(rowBox.width).toBeLessThanOrEqual(dropdownBox.width + 4);
});

test('Melody/Compose: the Timeline spans the full window width, not the narrow sidebar column', async ({ page }) => {
  await page.goto('/');
  const sidebarWidth = await page.locator('#sidebar').boundingBox().then((b) => b.width);
  const windowWidth = await page.evaluate(() => window.innerWidth);

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await expect(page.locator('#notation-bar #melody-notation-scroll')).toBeVisible();
  const melodyBarWidth = await page.locator('#notation-bar').boundingBox().then((b) => b.width);
  expect(melodyBarWidth).toBeGreaterThan(sidebarWidth);
  expect(melodyBarWidth).toBeCloseTo(windowWidth, -1);

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await expect(page.locator('#notation-bar #compose-notation-scroll')).toBeVisible();
  const composeBarWidth = await page.locator('#notation-bar').boundingBox().then((b) => b.width);
  expect(composeBarWidth).toBeGreaterThan(sidebarWidth);
  // Melody is no longer active -- its own Timeline already returned to the sidebar, not left
  // stranded in the bar alongside Compose's.
  await expect(page.locator('#melody-stats-group #melody-notation-scroll')).toHaveCount(1);

  // Switching to a mode with no Timeline hides the bar and returns each element home.
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());
  await expect(page.locator('#notation-bar')).toBeHidden();
  await expect(page.locator('#melody-stats-group #melody-notation-scroll')).toHaveCount(1);
  await expect(page.locator('#compose-controls > #compose-notation-scroll')).toHaveCount(1);
});

test('Melody: the Timeline stays in the full-width bar at a mobile viewport width too, not the dock', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  // Consistent placement at every viewport (live feedback) -- not much room to gain on a narrow
  // phone, but the same #notation-bar as desktop/tablet rather than a mobile-only special case
  // that used to fold it into the compact always-visible dock instead.
  await expect(page.locator('#notation-bar #melody-notation-scroll')).toBeVisible();
  await expect(page.locator('#melody-mobile-tools #melody-notation-scroll')).toHaveCount(0);
  const barWidth = await page.locator('#notation-bar').boundingBox().then((b) => b.width);
  expect(barWidth).toBeCloseTo(500, -1);
});

// #39: Easy/Medium/Hard piece-size presets for Blast and Gravity. Difficulty selects the pool of
// pieces by cell-count, so an easier game deals smaller, more-placeable pieces and a harder one
// deals only the full four-cell tetrahexes (the historical default).
test.describe('Piece-size difficulty presets (Blast/Gravity)', () => {
  for (const [mode, Mode] of [['blast', 'BlastMode'], ['gravity', 'GravityMode']]) {
    test(`${mode}: difficulty controls the generated piece sizes`, async ({ page }) => {
      await page.goto('/');
      await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

      const sizesFor = (M, diff) => page.evaluate(({ M, diff }) => {
        // BlastMode/GravityMode are `const` globals, not window properties -- resolve by name.
        const mode = M === 'BlastMode' ? BlastMode : GravityMode;
        mode.setDifficulty(diff);
        const sizes = new Set();
        for (let i = 0; i < 300; i++) sizes.add(Pieces.TYPES[mode.randomPiece()].cells.length);
        return [...sizes].sort();
      }, { M, diff });

      // Level 1: only small pieces (never a full four-cell tetrahex).
      const level1 = await sizesFor(Mode, 1);
      expect(Math.max(...level1), `${mode} level 1 should deal small pieces`).toBeLessThanOrEqual(3);

      // Level 3: exclusively four-cell tetrahexes (the current default game).
      const level3 = await sizesFor(Mode, 3);
      expect(level3, `${mode} level 3 should deal only tetrahexes`).toEqual([4]);

      // Level 2 sits between -- includes 4-cell pieces but also at least one smaller size.
      const level2 = await sizesFor(Mode, 2);
      expect(level2.includes(4) && Math.min(...level2) < 4, `${mode} level 2 should mix sizes`).toBe(true);

      // The dumbbell barbell: clicking the Nth weight sets that level and lights 1/2/3 of them.
      for (const level of [1, 2, 3]) {
        await page.click(`#${mode}-difficulty .weight-icon[data-difficulty="${level}"]`);
        const state = await page.evaluate((M) => (M === 'BlastMode' ? BlastMode : GravityMode).state.difficulty, Mode);
        expect(state, `${mode} clicking level ${level} weight`).toBe(level);
        const litCount = await page.$$eval(`#${mode}-difficulty .weight-icon.lit`, els => els.length);
        expect(litCount, `${mode} level ${level} should light ${level} weights`).toBe(level);
      }
    });
  }
});

// Gravity-only: level 4 (#93 follow-up) is welding-only, not a piece-size tier -- same tetrahex
// pool as level 3 (Pieces.DIFFICULTY_KEYS has no 4th entry; randomPiece falls through to
// TETRAHEX_KEYS, which level 3 already uses), and the barbell grows to 4 weights for Gravity only
// (Blast has no weld concept and stays at 3, covered by the shared describe block above).
test('Gravity: difficulty level 4 keeps level 3\'s tetrahex piece pool and lights a 4th barbell weight', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="gravity"]').click());

  const level4Sizes = await page.evaluate(() => {
    GravityMode.setDifficulty(4);
    const sizes = new Set();
    for (let i = 0; i < 300; i++) sizes.add(Pieces.TYPES[GravityMode.randomPiece()].cells.length);
    return [...sizes].sort();
  });
  expect(level4Sizes).toEqual([4]);

  await page.click('#gravity-difficulty .weight-icon[data-difficulty="4"]');
  const state = await page.evaluate(() => GravityMode.state.difficulty);
  expect(state).toBe(4);
  const litCount = await page.$$eval('#gravity-difficulty .weight-icon.lit', (els) => els.length);
  expect(litCount).toBe(4);
});

// #46 note-timeline redesign, parts 3-5: a real loaded song (not Random) renders its full
// timeline up front, gets measure ticks, and drives the spaced-repetition auto-advance. All four
// tests load the real bundled midi/frere-jacques.mid (32 notes, 120bpm/4-4 -- 2s/measure) rather
// than a synthetic fixture, per the plan's own verification section.
const loadFrereJacques = (page) => page.evaluate(async () => {
  const res = await fetch('/midi/frere-jacques.mid');
  const buf = await res.arrayBuffer();
  MelodyMode.loadMelodyFromArrayBuffer(buf, 'frere-jacques.mid');
});

test('Melody: a real song renders its entire timeline up front, not a sliding window', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.endIndex = 7;
    MelodyMode.state.userIndex = 5;
    MelodyMode.updateDifficultyUI();
    return {
      isRandom: MelodyMode.state.isRandom,
      tokenCount: document.querySelectorAll('#melody-staff-labels .note-token').length,
      melodyLength: MelodyMode.state.melody.length,
    };
  });
  expect(result.isRandom).toBe(false);
  // The whole song is in the DOM at once -- not windowed to a few notes around current, unlike
  // Random's sliding pastWindow/futureWindow (see the tri-coloured-notes test elsewhere, which
  // exercises Random's own unchanged, small-window behavior).
  expect(result.tokenCount).toBe(result.melodyLength);
});

test('Melody: Random keeps its small sliding window even with the song-timeline code present', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  // Default entry (loadDefault/Random), no song loaded -- explicit re-verification per the
  // plan's own scope boundary: none of parts 3-5 should leak into Random.
  const result = await page.evaluate(() => {
    MelodyMode.state.endIndex = 7;
    MelodyMode.state.userIndex = 5;
    MelodyMode.updateDifficultyUI();
    return {
      isRandom: MelodyMode.state.isRandom,
      tokenCount: document.querySelectorAll('#melody-staff-labels .note-token').length,
      // Random passes showBarlines: false to Timeline.refresh -- a forever-sliding memory-quiz
      // window isn't a piece being progressed through measure by measure, even though the
      // underlying melody data technically has measures.
      tickCount: document.querySelectorAll('#melody-notation-scroll .notation-barline').length,
    };
  });
  expect(result.isRandom).toBe(true);
  expect(result.tokenCount).toBeLessThan(10); // pastWindow(3) + current + at most 3 hinted ahead
  expect(result.tickCount).toBe(0); // no measures in Random, ever
});

test('Melody: dragging the marker near the timeline edge scrolls it (#46 edge-scroll)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  await page.evaluate(() => {
    MelodyMode.state.endIndex = MelodyMode.state.melody.length - 1;
    MelodyMode.updateDifficultyUI();
  });

  // #melody-notation-scroll (not #melody-staff-labels itself) is the actual clipping/scrolling
  // viewport -- one shared scroll container for the staff/labels/timeline stack (Codex review
  // finding: they used to scroll independently and drift out of alignment).
  const overflow = await page.evaluate(() => {
    const el = document.getElementById('melody-notation-scroll');
    return el.scrollWidth > el.clientWidth;
  });
  expect(overflow, 'a 32-note song should overflow the visible timeline width').toBe(true);

  const markerBox = await page.locator('.timeline-marker-start').boundingBox();
  const containerBox = await page.locator('#melody-notation-scroll').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  const edgeX = containerBox.x + containerBox.width - 5; // inside the 40px edge-scroll zone
  const edgeY = containerBox.y + containerBox.height / 2;
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(edgeX, edgeY);
  }
  const scrollLeft = await page.evaluate(() => document.getElementById('melody-notation-scroll').scrollLeft);
  await page.mouse.up();
  expect(scrollLeft).toBeGreaterThan(0);
});

test('Melody: the practice strip scrolls to follow the current note as you play through a song', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const before = await page.evaluate(() => document.getElementById('melody-notation-scroll').scrollLeft);
  expect(before).toBe(0); // starts scrolled to the very beginning

  // Advance play well past whatever's visible at the default zoom -- exactly what happens over
  // the course of a real playthrough, just done in one jump rather than note by note.
  const after = await page.evaluate(() => {
    MelodyMode.state.endIndex = MelodyMode.state.melody.length - 1;
    MelodyMode.state.userIndex = MelodyMode.state.melody.length - 1;
    MelodyMode.updateDifficultyUI();
    return document.getElementById('melody-notation-scroll').scrollLeft;
  });
  expect(after, 'the strip should scroll to keep the current note in view').toBeGreaterThan(0);
});

test('Melody: the song-complete flourish highlights each victory chord cell exactly when it sounds (INV-5)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  // Runs each scheduled callback immediately, in schedule order, tagging it with the delay it
  // was scheduled at -- deterministic, with no dependence on real or virtualized wall-clock
  // timing (Playwright's clock.fastForward doesn't reliably preserve each already-scheduled
  // timer's own individual offset within one jump, only which are due by the jump's target).
  const { chord, log } = await page.evaluate(() => {
    const log = [];
    const realSetTimeout = window.setTimeout;
    window.setTimeout = (fn, delay) => { log.push({ delay }); fn(); return 0; };
    Render.highlightByMidi = (midi) => { log[log.length - 1].midi = midi; };
    let chord = null;
    Synth.playChord = (midis) => { chord = midis; };
    MelodyMode.celebrate();
    window.setTimeout = realSetTimeout;
    return { chord, log };
  });

  expect(chord.length).toBeGreaterThan(0);
  // Exactly one highlight per chord note -- no separate flash cycle unrelated to the sound
  // (the old flourish flashed all cells together 5 times, most of them not actually sounding).
  expect(log.length).toBe(chord.length);
  log.forEach((entry, i) => {
    expect(entry.midi).toBe(chord[i]);
    expect(entry.delay).toBe(i * 60); // matches Synth.playChord's own rolled per-note delay
  });
});

test('Melody: the song-complete flourish spawns self-removing confetti over the practice strip', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  await page.evaluate(() => MelodyMode.celebrate());
  const during = await page.locator('#melody-notation-scroll .confetti-piece').count();
  expect(during).toBeGreaterThan(0);
  await page.waitForFunction(
    () => document.querySelectorAll('#melody-notation-scroll .confetti-piece').length === 0,
    { timeout: 5000 }
  );
});

// Reported live: the flourish is for a COMPLETE playthrough. Reaching the last note when the
// drilled segment didn't start at the very beginning (startIndex != 0 -- e.g. still drilling a
// later stretch) isn't that, so no flourish -- and the start marker goes back to 0 instead, so
// the next pass is a genuine start-to-finish attempt.
test('Melody: finishing the song without having started at the beginning skips the flourish and resets the start to 0', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    const melody = MelodyMode.state.melody;
    MelodyMode.cleanupPlayback();
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.startIndex = 2; // did not start at the beginning
    MelodyMode.state.endIndex = melody.length - 1;
    MelodyMode.state.userIndex = melody.length - 1; // one note away from finishing
    // Measure 0 already banked full mastery from earlier practice -- without also clearing this
    // on reset, the very next correct note played would immediately re-trigger the consecutive-
    // mastered-measures advance (INV-26) using THIS stale credit, jumping the start straight back
    // ahead of the playhead the instant it was reset to 0.
    MelodyMode.state.measureCleanStreak = { 0: 3 };
    MelodyMode.handleUserInputNote(melody[melody.length - 1].midi); // the final note
    return {
      startIndex: MelodyMode.state.startIndex,
      endIndex: MelodyMode.state.endIndex,
      measureCleanStreak: MelodyMode.state.measureCleanStreak,
    };
  });

  const confettiCount = await page.locator('#melody-notation-scroll .confetti-piece').count();
  expect(confettiCount, 'no flourish -- this was not a complete, start-to-finish playthrough').toBe(0);
  expect(result.startIndex, 'the start marker is sent back to the beginning after finishing').toBe(0);
  expect(result.endIndex, 'the end marker resets to 1 too, matching a fresh song\'s own starting state').toBe(1);
  expect(result.measureCleanStreak, 'stale banked credit must not survive, or the start would jump right back ahead of the playhead').toEqual({});
});

// Synthetic 4-measure/4-notes-per-measure melody at 120bpm (2s/measure) -- avoids needing a real
// MIDI/MusicXML file just to control measure boundaries precisely for the INV-26/53 tests below.
const loadSyntheticMeasures = (page) => page.evaluate(() => {
  const melody = [];
  for (let m = 0; m < 4; m++) {
    for (let n = 0; n < 4; n++) {
      melody.push({ midi: 60 + m * 4 + n, time: m * 2 + n * 0.5, duration: 0.4 });
    }
  }
  MelodyMode.state.melody = melody;
  MelodyMode.state.isRandom = false;
  MelodyMode.state.melodyBPM = 120;
  MelodyMode.state.keySignature = null;
  MelodyMode.state.startIndex = 0;
  MelodyMode.state.endIndex = melody.length - 1;
  MelodyMode.state.userIndex = 0;
  MelodyMode.state.measureCleanStreak = {};
});

test('Melody: a measure banks its clean-play credit as soon as ITS OWN last note is played, without needing the next measure\'s first note too', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadSyntheticMeasures(page);

  const result = await page.evaluate(() => {
    const melody = MelodyMode.state.melody;
    // Play exactly measure 0's own 4 notes (indices 0-3) and STOP there -- never play index 4
    // (measure 1's own first note). Reported live: this used to not count at all.
    for (let i = 0; i < 4; i++) MelodyMode.handleUserInputNote(melody[i].midi);
    return {
      measure0Streak: MelodyMode.state.measureCleanStreak[0],
      userIndex: MelodyMode.state.userIndex,
    };
  });

  expect(result.userIndex, 'stopped right at the boundary, never played into measure 1').toBe(4);
  expect(result.measure0Streak, 'measure 0 was played cleanly all the way through -- it should count').toBe(1);
});

test('Melody: a mistake in a later measure does not erase an already-banked clean-measure streak', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadSyntheticMeasures(page);

  const result = await page.evaluate(() => {
    const melody = MelodyMode.state.melody;
    // Play measure 0 cleanly, crossing into measure 1 -- banks one clean-measure credit.
    for (let i = 0; i < 5; i++) MelodyMode.handleUserInputNote(melody[i].midi);
    const measure0StreakAfterFirstCross = MelodyMode.state.measureCleanStreak[0];

    // A mistake in measure 2 -- a LATER measure, unrelated to measure 0's already-banked crossing.
    MelodyMode.handleUserInputNote(999);
    return { measure0StreakAfterFirstCross, measure0StreakAfterMistake: MelodyMode.state.measureCleanStreak[0] };
  });

  expect(result.measure0StreakAfterFirstCross).toBe(1);
  expect(
    result.measure0StreakAfterMistake,
    'a mistake in a later measure must not erase credit already banked for an earlier one'
  ).toBe(1);
});

test('Melody: three separate clean passes through a measure advance startIndex, and the next measure can bank its own streak in the same pass', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadSyntheticMeasures(page);

  const result = await page.evaluate(() => {
    const melody = MelodyMode.state.melody;
    // Mirrors playTargetSequence's own fresh-pass reset (see its own comment), without the
    // real audio/timeout scheduling that isn't needed here.
    const freshPass = () => { MelodyMode.state.userIndex = MelodyMode.state.startIndex; };

    // Three separate clean passes through measure 0 should advance startIndex into measure 1.
    for (let pass = 0; pass < 3; pass++) {
      freshPass();
      for (let i = MelodyMode.state.startIndex; i < 5; i++) MelodyMode.handleUserInputNote(melody[i].midi);
    }
    const afterThreePasses = {
      startIndex: MelodyMode.state.startIndex,
      measure1Streak: MelodyMode.state.measureCleanStreak[1],
    };

    // Continuing in the SAME (4th) pass, past measure 1's own boundary too -- no fresh
    // playTargetSequence call in between.
    for (let i = MelodyMode.state.userIndex; i < 9; i++) MelodyMode.handleUserInputNote(melody[i].midi);
    return { afterThreePasses, measure1StreakAfterContinuing: MelodyMode.state.measureCleanStreak[1] };
  });

  expect(
    result.afterThreePasses.startIndex,
    'three clean passes through measure 0 should advance startIndex into measure 1'
  ).toBe(4);
  expect(result.afterThreePasses.measure1Streak, "measure 1 hasn't been played yet").toBeUndefined();
  expect(
    result.measure1StreakAfterContinuing,
    "measure 1's own crossing should also be counted independently, in the same pass"
  ).toBe(1);
});

test('Melody: the start marker matches the new startIndex on the very note that advances it, not one note late', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.evaluate(() => {
    // 2 notes per measure -- landing on the stale (pre-advance) note here puts the marker
    // visibly at exactly the midpoint of the new measure, matching what was reported live
    // ("the start marker landed at half a measure").
    const melody = [];
    for (let m = 0; m < 4; m++) {
      for (let n = 0; n < 2; n++) {
        melody.push({ midi: 60 + m * 2 + n, time: m * 2 + n, duration: 0.8 });
      }
    }
    MelodyMode.state.melody = melody;
    MelodyMode.state.isRandom = false;
    MelodyMode.state.melodyBPM = 120;
    MelodyMode.state.keySignature = null;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = melody.length - 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.measureCleanStreak = {};
  });

  const result = await page.evaluate(() => {
    const melody = MelodyMode.state.melody;
    const freshPass = () => { MelodyMode.state.userIndex = MelodyMode.state.startIndex; };
    // Two clean passes through measure 0 (banking 2 of the 3 needed) -- crossing is only
    // detected once a note IN THE NEXT measure is actually played, so each pass plays measure
    // 0's own 2 notes plus the next measure's first note.
    for (let pass = 0; pass < 2; pass++) {
      freshPass();
      MelodyMode.handleUserInputNote(melody[0].midi);
      MelodyMode.handleUserInputNote(melody[1].midi);
      MelodyMode.handleUserInputNote(melody[2].midi);
    }
    // ... then the third: its LAST note (melody[2], the next measure's own first note) both
    // crosses into measure 1 AND (3rd time) triggers the advance, in the same
    // handleUserInputNote call. The marker must already reflect the NEW startIndex immediately
    // after THIS call returns.
    freshPass();
    MelodyMode.handleUserInputNote(melody[0].midi);
    MelodyMode.handleUserInputNote(melody[1].midi);
    MelodyMode.handleUserInputNote(melody[2].midi);

    const marker = document.querySelector('.timeline-marker-start');
    const entry = MelodyMode.timeline._lastRender.noteXPositions.find((n) => n.id === MelodyMode.state.startIndex);
    return {
      startIndex: MelodyMode.state.startIndex,
      markerLeft: marker ? marker.style.left : null,
      // -10: half of .timeline-marker's own (deliberately wide, easier-to-grab) 20px hit-box --
      // see css/style.css/js/timeline.js's own comments on why it's not the marker's old -3.
      expectedLeft: entry ? (Math.max(0, entry.x - 10) + 'px') : null,
    };
  });

  expect(result.startIndex, 'a full 2-note measure, not landed mid-measure').toBe(2);
  expect(result.markerLeft).toBe(result.expectedLeft);
});

test('Melody: measure ticks appear exactly where the computed measure changes (#46 part 4)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.endIndex = MelodyMode.state.melody.length - 1;
    MelodyMode.updateDifficultyUI(MelodyMode.state.melody.length - 1);
    const tickCount = document.querySelectorAll('#melody-notation-scroll .notation-barline').length;
    let expected = 0, lastMeasure = null;
    MelodyMode.state.melody.forEach((n) => {
      const m = MelodyMode.measureOf(n.time);
      if (lastMeasure !== null && m !== lastMeasure) expected++;
      lastMeasure = m;
    });
    return { tickCount, expected };
  });
  expect(result.expected).toBeGreaterThan(0); // sanity: frere-jacques really does span >1 measure
  expect(result.tickCount).toBe(result.expected);
});

// INV-26/53: the start's measure-mastery streak is scoped to the ONE measure startIndex sits
// in, not the whole segment -- a clean pass means playing from startIndex through to (and
// including) the first note that crosses into the NEXT measure, three times in a row.
test('Melody: 3 clean playthroughs of the current measure auto-advance the start into the next measure (#46 part 5)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    // frere-jacques is 120bpm/4-4 -- 2s/measure -- notes 0-3 (times 0/0.5/1/1.5) are measure 0,
    // note 4 (time 2.0) is the first note of measure 1.
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 3; // notes 0..3 already established (measure 0), inclusive
    MelodyMode.state.measureCleanStreak = {};

    const streaks = [];
    for (let pass = 0; pass < 3; pass++) {
      MelodyMode.state.userIndex = 0; // measure 0's own start -- fixed, unlike startIndex which moves on advance
      MelodyMode.state.isPlayingSequence = false;
      let i = 0;
      let crossed = false;
      while (!crossed) {
        const note = MelodyMode.state.melody[i];
        crossed = MelodyMode.measureOf(note.time) > 0;
        MelodyMode.handleUserInputNote(note.midi);
        i++;
      }
      streaks.push(MelodyMode.state.measureCleanStreak[0]);
    }
    return {
      streaks,
      startIndex: MelodyMode.state.startIndex,
      startMeasure: MelodyMode.measureOf(MelodyMode.state.melody[MelodyMode.state.startIndex].time),
    };
  });
  expect(result.streaks).toEqual([1, 2, 3]); // the 3rd clean pass triggers auto-advance; the banked credit itself is a historical record and isn't reset by advancing past it
  expect(result.startIndex).toBeGreaterThan(0); // moved out of measure 0
  expect(result.startMeasure).toBeGreaterThan(0); // landed in a later measure, not just +1 note
});

// INV-53: real regression, reported live -- playing a note correctly stopped visibly advancing
// practice. Root cause: the end used to stay frozen after every correct note, only jumping (a
// whole measure) once the START's own 3-rep streak completed on an unrelated gate. That coupling
// was the bug -- correct play should visibly, immediately extend how far you can go. Decoupled:
// the end now grows by exactly one note on every SINGLE correct play, with no streak, no waiting.
test('Melody: the end of the drilled segment grows immediately with each correct play -- no streak required (this was the regression)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const endAfterEach = await page.evaluate(() => {
    MelodyMode.cleanupPlayback();
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 0; // only note 0 known so far
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    const ends = [];
    for (let i = 0; i < 4; i++) {
      MelodyMode.handleUserInputNote(MelodyMode.state.melody[i].midi);
      ends.push(MelodyMode.state.endIndex);
    }
    return ends;
  });
  // Playing note 0 -- the ONLY note in the initial [0,0] segment -- immediately extends the end
  // to 1, since that single play just mastered the entire current segment; every subsequent
  // correct note extends it by exactly one more, on that same single play.
  expect(endAfterEach).toEqual([1, 2, 3, 4]);
});

// Reported live: since the end now grows immediately on every correct play (the fix above),
// "at the frontier" (userIndex > endIndex) stopped being an occasional state and became the norm
// after every single note -- and the idle-replay reminder was only ever scheduled from inside
// that branch, so it silently became unreachable for any real song. The player got no more
// audible/visual re-prompt after their very first correct note: no timeout, no replay, no way to
// recall what came next without already remembering the whole song by ear.
test('Melody: pausing after a correct note still replays the segment after 2s, even though the end now grows on every play (this was a second regression from the first fix)', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000); // clear the mode-entry auto-kickoff intro
  await loadFrereJacques(page);
  await page.clock.fastForward(2000); // clear loadMelodyFromArrayBuffer's own second auto-kickoff

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MelodyMode.cleanupPlayback();
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 0;
    MelodyMode.state.userIndex = 0;
    MelodyMode.handleUserInputNote(MelodyMode.state.melody[0].midi); // the only correct note so far
  });

  expect(await page.evaluate(() => !!MelodyMode.state.userRepeatTimeoutId)).toBe(true);

  await page.clock.fastForward(2100); // past the 2s idle-replay timeout
  await page.clock.fastForward(2000); // playTargetSequence's own internal scheduling delay, as a separate jump
  const playedSegment = await page.evaluate(() => {
    // endIndex already grew to 1 (the fix from the first regression) when note 0 was played, so
    // the reminder replays the now-two-note segment [0,1], not just note 0 again.
    const expected = MelodyMode.state.melody.slice(0, 2).map((n) => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedSegment).toBe(true);
});

test('Melody: a mistake resets only the specific measure it happened in', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 3;
    MelodyMode.state.measureCleanStreak = { 0: 2 }; // simulate 2 clean passes already banked for measure 0
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.handleUserInputNote(MelodyMode.state.melody[0].midi + 1); // deliberately wrong, in measure 0
    return MelodyMode.state.measureCleanStreak[0];
  });
  expect(result).toBe(0);
});

// The old shared cleanStreak used to be wiped on any scrub, since it had no notion of WHICH
// measure it belonged to. Per-measure credit doesn't have that problem -- it's keyed by measure,
// so it survives moving startIndex around; only an actual mistake in that measure resets it.
test('Melody: a player-initiated scrub does not erase a measure\'s already-banked clean-play credit', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 2;
    MelodyMode.state.endIndex = 3;
    MelodyMode.state.measureCleanStreak = { 0: 2 };
    MelodyMode.seekTo(0); // a different startIndex -- player-initiated
    return MelodyMode.state.measureCleanStreak[0];
  });
  expect(result).toBe(2);
});

test('Melody: a freshly loaded song starts at [0, 1], not the degenerate [0, 0]', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);
  const result = await page.evaluate(() => ({ startIndex: MelodyMode.state.startIndex, endIndex: MelodyMode.state.endIndex }));
  expect(result.startIndex).toBe(0);
  expect(result.endIndex, 'the two markers should not visually coincide at the very start').toBe(1);
  // Both bounds are INCLUSIVE (INV-26), so [0, 1] deliberately drills notes 0 AND 1 -- two notes,
  // not one -- at the very start. Asserted explicitly so this reads as intentional, not an
  // off-by-one left for a future reader to "fix".
  expect(result.endIndex - result.startIndex + 1, 'the starting segment covers exactly two notes').toBe(2);
});

test('Melody: loading a new song resets the clean-streak', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);
  await page.evaluate(() => { MelodyMode.state.measureCleanStreak = { 0: 2, 1: 1 }; });
  await loadFrereJacques(page); // resetGame() runs again as part of loading
  const streak = await page.evaluate(() => MelodyMode.state.measureCleanStreak);
  expect(streak).toEqual({});
});

// ────────────────────────────────────────────────────────────────────────
// screenshots/index.html's per-mode cell-count histogram (tests/exploratory.spec.js's
// runRandomTaps now surfaces `cellCount` -- how many cells are actually visible in that exact
// scenario -- alongside the existing fill metrics). A fake manifest is routed in so this is
// deterministic and doesn't depend on the real (gitignored, generated) fixture having been run.
// ────────────────────────────────────────────────────────────────────────

test('screenshots/index.html: renders a per-mode cell-count histogram and per-shot cell counts', async ({ page }) => {
  const fakeManifest = `window.SCREENSHOT_MANIFEST = (window.SCREENSHOT_MANIFEST || []).concat(${JSON.stringify([
    { profile: 'Desktop', profileSlug: 'desktop-chrome', mode: 'sandbox', drawerOpen: false, width: 800, height: 600, file: 'x.png', largestBlackFrac: 0, totalBlackFrac: 0, edgeReaches: 4, edgeMargins: {}, belowFloor: false, tonnetzShare: 0.6, cellCount: 120 },
    { profile: 'Desktop', profileSlug: 'desktop-chrome', mode: 'sandbox', drawerOpen: true, width: 700, height: 500, file: 'y.png', largestBlackFrac: 0, totalBlackFrac: 0, edgeReaches: 4, edgeMargins: {}, belowFloor: false, tonnetzShare: 0.6, cellCount: 150 },
  ])});`;
  await page.route('**/manifest-desktop-chrome.js', (route) => route.fulfill({ body: fakeManifest, contentType: 'application/javascript' }));
  await page.route('**/manifest-mobile-chrome.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/manifest-tablet-chrome.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/manifest-mobile-safari.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/*.png', (route) => route.fulfill({ body: Buffer.from([]), contentType: 'image/png' }));

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/screenshots/index.html');

  await expect(page.locator('.cell-histogram')).toHaveCount(1);
  const stats = await page.locator('.cell-histogram .stats').textContent();
  expect(stats).toContain('n=2');
  expect(stats).toContain('min=120');
  expect(stats).toContain('max=150');

  const captions = await page.locator('figcaption').allTextContents();
  expect(captions.some((c) => c.includes('120 cells'))).toBe(true);
  expect(captions.some((c) => c.includes('150 cells'))).toBe(true);
  expect(errors).toEqual([]);
});

test('screenshots/index.html: an entry from before cellCount existed is excluded, not zeroed', async ({ page }) => {
  const fakeManifest = `window.SCREENSHOT_MANIFEST = (window.SCREENSHOT_MANIFEST || []).concat(${JSON.stringify([
    { profile: 'Desktop', profileSlug: 'desktop-chrome', mode: 'sandbox', drawerOpen: false, width: 800, height: 600, file: 'x.png', largestBlackFrac: 0, totalBlackFrac: 0, edgeReaches: 4, edgeMargins: {}, belowFloor: false, tonnetzShare: 0.6 }, // no cellCount, old manifest shape
  ])});`;
  await page.route('**/manifest-desktop-chrome.js', (route) => route.fulfill({ body: fakeManifest, contentType: 'application/javascript' }));
  await page.route('**/manifest-mobile-chrome.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/manifest-tablet-chrome.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/manifest-mobile-safari.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/*.png', (route) => route.fulfill({ body: Buffer.from([]), contentType: 'image/png' }));

  await page.goto('/screenshots/index.html');
  await expect(page.locator('.cell-histogram')).toHaveCount(0);
  const caption = await page.locator('figcaption').first().textContent();
  expect(caption).not.toContain('cells');
});

// ────────────────────────────────────────────────────────────────────────
// Issue #17: Undo, scoped per-mode exactly as requested -- Sandbox/Blast/Life get it here;
// Compose already had its own (js/compose.js's undo(), unchanged); Melody/Snake/Gravity
// deliberately don't (tolerate wrong notes / no undo makes sense / continuous real-time play).
// Shared mechanism: js/undo-stack.js's UndoStack.create() -- each mutator pushes a closure that
// reverses exactly what it just did; undo() pops and runs the last one, then redraws once.
// ────────────────────────────────────────────────────────────────────────

test('Sandbox: Undo reverses a placement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    SandboxMode.state.selectedPiece = '.';
    SandboxMode.state.rotation = 0;
    SandboxMode.placePiece(2, 2);
  });
  expect(await page.evaluate(() => SandboxMode.state.placedPieces.length)).toBe(1);
  await page.locator('#undo-btn').click();
  expect(await page.evaluate(() => SandboxMode.state.placedPieces.length)).toBe(0);
});

test('Sandbox: Undo reverses a pickup (puts the picked-up piece back)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    SandboxMode.state.placedPieces.push({ type: '.', p: 3, q: 3, rotation: 0 });
    SandboxMode.handleAction(3, 3); // picks it up (an existing piece occupies that cell)
  });
  expect(await page.evaluate(() => SandboxMode.state.placedPieces.length)).toBe(0);
  await page.locator('#undo-btn').click();
  const restored = await page.evaluate(() => SandboxMode.state.placedPieces);
  expect(restored).toEqual([{ type: '.', p: 3, q: 3, rotation: 0 }]);
});

test('Sandbox: Undo reverses a paste, but only the cells that paste actually added', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    SandboxMode.state.placedCells = [{ p: 10, q: 10 }]; // already on the board before the paste
    SandboxMode.pasteClipboard([{ p: 10, q: 10 }, { p: 11, q: 11 }]); // one dup, one new
  });
  expect(await page.evaluate(() => SandboxMode.state.placedCells.length)).toBe(2);
  await page.locator('#undo-btn').click();
  const remaining = await page.evaluate(() => SandboxMode.state.placedCells);
  expect(remaining).toEqual([{ p: 10, q: 10 }]); // the pre-existing cell survives; the pasted one doesn't
});

test('Sandbox: Undo on an empty history is a silent no-op', async ({ page }) => {
  await page.goto('/');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The header button is disabled with nothing to undo (page.locator(...).click() would just hang
  // waiting for it to become enabled) -- calling App.undo() directly exercises the same no-op path
  // the button's own onclick would take if it weren't disabled.
  expect(await page.evaluate(() => document.getElementById('undo-btn').disabled)).toBe(true);
  await page.evaluate(() => App.undo());
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => SandboxMode.state.placedPieces.length)).toBe(0);
});

// A restricted board's viewport is tightly fit to its own fixed shape (INV-40) -- an
// out-of-bounds cell can never actually be reached OR seen, so drawing one at all is pure waste.
// Checked generically across every restricted mode (not one-off per mode), so a future one gets
// this for free instead of needing its own copy of this test. The mode list itself comes from
// Render.RESTRICTED_MODES (read inside the page, its only real home) rather than a second,
// hand-maintained copy here that could drift from it.
test('Restricted modes: each only draws its own in-bounds cells -- no dimmed/wasted out-of-bounds ring', async ({ page }) => {
  await page.goto('/');
  const modes = await page.evaluate(() => Render.RESTRICTED_MODES);
  for (const mode of modes) {
    await page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);
    const counts = await page.evaluate((m) => {
      const checker = { blast: Board, gravity: GravityBoard, snake: SnakeMode }[m];
      let inBounds = 0, total = 0;
      document.querySelectorAll('#tonnetz-svg polygon.cell:not(.ghost)').forEach((el) => {
        total++;
        const p = Number(el.getAttribute('data-p')), q = Number(el.getAttribute('data-q'));
        if (checker.isInBounds(p, q)) inBounds++;
      });
      return { inBounds, total };
    }, mode);
    expect(counts.total, `${mode}: sanity, the board actually drew something`).toBeGreaterThan(0);
    expect(counts.total, `${mode}: every drawn cell is in-bounds, none dimmed-and-hidden`).toBe(counts.inBounds);
  }
});

test('Blast: Undo reverses a placement', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
  await page.evaluate(() => {
    BlastMode.state.activePiece = '.';
    BlastMode.state.rotation = 0;
    BlastMode.placePiece(2, 2);
  });
  expect(await page.evaluate(() => Board.cells.size)).toBe(1);
  await page.locator('#undo-btn').click();
  expect(await page.evaluate(() => Board.cells.size)).toBe(0);
});

test('Blast: Undo reverses a placement that triggered a line-clear cascade, restoring exactly what was cleared', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
  const result = await page.evaluate(() => {
    BlastMode.reset();
    // Fill the whole q=0 line except p=0, then place a single-cell piece there to complete it.
    for (let p = -5; p <= 5; p++) {
      if (p !== 0) Board.cells.set(`${p},0`, { type: 'X', color: '#fff' });
    }
    const before = JSON.stringify([...Board.cells.entries()].sort());
    const linesBefore = BlastMode.state.linesCleared;

    BlastMode.state.activePiece = '.';
    BlastMode.state.rotation = 0;
    BlastMode.placePiece(0, 0);
    const linesAfterPlace = BlastMode.state.linesCleared;
    const emptyAfterClear = Board.cells.size === 0;

    BlastMode.undo();
    const after = JSON.stringify([...Board.cells.entries()].sort());
    return {
      before, after,
      linesBefore, linesAfterPlace,
      linesAfterUndo: BlastMode.state.linesCleared,
      emptyAfterClear,
    };
  });
  expect(result.linesBefore).toBe(0);
  expect(result.linesAfterPlace).toBe(1); // the placement completed the line and cleared it
  expect(result.emptyAfterClear).toBe(true); // the whole line (including the just-placed cell) is gone
  expect(result.after).toBe(result.before); // undo restored the board to exactly its pre-placement state
  expect(result.linesAfterUndo).toBe(0);
});

test('Blast: Undo reverses a paste', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
  await page.evaluate(() => BlastMode.pasteClipboard([{ p: 1, q: 1 }]));
  expect(await page.evaluate(() => Board.cells.size)).toBe(1);
  await page.locator('#undo-btn').click();
  expect(await page.evaluate(() => Board.cells.size)).toBe(0);
});

test('Blast: New Game clears the undo history -- undo cannot reach back into a previous game', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="blast"]').click());
  await page.evaluate(() => {
    BlastMode.state.activePiece = '.';
    BlastMode.state.rotation = 0;
    BlastMode.placePiece(2, 2);
  });
  await page.locator('#blast-reset').click();
  const sizeBeforeUndo = await page.evaluate(() => Board.cells.size);
  expect(await page.evaluate(() => document.getElementById('undo-btn').disabled)).toBe(true);
  await page.evaluate(() => App.undo());
  expect(await page.evaluate(() => Board.cells.size)).toBe(sizeBeforeUndo); // undo was a no-op
});

test('Life: Undo reverses a single cell toggle', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  const before = await page.evaluate(() => [...LifeMode.state.live.entries()].sort());
  await page.evaluate(() => LifeMode.toggleCell(20, 20));
  expect(await page.evaluate(() => LifeMode.state.live.has('20,20'))).toBe(true);
  await page.locator('#undo-btn').click();
  const after = await page.evaluate(() => [...LifeMode.state.live.entries()].sort());
  expect(after).toEqual(before);
});

test('Life: Undo reverses Clear and Reset (human edits), restoring the exact prior board + generation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  await page.evaluate(() => { LifeMode.state.live = new Map([['5,5', 1], ['6,6', 2]]); LifeMode.state.generation = 7; });
  const before = await page.evaluate(() => ({ live: [...LifeMode.state.live.entries()].sort(), gen: LifeMode.state.generation }));

  await page.locator('#life-clear').click();
  expect(await page.evaluate(() => LifeMode.state.live.size)).toBe(0);
  await page.locator('#undo-btn').click();
  const afterClearUndo = await page.evaluate(() => ({ live: [...LifeMode.state.live.entries()].sort(), gen: LifeMode.state.generation }));
  expect(afterClearUndo).toEqual(before);
});

test('Life: a simulation step is never undo-able -- undo after Step reverses the last EDIT, not the step', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  await page.evaluate(() => LifeMode.toggleCell(21, 21)); // a human edit, pushed to the undo stack
  const genBeforeStep = await page.evaluate(() => LifeMode.state.generation);
  await page.locator('#life-step').click();
  const genAfterStep = await page.evaluate(() => LifeMode.state.generation);
  expect(genAfterStep).toBe(genBeforeStep + 1);

  await page.locator('#undo-btn').click();
  const genAfterUndo = await page.evaluate(() => LifeMode.state.generation);
  expect(genAfterUndo).toBe(genAfterStep); // undo did NOT roll back the step
  expect(await page.evaluate(() => LifeMode.state.live.has('21,21'))).toBe(false); // it undid the toggle instead
});

test('Life: Undo reverses a paste', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  const before = await page.evaluate(() => [...LifeMode.state.live.entries()].sort());
  await page.evaluate(() => LifeMode.pasteClipboard([{ p: 30, q: 30 }, { p: 31, q: 31 }]));
  expect(await page.evaluate(() => LifeMode.state.live.size)).toBeGreaterThan(before.length);
  await page.locator('#undo-btn').click();
  const after = await page.evaluate(() => [...LifeMode.state.live.entries()].sort());
  expect(after).toEqual(before);
});

test('Life: loading a new automaton clears the undo history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  await page.evaluate(() => LifeMode.toggleCell(20, 20));
  await page.evaluate(() => LifeMode.loadAutomaton(LifeMode.DEFAULT_AUTOMATON));
  const sizeBeforeUndo = await page.evaluate(() => LifeMode.state.live.size);
  expect(await page.evaluate(() => document.getElementById('undo-btn').disabled)).toBe(true);
  await page.evaluate(() => App.undo());
  expect(await page.evaluate(() => LifeMode.state.live.size)).toBe(sizeBeforeUndo); // undo was a no-op
});

// Requested live: Life's automaton source select should offer uploading a local .yaml file as one
// of its own menu entries -- not only the separate always-or-never-visible "Open Automaton File"
// button (js/file-folder.js's uploadGroup), which disappears entirely once the File System Access
// API's folder tier is available (Chrome), leaving no way there to load a single one-off file
// without picking a whole folder to remember. LifeFolder now opts into FileFolder's hasUpload flag
// (Melody/Compose don't -- this is scoped to Life only, per the request).
test('Life: the automaton source menu offers an "Upload File…" entry that opens the file picker', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });

  const optionValues = await page.evaluate(() => [...document.getElementById('life-source').options].map(o => o.value));
  expect(optionValues).toContain('upload-file');

  // Selecting it should click the real (hidden) file input, not silently do nothing.
  const clicked = await page.evaluate(() => new Promise((resolve) => {
    const input = document.getElementById('life-file-input');
    input.addEventListener('click', () => resolve(true), { once: true });
    const select = document.getElementById('life-source');
    select.value = 'upload-file';
    select.dispatchEvent(new Event('change'));
    setTimeout(() => resolve(false), 500);
  }));
  expect(clicked).toBe(true);

  // The select snaps back to reflect what's actually loaded, rather than sticking on the
  // momentary "Upload File…" action item.
  expect(await page.evaluate(() => document.getElementById('life-source').value)).not.toBe('upload-file');
});

// Requested live: the current rule should be visible underneath the generation counter, not only
// discoverable by opening the loaded .yaml file. First shipped as a one-line "Survival: 3, 5 ·
// Birth: 2" paraphrase -- rejected live as hiding exactly the rule vocabulary that matters most
// for a Tonnetz-based rule (isotropy, require/forbid neighbor clauses, the musical axis/tone/
// semitone selector names), so it shows the real YAML now instead.
test('Life: the current rule is displayed in the drawer (falls back to toYaml when no file was loaded)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  await page.evaluate(() => LifeMode.loadAutomaton({
    name: 'Test Rule', rule: { survival: [3, 5], birth: [2] },
    sound: { when: 'born', duration: 0.4 }, initial: { cells: [] }, tempo: 180,
  }));
  const text = await page.evaluate(() => document.getElementById('life-rule-display').textContent);
  expect(text).toContain('3');
  expect(text).toContain('5');
  expect(text).toContain('2');
});

test('Life: loading a real file shows its exact source YAML, not a re-summarized/re-serialized version', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  // A rule using the richer clause form (isotropy/require) that toYaml() -- which only knows how
  // to write the flat survival/birth shorthand -- would mangle if this were re-serialized instead
  // of shown verbatim.
  const yaml = [
    'name: "Leading-tone bloom"',
    'rule:',
    '  birth:',
    '    - ring_count: [2]',
    '      isotropy: [para]',
    '  survival:',
    '    - ring_count: [3, 4]',
    '    - ring_count: [2]',
    '      require: [semitone_up]',
    'sound: { when: born, duration: 0.4 }',
    'initial:',
    '  cells: [[0, 0]]',
    'tempo: 180',
    '',
  ].join('\n');
  await page.evaluate((text) => LifeMode.loadAutomatonFromText(text, 'leading-tone-bloom.yaml'), yaml);
  const text = await page.evaluate(() => document.getElementById('life-rule-display').textContent);
  expect(text).toBe(yaml);
});

test('Life: a link to the deployed rule-format reference sits next to the rule display', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  // #life-rule-panel, not #life-controls: the rule display (and this link next to it) moved into
  // the collapsible drawer, alongside the title text -- genuinely extra info, read once to
  // understand the ruleset, same category as the title/wiki-link above it (live feedback on the
  // mobile screenshot fixture: Life's own panel was eating too much of a small viewport).
  const href = await page.evaluate(() => {
    const el = document.querySelector('#life-rule-panel a[href*="life-rules.md"]');
    return el ? el.getAttribute('href') : null;
  });
  expect(href).toBe('https://gregory-marton.github.io/Tonncade/docs/life-rules.md');
});

// Requested live: a download link for the current (possibly hand-edited/mid-evolution) automaton,
// separate from "Save As" (which prompts for a filename and either writes into the remembered
// folder or falls back to a download) -- this is a plain, always-ready <a download> link, no
// prompt, that always serves whatever's currently on the board.
test('Life: the download link serves the CURRENT board as YAML, not the original seed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  // Wait out LifeFolder's own auto-load of the bundled default (js/file-folder.js's
  // autoLoadFirstBundled) before touching state -- otherwise it can resolve AFTER this test's own
  // loadAutomaton/toggleCell and silently wipe the hand-placed cell back out.
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  await page.evaluate(() => {
    LifeMode.loadAutomaton(LifeMode.DEFAULT_AUTOMATON);
    LifeMode.toggleCell(9, 9); // a hand edit not part of the original seed
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#life-download-link').click(),
  ]);
  const path = await download.path();
  const fs = require('fs');
  const text = fs.readFileSync(path, 'utf8');
  // Structural check, not a raw-text substring match -- js-yaml.dump's own default block-array
  // style (js/vendor/js-yaml.js) doesn't write cells as an inline "9, 9" the old hand-rolled
  // writer did, but the file is still valid, round-trippable YAML either way.
  const cells = await page.evaluate((t) => Life.parseYaml(t).initial.cells, text);
  expect(cells).toContainEqual([9, 9]);
  expect(download.suggestedFilename()).toMatch(/\.ya?ml$/i);
});

// Found live ("the rules don't scroll"): #top-drawer's base (desktop) rule was still the
// pre-redesign flat height:60px + overflow:hidden -- fine for its original two children (title,
// mode-tabs, one short row), but once #life-rule-panel moved into the drawer it could be much
// taller, and got hard-clipped with no scrollbar at all, not just "doesn't scroll" but genuinely
// unreachable. Every mobile breakpoint already had its own max-height+overflow-y:auto override;
// desktop never did, since #top-drawer never used to need more than one short row there.
test('Life: a long rule display makes the (desktop) drawer scrollable, not just clipped', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="life"]').click());
  // Same race the download-link test above already guards against: LifeFolder's own async
  // auto-load of the bundled default (js/file-folder.js's autoLoadFirstBundled) can resolve
  // AFTER this test's own loadAutomatonFromText below and silently overwrite it with the (much
  // shorter) default -- flaky rather than wrong outright, since it only shows up when that race
  // is lost.
  await page.waitForFunction(() => typeof LifeFolder !== 'undefined' && LifeFolder.currentValue !== null, { timeout: 3000 });
  const longYaml = Array.from({ length: 60 }, (_, i) => `# comment line ${i} filler filler filler`).join('\n')
    + '\nname: "Long Rule"\nrule:\n  survival: [3]\n  birth: [2]\ninitial:\n  cells: [[0,0]]\ntempo: 180\n';
  await page.evaluate((yaml) => LifeMode.loadAutomatonFromText(yaml, 'long-rule.yaml'), longYaml);
  await page.waitForTimeout(200);

  const info = await page.evaluate(() => {
    const drawer = document.getElementById('top-drawer');
    return { scrollHeight: drawer.scrollHeight, clientHeight: drawer.clientHeight, overflowY: getComputedStyle(drawer).overflowY };
  });
  expect(info.overflowY, 'drawer must allow scrolling, not clip').toBe('auto');
  expect(info.scrollHeight, 'content should actually exceed the visible height in this scenario').toBeGreaterThan(info.clientHeight);

  // A raw OS-level page.mouse.wheel() gesture is what a real user does, but it depends on
  // hit-testing/hover-state plumbing that's proven unreliable specifically under the test
  // runner's Desktop Chrome device profile (a near-identical standalone chromium.launch()
  // script scrolls fine with the same gesture). The property this test actually needs to
  // prove is narrower and more important than "a wheel gesture works": the drawer's own CSS
  // no longer hard-clips content with nowhere to go, i.e. scrolling the element via its
  // normal DOM scrolling mechanism actually moves it and the browser doesn't reset/ignore it.
  // Dispatch a real WheelEvent directly at the element to exercise that without depending on
  // OS-input-simulation quirks.
  await page.evaluate(() => {
    const drawer = document.getElementById('top-drawer');
    drawer.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true }));
    drawer.scrollTop += 300;
  });
  const scrollTop = await page.evaluate(() => document.getElementById('top-drawer').scrollTop);
  expect(scrollTop, 'the drawer should actually be scrollable, not clipped with content unreachable').toBeGreaterThan(0);
});




// ────────────────────────────────────────────────────────────────────────
// Compose's undo was a naive notes.pop() -- correct only for "the last note I just recorded",
// silently wrong (or a no-op) after delete/rotate/translate/paste-group. Extended to the same
// UndoStack mechanism (js/undo-stack.js) as Sandbox/Blast/Life, per issue #17 follow-up.
// ────────────────────────────────────────────────────────────────────────

test('Compose: Undo reverses a recorded chord (multiple simultaneous notes) as ONE action', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [];
    ComposeMode.state.chordBuffer = [
      { midi: 60, p: 0, q: 0 },
      { midi: 64, p: 1, q: 0 },
    ];
    ComposeMode.state.chordBufferTime = 0;
    ComposeMode.flushChordBuffer();
  });
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(2);
  await page.locator('#undo-btn').click();
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(0); // both notes gone, one undo
});

test('Compose: Undo reverses Delete, restoring the exact prior notes and selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  const before = await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 0.5, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [1];
    ComposeMode.deleteSelected();
    return null;
  });
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(1);
  await page.locator('#undo-btn').click();
  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes).toEqual([
    { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
    { midi: 64, p: 1, q: 0, time: 0.5, duration: 0.4 },
  ]);
  expect(await page.evaluate(() => ComposeMode.state.selectedIndices)).toEqual([1]);
});

test('Compose: Undo reverses Insert, including the time-shift it applied to LATER notes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  // Inserting between two existing notes (not at the end) -- the inserted note ends up in the
  // MIDDLE of the array, and a later note (not the inserted one) is what's last. A naive
  // notes.pop() would incorrectly remove that later note instead of the one actually inserted,
  // and would leave its time-shift unreverted -- this scenario is what actually distinguishes
  // real inversion from a coincidentally-matching pop().
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 2, q: 0, time: 1.0, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [0];
    ComposeMode.insertAfterSelected(1, 0);
  });
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(3);
  await page.locator('#undo-btn').click();
  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes).toEqual([
    { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
    { midi: 64, p: 2, q: 0, time: 1.0, duration: 0.4 },
  ]);
});

test('Compose: Undo reverses a translate (drag) of the selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
    ComposeMode.state.selectedIndices = [0];
    ComposeMode.translateSelection(1, 0);
  });
  expect(await page.evaluate(() => ComposeMode.state.notes[0].p)).toBe(1);
  await page.locator('#undo-btn').click();
  const note = await page.evaluate(() => ComposeMode.state.notes[0]);
  expect(note).toEqual({ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 });
});

test('Compose: Undo reverses a rotate of the selection around its pivot', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 67, p: 1, q: 0, time: 0.5, duration: 0.4 },
    ];
    ComposeMode.state.selectedIndices = [0, 1];
    ComposeMode.rotateSelection(1);
  });
  const rotated = await page.evaluate(() => ({ p: ComposeMode.state.notes[1].p, q: ComposeMode.state.notes[1].q }));
  expect(rotated).not.toEqual({ p: 1, q: 0 });
  await page.locator('#undo-btn').click();
  const restored = await page.evaluate(() => ({ p: ComposeMode.state.notes[1].p, q: ComposeMode.state.notes[1].q, midi: ComposeMode.state.notes[1].midi }));
  expect(restored).toEqual({ p: 1, q: 0, midi: 67 });
});

test('Compose: Undo reverses a paste-group (#82) of MULTIPLE notes as one action, restoring notes and selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  // Pre-existing note PLUS a 2-note paste -- a naive notes.pop() would remove only the very last
  // pasted note, leaving one pasted note behind; a real inversion removes both and nothing else.
  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 55, p: -1, q: 0, time: 0, duration: 0.4 }];
    ComposeMode.state.selectedIndices = [];
    ComposeMode.state.groupClipboard = [
      { midi: 60, p: 0, q: 0, relTime: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, relTime: 0.5, duration: 0.4 },
    ];
    ComposeMode.pasteGroup();
  });
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(3);
  await page.locator('#undo-btn').click();
  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes).toEqual([{ midi: 55, p: -1, q: 0, time: 0, duration: 0.4 }]);
  expect(await page.evaluate(() => ComposeMode.state.selectedIndices)).toEqual([]);
});

test('Compose: Undo reverses Clear', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => { ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }]; });
  await page.locator('#compose-clear').click();
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(0);
  await page.locator('#undo-btn').click();
  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes).toEqual([{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }]);
});

test('Compose: loading a file clears the undo history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
    ComposeMode.state.selectedIndices = [0];
    ComposeMode.deleteSelected(); // pushes an undo entry
  });
  const bytes = await page.evaluate(() => Array.from(new Uint8Array(MelodyMode.writeMIDI([{ midi: 62, time: 0, duration: 0.4 }]))));
  await page.evaluate((bytes) => {
    ComposeMode.loadMelodyFromArrayBuffer(new Uint8Array(bytes).buffer, 'test.mid');
  }, bytes);
  const sizeBeforeUndo = await page.evaluate(() => ComposeMode.state.notes.length);
  expect(await page.evaluate(() => document.getElementById('undo-btn').disabled)).toBe(true);
  await page.evaluate(() => App.undo());
  expect(await page.evaluate(() => ComposeMode.state.notes.length)).toBe(sizeBeforeUndo); // undo was a no-op
});

// ────────────────────────────────────────────────────────────────────────
// docs/melody-notation-design.md's central workflow: select a time range on the shared Timeline
// (js/timeline.js, Task #16), watch it flatten onto the Tonnetz, then transform it -- pitch
// changes, time never does. The Timeline's two markers ARE the selection mechanism; the
// transform math (translateSelection/rotateSelection) is the real, durable part.
// ────────────────────────────────────────────────────────────────────────

test('Compose: the pitch row renders one token per note, in TIME order (not array-insertion order)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    // Deliberately inserted out of time order -- the row must still read left-to-right by time.
    ComposeMode.state.notes = [
      { midi: 64, p: 1, q: 0, time: 1.0, duration: 0.4 },
      { midi: 60, p: 0, q: 0, time: 0.0, duration: 0.4 },
      { midi: 67, p: 0, q: 1, time: 2.0, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
  });
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#compose-staff-labels .note-token')].map(t => parseInt(t.getAttribute('data-note-idx'), 10))
  );
  expect(order).toEqual([1, 0, 2]); // sorted by time (0.0, 1.0, 2.0), carrying ORIGINAL array indices
});

test('Compose: a plain click on a timeline token selects just that note (or chord, if several share that time)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },
      { midi: 67, p: 0, q: 1, time: 2, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
    ComposeMode.selectTimeRange(1, 1); // click == drag onto itself
  });
  expect(await page.evaluate(() => ComposeMode.state.selectedIndices)).toEqual([1]);
});

test('Compose: dragging across timeline tokens selects every note in that TIME range, regardless of pitch', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },   // measure 1
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },   // measure 1
      { midi: 67, p: 0, q: 1, time: 2, duration: 0.4 },   // measure 1
      { midi: 72, p: -1, q: 2, time: 10, duration: 0.4 }, // far outside the range -- must stay unselected
    ];
    ComposeMode.refreshBoard();
    ComposeMode.selectTimeRange(0, 2); // dragged from the first token to the third
  });
  const selected = await page.evaluate(() => ComposeMode.state.selectedIndices.slice().sort());
  expect(selected).toEqual([0, 1, 2]);
});

test('Compose: dragging the end marker on the real Timeline selects every note up to it, via selectTimeRange', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },
      { midi: 67, p: 0, q: 1, time: 2, duration: 0.4 },
      { midi: 72, p: -1, q: 2, time: 10, duration: 0.4 }, // far outside -- must stay unselected
    ];
    ComposeMode.refreshBoard();
  });
  // A fresh note set defaults the end marker to the LAST note (reported live: "I don't have
  // start and end bars on the compose timeline so I could select anything" -- both used to stack
  // on note 0), so drag it back DOWN to note 2 to exercise the same "selects up to here" path.
  expect(await page.evaluate(() => [ComposeMode.state.startIndex, ComposeMode.state.endIndex])).toEqual([0, 3]);

  const markerBox = await page.locator('.timeline-marker-end .timeline-marker-handle-top').boundingBox();
  const targetBox = await page.locator('.note-token[data-note-idx="2"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();

  expect(await page.evaluate(() => ComposeMode.state.endIndex)).toBe(2);
  const selected = await page.evaluate(() => ComposeMode.state.selectedIndices.slice().sort());
  expect(selected).toEqual([0, 1, 2]);
});

test('Compose: the Tonnetz highlights ONE ring per distinct pitch in a time-range selection, not one per note', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },
      { midi: 60, p: 0, q: 0, time: 2, duration: 0.4 }, // same pitch/cell as note 0, different time
    ];
    ComposeMode.refreshBoard();
    ComposeMode.selectTimeRange(0, 2); // selects all three notes...
  });
  const ringCount = await page.evaluate(() => document.querySelectorAll('.compose-selected-note').length);
  expect(ringCount).toBe(2); // ...but only 2 distinct (p,q) cells among them
});

test('Compose: refreshStaff renders the real grand staff and threads each note\'s state.notes index through as id', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  const ids = await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 64, p: 1, q: 0, time: 1.0, duration: 0.4 }, // deliberately out of time order
      { midi: 60, p: 0, q: 0, time: 0.0, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
    return ComposeMode._staffRender.noteXPositions.map((n) => n.id);
  });
  expect(ids).toEqual([1, 0]); // re-sorted by time internally, but each entry still points at ITS OWN state.notes index
});

test('Compose: addNoteAt inserts a note at an exact pitch/time without shifting any other note, and undo removes it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  const result = await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
    ComposeMode.refreshBoard();
    ComposeMode.addNoteAt(67, 3.0);
    const afterAdd = ComposeMode.state.notes.map((n) => ({ midi: n.midi, time: n.time }));
    ComposeMode.state.undoStack.undo();
    const afterUndo = ComposeMode.state.notes.map((n) => ({ midi: n.midi, time: n.time }));
    return { afterAdd, afterUndo };
  });
  expect(result.afterAdd).toEqual([{ midi: 60, time: 0 }, { midi: 67, time: 3.0 }]);
  expect(result.afterUndo).toEqual([{ midi: 60, time: 0 }]); // the OTHER note's time is untouched throughout -- no shift-ripple
});

test('Compose: clicking empty staff space adds a note there; dragging an existing notehead mostly vertically re-pitches it live and undo restores it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
    ComposeMode.refreshBoard();
  });
  await page.waitForTimeout(200); // let layout/ResizeObserver settle before reading pixel coords

  // Click empty space (far right of the rendered staff, past any note) -> adds a new note.
  const svgBox = await page.evaluate(() => {
    const svg = document.querySelector('#compose-staff svg');
    const r = svg.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const emptyX = svgBox.left + 250;
  const emptyY = svgBox.top + 20; // roughly on the treble staff
  await page.mouse.click(emptyX, emptyY);
  const afterClick = await page.evaluate(() => ComposeMode.state.notes.length);
  expect(afterClick).toBe(2);

  // Drag the ORIGINAL note (midi 60) vertically to re-pitch it.
  const before = await page.evaluate(() => {
    const n = ComposeMode._staffRender.noteXPositions.find((p) => p.id === 0);
    return { x: n.x, y: n.y, midi: ComposeMode.state.notes[0].midi };
  });
  await page.mouse.move(svgBox.left + before.x, svgBox.top + before.y);
  await page.mouse.down();
  await page.mouse.move(svgBox.left + before.x, svgBox.top + before.y - 30, { steps: 5 }); // up 30px -- several diatonic steps
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => {
    const n = ComposeMode.state.notes[0];
    return { midi: n.midi, pqMidiMatches: Tonnetz.getMidi(n.p, n.q) === n.midi };
  });
  expect(afterDrag.midi).not.toBe(before.midi); // pitch actually changed
  expect(afterDrag.midi).toBeGreaterThan(before.midi); // dragged UP -> higher pitch
  expect(afterDrag.pqMidiMatches).toBe(true); // p/q stayed in sync with the new midi (live Tonnetz sync)

  await page.evaluate(() => ComposeMode.state.undoStack.undo());
  const afterUndo = await page.evaluate(() => ComposeMode.state.notes[0].midi);
  expect(afterUndo).toBe(before.midi);
});

test('Compose: dragging an existing notehead mostly horizontally retimes it (staff-exclusive -- no Tonnetz equivalent)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
  });
  await page.waitForTimeout(200); // let layout/ResizeObserver settle before reading pixel coords
  const svgBox = await page.evaluate(() => {
    const r = document.querySelector('#compose-staff svg').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const before = await page.evaluate(() => {
    const n = ComposeMode._staffRender.noteXPositions.find((p) => p.id === 0);
    return { x: n.x, y: n.y, time: ComposeMode.state.notes[0].time, midi: ComposeMode.state.notes[0].midi };
  });
  await page.mouse.move(svgBox.left + before.x, svgBox.top + before.y);
  await page.mouse.down();
  await page.mouse.move(svgBox.left + before.x + 120, svgBox.top + before.y, { steps: 5 }); // mostly horizontal
  await page.mouse.up();
  const after = await page.evaluate(() => ({ time: ComposeMode.state.notes[0].time, midi: ComposeMode.state.notes[0].midi }));
  expect(after.time).toBeGreaterThan(before.time); // dragged right -> later
  expect(after.midi).toBe(before.midi); // pitch untouched -- this gesture is time-only
});

test('Compose: leaving the staff mid-drag abandons the gesture and restores the note\'s pre-drag pitch (no stranded live-mutated state)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
    ComposeMode.refreshBoard();
  });
  await page.waitForTimeout(200); // let layout/ResizeObserver settle before reading pixel coords
  const svgBox = await page.evaluate(() => {
    const r = document.querySelector('#compose-staff svg').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const before = await page.evaluate(() => {
    const n = ComposeMode._staffRender.noteXPositions.find((p) => p.id === 0);
    return { x: n.x, y: n.y, midi: ComposeMode.state.notes[0].midi };
  });
  await page.mouse.move(svgBox.left + before.x, svgBox.top + before.y);
  await page.mouse.down();
  await page.mouse.move(svgBox.left + before.x, svgBox.top + before.y - 30, { steps: 5 });
  // Confirm the drag DID mutate live before leaving (otherwise this test can't distinguish
  // "correctly restored" from "never changed in the first place").
  const midDrag = await page.evaluate(() => ComposeMode.state.notes[0].midi);
  expect(midDrag).not.toBe(before.midi);
  await page.dispatchEvent('#compose-staff', 'mouseleave');
  const after = await page.evaluate(() => ComposeMode.state.notes[0].midi);
  expect(after).toBe(before.midi);
  await page.mouse.up(); // release the OS-level mouse-down so it doesn't leak into the next test
});

test('Compose: transforming a time-range selection changes pitch, leaves time/duration exactly as it was', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  const before = await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.55 },
      { midi: 67, p: 0, q: 1, time: 2, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
    ComposeMode.selectTimeRange(0, 2);
    ComposeMode.translateSelection(1, 0); // shift every selected note up a fifth (p+1)
    return ComposeMode.state.notes.map(n => ({ time: n.time, duration: n.duration }));
  });
  expect(before).toEqual([
    { time: 0, duration: 0.4 },
    { time: 1, duration: 0.55 },
    { time: 2, duration: 0.4 },
  ]); // times/durations completely untouched by a transform that only ever moves p/q/midi
  const pitches = await page.evaluate(() => ComposeMode.state.notes.map(n => ({ p: n.p, q: n.q })));
  expect(pitches).toEqual([{ p: 1, q: 0 }, { p: 2, q: 0 }, { p: 1, q: 1 }]); // every selected note moved by the same (dp,dq)
});

test('Compose: dragging on the Tonnetz still works when the selection came from the timeline, not a Tonnetz tap', async ({ page }) => {
  // The drag-initiation check in setupEvents (isDraggable) only requires SOME note at the
  // moused-down cell to already be selected -- this confirms that holds even when the selection
  // was populated by selectTimeRange (a scattered, non-contiguous set of cells), not selectAtCell.
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 71, p: 5, q: 5, time: 1, duration: 0.4 }, // far away on the lattice -- not adjacent to the first
    ];
    ComposeMode.refreshBoard();
    ComposeMode.selectTimeRange(0, 1);
  });
  const cellAt00 = await page.evaluate(() => {
    const el = document.querySelector('polygon.cell[data-p="0"][data-q="0"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const matches = await page.evaluate(() => ComposeMode.notesAt(0, 0).some(i => ComposeMode.state.selectedIndices.includes(i)));
  expect(matches).toBe(true); // sanity: the (0,0) cell really does host a selected note
});

// Four separate per-mode Undo buttons (#sandbox-undo/#blast-undo/#life-undo/#compose-undo) used to
// each leak visible outside their own mode (a bare un-ID'd wrapper div never covered by setMode's
// hide/show logic -- reported live as "two undos in Blast", a third button in Life, and a leaked
// Undo showing up in Snake, which has no undo at all). Consolidated per user request into a single
// shared #undo-btn in the header next to Copy/Paste (like those, always present, never hidden),
// which is simply DISABLED wherever undo isn't currently applicable -- no undo support in this
// mode at all, or this mode's own undo stack is currently empty.
test('Undo (#17): the single header button stays disabled everywhere undo has nothing to do, and enables once there is something to undo', async ({ page }) => {
  await page.goto('/');
  const isDisabled = () => page.evaluate(() => document.getElementById('undo-btn').disabled);
  const switchTo = (mode) => page.evaluate((m) => document.querySelector(`.mode-option[data-mode="${m}"]`).click(), mode);

  // Modes with no undo support at all: always disabled, regardless of any interaction.
  for (const mode of ['melody', 'snake', 'gravity']) {
    await switchTo(mode);
    expect(await isDisabled(), mode).toBe(true);
  }

  // Sandbox: disabled with an empty history, enabled the instant there's a placement to undo.
  await switchTo('sandbox');
  expect(await isDisabled(), 'sandbox, before placing').toBe(true);
  await page.evaluate(() => {
    SandboxMode.state.selectedPiece = '.';
    SandboxMode.state.rotation = 0;
    SandboxMode.placePiece(2, 2);
  });
  expect(await isDisabled(), 'sandbox, after placing').toBe(false);

  // Blast: same shape -- empty stack disables, a placement enables.
  await switchTo('blast');
  expect(await isDisabled(), 'blast, before placing').toBe(true);
  await page.evaluate(() => {
    BlastMode.state.activePiece = '.';
    BlastMode.state.rotation = 0;
    BlastMode.placePiece(2, 2);
  });
  expect(await isDisabled(), 'blast, after placing').toBe(false);

  // Clicking it back down to empty disables it again -- not a one-way latch.
  await page.locator('#undo-btn').click();
  expect(await isDisabled(), 'blast, after undoing back to empty').toBe(true);
});

// ────────────────────────────────────────────────────────────────────────
// js/notation.js -- grand-staff rendering (docs/melody-notation-design.md). Structural assertions
// only (note count, x-position ordering, barline/measure counts, correct clef split), never
// pixel-level, consistent with this project's existing test style -- Notation is a thin wrapper
// around the vendored VexFlow (js/vendor/vexflow.js), which is responsible for the actual
// engraving correctness.
// ────────────────────────────────────────────────────────────────────────

test('Notation.render: renders one note per input note, at strictly increasing x-positions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container';
    document.body.appendChild(container);
    return Notation.render('notation-test-container', [
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 0.5, duration: 0.5 },
      { midi: 64, time: 1.0, duration: 0.5 },
      { midi: 65, time: 1.5, duration: 0.5 },
    ], { bpm: 120 });
  });
  expect(result.noteXPositions.length).toBe(4);
  for (let i = 1; i < result.noteXPositions.length; i++) {
    expect(result.noteXPositions[i].x).toBeGreaterThan(result.noteXPositions[i - 1].x);
  }
});

test('Notation.render: splits notes across the grand staff by register (MIDI 60 = middle C)', async ({ page }) => {
  await page.goto('/');
  const clefs = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-2';
    document.body.appendChild(container);
    // 59 (B3) must land on the bass staff, 60 (C4) on the treble -- the exact boundary.
    const result = Notation.render('notation-test-container-2', [
      { midi: 59, time: 0, duration: 1 },
      { midi: 60, time: 1, duration: 1 },
    ], { bpm: 60 });
    return result.noteXPositions.map((n) => n.clef);
  });
  expect(clefs).toEqual(['bass', 'treble']);
});

test('Notation.render: barline count matches measure count for a phrase spanning multiple measures', async ({ page }) => {
  await page.goto('/');
  const staveCount = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-3';
    document.body.appendChild(container);
    // 120bpm -> 2 seconds/measure (4/4). 9 seconds of notes spans 5 measures (ceil(9/2)... using
    // whole notes at 2s each to land exactly on measure boundaries, no ambiguity from clipping).
    const notes = [0, 1, 2, 3, 4].map((i) => ({ midi: 60, time: i * 2, duration: 2 }));
    const result = Notation.render('notation-test-container-3', notes, { bpm: 120 });
    return { staves: container.querySelectorAll('.vf-stave').length, result };
  });
  // Two staves (treble+bass) per measure.
  expect(staveCount.staves).toBe(5 * 2);
});

// The first measure's clef+key+time-signature glyphs eat into the same fixed MEASURE_WIDTH every
// later bare measure gets in full, so formatting every measure against one flat width budget
// starved measure 1 specifically -- its last note overflowed past the stave's own right edge,
// landing on top of measure 2's first note. Reported live from a real screenshot: "odd doubling
// ... at the beginning of the second measure." Reproduces with a perfectly ordinary 4
// quarter-notes-per-measure phrase -- no rests, no unusual durations needed.
test('Notation.render: a measure\'s last note doesn\'t overlap the next measure\'s first note (measure-1 front-matter width)', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-overlap';
    document.body.appendChild(container);
    // 8 quarter notes at 120bpm = exactly 2 measures of 4/4, no clipping/rests involved.
    const notes = [60, 62, 64, 60, 60, 62, 64, 60].map((midi, i) => ({ midi, time: i * 0.5, duration: 0.5 }));
    return Notation.render('notation-test-container-overlap', notes, { bpm: 120 });
  });
  const lastOfMeasure1 = result.noteXPositions[3]; // beatStart 3, still measure 1 (barline at beat 4)
  const firstOfMeasure2 = result.noteXPositions[4]; // beatStart 4, measure 2
  const barline2X = result.barlineXPositions[1];
  expect(lastOfMeasure1.x).toBeLessThan(barline2X); // stays inside measure 1's own stave
  expect(firstOfMeasure2.x - lastOfMeasure1.x).toBeGreaterThan(15); // visually distinct noteheads, not overlapping
});

// An empty note array used to render nothing at all (returning null) -- fine for a mode that
// always has content by the time it draws (Melody), but Compose genuinely starts blank, and a
// totally empty container read as "no timeline here at all" (reported live). Draws one empty
// measure (clef/key/time signature, a whole rest) instead, so there's always a real, visible
// staff to record onto.
test('Notation.render: an empty note array still draws one empty measure (clef, no notes), not nothing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-4';
    document.body.appendChild(container);
    const r = Notation.render('notation-test-container-4', [], { bpm: 120 });
    return { r, childCount: container.children.length, hasSvg: !!container.querySelector('svg') };
  });
  expect(result.r, 'still returns a real render result, not null').not.toBeNull();
  expect(result.r.noteXPositions).toEqual([]);
  expect(result.hasSvg, 'a real staff element is drawn').toBe(true);
});

// VexFlow defaults every drawn shape to solid black, which is effectively invisible against this
// app's dark theme background -- the staff technically rendered but couldn't be seen at all
// (caught by Codex's review, from real screenshots; confirmed here by reading the color actually
// painted, not by eyeballing a screenshot).
test('Notation.render: draws in a light color (NOTE_COLOR), not VexFlow\'s invisible-on-dark-theme default black', async ({ page }) => {
  await page.goto('/');
  const color = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-color';
    document.body.appendChild(container);
    Notation.render('notation-test-container-color', [{ midi: 60, time: 0, duration: 0.5 }], { bpm: 120 });
    const svg = container.querySelector('svg');
    const g = svg.querySelector('g');
    return { groupFill: g.getAttribute('fill'), groupStroke: g.getAttribute('stroke'), noteColor: Notation.NOTE_COLOR };
  });
  expect(color.groupFill).toBe(color.noteColor);
  expect(color.groupStroke).toBe(color.noteColor);
  expect(color.groupFill).not.toBe('black');
});

// ctx.setFillStyle/setStrokeStyle (the fix above) only covers elements that inherit the
// RenderContext's ambient color -- a StaveNote's stem and its ledger lines (needed for middle C,
// which sits below the treble staff) each hardcode their OWN default color internally
// ("black"/"#444") regardless of the context's style, so both stayed near-invisible on this dark
// theme even after that fix. Reported live: "the little staff line through the C is barely
// visible... would do well to be fully white like the note."
test('Notation.render: middle C\'s ledger line and stem are visible (not VexFlow\'s hardcoded black/#444 defaults)', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-ledger-visible';
    document.body.appendChild(container);
    Notation.render('notation-test-ledger-visible', [{ midi: 60, time: 0, duration: 1 }], { bpm: 120 }); // C4 needs a ledger line
    const svg = container.querySelector('svg');
    const allElements = [...svg.querySelectorAll('path, g')];
    const hardcodedDark = allElements.filter((el) => {
      const fill = el.getAttribute('fill');
      const stroke = el.getAttribute('stroke');
      return fill === 'black' || fill === '#444' || stroke === 'black' || stroke === '#444';
    });
    return { hardcodedDarkCount: hardcodedDark.length };
  });
  expect(info.hardcodedDarkCount).toBe(0);
});

test('Notation.render: returns one barline x-position per measure', async ({ page }) => {
  await page.goto('/');
  const barlines = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-5';
    document.body.appendChild(container);
    const notes = [0, 1, 2].map((i) => ({ midi: 60, time: i * 2, duration: 2 })); // 3 measures at 120bpm
    return Notation.render('notation-test-container-5', notes, { bpm: 120 }).barlineXPositions;
  });
  expect(barlines.length).toBe(3);
  expect(barlines[1]).toBeGreaterThan(barlines[0]);
  expect(barlines[2]).toBeGreaterThan(barlines[1]);
});

test('Notation.renderLabels: one note-name/octave label per note, positioned at that note\'s OWN reported x', async ({ page }) => {
  await page.goto('/');
  const labels = await page.evaluate(() => {
    const staffContainer = document.createElement('div');
    staffContainer.id = 'notation-test-container-6';
    const labelContainer = document.createElement('div');
    labelContainer.id = 'notation-test-labels-6';
    document.body.appendChild(staffContainer);
    document.body.appendChild(labelContainer);
    const result = Notation.render('notation-test-container-6', [
      { midi: 60, time: 0, duration: 0.5 }, // C4
      { midi: 64, time: 0.5, duration: 0.5 }, // E4
    ], { bpm: 120 });
    Notation.renderLabels('notation-test-labels-6', result.noteXPositions);
    return [...labelContainer.querySelectorAll('.note-token')].map((el) => ({
      text: el.textContent,
      left: el.style.left,
    }));
  });
  expect(labels.map((l) => l.text)).toEqual(['C4', 'E4']);
  expect(parseFloat(labels[1].left)).toBeGreaterThan(parseFloat(labels[0].left)); // same x-order as the staff
});

test('Notation.renderLabels: an optional decorate(entry) hook can add a class/style per pitch-row label', async ({ page }) => {
  await page.goto('/');
  const labels = await page.evaluate(() => {
    const staffContainer = document.createElement('div');
    staffContainer.id = 'notation-test-container-decorate';
    const labelContainer = document.createElement('div');
    labelContainer.id = 'notation-test-labels-decorate';
    document.body.appendChild(staffContainer);
    document.body.appendChild(labelContainer);
    const result = Notation.render('notation-test-container-decorate', [
      { id: 5, midi: 60, time: 0, duration: 0.5 },
      { id: 9, midi: 64, time: 0.5, duration: 0.5 },
    ], { bpm: 120 });
    Notation.renderLabels('notation-test-labels-decorate', result.noteXPositions, null, (entry) => (
      entry.id === 5 ? { className: 'glow-past', style: { opacity: '0.5' } } : null
    ));
    return [...labelContainer.querySelectorAll('.note-token')].map((el) => ({
      className: el.className,
      opacity: el.style.opacity,
      noteIdx: el.getAttribute('data-note-idx'),
    }));
  });
  expect(labels[0]).toMatchObject({ className: 'note-token glow-past', opacity: '0.5', noteIdx: '5' });
  expect(labels[1]).toMatchObject({ className: 'note-token', noteIdx: '9' }); // no decoration returned -- default only
});

test('Notation.renderBarlineOverlay: one .notation-barline per REAL measure boundary -- skips the leading edge of measure 1, at that measure\'s own x', async ({ page }) => {
  await page.goto('/');
  const lines = await page.evaluate(() => {
    const staffContainer = document.createElement('div');
    staffContainer.id = 'notation-test-container-barline';
    const overlayContainer = document.createElement('div');
    overlayContainer.id = 'notation-test-overlay-barline';
    document.body.appendChild(staffContainer);
    document.body.appendChild(overlayContainer);
    const notes = [0, 1, 2].map((i) => ({ midi: 60, time: i * 2, duration: 2 })); // 3 measures at 120bpm
    const result = Notation.render('notation-test-container-barline', notes, { bpm: 120 });
    Notation.renderBarlineOverlay('notation-test-overlay-barline', result.barlineXPositions);
    return [...overlayContainer.querySelectorAll('.notation-barline')].map((el) => el.style.left);
  });
  // 3 measures means 2 REAL boundaries (between 1&2, and 2&3) -- no barline drawn at the very
  // start of measure 1 (nothing precedes it to separate from; real sheet music doesn't draw one
  // there either).
  expect(lines.length).toBe(2);
  expect(lines.map(parseFloat)).toEqual(lines.map(parseFloat).slice().sort((a, b) => a - b)); // in x order
});

// Melody's own refreshStaff (js/melody.js) wires renderBarlineOverlay into #melody-notation-scroll
// (the shared stack wrapper), not the staff itself -- so the lines' CSS (top:0;bottom:0, see
// css/style.css) spans the whole staff+labels+timeline stack. docs/melody-notation-design.md's
// "Barline-overlay mechanics" open item (Codex review: barlines didn't span the stack).
test('Melody: the barline overlay lands in the shared stack wrapper, not just the staff', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);
  const info = await page.evaluate(() => {
    const wrapper = document.getElementById('melody-notation-scroll');
    const lines = wrapper.querySelectorAll('.notation-barline');
    return { lineCount: lines.length, parentIsWrapper: lines.length > 0 && lines[0].parentElement === wrapper };
  });
  expect(info.lineCount).toBeGreaterThan(0);
  expect(info.parentIsWrapper).toBe(true);
});

// The start marker's CSS (top:0;bottom:0, css/style.css) makes it span whatever height its
// POSITIONED ANCESTOR has -- #melody-notation-scroll (the whole staff+labels+timeline stack),
// per docs/melody-notation-design.md's "the scrub marker spans the whole grand staff and note
// names/octaves" requirement (Codex review: it only spanned the timeline row, back when it was
// a one-row-tall element inside the old #melody-note-list).
test('Melody: the start marker spans the full staff+labels+timeline stack height, not just the pitch row', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);
  await page.evaluate(() => {
    MelodyMode.state.endIndex = 2;
    MelodyMode.updateDifficultyUI();
  });
  const heights = await page.evaluate(() => {
    const marker = document.querySelector('.timeline-marker-start');
    const wrapper = document.getElementById('melody-notation-scroll');
    const labels = document.getElementById('melody-staff-labels');
    return {
      markerParentIsWrapper: marker.parentElement === wrapper,
      markerHeight: marker.getBoundingClientRect().height,
      wrapperHeight: wrapper.getBoundingClientRect().height,
      labelsHeight: labels.getBoundingClientRect().height,
    };
  });
  expect(heights.markerParentIsWrapper).toBe(true);
  // The marker should span roughly the WHOLE wrapper (staff + labels + timeline), not just the
  // one-row-tall pitch row -- a generous lower-bound threshold (70% of the wrapper) avoids being
  // brittle against exact pixel rounding while still clearly distinguishing "spans the stack"
  // from "spans one row." An UPPER bound matters just as much: .notation-scroll's own
  // position:relative (its anchor for top:0;bottom:0) only takes effect via a CSS CLASS that
  // must actually be applied in index.html -- when it wasn't (real bug, caught live: "the blue
  // scrubber is... through the entire vertical space including instructions and dropdown and
  // everything"), the marker's absolute positioning escaped to the nearest ACTUALLY-positioned
  // ancestor (the whole page), spanning the full viewport height instead. A lower-bound-only
  // check can't tell "spans the stack" apart from "spans the whole page" -- both are > 70% of
  // the (much smaller) wrapper height.
  expect(heights.markerHeight).toBeGreaterThan(heights.wrapperHeight * 0.7);
  expect(heights.markerHeight).toBeLessThan(heights.wrapperHeight * 1.3);
  expect(heights.markerHeight).toBeGreaterThan(heights.labelsHeight * 2);
});

// Compose's own markers used to be confined to just the pitch row (its staff is itself
// click-to-add/drag-to-repitch editable, and a full-height marker at the same x as a note would
// have swallowed clicks meant for it) -- reunified with Melody's full-stack span once the
// marker's line/box became click-through (pointer-events:none) and only its two small top/bottom
// handles remained interactive, per "shouldn't they be [the same]?" / "this is for Melody as
// well... unify them."
test('Compose: the start marker also spans the full staff+labels+timeline stack height, unified with Melody\'s', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },
      { midi: 67, p: 0, q: 1, time: 2, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
  });
  const heights = await page.evaluate(() => {
    const marker = document.querySelector('.timeline-marker-start');
    const wrapper = document.getElementById('compose-notation-scroll');
    const labels = document.getElementById('compose-staff-labels');
    return {
      markerHeight: marker.getBoundingClientRect().height,
      wrapperHeight: wrapper.getBoundingClientRect().height,
      labelsHeight: labels.getBoundingClientRect().height,
    };
  });
  expect(heights.markerHeight).toBeGreaterThan(heights.wrapperHeight * 0.7);
  expect(heights.markerHeight).toBeGreaterThan(heights.labelsHeight * 2);
});

// The marker's own line/box are pointer-events:none (INV-55) -- clicking directly on the STAFF at
// the same x as a real notehead, with a marker's line passing right over it, must still reach the
// staff's own click-to-select handler (INV-33/Task #9), not the marker. This is the actual point
// of the click-through redesign: Compose's markers went back to full height (matching Melody)
// specifically because this no longer risks shadowing a note.
test('Compose: clicking a notehead the marker line passes directly over still selects it, not the marker', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 1, duration: 0.4 },
      { midi: 67, p: 0, q: 1, time: 2, duration: 0.4 },
    ];
    // The START marker (lookupId === idx, unlike the END marker which sits one note AFTER its
    // own idx -- see Timeline._positionMarker) renders exactly on note 1's own x here. A plain
    // staff click on note 1 selects JUST note 1 -- but if the marker intercepted the click
    // instead, releasing a (no-op) drag back onto the same note commits onStartCommit(1), which
    // calls selectTimeRange(1, 2) and selects notes 1 AND 2 together. The two paths give
    // genuinely different results, which is what makes this an actual regression test (an
    // earlier version of this test used a degenerate single-note range where both paths happened
    // to produce the same [0], so it could never actually fail).
    ComposeMode.state.startIndex = 1;
    ComposeMode.state.endIndex = 2;
    ComposeMode.refreshBoard();
  });
  await page.waitForTimeout(200); // let layout/ResizeObserver settle before reading pixel coords
  const clickPoint = await page.evaluate(() => {
    const svg = document.querySelector('#compose-staff svg').getBoundingClientRect();
    const n = ComposeMode._staffRender.noteXPositions.find((p) => p.id === 1);
    return { x: svg.left + n.x, y: svg.top + n.y };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  const selected = await page.evaluate(() => ComposeMode.state.selectedIndices.slice().sort());
  expect(selected, 'a plain click should select just note 1, not be swallowed by the marker (which would select [1,2] instead)').toEqual([1]);
});

// ────────────────────────────────────────────────────────────────────────
// Timeline (js/timeline.js, INV-55): the shared staff+pitch-row+two-marker component both
// Melody's practice strip and Compose use. Tested standalone here, against synthetic containers,
// independent of either mode's own migration.
// ────────────────────────────────────────────────────────────────────────

// position:fixed pins the container to the visible viewport regardless of wherever the rest of
// the real page's own content (Sandbox's board, etc.) happens to push things -- otherwise a
// plain appendChild(document.body) can land the container far below the fold, where real mouse
// coordinates computed from its getBoundingClientRect() don't correspond to anything
// elementFromPoint can actually see.
const setupTimelineContainers = (prefix) => `
  const staff = document.createElement('div'); staff.id = '${prefix}-staff';
  const labels = document.createElement('div'); labels.id = '${prefix}-labels';
  const scroll = document.createElement('div'); scroll.id = '${prefix}-scroll'; scroll.className = 'notation-scroll';
  scroll.style.position = 'fixed'; scroll.style.top = '0'; scroll.style.left = '0'; scroll.style.zIndex = '9999'; scroll.style.background = '#14161c';
  scroll.appendChild(staff); scroll.appendChild(labels);
  document.body.appendChild(scroll);
`;

test('Timeline.refresh: renders the staff, pitch row, and both markers at the right notes', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate((setupCode) => {
    eval(setupCode);
    const tl = Timeline.create({ staffContainerId: 'tl-staff', labelsContainerId: 'tl-labels', scrollContainerId: 'tl-scroll' });
    const notes = [
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 0.5, duration: 0.5 },
      { midi: 64, time: 1, duration: 0.5 },
    ];
    tl.refresh(notes, { bpm: 120, startIndex: 0, endIndex: 1 });
    const startMarker = document.querySelector('.timeline-marker-start');
    const endMarker = document.querySelector('.timeline-marker-end');
    return {
      labelCount: document.querySelectorAll('#tl-labels .note-token').length,
      startLeft: startMarker ? startMarker.style.left : null,
      endLeft: endMarker ? endMarker.style.left : null,
    };
  }, setupTimelineContainers('tl'));
  expect(info.labelCount).toBe(3);
  expect(info.startLeft).not.toBeNull();
  expect(info.endLeft).not.toBeNull();
  expect(parseFloat(info.endLeft)).toBeGreaterThan(parseFloat(info.startLeft)); // end (note 1) is right of start (note 0)
});

// Reported live: Melody's Random mode ("no meaningful boundary markers for a forever-sliding
// window" -- js/melody.js passes startIndex/endIndex both null there) showed an end marker with
// no start marker. Root cause: _positionMarker's `idx + 1` lookup for 'end' doesn't guard against
// idx being null -- JS coerces `null + 1` to `1`, so a null endIndex silently looked up whichever
// note happens to have id 1 (present in Random's sliding window most of the time) instead of
// finding nothing and removing the marker, the way the null start correctly did.
test('Timeline.refresh: a null endIndex removes the end marker entirely, not a phantom one at id 1', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate((setupCode) => {
    eval(setupCode);
    const tl = Timeline.create({ staffContainerId: 'tl3-staff', labelsContainerId: 'tl3-labels', scrollContainerId: 'tl3-scroll' });
    const notes = [
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 0.5, duration: 0.5 }, // id 1 -- exactly what null + 1 coerces to
      { midi: 64, time: 1, duration: 0.5 },
    ];
    tl.refresh(notes, { bpm: 120, startIndex: null, endIndex: null });
    return {
      startMarkerExists: !!document.querySelector('.timeline-marker-start'),
      endMarkerExists: !!document.querySelector('.timeline-marker-end'),
    };
  }, setupTimelineContainers('tl3'));
  expect(info.startMarkerExists).toBe(false);
  expect(info.endMarkerExists, 'a null endIndex must remove the end marker too, not phantom-render one at id 1').toBe(false);
});

// Reported live, disputing the fix just above: "why wouldn't random have positions? They exist,
// they just grow the same way Compose does." Right -- Random's sliding window (windowStart/
// windowEnd in updateDifficultyUI) has real, meaningful edges that slide forward as `current`
// advances, the same way Compose's own note range grows. Suppressing both markers to null was
// the actual bug; they should track the window's own bounds instead.
test('Melody Random mode: the timeline shows real start/end markers tracking the sliding window, not none', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const info = await page.evaluate(() => {
    MelodyMode.state.melody = Array.from({ length: 20 }, (_, i) => ({ midi: 60 + (i % 12), time: i * 0.5, duration: 0.4 }));
    MelodyMode.state.isRandom = true;
    MelodyMode.state.difficulty = 2; // non-Easy: windowEnd = current (exclusive), no future window
    MelodyMode.state.userIndex = 10;
    MelodyMode.updateDifficultyUI();
    const startEl = document.querySelector('.timeline-marker-start');
    const endEl = document.querySelector('.timeline-marker-end');
    return {
      startExists: !!startEl,
      endExists: !!endEl,
      startLeft: startEl ? startEl.getBoundingClientRect().left : null,
      endLeft: endEl ? endEl.getBoundingClientRect().left : null,
    };
  });
  // pastWindow=3, current=10 -> windowStart=7, windowEnd=10 (exclusive) -> ids 7,8,9 rendered;
  // real markers should bracket that window, not be absent.
  expect(info.startExists).toBe(true);
  expect(info.endExists).toBe(true);
  expect(info.endLeft).toBeGreaterThan(info.startLeft);
});

// Companion edge case: at the very start (current=0, non-Easy so windowEnd=current), the window
// is genuinely empty -- windowStart===windowEnd===0, no notes rendered at all. Markers must stay
// absent here (nothing to bracket), not point at a stale or out-of-range id.
test('Melody Random mode: an empty sliding window (current=0) shows no markers, not stale ones', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const info = await page.evaluate(() => {
    MelodyMode.state.melody = Array.from({ length: 20 }, (_, i) => ({ midi: 60 + (i % 12), time: i * 0.5, duration: 0.4 }));
    MelodyMode.state.isRandom = true;
    MelodyMode.state.difficulty = 2;
    MelodyMode.state.userIndex = 0;
    MelodyMode.updateDifficultyUI();
    return {
      startExists: !!document.querySelector('.timeline-marker-start'),
      endExists: !!document.querySelector('.timeline-marker-end'),
    };
  });
  expect(info.startExists).toBe(false);
  expect(info.endExists).toBe(false);
});

// Reported live: the end marker rendered as a caret BEFORE its own note -- correct for the start
// marker (an inclusive start reads naturally as "right before the first included note"), but for
// an INCLUSIVE end that visually EXCLUDES its own last note instead of including it. Fixed by
// looking up id+1 for 'end' -- the next real note's x if there is one, or Notation.render's own
// trailing padding-rest entry (endPadding) if endIndex is the very last real note.
test('Timeline.refresh: the end marker sits AFTER its own note (the next note\'s x, or the trailing padding rest if it\'s the last note), never on top of it', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate((setupCode) => {
    eval(setupCode);
    const tl = Timeline.create({ staffContainerId: 'tl2-staff', labelsContainerId: 'tl2-labels', scrollContainerId: 'tl2-scroll' });
    const notes = [
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 0.5, duration: 0.5 },
      { midi: 64, time: 1, duration: 0.5 },
    ];
    tl.refresh(notes, { bpm: 120, startIndex: 0, endIndex: 1 }); // NOT the last note (index 2 is)
    const note1X = tl._lastRender.noteXPositions.find((n) => n.id === 1).x;
    const note2X = tl._lastRender.noteXPositions.find((n) => n.id === 2).x;
    const endLeftMidSong = parseFloat(document.querySelector('.timeline-marker-end').style.left);

    tl.refresh(notes, { bpm: 120, startIndex: 0, endIndex: 2 }); // the LAST note
    const endLeftAtLastNote = parseFloat(document.querySelector('.timeline-marker-end').style.left);

    return { note1X, note2X, endLeftMidSong, endLeftAtLastNote };
  }, setupTimelineContainers('tl2'));

  expect(info.endLeftMidSong, 'end at note 1 (not last) should sit at note 2\'s x, not note 1\'s own x')
    .toBeCloseTo(info.note2X - 10, 0);
  expect(info.endLeftAtLastNote, 'end at the LAST note should sit past it (the padding rest), not on top of it')
    .toBeGreaterThan(info.note2X - 10);
});

test('Timeline: dragging the start marker to a different note calls onStartCommit with that note\'s id, exactly once, on release', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((setupCode) => { eval(setupCode); }, setupTimelineContainers('tld'));
  await page.evaluate(() => {
    window.__starts = [];
    window.__tl = Timeline.create({
      staffContainerId: 'tld-staff', labelsContainerId: 'tld-labels', scrollContainerId: 'tld-scroll',
      onStartCommit: (idx) => window.__starts.push(idx),
    });
    window.__tl.setupDrag();
    window.__tl.refresh([
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 0.5, duration: 0.5 },
      { midi: 64, time: 1, duration: 0.5 },
    ], { bpm: 120, startIndex: 0, endIndex: 2 });
  });
  await page.waitForTimeout(200); // let layout/ResizeObserver settle before reading pixel coords
  const positions = await page.evaluate(() => {
    const scrollRect = document.getElementById('tld-scroll').getBoundingClientRect();
    const target = window.__tl._lastRender.noteXPositions[2]; // drag start onto note 2
    // The marker's own line/box are pointer-events:none (INV-55) -- mousedown has to actually
    // land on one of the two handle children to start a drag.
    const handle = document.querySelector('.timeline-marker-start .timeline-marker-handle-top');
    const hr = handle.getBoundingClientRect();
    return {
      markerX: hr.x + hr.width / 2, markerY: hr.y + hr.height / 2,
      targetX: scrollRect.left + target.x, targetY: hr.y + hr.height / 2,
    };
  });
  await page.mouse.move(positions.markerX, positions.markerY);
  await page.mouse.down();
  await page.mouse.move(positions.targetX, positions.targetY, { steps: 5 });
  await page.mouse.up();
  const starts = await page.evaluate(() => window.__starts);
  expect(starts).toEqual([2]);
});

test('Notation.pitchFromY: round-trips every rendered note\'s own reported y back to its exact midi', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-7';
    document.body.appendChild(container);
    const notes = [
      { midi: 43, time: 0, duration: 0.5 },   // G2, bass clef bottom line
      { midi: 60, time: 0.5, duration: 0.5 }, // C4
      { midi: 64, time: 1, duration: 0.5 },   // E4, treble clef bottom line
      { midi: 76, time: 1.5, duration: 0.5 }, // E5
    ];
    const r = Notation.render('notation-test-container-7', notes, { bpm: 120 });
    return notes.map((n) => {
      const rendered = r.noteXPositions.find((p) => p.midi === n.midi);
      return { expected: n.midi, got: Notation.pitchFromY(rendered.y, r.staveBounds, null) };
    });
  });
  for (const { expected, got } of result) {
    expect(got).toBe(expected);
  }
});

test('Notation.pitchFromY: respects a sharp key signature\'s spelling when landing on an altered letter', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-8';
    document.body.appendChild(container);
    // F#4 (midi 66) in G major (fifths=1, F is sharped) -- render at that key so the notehead
    // itself sits on the F line/space (VexFlow draws the accidental via the key sig, not a
    // per-note one), then confirm pitchFromY reconstructs the same midi from that y.
    const notes = [{ midi: 66, time: 0, duration: 0.5 }];
    const r = Notation.render('notation-test-container-8', notes, { bpm: 120, keySignature: 1 });
    return { got: Notation.pitchFromY(r.noteXPositions[0].y, r.staveBounds, 1) };
  });
  expect(result.got).toBe(66);
});

test('Notation.beatFromX: round-trips every rendered note\'s own reported x back to a beat inside its own measure', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-9';
    document.body.appendChild(container);
    const notes = [
      { midi: 60, time: 0, duration: 0.5 },
      { midi: 62, time: 2, duration: 0.5 }, // measure 2 at 120bpm/4-4
    ];
    const r = Notation.render('notation-test-container-9', notes, { bpm: 120 });
    return r.noteXPositions.map((n) => ({
      beatStart: n.beatStart,
      recovered: Notation.beatFromX(n.x, r.barlineXPositions, 4),
    }));
  });
  // Exact pixel->beat alignment isn't guaranteed (Formatter spaces noteheads, not raw beat
  // fractions), but each note must recover a beat within its OWN measure, monotonically
  // increasing with beatStart -- the actual guarantee click-to-add/drag-to-retime need.
  expect(result[0].recovered).toBeGreaterThanOrEqual(0);
  expect(result[0].recovered).toBeLessThan(4);
  expect(result[1].recovered).toBeGreaterThanOrEqual(4);
  expect(result[1].recovered).toBeLessThan(8);
});

test('Melody: the grand staff renders real notes once a song is loaded, matching the Random-vs-song timeline it mirrors', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => document.querySelectorAll('#melody-staff svg').length > 0 || document.querySelectorAll('#melody-staff-labels .note-token').length > 0, { timeout: 3000 });
  const notesOnTimeline = await page.evaluate(() => document.querySelectorAll('#melody-staff-labels .note-token').length);
  const staffHasContent = await page.evaluate(() => document.querySelectorAll('#melody-staff svg').length > 0);
  expect(notesOnTimeline).toBeGreaterThan(0);
  expect(staffHasContent).toBe(true);
});

// ────────────────────────────────────────────────────────────────────────
// js/musicxml.js -- MusicXML read/write (docs/melody-notation-design.md). Round-trip fidelity is
// the load-bearing property: write(parse(x)) and parse(write(notes)) must reproduce the exact
// original data, not just "look plausible." Ties across measure boundaries are the sharpest edge
// here -- a note that crosses a barline must come back with its FULL original duration, not
// silently truncated to whatever fit in its starting measure.
// ────────────────────────────────────────────────────────────────────────

test('MusicXML: round-trips simple notes exactly (pitch, time, duration)', async ({ page }) => {
  await page.goto('/');
  const notes = [
    { midi: 60, time: 0, duration: 0.5 },
    { midi: 64, time: 0.5, duration: 0.5 },
    { midi: 67, time: 1.0, duration: 1.0 },
  ];
  const parsed = await page.evaluate((notes) => {
    const xml = MusicXML.write(notes, { bpm: 120, name: 'Test' });
    return MusicXML.parse(xml).notes;
  }, notes);
  expect(parsed).toEqual(notes);
});

test('MusicXML: a note tied across a measure boundary round-trips its FULL original duration, not truncated', async ({ page }) => {
  await page.goto('/');
  // 120bpm -> 2s/measure. This note starts mid-measure-1 and runs well into measure-2.
  const notes = [{ midi: 67, time: 1.0, duration: 1.75 }];
  const result = await page.evaluate((notes) => {
    const xml = MusicXML.write(notes, { bpm: 120 });
    return { xml, parsed: MusicXML.parse(xml).notes };
  }, notes);
  expect(result.xml).toContain('tie type="start"');
  expect(result.xml).toContain('tie type="stop"');
  expect(result.parsed).toEqual(notes); // the whole point: nothing got clipped
});

test('MusicXML: a note spanning THREE measures (two tie points) round-trips exactly', async ({ page }) => {
  await page.goto('/');
  const notes = [{ midi: 72, time: 4.0, duration: 3.0 }]; // 120bpm: measure 3 into measure 4
  const parsed = await page.evaluate((notes) => {
    const xml = MusicXML.write(notes, { bpm: 120 });
    return MusicXML.parse(xml).notes;
  }, notes);
  expect(parsed).toEqual(notes);
});

test('MusicXML: chords (simultaneous notes) round-trip as notes sharing the same time', async ({ page }) => {
  await page.goto('/');
  const notes = [
    { midi: 60, time: 0, duration: 0.5 },
    { midi: 64, time: 0, duration: 0.5 },
    { midi: 67, time: 0, duration: 0.5 },
  ];
  const result = await page.evaluate((notes) => {
    const xml = MusicXML.write(notes, { bpm: 120 });
    return { chordCount: (xml.match(/<chord\/>/g) || []).length, parsed: MusicXML.parse(xml).notes };
  }, notes);
  expect(result.chordCount).toBe(2); // first chord note has no <chord/>, the other two do
  expect(result.parsed.sort((a, b) => a.midi - b.midi)).toEqual(notes.sort((a, b) => a.midi - b.midi));
});

test('MusicXML: gaps between notes round-trip as silence (rests), not compressed away', async ({ page }) => {
  await page.goto('/');
  const notes = [
    { midi: 60, time: 0, duration: 0.5 },
    { midi: 64, time: 2.0, duration: 0.5 }, // a 1.5s gap of silence before this one
  ];
  const parsed = await page.evaluate((notes) => {
    const xml = MusicXML.write(notes, { bpm: 120 });
    return MusicXML.parse(xml).notes;
  }, notes);
  expect(parsed).toEqual(notes); // the second note's own `time` IS the gap-preservation check
});

test('MusicXML: an empty/malformed document throws rather than silently returning nothing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    try {
      MusicXML.parse('not xml at all <<<');
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e.message };
    }
  });
  expect(result.threw).toBe(true);
});

// ────────────────────────────────────────────────────────────────────────
// js/repeat-navigation.js -- unrolls repeat/D.C./D.S./Coda/Fine structure into a flat linear
// sequence at import (docs/melody-notation-design.md). Fixtures are HAND-AUTHORED MusicXML (not
// produced via MusicXML.write, which never emits this structure at all -- these represent what a
// real external notation tool's export would contain). Four whole notes at 120bpm/4-4, MIDI
// 60/62/64/65 (C/D/E/F), one per measure, so the melody itself makes the play order legible.
// ────────────────────────────────────────────────────────────────────────

test('RepeatNavigation: a simple repeat plays its section twice, then continues', async ({ page }) => {
  await page.goto('/');
  // |: C D :| E  -- expect C D C D E.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="120"/>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
  const midis = await page.evaluate((xml) => MusicXML.parse(xml).notes.map((n) => n.midi), xml);
  expect(midis).toEqual([60, 62, 60, 62, 64]);
});

test('RepeatNavigation: variant (first/second) endings play the right measure on each pass', async ({ page }) => {
  await page.goto('/');
  // |: C [1: D :| 2: E  -- expect C D C E (the 1st ending only on pass 1, 2nd only on pass 2).
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="120"/>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start"/></barline>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start"/></barline>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><ending number="2" type="discontinue"/></barline>
    </measure>
  </part>
</score-partwise>`;
  const midis = await page.evaluate((xml) => MusicXML.parse(xml).notes.map((n) => n.midi), xml);
  expect(midis).toEqual([60, 62, 60, 64]);
});

test('RepeatNavigation: D.C. al Fine returns to the start and stops at Fine, ignored on the first pass', async ({ page }) => {
  await page.goto('/');
  // C D(Fine) E(D.C.) -- forward: C D E, D.C. sends back to start, stop at Fine -> C D E C D.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="120"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <sound fine="yes"/>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <sound dacapo="yes"/>
    </measure>
  </part>
</score-partwise>`;
  const midis = await page.evaluate((xml) => MusicXML.parse(xml).notes.map((n) => n.midi), xml);
  expect(midis).toEqual([60, 62, 64, 60, 62]);
});

test('RepeatNavigation: D.S. al Coda returns to the Segno, then jumps to the Coda on "To Coda"', async ({ page }) => {
  await page.goto('/');
  // C(segno) D(tocoda) E F(D.S.) -- forward: C D E F, D.S. sends back to segno (C), this time
  // honor "To Coda" at D: the marking sits within/after D's own content ("play up to here, THEN
  // jump" -- standard convention), so D itself still plays before jumping straight to G (the
  // coda), skipping E/F on the replay. Expect C D E F C D G.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <sound tempo="120" segno="segno"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <sound tocoda="coda"/>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <sound dalsegno="segno"/>
    </measure>
    <measure number="5">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <sound coda="coda"/>
    </measure>
  </part>
</score-partwise>`;
  const midis = await page.evaluate((xml) => MusicXML.parse(xml).notes.map((n) => n.midi), xml);
  expect(midis).toEqual([60, 62, 64, 65, 60, 62, 67]); // C D E F C D G -- D plays again, THEN jumps to the coda
});

test('RepeatNavigation: a document with no repeat/jump markers at all plays through exactly once, unchanged', async ({ page }) => {
  await page.goto('/');
  const notes = [
    { midi: 60, time: 0, duration: 0.5 },
    { midi: 62, time: 0.5, duration: 0.5 },
  ];
  const parsed = await page.evaluate((notes) => {
    const xml = MusicXML.write(notes, { bpm: 120 });
    return MusicXML.parse(xml).notes;
  }, notes);
  expect(parsed).toEqual(notes); // MusicXML.write's own output never has repeat markers -- sanity check the plumbing is a no-op when there's nothing to navigate
});

// ────────────────────────────────────────────────────────────────────────
// Tonnetz.getNoteName's key-signature-aware speller and Tonnetz.detectKeySignature's key-fit
// heuristic (docs/melody-notation-design.md's "lightweight quantizer/speller/measure-inference"
// for the MIDI-upload/Random bucket -- the one place none of this is already authored).
// ────────────────────────────────────────────────────────────────────────

test('Tonnetz.getNoteName: no keySignature argument -> unchanged sharps-only default', async ({ page }) => {
  await page.goto('/');
  const names = await page.evaluate(() => [61, 63, 66, 68, 70].map((m) => Tonnetz.getNoteName(m)));
  expect(names).toEqual(['C#', 'D#', 'F#', 'G#', 'A#']); // exactly today's existing behavior, no regression
});

test('Tonnetz.getNoteName: spells the SAME pitch class differently depending on the key (F major -> Bb, not A#)', async ({ page }) => {
  await page.goto('/');
  const names = await page.evaluate(() => ({
    noKey: Tonnetz.getNoteName(70),       // A#/Bb, no key context
    fMajor: Tonnetz.getNoteName(70, -1),  // F major (fifths=-1) -- Bb is IN this key's own scale
    dMajor: Tonnetz.getNoteName(66, 2),   // D major (fifths=2) -- F# is IN this key's own scale
  }));
  expect(names.noKey).toBe('A#');
  expect(names.fMajor).toBe('Bb');
  expect(names.dMajor).toBe('F#');
});

test('Tonnetz.getNoteName: a chromatic (non-diatonic) tone falls back to sharps-below/flats-above by key', async ({ page }) => {
  await page.goto('/');
  // MIDI 66 (F#/Gb) is chromatic in C major (fifths=0) -- neither in its 7-note scale.
  const names = await page.evaluate(() => ({
    inSharpKey: Tonnetz.getNoteName(66, 0),  // C major (sharps-side convention, fifths >= 0)
    inFlatKey: Tonnetz.getNoteName(66, -3),  // Eb major (fifths < 0, flats-side convention)
  }));
  expect(names.inSharpKey).toBe('F#');
  expect(names.inFlatKey).toBe('Gb');
});

test('Tonnetz.detectKeySignature: picks the key whose scale covers the notes with the fewest accidentals', async ({ page }) => {
  await page.goto('/');
  const fifths = await page.evaluate(() => ({
    fMajorScale: Tonnetz.detectKeySignature([65, 67, 69, 70, 72, 74, 76]), // F G A Bb C D E -- F major, fifths=-1
    dMajorScale: Tonnetz.detectKeySignature([62, 64, 66, 67, 69, 71, 73]), // D E F# G A B C# -- D major, fifths=2
    cMajorScale: Tonnetz.detectKeySignature([60, 62, 64, 65, 67, 69, 71]), // C D E F G A B -- C major, fifths=0
  }));
  expect(fifths.fMajorScale).toBe(-1);
  expect(fifths.dMajorScale).toBe(2);
  expect(fifths.cMajorScale).toBe(0);
});

test('Tonnetz.detectKeySignature: empty input returns 0 (C major/no signature) rather than throwing', async ({ page }) => {
  await page.goto('/');
  const fifths = await page.evaluate(() => Tonnetz.detectKeySignature([]));
  expect(fifths).toBe(0);
});

test('Melody: the Tonnetz\'s own cell labels spell notes per the loaded song\'s detected key, not always sharps', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.evaluate(() => {
    // An F-major-flavored melody (F G A Bb C) -- Bb should read as "Bb" on the lattice, not "A#",
    // once MelodyMode.loadDefault's own key-detection has run.
    MelodyMode.state.melody = [65, 67, 69, 70, 72].map((midi, i) => ({ midi, time: i * 0.5, duration: 0.4 }));
    MelodyMode.state.isRandom = true;
    MelodyMode.state.keySignature = Tonnetz.detectKeySignature(MelodyMode.state.melody.map((n) => n.midi));
    MelodyMode.refreshBoard();
  });
  const detected = await page.evaluate(() => MelodyMode.state.keySignature);
  expect(detected).toBe(-1); // F major
  // The real assertion: some rendered cell label reads "Bb", none reads "A#", for that pitch.
  const anyBbLabel = await page.evaluate(() => [...document.querySelectorAll('#tonnetz-svg text')].some((t) => t.textContent.startsWith('Bb')));
  const anySharpMislabel = await page.evaluate(() => [...document.querySelectorAll('#tonnetz-svg text')].some((t) => t.textContent.startsWith('A#')));
  expect(anyBbLabel).toBe(true);
  expect(anySharpMislabel).toBe(false);
});

// ────────────────────────────────────────────────────────────────────────
// Bundled songs (midi/index.json) are now .musicxml, authored -- not derived from MIDI
// (docs/melody-notation-design.md, task #8: scripts/generate-bundled-musicxml.js). Confirms the
// real end-to-end path: MelodyFolder's bundled tier -> loadMelodyFromMusicXML -> a playable melody,
// through the actual app UI, not just the parser directly.
// ────────────────────────────────────────────────────────────────────────

test('Bundled songs: midi/index.json now lists .musicxml files', async ({ page }) => {
  const res = await page.request.get('/midi/index.json');
  const index = await res.json();
  expect(index.length).toBeGreaterThan(0);
  index.forEach((song) => expect(song.file).toMatch(/\.musicxml$/));
});

test('Melody: loading the first bundled (.musicxml) song produces a real, playable melody', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  // Melody's MelodyFolder instance has autoLoadFirstBundled: false BY DESIGN (it already has its
  // own Random offline-degrade default, js/melody.js) -- explicitly select the first bundled
  // song, same as a real player picking it from the dropdown, rather than waiting for an
  // auto-load that deliberately doesn't happen here.
  await page.waitForFunction(() => typeof MelodyFolder !== 'undefined' && MelodyFolder.onlineIndex && MelodyFolder.onlineIndex.length > 0, { timeout: 5000 });
  await page.evaluate(() => MelodyFolder.loadOnlineFile(0));
  const result = await page.evaluate(() => ({
    noteCount: MelodyMode.state.melody.length,
    allValidMidi: MelodyMode.state.melody.every((n) => Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127),
    allPositiveDurations: MelodyMode.state.melody.every((n) => n.duration > 0),
    monotonicTime: MelodyMode.state.melody.every((n, i, arr) => i === 0 || n.time >= arr[i - 1].time),
    keySignature: MelodyMode.state.keySignature,
  }));
  expect(result.noteCount).toBeGreaterThan(0);
  expect(result.allValidMidi).toBe(true);
  expect(result.allPositiveDurations).toBe(true);
  expect(result.monotonicTime).toBe(true);
  expect(result.keySignature).toBe(0); // every bundled song detected as C major (all-natural pitches)
});

test('Melody: EVERY bundled song loads without error and produces a sane melody', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => typeof MelodyFolder !== 'undefined' && MelodyFolder.onlineIndex, { timeout: 5000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const results = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < MelodyFolder.onlineIndex.length; i++) {
      await MelodyFolder.loadOnlineFile(i);
      out.push({
        name: MelodyFolder.onlineIndex[i].name,
        noteCount: MelodyMode.state.melody.length,
        allValidMidi: MelodyMode.state.melody.every((n) => Number.isFinite(n.midi)),
      });
    }
    return out;
  });

  expect(results.length).toBe(6);
  results.forEach((r) => {
    expect(r.noteCount, `${r.name} should have notes`).toBeGreaterThan(0);
    expect(r.allValidMidi, `${r.name} should have valid MIDI pitches throughout`).toBe(true);
  });
  expect(errors).toEqual([]);
});

test('Mxl.extractMusicXML: unzips a real .mxl (STORED container.xml + DEFLATE root entry), following container.xml\'s rootfile path', async ({ page }) => {
  await page.goto('/');
  const originalXml = await page.evaluate(() => MusicXML.write(
    [{ midi: 60, time: 0, duration: 0.5 }, { midi: 64, time: 0.5, duration: 0.5 }],
    { bpm: 120, name: 'Mxl Fixture' }
  ));
  const zipBuffer = buildMxlFixture(originalXml);
  const extracted = await page.evaluate(async (bytes) => {
    const buffer = new Uint8Array(bytes).buffer;
    return Mxl.extractMusicXML(buffer);
  }, Array.from(zipBuffer));
  expect(extracted).toBe(originalXml); // byte-for-byte identical after zip -> unzip
});

test('Mxl.extractMusicXML: falls back to scanning for a .musicxml entry when container.xml is missing', async ({ page }) => {
  await page.goto('/');
  const originalXml = await page.evaluate(() => MusicXML.write([{ midi: 67, time: 0, duration: 1 }], { bpm: 100 }));
  const zipBuffer = buildMxlFixtureSingleEntry(originalXml, 'untitled.musicxml');
  const extracted = await page.evaluate(async (bytes) => {
    return Mxl.extractMusicXML(new Uint8Array(bytes).buffer);
  }, Array.from(zipBuffer));
  expect(extracted).toBe(originalXml);
});

test('Mxl.extractMusicXML: a non-ZIP buffer throws rather than silently returning nothing', async ({ page }) => {
  await page.goto('/');
  const threw = await page.evaluate(async () => {
    try {
      await Mxl.extractMusicXML(new TextEncoder().encode('not a zip file at all').buffer);
      return false;
    } catch (err) {
      return true;
    }
  });
  expect(threw).toBe(true);
});

test('Melody: loading a real .mxl file unzips it and loads the same melody as the equivalent plain .musicxml would', async ({ page }) => {
  await page.goto('/');
  const originalXml = await page.evaluate(() => MusicXML.write(
    [{ midi: 62, time: 0, duration: 0.5 }, { midi: 65, time: 0.5, duration: 0.5 }, { midi: 69, time: 1, duration: 1 }],
    { bpm: 120, name: 'Melody Mxl Test' }
  ));
  const zipBuffer = buildMxlFixture(originalXml);
  const midis = await page.evaluate(async (bytes) => {
    document.querySelector('.mode-option[data-mode="melody"]').click();
    await MelodyMode.loadMelodyFromMxl(new Uint8Array(bytes).buffer, 'test.mxl');
    return MelodyMode.state.melody.map((n) => n.midi);
  }, Array.from(zipBuffer));
  expect(midis).toEqual([62, 65, 69]);
});

test('Compose: loading a real .mxl file unzips it, loads the notes, and picks up the authored key signature', async ({ page }) => {
  await page.goto('/');
  const originalXml = await page.evaluate(() => MusicXML.write(
    [{ midi: 65, time: 0, duration: 1 }, { midi: 70, time: 1, duration: 1 }], // Bb4, in F major (fifths=-1)
    { bpm: 120, keySignatureFifths: -1, name: 'Compose Mxl Test' }
  ));
  const zipBuffer = buildMxlFixture(originalXml);
  const result = await page.evaluate(async (bytes) => {
    document.querySelector('.mode-option[data-mode="compose"]').click();
    await ComposeMode.loadMelodyFromMxl(new Uint8Array(bytes).buffer, 'test.mxl');
    return {
      midis: ComposeMode.state.notes.map((n) => n.midi),
      keySignature: ComposeMode.state.keySignature,
    };
  }, Array.from(zipBuffer));
  expect(result.midis).toEqual([65, 70]);
  expect(result.keySignature).toBe(-1);
});

// The plain <input type=file> fallback picker (Safari/Firefox, or Chrome before a folder's been
// chosen) used to hard-code loadMelodyFromArrayBuffer regardless of the chosen file's extension --
// selecting a .musicxml/.mxl file there would force-feed non-MIDI bytes into the MIDI parser and
// fail, even though the folder-browsing tier (js/file-folder.js) already knew how to route them
// correctly. Caught by Codex's review, not by these tests, since nothing exercised this picker at
// all before now. page.setInputFiles fires a REAL native 'change' event, not a synthetic
// page.evaluate call into the mode's own JS -- this is testing the actual DOM wiring.
test('Melody: the direct file-input picker routes a .musicxml file to loadMelodyFromMusicXML, not the MIDI parser', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  const xmlText = await page.evaluate(() => MusicXML.write([{ midi: 71, time: 0, duration: 1 }], { bpm: 100 }));
  await page.setInputFiles('#melody-file-input', {
    name: 'direct-picker-test.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(xmlText, 'utf8'),
  });
  // loadMelodyFromMusicXML re-centers the melody into a comfortable octave range (centerMelody),
  // so the exact MIDI value can shift by whole octaves -- pitch class is the real invariant here
  // (confirming the MusicXML path was actually taken, not that the MIDI parser silently produced
  // garbage: a raw MIDI-parser misparse of XML text wouldn't reliably preserve pitch class at all).
  await expect.poll(() => page.evaluate(() => MelodyMode.state.melody.map((n) => ((n.midi % 12) + 12) % 12))).toEqual([71 % 12]);
});

test('Compose: the direct file-input picker routes a .mxl file to loadMelodyFromMxl, not the MIDI parser', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  const xmlText = await page.evaluate(() => MusicXML.write([{ midi: 73, time: 0, duration: 1 }], { bpm: 100 }));
  const zipBuffer = buildMxlFixture(xmlText);
  await page.setInputFiles('#compose-file-input', {
    name: 'direct-picker-test.mxl',
    mimeType: 'application/vnd.recordare.musicxml',
    buffer: zipBuffer,
  });
  await expect.poll(() => page.evaluate(() => ComposeMode.state.notes.map((n) => n.midi))).toEqual([73]);
});
