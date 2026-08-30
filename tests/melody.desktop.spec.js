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

  expect(result.tokenCount).toBe(3);
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

test('Melody level 1 Random grows after a prefix instead of celebrating a finite fallback', async ({ page }) => {
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

  expect(result.userIndex).toBe(1);
  expect(result.confettiCount).toBe(0);
});

test('Melody MIDI import preserves simultaneous notes instead of reducing them to one pitch', async ({ page }) => {
  const result = await page.evaluate(() => {
    const buffer = MelodyMode.writeMIDI([
      { midi: 48, time: 0, duration: 0.4 },
      { midi: 55, time: 0, duration: 0.4 },
      { midi: 60, time: 0.5, duration: 0.4 },
    ]);
    MelodyMode.loadMelodyFromArrayBuffer(buffer, 'polyphonic.mid');
    return MelodyMode.state.melody.map((note) => ({ midi: note.midi, time: note.time }));
  });

  expect(result).toHaveLength(3);
  expect(result.slice(0, 2).map((note) => note.midi).sort((a, b) => a - b)).toEqual([48, 55]);
  expect(result[0].time).toBe(result[1].time);
});

test('Compose MIDI import preserves simultaneous notes for continued editing', async ({ page }) => {
  const result = await page.evaluate(() => {
    const buffer = MelodyMode.writeMIDI([
      { midi: 48, time: 0, duration: 0.4 },
      { midi: 55, time: 0, duration: 0.4 },
      { midi: 60, time: 0.5, duration: 0.4 },
    ]);
    ComposeMode.loadMelodyFromArrayBuffer(buffer, 'polyphonic.mid');
    return ComposeMode.state.notes.map((note) => ({ midi: note.midi, time: note.time }));
  });

  expect(result).toHaveLength(3);
  expect(result.slice(0, 2).map((note) => note.midi).sort((a, b) => a - b)).toEqual([48, 55]);
  expect(result[0].time).toBe(result[1].time);
});

test('Notation places same-onset notes at one staff position as a chord', async ({ page }) => {
  const positions = await page.evaluate(() => Notation.render('melody-staff', [
    { midi: 60, time: 0, duration: 0.4 },
    { midi: 64, time: 0, duration: 0.4 },
  ], { bpm: 120 }).noteXPositions);

  expect(positions).toHaveLength(2);
  expect(positions[0].x).toBe(positions[1].x);
});

test('Notation keeps per-member staff feedback when chord members share a clef', async ({ page }) => {
  const colors = await page.evaluate(() => {
    Notation.render('melody-staff', [
      { id: 0, midi: 60, time: 0, duration: 0.4 },
      { id: 1, midi: 64, time: 0, duration: 0.4 },
    ], {
      bpm: 120,
      decorateNote: (entry) => ({ style: { fillStyle: entry.id === 0 ? '#ff0000' : '#00ff00', strokeStyle: entry.id === 0 ? '#ff0000' : '#00ff00' } }),
    });
    return {
      red: document.querySelectorAll('#melody-staff [fill="#ff0000"]').length,
      green: document.querySelectorAll('#melody-staff [fill="#00ff00"]').length,
    };
  });

  expect(colors.red).toBeGreaterThan(0);
  expect(colors.green).toBeGreaterThan(0);
});

test('Notation groups near-simultaneous off-grid notes using the same event tolerance as Melody', async ({ page }) => {
  const positions = await page.evaluate(() => Notation.render('melody-staff', [
    { midi: 60, time: 0.05, duration: 0.4 },
    { midi: 64, time: 0.11, duration: 0.4 },
  ], { bpm: 120 }).noteXPositions);

  expect(positions).toHaveLength(2);
  expect(positions[0].x).toBe(positions[1].x);
});

test('Notation omits a wholly silent clef without changing the decision for a mixed song', async ({ page }) => {
  const result = await page.evaluate(() => ({
    trebleOnly: Notation.render('melody-staff', [
      { midi: 72, time: 0, duration: 0.4 },
      { midi: 76, time: 0.5, duration: 0.4 },
    ], { bpm: 120 }),
    mixed: Notation.render('melody-staff', [
      { midi: 48, time: 0, duration: 0.4 },
      { midi: 72, time: 0.5, duration: 0.4 },
    ], { bpm: 120 }),
  }));

  expect(result.trebleOnly.staveBounds.bassTop).toBeNull();
  expect(result.trebleOnly.height).toBeLessThan(result.mixed.height);
  expect(result.mixed.staveBounds.bassTop).toBeGreaterThan(0);
});

test('Melody gives partial credit for a chord and advances only after every member is played', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.cleanupPlayback();
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 64, time: 0, duration: 0.4 },
      { midi: 67, time: 0.5, duration: 0.4 },
    ];
    MelodyMode.state.isRandom = false;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.isPlayingPreview = false;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 2;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.matchedChordNotes = [];
    MelodyMode.handleUserInputNote(60);
    const partial = {
      userIndex: MelodyMode.state.userIndex,
      matched: MelodyMode.state.matchedChordNotes.slice(),
    };
    MelodyMode.handleUserInputNote(64);
    return {
      partial,
      completed: {
        userIndex: MelodyMode.state.userIndex,
        matched: MelodyMode.state.matchedChordNotes.slice(),
      },
    };
  });

  expect(result.partial.userIndex).toBe(0);
  expect(result.partial.matched).toEqual([0]);
  expect(result.completed.userIndex).toBe(2);
  expect(result.completed.matched).toEqual([]);
});

test('Melody does not flash an already-correct chord member when a later member is missed', async ({ page }) => {
  const flashing = await page.evaluate(() => {
    MelodyMode.state.isRandom = false;
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 64, time: 0, duration: 0.4 },
    ];
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.matchedChordNotes = [];
    MelodyMode.state.notePerformance = {};
    MelodyMode.state.mistakeFlashNotes = {};
    MelodyMode.handleUserInputNote(60);
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.handleUserInputNote(99);
    return {
      accepted: MelodyMode.state.mistakeFlashNotes[0] || null,
      missed: MelodyMode.state.mistakeFlashNotes[1] || null,
    };
  });

  expect(flashing.accepted).toBeFalsy();
  expect(flashing.missed).toBeGreaterThan(0);
});

test('Melody marks every member of the current chord as the current event', async ({ page }) => {
  const currentCount = await page.evaluate(() => {
    MelodyMode.state.isRandom = false;
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 64, time: 0, duration: 0.4 },
      { midi: 67, time: 0.5, duration: 0.4 },
    ];
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 2;
    MelodyMode.updateDifficultyUI();
    return document.querySelectorAll('#melody-staff-labels [data-note-role="current"]').length;
  });

  expect(currentCount).toBe(2);
});

test('Melody shows a fading, click-through region for the current event and upcoming events', async ({ page }) => {
  const regions = await page.evaluate(() => {
    MelodyMode.state.isRandom = false;
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 64, time: 0, duration: 0.4 },
      { midi: 67, time: 0.5, duration: 0.4 },
    ];
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 2;
    MelodyMode.updateDifficultyUI();
    return Array.from(document.querySelectorAll('#melody-notation-scroll .melody-current-event-region'))
      .map((el) => ({ rank: el.dataset.eventRank, width: parseFloat(el.style.width), opacity: parseFloat(el.style.opacity) }));
  });

  expect(regions.length).toBe(2);
  expect(regions[0].rank).toBe('0');
  expect(regions[0].width).toBeGreaterThan(0);
  expect(regions[0].opacity).toBeGreaterThan(regions[1].opacity);
});

test('Melody exposes per-note success and mistake states in the pitch row', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.isRandom = false;
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 62, time: 0.5, duration: 0.4 },
    ];
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.notePerformance = {};
    MelodyMode.state.mistakeFlashNotes = {};
    MelodyMode.updateDifficultyUI();
    MelodyMode.handleUserInputNote(60);
    const success = document.querySelector('#melody-staff-labels .note-token').getAttribute('data-note-status');

    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.handleUserInputNote(61);
    const mistake = document.querySelector('#melody-staff-labels .note-token').getAttribute('data-note-status');
    return { success, mistake };
  });

  expect(result.success).toBe('correct');
  expect(result.mistake).toBe('miss');
});

test('Melody backs off repeated mistake replays so learners get more thinking time', async ({ page }) => {
  const delays = await page.evaluate(() => {
    MelodyMode.state.isRandom = false;
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 62, time: 0.5, duration: 0.4 },
    ];
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.mistakeRetryCount = 0;
    MelodyMode.handleUserInputNote(61);
    const first = MelodyMode.state.lastMistakeDelayMs;
    clearTimeout(MelodyMode.state.mistakeTimeoutId);
    MelodyMode.state.mistakeTimeoutId = null;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.handleUserInputNote(61);
    return { first, second: MelodyMode.state.lastMistakeDelayMs };
  });

  expect(delays).toEqual({ first: 1200, second: 2400 });
});

test('Melody preserves notes played while its demonstration is sounding for later credit', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.melody = [{ midi: 60, time: 0, duration: 0.4 }];
    MelodyMode.state.isRandom = false;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 0;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.matchedChordNotes = [];
    MelodyMode.state.isPlayingSequence = true;
    MelodyMode.state.pendingUserNotes = [];
    MelodyMode.handleUserInputNote(60);
    const queued = MelodyMode.state.pendingUserNotes.slice();
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.flushPendingUserNotes();
    return { queued, userIndex: MelodyMode.state.userIndex };
  });

  expect(result.queued).toEqual([60]);
  expect(result.userIndex).toBe(1);
});

test('Melody gives higher difficulties relative timing feedback without changing the forgiving default', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.3 },
      { midi: 62, time: 0.5, duration: 0.3 },
      { midi: 64, time: 1, duration: 0.3 },
      { midi: 65, time: 1.5, duration: 0.3 },
    ];
    MelodyMode.state.isRandom = false;
    MelodyMode.state.difficulty = 2;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 3;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.timingPerformance = {};
    MelodyMode.state.lastPracticeInputAt = null;
    MelodyMode.state.lastPracticeEventStart = null;
    let now = 1000;
    MelodyMode.now = () => now;
    MelodyMode.handleUserInputNote(60);
    now = 1600;
    MelodyMode.handleUserInputNote(62);
    const onTime = MelodyMode.state.timingPerformance[1];
    now = 2600;
    MelodyMode.handleUserInputNote(64);
    return {
      onTime,
      late: MelodyMode.state.timingPerformance[2],
      visualState: document.querySelector('#melody-staff-labels [data-note-idx="2"]')?.getAttribute('data-note-timing') || null,
      visualBorder: (() => {
        const label = document.querySelector('#melody-staff-labels [data-note-idx="2"]');
        return label ? getComputedStyle(label).borderBottomStyle : null;
      })(),
    };
  });

  expect(result.onTime).toBe('on-time');
  expect(result.late).toBe('late');
  expect(result.visualState).toBe('late');
  expect(result.visualBorder).toBe('dotted');
});

test('Melody waits for silence after a mistake and retains extra notes without interrupting play', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
      { midi: 62, time: 0.5, duration: 0.4 },
    ];
    MelodyMode.state.isRandom = false;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 1;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.isPlayingPreview = false;
    MelodyMode.state.matchedChordNotes = [];
    MelodyMode.state.extraNotes = [];
    MelodyMode.state.waitingForSilence = false;
    MelodyMode.handleUserInputNote(99);
    const afterMistake = {
      isPlayingSequence: MelodyMode.state.isPlayingSequence,
      waitingForSilence: MelodyMode.state.waitingForSilence,
      extras: MelodyMode.state.extraNotes.slice(),
    };
    MelodyMode.handleUserInputNote(98);
    return {
      afterMistake,
      afterContinuedPlaying: {
        isPlayingSequence: MelodyMode.state.isPlayingSequence,
        extras: MelodyMode.state.extraNotes.slice(),
      },
    };
  });

  expect(result.afterMistake.isPlayingSequence).toBe(false);
  expect(result.afterMistake.waitingForSilence).toBe(true);
  expect(result.afterMistake.extras).toEqual([99]);
  expect(result.afterContinuedPlaying.isPlayingSequence).toBe(false);
  expect(result.afterContinuedPlaying.extras).toEqual([99, 98]);
});

test('Melody Random grows its complete Simon prefix without a fixed ten-note limit', async ({ page }) => {
  const result = await page.evaluate(() => {
    MelodyMode.cleanupPlayback();
    MelodyMode.state.melody = [
      { midi: 60, time: 0, duration: 0.4 },
    ];
    MelodyMode.state.isRandom = true;
    MelodyMode.state.startIndex = 0;
    MelodyMode.state.endIndex = 0;
    MelodyMode.state.userIndex = 0;
    MelodyMode.state.isPlayingSequence = false;
    MelodyMode.state.isPlayingPreview = false;
    MelodyMode.state.matchedChordNotes = [];
    MelodyMode.state.userRepeatTimeoutId = null;
    MelodyMode.updateDifficultyUI();
    const before = document.querySelectorAll('#melody-staff-labels .note-token').length;
    MelodyMode.handleUserInputNote(60);
    return {
      before,
      length: MelodyMode.state.melody.length,
      endIndex: MelodyMode.state.endIndex,
      startIndex: MelodyMode.state.startIndex,
      userIndex: MelodyMode.state.userIndex,
      after: document.querySelectorAll('#melody-staff-labels .note-token').length,
    };
  });

  expect(result.before).toBe(1);
  expect(result.length).toBe(2);
  expect(result.endIndex).toBe(1);
  expect(result.startIndex).toBe(0);
  expect(result.userIndex).toBe(1);
  expect(result.after).toBe(2);
});

test('Melody MIDI tracks active notes through note-off and sustain release', async ({ page }) => {
  const result = await page.evaluate(() => {
    MidiInput.state.activeNotes = new Set();
    MidiInput.state.sustainDown = false;
    MidiInput.handleMessage([0x90, 60, 100]);
    const held = Array.from(MidiInput.state.activeNotes);
    MidiInput.handleMessage([0x80, 60, 100]);
    const released = Array.from(MidiInput.state.activeNotes);
    MidiInput.handleMessage([0xb0, 64, 127]);
    MidiInput.handleMessage([0x90, 64, 100]);
    MidiInput.handleMessage([0x80, 64, 0]);
    const sustained = Array.from(MidiInput.state.activeNotes);
    MidiInput.handleMessage([0xb0, 64, 0]);
    return { held, released, sustained, sustainDown: MidiInput.state.sustainDown };
  });

  expect(result.held).toEqual([60]);
  expect(result.released).toEqual([]);
  expect(result.sustained).toEqual([64]);
  expect(result.sustainDown).toBe(false);
});
