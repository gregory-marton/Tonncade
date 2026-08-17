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
 * musicxml.js - MusicXML (plain-text .musicxml/.xml, single part/"score-partwise") reader/writer.
 * See docs/melody-notation-design.md: MusicXML is the canonical/write format going forward
 * (bundled songs, Compose's Save); MIDI stays import-only, for content that never had notated
 * rhythm to begin with.
 *
 * Deliberately ONE part, no <staves>/<backup>/<forward> multi-staff ceremony -- the grand-staff
 * treble/bass SPLIT is a rendering decision js/notation.js already recomputes fresh from each
 * note's own pitch (Notation.CLEF_SPLIT_MIDI), exactly like it already does for MIDI/Random
 * sources. Storing a staff assignment in the file too would just be a second copy of information
 * already derivable from pitch, with its own chance to disagree with the first.
 *
 * writeMusicXML DOES support ties (docs/melody-notation-design.md: "correctness-relevant, not
 * cosmetic") -- any duration that doesn't fit a single legal note value, or that crosses a
 * measure boundary, gets decomposed into tied notes. parseMusicXML merges tied notes back into
 * one logical note on the way in. This is intentionally MORE complete than js/notation.js's own
 * rendering (which still just clips, a known separate limitation) -- file-format round-trip
 * correctness matters even before the renderer catches up.
 *
 * Repeats/D.C./D.S./Coda/Fine unrolling is NOT here -- that's js/repeat-navigation.js (a
 * separate, later piece per docs/melody-notation-design.md), applied to whatever this module
 * parses, same relationship parseMIDI has to extractMonophonicMelody.
 */
const MusicXML = {
    DIVISIONS: 4, // ticks per quarter note == our own 16th-note quantization grid (1 division = 1/16)

    STEP_SEMITONE: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 },
    SEMITONE_STEP: [
        ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
        ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
    ], // [step, alter] per semitone 0-11, sharps-only -- matches Tonnetz.getNoteName's own default;
       // a key-signature-aware speller (docs/melody-notation-design.md) is a separate, later piece.

    // The legal single-symbol durations this writer/reader deals in, as a beat length (quarter =
    // 1) and the MusicXML <type> name -- same five js/notation.js already uses, kept as one
    // source of truth would be nicer still, but the two modules' failure modes differ enough
    // (this one ties instead of clipping) that a shared table isn't a clean fit yet.
    DURATION_TYPES: [[4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'], [0.25, '16th']],

    // Decomposes a beat length (a multiple of 0.25, our 16th-note grid) into legal single-symbol
    // pieces, greedily largest-first -- exact and lossless for any such multiple, since 4/2/1/0.5/
    // 0.25 are successive powers of two (the same reason plain binary representation is exact).
    // Multiple pieces get tied together by the caller.
    decomposeDuration: function(beats) {
        const pieces = [];
        let remaining = Math.round(beats * 4) / 4;
        for (const [len] of this.DURATION_TYPES) {
            while (remaining >= len - 1e-9) {
                pieces.push(len);
                remaining -= len;
            }
        }
        return pieces.length ? pieces : [0.25];
    },

    durationTypeName: function(beats) {
        const found = this.DURATION_TYPES.find(([len]) => Math.abs(len - beats) < 1e-9);
        return found ? found[1] : '16th';
    },

    // MIDI -> {step, alter, octave}. Sharps-only for now (Tonnetz.getNoteName's key-signature
    // parameter, once it lands, is where a real speller would plug in for both this and the
    // Tonnetz's own labels -- one place, not duplicated).
    midiToStepAlterOctave: function(midi) {
        const [step, alter] = this.SEMITONE_STEP[((midi % 12) + 12) % 12];
        const octave = Math.floor(midi / 12) - 1;
        return { step, alter, octave };
    },

    stepAlterOctaveToMidi: function(step, alter, octave) {
        return (octave + 1) * 12 + this.STEP_SEMITONE[step] + (alter || 0);
    },

    xmlEscape: function(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // Splits a [startBeat, startBeat+beats) span at every measure boundary it crosses --
    // {measureIndex, beats} pieces summing back to the original span. The building block both
    // note-ties (crossing a barline) and rest-emission (every rest must stay inside one measure
    // too) are built from.
    splitAcrossMeasures: function(startBeat, beats, beatsPerMeasure) {
        const pieces = [];
        let remaining = beats;
        let cursor = startBeat;
        while (remaining > 1e-9) {
            const measureIndex = Math.floor(cursor / beatsPerMeasure + 1e-9);
            const measureEnd = (measureIndex + 1) * beatsPerMeasure;
            const pieceLen = Math.min(remaining, measureEnd - cursor);
            pieces.push({ measureIndex, beats: pieceLen });
            cursor += pieceLen;
            remaining -= pieceLen;
        }
        return pieces;
    },

    // Writes `notes` ({midi, time, duration}, time/duration in SECONDS) as a plain-text MusicXML
    // document. opts: { bpm, keySignatureFifths (MusicXML <fifths>, -7..7, 0 = C/Am), beatsPerMeasure
    // (default 4, always /4 for now), name }. Reuses Notation's own beat-space conversion so the
    // SAME quantization the staff renders from is what gets saved -- one source of truth, not two
    // that could disagree.
    //
    // A single pass walks the whole piece with ONE continuously-advancing cursor (not reset per
    // measure) -- every rest AND every note gets split at whatever measure boundaries it crosses
    // (splitAcrossMeasures) before being further decomposed into legal single-symbol durations
    // (decomposeDuration) within each per-measure chunk. A note tied across a barline and a note
    // that simply doesn't fit one legal duration are the SAME mechanism here, not two: every piece
    // belonging to one original note -- however many splits either reason produced -- is one tie
    // chain. (An earlier version of this function clipped a note to fit its starting measure and
    // silently dropped the remainder instead of tying it onward -- caught by round-tripping a note
    // that crossed a barline and finding its duration had shrunk on the way out.)
    write: function(notes, opts) {
        opts = opts || {};
        const bpm = opts.bpm || 120;
        const beatsPerMeasure = opts.beatsPerMeasure || 4;
        const fifths = opts.keySignatureFifths || 0;
        const name = opts.name || 'Untitled';

        const beatNotes = Notation.notesToBeatSpace(notes, bpm);
        const measureCount = beatNotes.length === 0 ? 1 : Math.max(1, Math.ceil(
            Math.max(...beatNotes.map((n) => n.beatStart + n.beatDuration)) / beatsPerMeasure
        ));

        const measureBodies = Array.from({ length: measureCount }, () => []);

        const emitRestSpan = (startBeat, beats) => {
            this.splitAcrossMeasures(startBeat, beats, beatsPerMeasure).forEach((chunk) => {
                this.decomposeDuration(chunk.beats).forEach((piece) => {
                    measureBodies[chunk.measureIndex].push(
                        '    <note>', '      <rest/>',
                        `      <duration>${Math.round(piece * this.DIVISIONS)}</duration>`,
                        `      <type>${this.durationTypeName(piece)}</type>`,
                        '    </note>'
                    );
                });
            });
        };

        const emitNoteSpan = (startBeat, beats, midi, isChordNote) => {
            const allPieces = [];
            this.splitAcrossMeasures(startBeat, beats, beatsPerMeasure).forEach((chunk) => {
                this.decomposeDuration(chunk.beats).forEach((piece) => allPieces.push({ measureIndex: chunk.measureIndex, beats: piece }));
            });
            const needsTie = allPieces.length > 1;
            const { step, alter, octave } = this.midiToStepAlterOctave(midi);
            allPieces.forEach((p, idx) => {
                const lines = ['    <note>'];
                if (isChordNote && idx === 0) lines.push('      <chord/>');
                lines.push('      <pitch>', `        <step>${step}</step>`);
                if (alter) lines.push(`        <alter>${alter}</alter>`);
                lines.push(`        <octave>${octave}</octave>`, '      </pitch>');
                lines.push(`      <duration>${Math.round(p.beats * this.DIVISIONS)}</duration>`);
                if (needsTie) {
                    if (idx === 0) lines.push('      <tie type="start"/>');
                    else if (idx === allPieces.length - 1) lines.push('      <tie type="stop"/>');
                    else { lines.push('      <tie type="stop"/>', '      <tie type="start"/>'); }
                }
                lines.push(`      <type>${this.durationTypeName(p.beats)}</type>`);
                if (needsTie) {
                    if (idx === 0) lines.push('      <notations><tied type="start"/></notations>');
                    else if (idx === allPieces.length - 1) lines.push('      <notations><tied type="stop"/></notations>');
                    else lines.push('      <notations><tied type="stop"/><tied type="start"/></notations>');
                }
                lines.push('    </note>');
                measureBodies[p.measureIndex].push(...lines);
            });
        };

        let cursor = 0;
        let i = 0;
        while (i < beatNotes.length) {
            const n = beatNotes[i];
            if (n.beatStart > cursor) emitRestSpan(cursor, n.beatStart - cursor);
            // Chord: every subsequent note sharing this exact beatStart is marked <chord/> and
            // ties/splits independently by its OWN duration -- mirrors Compose's own
            // flushChordBuffer, which is exactly where a shared time value like this comes from.
            emitNoteSpan(n.beatStart, n.beatDuration, n.midi, false);
            let maxDuration = n.beatDuration;
            let j = i + 1;
            while (j < beatNotes.length && Math.abs(beatNotes[j].beatStart - n.beatStart) < 1e-9) {
                emitNoteSpan(beatNotes[j].beatStart, beatNotes[j].beatDuration, beatNotes[j].midi, true);
                maxDuration = Math.max(maxDuration, beatNotes[j].beatDuration);
                j++;
            }
            cursor = n.beatStart + maxDuration; // the whole chord's own longest member, not just the anchor's
            i = j;
        }
        const totalBeats = measureCount * beatsPerMeasure;
        if (cursor < totalBeats) emitRestSpan(cursor, totalBeats - cursor);

        const measuresXml = measureBodies.map((body, m) => {
            const parts = [`  <measure number="${m + 1}">`];
            if (m === 0) {
                parts.push('    <attributes>');
                parts.push(`      <divisions>${this.DIVISIONS}</divisions>`);
                parts.push(`      <key><fifths>${fifths}</fifths></key>`);
                parts.push(`      <time><beats>${beatsPerMeasure}</beats><beat-type>4</beat-type></time>`);
                parts.push('      <clef><sign>G</sign><line>2</line></clef>');
                parts.push('    </attributes>');
                if (bpm) parts.push(`    <sound tempo="${bpm}"/>`);
            }
            parts.push(...body);
            parts.push('  </measure>');
            return parts.join('\n');
        });

        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${this.xmlEscape(name)}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
${measuresXml.join('\n')}
  </part>
</score-partwise>
`;
    },

    // Parses plain-text MusicXML into { notes: [{midi, time, duration}], bpm } -- the SAME
    // contract MelodyMode.parseMIDI already returns, so callers can treat either source
    // interchangeably. Ties are merged back into one logical note; <chord/> notes share their
    // predecessor's time, same convention state.notes already uses for a recorded chord.
    //
    // Repeats/D.C./D.S./Coda/Fine ARE expanded here, via js/repeat-navigation.js -- measures get
    // walked in the RESOLVED play order (which may revisit a measure element more than once for a
    // repeated section), not raw document order. Everything below this point is unaware of
    // repeats/jumps at all; it just sees however many times each measure was resolved to appear.
    parse: function(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Malformed MusicXML');

        let divisions = this.DIVISIONS;
        let bpm = 120;
        let keySignature = null; // fifths, from the file's own <key><fifths> if it has one -- authored, never inferred
        const notes = [];
        let openTies = {}; // "midi" -> the in-progress note object still being extended
        let beatCursor = 0;
        let chordAnchorStart = 0;

        const measureOrder = typeof RepeatNavigation !== 'undefined'
            ? RepeatNavigation.resolveMeasureOrder(doc.querySelectorAll('part measure'))
            : [...doc.querySelectorAll('part measure')];

        measureOrder.forEach((measure) => {
            const divisionsEl = measure.querySelector('attributes > divisions');
            if (divisionsEl) divisions = parseInt(divisionsEl.textContent, 10) || divisions;
            const tempoEl = measure.querySelector('sound[tempo]');
            if (tempoEl) bpm = parseFloat(tempoEl.getAttribute('tempo')) || bpm;
            const fifthsEl = measure.querySelector('attributes > key > fifths');
            if (fifthsEl) keySignature = parseInt(fifthsEl.textContent, 10);

            [...measure.children].forEach((el) => {
                if (el.tagName !== 'note') return;
                const durationEl = el.querySelector('duration');
                const durationBeats = durationEl ? parseInt(durationEl.textContent, 10) / divisions : 0;
                const isChord = !!el.querySelector('chord');
                const isRest = !!el.querySelector('rest');
                const tieStart = [...el.querySelectorAll('tie')].some((t) => t.getAttribute('type') === 'start');
                const tieStop = [...el.querySelectorAll('tie')].some((t) => t.getAttribute('type') === 'stop');

                if (isRest) {
                    beatCursor += durationBeats;
                    return;
                }

                const pitchEl = el.querySelector('pitch');
                const step = pitchEl.querySelector('step').textContent;
                const alterEl = pitchEl.querySelector('alter');
                const alter = alterEl ? parseInt(alterEl.textContent, 10) : 0;
                const octave = parseInt(pitchEl.querySelector('octave').textContent, 10);
                const midi = this.stepAlterOctaveToMidi(step, alter, octave);
                // A <chord/> note shares its ANCHOR's start time -- but the anchor already
                // advances beatCursor past that point as soon as IT'S processed (below), before
                // its chord siblings are seen, so a chord note can't just read the live cursor.
                // chordAnchorStart freezes the anchor's own start until the whole chord group
                // (this note + everything immediately after it still marked <chord/>) is done.
                if (!isChord) chordAnchorStart = beatCursor;
                const startBeat = isChord ? chordAnchorStart : beatCursor;

                if (tieStop && openTies[midi]) {
                    openTies[midi].duration += durationBeats; // extend the already-emitted note
                    if (!tieStart) delete openTies[midi];
                } else {
                    const note = { midi, time: startBeat, duration: durationBeats };
                    notes.push(note);
                    if (tieStart) openTies[midi] = note;
                }

                if (!isChord) beatCursor += durationBeats;
            });
        });

        const secondsPerBeat = 60 / (bpm || 120);
        return {
            notes: notes.map((n) => ({ midi: n.midi, time: n.time * secondsPerBeat, duration: n.duration * secondsPerBeat })),
            bpm,
            keySignature, // null if the file never declared one -- callers fall back to their own detection
        };
    },
};

if (typeof module !== 'undefined') {
    module.exports = MusicXML;
}
