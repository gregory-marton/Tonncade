# Tonnetz Tetris

Tetris played on Euler's *Tonnetz* — a hexagonal lattice of musical notes — so that
placing pieces is both a spatial puzzle **and** music. Built in vanilla JavaScript,
runnable directly from a `file://` URL (no server, no build step).

> **Status: design / brainstorming in progress.** No game code written yet.
> One interactive decision-prototype exists at `mockups/geometry.html` (see below).
> This README is the handoff document — read it top to bottom before continuing.

---

## How to pick this up (for the next agent)

The project is mid-**brainstorming** (using the `superpowers:brainstorming` skill). The
design below is ~90% settled. **Two open questions remain** (see
[Open questions](#open-questions-blocking-the-spec)) — resolve those with the user,
then:

1. Write the spec to `docs/superpowers/specs/YYYY-MM-DD-tonnetz-tetris-hello-world-design.md`
2. Do the brainstorming spec self-review, get user sign-off on the spec.
3. Invoke `superpowers:writing-plans` to produce an implementation plan.
4. Build **Chop mode** first (it's the literal hello-world), then Puzzle mode.

Use TDD per the user's global instructions. The user prefers **prose answers** over
multiple-choice modals, and enjoys reasoning through design details — engage, don't
just collect answers.

---

## What we're building

### Core concept

Euler's Tonnetz is a lattice where notes are arranged by **consonant intervals**. In the
**hexagonal** representation (the "Harmonic Table"), every note is a hexagon, and its 6
edges lead to its 6 closest harmonic relatives:

- → **perfect fifth** (+7 semitones)
- ↗ **major third** (+4)
- ↖ **minor third** direction (the third axis; the ± of these three fill all 6 neighbors: ±fifth, ±major third, ±minor third)

Three hexagons meeting at a corner form a **triad** (the Tonnetz's signature property —
this is why the lattice is musically special).

**A Tetris cell = one note** (one hexagon). This was a deliberate choice over the
alternative ("a cell = a triangle/triad"); see [Decisions](#decisions-locked).

### The pieces: tetrahexes, not tetrominoes

Because the grid is hexagonal (6-fold symmetric), the natural 4-cell pieces are
**tetrahexes** (4 hexagons joined edge-to-edge), **not** the square tetrominoes. There
are **7 free tetrahexes**; treating mirror images as distinct pieces — the way Tetris
treats S vs Z and L vs J, since you can rotate but not flip — gives a few more. **Generate
the exact set programmatically** rather than hand-listing, so the palette is provably
complete.

### Rotation re-voices the chord (the soul of the game)

A square grid is 4-fold symmetric (90° turns). The Tonnetz lattice is **6-fold** symmetric,
so rotation steps **60°**. Critically, a 60° turn **cycles the three interval axes**: every
fifth in a piece becomes a major third, every major third becomes a minor third. So
**rotation literally changes the chord you hear.** Examples for the straight "I" line of 4:

- along fifths: `C–G–D–A` (open, suspended)
- rotate 60° → along major thirds: `C–E–G♯` (augmented, eerie)
- rotate 60° → along minor thirds: `C–E♭–G♭–A` (a diminished-7th chord)

This is why classic tetromino intuitions break (a line has **3** orientations here, not 2;
the "square" O becomes a rotatable rhombus, etc.) — and it's the whole point of the game.

### Tuning

**Harmonic Table** layout with **real pitches rising up/right** (NOT octave-wrapped):
`midi = 60 + 7*(p−2) + 4*(q−1)` style mapping in the prototype, where `p` steps fifths
(→) and `q` steps major thirds (↗). This keeps the lattice musically honest (you hear
real intervals and real register), at the cost of pitches getting extreme if you pan very
far — acceptable, possibly soft-clamp playback to a sane MIDI range later.

### Sound

Warm **triangle-wave** synth via Web Audio, gentle attack/decay envelope, light lowpass
(~2.6kHz) for a pleasing tone. **A piece sounds when placed** (default articulation: soft
chord with a quick roll — easy to retune; user didn't lock this exactly). In the future
Gravity mode, a piece will sound **every time it moves**, not just on placement.

---

## The three modes

| Mode | Board | How pieces arrive | Clears? | Status |
|------|-------|-------------------|---------|--------|
| **1. Chop** | Infinite (pannable) | You pick any piece from a palette | No | **Build first — this is the hello-world** |
| **2. Puzzle** | Bounded (finite hex region) | Randomly fed, no time limit | Yes (see below) | Build second |
| **3. Gravity** | TBD | Falling | Yes | Deferred — stub as "coming soon" |

**Mode 1 — Chop:** Pick a piece, rotate it freely (60° steps), click an empty hex to
place it (it sounds). **Clicking a piece already on the board picks it back up** so you can
re-place it elsewhere. Drag empty space to pan the infinite lattice. No clears, no gravity
— pure harmony sandbox. *This is the original hello-world ask: see the Tonnetz, choose a
tetromino, click to place, hear it.*

**Mode 2 — Puzzle:** A finite hex-shaped board. You're given randomly chosen pieces (no
clock) to orient and place into empty cells. **Line-clear** ("fill an edge → it
disappears"): the current interpretation is *any complete straight line of cells along any
of the 3 axes clears and plays a flourish* — on a bounded hex board the edge lines are
shortest, so they're the easiest to complete, which is likely what the user meant by
"edge." **⚠ This interpretation is unconfirmed — see open questions.** Cleared cells just
vanish; nothing falls (no gravity in this mode).

**Mode 3 — Gravity:** Real falling-Tetris mode, designed/implemented later. Pieces sound
on every move. When we get here, also settle: gravity direction (user mused "down and to
the right"?), and the lovely line-clear payoff — **a full row along the fifth-axis is the
complete circle of fifths = all 12 notes.**

---

## Decisions locked

- **Language/stack:** vanilla JS, SVG for rendering, Web Audio for sound. Runs from
  `file://`.
- **No ES modules** (browsers block `type="module"` over `file://` via CORS). Use plain
  `<script src>` classic scripts so it just opens. Keep code split into clean units anyway:
  `tonnetz` (coords ↔ pitch ↔ hex geometry), `pieces` (tetrahex generation + rotation),
  `synth` (Web Audio), `render` (SVG), and one controller per mode over a shared board.
  (Single self-contained HTML is the alternative for max portability; multi-file chosen for
  maintainability as the 3 modes grow.)
- **Cell = note** (hexagon), labeled with its note name (C, G, E…).
- **Pieces = tetrahexes**, generated in code, mirror-images distinct (no flip move).
- **Rotation = 60° steps**, re-voicing the chord.
- **Tuning = real pitches rising up/right** (Harmonic Table), not octave-wrapped.
- **Sound on placement** in all modes; on every move in Gravity mode.
- **Three modes:** Chop, Puzzle, Gravity. **Build order: Chop → Puzzle → Gravity.**
- **Deferred entirely for now:** gravity/auto-fall, scoring/bonuses, hold & next-queue,
  collision rules beyond what Chop/Puzzle need.

---

## Open questions (blocking the spec)

1. **Puzzle line-clear definition.** Confirm "fill an edge → disappears" means *any
   complete axis-line of cells clears* (edges just being the easiest on a bounded board),
   vs. something more specific by "edge." Also: what shape/size is the bounded Puzzle board
   (hexagon? rhombus? how many cells across)?
2. **First-drop scope.** Confirm **Chop-first, then Puzzle** (recommended — fastest path to
   a playable/hearable thing), vs. wanting both Chop and Puzzle in the very first deliverable.

Minor / safe-to-default (confirm if convenient):

- Placement articulation: soft chord + quick roll (default) vs. clear one-note-at-a-time
  arpeggio.
- Whether to soft-clamp playback pitch when panning far from center in Chop mode.

---

## What already exists

- **`mockups/geometry.html`** — a standalone, sound-playing decision prototype (open via
  `file:///Users/gregorymarton/Documents/GitHub/TonnetzTetris/mockups/geometry.html`).
  It draws the Tonnetz two ways — "cell = note" vs "cell = chord" — and lets you click
  cells and play a sample piece to *hear* the difference. **It drove the "cell = note"
  decision.** Note: it renders nodes as **labeled circles**, not hexagons — the real game
  should render **hexagons** (Harmonic Table style) per the locked design. The audio synth,
  the `midi = 60 + 7*(p−2) + 4*(q−1)` pitch mapping, and the lattice math in this file are
  good references to carry forward.

Nothing else is built. No `package.json`, no game code, no tests yet.

---

## Background / conversation summary

The user wants something they'll **genuinely use**, with the eventual goal of "more or less
traditional Tetris with pleasing sounds," and is open to discovering that hex-native
*n-ominoes* work better than square tetrominoes (they do — hence tetrahexes). The driving
desire throughout: to **see and especially to *hear* what Tetris would be like on the
Tonnetz grid.** The project soul is a genuine fusion of puzzle and harmony, not a reskin.

The user installed Node mid-session (so the `superpowers` brainstorming **visual companion**
server can run in future sessions — it needs Node, which wasn't on PATH at session start).
For audio-centric decisions, standalone `file://` HTML prototypes (like `mockups/`) work
better than the companion anyway, since they can play real sound.

User's working preferences observed: prefers detailed prose replies over multiple-choice
modals; reasons carefully about mechanics; follows red-green TDD (per global CLAUDE.md).
