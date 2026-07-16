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
