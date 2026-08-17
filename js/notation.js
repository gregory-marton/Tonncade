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
 * notation.js - Renders a note array ({midi, time, duration}, time/duration in SECONDS) onto a
 * VexFlow (js/vendor/vexflow.js) grand staff: two staves (treble + bass, split by register, NOT
 * independent voices), a brace connecting them, note-name/octave labels underneath, and measure
 * barlines. See docs/melody-notation-design.md for the full design.
 *
 * The time->beat conversion and rhythm-legibility here are DELIBERATELY the lightweight, naive
 * version (independent per-note rounding to a 16th-note grid, fixed 4/4) -- the design doc's
 * "lightweight quantizer/speller/measure-inference" is a separate, later pass; this module just
 * needs SOME correct conversion to prove the rendering pipeline, not the best one yet.
 *
 * Known, deliberate limitations of this first pass (not bugs -- see docs/melody-notation-design.md):
 *   - No ties: a note whose duration doesn't fit a single legal value, or that would cross a
 *     measure boundary, gets clipped to fit rather than tied across two noteheads.
 *   - Key signature is always whatever's passed in (or none) -- no per-note enharmonic-spelling
 *     heuristic yet (Tonnetz.getNoteName's key-signature param is a separate, later addition).
 */
const Notation = {
    // MIDI >= this -> treble; below -> bass. A REGISTER split of one monophonic line, not
    // independent two-handed piano voices -- see docs/melody-notation-design.md.
    CLEF_SPLIT_MIDI: 60,

    MEASURE_WIDTH: 180,
    STAVE_HEIGHT: 80,

    // Rounds `beats` to the nearest 16th-note grid step.
    quantizeToGrid: function(beats) {
        return Math.round(beats * 4) / 4;
    },

    // Converts a note array (time/duration in SECONDS) into beat-space (quarter-note beats,
    // quantized to a 16th-note grid) at the given tempo. Sorted by beatStart -- callers already
    // producing sorted notes get a cheap no-op sort, not an assumption relied on silently.
    notesToBeatSpace: function(notes, bpm) {
        const secondsPerBeat = 60 / (bpm || 120);
        return notes.map((n) => ({
            midi: n.midi,
            beatStart: this.quantizeToGrid(n.time / secondsPerBeat),
            beatDuration: Math.max(0.25, this.quantizeToGrid(n.duration / secondsPerBeat)),
        })).sort((a, b) => a.beatStart - b.beatStart);
    },

    // The largest single VexFlow duration code ("w"/"h"/"q"/"8"/"16") whose beat length is <= the
    // given beat duration. Splitting a duration that doesn't fit any single legal value across a
    // tie is real, separate work (docs/melody-notation-design.md's "Ties" item) -- not attempted
    // here; this just clips to the nearest legal value below it.
    DURATION_BEATS: [['w', 4], ['h', 2], ['q', 1], ['8', 0.5], ['16', 0.25]],
    durationCode: function(beatDuration) {
        for (const [code, beats] of this.DURATION_BEATS) {
            if (beatDuration >= beats - 1e-9) return code;
        }
        return '16';
    },

    // MIDI -> {key, accidental} for VexFlow's StaveNote (e.g. "c#/4"). Delegates note naming to
    // Tonnetz.getNoteName so a future key-signature-aware speller (docs/melody-notation-design.md)
    // is a change in exactly one place, not duplicated here.
    midiToVexKey: function(midi, keySignature) {
        const name = Tonnetz.getNoteName(midi, keySignature);
        const octave = Tonnetz.getOctave(midi);
        const letter = name[0].toLowerCase();
        const accidental = name.slice(1) || null; // '', '#', 'b' -> null, '#', 'b'
        return { key: `${letter}${accidental || ''}/${octave}`, accidental };
    },

    // Splits beat-space notes into fixed-length measures, filling every gap (leading, between
    // notes, and trailing) with an explicit rest -- a real staff shows silence as silence, not a
    // skip. A note that would overrun its measure is clipped to fit (see the file-level comment on
    // ties).
    toMeasures: function(beatNotes, beatsPerMeasure) {
        beatsPerMeasure = beatsPerMeasure || 4;
        if (beatNotes.length === 0) return [];
        const totalBeats = Math.max(...beatNotes.map((n) => n.beatStart + n.beatDuration));
        const measureCount = Math.max(1, Math.ceil(totalBeats / beatsPerMeasure));
        const measures = [];
        for (let m = 0; m < measureCount; m++) {
            const mStart = m * beatsPerMeasure;
            const mEnd = mStart + beatsPerMeasure;
            const inMeasure = beatNotes.filter((n) => n.beatStart >= mStart && n.beatStart < mEnd);
            const items = [];
            let cursor = mStart;
            inMeasure.forEach((n) => {
                if (n.beatStart > cursor) items.push({ rest: true, beatDuration: n.beatStart - cursor });
                const clippedDuration = Math.min(n.beatDuration, mEnd - n.beatStart);
                items.push({ midi: n.midi, beatStart: n.beatStart, beatDuration: clippedDuration });
                cursor = n.beatStart + clippedDuration;
            });
            if (cursor < mEnd) items.push({ rest: true, beatDuration: mEnd - cursor });
            measures.push(items);
        }
        return measures;
    },

    // A rest StaveNote standing in for "the OTHER clef has a real note here" -- both staves' own
    // Voice must independently account for the full measure's ticks, so wherever one clef gets a
    // real note, the other gets a same-duration rest at that position (not a gap).
    _ghostRest: function(clef, beatDuration) {
        const keys = clef === 'treble' ? ['b/4'] : ['d/3'];
        return new VexFlow.StaveNote({ keys, duration: this.durationCode(beatDuration) + 'r', clef });
    },

    // Renders `notes` into #<containerId> as a grand staff. Returns null if there's nothing to
    // draw (empty container, matches every other mode's "nothing to show yet" convention) or
    // {width, height, noteXPositions} -- noteXPositions is [{midi, beatStart, x}], the x-position
    // readback later work (barline/label/timeline sync, docs/melody-notation-design.md) needs,
    // via VexFlow's own getAbsoluteX() -- not reconstructed separately.
    render: function(containerId, notes, opts) {
        opts = opts || {};
        const container = document.getElementById(containerId);
        if (!container) return null;
        container.innerHTML = '';
        if (!notes || notes.length === 0) return null;

        const bpm = opts.bpm || 120;
        const keySignature = opts.keySignature || null;
        const beatsPerMeasure = opts.beatsPerMeasure || 4;
        const clefSplit = opts.clefSplit != null ? opts.clefSplit : this.CLEF_SPLIT_MIDI;

        const beatNotes = this.notesToBeatSpace(notes, bpm);
        const measures = this.toMeasures(beatNotes, beatsPerMeasure);

        const width = Math.max(300, measures.length * this.MEASURE_WIDTH + 40);
        const height = this.STAVE_HEIGHT * 2 + 40;

        const renderer = new VexFlow.Renderer(container, VexFlow.Renderer.Backends.SVG);
        renderer.resize(width, height);
        const ctx = renderer.getContext();

        const noteXPositions = [];
        const barlineXPositions = [];
        let x = 10;
        measures.forEach((items, mi) => {
            barlineXPositions.push(x);
            const treble = new VexFlow.Stave(x, 10, this.MEASURE_WIDTH);
            const bass = new VexFlow.Stave(x, 10 + this.STAVE_HEIGHT, this.MEASURE_WIDTH);
            if (mi === 0) {
                treble.addClef('treble');
                bass.addClef('bass');
                if (keySignature) {
                    treble.addKeySignature(keySignature);
                    bass.addKeySignature(keySignature);
                }
                treble.addTimeSignature(beatsPerMeasure + '/4');
                bass.addTimeSignature(beatsPerMeasure + '/4');
            }
            treble.setContext(ctx).draw();
            bass.setContext(ctx).draw();
            if (mi === 0) {
                new VexFlow.StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
                new VexFlow.StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
            }

            const trebleItems = [];
            const bassItems = [];
            items.forEach((item) => {
                if (item.rest) {
                    trebleItems.push(this._ghostRest('treble', item.beatDuration));
                    bassItems.push(this._ghostRest('bass', item.beatDuration));
                    return;
                }
                const isTreble = item.midi >= clefSplit;
                const clef = isTreble ? 'treble' : 'bass';
                const { key, accidental } = this.midiToVexKey(item.midi, keySignature);
                const vexNote = new VexFlow.StaveNote({ keys: [key], duration: this.durationCode(item.beatDuration), clef });
                if (accidental) vexNote.addModifier(new VexFlow.Accidental(accidental), 0);
                noteXPositions.push({ midi: item.midi, beatStart: item.beatStart, clef, vexNote });
                if (isTreble) {
                    trebleItems.push(vexNote);
                    bassItems.push(this._ghostRest('bass', item.beatDuration));
                } else {
                    bassItems.push(vexNote);
                    trebleItems.push(this._ghostRest('treble', item.beatDuration));
                }
            });

            const trebleVoice = new VexFlow.Voice({ numBeats: beatsPerMeasure, beatValue: 4 }).setMode(VexFlow.Voice.Mode.SOFT);
            trebleVoice.addTickables(trebleItems);
            const bassVoice = new VexFlow.Voice({ numBeats: beatsPerMeasure, beatValue: 4 }).setMode(VexFlow.Voice.Mode.SOFT);
            bassVoice.addTickables(bassItems);

            new VexFlow.Formatter().joinVoices([trebleVoice, bassVoice]).format([trebleVoice, bassVoice], this.MEASURE_WIDTH - 40);
            trebleVoice.draw(ctx, treble);
            bassVoice.draw(ctx, bass);

            x += this.MEASURE_WIDTH;
        });

        return {
            width,
            height,
            noteXPositions: noteXPositions.map((n) => ({ midi: n.midi, beatStart: n.beatStart, clef: n.clef, x: n.vexNote.getAbsoluteX() })),
            barlineXPositions: barlineXPositions,
        };
    },

    // Renders one note-name/octave label per entry of `noteXPositions` (Notation.render's own
    // return value -- callers pass it straight through, no separate computation) into
    // #<containerId>, each absolutely positioned at that note's OWN x -- the same x VexFlow itself
    // reported, so this row lines up with the staff above it without a second, independently
    // -computed layout. A minimal stand-in for the real "spans the whole stack" barline overlay
    // (docs/melody-notation-design.md) -- draws labels only; barline-spanning-through-the-timeline
    // itself is still open (see that doc's Open Items).
    renderLabels: function(containerId, noteXPositions, keySignature) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.style.position = 'relative';
        container.style.height = '1.2em';
        (noteXPositions || []).forEach((n) => {
            const span = document.createElement('span');
            span.className = 'note-token'; // same look as the Melody/Compose timeline tokens
            span.style.position = 'absolute';
            span.style.left = n.x + 'px';
            span.style.transform = 'translateX(-50%)';
            span.textContent = Tonnetz.getNoteName(n.midi, keySignature) + Tonnetz.getOctave(n.midi);
            container.appendChild(span);
        });
    },
};

if (typeof module !== 'undefined') {
    module.exports = Notation;
}
