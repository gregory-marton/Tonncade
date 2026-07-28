<!--
Copyright (C) 2026  Gregory Marton
Part of Tonncade. GNU GPL v3 or later; see the LICENSE file.
-->

# Life on the Tonnetz — automaton (`.yaml`) rule language

Life is a cellular automaton played on the **Tonnetz** hex lattice. Each `.yaml` automaton file
carries **both a rule and a starting state**; the app loads it, runs it generation by generation,
draws the live cells on the lattice, and **sounds their notes** according to the file's own sound
spec. The goal is exploratory: to find automata that make pretty music on the Tonnetz.

Rules are authored in these files, not in the UI. This document is that language's reference; a
`.yaml` file may point at it in a comment (`# see docs/life-rules.md`).

> Status: **draft spec, pending implementation.** The schema below is what the engine will parse.

## The lattice and its neighbors

A cell is a lattice position `(p, q)`. Its pitch is `getMidi(p,q) = 60 + 7·p + 3·q` (see
`js/tonnetz.js`), so the interval from one cell to another is `7·Δp + 3·Δq` semitones.

Unlike a plain hex grid, the Tonnetz makes **non-adjacent** intervals musically meaningful (a
whole tone, a semitone), so the rule vocabulary reaches past the six touching cells.

The lattice is mathematically **unbounded** — `(p, q)` is well-defined arbitrarily far out — so a
cell that steps off the visible Tonnetz **keeps living and evolving** (and can be saved that way);
it just falls **silent**. A cell sounds only its own current `getMidi(p,q)`, and only within the
visible/audible range; it must never re-sound a stale note from a position it has since left. That
is the pitch invariant applied to motion, and it's what issue #13 was really about — a glider that
left the board kept sounding its *last on-board* note. (A far outer `HARD_BOUNDS` caps where cells
may live, purely so an explosive rule can't grow without limit and freeze the tab.)

### The consonant ring — the 6 adjacent hexes

These are always the "ring" used for `count` and `isotropy`. In cyclic order around the hexagon:

| slot index | name          | Δ(p,q)  | interval |
|-----------:|---------------|---------|----------|
| 0 | `fifth_up`         | (1, 0)  | +7 (P5)  |
| 1 | `major_third_up`   | (1, −1) | +4 (M3)  |
| 2 | `minor_third_down` | (0, −1) | −3 (m3)  |
| 3 | `fifth_down`       | (−1, 0) | −7 (P5)  |
| 4 | `major_third_down` | (−1, 1) | −4 (M3)  |
| 5 | `minor_third_up`   | (0, 1)  | +3 (m3)  |

Opposite slots (0↔3, 1↔4, 2↔5) are the same interval inverted — that is what makes slot 0/3 etc.
a **para** pair below.

### Extended interval neighbors (non-adjacent)

Referenceable by name; each is the nearest lattice cell at that exact interval:

| name           | Δ(p,q)  | interval | hex distance |
|----------------|---------|----------|-------------:|
| `semitone_up`   | (1, −2)  | +1 | 2 |
| `semitone_down` | (−1, 2)  | −1 | 2 |
| `tone_up`       | (−1, 3)  | +2 | 3 |
| `tone_down`     | (1, −3)  | −2 | 3 |
| `tritone_up`    | (0, 2)   | +6 | 2 |
| `tritone_down`  | (0, −2)  | −6 | 2 |

(Open question — **pitch vs pitch-class**: these are the nearest *exact-interval* cells. If we
later want "any cell a semitone away in any octave," that becomes a larger, octave-spanning set;
for now the stencil is these fixed offsets.)

## Isotropy — the arrangement of the live consonant ring

Rules may key on *how* the live ring-neighbors are arranged, not only how many — the orbit of the
6-bit ring under the dihedral group (rotations + reflections). A reflection of the ring is a
musical **inversion**, so chirality carries harmonic meaning.

| class      | example bits | meaning |
|------------|--------------|---------|
| `ortho` (2o)   | `110000` | two adjacent live neighbors |
| `meta` (2m)    | `101000` | two live, one gap between |
| `para` (2p)    | `100100` | two live, opposite each other |
| `vicinal` (3v) | `111000` | three live in a row |
| …              | …        | every dihedral orbit has a class |

Two cross-cutting meta-properties any configuration also has:

- `symmetric` — the arrangement has a reflection axis (achiral).
- `asymmetric` — it has none; its mirror image is a *distinct* arrangement (chiral).

## Automaton file schema

```yaml
# see docs/life-rules.md
name: "Callahan"
description: "A hexagonal life-like rule."

rule:
  # A cell's next state. `birth` applies to dead cells, `survival` to live cells; a cell that
  # matches neither dies / stays dead. Each is a list of CLAUSES; the transition fires if ANY
  # clause matches (OR of clauses). Within a clause every constraint must hold (AND).
  birth:
    - ring_count: [2]              # # of live cells in the 6-consonant ring is in this set
  survival:
    - ring_count: [3, 4]

  # Shorthand: a flat list of integers means "ring_count in this set", e.g.
  #   birth: [2]
  #   survival: [3, 4]

  # Richer clauses may add, all optional and AND-ed:
  #   isotropy: [ortho, meta]      # the live ring must be one of these arrangement classes
  #   require: [semitone_up]       # every named neighbor here must be ALIVE
  #   forbid:  [tritone_up]        # every named neighbor here must be DEAD
  # Names are any ring slot or extended-interval name from the tables above.

sound:
  when: born          # born | alive | died — which transition makes a cell sound
  duration: 0.4       # seconds (a number), or "generation" to sustain until the next step
  velocity: 80        # 1..127
  # A cell sounds its own Tonnetz pitch, getMidi(p, q).
  # DEFAULT: a file that omits `sound` entirely sounds each cell on BIRTH
  # (when: born, a short duration) — the built-in default.

initial:
  # The starting live cells, as [p, q] lattice pairs.
  cells:
    - [0, 0]
    - [1, 0]
    - [0, 1]

# Optional playback:
tempo: 240            # generations per minute (the step clock)
```

### Worked mini-example — a classic count rule

```yaml
name: "3,5 / 2"           # survive on 3 or 5 live ring-neighbors; born on 2
rule:
  survival: [3, 5]
  birth: [2]
sound: { when: born, duration: 0.5, velocity: 80 }
initial:
  cells: [[0,0], [1,0], [1,-1], [0,-1], [-1,0], [-1,1]]   # a full consonant ring around origin
tempo: 180
```

### Arrangement- and interval-aware example

```yaml
name: "Leading-tone bloom"
rule:
  birth:
    - ring_count: [2]
      isotropy: [para]           # only opposite-pair births (an interval and its inversion)
  survival:
    - ring_count: [3, 4]
    - ring_count: [2]
      require: [semitone_up]     # a 2-neighbor cell also survives if led-into from below
sound: { when: born, duration: "generation" }
initial:
  cells: [[0,0], [1,0], [-1,0]]
```

## Multi-state automata (transition tables)

Some interesting hexagonal rules use **more than two states** — a cell is 0 (empty), 1, 2, … —
and decide a cell's next state not from a birth/survival rule but from a **transition table**
indexed by how many of its 6 consonant neighbours are in each nonzero state. The bundled
**beehive** rule (`life/beehive.yaml`) is a 3-state example with a small gliding pattern.

Such a file uses `states`, `transition`, and `order` instead of `rule`:

```yaml
states: 3            # number of states (0 = empty, then 1..states-1)
order: "21"          # table index order: "21" = transition[count2][count1], "12" = the reverse
transition:          # a ragged matrix; entry = the cell's next state
  - [0, 1, 2, 1, 2, 0, 0]
  - [0, 2, 2, 2, 1, 1]
  - [0, 0, 2, 2, 0]
  - [0, 2, 2, 0]
  - [0, 0, 2]
  - [2, 0]
  - [0]
sounds:              # OPTIONAL per-state sound specs; each cell still sounds its own getMidi(p,q)
  - { state: 1, velocity: 95, duration: 0.35 }   # head: bright and short
  - { state: 2, velocity: 55, duration: 0.7 }    # tail: softer and longer
initial:
  cells:             # [p, q, state] — the third entry is the seed state (defaults to 1 if omitted)
    - [1, 1, 2]
    - [0, 2, 1]
```

**The pitch invariant still holds**: a multi-state cell always sounds `getMidi(p, q)` for its own
`(p,q)`. State (head vs tail) may change **timbre, velocity, and decay** via `sounds`, but **never
the pitch** — the Tonnetz position *is* the pitch, everywhere in the app. A cell sounds whenever it
**enters** a new nonzero state (so a glider's head and tail each speak as they advance), using that
state's `sounds` entry, or the file-wide `sound` if none is given.

Sources for `order` sometimes disagree on the index convention, so `order` selects it explicitly;
the bundled beehive file's `"21"` was verified by simulating its published glider (see
`tests/desktop.spec.js`).

## Where automata load from

Two sources (no hard-coded built-in tier — the web folder supersedes it):

- an **online** `life/` directory bundled in the repo, fetched relatively (works on any http(s)
  host; simply absent under `file://` or offline), and
- a **local folder** you can load from and **save** to (File System Access).

This mirrors Melody's MIDI loading (`js/midi-folder.js`) minus the built-in default. The seed
`life/` set will include the known hex variants above (3,5/2, Callahan) plus a few tuned for sound.

## Possible future extensions (not v1)

The schema is meant to grow as composing for it reveals wants. Likely additions, kept out of v1
to keep the first engine small:

- **Generation-aware sound** — `sound.when` conditions on the generation clock or on a cell's
  *age* (how many generations it has been alive), not only the born/alive/died transitions.
- **Tonal qualities** — a sustain-pedal-like hold across generations, note release behavior,
  envelopes.
- **Instruments** — per-file (or per-condition) MIDI instrument / channel selection.

These are noted so the v1 schema stays forward-compatible (unknown keys should be ignored, not
rejected).

## Sources

- Katherine Wu (2012), *Hex Life: Hexagonal Cellular Automata*, Wolfram Demonstrations Project.
- *The Hexagonal Game of Life* — bluemountain.bearblog.dev.
- Wolfram, hexagonal CA notes (content.wolfram.com … 15-3-4.pdf).
- *Complex dynamics in a hexagonal cellular automaton* (ResearchGate 224255458).
- Golly — golly.sourceforge.io.
- Adamatzky, Wuensche & De Lacy Costello (2006), *Glider-based computing in reaction-diffusion
  hexagonal cellular automata*, Chaos, Solitons & Fractals 27, 287–295 — the 3-state "beehive"
  rule and its glider (`life/beehive.yaml`), cross-referenced with Wuensche's DDLab work.
