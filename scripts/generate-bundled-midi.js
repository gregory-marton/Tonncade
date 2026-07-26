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
 * generate-bundled-midi.js - Regenerates midi/*.mid and midi/index.json, the read-only online
 * song folder (task #27), from the note data below. Uses the real MidiMode.writeMIDI (js/midi.js)
 * rather than hand-rolling SMF bytes a second time -- run this again if that ever changes, or to
 * add another song.
 *
 * Usage: node scripts/generate-bundled-midi.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);
// vm's top-level `const` doesn't become a context property on its own -- the appended line runs
// in the same lexical scope as midi.js's own `const MidiMode = {...}`, so it can see the binding
// and attach it to the context object (`this` at top level of a non-strict script).
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'midi.js'), 'utf8') + '\nthis.MidiMode = MidiMode;';
vm.runInContext(code, context, { filename: 'midi.js' });
const MidiMode = context.MidiMode;

// C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, B4=71, C5=72, D5=74, E5=76, F5=77, G5=79, G3=55
const NOTE = { C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, G3: 55 };

// Each song: array of [noteName, beats] pairs. 1 beat = 0.5s (matches MidiMode.defaultMelody's
// own implicit 120bpm), sound duration is 80% of the beat slot (same duty-cycle convention
// defaultMelody already uses: quarter=0.4s sound in a 0.5s slot, eighth=0.2s sound in a 0.25s
// slot, half=0.8s sound in a 1.0s slot).
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
        const slot = beats * 0.5;
        const note = { midi: NOTE[name], time, duration: slot * 0.8 };
        time += slot;
        return note;
    });
}

const midiDir = path.join(__dirname, '..', 'midi');
fs.mkdirSync(midiDir, { recursive: true });

const index = [{ name: 'Hot Cross Buns', file: 'hot-cross-buns.mid' }];
fs.writeFileSync(path.join(midiDir, 'hot-cross-buns.mid'), Buffer.from(MidiMode.writeMIDI(MidiMode.defaultMelody)));

for (const [file, song] of Object.entries(SONGS)) {
    const buffer = MidiMode.writeMIDI(toMelodySeq(song.notes));
    fs.writeFileSync(path.join(midiDir, `${file}.mid`), Buffer.from(buffer));
    index.push({ name: song.name, file: `${file}.mid` });
}

fs.writeFileSync(path.join(midiDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${index.length} songs to ${midiDir}`);
