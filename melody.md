<!--
Copyright (C) 2026 Gregory Marton
Co-authored-by: GPT-5, Aug 2026
-->

# Melody

This document supersedes `docs/melody-notation-design.md`. It is the canonical design and
implementation plan for Melody mode's notation, import, matching, feedback, and longer-song
work.

## Purpose and current direction

Melody is a practice mode built around the Tonnetz and ordinary music notation. A learner should
be able to hear a passage, see it on a grand staff, find its pitches on the Tonnetz, and practice
the passage without being forced to restart useful work after every mistake.

The work is intentionally staged. First make the current difficulty levels reliable and preserve
polyphonic musical data. Then add partial-credit chord practice and richer feedback. Timing scores,
play-along detection, hand separation, and advanced notation interpretation come later, after the
core event model is proven.

## Immediate reliability work: GitHub issue #31

Issue #31 reports three related problems:

- Level 1 Random can appear to be won unexpectedly.
- Level 2 may fail to advance, and wrong notes can make it move.
- Level 3 hides the staff notation.

The intended difficulty contract is:

- **Easy:** complete notation, current target, upcoming-event hints, and Tonnetz guidance.
- **Medium:** complete notation and current target, with reduced or no advance hints.
- **Hard:** complete notation and current target remain visible; advance hints and Tonnetz guidance
  are removed.

Difficulty changes the amount of help, not the musical data, correctness rules, or progression
rules. Notation is visible at every level because reading the music is part of the learning task.
Correct input advances deterministically at every level. Incorrect input never advances progress.
Random mode must not complete merely because its visible window becomes empty.

Add deterministic story coverage for correct and incorrect input at all three levels. Random-mode
tests must use controlled data or randomness rather than relying on uncontrolled `Math.random()`.

## Musical data model: timed polyphonic events

MIDI is not monophonic. The current application is effectively monophonic because MIDI loading
passes through `extractMonophonicMelody()`, which discards simultaneous notes. That step must be
removed from Melody's normal import path.

The canonical in-memory practice sequence is a list of timed events. Each event has a start time,
duration, and one or more note members. Each member retains its exact MIDI pitch, including octave,
and enough authored notation information to render and match it correctly.

Conceptually:

```text
event {
  time,
  duration,
  notes: [
    { midi, duration, ... },
    ...
  ]
}
```

The exact JavaScript shape may follow existing project conventions, but all consumers must use the
same event abstraction rather than independently reconstructing chords.

Import requirements:

- Group MIDI note-ons with the same onset into one event and preserve every pitch.
- Preserve MusicXML chord members as one event.
- Preserve overlapping notes and repeated pitches in separate events.
- Keep authored MusicXML key signatures, meters, tempos, durations, ties, and barlines.
- Normalize raw MIDI and Random data through a practical quantization, spelling, and measure-
  inference path.
- Keep multiple independent voices/parts, lyrics, dynamics, advanced ornaments, and transposing
  instruments out of the first implementation unless a concrete fixture requires them.

MusicXML remains the canonical notation/write format for authored material. MIDI remains a fully
supported import format for files users already have. `.mxl` remains supported as compressed
MusicXML.

## Chord practice and partial credit

For a target event such as C4–E4–G4, Melody tracks each member independently as pending, correct,
or missed.

- Input order does not matter within the short chord-grouping window.
- Correct members receive credit immediately and do not need to be played again.
- A chord event remains active until all required members have been supplied.
- Incorrect pitches never advance the event and never erase already-correct members.
- A partial attempt replays the entire target chord.
- The retry state may subtly emphasize missing members visually, but the replayed audio remains the
  complete original chord.
- The event cursor advances only when every required member is complete.
- A chord is one navigation and measure-progression event, while its members remain independently
  addressable for feedback.

The existing MIDI chord-buffer concept supplies the initial grouping window. Touch and keyboard
input should receive equivalent grouping semantics in the appropriate input milestone, so the same
musical action produces the same result regardless of input method.

## Notation and Timeline

Melody and Compose use the shared `Timeline` component: grand staff, aligned octave-qualified
pitch row, measure barlines, and draggable boundaries form one connected visual stack. VexFlow is
the renderer; it is a renderer only, while interaction and audio remain Tonncade's responsibility.

Notation requirements:

- Render every event, including every member of a chord.
- Keep each staff notehead, pitch label, Tonnetz highlight, and timeline position synchronized.
- Show note names with octave, using authored or detected key spelling.
- Keep the current target visible at every difficulty level.
- Highlight the full staff-column region of the current event, not only a small triangle.
- Keep barlines aligned through the staff, pitch row, and marker stack.
- Keep the existing pannable/scrollable behavior and marker invariants intact.

The grand staff is one voice split by register, not a promise of independent left- and right-hand
voices. A clef split around middle C is the initial default and should be checked against a real
wide-range fixture.

Compose's broader notation direction remains compatible with this model: pitch can be edited on
the staff or Tonnetz, time is edited on the staff, and geometric Tonnetz transformations preserve
each event member's timing and duration.

## Practice feedback and recovery

Add feedback before adding scoring:

- Show per-member success and miss state on the staff and aligned pitch row.
- Keep accepted chord members visibly accepted while missing members remain actionable.
- Keep the active event's full staff column highlighted.
- Link relevant event members to all matching Tonnetz cells.
- Preserve the current difficulty barbell, using it to control hint density rather than changing
  the underlying matching rules.
- Replace the current single-note mistake assumptions with event/member-aware recovery.
- Keep the learner at the current event after an error and replay the complete target event.

Do not introduce timing scores in this stage. Correct pitches, useful recovery, and readable
feedback come first. Adaptive timing, play-along/overplay detection, hand separation, and scoring
are follow-up work.

## Longer songs and drill progression

Update preview playback, timeline markers, scrolling, celebration, `startIndex`, `endIndex`,
`userIndex`, and measure credit to operate on timed events while retaining member-level feedback.

- A chord counts as one event for progression and drill navigation.
- User-selected drill ranges remain valid and continue to satisfy INV-26.
- End growth remains deterministic and is never caused by an incorrect input.
- A mistake in a later measure does not erase already-banked credit from an earlier measure.
- Preview plays the same event/member data that the learner is asked to reproduce.

## Invariants

Existing invariants remain the source of truth and must not be weakened:

- **INV-4 / INV-46:** every sound is the true pitch of the responsible cell or event member.
- **INV-5:** sound, staff, timeline, and Tonnetz feedback stay synchronized.
- **INV-23 / INV-32:** MIDI input behaves like equivalent UI input in every supported mode.
- **INV-25:** octave is part of pitch identity and is displayed to the learner.
- **INV-26:** drill bounds, seeking, measure credit, and recovery remain coherent.
- **INV-48:** switching modes pauses Melody without discarding its progress.

Add explicit invariants stating that:

- Polyphonic MIDI import never discards simultaneous notes.
- An event's pitch set is preserved through import, notation, playback, highlighting, and matching.
- Correct chord members retain credit after incorrect or missing members.
- A partially completed chord does not advance the event cursor.
- A partial retry replays the complete original chord.
- Each member's visual state reflects its own performance result.
- All difficulty levels retain readable staff notation.

## Delivery milestones

### Milestone 1: reliability and regression coverage

Fix issue #31 first. Define and test the three difficulty contracts, correct progression, wrong-input
behavior, Random completion, and always-visible notation.

### Milestone 2: polyphonic import foundation

Introduce timed events, preserve MIDI chords and MusicXML chord members, and update rendering,
preview, highlighting, markers, and measure logic to consume events.

### Milestone 3: partial-credit chord practice

Implement member-level matching, order-independent grouped input, full-chord replay, and retained
credit for correct members. Cover MIDI first, then equivalent touch and keyboard grouping.

### Milestone 4: feedback and longer-song polish

Add staff/member feedback, full-column emphasis, improved recovery presentation, long-song fixtures,
and edge-scroll/Timeline coverage.

### Later milestones

Consider timing accuracy and scoring, adaptive difficulty, play-along credit, hand separation,
grace-note interpretation, repeats/endings/navigation unrolling, and other advanced notation only
after the event model and core practice loop are stable.

## Test plan

Add and retain tests for:

- Issue #31 behavior at all difficulty levels.
- Level 3 staff visibility.
- Level 2 advancement only on correct input.
- Level 1 Random completion only through intentional progression.
- Polyphonic MIDI parsing, including simultaneous and overlapping notes.
- MusicXML `<chord/>` grouping.
- Complete chords, arbitrary member order, partial credit, wrong notes, duplicate input, and full-
  chord replay.
- Per-member staff/pitch-row feedback and full-event Tonnetz highlighting.
- Preview synchronization and timeline alignment.
- MIDI/UI input equivalence.
- Existing desktop, mobile, and invariant suites without weakening their assertions.

Prefer structural assertions—event/member counts, pitch sets, x-position ordering, barline counts,
and known key spellings—over pixel-level rendering assertions.
