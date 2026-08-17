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
 * generate-bundled-musicxml.js - Writes midi/*.musicxml from the SAME authored note/beat data
 * scripts/generate-bundled-midi.js already uses (SONGS below) -- not derived by parsing the
 * existing .mid files, so this is genuinely "authored," matching docs/melody-notation-design.md's
 * "MusicXML is the canonical/write format" direction. Hot Cross Buns is the one exception: its
 * source (MelodyMode.defaultMelody) no longer exists in js/melody.js (removed since this bundled
 * library was first generated -- "no built-in song is bundled anymore"), so its notes are read
 * back from the existing midi/hot-cross-buns.mid instead, the only case where this script reads
 * from a compiled artifact rather than authored source data.
 *
 * Each song's key signature is DETECTED (Tonnetz.detectKeySignature) from its own notes, not
 * guessed from memory -- see that function's own doc comment for why this is a reasonable,
 * bounded heuristic for content like this. Time signature stays a fixed 4/4 for all six --
 * accurate for most of them, and a deliberately-not-yet-attempted refinement for the couple that
 * are traditionally 3/4 (see docs/melody-notation-design.md's own scope notes on this).
 *
 * Usage: node scripts/generate-bundled-musicxml.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);
const loadIntoContext = (file, exportName) => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8') + `\nthis.${exportName} = ${exportName};`;
    vm.runInContext(code, context, { filename: file });
};
loadIntoContext('tonnetz.js', 'Tonnetz');
loadIntoContext('notation.js', 'Notation'); // only its notesToBeatSpace is used here (by MusicXML.write) -- no Render dependency
loadIntoContext('musicxml.js', 'MusicXML');
loadIntoContext('melody.js', 'MelodyMode');
const { Tonnetz, Notation, MusicXML, MelodyMode } = context;

// Same authored note/beat data as scripts/generate-bundled-midi.js (kept in sync manually --
// small enough, and re-deriving one from the other isn't worth the indirection for six songs).
const NOTE = { C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, G3: 55 };

const SONGS = {
    'frere-jacques': {
        name: 'Frère Jacques',
        notes: [
            ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1],
            ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1],
            ['E4', 1], ['F4', 1], ['G4', 2],
            ['E4', 1], ['F4', 1], ['G4', 2],
            ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
            ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
            ['C4', 1], ['G3', 1], ['C4', 2],
            ['C4', 1], ['G3', 1], ['C4', 2],
        ],
    },
    'happy-birthday': {
        name: 'Happy Birthday',
        notes: [
            ['G4', 0.5], ['G4', 0.5], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
            ['G4', 0.5], ['G4', 0.5], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
            ['G4', 0.5], ['G4', 0.5], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 1.5],
            ['F5', 0.5], ['F5', 0.5], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 2],
        ],
    },
    'alphabet': {
        name: 'Alphabet Song (Twinkle Twinkle)',
        notes: [
            ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
            ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2],
            ['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 2],
            ['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 2],
            ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
            ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2],
        ],
    },
    'mary-had-a-little-lamb': {
        name: 'Mary Had a Little Lamb',
        notes: [
            ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1], ['E4', 2],
            ['D4', 1], ['D4', 1], ['D4', 2],
            ['E4', 1], ['G4', 1], ['G4', 2],
            ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1],
            ['D4', 1], ['D4', 1], ['E4', 1], ['D4', 1], ['C4', 3],
        ],
    },
    'row-row-row-your-boat': {
        name: 'Row Row Row Your Boat',
        notes: [
            ['C4', 1], ['C4', 1], ['C4', 0.75], ['D4', 0.25], ['E4', 1],
            ['E4', 0.75], ['D4', 0.25], ['E4', 0.75], ['F4', 0.25], ['G4', 2],
            ['C5', 0.5], ['C5', 0.5], ['C5', 0.5], ['G4', 0.5], ['G4', 0.5], ['G4', 0.5],
            ['E4', 0.5], ['E4', 0.5], ['E4', 0.5], ['C4', 0.5], ['C4', 0.5], ['C4', 0.5],
            ['G4', 0.75], ['F4', 0.25], ['E4', 0.75], ['D4', 0.25], ['C4', 2],
        ],
    },
};

function toMelodySeq(notes) {
    let time = 0;
    return notes.map(([name, beats]) => {
        const slot = beats * 0.5; // 1 beat = 0.5s == 120bpm, matches generate-bundled-midi.js
        // The FULL slot, not generate-bundled-midi.js's slot*0.8 -- that 80% duty cycle is an
        // AUDIO articulation choice (a brief gap between notes so they don't sound legato), not
        // the notated rhythm. Feeding the shortened value into MusicXML.write here produced ugly
        // artifacts: a duration a few percent short of a clean beat value doesn't fit any single
        // legal note length, so it got tie-split into e.g. eighth+16th instead of one dotted
        // eighth notehead. Notation duration and audio-playback duration are different concerns;
        // this script only cares about the first.
        const note = { midi: NOTE[name], time, duration: slot };
        time += slot;
        return note;
    });
}

const midiDir = path.join(__dirname, '..', 'midi');
const BPM = 120;

function writeSong(file, name, notes) {
    const fifths = Tonnetz.detectKeySignature(notes.map((n) => n.midi));
    const xml = MusicXML.write(notes, { bpm: BPM, keySignatureFifths: fifths, name });
    fs.writeFileSync(path.join(midiDir, `${file}.musicxml`), xml);
    return fifths;
}

const index = [];

// Hot Cross Buns: source notes read back from the existing compiled .mid (see file header) --
// the one song here without live authored source data to regenerate from.
const hotCrossBunsBuffer = fs.readFileSync(path.join(midiDir, 'hot-cross-buns.mid'));
const hotCrossBunsParsed = MelodyMode.parseMIDI(hotCrossBunsBuffer.buffer.slice(hotCrossBunsBuffer.byteOffset, hotCrossBunsBuffer.byteOffset + hotCrossBunsBuffer.byteLength));
const hotCrossBunsRaw = MelodyMode.extractMonophonicMelody(hotCrossBunsParsed);
// Same duty-cycle issue as toMelodySeq's own comment above -- the compiled .mid's own note
// durations are deliberately shortened for audible articulation, not the notated rhythm. Extend
// each note to the START of the next one (full legato, no artificial gaps) instead of guessing a
// fixed duty-cycle ratio to undo -- correct for a simple children's song with no actual intended
// rests between notes, which this one has none of.
const hotCrossBunsNotes = hotCrossBunsRaw.map((n, i) => ({
    midi: n.midi,
    time: n.time,
    duration: i + 1 < hotCrossBunsRaw.length ? hotCrossBunsRaw[i + 1].time - n.time : n.duration,
}));
const hcbFifths = writeSong('hot-cross-buns', 'Hot Cross Buns', hotCrossBunsNotes);
index.push({ name: 'Hot Cross Buns', file: 'hot-cross-buns.musicxml' });
console.log(`Hot Cross Buns: detected key fifths=${hcbFifths}`);

for (const [file, song] of Object.entries(SONGS)) {
    const notes = toMelodySeq(song.notes);
    const fifths = writeSong(file, song.name, notes);
    index.push({ name: song.name, file: `${file}.musicxml` });
    console.log(`${song.name}: detected key fifths=${fifths}`);
}

fs.writeFileSync(path.join(midiDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${index.length} songs to ${midiDir} (index.json now points at .musicxml)`);
