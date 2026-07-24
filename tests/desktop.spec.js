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

  // Manually stop the preview (button now reads "Stop Preview")
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

  // A small, realistic offset from the -400/-300 default -- large enough to prove refreshBoard()
  // didn't just reset to the fixed default, but well within Render.getPanBounds()'s allowed
  // range so this test verifies persistence, not clamping (a separate, already-covered concern).
  await page.evaluate(() => {
    MidiMode.state.viewX = -450;
    MidiMode.state.viewY = -320;
    Render.updateView(-450, -320, Render.zoom);
  });

  await page.evaluate(() => MidiMode.refreshBoard());

  const view = await page.evaluate(() => ({ x: Render.viewX, y: Render.viewY }));
  expect(view).toEqual({ x: -450, y: -320 });
});

// ────────────────────────────────────────────────────────────────────────
// Melody mode replay-from scrub control (#46 low-hanging fruit): lets a player replay the
// drilled segment starting from any note already reached, instead of always restarting from
// note 0 -- useful both to relisten to an earlier stretch and to skip past notes already
// mastered. Clamped to [0, targetLength - 1].
// ────────────────────────────────────────────────────────────────────────

test('Melody mode: the replay-from scrub control stays hidden until more than one note has been reached', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());
  await page.clock.fastForward(2000); // let the auto-kickoff intro finish; targetLength stays 1

  await expect(page.locator('#midi-start-slider')).toBeHidden();
});

test('Melody mode: the scrub control appears and its range grows as the drilled segment grows', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="midi"]').click());

  await page.evaluate(() => {
    MidiMode.state.targetLength = 4;
    MidiMode.updateDifficultyUI();
  });

  await expect(page.locator('#midi-start-slider')).toBeVisible();
  expect(await page.locator('#midi-start-slider').getAttribute('max')).toBe('3'); // targetLength - 1
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

test('Melody mode: dragging the scrub control back replays the skipped-over earlier notes', async ({ page }) => {
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

  await page.evaluate(() => {
    const slider = document.getElementById('midi-start-slider');
    slider.value = '0';
    slider.dispatchEvent(new Event('change'));
  });
  expect(await page.evaluate(() => MidiMode.state.startIndex)).toBe(0);

  await page.clock.fastForward(5000); // let the whole replayed segment (notes 0..3) finish

  const playedFromZero = await page.evaluate(() => {
    const expected = MidiMode.state.melody.slice(0, 4).map(n => n.midi);
    return JSON.stringify(window.__played) === JSON.stringify(expected);
  });
  expect(playedFromZero).toBe(true);
  expect(await page.evaluate(() => MidiMode.state.userIndex)).toBe(0);
});

test('Melody mode: dragging the scrub control forward skips already-mastered notes on replay', async ({ page }) => {
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

  await page.evaluate(() => {
    const slider = document.getElementById('midi-start-slider');
    slider.value = '2';
    slider.dispatchEvent(new Event('change'));
  });

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
