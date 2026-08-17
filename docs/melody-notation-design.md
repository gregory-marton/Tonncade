# Melody/Compose: grand-staff notation (design, not yet implemented)

Show the song (or Random's generated sequence) on an actual grand staff (treble + bass, like
piano notation), with each note's name+octave printed underneath it, and measure barlines that
visually span the whole stack -- staff, the name/octave row, and the existing note-token timeline
below it -- as one connected block per measure. The staff sits ABOVE the existing timeline, not in
place of it: the timeline keeps doing the interactive job (scrub marker, drag-to-seek,
tri-coloured upcoming notes, edge-scroll). The two views stay in perfect horizontal sync -- every
note's staff position, its name/octave label, and its timeline token line up at the same
x-coordinate, with barlines connecting straight through all three.

Two distinct vertical elements span the whole stack, not one: measure barlines (above), AND the
existing timing scrub I-beam (`positionScrubMarker`, INV-26 -- today spans only the note-timeline)
extends upward through the staff and the name/octave row too. Dragging it needs to show exactly
which staff note and which name/octave label it's currently pointing at, not just which timeline
token -- same "everything lines up at one x-coordinate" requirement as the barlines, applied to a
second, independently-positioned element.

## Rendering library: VexFlow

Vendor VexFlow directly (MIT, zero dependencies, production bundle `build/cjs/vexflow.js` is
~1.1MB minified with a preserved copyright comment). Not Smoosic (the full editor built on top of
VexFlow) -- its published npm bundle is a 25MB unminified dev build wrapping its entire desktop
application (every dialog, every menu, its own audio stack, Vue baked in, no evidence of
tree-shaking), a scope mismatch for a project with zero external JS dependencies. VexFlow is a
renderer only -- no dialogs, no menus, no audio -- so all interaction (below) is ours to write.

## Why Compose exists, given real notation editors already do general composition well

MuseScore/Flat.io/Noteflight/Smoosic's own hosted app all do general music composition better than
Tonncade plausibly ever will -- more notation vocabulary, real engraving quality, rhythm
precision. Compose isn't competing with them at "compose a piece of music" in general. What it
uniquely has, and no staff-based editor structurally can:

- **Geometric operations that only exist because pitch is 2D here, not 1D.** On the Tonnetz,
  moving one direction is always a perfect fifth, another always a major third -- a chord has a
  literal, consistent shape, congruent wherever it sits. `translateSelection` (drag = exact
  transposition) and `rotateSelection` (rotate = harmonic variation) are only meaningful because
  the lattice encodes harmony spatially. Staff notation's 1D pitch axis has no analog to "select
  this phrase and rotate it 60 deg." Compose's one genuinely irreplaceable thing.
- **Same spatial vocabulary as the rest of the app** (Sandbox's chord guide, Melody's practice
  loop) -- composing here uses the mental model the rest of Tonncade teaches, not an unrelated one.
- **Zero-friction feed into Melody's practice loop**, same app, no export/re-upload round trip.

## Compose editing: pitch on both surfaces, time on the staff only -- a bidirectional translation tool

The Tonnetz has no time axis at all -- it IS pitch-space -- so it can only ever edit pitch, never
time. Add and re-pitch are each valuable on BOTH the Tonnetz and the staff (neither redundant,
each direction teaches or enables something the other can't); retiming is staff-only, because
there's nothing on the Tonnetz for it to act on:

- **Click-to-add on the staff** does something Tonnetz-tap structurally cannot: specify an exact
  (pitch, time) pair in one gesture outside of live recording. A live Tonnetz tap gets its time
  from the recording clock; an edit-time Tonnetz tap has no time axis to click on. The staff has
  one.
- **Drag-to-re-pitch on the staff** is the other direction of the same translation the feature
  exists to build. Dragging on the Tonnetz and watching the staff update teaches "this spatial
  move means this notation change"; dragging on the staff and watching the TONNETZ SHAPE update
  teaches the reverse -- which matters most for anyone arriving with standard-notation background
  trying to understand what the Tonnetz represents.
- **Retiming (drag along the time axis)** is staff-only: there's no Tonnetz gesture for "move this
  note a sixteenth note earlier," because the Tonnetz has no time axis to grab. The one edit that's
  genuinely staff-exclusive.
- **Updates are LIVE, in sync, during the gesture** -- not applied-then-refreshed after release.
  Drag a notehead on the staff and the Tonnetz's highlighted cell moves continuously with it, not
  just on drop; same in the other direction for a Tonnetz drag/rotate updating the staff. Both
  renders need to be cheap enough to run on every `pointermove`, not only on release.
- The segment-transform workflow below is still the standout, most-unique-to-Compose capability
  (geometric operations no staff-based editor has an analog for). Add/re-pitch/retime parity across
  both surfaces is a second, complementary source of value (the bidirectional teaching tool), not
  competing with it.

## The central workflow: select a time range -> flatten onto the Tonnetz -> transform -> both views update

The workflow that proves Compose's value -- build first, before the full staff-rendering pipeline,
since it can be prototyped against the existing Tonnetz rendering without VexFlow being ready at
all.

1. **Select a time range** (e.g. three measures) on the staff/timeline -- a new selection entry
   point (today, selection only happens by tapping/shift-tapping notes directly on the Tonnetz).
   Populates `state.selectedIndices` with every note whose `time` falls in that range, regardless
   of pitch.
2. **The selection's pitches project onto the Tonnetz as highlighted cells, discarding time for
   that view.** Multiple notes at the same pitch naturally share one highlighted hex -- no dedup
   logic needed. A simplification of the VIEW only -- `state.notes` keeps every note's own exact
   `time`/`duration` throughout.
3. **Drag (translate) or rotate that flattened shape on the Tonnetz.** `translateSelection`/
   `rotateSelection` (`js/compose.js`, already shipped, already undo-stack-covered) already iterate
   `state.selectedIndices` and only ever touch each note's `p`/`q`/`midi` -- `time`/`duration` were
   never part of what they write, which is exactly "time stays as it was while the notes
   themselves change." Likely zero mutator changes needed. New work: (a) the time-range-selection
   UI feeding `state.selectedIndices` from the staff/timeline, and (b) confirming the Tonnetz's
   highlight rendering and drag-initiation logic work for a selection that spans several
   non-adjacent hexes, not only a single contiguous tapped blob.
4. **Both views update** -- the transform is driven by a Tonnetz gesture, but its result renders on
   both the Tonnetz and the staff (new pitches, unchanged time positions). Seeing a harmonic
   transformation performed spatially reflected in standard notation is the pedagogical bridge the
   whole feature exists to build.

## Rhythm, spelling, and measures: three problems, resolved by "authored vs. raw performance data"

Three separate hard, well-solved-elsewhere problems, not equal weight:

1. **Rhythm quantization** -- turning timed/tapped input into notated duration. `js/compose.js`'s
   `quantizeNotes()` (task #52) exists today and is naive: independent
   `Math.round(n.time / gridSeconds) * gridSeconds` per note, no grouping heuristics, opt-in and
   off by default.
2. **Enharmonic spelling** -- sharp vs. flat depends on key context. `Tonnetz.getNoteName`
   (`js/tonnetz.js:50`) is a hardcoded sharps-only array today, no key-signature parameter, used
   everywhere (Tonnetz labels, clipboard text). A staff with a key signature showing "D#" where it
   should read "Eb" reads as a mistake in a way a hex-lattice label doesn't.
3. **Time-signature/measure inference** -- where barlines go, separate from note duration.

All three only need inference when the source is raw performance data with nothing authored:

- **Bundled songs, as MusicXML** (not MIDI): key signature and time signature are already
  written down. Zero inference needed, for any of the three.
- **Compose**: key signature and time signature are an explicit SETTING (same shape as the
  existing tempo/subdivision controls), not inferred from what got tapped. Sidesteps spelling and
  measure inference entirely.
- **MIDI uploads and Random's generated sequence**: the only raw-performance-data sources left --
  nothing authored, so this is the one place all three problems are real, and the one place a
  lightweight hand-rolled approach (existing quantizer, lightly improved; a small key-fit
  heuristic comparing pitch-class usage against the 24 major/minor scale profiles; a fixed time
  signature with naive fixed-grid barring) is the plan.

## music21 (Pyodide): not adopted, kept as an explicit fallback

Two reasons the lightweight hand-rolled approach is expected to be enough, not just cheaper:

- **The target user has a strong prior toward simple music** -- closer to a kid tapping out Auld
  Lang Syne than a professional transcribing something chromatic and syncopated. Mostly-diatonic,
  mostly-on-the-beat, regularly-barred input is exactly where a naive quantizer and a small
  key-fit heuristic work fine.
- **The professional case is served by a different path.** Someone with sophisticated material
  already has a real notation editor -- they export MusicXML from it and upload here, which skips
  the quantizer/speller/barring entirely (see above). Tonncade doesn't need to match
  Finale/MuseScore's engraving intelligence for that user, only accept their file.

Pyodide's cost (core alone ~6.4MB before any package, ~5s first load, music21 itself substantial
on top, for a PWA with no Python anywhere and no server) isn't worth paying across the whole
feature. Kept as the fallback if real usage against real (simple) songs shows the lightweight
version reading badly -- not pre-solved.

## MusicXML feature coverage

MusicXML can represent full orchestral scores, tab, percussion, and page-layout/engraving
directives. Tonncade is a single-voice hex-lattice melody game -- most of that is out of scope by
the app's nature.

**Supported:**
- Pitch (step/alter/octave), duration/note values (whole-16th, dotted), rests
- Key signature and time signature, including mid-piece changes (a `{time, key}`/`{time, meter}`
  track -- MusicXML's own shape, attributes can appear at the start of any measure)
- Measures/barlines, tempo
- Grand staff as one part split across two staves by register (NOT independent two-handed piano
  voices -- a register split of one monophonic line)
- Chords (simultaneous notes) -- Compose's existing `flushChordBuffer` already records true
  simultaneous notes, maps onto MusicXML's `<chord/>` marker within one voice
- **Ties** -- correctness-relevant, not cosmetic: whenever quantized duration doesn't fit a single
  notatable value, or a note sustains across a barline, a tie curve is what makes that read as one
  held note instead of two separate same-pitch noteheads.
- **Repeats AND D.C./D.S./Coda/Fine, both fully unrolled at import via one navigation state
  machine.** Every jump/repeat form (back-repeats, variant [first/second] endings, D.C. al Fine,
  D.S. al Coda, and their component directives `dacapo`/`dalsegno`/`tocoda`/`fine`/`segno`/`coda`)
  resolves into the actual linear note sequence Melody drills/Compose edits -- never read once
  through and silently shortened, never displayed AS a repeat/jump structure. Two permanent
  constraints:
  - **Read-only, one-way.** The state machine unrolls third-party content on the way in. Never
    reversed -- Compose's own MusicXML writer never emits `<repeat>`, `<ending>`, or any
    D.C./D.S./Coda/Fine directive, regardless of how sophisticated the reader gets. A composition
    made here is a flat, linear sequence, always.
  - **Not displayed.** The staff and the timeline both show the unrolled raw sequence -- no
    segno/coda glyphs, no repeat barlines, no "D.C. al Fine" text. What the player sees is exactly
    what they'll be asked to play, in the order they'll be asked to play it.
  - A piece that needs to round-trip its own repeat/coda structure (not just what it expands to)
    is real notation-editor territory, outside what this app does.
- **Grace notes** -- not just a rendering task. A grace note is inherently interpretively flexible
  (performers legitimately play it, or don't), so Melody's note-matching logic
  (`handleUserInputNote`, currently a strict linear compare against `state.melody[state.userIndex]`)
  needs to treat it as optional/skippable in the match sequence. Own design pass, not resolved
  here.
- **Glissando** -- also not just a rendering task. Two pieces: (1) Compose's input side --
  recognizing a continuous drag-across-cells gesture as a glissando rather than a pan/select drag
  (a third gesture category alongside the existing tap-vs-drag threshold logic in
  `js/life.js`/`js/main.js`); (2) Melody's matching side -- how strictly to require reproducing
  every intermediate pitch. Own design pass, not resolved here.
- **`.mxl` (compressed MusicXML)** on upload, not just plain-text `.musicxml`/`.xml` -- most real
  notation software defaults to `.mxl`. Without it, "export MusicXML from a real editor and
  upload it" (the escape hatch the music21 section above leans on) silently fails for most users
  of that path. **Done** -- `js/mxl.js` (native `DecompressionStream`, no vendored zip library),
  wired into both Melody's and Compose's `loadMelodyFromMxl`, tested against a real generated ZIP
  fixture.

**Explicitly excluded:**
- Multiple parts/instruments, multiple independent voices per staff (polyphony beyond chords) --
  one Tonnetz, one voice (+ chords), by the app's whole nature
- Guitar tab, percussion/unpitched notation
- Lyrics (`<lyric>`) -- gameplay is instrumental note-matching; a file's actual sung words, if
  present, are ignored
- Dynamics, articulations, ornaments (other than grace notes), technical marks (fingering etc.),
  and pedal markings -- performance/interpretation nuance the current Synth model doesn't
  represent (no per-note dynamic/articulation sound, no pedal-style sustain/blend across notes)
- Chord symbols (`<harmony>`, e.g. "Cmaj7" chart annotations)
- Tremolo
- Page layout/engraving directives (margins, system/page breaks, fonts) -- no print output
- Cross-staff notation, manual beam/stem overrides -- left to VexFlow's default engraving
- Transposing instruments (`<transpose>`, e.g. Bb clarinet's written-vs-sounding offset) --
  concert pitch only, matches the existing true-pitch invariant (INV-46). Not the same thing as
  Compose's own `translateSelection`/`rotateSelection` -- those already exist, already shipped,
  already undo-stack-covered.

## LibreJS compliance

VexFlow is MIT, a license LibreJS recognizes, and its production bundle's copyright comment
survives minification. Not automatic though: LibreJS scans the served file for a
LibreJS-recognized license comment (this project's own `@licstart`/`@licend` GPL blocks per
`docs/librejs-compliance.md`), not npm metadata -- what's actually vendored needs verifying
against the real tool. `npm run test:librejs` runs the actual LibreJS extension via a sibling
`../librejs` checkout + Selenium/geckodriver against the local dev server; run this once VexFlow
is vendored, before considering the feature done.

## MusicXML is the canonical/write format; MIDI is import-only

- **Bundled songs**: authored/stored as `.musicxml`, not derived from MIDI -- exact notated
  rhythm/key/time-signature, nothing inferred. Means re-authoring the `midi/*.mid` bundled library
  (or transcribing fresh).
- **Compose's Save**: writes MusicXML directly from its own document model (notes + the explicit
  key/time-signature setting) -- no quantize-from-timestamps step, because nothing here is ever a
  raw timestamp by the time it's saved. `js/melody.js`'s existing `writeMIDI()` likely becomes
  dead code for this path, unless a secondary "Export as MIDI" is wanted for interop.
- **MIDI's one remaining role: reading in a `.mid` file someone already has** -- existing local
  uploads, and the current bundled library until re-authored. `parseMIDI` (Melody) stays for this.
- **Random's generated sequence** has the same "never had notated rhythm" problem as MIDI --
  produced as raw `{midi, time, duration}` tuples. Goes through the same quantize/spell/
  bar-inference path as an uploaded MIDI file (write it out via the existing `writeMIDI()` and
  feed that through the same import path).

## Open items to settle when implementation actually starts

- Exact VexFlow API for reading back rendered note x-positions (barline/label/timeline sync, and
  the time-range-selection UI knowing which measures a click/drag spans) and for hit-testing
  clicks/drags against rendered noteheads (staff click-to-add, drag-to-re-pitch, drag-to-retime).
  **Done** -- `getAbsoluteX()`/`getYs()` on a rendered `StaveNote`, confirmed empirically against
  `Stave.getYForLine()`; `Notation.pitchFromY`/`beatFromX` invert the render math for hit-testing,
  cheap enough to run on every `mousemove` (no incremental VexFlow API needed -- Compose just
  re-renders the whole staff on each live update, same as every other redraw in this app).
- The time-range-selection -> Tonnetz-flatten -> transform workflow as the first concrete thing to
  prototype -- can be built against the existing Tonnetz rendering, without waiting on VexFlow.
- The lightweight quantizer/speller/barline-inference for the MIDI/Random bucket -- next concrete
  step once implementation starts.
- Grand staff clef split point (currently assumed MIDI 60/middle C) -- confirm against a real
  wide-range song once one's tried.
- Barline-overlay mechanics: likely absolutely-positioned elements sized off VexFlow's own
  note-coordinate readback, same technique as `positionScrubMarker`'s existing `offsetLeft`
  placement in `js/melody.js`. `positionScrubMarker` itself also needs extending -- today it sizes
  the I-beam to span only the note-timeline; it needs to grow to span the staff and name/octave
  row too, using the same VexFlow readback the barlines use, not a separate calculation.
- Navigation state machine's own shape: a small interpreter over `dacapo`/`dalsegno`/`tocoda`/
  `fine`/`segno`/`coda` plus `<repeat>`/`<ending>`, producing one flat linear sequence -- not yet
  designed in detail, just scoped.
- Testing approach: assert structural properties (note count, x-position ordering, barline count
  matches measure count, correct enharmonic spelling for a few known keys) rather than
  pixel-level rendering, consistent with this project's existing test style. Needs: fixture files
  exercising the navigation state machine (plain repeat, variant endings, D.C. al Fine, D.S. al
  Coda, at least one combining two of these) asserting the unrolled sequence is exactly right;
  a genuine `.mxl` (zip) fixture, not just plain XML text -- **done**, `tests/desktop.spec.js`'s
  `buildMxlFixture` builds a real, byte-exact ZIP via Node's own `zlib`.
