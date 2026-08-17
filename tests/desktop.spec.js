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

test('midi note list fades past notes progressively by recency', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 3;
    MelodyMode.updateDifficultyUI();
  });

  const opacities = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('#melody-note-list [data-note-role="past"]'));
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
    const el = document.querySelector('#melody-note-list [data-note-role="current"]');
    return el ? el.textContent : null;
  });

  // Octave-qualified (e.g. "E4", not bare "E") since INV-25 -- two different-octave notes
  // sharing a bare name were an understandable "wrong note" mix-up (real report), fixed by
  // making the octave part of every displayed name, not just the current target's.
  const expectedName = await page.evaluate(() => {
    const midi = MelodyMode.state.melody[5].midi;
    return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;
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
    const el = document.querySelector('#melody-note-list [data-note-role="current"]');
    return el ? el.textContent : null;
  });
  // Octave-qualified since INV-25 -- see the comment on the preceding test.
  const expectedName = await page.evaluate(() => {
    const midi = MelodyMode.state.melody[2].midi;
    return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;
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
    const el = document.querySelector('#melody-note-list [data-note-role="current"]');
    return el ? el.textContent : null;
  });
  // Octave-qualified since INV-25 -- see the comment on the earlier "pivots the window" test.
  const expectedName = await page.evaluate(() => {
    const midi = MelodyMode.state.melody[MelodyMode.state.userIndex].midi;
    return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

// ────────────────────────────────────────────────────────────────────────
// MidiFolder (js/midi-folder.js -> js/file-folder.js's FileFolder, task #27 + the one-dropdown
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

// Each fake file's "bytes" are just a one-byte tag identifying which fake file it is; the
// parseMIDI stub reads that tag back out, so a distinct, easily-asserted MIDI note stands in for
// "this specific file's real content loaded" without needing real Standard MIDI File bytes.
const installFakeMidiFolder = (page, { files, permission = 'granted' }) => page.evaluate(({ files, permission }) => {
  // Real FileSystemDirectoryHandles are structured-cloneable (by design, so they survive an
  // IndexedDB round-trip) -- a fake JS object with methods is NOT, so saveHandle would throw a
  // real DataCloneError against a fake handle. Stubbed out here since these tests exercise
  // FileFolder's own browsing/restore logic, not real IndexedDB persistence.
  MidiFolder.saveHandle = async () => {};
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
    // itself override this after installFakeMidiFolder runs.
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

test('MidiFolder: choosing a folder lists only .mid/.midi files (sorted) and auto-loads the first', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, {
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

test('MidiFolder: selecting a different dropdown entry loads that file instead', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, {
    files: [{ name: 'Apple.mid', tag: 0 }, { name: 'Banana.mid', tag: 1 }],
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.locator('#melody-source').selectOption('choose-folder');
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 60); // Apple auto-loaded

  await page.locator('#melody-source').selectOption({ label: 'Banana' });
  await page.waitForFunction(() => MelodyMode.state.melody[0].midi === 61);
  expect(await page.evaluate(() => MelodyMode.state.melody[0].midi)).toBe(61);
});

test('MidiFolder: a granted saved folder restores silently on entering Melody mode, no click needed', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Saved.mid', tag: 5 }], permission: 'granted' });
  await page.evaluate(() => {
    MidiFolder.loadHandle = async () => window.__fakeFolderHandle;
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 65);

  await expect(page.locator('#melody-source-status')).toHaveText(/MySongs/);
});

test('MidiFolder: a lapsed (non-granted) saved folder shows a one-click reconnect instead of silently failing', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Saved.mid', tag: 2 }], permission: 'prompt' });
  await page.evaluate(() => {
    MidiFolder.loadHandle = async () => window.__fakeFolderHandle;
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'reconnect-folder'));

  // No file should have loaded yet -- permission wasn't granted, so nothing was silently read.
  expect(await sourceLocalOptionNames(page, 'melody-source')).toEqual([]);

  await page.locator('#melody-source').selectOption('reconnect-folder');
  await page.waitForFunction(() => MelodyMode.state.melody[0] && MelodyMode.state.melody[0].midi === 62);
});

test('MidiFolder: on an unsupported browser, the folder UI stays hidden and the plain upload picker is untouched', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { delete window.showDirectoryPicker; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  const hasFolderOption = await page.evaluate(() =>
    [...document.getElementById('melody-source').options].some(o => o.value === 'choose-folder' || o.value === 'reconnect-folder'));
  expect(hasFolderOption).toBe(false);
  await expect(page.locator('#melody-upload-group')).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────
// MidiFolder's bundled online tier (task #27): a plain relative fetch to ./midi/index.json, no
// File System Access API involved -- works in every browser, its entries simply don't appear in
// #melody-source on any failure (offline, file://, 404) rather than surfacing an error, since it's
// a bonus content tier, not a required one.
// ────────────────────────────────────────────────────────────────────────

test('MidiFolder online: populates the dropdown from index.json, and selecting a song loads the real fetched file', async ({ page }) => {
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

test('MidiFolder online: a failed fetch (offline/404) leaves no bundled entries in the dropdown', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForTimeout(200); // let the failed fetch settle

  const hasBundled = await page.evaluate(() =>
    [...document.getElementById('melody-source').options].some(o => o.value.startsWith('bundled:')));
  expect(hasBundled).toBe(false);
});

test('MidiFolder online: Compose gets the same bundled songs via its own dropdown', async ({ page }) => {
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

test('MidiFolder: choosing a folder copies bundled defaults into it that it does not already have', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Bundled Song', file: 'bundled.mid' }],
  }));
  const bytes = await Buffer.from([9]); // matches the fake parseMIDI stub's tag convention below
  await page.route('**/midi/bundled.mid', route => route.fulfill({ body: bytes, contentType: 'audio/midi' }));

  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Existing.mid', tag: 0 }] });
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

// A folder picked/restored under only 'read' permission can list files, but saveFileAs's write
// (getFileHandle().createWritable()) throws against a real browser's read-only grant and silently
// falls back to a plain download -- the exact bug reported live ("Life save gives me a download
// rather than saving to my local folder"). These fakes always grant whatever's asked regardless of
// mode (see installFakeMidiFolder's own comment), so they can't reproduce the real throw -- what
// they CAN and must verify is that 'readwrite' is what actually gets asked for in the first place.
test('MidiFolder: choosing a folder requests readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [] });
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

test('MidiFolder: restoring a saved folder queries readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Saved.mid', tag: 1 }], permission: 'granted' });
  await page.evaluate(() => { MidiFolder.loadHandle = async () => window.__fakeFolderHandle; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => window.__permissionModeCalls.some((c) => c.fn === 'query'));
  const call = await page.evaluate(() => window.__permissionModeCalls.find((c) => c.fn === 'query'));
  expect(call.mode).toBe('readwrite');
});

test('MidiFolder: reconnecting a lapsed folder requests readwrite permission, not just read', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Saved.mid', tag: 2 }], permission: 'prompt' });
  await page.evaluate(() => { MidiFolder.loadHandle = async () => window.__fakeFolderHandle; });
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
test('MidiFolder: opening the dropdown re-lists the folder, picking up an externally added file', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Existing.mid', tag: 3 }], permission: 'granted' });
  await page.evaluate(() => { MidiFolder.loadHandle = async () => window.__fakeFolderHandle; });
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
// and Save (via MelodyMode.writeMIDI + MidiFolder.saveFileAs, both new). Per-note drag-to-
// reposition/retime, a timeline view, and polyphony are explicitly deferred.
// ────────────────────────────────────────────────────────────────────────

test('Compose: tapping cells while recording appends notes with the tapped cell\'s own pitch and increasing time', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.locator('#compose-record').click();
  await expect(page.locator('#compose-record')).toHaveAttribute('title', 'Stop recording');

  const cellA = page.locator('polygon.cell:not(.ghost)[data-p="2"][data-q="1"]');
  const cellB = page.locator('polygon.cell:not(.ghost)[data-p="0"][data-q="3"]');
  await cellA.click();
  await page.waitForTimeout(30); // real, small elapsed time between taps -- just needs to be > 0
  await cellB.click();

  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes.length).toBe(2);
  expect(notes[0]).toMatchObject({ p: 2, q: 1, midi: 60 + 7 * 2 + 3 * 1 });
  expect(notes[1]).toMatchObject({ p: 0, q: 3, midi: 60 + 7 * 0 + 3 * 3 });
  expect(notes[1].time).toBeGreaterThan(notes[0].time);
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

test('Compose: Save writes a MIDI file that round-trips back to the same notes', async ({ page }) => {
  await page.goto('/');

  // A fake remembered folder whose getFileHandle/createWritable capture the written bytes,
  // so this test can decode them back and confirm Save round-trips real content -- not just
  // that some function was called.
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
    MidiFolder.folderHandle = fakeHandle;
    window.prompt = () => 'my-song.mid';
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 64, p: 1, q: 0, time: 0, duration: 0.4 },
      { midi: 60, p: 0, q: 0, time: 0.5, duration: 0.4 },
    ];
  });

  await page.locator('#compose-save').click();
  await page.waitForFunction(() => window.__savedFiles['my-song.mid'] !== undefined);

  const roundTripped = await page.evaluate(() => {
    const buf = window.__savedFiles['my-song.mid'];
    const parsed = MelodyMode.parseMIDI(buf);
    return MelodyMode.extractMonophonicMelody(parsed).map(n => ({ midi: n.midi, time: n.time }));
  });
  expect(roundTripped.length).toBe(2);
  expect(roundTripped[0].midi).toBe(64);
  expect(roundTripped[1].midi).toBe(60);
  expect(roundTripped[1].time).toBeGreaterThan(roundTripped[0].time);
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

test('Compose: Save emits a real tempo meta event when Quantize was used, matching the chosen BPM', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__savedBytes = null;
    MidiFolder.folderHandle = {
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async (buf) => { window.__savedBytes = Array.from(new Uint8Array(buf)); },
          close: async () => {},
        }),
      }),
    };
    window.prompt = () => 'quantized-song.mid';
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    ComposeMode.state.tempoBPM = 100;
    ComposeMode.state.quantizeEnabled = true;
    ComposeMode.state.notes = [{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }];
  });

  await page.locator('#compose-save').click();
  await page.waitForFunction(() => window.__savedBytes !== null);

  const foundTempo = await page.evaluate(() => {
    const bytes = window.__savedBytes;
    for (let i = 0; i + 5 < bytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0x51 && bytes[i + 2] === 0x03) {
        return (bytes[i + 3] << 16) | (bytes[i + 4] << 8) | bytes[i + 5];
      }
    }
    return null;
  });
  expect(foundTempo).toBe(Math.round(60000000 / 100));
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
  await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });

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
// Melody mode replay-from scrub control (#46 low-hanging fruit): lets a player replay the
// drilled segment starting from any note already reached, instead of always restarting from
// note 0 -- useful both to relisten to an earlier stretch and to skip past notes already
// mastered. Clamped to [0, targetLength - 1].
// ────────────────────────────────────────────────────────────────────────

test('Melody mode: the replay-from scrub marker stays hidden until more than one note has been reached', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000); // let the auto-kickoff intro finish; targetLength stays 1

  await expect(page.locator('.scrub-marker')).toHaveCount(0);
});

test('Melody mode: the scrub marker appears once the drilled segment grows, sitting right before the note it targets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.evaluate(() => {
    MelodyMode.state.targetLength = 4;
    MelodyMode.state.startIndex = 2;
    MelodyMode.updateDifficultyUI();
  });

  await expect(page.locator('.scrub-marker')).toHaveCount(1);
  // The marker is absolutely positioned at the target token's own offsetLeft (see
  // positionScrubMarker, #46), not inserted adjacent to it in DOM order -- assert its style.left
  // matches the target token's offsetLeft (within the marker's own small offset), not adjacency.
  const isAtTarget = await page.evaluate(() => {
    const marker = document.querySelector('.scrub-marker');
    const target = document.querySelector(`.note-token[data-note-idx="${MelodyMode.state.startIndex}"]`);
    if (!target) return false;
    const markerLeft = parseFloat(marker.style.left);
    return Math.abs(markerLeft - target.offsetLeft) <= 5;
  });
  expect(isAtTarget).toBe(true);
});

test('Melody mode: the scrub control clamps to notes already reached, never past targetLength', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  await page.evaluate(() => {
    MelodyMode.state.targetLength = 4;
    MelodyMode.updateDifficultyUI();
  });

  const clamped = await page.evaluate(() => {
    MelodyMode.seekTo(99); // far beyond targetLength - 1
    return MelodyMode.state.startIndex;
  });
  expect(clamped).toBe(3);
});

test('Melody mode: dragging the scrub marker back replays the skipped-over earlier notes', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000); // clear the auto-kickoff intro

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MelodyMode.state.targetLength = 4;
    MelodyMode.state.startIndex = 2; // simulate having already drilled through note 2
    MelodyMode.updateDifficultyUI();
  });

  const markerBox = await page.locator('.scrub-marker').boundingBox();
  const targetBox = await page.locator('.note-token[data-note-idx="0"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => MelodyMode.state.startIndex)).toBe(0);

  await page.clock.fastForward(5000); // let the whole replayed segment (notes 0..3) finish

  const playedFromZero = await page.evaluate(() => {
    const expected = MelodyMode.state.melody.slice(0, 4).map(n => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedFromZero).toBe(true);
  expect(await page.evaluate(() => MelodyMode.state.userIndex)).toBe(0);
});

test('Melody mode: dragging the scrub marker forward skips already-mastered notes on replay', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.clock.fastForward(2000);

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MelodyMode.state.targetLength = 4;
    MelodyMode.updateDifficultyUI();
  });

  const markerBox = await page.locator('.scrub-marker').boundingBox();
  const targetBox = await page.locator('.note-token[data-note-idx="2"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();

  await page.clock.fastForward(5000);

  const playedFromTwo = await page.evaluate(() => {
    const expected = MelodyMode.state.melody.slice(2, 4).map(n => n.midi);
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
    MelodyMode.state.targetLength = 4;
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
// over the board instead of being constrained to a small corner box. Separately,
// #melody-keyboard-instructions (.desktop-only) is only hidden by the touch-pointer and
// max-width:767px rules -- not this landscape one -- so it kept contributing extra bulk here too.
// ────────────────────────────────────────────────────────────────────────

test('INV-31: Melody\'s always-visible controls stay a small corner HUD (not a wide overlay) at a landscape width under 950px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());

  // The always-visible Melody controls (streak readout + the Play/Restart transport icons) live
  // in the mobile dock; one-time setup (folder/song pickers, Difficulty) now routes to the drawer
  // and #melody-controls itself is emptied + hidden on mobile (task #77). Guard the DOCK's width so
  // the HUD stays compact -- the invariant's real intent, unchanged: not a wide overlay.
  const dock = page.locator('#melody-mobile-tools');
  await expect(dock).toBeVisible();
  const box = await dock.boundingBox();
  expect(box.width, 'the Melody HUD dock should stay a small corner HUD, like its Blast/Gravity/Snake siblings').toBeLessThanOrEqual(210);

  // #melody-controls is emptied into the drawer on mobile -- it must not render as a wide overlay.
  await expect(page.locator('#melody-controls')).toBeHidden();

  // The desktop-only keyboard instructions shouldn't contribute bulk to this compact overlay.
  await expect(page.locator('#melody-keyboard-instructions')).toBeHidden();
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

  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(500, 380, { steps: 10 }); // well past the 6px tap-vs-drag threshold
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

// LifeFolder is just FileFolder.create({...}) like MidiFolder (js/life.js) -- the readwrite-
// permission fix lives entirely in the shared js/file-folder.js code the MidiFolder tests above
// already cover in detail, but this confirms Life's own instance inherits it too, since the bug
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
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
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

// #92: Melody's next three notes each get a distinct colour in the timeline, mirrored by
// glow-next-0/1/2 on the matching Tonnetz cells -- linking board and timeline. No frequency shown.
test('Melody: the next three notes are tri-coloured in the timeline and on the Tonnetz', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await expect(page.locator('#melody-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });
  const out = await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.updateDifficultyUI();
    const tokens = [...document.querySelectorAll('#melody-note-list .note-token[data-upcoming]')];
    return {
      upcomingRanks: tokens.map((t) => t.getAttribute('data-upcoming')),
      tokenColors: tokens.map((t) => t.style.color),
      glow0: document.querySelectorAll('polygon.glow-next-0').length,
      glow1: document.querySelectorAll('polygon.glow-next-1').length,
      glow2: document.querySelectorAll('polygon.glow-next-2').length,
      hasHz: /\d+Hz/.test(document.getElementById('melody-note-list').textContent),
    };
  });
  expect(out.upcomingRanks).toEqual(['0', '1', '2']);            // the next three, ranked
  expect(new Set(out.tokenColors).size).toBe(3);                // three distinct token colours
  expect(out.glow0).toBeGreaterThan(0);                         // each rank glows on the board...
  expect(out.glow1).toBeGreaterThan(0);
  expect(out.glow2).toBeGreaterThan(0);
  expect(out.hasHz).toBe(false);                                // ...and no frequency in the timeline
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
    // configured levelCount rather than a bare literal, so it can't silently drift if a mode's
    // level count ever changes.
    if (mode === 'blast' || mode === 'gravity') {
      const levelCount = await page.evaluate((m) =>
        (m === 'blast' ? BlastMode : GravityMode)._difficultyBarbell.levelCount, mode);
      const lit = await page.locator(`#${mode}-difficulty .weight-icon.lit`).count();
      expect(lit, `${mode}: default (highest) difficulty should light all ${levelCount} weights`).toBe(levelCount);
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
    MelodyMode.state.targetLength = 8;
    MelodyMode.state.userIndex = 5;
    MelodyMode.updateDifficultyUI();
    return {
      isRandom: MelodyMode.state.isRandom,
      tokenCount: document.querySelectorAll('#melody-note-list .note-token').length,
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
    MelodyMode.state.targetLength = 8;
    MelodyMode.state.userIndex = 5;
    MelodyMode.updateDifficultyUI();
    return {
      isRandom: MelodyMode.state.isRandom,
      tokenCount: document.querySelectorAll('#melody-note-list .note-token').length,
      tickCount: document.querySelectorAll('#melody-note-list .measure-tick').length,
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
    MelodyMode.state.targetLength = MelodyMode.state.melody.length;
    MelodyMode.updateDifficultyUI();
  });

  const overflow = await page.evaluate(() => {
    const el = document.getElementById('melody-note-list');
    return el.scrollWidth > el.clientWidth;
  });
  expect(overflow, 'a 32-note song should overflow the visible timeline width').toBe(true);

  const markerBox = await page.locator('.scrub-marker').boundingBox();
  const containerBox = await page.locator('#melody-note-list').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  const edgeX = containerBox.x + containerBox.width - 5; // inside the 40px edge-scroll zone
  const edgeY = containerBox.y + containerBox.height / 2;
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(edgeX, edgeY);
  }
  const scrollLeft = await page.evaluate(() => document.getElementById('melody-note-list').scrollLeft);
  await page.mouse.up();
  expect(scrollLeft).toBeGreaterThan(0);
});

test('Melody: measure ticks appear exactly where the computed measure changes (#46 part 4)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.targetLength = MelodyMode.state.melody.length;
    MelodyMode.updateDifficultyUI(MelodyMode.state.melody.length - 1);
    const tickCount = document.querySelectorAll('#melody-note-list .measure-tick').length;
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

test('Melody: 3 clean playthroughs auto-advance the segment into the next measure (#46 part 5)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    // frere-jacques is 120bpm/4-4 -- 2s/measure -- notes 0-3 (times 0/0.5/1/1.5) are measure 0.
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.targetLength = 4;
    MelodyMode.state.cleanStreak = 0;

    const streaks = [];
    for (let pass = 0; pass < 3; pass++) {
      MelodyMode.state.userIndex = MelodyMode.state.startIndex;
      MelodyMode.state.segmentHadMistake = false;
      MelodyMode.state.isPlayingSequence = false;
      const segEnd = MelodyMode.state.targetLength;
      for (let i = MelodyMode.state.startIndex; i < segEnd; i++) {
        MelodyMode.handleUserInputNote(MelodyMode.state.melody[i].midi);
      }
      streaks.push(MelodyMode.state.cleanStreak);
    }
    return {
      streaks,
      startIndex: MelodyMode.state.startIndex,
      cleanStreak: MelodyMode.state.cleanStreak,
      startMeasure: MelodyMode.measureOf(MelodyMode.state.melody[MelodyMode.state.startIndex].time),
    };
  });
  expect(result.streaks).toEqual([1, 2, 0]); // the 3rd clean pass triggers auto-advance, resetting the streak
  expect(result.cleanStreak).toBe(0);
  expect(result.startIndex).toBeGreaterThan(0); // moved out of measure 0
  expect(result.startMeasure).toBeGreaterThan(0); // landed in a later measure, not just +1 note
});

// Reported live: "the number of times you have to get it right to advance seems to be 1" -- the
// synchronous cleanStreak>=3 block above already correctly gates the BIG (whole-measure) jump, but
// the separate 2s-idle setTimeout unconditionally grew targetLength by one note after every SINGLE
// clean pass regardless of cleanStreak, silently marching the drilled segment forward the whole
// time and defeating the point of counting a streak at all. A clean pass now has to happen 3 times
// in a row (matching the measure-jump's own threshold) before the segment moves at all -- below
// that, the idle timeout just re-drills the exact same segment again.
test('Melody: the drilled segment does not grow after a single clean pass -- it takes 3 in a row (like the measure-jump)', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);
  await page.clock.fastForward(2000); // clear resetGame's own auto-kickoff intro first (like the existing scrub tests do)

  await page.evaluate(() => {
    // resetGame's kickoff (targetLength was still 1 then) may still have its OWN "sequence
    // finished" timeout pending (js/melody.js's tId2, which sets userIndex back to its start) --
    // left alone it can fire later and stomp this test's own userIndex out from under it. Flush
    // every pending playback timer before setting up this test's own scenario.
    MelodyMode.cleanupPlayback();
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.targetLength = 4;
    MelodyMode.state.cleanStreak = 0;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.segmentHadMistake = false;
    MelodyMode.state.isPlayingSequence = false;
    for (let i = 0; i < 4; i++) MelodyMode.handleUserInputNote(MelodyMode.state.melody[i].midi);
  });
  const afterOnePass = await page.evaluate(() => ({ targetLength: MelodyMode.state.targetLength, startIndex: MelodyMode.state.startIndex }));

  await page.clock.fastForward(2500); // let the idle timeout fire
  const afterTimeout = await page.evaluate(() => ({ targetLength: MelodyMode.state.targetLength, startIndex: MelodyMode.state.startIndex }));

  expect(afterOnePass).toEqual({ targetLength: 4, startIndex: 0 });
  expect(afterTimeout, 'one clean pass should not have grown the segment').toEqual({ targetLength: 4, startIndex: 0 });
});

test('Melody: a mistake resets the clean-streak', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.targetLength = 4;
    MelodyMode.state.cleanStreak = 2; // simulate 2 clean passes already banked
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.segmentHadMistake = false;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.handleUserInputNote(MelodyMode.state.melody[0].midi + 1); // deliberately wrong
    return MelodyMode.state.cleanStreak;
  });
  expect(result).toBe(0);
});

test('Melody: a player-initiated scrub resets the clean-streak', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);

  const result = await page.evaluate(() => {
    MelodyMode.state.startIndex = 2;
    MelodyMode.state.targetLength = 4;
    MelodyMode.state.cleanStreak = 2;
    MelodyMode.seekTo(0); // a different startIndex -- player-initiated
    return MelodyMode.state.cleanStreak;
  });
  expect(result).toBe(0);
});

test('Melody: loading a new song resets the clean-streak', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await loadFrereJacques(page);
  await page.evaluate(() => { MelodyMode.state.cleanStreak = 2; });
  await loadFrereJacques(page); // resetGame() runs again as part of loading
  const streak = await page.evaluate(() => MelodyMode.state.cleanStreak);
  expect(streak).toBe(0);
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
// discoverable by opening the loaded .yaml file.
test('Life: the current rule is displayed underneath the generation counter', async ({ page }) => {
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
  expect(text).toContain('9, 9');
  expect(download.suggestedFilename()).toMatch(/\.ya?ml$/i);
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
// docs/melody-notation-design.md's central workflow: select a time range on the (still minimal,
// pre-grand-staff) timeline, watch it flatten onto the Tonnetz, then transform it -- pitch changes,
// time never does. #compose-timeline is a stand-in for the eventual VexFlow staff; the selection
// mechanism and the transform math (translateSelection/rotateSelection) are the real, durable part.
// ────────────────────────────────────────────────────────────────────────

test('Compose: the timeline renders one token per note, in TIME order (not array-insertion order)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());
  await page.evaluate(() => {
    // Deliberately inserted out of time order -- the timeline must still read left-to-right by time.
    ComposeMode.state.notes = [
      { midi: 64, p: 1, q: 0, time: 1.0, duration: 0.4 },
      { midi: 60, p: 0, q: 0, time: 0.0, duration: 0.4 },
      { midi: 67, p: 0, q: 1, time: 2.0, duration: 0.4 },
    ];
    ComposeMode.refreshBoard();
  });
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#compose-timeline .note-token')].map(t => parseInt(t.getAttribute('data-note-idx'), 10))
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

test('Notation.render: an empty note array renders nothing and returns null (no crash)', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'notation-test-container-4';
    document.body.appendChild(container);
    const r = Notation.render('notation-test-container-4', [], { bpm: 120 });
    return { r, childCount: container.children.length };
  });
  expect(result.r).toBeNull();
  expect(result.childCount).toBe(0);
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

test('Melody: the grand staff renders real notes once a song is loaded, matching the Random-vs-song timeline it mirrors', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await page.waitForFunction(() => document.querySelectorAll('#melody-staff svg').length > 0 || document.getElementById('melody-note-list').children.length > 0, { timeout: 3000 });
  const notesOnTimeline = await page.evaluate(() => document.querySelectorAll('#melody-note-list .note-token').length);
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
