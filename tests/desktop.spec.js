const { test, expect } = require('@playwright/test');

test('desktop page title is correct', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Tonncade/);
});

test('chord guide has no placeholder explanation text before a chord is chosen', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('#chord-guide-results').innerText();
  expect(text.trim()).toBe('');
});

test('chord guide results show a piece preview matching the correct rotation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const chordSelect = page.locator('#chord-guide-select');
  await chordSelect.selectOption('major');

  const firstMatch = page.locator('.chord-match-item').first();
  await expect(firstMatch).toBeVisible();

  const preview = firstMatch.locator('.chord-match-preview');
  await expect(preview).toBeAttached();

  const info = await page.evaluate(() => {
    const item = document.querySelector('.chord-match-item');
    const type = item.getAttribute('data-type');
    const rotation = parseInt(item.getAttribute('data-rotation'));
    const expectedCells = Pieces.getAbsoluteCells(type, 0, 0, rotation);
    const renderedHexes = item.querySelectorAll('.chord-match-preview polygon');
    return { expectedCount: expectedCells.length, renderedCount: renderedHexes.length };
  });

  expect(info.renderedCount).toBeGreaterThan(0);
  expect(info.renderedCount).toBe(info.expectedCount);

  // The old static "Use" badge text should be gone
  const badgeText = await firstMatch.locator('span').allTextContents();
  expect(badgeText.join('')).not.toContain('Use');
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

  const expectedName = await page.evaluate(() => Tonnetz.getNoteName(MidiMode.state.melody[5].midi));
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
  const expectedName = await page.evaluate(() => Tonnetz.getNoteName(MidiMode.state.melody[2].midi));
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
  const expectedName = await page.evaluate(() => Tonnetz.getNoteName(MidiMode.state.melody[MidiMode.state.userIndex].midi));
  expect(currentName).toBe(expectedName);
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

test('panning cannot scroll far past the edge of the audible tonnetz', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="sandbox"]').click());

  const result = await page.evaluate(() => {
    Render.updateView(-1000000, -1000000, 1);
    const afterNegative = { x: Render.viewX, y: Render.viewY };
    Render.updateView(1000000, 1000000, 1);
    const afterPositive = { x: Render.viewX, y: Render.viewY };
    const bounds = Render.getPanBounds();
    return { afterNegative, afterPositive, bounds };
  });

  expect(result.bounds).not.toBeNull();
  expect(result.afterNegative.x).toBeCloseTo(result.bounds.minX, 0);
  expect(result.afterNegative.y).toBeCloseTo(result.bounds.minY, 0);
  expect(result.afterPositive.x).toBeCloseTo(result.bounds.maxX - 800, 0);
  expect(result.afterPositive.y).toBeCloseTo(result.bounds.maxY - 600, 0);
});
