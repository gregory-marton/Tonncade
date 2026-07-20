# Core Invariants

This document catalogs Tonncade's cross-cutting invariants — properties that must hold
regardless of mode, viewport, or orientation. Each is backed by a test. Together with those
tests, this doc is the source of truth for what "correct" means at this level; per-feature
behavior lives in `tests/mobile.spec.js` and `tests/desktop.spec.js` instead.

**Protection policy:** don't weaken, skip, or delete an invariant test to make an unrelated
change land. If a change genuinely requires redefining an invariant, update this document
first — with the reasoning — then update the corresponding test to match, in the same commit.
A test going red here is a signal to fix the product, not the test. `tests/invariants.spec.js`
carries a copy of this policy in its header comment for the same reason.

---

### INV-1: Every mode is reachable from every screen, in every orientation

You can always navigate from any mode to any other mode (Sandbox, Melody, Snake, Blast,
Gravity), regardless of current viewport size or orientation. On mobile/tablet widths the mode
list lives inside the collapsible `#top-drawer` (open it first); on desktop it's always
visible. Either way, the path to switching modes must never be blocked.

Selecting a mode collapses the drawer afterward (same as picking a piece from the Sandbox
chord guide) — it doesn't stay open across multiple selections, so switching modes twice in a
row on mobile means reopening the drawer each time.

**Test:** `tests/invariants.spec.js` — "INV-1: every mode is reachable from every other mode,
in portrait and landscape"

### INV-2: Anything you can summon, you can dismiss

Any interactive element or state the player can open/invoke must have a way to close/undo it:
the mobile drawer opens and closes, the chord guide populates and clears, a candidate piece
can be picked up and put back down without being forced to place it.

**Tests:** `tests/invariants.spec.js` — the three "INV-2: ..." tests (drawer, chord guide,
candidate piece)

### INV-3: No dead click targets

The converse of INV-2: nothing that JS explicitly relocates into an "always visible" area is
ever left unreachable because it (or something JS forgot to move alongside it) ends up behind
a hidden ancestor. This is exactly the bug class `#chord-guide-reset` had — the `<select>` and
results got moved into `#mobile-always-visible`, but the reset button was left behind inside
`#sandbox-guide`, which then got hidden, orphaning it.

**Test:** `tests/invariants.spec.js` — "INV-3: nothing moved into the always-visible mobile
area is left unreachable by a hidden ancestor"

### INV-4: Audio comes from exactly the notes it claims to

Every sound the app plays corresponds exactly to the Tonnetz note(s) of the cell(s) actually
responsible for it — tapping an empty cell plays that cell's note, picking up a placed piece
plays a chord of precisely that piece's own cells, nothing more or less. This also means every
hex within a piece is an equally valid pickup handle: which specific cell you tap must never
change where the picked-up ghost lands — it's always the piece's true position, not wherever
`hoverCell` happened to be. `getAbsoluteCells`/`rotate` treat every cell in a piece uniformly by
construction (each piece's `cells` array happens to include a literal `(0,0)` entry, which is
the only cell with any special status at all, purely as a coordinate-system convenience — not a
privileged cell in any collision, rendering, or audio logic, all of which iterate every cell of
a piece equally). The one place this was actually violated was pickup: `hoverCell` wasn't reset
to the picked-up piece's own anchor before re-rendering its ghost, so tapping a non-anchor cell
of a multi-cell piece could leave the ghost wherever `hoverCell` last was — fixed in
`SandboxMode.handleAction`/`pickupPieceAt`.

**Tests:** `tests/invariants.spec.js` — the three "INV-4: ..." tests

### INV-5: Audio and visuals stay in sync

When a cell sounds, that exact cell shows visible feedback (the `active-note` class) — not a
neighboring cell, not all of them.

**Test:** `tests/invariants.spec.js` — "INV-5: tapping a cell in Melody mode both sounds its
note AND visibly highlights that exact cell"

### INV-6: Tonnetz translational isomorphism

The lattice is a true Tonnetz: translating by one step along any axis shifts the resulting
MIDI pitch by the same fixed interval everywhere on the lattice, for both the Standard tuning
(p: +7 semitones, q: +3, resultant: -4) and the Gravity tuning (p: -3, q: +4, resultant: +7).

**Test:** `tests/run_tests.js` — "Tonnetz isomorphism tests" (pure logic, no DOM — lives in the
Node unit-test runner rather than Playwright)

### INV-7: Piece geometry validity

Every piece, at every one of its 6 rotations, is a single connected set of cells (no floating
sub-parts), has no overlapping/duplicate cells, and is closed under a full rotation cycle (six
60° rotations return the piece to its original shape).

**Test:** `tests/run_tests.js` — "Piece geometry validity (invariants.md) tests"

### INV-8: Controls maintain edge clearance

Interactive mobile controls never sit flush against the screen edge — real device chrome (iOS
Safari's toolbars, notches, gesture bars) can obscure real estate a flat 0px/10px offset would
assume is clear. (The much larger bottom-edge floor needed for iOS Safari's toolbar has its
own dedicated, more specific test in `tests/mobile.spec.js`.)

**Test:** `tests/invariants.spec.js` — "INV-8: no mobile control button sits within 10px of
the viewport edge"

### INV-9: Game state survives orientation change

Rotating the device mid-game (switching between portrait and landscape) never resets or
corrupts in-progress state — score, placed pieces, snake body, etc. A lot of layout
reshuffling happens on resize (drawer restructuring, board refitting); none of it should touch
game state.

**Tests:** `tests/invariants.spec.js` — the two "INV-9: ..." tests (Snake, Blast)

### INV-10: On a restricted Tonnetz, nothing overlaps it

Snake, Blast, and Gravity each show a *restricted* Tonnetz — a fixed board, not freely
pannable — and no other element (stats/controls panel, D-pad, Blast's next-piece queue) may
ever overlap it. Enforced by giving `#tonnetz-svg` itself a CSS box inset by exactly the space
those overlays need, per mode and orientation, rather than letting the overlays float on top
of a full-bleed board: the browser's own default `preserveAspectRatio="xMidYMid meet"`
guarantees the fitted board never renders outside that smaller box.

**Test:** `tests/invariants.spec.js` — "INV-10: on a restricted Tonnetz (Snake/Blast/Gravity),
no overlay overlaps the board"

### INV-11: At least 20 distinct Tonnetz cells are visible and controllable

In every mode, at every supported viewport/orientation, at least 20 distinct cells are both
on-screen and reachable (not covered by an overlay) — a floor on how much of the instrument is
actually usable at once, regardless of how tightly the rest of the layout is squeezed.

**Test:** `tests/invariants.spec.js` — "INV-11: at least 20 distinct Tonnetz cells are visible
and controllable, in every mode/orientation"

### INV-12: On an unrestricted Tonnetz, pan/zoom persists

Sandbox and Melody allow free pan/zoom. Once the player sets a pan/zoom, using some other
control (selecting a carousel piece, opening the chord guide, etc.) must not reset it back to
a default.

**Test:** `tests/invariants.spec.js` — "INV-12: panning Sandbox's Tonnetz is preserved across
an unrelated control interaction"

### INV-13: Primary elements are reachable in every orientation

Every primary element listed in the "Primary Elements" table above must be reachable (present,
non-zero size, not hidden behind a collapsed drawer once opened) in both portrait and
landscape — not just whichever orientation someone happened to test by hand. The one documented
exception is Gravity's duplicate down-button (`#m-btn-action-2`), which only exists as a
distinct primary element in landscape (5 D-pad buttons in portrait, 6 in landscape); the test
checks that one specifically, in both directions, instead of just excluding it.

**Test:** `tests/invariants.spec.js` — "INV-13: every mode's primary elements are reachable in
both portrait and landscape"

### INV-14: Every ghost motion sounds its own cells

Placing, picking up, moving, and turning a candidate piece (Sandbox or Blast) must always play
the Tonnetz notes it currently corresponds to — not just when it's explicitly rotated. This
covers drag, keyboard navigation, keyboard rotation, two-finger twist, and the initial ghost
that appears the moment a piece is selected. `SandboxMode.updateGhost()` and
`BlastMode.updateGhost()` are the single place this happens (deduped by piece/p/q/rotation so
redundant redraws at the same position don't replay the chord) — callers should never bolt on
their own separate `Synth.playChord` call for a ghost-position change, since that's exactly the
gap that let ghost movement go silent while only rotation (which happened to have its own
explicit call at a couple of sites) made sound.

**Tests:** `tests/invariants.spec.js` — the four "INV-14: ..." tests (initial selection, move
dedup, keyboard rotation, Blast parity)

### INV-15: Carousel piece-preview icons never change

The small piece-preview icons in the carousel (and the chord-guide results list) are static
reference art — `SandboxMode.renderPiecePreview` renders them once and nothing about
selecting, rotating, dragging, placing, or picking up a piece should ever redraw or mutate one.
Real-device report: the place-wedge's tap sometimes visibly changed one of a carousel icon's
cells. Root cause was the wedge's unreliable click-synthesis-after-touch racing against the
carousel container's own touch listeners (see INV-14's history and the fix in
`SandboxMode.renderPalette`'s wedge touch handling) — not the icons themselves being redrawn,
but worth guarding directly against regardless, since the icons genuinely must never move.

**Test:** `tests/mobile.spec.js` — "carousel piece-preview icons never change with any input"

### INV-21: A restricted-Tonnetz board fills a real share of its available height

On a fixed, non-pannable board (Snake/Blast/Gravity), the rendered board content must fill a
meaningful fraction of the vertical space actually reserved for it — not just be *visible*
(that's INV-11) but be rendered at a *size* worth looking at. Real-device report (GitHub issue
#6): Gravity's board rendered at ~29% of the mobile viewport's height, with large dead margins
above and below, despite every cell technically being on screen and unobscured.

Two distinct, compounding bugs caused this, both in how `#tonnetz-svg` gets sized/fitted on
mobile — worth understanding together since fixing only one has no visible effect on its own:

1. **The CSS box itself was undersized.** `<svg>` is a "replaced element" with an intrinsic
   aspect ratio (from its `viewBox`). When `top`/`right`/`bottom`/`left` are all given a
   definite CSS value and `width`/`height` are both `auto`, browsers resolve ONE dimension from
   the insets and derive the OTHER from the intrinsic ratio instead of stretching to fill its
   own insets — silently ignoring whichever inset that leaves out. Fixed by giving both `width`
   and `height` an explicit `calc()` (never `auto`) in the mobile media queries (`css/style.css`).
2. **The reference viewBox didn't match the container's shape.** `Render.getFitView`/
   `updateView` always fit content into a fixed 800x600 (4:3) reference frame, regardless of the
   actual on-screen aspect ratio of `#tonnetz-svg`. Once (1) is fixed and the SVG's DOM box
   correctly becomes tall and narrow on a phone, a fixed 4:3-shaped *reference viewBox* still
   gets letterboxed inside that box by the browser's default `preserveAspectRatio`, moving the
   wasted space from outside the SVG to inside it — invisible from outside, but just as wasteful.
   Fixed by `Render.getAspectMatchedRefBox()`, which Gravity's `refreshBoard()` uses to fit
   against the SVG's actual current aspect ratio instead of the fixed default. Blast shared the
   same underlying issue and was migrated the same way in task #48; every other caller of
   `getFitView`/`updateView` still omits this and keeps the historical 800x600 behavior
   unchanged.

Mobile CSS layout can also report a transient, too-small size for a `100dvh`-based container
before Chromium finishes resolving it — `GravityMode.init()` sets up a `ResizeObserver` on
`#tonnetz-svg` so a fit computed against that transient size gets self-corrected once the
element's real size settles, rather than sticking around until the next unrelated game event.

**Test:** `tests/invariants.spec.js` — "INV-21: Gravity's board fills a real share of its
available height, in portrait and landscape"

### INV-22: Every piece size has complete polyhex coverage

For every cell-count the game defines a piece size for (1-cell, 2-cell, 3-cell, 4-cell, and any
future size), the registered pieces of that size must be exactly the full set of distinct
"one-sided" polyhexes of that size — every connected hex shape achievable with that many cells,
counted as distinct under rotation only (never reflection, since no piece here ever flips). No
duplicates (two pieces that are secretly the same reachable shape) and no gaps (a valid shape
with no piece for it).

Real bug (GitHub issue #3): the two 3-cell "bendy" pieces `<` and `>` were coded as
byte-identical cell arrays — a plain duplicate, not two genuinely different shapes. The
tempting fix ("make them a real chiral pair") doesn't work: a plain 2-arm hex bend is always
self-mirroring under a rotation-only piece system — rotating it by some multiple of 60° reaches
its own mirror image, verified directly for both the 60° bend (`V`) and the 120° bend (`>`). So
there is no second, genuinely distinct 120°-bend shape to give `<` — the correct fix was
removing the duplicate outright (`<` no longer exists).

The test enumerates the *entire* shape space per size (starting from the single-cell shape and
growing by every way to attach one more cell, deduplicating by canonical rotation at each step)
rather than just checking the one known duplicate pairwise — so it catches gaps as well as
duplicates, and needs no changes if a future size (5-cell pentahexes, say) is ever added: it
reads which sizes exist directly from `Pieces.TYPES`. Current counts: 1-cell → 1 shape, 2-cell →
1, 3-cell → 3, 4-cell → 10 — all fully covered.

**Test:** `tests/run_tests.js` — "complete-polyhex-coverage test"

### INV-23: Live MIDI hardware input plays and highlights exactly like the equivalent tap

In any mode with a "play a free note" concept (Sandbox, Melody), a note-on message from a
connected MIDI controller (`js/midi-input.js`, `MidiInput.handleNoteOn`) must produce the same
audible/visible result as tapping the corresponding cell would: `Synth.playNote` with the same
MIDI number, and every currently-rendered cell sharing that pitch flashed via
`Render.highlightByMidi` (a Tonnetz places the same pitch at multiple lattice positions by
design — see INV-4/INV-5 for the tap-driven version of this same idea). In Melody mode, the note
must also reach the practice game's own logic (`MidiMode.handleUserInputNote`), so playing the
physical keyboard advances a song exactly like tapping the matching cells would.

This works for any class-compliant MIDI device, not specifically the isomorphic ("Tonnetz
hardware") controller it was built and tested against (a C-Thru Music AXiS-49) — messages are
matched purely by MIDI note number, never by the sending device's own physical key layout, so a
standard piano-style keyboard plugged in instead behaves identically. Connection is opt-in via
a click on `#midi-connect-btn`, not attempted automatically on page load: `requestMIDIAccess()`
triggers a native browser permission prompt with no user-gesture requirement, so requesting it
unconditionally at startup would prompt every visitor, including the many with no MIDI device.

**Test:** `tests/invariants.spec.js` — "INV-23: live MIDI hardware note-on plays and highlights
the same note as a Sandbox tap" and "INV-23: live MIDI hardware note-on advances Melody mode's
practice sequence like a tap" (both drive a mocked `navigator.requestMIDIAccess`, since no real
MIDI hardware is available in CI).

### INV-24: Rotating the Tonnetz view keeps everything else about the board correct

The player can rotate the whole rendered lattice (`#rotate-view-btn`, `js/render.js`'s
`Render.rotationDeg`/`setRotation`) in 30°-steps — motivated live by a real AXiS-49 MIDI
keyboard being physically oriented differently than the on-screen Tonnetz expected, and by
Snake/Blast's narrower aspect ratios sometimes fitting better with the lattice's flats aligned
to the screen edges instead of its points. 30° (not 60°) is deliberate: a hexagon's own 60°
self-symmetry means EVERY rotation angle renders a perfectly normal, uniformly-rotated field of
hexagons — there's no "wrong" angle the way there would be for a shape without 6-fold symmetry
— so 30° steps cleanly reach both the pointy-top family (0/60/120°...) and the flat-top family
(30/90/150°...), including exact quarter turns to match portrait/landscape or a physical
device's own orientation.

This is a purely visual transform on `#lattice-group`, entirely decoupled from the underlying
axial (p, q) coordinate system every mode's game logic runs on — nothing about placement,
collision, or note mapping changes. Everything rendered must rotate together, not just the base
lattice: placed pieces, ghosts, the Snake body/gem, and Melody's QWERTY labels are all routed
through `Render.appendToLattice()` (appending into `#lattice-group` itself) rather than
appending directly onto `<svg>`, specifically so they inherit the group's rotation instead of
staying visually fixed while the grid turns under them. Note-name/QWERTY labels counter-rotate
individually (`Render.applyLabelCounterRotation`) so they stay upright and legible at any angle,
matching the original vision in task #28. `Render.getFitView`/`getPanBounds` compute their
bounding boxes from `Render.getRotatedScreenPos`, not the raw unrotated position, so fitting and
pan-clamping stay correct (nothing clipped) at any rotation.

Gravity is the one exception: its falling mechanic is defined entirely in axial space ("down"
is a fixed direction there, independent of rendering), so rotating gravity's on-screen render
without also rotating its game logic would make pieces visibly fall sideways while the code
still calls that direction "down." `Render.getEffectiveRotation()` always returns 0 in Gravity
regardless of the player's stored preference, and the rotate button hides itself there rather
than silently doing nothing.

**Test:** `tests/invariants.spec.js` — the six "INV-24: ..." tests (transform value per click,
30° wraparound + localStorage persistence across reload, no cell becomes clipped/unobscured
after rotating, a placed piece visibly moves with the lattice rather than staying fixed, a
label's on-screen aspect ratio stays constant across rotation, and Gravity's immunity).

---

## Primary Elements

A **primary element** is a top-level interactive affordance a player can point to and name —
"the D-pad's up-left arrow," "the carousel," "the drawer pull" — as opposed to a sub-item
*within* one (an individual carousel piece, a single chord-guide search result). Two design
rules follow from the distinction:

- The primary element must always be present and reachable (this is what INV-1/2/3 actually
  protect). The *number* of sub-items inside it can vary freely with viewport/content (a
  carousel shows more or fewer pieces at once; Gravity's D-pad gains a duplicate down-button
  in landscape) — that variation is expected, not a violation of anything.
- A primary element shouldn't degrade to a single, barely-usable sub-affordance — as a rough
  design guideline (not a hard test), a primary element with internal sub-items should keep at
  least ~2 of them meaningfully available.

Per-mode inventory (each item below is one primary element; items *within* one, like carousel
pieces or chord-guide results, are not listed separately):

| Mode | Primary elements |
|---|---|
| Gravity | Tonnetz, each of the 5 (portrait) / 6 (landscape) D-pad buttons individually, the next-piece preview, Pause, Restart, Stats, Drawer pull |
| Blast | Tonnetz, the preview/place control, Stats, Drawer pull |
| Snake | Tonnetz, each of the 6 D-pad arrows individually, Pause, Restart, Stats, Drawer pull |
| Melody | Tonnetz, Drawer pull, Play, Restart, Stats, Sequence message |
| Sandbox | Tonnetz, Drawer pull, Carousel, Chord picker |

This inventory is the reference list INV-13 (below) checks against, and the vocabulary the
rest of this doc and its tests should stay consistent with.
