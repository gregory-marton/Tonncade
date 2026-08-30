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
 * Known, deliberate limitation of this first pass (not a bug -- see docs/melody-notation-design.md):
 *   - No ties: a note whose duration doesn't fit a single legal value, or that would cross a
 *     measure boundary, gets clipped to fit rather than tied across two noteheads (js/musicxml.js's
 *     own writer DOES tie correctly -- this renderer hasn't caught up yet).
 */
const Notation = {
    // MIDI >= this -> treble; below -> bass. A REGISTER split of one monophonic line, not
    // independent two-handed piano voices -- see docs/melody-notation-design.md.
    CLEF_SPLIT_MIDI: 60,

    // VexFlow's addKeySignature wants a key-spec STRING ("G", "Db"), not the fifths integer
    // (-7..7, MusicXML's own convention) everything else here uses (Tonnetz.getNoteName,
    // js/musicxml.js) -- one small table to bridge that, rather than two different fifths
    // conventions living side by side.
    FIFTHS_TO_VEX_KEY: ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'], // index = fifths + 7

    MEASURE_WIDTH: 180,
    // Widest a single measure is ever stretched to fill available space (opts.targetWidth,
    // below) -- without a cap, a one-measure Random preview in a very wide #notation-bar would
    // space its handful of notes absurdly far apart instead of just leaving room to spare.
    MEASURE_WIDTH_MAX: 420,
    STAVE_HEIGHT: 80,

    // Matches css/style.css's --text custom property -- see render()'s own comment on why this
    // needs setting explicitly at all (VexFlow's own default is solid black).
    NOTE_COLOR: '#e7e9ee',

    // Diatonic (letter, not chromatic) bottom-line reference for each clef -- standard convention:
    // treble's bottom line is E4, bass's is G2. Used by pitchFromY to walk UP from a click's Y
    // position by whole diatonic steps (half a line-spacing each), the same way a real staff
    // position works, then spell that landed letter per the current key signature.
    CLEF_BOTTOM_LINE: { treble: { letter: 'E', octave: 4 }, bass: { letter: 'G', octave: 2 } },
    LETTERS: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],

    // Rounds `beats` to the nearest 16th-note grid step.
    quantizeToGrid: function(beats) {
        return Math.round(beats * 4) / 4;
    },

    // Converts a note array (time/duration in SECONDS) into beat-space (quarter-note beats,
    // quantized to a 16th-note grid) at the given tempo. Sorted by beatStart -- callers already
    // producing sorted notes get a cheap no-op sort, not an assumption relied on silently.
    // `id` (opaque, caller-assigned -- e.g. the caller's own array index, before this re-sorts by
    // time) passes through unchanged into toMeasures/render's noteXPositions, so a caller that
    // wants to hit-test a click back to ITS OWN note array (Compose's click-to-add/drag gestures)
    // has a stable handle, since content alone (midi+beatStart) doesn't disambiguate a chord or a
    // repeated pitch. Defaults to the input array's own index when omitted -- existing callers
    // that don't care about it are unaffected.
    notesToBeatSpace: function(notes, bpm) {
        const secondsPerBeat = 60 / (bpm || 120);
        return notes.map((n, i) => ({
            id: n.id != null ? n.id : i,
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
        // One measure of rest, not zero measures -- a caller with nothing recorded yet (Compose's
        // own blank canvas) still gets a real, visible staff (clef/key/time signature) to record
        // onto, rather than an empty container that reads as "no timeline here at all" (reported
        // live).
        if (beatNotes.length === 0) return [[{ rest: true, beatDuration: beatsPerMeasure }]];
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
                items.push({ id: n.id, midi: n.midi, beatStart: n.beatStart, beatDuration: clippedDuration });
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

    // Given a fifths key signature, whether `letter` is altered by it, and by how much (0, +1, or
    // -1 semitones) -- the letter-indexed mirror of Tonnetz._diatonicSpelling's own pitch-class-
    // indexed table, reusing the SAME SHARP_ORDER/FLAT_ORDER/NATURAL_SEMITONE Tonnetz already
    // exposes rather than duplicating them.
    _letterAccidental: function(letter, fifths) {
        if (fifths == null) return 0;
        const order = fifths >= 0 ? Tonnetz.SHARP_ORDER : Tonnetz.FLAT_ORDER;
        if (!order.slice(0, Math.abs(fifths)).includes(letter)) return 0;
        return fifths >= 0 ? 1 : -1;
    },

    // Inverse of rendering: given a Y pixel (in the same coordinate space Notation.render's SVG
    // uses) and the {trebleTop, trebleBottom, bassTop, bassBottom, spacing} staveBounds it
    // returns, finds the nearest clef by distance to that stave's own vertical middle, then walks
    // UP from that clef's bottom line by whole diatonic steps (half a line-spacing per step,
    // confirmed empirically against VexFlow's own StaveNote.getYs() -- see the smoke test this was
    // built from) to land on a letter, spelled per keySignature. This is genuinely diatonic-
    // accurate (matches real staff-position math), not a coarse linear MIDI-range approximation --
    // it just doesn't yet snap to ledger lines beyond a couple of steps past the staff, which
    // isn't needed for a first cut (docs/melody-notation-design.md).
    pitchFromY: function(y, staveBounds, keySignature) {
        if (!staveBounds) return this.CLEF_SPLIT_MIDI;
        const trebleMid = (staveBounds.trebleTop + staveBounds.trebleBottom) / 2;
        const bassMid = (staveBounds.bassTop + staveBounds.bassBottom) / 2;
        const useTreble = Math.abs(y - trebleMid) <= Math.abs(y - bassMid);
        const bottom = useTreble ? this.CLEF_BOTTOM_LINE.treble : this.CLEF_BOTTOM_LINE.bass;
        const bottomY = useTreble ? staveBounds.trebleBottom : staveBounds.bassBottom;
        const halfSpacing = staveBounds.spacing / 2;
        const steps = Math.round((bottomY - y) / halfSpacing);
        const baseIndex = this.LETTERS.indexOf(bottom.letter);
        const idx = ((baseIndex + steps) % 7 + 7) % 7;
        const octave = bottom.octave + Math.floor((baseIndex + steps) / 7);
        const letter = this.LETTERS[idx];
        const semitone = Tonnetz.NATURAL_SEMITONE[letter] + this._letterAccidental(letter, keySignature);
        return (octave + 1) * 12 + semitone;
    },

    // Inverse of beat->x layout: given an x pixel and the barlineXPositions Notation.render
    // returns, finds which measure x falls in and interpolates linearly across that measure's
    // width to a beat position. Used by click-to-add/drag-to-retime to turn a staff click back
    // into a beat (then a time, via the caller's own bpm). measureWidth defaults to the constant
    // for backward compatibility, but callers should pass render()'s OWN returned measureWidth --
    // it can differ per render now that render() stretches to fill available width (opts.targetWidth).
    beatFromX: function(x, barlineXPositions, beatsPerMeasure, measureWidth) {
        beatsPerMeasure = beatsPerMeasure || 4;
        measureWidth = measureWidth || this.MEASURE_WIDTH;
        if (!barlineXPositions || barlineXPositions.length === 0) return 0;
        let mi = 0;
        for (let i = 0; i < barlineXPositions.length; i++) {
            if (barlineXPositions[i] <= x) mi = i;
        }
        const measureStartX = barlineXPositions[mi];
        const measureEndX = measureStartX + measureWidth;
        const frac = Math.max(0, Math.min(1, (x - measureStartX) / (measureEndX - measureStartX)));
        return Math.max(0, mi * beatsPerMeasure + frac * beatsPerMeasure);
    },

    // Renders `notes` into #<containerId> as a grand staff. Returns null only if the container
    // itself doesn't exist; an empty `notes` still draws one empty measure (clef/key/time
    // signature, a whole rest, see toMeasures) rather than nothing -- an empty Compose canvas
    // still needs a real, clickable staff to record onto, not a blank void that reads as "no
    // timeline here" (reported live). Returns {width, height, noteXPositions, barlineXPositions,
    // staveBounds} -- noteXPositions is [{midi, beatStart, x, y, clef}] (x/y via VexFlow's own
    // getAbsoluteX()/getYs(), not reconstructed separately), staveBounds is the {trebleTop/
    // Bottom, bassTop/Bottom, spacing} pitchFromY needs for hit-testing clicks on EMPTY staff
    // space (not on an existing note).
    render: function(containerId, notes, opts) {
        opts = opts || {};
        const container = document.getElementById(containerId);
        if (!container) return null;
        container.innerHTML = '';

        const bpm = opts.bpm || 120;
        const keySignature = opts.keySignature || null;
        const beatsPerMeasure = opts.beatsPerMeasure || 4;
        const clefSplit = opts.clefSplit != null ? opts.clefSplit : this.CLEF_SPLIT_MIDI;

        const beatNotes = this.notesToBeatSpace(notes || [], bpm);
        const measures = this.toMeasures(beatNotes, beatsPerMeasure);

        // opts.targetWidth (the scroll container's own current width, see Timeline.refresh) lets
        // a short segment fill whatever room the caller actually has -- e.g. #notation-bar's
        // Timeline half, per the layout it now shares with the mode's controls -- instead of
        // always rendering at the same fixed size regardless of how much space is available.
        // Never shrinks below MEASURE_WIDTH: a long piece that needs MORE room than it's given
        // keeps its normal spacing and scrolls (.notation-scroll's own overflow-x), rather than
        // cramming notes tighter just because the viewport happens to be narrow.
        let measureWidth = this.MEASURE_WIDTH;
        if (opts.targetWidth) {
            const fitted = (opts.targetWidth - 40) / measures.length;
            measureWidth = Math.min(this.MEASURE_WIDTH_MAX, Math.max(this.MEASURE_WIDTH, fitted));
        }

        const width = Math.max(300, measures.length * measureWidth + 40);
        const height = this.STAVE_HEIGHT * 2 + 40;

        const renderer = new VexFlow.Renderer(container, VexFlow.Renderer.Backends.SVG);
        renderer.resize(width, height);
        const ctx = renderer.getContext();
        // VexFlow defaults every drawn shape's fill/stroke to black -- invisible (or near enough)
        // against this app's dark theme background, which is exactly what happened before this
        // line existed (caught by Codex's review: the staff technically rendered, just as solid
        // black on near-black, effectively invisible in a screenshot). NOTE_COLOR matches
        // css/style.css's --text custom property; kept in sync by hand since this module has no
        // access to a live CSS custom property outside a real DOM query.
        ctx.setFillStyle(this.NOTE_COLOR);
        ctx.setStrokeStyle(this.NOTE_COLOR);

        const noteXPositions = [];
        const barlineXPositions = [];
        let staveBounds = null;
        let endPaddingVexNote = null;
        let x = 10;
        measures.forEach((items, mi) => {
            barlineXPositions.push(x);
            const treble = new VexFlow.Stave(x, 10, measureWidth);
            const bass = new VexFlow.Stave(x, 10 + this.STAVE_HEIGHT, measureWidth);
            if (mi === 0) {
                treble.addClef('treble');
                bass.addClef('bass');
                if (keySignature != null && this.FIFTHS_TO_VEX_KEY[keySignature + 7]) {
                    const vexKeySpec = this.FIFTHS_TO_VEX_KEY[keySignature + 7];
                    treble.addKeySignature(vexKeySpec);
                    bass.addKeySignature(vexKeySpec);
                }
                treble.addTimeSignature(beatsPerMeasure + '/4');
                bass.addTimeSignature(beatsPerMeasure + '/4');
            }
            treble.setContext(ctx).draw();
            bass.setContext(ctx).draw();
            if (mi === 0) {
                staveBounds = {
                    trebleTop: treble.getYForLine(0),
                    trebleBottom: treble.getYForLine(4),
                    bassTop: bass.getYForLine(0),
                    bassBottom: bass.getYForLine(4),
                    spacing: treble.getSpacingBetweenLines(),
                };
            }
            if (mi === 0) {
                new VexFlow.StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
                new VexFlow.StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
            }

            const trebleItems = [];
            const bassItems = [];
            // VexFlow needs one StaveNote with multiple keys for a same-clef chord. Keep the
            // public flat noteXPositions contract, but combine adjacent same-onset notes here so
            // each member shares one formatted position while the two clefs retain independent
            // voices when a chord crosses the register split.
            const renderItems = [];
            items.forEach((item) => {
                if (item.rest) {
                    renderItems.push(item);
                    return;
                }
                const previous = renderItems[renderItems.length - 1];
                if (previous && previous.chord && previous.beatStart === item.beatStart) {
                    previous.chord.push(item);
                    previous.beatDuration = Math.max(previous.beatDuration, item.beatDuration);
                } else {
                    renderItems.push({
                        chord: [item],
                        beatStart: item.beatStart,
                        beatDuration: item.beatDuration,
                    });
                }
            });
            renderItems.forEach((item, ii) => {
                if (item.rest) {
                    const trebleRest = this._ghostRest('treble', item.beatDuration);
                    trebleItems.push(trebleRest);
                    bassItems.push(this._ghostRest('bass', item.beatDuration));
                    // The padding rest at the very end of the whole piece -- captured separately
                    // (endPadding below), NOT pushed into noteXPositions itself, since that array
                    // feeds renderLabels/hit-testing, which only know how to handle real notes.
                    // Gives an inclusive endIndex pointing at the LAST real note somewhere to
                    // render its marker (Timeline._positionMarker looks up id+1 for 'end', reusing
                    // the same "caret before this id" placement the start marker already uses --
                    // see its own comment). Without this, the end marker had no real landmark once
                    // the drilled segment reached the last note and visually sat BEFORE it instead
                    // of after, reading as excluding its own last note (reported live).
                    if (mi === measures.length - 1 && ii === items.length - 1 && beatNotes.length > 0) {
                        endPaddingVexNote = trebleRest;
                    }
                    return;
                }
                ['treble', 'bass'].forEach((clef) => {
                    const members = item.chord.filter((member) => (member.midi >= clefSplit) === (clef === 'treble'));
                    if (members.length === 0) {
                        (clef === 'treble' ? trebleItems : bassItems).push(this._ghostRest(clef, item.beatDuration));
                        return;
                    }
                    const keys = members.map((member) => this.midiToVexKey(member.midi, keySignature));
                    const vexNote = new VexFlow.StaveNote({
                        keys: keys.map((entry) => entry.key),
                        duration: this.durationCode(item.beatDuration),
                        clef,
                    });
                    keys.forEach((entry, keyIndex) => {
                        if (entry.accidental) vexNote.addModifier(new VexFlow.Accidental(entry.accidental), keyIndex);
                    });
                    // ctx.setFillStyle/setStrokeStyle (above) only covers elements that inherit the
                    // RenderContext's ambient color -- a StaveNote's stem and ledger lines each set
                    // their OWN hardcoded default color internally. Set the readable default and
                    // then apply the first member's mode-specific decoration to the grouped note.
                    vexNote.setStyle({ fillStyle: this.NOTE_COLOR, strokeStyle: this.NOTE_COLOR });
                    if (typeof vexNote.setLedgerLineStyle === 'function') {
                        vexNote.setLedgerLineStyle({ fillStyle: this.NOTE_COLOR, strokeStyle: this.NOTE_COLOR });
                    }
                    const noteDecorations = members.map((member) => opts.decorateNote ? (opts.decorateNote(member) || {}) : {});
                    const noteDecoration = noteDecorations[0];
                    if (noteDecoration.style) {
                        vexNote.setStyle(noteDecoration.style);
                        if (typeof vexNote.setLedgerLineStyle === 'function') vexNote.setLedgerLineStyle(noteDecoration.style);
                    }
                    members.forEach((member, memberIndex) => {
                        // Grouped StaveNotes expose per-key styling in VexFlow. Use it when
                        // available so a correct and missed member in the same clef remain
                        // visually distinct; the whole-note fallback above preserves readable
                        // styling on older VexFlow builds.
                        const memberDecoration = noteDecorations[memberIndex];
                        if (memberDecoration.style && typeof vexNote.setKeyStyle === 'function') {
                            vexNote.setKeyStyle(memberIndex, memberDecoration.style);
                        }
                        noteXPositions.push({ id: member.id, midi: member.midi, beatStart: member.beatStart, clef, vexNote });
                    });
                    (clef === 'treble' ? trebleItems : bassItems).push(vexNote);
                });
            });

            const trebleVoice = new VexFlow.Voice({ numBeats: beatsPerMeasure, beatValue: 4 }).setMode(VexFlow.Voice.Mode.SOFT);
            trebleVoice.addTickables(trebleItems);
            const bassVoice = new VexFlow.Voice({ numBeats: beatsPerMeasure, beatValue: 4 }).setMode(VexFlow.Voice.Mode.SOFT);
            bassVoice.addTickables(bassItems);

            // The ACTUAL usable width for notes, not a flat MEASURE_WIDTH-40 guess: the first
            // measure's clef+key+time-signature glyphs (added above) eat into the same fixed
            // MEASURE_WIDTH every later bare measure gets in full, so a flat budget starves
            // measure 1 specifically -- its formatter, asked to fit the same note count into LESS
            // real room, overflowed past the stave's own right edge into measure 2's space,
            // rendering the two measures' adjacent noteheads on top of each other (reported live,
            // from a real screenshot: "odd doubling... at the beginning of the second measure").
            // getNoteStartX()/getNoteEndX() read back the stave's own real front-matter width,
            // whatever it happens to be for THIS measure, rather than assuming one fixed number.
            const noteAreaWidth = treble.getNoteEndX() - treble.getNoteStartX();
            new VexFlow.Formatter().joinVoices([trebleVoice, bassVoice]).format([trebleVoice, bassVoice], noteAreaWidth);
            trebleVoice.draw(ctx, treble);
            bassVoice.draw(ctx, bass);

            x += measureWidth;
        });

        return {
            width,
            height,
            measureWidth,
            noteXPositions: noteXPositions.map((n) => ({
                id: n.id,
                midi: n.midi,
                beatStart: n.beatStart,
                clef: n.clef,
                x: n.vexNote.getAbsoluteX(),
                y: n.vexNote.getYs()[0],
            })),
            barlineXPositions: barlineXPositions,
            staveBounds: staveBounds,
            // {id, x} of the trailing padding rest at the very end of the piece, or null for an
            // empty `notes` -- see the items.forEach comment above. id === beatNotes.length, one
            // past the last real note's own id, so Timeline._positionMarker's "id+1" lookup for
            // the end marker finds this when endIndex is the last real note.
            endPadding: endPaddingVexNote ? { id: beatNotes.length, x: endPaddingVexNote.getAbsoluteX() } : null,
        };
    },

    // Renders one note-name/octave pitch per entry of `noteXPositions` (Notation.render's own
    // return value -- callers pass it straight through, no separate computation) into
    // #<containerId>, each absolutely positioned at that note's OWN x -- the same x VexFlow itself
    // reported, so this row lines up with the staff above it without a second, independently
    // -computed layout. This is the Timeline's own pitch row (INV-55) -- undecorated by default.
    //
    // `decorate`, optional: (entry) => {className, style, data} -- called per entry, letting a
    // mode layer its own presentation on top without this function needing to know what that
    // means. `data` sets extra data-* attributes (e.g. {role: 'past'} -> data-role="past"),
    // useful for tests/CSS to target without needing a dedicated className per state. Melody's
    // practice strip (js/melody.js) uses it for past/current/upcoming color hints; Compose's
    // Timeline omits it, staying plain.
    renderLabels: function(containerId, noteXPositions, keySignature, decorate) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.style.position = 'relative';
        container.style.height = '1.2em';
        (noteXPositions || []).forEach((n) => {
            const span = document.createElement('span');
            const deco = decorate ? (decorate(n) || {}) : {};
            span.className = 'note-token' + (deco.className ? ' ' + deco.className : ''); // same look as the Melody/Compose timeline tokens
            span.style.position = 'absolute';
            // +3px -- reported live: centered exactly on n.x read slightly LEFT of the actual
            // notehead above it. VexFlow's own getAbsoluteX() anchors to a note's left-side tick
            // position, not its glyph's visual center (see Timeline._positionMarker's own comment
            // on the same quirk) -- the notehead itself is drawn a little to the right of that x,
            // so the label needs the same small rightward bias to actually sit under it.
            span.style.left = (n.x + 3) + 'px';
            span.style.transform = 'translateX(-50%)';
            if (deco.style) {
                Object.keys(deco.style).forEach((key) => { span.style[key] = deco.style[key]; });
            }
            if (deco.data) {
                Object.keys(deco.data).forEach((key) => { span.setAttribute('data-' + key, deco.data[key]); });
            }
            span.setAttribute('data-note-idx', n.id);
            span.textContent = Tonnetz.getNoteName(n.midi, keySignature) + Tonnetz.getOctave(n.midi);
            container.appendChild(span);
        });
    },

    // One .notation-barline div per entry of `barlineXPositions` (Notation.render's own return
    // value), into #<containerId> -- meant to be the SHARED scroll wrapper
    // (#melody-notation-scroll/#compose-notation-scroll), not the staff itself, so each line's
    // CSS (top:0;bottom:0) spans the whole staff+labels+timeline stack rather than just the
    // staff's own drawn barlines, which only mark the boundary within the staff.
    // docs/melody-notation-design.md's "Barline-overlay mechanics" open item.
    renderBarlineOverlay: function(containerId, barlineXPositions) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('.notation-barline').forEach((el) => el.remove());
        // Skip index 0: it's the leading edge of the FIRST measure (right at the clef), not a
        // boundary between two measures -- real sheet music doesn't draw a barline there either.
        // The full array (including index 0) is still returned by Notation.render/kept as-is for
        // beatFromX's own per-measure indexing, which needs that first entry to place clicks
        // inside measure 0 correctly; only the drawn overlay skips it.
        (barlineXPositions || []).slice(1).forEach((x) => {
            const line = document.createElement('div');
            line.className = 'notation-barline';
            line.style.left = x + 'px';
            container.appendChild(line);
        });
    },
};

if (typeof module !== 'undefined') {
    module.exports = Notation;
}
