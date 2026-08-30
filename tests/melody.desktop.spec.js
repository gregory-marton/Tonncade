/*
 * Melody regression coverage for the difficulty/progression contract.
 *
 * Copyright (C) 2026 Gregory Marton
 * Co-authored-by: GPT-5, Aug 2026
 */
const { test, expect } = require('@playwright/test');

const installMelodyFixture = (page) => page.evaluate(() => {
  MelodyMode.cleanupPlayback();
  MelodyMode.state.melody = [
    { midi: 60, time: 0, duration: 0.4 },
    { midi: 62, time: 0.5, duration: 0.4 },
    { midi: 64, time: 1, duration: 0.4 },
  ];
  MelodyMode.state.isRandom = true;
  MelodyMode.state.isPlayingSequence = false;
  MelodyMode.state.isPlayingPreview = false;
  MelodyMode.state.startIndex = 0;
  MelodyMode.state.endIndex = 1;
  MelodyMode.state.userIndex = 0;
  MelodyMode.state.keySignature = null;
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', async dialog => dialog.accept());
  await page.goto('/');
  await page.evaluate(() => document.querySelector('.mode-option[data-mode="melody"]').click());
  await installMelodyFixture(page);
});

test('Melody level 3 keeps the staff and current target visible', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.difficulty = 3;
    MelodyMode.updateDifficultyUI();
    return {
      tokenCount: document.querySelectorAll('#melody-staff-labels .note-token').length,
      currentCount: document.querySelectorAll('#melody-staff-labels [data-note-role="current"]').length,
    };
  });

  expect(result.tokenCount).toBe(1);
  expect(result.currentCount).toBe(1);
});

test('Melody level 2 keeps the current Random event visible and advances on correct input', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.difficulty = 2;
    MelodyMode.updateDifficultyUI();
    const before = document.querySelectorAll('#melody-staff-labels [data-note-role="current"]').length;
    MelodyMode.handleUserInputNote(60);
    const after = document.querySelectorAll('#melody-staff-labels [data-note-role="current"]').length;
    return { before, after, userIndex: MelodyMode.state.userIndex };
  });

  expect(result.before).toBe(1);
  expect(result.userIndex).toBe(1);
  expect(result.after).toBe(1);
});

test('Melody level 1 Random does not celebrate finite fallback data as a song win', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.difficulty = 1;
    MelodyMode.state.melody = [{ midi: 60, time: 0, duration: 0.4 }];
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 0;
    MelodyMode.state.userIndex = 0;
    MelodyMode.updateDifficultyUI();
    MelodyMode.handleUserInputNote(60);
    return {
      userIndex: MelodyMode.state.userIndex,
      confettiCount: document.querySelectorAll('#melody-notation-scroll .confetti-piece').length,
    };
  });

  expect(result.userIndex).toBe(0);
  expect(result.confettiCount).toBe(0);
});
