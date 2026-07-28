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
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await page.evaluate(() => {
    MidiMode.state.difficulty = 'easy';
    MidiMode.state.userIndex = 3;
    MidiMode.updateDifficultyUI();
  });

  const opacities = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('#midi-note-list [data-note-role="past"]'));
    const byDistance = {};
    spans.forEach(s => { byDistance[s.getAttribute('data-distance')] = parseFloat(s.style.opacity); });
    return byDistance;
  });

  expect(opacities['1']).toBeGreaterThan(opacities['2']);
  expect(opacities['2']).toBeGreaterThan(opacities['3']);
});

test('updateDifficultyUI(overrideIndex) pivots the window on the override, not state.userIndex', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  const currentName = await page.evaluate(() => {
    MidiMode.state.difficulty = 'easy';
    MidiMode.state.userIndex = 0; // would normally show melody[0] as current
    MidiMode.updateDifficultyUI(5); // override to pivot on index 5 instead
    const el = document.querySelector('#midi-note-list [data-note-role="current"]');
    return el ? el.textContent : null;
  });

  // Octave-qualified (e.g. "E4", not bare "E") since INV-25 -- two different-octave notes
  // sharing a bare name were an understandable "wrong note" mix-up (real report), fixed by
  // making the octave part of every displayed name, not just the current target's.
  const expectedName = await page.evaluate(() => {
    const midi = MidiMode.state.melody[5].midi;
    return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

test('playing the full melody preview live-updates the note list as it plays', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.evaluate(() => { MidiMode.state.difficulty = 'easy'; });

  // resetGame() schedules an untracked 1s auto-kickoff of the "listen to the notes" teaching
  // intro that cleanupPlayback() can't cancel — let it fully play out and finish first so it
  // doesn't fire mid-test and wipe our own preview's scheduled timeouts via its own cleanup.
  await page.clock.fastForward(2000);

  await page.locator('#midi-play-preview').click();

  // Advance to when the 3rd note (index 2, "buns", scheduled ~1.2s into the preview) should be sounding
  await page.clock.fastForward(1300);

  const currentName = await page.evaluate(() => {
    const el = document.querySelector('#midi-note-list [data-note-role="current"]');
    return el ? el.textContent : null;
  });
  // Octave-qualified since INV-25 -- see the comment on the preceding test.
  const expectedName = await page.evaluate(() => {
    const midi = MidiMode.state.melody[2].midi;
    return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

test('stopping preview restores the note list to reflect actual game progress', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.evaluate(() => {
    MidiMode.state.difficulty = 'easy';
    MidiMode.state.userIndex = 1; // simulate the player having already gotten 1 note right
  });

  // Let the auto-kickoff teaching intro (see comment in the preceding test) finish first.
  await page.clock.fastForward(2000);
  await page.evaluate(() => { MidiMode.state.userIndex = 1; }); // teaching intro reset it to 0

  await page.locator('#midi-play-preview').click();
  await page.clock.fastForward(1300); // let preview scrub ahead to index 2

  // Manually stop the preview (the play button now shows the ⏹ stop icon)
  await page.locator('#midi-play-preview').click();

  const currentName = await page.evaluate(() => {
    const el = document.querySelector('#midi-note-list [data-note-role="current"]');
    return el ? el.textContent : null;
  });
  // Octave-qualified since INV-25 -- see the comment on the earlier "pivots the window" test.
  const expectedName = await page.evaluate(() => {
    const midi = MidiMode.state.melody[MidiMode.state.userIndex].midi;
    return `${Tonnetz.getNoteName(midi)}${Tonnetz.getOctave(midi)}`;
  });
  expect(currentName).toBe(expectedName);
});

// ────────────────────────────────────────────────────────────────────────
// MidiFolder (js/midi-folder.js, task #27): local MIDI folder source, replacing the plain
// upload picker on browsers that support the File System Access API. window.showDirectoryPicker
// is mocked with a fake directory handle (real handles are structured-cloneable into IndexedDB
// specifically so they survive a real user's picker choice -- a fake JS object with methods is
// NOT structured-cloneable, so these tests exercise MidiFolder's own logic/wiring directly
// rather than round-tripping through real IndexedDB). MidiMode.parseMIDI is stubbed too, since
// what's under test here is folder browsing, not Standard MIDI File decoding (which has no
// coverage of its own yet, tracked separately -- not something to conflate with this feature).
// ────────────────────────────────────────────────────────────────────────

// Each fake file's "bytes" are just a one-byte tag identifying which fake file it is; the
// parseMIDI stub reads that tag back out, so a distinct, easily-asserted MIDI note stands in for
// "this specific file's real content loaded" without needing real Standard MIDI File bytes.
const installFakeMidiFolder = (page, { files, permission = 'granted' }) => page.evaluate(({ files, permission }) => {
  // Real FileSystemDirectoryHandles are structured-cloneable (by design, so they survive an
  // IndexedDB round-trip) -- a fake JS object with methods is NOT, so saveHandle would throw a
  // real DataCloneError against a fake handle. Stubbed out here since these tests exercise
  // MidiFolder's own browsing/restore logic, not real IndexedDB persistence.
  MidiFolder.saveHandle = async () => {};
  window.__parseMIDICalls = [];
  MidiMode.parseMIDI = (buf) => {
    const tag = new Uint8Array(buf)[0];
    window.__parseMIDICalls.push(tag);
    return { notes: [{ midi: 60 + tag, time: 0, duration: 0.5 }] };
  };

  const entries = files.map(f => ({
    kind: 'file',
    name: f.name,
    getFile: async () => ({ name: f.name, arrayBuffer: async () => new Uint8Array([f.tag]).buffer }),
  }));
  window.__fakeFolderHandle = {
    name: 'MySongs',
    values: async function* () { for (const e of entries) yield e; },
    queryPermission: async () => permission,
    requestPermission: async () => 'granted',
  };
  window.showDirectoryPicker = async () => window.__fakeFolderHandle;
}, { files, permission });

test('MidiFolder: choosing a folder lists only .mid/.midi files (sorted) and auto-loads the first', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, {
    files: [
      { name: 'Zebra.mid', tag: 0 },
      { name: 'Apple.midi', tag: 1 },
      { name: 'readme.txt', tag: 2 }, // not a MIDI file -- must be filtered out
    ],
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await page.locator('#midi-choose-folder-btn').click();
  await page.waitForFunction(() => document.getElementById('midi-folder-files').options.length > 0);

  const optionNames = await page.evaluate(() =>
    Array.from(document.getElementById('midi-folder-files').options).map(o => o.textContent)
  );
  // Sorted alphabetically, and readme.txt excluded entirely.
  expect(optionNames).toEqual(['Apple', 'Zebra']);

  // The first file in SORTED order (Apple, tag 1) auto-loads, not upload order (Zebra was listed
  // first in the fake folder above).
  const loadedMidi = await page.evaluate(() => MidiMode.state.melody[0].midi);
  expect(loadedMidi).toBe(61);
});

test('MidiFolder: selecting a different dropdown entry loads that file instead', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, {
    files: [{ name: 'Apple.mid', tag: 0 }, { name: 'Banana.mid', tag: 1 }],
  });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await page.locator('#midi-choose-folder-btn').click();
  await page.waitForFunction(() => document.getElementById('midi-folder-files').options.length > 0);
  expect(await page.evaluate(() => MidiMode.state.melody[0].midi)).toBe(60); // Apple auto-loaded

  await page.locator('#midi-folder-files').selectOption({ label: 'Banana' });
  await page.waitForFunction(() => MidiMode.state.melody[0].midi === 61);
  expect(await page.evaluate(() => MidiMode.state.melody[0].midi)).toBe(61);
});

test('MidiFolder: a granted saved folder restores silently on entering Melody mode, no click needed', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Saved.mid', tag: 5 }], permission: 'granted' });
  await page.evaluate(() => {
    MidiFolder.loadHandle = async () => window.__fakeFolderHandle;
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.waitForFunction(() => document.getElementById('midi-folder-files').options.length > 0);

  expect(await page.evaluate(() => MidiMode.state.melody[0].midi)).toBe(65);
  await expect(page.locator('#midi-folder-status')).toHaveText(/MySongs/);
});

test('MidiFolder: a lapsed (non-granted) saved folder shows a one-click reconnect instead of silently failing', async ({ page }) => {
  await page.goto('/');
  await installFakeMidiFolder(page, { files: [{ name: 'Saved.mid', tag: 2 }], permission: 'prompt' });
  await page.evaluate(() => {
    MidiFolder.loadHandle = async () => window.__fakeFolderHandle;
  });

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.waitForFunction(() => document.getElementById('midi-folder-status').textContent.includes('Reconnect'));

  // No file should have loaded yet -- permission wasn't granted, so nothing was silently read.
  expect(await page.evaluate(() => document.getElementById('midi-folder-files').options.length)).toBe(0);

  await page.locator('#midi-choose-folder-btn').click(); // now reads "Reconnect Folder"
  await page.waitForFunction(() => document.getElementById('midi-folder-files').options.length > 0);
  expect(await page.evaluate(() => MidiMode.state.melody[0].midi)).toBe(62);
});

test('MidiFolder: on an unsupported browser, the folder UI stays hidden and the plain upload picker is untouched', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { delete window.showDirectoryPicker; });
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await expect(page.locator('#midi-folder-group')).toBeHidden();
  await expect(page.locator('#midi-upload-group')).toBeVisible();
});

// ────────────────────────────────────────────────────────────────────────
// MidiFolder's online song folder (task #27): a plain relative fetch to ./midi/index.json, no
// File System Access API involved -- works in every browser, degrades to "hidden" on any
// failure (offline, file://, 404) rather than surfacing an error, since it's a bonus content
// tier, not a required one.
// ────────────────────────────────────────────────────────────────────────

test('MidiFolder online: populates the dropdown from index.json, and selecting a song loads the real fetched file', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Test Song A', file: 'a.mid' }, { name: 'Test Song B', file: 'b.mid' }],
  }));
  await page.goto('/');

  // MIDI 60 specifically -- MidiMode.loadMelodyFromArrayBuffer runs loaded notes through
  // centerMelody(), which shifts by whole octaves toward 60; a non-centered test note would get
  // silently transposed, making this assertion fail for the wrong reason.
  const bytes = await page.evaluate(() => Array.from(new Uint8Array(MidiMode.writeMIDI([{ midi: 60, time: 0, duration: 0.4 }]))));
  await page.route('**/midi/b.mid', route => route.fulfill({ body: Buffer.from(bytes), contentType: 'audio/midi' }));

  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.waitForFunction(() => document.getElementById('midi-online-files').options.length > 0);

  const select = page.locator('#midi-online-files');
  const optionNames = await page.evaluate(() =>
    Array.from(document.getElementById('midi-online-files').options).map(o => o.textContent)
  );
  // No "Choose a song..." placeholder -- the first entry is simply the dropdown's own default
  // selection, matching the melody already loaded on entry, not a separate status line.
  expect(optionNames).toEqual(['Test Song A', 'Test Song B']);
  expect(await select.inputValue()).toBe('0');

  await select.selectOption({ label: 'Test Song B' });
  await page.waitForFunction(() => MidiMode.state.melody.length === 1 && MidiMode.state.melody[0].midi === 60);
});

test('MidiFolder online: a failed fetch (offline/404) hides the online group instead of erroring', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await expect(page.locator('#midi-online-group')).toBeHidden();
});

test('MidiFolder online: Compose gets the same bundled songs via its own dropdown', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.fulfill({
    json: [{ name: 'Test Song A', file: 'a.mid' }],
  }));
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.waitForFunction(() => document.getElementById('compose-online-files').options.length > 0);
  const optionNames = await page.evaluate(() =>
    Array.from(document.getElementById('compose-online-files').options).map(o => o.textContent)
  );
  expect(optionNames).toEqual(['Test Song A']);
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
  for (const mode of ['midi', 'compose', 'snake', 'gravity']) {
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
// and Save (via MidiMode.writeMIDI + MidiFolder.saveFileAs, both new). Per-note drag-to-
// reposition/retime, a timeline view, and polyphony are explicitly deferred.
// ────────────────────────────────────────────────────────────────────────

test('Compose: tapping cells while recording appends notes with the tapped cell\'s own pitch and increasing time', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="compose"]').click());

  await page.locator('#compose-record').click();
  await expect(page.locator('#compose-record')).toHaveText('Stop Recording');

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

  await page.evaluate(() => {
    ComposeMode.state.notes = [
      { midi: 60, p: 0, q: 0, time: 0, duration: 0.4 },
      { midi: 64, p: 1, q: 0, time: 0.5, duration: 0.4 },
    ];
  });

  await page.locator('#compose-undo').click();

  const notes = await page.evaluate(() => ComposeMode.state.notes);
  expect(notes).toEqual([{ midi: 60, p: 0, q: 0, time: 0, duration: 0.4 }]);
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
    const parsed = MidiMode.parseMIDI(buf);
    return MidiMode.extractMonophonicMelody(parsed).map(n => ({ midi: n.midi, time: n.time }));
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
    MidiMode.parseMIDI = () => ({
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
// OR mouse), despite Render.getPanBounds() already listing 'midi' among the free-pan modes.
// Uses Playwright's real mouse API (not a synthetic .click()), matching this project's existing
// discipline for touch events -- a real mousedown-then-move sequence is what actually exercises
// the drag-vs-click distinction, not a single synthetic event.
// ────────────────────────────────────────────────────────────────────────

test('Melody mode: dragging the mouse pans the Tonnetz, and still plays the clicked cell\'s note', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  // resetGame()'s auto-kickoff "listen to the notes" intro sets isPlayingSequence, which blocks
  // svg.onmousedown entirely (including the pan it starts) until it finishes.
  await expect(page.locator('#midi-game-status')).toHaveText(/Your turn!/, { timeout: 8000 });

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
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  // A small, realistic pan offset -- large enough to prove refreshBoard() didn't just reset to the
  // default view, but well within Render.getPanBounds()'s allowed range so this verifies
  // persistence, not clamping (a separate, already-covered concern). The pannable view is now held
  // as a CENTER (Render.panView / INV-44), so this sets the mode's stored center and checks the
  // rendered view center survives the refresh, rather than the aspect-dependent viewBox top-left.
  await page.evaluate(() => {
    MidiMode.refreshBoard(); // initialize the center (null -> origin) before offsetting it
    MidiMode.state.viewX = -60;
    MidiMode.state.viewY = -40;
    MidiMode.refreshBoard();
  });

  await page.evaluate(() => MidiMode.refreshBoard());

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
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.clock.fastForward(2000); // let the auto-kickoff intro finish; targetLength stays 1

  await expect(page.locator('.scrub-marker')).toHaveCount(0);
});

test('Melody mode: the scrub marker appears once the drilled segment grows, sitting right before the note it targets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await page.evaluate(() => {
    MidiMode.state.targetLength = 4;
    MidiMode.state.startIndex = 2;
    MidiMode.updateDifficultyUI();
  });

  await expect(page.locator('.scrub-marker')).toHaveCount(1);
  // The marker must sit immediately before the note token it targets (startIndex), not just
  // anywhere in the list.
  const isImmediatelyBefore = await page.evaluate(() => {
    const marker = document.querySelector('.scrub-marker');
    const nextEl = marker.nextElementSibling;
    return nextEl && nextEl.classList.contains('note-token') && nextEl.getAttribute('data-note-idx') === String(MidiMode.state.startIndex);
  });
  expect(isImmediatelyBefore).toBe(true);
});

test('Melody mode: the scrub control clamps to notes already reached, never past targetLength', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await page.evaluate(() => {
    MidiMode.state.targetLength = 4;
    MidiMode.updateDifficultyUI();
  });

  const clamped = await page.evaluate(() => {
    MidiMode.seekTo(99); // far beyond targetLength - 1
    return MidiMode.state.startIndex;
  });
  expect(clamped).toBe(3);
});

test('Melody mode: dragging the scrub marker back replays the skipped-over earlier notes', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.clock.fastForward(2000); // clear the auto-kickoff intro

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MidiMode.state.targetLength = 4;
    MidiMode.state.startIndex = 2; // simulate having already drilled through note 2
    MidiMode.updateDifficultyUI();
  });

  const markerBox = await page.locator('.scrub-marker').boundingBox();
  const targetBox = await page.locator('.note-token[data-note-idx="0"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => MidiMode.state.startIndex)).toBe(0);

  await page.clock.fastForward(5000); // let the whole replayed segment (notes 0..3) finish

  const playedFromZero = await page.evaluate(() => {
    const expected = MidiMode.state.melody.slice(0, 4).map(n => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedFromZero).toBe(true);
  expect(await page.evaluate(() => MidiMode.state.userIndex)).toBe(0);
});

test('Melody mode: dragging the scrub marker forward skips already-mastered notes on replay', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.clock.fastForward(2000);

  await page.evaluate(() => {
    window.__played = [];
    Synth.playNote = (midi) => window.__played.push(midi);
    MidiMode.state.targetLength = 4;
    MidiMode.updateDifficultyUI();
  });

  const markerBox = await page.locator('.scrub-marker').boundingBox();
  const targetBox = await page.locator('.note-token[data-note-idx="2"]').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
  await page.mouse.up();

  await page.clock.fastForward(5000);

  const playedFromTwo = await page.evaluate(() => {
    const expected = MidiMode.state.melody.slice(2, 4).map(n => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedFromTwo).toBe(true);
  expect(await page.evaluate(() => MidiMode.state.userIndex)).toBe(2);
});

test('Melody mode: a wrong note resets progress back to the scrub position, not always to note 0', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.clock.fastForward(2000);

  const resetIndex = await page.evaluate(() => {
    MidiMode.state.isPlayingSequence = false;
    MidiMode.state.targetLength = 4;
    MidiMode.state.startIndex = 2; // player scrubbed to replay from note 2
    MidiMode.state.userIndex = 3;  // got note 2 right, currently on note 3
    MidiMode.handleUserInputNote(-1); // guaranteed wrong pitch
    return MidiMode.state.userIndex;
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

// Render.getPanBounds() (js/render.js) only returns real bounds for Sandbox/Blast/Melody
// ('midi') — the three modes with a free-panning, unrestricted Tonnetz. Exercise all three,
// not just Sandbox, so a future mode added to (or accidentally dropped from) that allowlist
// gets caught here instead of only being noticed by whichever mode someone happens to test by
// hand.
for (const mode of ['sandbox', 'blast', 'midi']) {
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
// (top/left: 10px) HUD overlays capped at max-width: 200px -- but #midi-controls's own version
// of that same rule never got the position/max-width pair its siblings have, so it defaulted to
// its natural (wide, content-driven) flow width while still being position:absolute, floating
// over the board instead of being constrained to a small corner box. Separately,
// #midi-keyboard-instructions (.desktop-only) is only hidden by the touch-pointer and
// max-width:767px rules -- not this landscape one -- so it kept contributing extra bulk here too.
// ────────────────────────────────────────────────────────────────────────

test('INV-31: Melody\'s always-visible controls stay a small corner HUD (not a wide overlay) at a landscape width under 950px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  // The always-visible Melody controls (streak readout + the Play/Restart transport icons) live
  // in the mobile dock; one-time setup (folder/song pickers, Difficulty) now routes to the drawer
  // and #midi-controls itself is emptied + hidden on mobile (task #77). Guard the DOCK's width so
  // the HUD stays compact -- the invariant's real intent, unchanged: not a wide overlay.
  const dock = page.locator('#midi-mobile-tools');
  await expect(dock).toBeVisible();
  const box = await dock.boundingBox();
  expect(box.width, 'the Melody HUD dock should stay a small corner HUD, like its Blast/Gravity/Snake siblings').toBeLessThanOrEqual(210);

  // #midi-controls is emptied into the drawer on mobile -- it must not render as a wide overlay.
  await expect(page.locator('#midi-controls')).toBeHidden();

  // The desktop-only keyboard instructions shouldn't contribute bulk to this compact overlay.
  await expect(page.locator('#midi-keyboard-instructions')).toBeHidden();
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
  await page.waitForFunction(() => typeof LifeMode !== 'undefined' && LifeMode._loadedOnline === true, { timeout: 3000 });

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

// #86: Melody no longer bundles a built-in default song (the online midi/ folder supplies real
// songs). With no web connection (and no local folder), it degrades to a random 10-note sequence
// within a single octave so the drill is always playable.
test('Melody: offline (no online folder) degrades to a random 10-note, one-octave sequence', async ({ page }) => {
  await page.route('**/midi/index.json', route => route.abort());
  await page.route('**/midi/*.mid', route => route.abort());
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.waitForTimeout(600);
  const melody = await page.evaluate(() => MidiMode.state.melody.map(n => n.midi));
  expect(melody.length, 'random fallback is 10 notes').toBe(10);
  expect(Math.max(...melody) - Math.min(...melody), 'all within one octave').toBeLessThan(12);
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

      // Easy: only small pieces (never a full four-cell tetrahex).
      const easy = await sizesFor(Mode, 'easy');
      expect(Math.max(...easy), `${mode} easy should deal small pieces`).toBeLessThanOrEqual(3);

      // Hard: exclusively four-cell tetrahexes (the current default game).
      const hard = await sizesFor(Mode, 'hard');
      expect(hard, `${mode} hard should deal only tetrahexes`).toEqual([4]);

      // Medium sits between -- includes 4-cell pieces but also at least one smaller size.
      const medium = await sizesFor(Mode, 'medium');
      expect(medium.includes(4) && Math.min(...medium) < 4, `${mode} medium should mix sizes`).toBe(true);

      // The dumbbell triplet: clicking the Nth weight sets that level and lights 1/2/3 of them.
      for (const [diff, lit] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
        await page.click(`#${mode}-difficulty .weight-icon[data-difficulty="${diff}"]`);
        const state = await page.evaluate((M) => (M === 'BlastMode' ? BlastMode : GravityMode).state.difficulty, Mode);
        expect(state, `${mode} clicking ${diff} weight`).toBe(diff);
        const litCount = await page.$$eval(`#${mode}-difficulty .weight-icon.lit`, els => els.length);
        expect(litCount, `${mode} ${diff} should light ${lit} weights`).toBe(lit);
      }
    });
  }
});
