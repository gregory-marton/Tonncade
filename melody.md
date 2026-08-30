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
polyphonic musical data. Then add partial-credit chord practice and richer feedback. The practice
loop already commits to non-interruptive performance, continued guide playback, obvious but
voluntary targets, and adaptive tolerance; timing scores, play-along detection, hand separation,
and advanced notation interpretation come later, after the core event model is proven.

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
- Render only the clef(s) that contain music in the complete loaded song; if one clef is silent for
  the whole song, omit that clef and its all-rest voice. Decide this at whole-song scope, never
  from the selected drill range, so moving the practice markers cannot change the learner's
  orientation or make the notation jump.
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

The first timing step is intentionally lighter than scoring: at Medium and Hard, compare each
event's onset spacing with the target's relative spacing and mark the event early, on-time, or late.
Easy remains indifferent to timing. This gives a learner a second feedback dimension without making
timing a gate before tolerance and play-along behavior are designed.

MIDI practice also needs a device-lifecycle safeguard: when supported, an active Web MIDI session
requests a Screen Wake Lock so a phone or tablet does not sleep during hands-on practice. The lock
must be reacquired after the page becomes visible again, and failure or lack of browser support must
not disable MIDI input. This follows the mobile report tracked in issue #29.

### Early-learner guardrails

The Simon-like loop is useful for short pitch-memory and instrument-mapping drills, but it must not
pretend that exact MIDI pitch order is the whole of musicianship. For early learners, the default
experience should eventually separate these modes of practice:

- **Listen and find:** generous pitch tolerance, no timing judgment, and clear current-note hints.
- **Play along:** Melody continues while the learner plays; wrong or extra notes are recorded as
  feedback without interrupting the learner's phrase.
- **Read:** the staff and rhythm become primary, with hints gradually reduced.
- **Perform:** timing, pitch, completeness, continuity, and eventually dynamics can contribute to
  an optional score.
- **Explore:** experimentation is welcome and is not represented as failure.

The current implementation is strongest as a pitch-memory/readiness drill. Its next pedagogical
risks to address are interruptive replay, lack of timing/rhythm feedback, ignored MIDI velocity and
note-off duration, limited learner choice, and treating register-split notation as if it were true
hand separation. These should be addressed with explicit practice choices and progressive tolerance,
not by making every beginner pass an exact performance test. Chord partial credit and per-member
feedback are foundations for this progression, not its endpoint.

### Current practice-loop commitments

These are part of the current design, not deferred aspirations:

- Never interrupt an ongoing child performance for an ordinary wrong note.
- Continue the backing or guide while tracking missed and extra notes.
- Make the next target visually obvious, while allowing the child to replay or isolate it
  voluntarily with the moveable start/end markers.
- Use adaptive tolerance: ignore timing for acceptance early and accept partial chords early;
  higher levels may add stricter completeness and timing expectations as those policies become
  explicit. The current higher-level timing signal is visual only and does not gate progress.

During guide playback, child MIDI notes remain audible and are collected rather than stopping the
guide. After the guide finishes, Melody compares the collected notes with the requested events,
retaining correct members and recording missed and extra pitches. If recovery is needed, the next
prompt waits for both the adaptive pause and a silence window after the child's latest input.

For a searching learner, target playback may slow to 2×, 3×, or 4× slower than the normal prompt
speed, stopping at 4×. This is a playback-speed choice, not an exponentially lengthening silent
interval; active playing always takes priority over another prompt.

## Longer songs and drill progression

Update preview playback, timeline markers, scrolling, celebration, `startIndex`, `endIndex`,
`userIndex`, and measure credit to operate on timed events while retaining member-level feedback.

- A chord counts as one event for progression and drill navigation.
- User-selected drill ranges remain valid and continue to satisfy INV-26.
- End growth remains deterministic and is never caused by an incorrect input.
- A mistake in a later measure does not erase already-banked credit from an earlier measure.
- Preview plays the same event/member data that the learner is asked to reproduce.

### Random practice

Random is a pure Simon exercise and follows a separate progression contract from authored songs:

- Begin with a one-event generated prefix.
- Play the complete prefix, then accept the learner's complete repeat from position zero.
- Append exactly one generated event after each successful prefix repeat, without a fixed maximum.
- Retain and render the complete generated prefix in the ordinary scrollable Timeline; long Random
  play may scroll just like a long authored song, but its content does not slide or disappear.
- Keep the logical start at zero. Do not apply authored-song measure mastery or automatically move
  the start marker.
- Use seeded randomness so a replay can regenerate the same growing sequence.

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
- An active MIDI practice session requests and, after visibility changes, safely reacquires a screen
  wake lock when the browser supports it; wake-lock denial never disables MIDI input.
- Notes played by the learner while Melody demonstrates a target are retained and evaluated after
  the demonstration, rather than silently discarded.
- Melody matching and notation use the same onset-event tolerance, including for off-grid MIDI
  note-ons.

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
- MIDI connection lifecycle and wake-lock fallback behavior on mobile-capable browsers.
- Relative timing feedback at higher difficulties, with no timing score or Easy-mode gate.
- Existing desktop, mobile, and invariant suites without weakening their assertions.

Prefer structural assertions—event/member counts, pitch sets, x-position ordering, barline counts,
and known key spellings—over pixel-level rendering assertions.

## Next steps: pedagogical depth

After the current event model and practice-loop commitments are stable, add:

- Explicit **Practice this spot** and **Repeat slowly** controls.
- Learner-selected textures: melody-only, right hand, left hand, simplified chords, or full
  texture.
- Separate feedback dimensions for pitch, rhythm, completeness, and continuity.
- Short musical phrases with cadence and accompaniment, rather than only arbitrary note sequences.
- Encouragement after mistakes—for example, “You found 3 of 4 notes; let’s try the missing one”—
  instead of effectively restarting the game.
