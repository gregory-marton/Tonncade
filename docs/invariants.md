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

### INV-9 & INV-12 (unified): every mode's state survives resize, view rotation, and panning

Originally two separate checks, each hand-written for exactly two modes (INV-9: Snake, Blast;
INV-12: Sandbox, Melody) — generalized into one matrix over every mode, since a hand-picked pair
per invariant is exactly the pattern that let Compose's touch-multi-select gap ship unnoticed:
nothing forced a NEW mode to inherit either check. Now: adding a mode means adding one entry to
`RESTRICTED_BOARD_CELLS`/`snapshotModeState` in the test, not writing a new test.

For every mode: game state (score, placed pieces, snake body, notes, etc. — whatever that mode's
`snapshotModeState` reads) must survive a resize, a view rotation (skipped for Gravity, INV-24's
own documented exception), and — for unrestricted modes — an actual pan.

The two kinds of mode need genuinely different view-position checks, not the same one applied
uniformly, and this is derived from ONE partition, not two independently hand-picked lists:

- **Unrestricted/free-pan modes** (Sandbox, Melody, Compose — everything NOT in
  `RESTRICTED_BOARD_CELLS`): the exact pan/zoom position must survive resize and rotation
  unchanged, and must also survive an actual pan gesture (only the game state is re-checked
  after panning, not the position — panning is *supposed* to move the view, that's the point).
- **Restricted/bounded-board modes** (Blast, Gravity, Snake): manual pan is deliberately NOT
  expected to persist. `BlastMode.refreshBoard()` (and, after this fix, `SnakeMode.refreshBoard()`
  and `GravityMode`'s own equivalent) always recompute a fresh aspect-matched fit on every
  redraw — confirmed as the intended design, not a bug: a restricted board should always show as
  much of itself as the screen allows, the same way it does at mode entry. So the right
  post-resize/post-rotation check for these is "still correctly centered", not "identical to
  before" — reusing the exact centering math `tests/mobile.spec.js`'s own centering tests use.

**Two real bugs found building this generalized version, not hypothetical ones**: (1) Snake had
no `ResizeObserver` at all (unlike Gravity/Blast), so its view never adapted to a later resize —
added, matching the Gravity/Blast pattern exactly, cleaned up in `cleanup()` per INV-30. (2)
`SnakeMode.refreshBoard()` used a hardcoded `Render.updateView(-440, -330, 1.1)` — never
upgraded to the aspect-matched fit Gravity (#44) and Blast (#48) both received — now uses
`Render.getFitView` against its own radius-7 board the same way, with a slightly larger scale
margin (1.15 vs Blast's 1.25) since its bigger board otherwise clipped 2 of 169 cells at a
narrow tablet portrait width.

Two subtleties the test itself had to account for, not the product: `Render.rotationDeg` is a
single global persisted across mode switches, so each mode's own check resets it to 0 first —
otherwise one mode's rotate step changes the pan-bounds clamping baseline for the next mode's
check, indistinguishable from a real bug. And Snake/Gravity both auto-advance on a real-time
timer, unrelated to what's being tested but real enough to move the snake/piece during a
resize/rotate step's own async work (opening the drawer, clicking a button) — both are paused
for the duration of their own check.

Melody's own pan capability has its own history worth keeping: `Render.getPanBounds()` listed
`'midi'` among the free-pan modes well before anything actually wired up input to move Melody's
view — no mouse-drag, no two-finger touch drag, and `refreshBoard()` always reset to a hardcoded
`(-400, -300)`. Real report: rotating the view (INV-24) could move a melody's notes off-screen
with no way back. Fixed by mirroring Sandbox's exact mouse-drag pattern and extending the shared
two-finger touch-pan gesture to Melody. A related bug surfaced while fixing it: the mouse-drag
handler's pan logic was gated behind the same flag that skips ghost-hover updates during
playback, which a wrong-note click also sets for ~1.2s — leaving a player unable to drag the
view for over a second after almost any accidental wrong-note click. Panning is camera movement,
unrelated to note-input validity, so it now runs unconditionally.

**Test:** `tests/invariants.spec.js` — "INV-9/INV-12: every mode's state survives resize, view
rotation, and (where pannable) panning"; `tests/desktop.spec.js` — "Melody mode: dragging the
mouse pans the Tonnetz..." and "...a pan survives refreshBoard()..."; `tests/mobile.spec.js` —
"Melody mode: a real two-finger drag pans the Tonnetz".

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

### INV-25: A melody note's octave is part of its identity, and the UI must say so

Melody mode's matching (`MidiMode.handleUserInputNote`) compares exact MIDI pitch, not just
note NAME — two different-octave "E"s are genuinely different notes to it, and that's the
correct rule: a melody's octave is part of the tune, not an incidental detail a player should be
free to substitute. Real report: a player found it possible to play "the wrong E" against a real
MIDI keyboard, which is an understandable mix-up, not a matching-logic bug — a big board (or a
keyboard with several octaves of physical keys) puts more than one cell with the exact same
bare note-name letter within easy reach, and the letter alone doesn't say which one is meant.

Fixed at the legibility layer rather than by relaxing the match: `MidiMode.updateDifficultyUI`'s
current-target readout (`#midi-note-list`) now shows an octave-qualified name (e.g. "E4", not
just "E") for every displayed note, and the current target specifically also shows its exact
frequency (e.g. "E4 (330Hz)") via the new `Tonnetz.getFrequency(midi)` (standard, unclamped
MIDI-to-Hz — deliberately not the same value `Synth.playNote` actually plays back for an extreme
note outside piano range, since that gets octave-wrapped for audibility first; see that
function's own comment). `js/synth.js` was refactored to call the same shared function for its
own (clamped-input) frequency, rather than keeping a second copy of the formula.

**Test:** `tests/invariants.spec.js` — "INV-25: Melody mode rejects a different-octave note with
the same name, and accepts the exact pitch" and "INV-25: Melody's current-target readout shows
an octave-qualified note name and its exact frequency"; `tests/run_tests.js` — "Tonnetz.
getFrequency tests" (pure MIDI-to-Hz correctness, independent of any UI).

---

### INV-26: Melody's drilled segment can be replayed from any note already reached, not just note 0

The "Simon says" drill (`MidiMode.playTargetSequence`) always used to replay the whole growing
segment starting at note 0, and a wrong note always reset practice back to note 0 too — fine for
a short song, but a real scaling problem for a long one (task #46): every extension re-listens to
an ever-longer prefix before the player gets to attempt the new note, and a single mistake near
the end throws away the whole segment's progress.

`MidiMode.state.startIndex` now tracks where the drilled segment begins, clamped to
`[0, targetLength - 1]` — never past the notes already reached. `MidiMode.seekTo(index)` clears
any pending mistake/going-ahead timers, sets `startIndex`, and calls `playTargetSequence()`,
which now schedules relative to `melody[startIndex].time` instead of always `melody[0].time`. A
wrong note resets `userIndex` back to `startIndex` (not always 0), so scrubbing to relisten to an
earlier stretch also becomes the new starting point for mistake-recovery within that practice
pass. Scrubbing forward (within the already-reached range) lets a player skip replaying notes
they've already mastered; scrubbing back replays an earlier stretch they want to relisten to.
`seekTo` is a no-op while a full-melody preview (`isPlayingPreview`) is playing, since that's a
different, position-independent playback path.

**UI, v2**: the original control was a plain HTML `<input type=range>` slider next to the note
list. The user's own feedback: it read as an abstract, disconnected control — dragging it gave no
sense of *which two notes* you were about to start between. Replaced with a small draggable
marker (`▾`, `.scrub-marker`) rendered *inline, inside* `#midi-note-list` itself, in the gap
right before whichever note it targets — so the note list literally reads "...D4 ▾ C4..." when
the marker sits between D4 and C4. `MidiMode.positionScrubMarker(targetIdx)` places it (and
plain `.note-sep` separator spans everywhere else) by walking the currently-rendered
`.note-token` elements; it only shows at all if its target note is within the currently-visible
window (nothing to drag to if it's off-screen — an accepted scope limit, not a bug) and there's
more than one note reached yet.

Dragging is `mousedown`/`touchstart` on `.scrub-marker` → `mousemove`/`touchmove` calls
`updateScrubDragTarget`, which finds whichever rendered note token's center is closest to the
pointer and repositions the marker there live (`state.scrubDragIndex`, not yet committed) →
`mouseup`/`touchend` commits via `seekTo`. Critically, live repositioning during the drag reuses
the *same* marker DOM node every time (moving it, never recreating it) instead of going through a
full `updateDifficultyUI()` re-render on every move — found necessary via a real
touchstart/touchmove/touchend test (not a synthetic `.click()`, per this project's standing
touch-testing discipline): a full re-render replaces the marker's own element via `innerHTML`,
which detaches whatever the original `touchstart` captured as its event target, silently breaking
the rest of the gesture on a real device. Separator spans are cheap to recreate each call, since
nothing ever captures touch/mouse on them.

**Test:** `tests/desktop.spec.js` — "Melody mode: ... scrub marker/control ..." / "a wrong note
resets progress back to the scrub position" tests (visibility, correct gap placement, clamping,
real mouse-drag back/forward, mistake-branch reset landing on `startIndex`).
`tests/mobile.spec.js` — "a real single-finger touch drag moves the scrub marker to the touched
note", using genuine dispatched `Touch`/`TouchEvent` objects (this is the test that caught the
detached-touch-target bug above — a mouse-only test wouldn't have).

---

### INV-27: A documented input-method promise (e.g. "Shift-G / Click: Place/Pick up") must stay true for every method it names

Sandbox's desktop-only instructional text (`#placement-controls`, next to the board) reads
"Shift-G / Click: Place/Pick up," explicitly promising a plain mouse click does the same thing
as Shift-G. Issue #8: it didn't. #40's place-wedge redesign deliberately stopped a plain TOUCH
tap from placing a NEW piece (fixing a real gesture-timing bug — rapid rotate-taps misfiring as
double-tap placements), but the fix's gate in `SandboxMode`'s `svg.onmousedown` —
`if (isExistingPiece || !this.state.selectedPiece) { this.handleAction(p, q); }` — applied to
every input equally, including desktop mouse clicks, which have none of that touch-timing
ambiguity. A plain click on an empty cell with a piece selected silently did nothing (pan-drag
tracking still started, which is what made it look like "it starts dragging instead"), while
Shift-G (which calls `handleAction` unconditionally) kept working. Nothing caught this because
every existing Sandbox placement test either called `SandboxMode.placePiece()`/`canPlace()`
directly — bypassing the input layer entirely — or drove the TOUCH gesture path
(`tests/mobile.spec.js`'s wedge/swipe-down tests, a different code path in `js/main.js`'s own
`touchstart`/`touchend` handlers). Zero tests exercised a real desktop mouse click into
Sandbox's placement logic at all, despite the UI's own text making it a documented promise.

Fixed by widening the gate to `isExistingPiece || !this.state.selectedPiece || !isTouch` — a
plain click still can't place on touch (preserving the #40 fix), but a desktop mouse click now
always reaches `handleAction`, restoring "Click" and "Shift-G" to genuinely identical behavior.

**Test:** `tests/desktop.spec.js` — "INV-27: Sandbox (desktop) -- clicking an empty cell
places the selected piece, as \"Shift-G / Click: Place/Pick up\" promises" and "INV-27: Sandbox
(desktop) -- clicking a cell with an existing piece still picks it up, unambiguous from
placing." Documented as an invariant — since the underlying failure mode (a documented
behavioral promise drifting out of sync with a future redesign of this same area) is exactly the
class of regression the invariants system exists to catch on an ongoing basis, not just this one
time — but the tests themselves live in `desktop.spec.js`, not `invariants.spec.js`: this
invariant is inherently desktop-mouse-only, and `playwright.config.js`'s `testMatch` only runs
`invariants.spec.js` against the touch-enabled Mobile/Tablet Chrome projects, never Desktop
Chrome (INV-26 sets the same precedent already).

---

### INV-28: Compose mode's Save round-trips exactly what was recorded or loaded

Compose mode (`js/compose.js`) is v1 of the rest of task #27 ("edit any melody, record a new
song"), built as its own separate mode rather than bolted onto Melody's practice loop — drag/
rotate-to-transpose is a composition interaction, not a natural extension of a structured drill,
so it belongs here instead. v1 scope is deliberately narrow: record by tapping cells in real
time, play back, Undo (removes the most recently added note) and Clear are the only editing
primitives, and Save/Load round-trip through Standard MIDI Files. Per-note drag-to-reposition/
retime, a timeline/piano-roll view, multi-select, inserting a note into the middle of an existing
sequence, and polyphony are all real interaction-design work saved for later, not silently
expanded into v1.

Two new, genuinely shared pieces make Save possible, both usable by Melody too whenever it grows
its own save flow later:
- `MidiMode.writeMIDI(melodySeq)` — a Standard MIDI File writer (single-track format-0), the
  inverse of the existing `parseMIDI`/`tickToSec` logic. Deliberately emits no tempo meta event,
  since `tickToSec` already defaults to 500000 usec/beat (120bpm) with none present — this keeps
  `parseMIDI(writeMIDI(x))` an exact round trip at the fixed 480-ticks-per-beat resolution
  `writeMIDI` uses, rather than merely an equivalent-sounding one.
- `MidiFolder.saveFileAs(name, arrayBuffer)` — writes into whichever folder is currently
  remembered (`this.folderHandle`, shared with Melody's own folder browsing — Compose and Melody
  both work with `.mid` files, so there's no reason for the separate directory Life mode's YAML
  files will need), falling back to a plain `<a download>` blob link when no folder is set.

A tapped cell's `(p,q)` needs no reverse-mapping — the player chose it directly. Loading an
existing file is different: `Tonnetz.getMidi(p,q)` isn't injective (any pitch sits at infinitely
many `(p,q)`, differing by multiples of `(3,-7)`, since `7*3 + 3*-7 = 0`), so a loaded melody
(which only has `midi`/`time`/`duration`) needs a specific cell assigned to each note before it
can be shown on the lattice. `Tonnetz.nearestCoordFor(midi, near)` finds the solution closest
(by hex distance) to a reference point; Compose uses it to lay a melody out as one coherent,
connected path — note 0 nearest the origin, each note after it nearest the previous note's own
chosen cell — rather than a valid but visually arbitrary/disconnected scatter.

`MidiFolder.setup` now takes an optional `ids` config (defaulting to Melody's original element
ids, so its existing call site is unaffected) so both Melody and Compose can browse the *same*
remembered folder while each keeps its own upload/folder/select/status DOM elements.

**Test:** `tests/run_tests.js` — "Tonnetz.nearestCoordFor" (every returned coord actually
produces the requested pitch; prefers a genuinely adjacent solution over a more distant one in
the same family; keeps a short melody's path connected) and "MidiMode.writeMIDI round-trip"
(reproduces midi/time/duration through `parseMIDI` within one tick's tolerance, including the
empty-melody edge case). `tests/desktop.spec.js` — six "Compose: ..." tests covering recording,
playback ordering, Undo, Clear, a Save round-trip through a faked folder handle, and loading an
existing file into a connected on-lattice path.

---

### INV-29: The mode-slider's active-pill background exactly matches the active option's position, for however many modes there are

Found live via Compose mode's own visual QA screenshot, not written speculatively: `css/style.
css`'s `.mode-slider-active` hardcoded a width (default orientation) and height (landscape
orientation) as `20%`/`calc(20% - ...)` — "1/5", sized for exactly the 5 modes that existed
before Compose. Adding a 6th option didn't just leave the pill the wrong size; `App.setMode`'s
slide animation translates it by `idx * 100%` of *its own* box, so a mis-sized pill also lands in
the wrong place — every mode from the 3rd option onward highlighted a visibly incorrect slot.

Fixed by expressing both rules as `calc((100% - 4px) / 6)` — a plain count-based formula instead
of a magic percentage — with a comment on each naming the current option count, so the next mode
added or removed has an obvious single number to update instead of a silent trap. Also fixed
along the way, found in the same screenshot: the desktop-only "F T Y H B V: Move" / "Space / G /
Arrows: Rotate" keyboard hints (`#hex-nav-controls`) had never been scoped to a mode at all —
they showed unconditionally in every mode, including Melody/Compose/Snake/Gravity, none of which
bind those keys (only Sandbox and Blast do, the same "ftyhbv cluster" in both `js/sandbox.js` and
`js/blast.js`) — now toggled alongside the existing `#placement-controls` element, which already
had exactly the right sandbox-or-blast visibility logic to mirror.

**Test:** `tests/invariants.spec.js` — "INV-29: the mode-slider active pill exactly covers the
active mode option, for every mode, portrait and landscape" (checks pill-vs-option position, not
size — a `.mode-option`'s own horizontal padding legitimately makes its bounding box wider than
the pill's under content-box sizing, which is normal text-inset spacing, not a visual gap, since
only the pill paints a background at all). `tests/desktop.spec.js` — "The F/T/Y/H/B/V hover-move
and Space/G/Arrows rotate hints only show for Sandbox and Blast."

---

### INV-30: Leaving Gravity mode actually stops Gravity from touching the shared board again

Real report (issue #9, a ChromeOS play session): after finishing a Gravity game and switching to
another mode, the "done" Gravity board stayed on screen instead of clearing — the new mode's own
sidebar controls updated correctly, but the Tonnetz board itself reverted to Gravity's stale,
game-over state.

Root cause: `GravityMode.init()` (`js/gravity.js`) creates a `ResizeObserver` watching
`Render.svg` — the one `<svg>` element every mode shares — to re-fit the board after mobile
`100dvh` settles a tick late. Its callback calls `this.refreshBoard()`, which unconditionally
redraws Gravity's own viewport and `Board.cells`, with no check on `App.currentMode` at all. That
observer was never disconnected: `js/main.js`'s `setMode` only ever cleared
`GravityMode.state.timer` inline — every *other* mode gets a real `.cleanup()` call, Gravity
never did. So the observer kept watching forever, and the next time *anything* resized the game
area (switching to a mode with different-sized sidebar content is exactly such a layout reflow),
it fired again and repainted Gravity's stale board directly over whatever the new mode had just
drawn on that same shared element.

Fixed by giving `GravityMode` a real `cleanup()` (clears the timer *and* disconnects/nulls the
`ResizeObserver`, matching the pattern `MidiMode`/`SnakeMode`/`SandboxMode`/`ComposeMode` already
follow) and calling it from `setMode`, in place of the old inline timer-only clear.

`BlastMode` had the exact same latent bug — its own `ResizeObserver` (added for the same mobile
`100dvh`-settling reason) was never disconnected either, and `BlastMode` had no `cleanup()` at
all. Not yet reported, found while extending Blast's own MIDI routing for issue #11; fixed the
same way.

**Test:** `tests/desktop.spec.js` — "INV-30: leaving Gravity mode stops it from repainting the
board on a later resize" and "...leaving Blast mode..." — switch to the mode, confirm the
observer exists, switch away, confirm it's been nulled, then spy on `Render.drawLattice` through
a real viewport resize to confirm nothing calls it with that mode's own options afterward.

---

### INV-31: Melody's overlay controls stay a small corner HUD, not an unconstrained floating panel

Real report (issue #12, the same ChromeOS play session): at a landscape width under 950px,
Melody's MIDI-folder controls and keyboard-instructions text overlapped much of the Tonnetz,
leaving too little board to actually play on.

The `(max-width: 950px) and (orientation: landscape)` breakpoint turns
`#blast-stats`/`#gravity-controls`/`#snake-controls` into small, corner-anchored
(`top`/`left: 10px`) HUD overlays capped at `max-width: 200px`, with their own buttons shrunk to
match. `#midi-controls`'s version of that same rule never got the `top`/`left`/`max-width` triple
its siblings have — it stayed `position: absolute` but otherwise defaulted to its natural,
content-driven flow width, so it floated over the board at whatever size "Choose MIDI Folder" +
the difficulty selector + Play/Restart naturally wanted. Separately,
`#midi-keyboard-instructions` (`.desktop-only`) is hidden by the touch-pointer rule and the
`max-width: 767px` rule elsewhere, but *not* this landscape one, so on a device that matches only
this breakpoint (a laptop-class landscape width without a coarse pointer, e.g. a Chromebook) it
kept contributing bulk to the overlay too.

Fixed by giving `#midi-controls` the same `top`/`left`/`max-width` treatment (and adding it to
the shared compact-button selectors its siblings already use), and adding `.desktop-only` to this
breakpoint's hidden set, matching the other two breakpoints that already hide it.

**Test:** `tests/desktop.spec.js` — "INV-31: Melody's controls stay a small corner HUD (not a
wide overlay) at a landscape width under 950px" — asserts `#midi-controls`'s rendered width and
that `#midi-keyboard-instructions` is hidden, at exactly the width class that reproduced the
report.

---

### INV-32: Live MIDI hardware input drives Gravity/Snake/Blast too, per issue #11's own spec

`js/midi-input.js`'s `MidiInput.handleNoteOn` previously only routed to Sandbox and Melody
(INV-23) — "other modes have no 'play a free note' concept" was true at the time, but the user
asked for real per-mode mappings instead, fully specified in the issue itself. Regular keyboard/
touch controls are untouched everywhere below; MIDI is purely an additional input.

**Gravity**: middle C/D/E/F/G (MIDI 60/62/64/65/67) drive the same 5 actions as the portrait
D-pad, left-to-right matching the notes' own ascending order — C=left, D=CCW, E=soft-drop,
F=CW, G=right. The keyboard handler's inline move/rotate logic was refactored into named methods
(`moveLeft`/`moveRight`/`softDrop`/`rotateCW`/`rotateCCW`) so `handleMidiNote` and the keyboard
handler share the exact same placement-check-then-mutate-then-sound-then-refresh logic instead
of duplicating it.

**Snake**: "totally turn towards whatever note is played, as best you can interpret towards" — of
the snake's 6 immediate neighbor cells (the only 6 directions it can turn), `handleMidiNote`
turns toward whichever one's own pitch is closest to the played note. Most played notes aren't
exactly reachable in one hex step at all (a step only ever changes pitch by a fifth/third), so
"closest" is the right reading of "as best you can interpret", not an exact-match requirement.
This also means repeatedly playing a gem's own note reliably steers straight at it — an
intentional, accepted shortcut per the report, not a bug to guard against.

**Blast**: "use chords to place: whichever notes are played in the chord, show them and find a
location and orientation that fit. If there is more than one, cycle through the possible ones on
each play of the chord. If there are none, just highlight the notes without moving the
candidate." `MidiInput` buffers near-simultaneous note-ons into one chord (a 50ms window — real
key-presses never land in the same JS tick) before calling `BlastMode.handleMidiChord`, which
delegates the actual search to `findChordPlacements`: for each of the active piece's 6
rotations, checks whether the piece's relative pitches reproduce the played chord as a set (up
to a constant shift), then — since a piece can slide along the `(Δp,Δq)=(3,-7)` lattice
direction and keep every cell's pitch unchanged (`Tonnetz.allCoordsFor`, see INV about
`nearestCoordFor`) — enumerates every on-board anchor position along that family via
`Board.checkPlacement`. More than one valid placement is common, not an edge case: that's what
repeated plays of the same chord cycle through (`state.lastChordKey`/`chordCandidateIndex`), and
it's why the report specifically called out cycling as expected behavior. Committing the
placement still goes through however it always has (click the queue item, swipe down, or the
mobile action button) — the open question in the report ("how to indicate 'place' on the MIDI
device itself") is sidestepped by not needing a new gesture there at all.

**Follow-up**: this originally shipped as three separately hand-written `tests/invariants.spec.js`
tests, each with its own copy of the connect-device/switch-mode boilerplate — flagged as a gap
on the GitHub issue itself (a 4th mode gaining MIDI support wouldn't have automatically inherited
coverage). Generalized into one `MIDI_ROUTING_CHECKS` config plus a single loop: each mode's own
routing logic is still genuinely different (the issue's own spec maps MIDI differently per mode),
so each entry still supplies its own check, but adding a mode now means adding one config entry,
not a new bespoke test.

**Test:** `tests/run_tests.js` — "Gravity/Snake/Blast MIDI hardware routing tests" (pure state-
mutation logic, each mode's `refreshUI`/`updateDirectionHighlight` DOM tail stubbed out).
`tests/invariants.spec.js` — "issue #11: live MIDI hardware input drives Gravity/Snake/Blast,
each per its own spec", using the same fake-MIDI-device pattern INV-23 established, exercising
the real end-to-end path including the chord-buffering timing.

---

### INV-33: Compose's note-editing transforms (select/delete/insert/drag/rotate) are exact lattice operations, not approximations

Task #64, the first slice of INV-28's deferred list (multi-select, drag-to-reposition,
inserting mid-sequence). The key realization, corrected mid-design by the user: translation and
rotation on the Tonnetz are both *linear* transforms on `(p,q)`, and `Tonnetz.getMidi(p,q) = 60 +
7p + 3q` is linear too — so applying the same transform to an entire multi-note selection isn't
separate, harder work from the single-note case, it's the exact same operation applied to a set.
Multi-select was never the hard part; it just looked that way before working out the math.

- **Selection**: `ComposeMode.notesAt(p,q)` returns every note index at a cell (a melody can
  repeat a pitch, so this is a list). `selectAtCell` resolves which one a tap targets — the first
  match not already selected, cycling back to the first once they all are, so repeated taps step
  through same-cell duplicates instead of getting stuck. A plain tap replaces the selection with
  just that note; shift-tap toggles it in/out of a growing selection. A persistent ring
  (`.compose-selected-note`, `renderSelectionMarkers`) marks selected notes on the board,
  distinct from `highlightByMidi`'s momentary play-flash — it has to be re-added after every
  `drawLattice()` call, since that wipes the whole `<svg>`.
- **Delete**: removes every selected note and closes exactly the time each one occupied — later
  notes shift earlier by the deleted note's own `duration`, not by the full gap to whatever comes
  next, so any other intentional rests are left alone.
- **Insert**: tapping an empty cell while exactly one note is selected inserts a new note right
  after it (default duration = the anchor's own), pushing everything at or after the insertion
  point later by that same duration — the exact mirror of Delete's gap-closing.
- **Drag (translate)**: dragging a selected note by `(Δp,Δq)` applies that same `(Δp,Δq)` to
  every selected note. Because `getMidi` is linear, this shifts every selected note's pitch by
  the *same* number of semitones — literally a clean transposition, no per-note special-casing.
  Implemented as a genuine press-move-release drag (`state.dragCandidate`, a 6px movement
  threshold), landing cell resolved via `document.elementFromPoint` at mouseup — mouse-only for
  now (matching this app's existing convention that this kind of drag is a desktop gesture; see
  Deferred below).
- **Rotate**: `Rotate CW`/`Rotate CCW` buttons (not a two-finger gesture — this app has no
  existing gesture-based rotate anywhere, only button/key-based, so this matches that convention
  rather than inventing a new one that would also collide with the existing two-finger-pan
  gesture on the same board) rotate every selected note around the first-selected note (the
  pivot), reusing `Pieces.rotate`/`Pieces.rotateCCW` — the *exact* rigid-rotation math already
  used for rotating a piece shape, applied to a selection's relative offsets instead.

**Deliberately not built**: timing edits (retiming a note, expressing it as a triplet/32nd-note,
simultaneous-time chord entry). Raised mid-design: MIDI's real timing model is ticks against a
declared PPQN converted via a tempo meta-event, which `writeMIDI`/`parseMIDI` don't actually use
today (they assume one fixed 120bpm tempo) — getting real rhythm precision would need a genuine
tempo/quantization grid, tracked separately as `next_steps.md` #52, not folded in here. Per the
user's own explicit call: a rough recording is cheap to re-record from scratch, and real
rhythm-precision editing is better served by a dedicated external MIDI editor working on the
saved `.mid` file directly than by in-app nudge buttons or a timeline widget (`next_steps.md`
#53 tracks a possible link to one such tool, Signal, gated on the user trying it firsthand
first).

**Touch parity (task #65, added after the fact — see below)**: the first pass of this invariant
shipped with multi-select and drag-to-transpose reachable via mouse only — touch's single tap
already got select/insert "for free" through `main.js`'s existing `ComposeMode.tapCell` routing,
but shift-tap and mouse-drag have no touch equivalent, and nothing caught that until it came up
in conversation, not through any test. Fixed by extending `main.js`'s existing hold-timer
infrastructure (previously Sandbox/Blast-only, for hold-to-pick-up) into Compose's own
touchstart/touchmove/touchend branches, gated on `!ComposeMode.state.isRecording` so recording's
instant tap-to-play-and-append is completely untouched: **long-press an existing note** toggles
it in/out of the selection (`ComposeMode.tapCell(p, q, { shiftKey: true })` — the touch
equivalent of shift-tap, reusing the exact same toggle logic rather than inventing a parallel
one), and **a single-finger drag on a selected note** translates the whole selection
(`ComposeMode.translateSelection`), mirroring `compose.js`'s own mouse `dragCandidate` pattern:
touchstart records the start cell and whether it's drag-eligible (an already-selected note),
touchmove tracks movement past a threshold (clearing the hold timer once real movement occurs),
and touchend resolves to a note-drag, a hold's already-fired action, or a plain tap accordingly.

This was found and fixed under a broader, explicit standing rule (not just this one instance):
a bug isn't resolved until the *systematic* test that would catch the whole class exists, not
just a one-off regression for the reported case. The applicable axis here is input method, and
this project's existing convention for sweeping it is splitting coverage across
`tests/desktop.spec.js` (mouse) and `tests/mobile.spec.js` (real touch events) per capability —
the same pattern Melody's own pan test already used (a mouse-drag test and a real-touch-drag
test, same underlying property). Before this fix, Compose had zero `tests/mobile.spec.js`
coverage at all, so this gap couldn't have been caught by anything already in place.

**Test:** `tests/desktop.spec.js` — four "Compose: ..." tests (mouse path): tap-to-select +
Delete's gap-close math, shift-tap multi-select + mouse-drag transposing the whole selection
(verified via real `page.mouse` press-move-release, landing-cell resolution included),
tap-to-insert's shift math (both the new note's placement and the pushed-later note's exact new
time), and Rotate CW's pivot math (pivot note unchanged, the other note's new `(p,q)` matching
`Pieces.rotate`'s own formula by hand). `tests/mobile.spec.js` — two "Compose: a real ..." tests
(touch path, genuine `Touch`/`TouchEvent` dispatch, not `.click()`): a long-press toggling
selection on and back off (a real toggle, not "always selects"), and a single-finger drag
transposing a selected note — both written and confirmed failing against the pre-fix code
first, per this project's own red-green discipline, before the `main.js` changes were made.

---

### INV-34: Board-shape and mode-triplet checks are driven by one shared config per file, not one hand-written test per mode/pair

A direct continuation of INV-33's own lesson: three more places in `tests/mobile.spec.js` had
the same "hand-picked pair/list, not a derived sweep" shape that let the touch-parity gap ship —
found via the same audit, not new instances.

- **Board centering** (`"${mode} board is centered..."`) and **cell-count consistency**
  (`"every playable ${mode} board cell is visible..."`, task #35) each used to define their own
  copy of Blast/Gravity's cell-set logic inline, and Snake had no centering test at all despite
  already being checked for cell-count. Both now iterate a single `RESTRICTED_BOARD_CELLS`
  config (one cell-generator per restricted-board mode) — adding a new bounded-board mode means
  adding one entry, not two more hand-written tests, and Snake's centering gets checked for the
  first time as a direct result.
- **Mode-triplet interaction** ("switching Sandbox -> Gravity -> Sandbox...", "...-> Blast -> ...")
  only ever checked two specific paths, both starting and ending at Sandbox. Generalized to a
  sweep over all 6x6x6=216 possible mode triplets: whatever the *final* mode is, `#palette`/
  `#piece-list` (a single shared DOM element repopulated differently per mode — Sandbox's
  carousel, Blast/Gravity's next-piece queue, hidden entirely for Melody/Snake/Compose) must show
  that mode's own correct content, regardless of which two modes were visited to get there.

Building the unified `RESTRICTED_BOARD_CELLS` config surfaced two real bugs in Snake, not
hypothetical ones — see INV-9/INV-12 above (no `ResizeObserver`, and a hardcoded fixed view that
never got the aspect-matched-fit treatment Gravity/Blast already had).

**Test:** `tests/mobile.spec.js` — `${mode} board is centered...` and `every playable ${mode}
board cell is visible...` (looping `RESTRICTED_BOARD_CELLS`), and "switching through any 3-mode
sequence leaves the shared palette/piece-list correct for the final mode (6^3=216 triplets)".

---

### INV-35: A read-only online song folder, degrading to absent rather than erroring

Task #27's remaining piece: `midi/index.json` + `midi/*.mid` in the repo itself — a third content
tier for Melody/Compose alongside the built-in default and the player's own local folder,
fetched via a plain relative `fetch('./midi/index.json')` in `js/midi-folder.js`'s new
`setupOnline`/`loadOnlineFile`. Deliberately a relative path, not an absolute
`raw.githubusercontent.com` URL: works identically on any http(s) host (GitHub Pages, a local
dev server, anything else this app is ever served from) and simply fails under `file://` (no
origin to fetch from) or offline — the same already-established file://-degradation philosophy
as #47, not a new failure mode. Any failure (offline, `file://`, a 404) just hides
`#midi-online-group`/`#compose-online-group` rather than surfacing an error, since this is a
bonus tier, not a required one — the app works identically without it.

The six bundled songs (Hot Cross Buns plus Frère Jacques, Happy Birthday, the Alphabet Song/
Twinkle Twinkle, Mary Had a Little Lamb, Row Row Row Your Boat) are real `.mid` files, generated
by `scripts/generate-bundled-midi.js` from plain `[noteName, beats]` data using the actual
`MidiMode.writeMIDI` — the correct tool now that it exists and is tested, rather than hand-rolling
SMF bytes a second time. Run that script again to regenerate the files (e.g. after a `writeMIDI`
change) or to add another song.

**Test:** `tests/desktop.spec.js` — three "MidiFolder online: ..." tests using `page.route` to
mock the `index.json`/`.mid` fetches: the dropdown populates and a selected song actually loads
(verified via a real `writeMIDI`-produced buffer parsed back through the real `loadMelodyFromArrayBuffer`,
not a stubbed loader), a failed fetch hides the group instead of erroring, and Compose gets the
same bundled list via its own dropdown.

---

### INV-36: Sandbox's tap-and-hold same-note highlight is reachable via both mouse and touch

Task #24: holding an empty cell while the note-play tool is active (nothing selected — the
default state) highlights every other on-screen cell sharing the same note NAME, across every
octave, not just the tapped cell's own pitch — `SandboxMode.showSameNoteHighlight` sweeps the
full `-15..15` rendered range for any `(p,q)` whose `Tonnetz.getMidi(p,q) % 12` matches. Each
highlighted cell gets its own label showing its own octave-qualified name and frequency (`${name}
${octave} · ${Hz}Hz`), reusing `Tonnetz.getNoteName`/`getOctave`/`getFrequency` — the same
formatting INV-25 already established for Melody, not a second implementation of "how do we
show an octave-qualified note name."

Built for both input methods from the start, not touch-only or mouse-only: mouse gets its own new
hold-timer in `sandbox.js`'s own `onmousedown`/`onmousemove`/`onmouseup` (this app has no existing
mouse-hold pattern anywhere else, so this is the first one — mirroring touch's existing
`HOLD_DURATION_MS`/hold-timer shape rather than inventing a different one). Touch reuses
`main.js`'s existing `performHoldAction` (previously Sandbox/Blast pickup-only), adding an `else`
branch for the empty-cell/nothing-selected case it never had a behavior for before. Both tests
were written first and confirmed failing against the pre-fix code before any implementation
changes, per this project's red-green discipline.

**Test:** `tests/desktop.spec.js` — "Sandbox: holding an empty cell highlights every same-named
cell with its own octave+Hz label, and releasing clears it" (mouse, real `page.mouse`
press-hold-release). `tests/mobile.spec.js` — "holding an empty cell with the note-play tool
active highlights same-named cells..." (touch, genuine `Touch`/`TouchEvent` dispatch).

---

### INV-37: The landscape drawer's width scales with the viewport, not a flat pixel value

Task #57, found live via the random-tap exploratory matrix: `#top-drawer.expanded`'s
`max-width` (the `max-width: 950px and (orientation: landscape)` media query) was a flat
`320px` — a small, reasonable fraction of a wide landscape window, but 52% of a narrower one
(614px). Changed to `min(320px, 40vw)`: unchanged at/above ~800px (40vw already exceeds 320px
there, so the cap stays 320px), scales down proportionally below that.

Testing this needed reading the CSS's own resolved `max-width` via `getComputedStyle`, not the
drawer's rendered `boundingBox()` width — `#top-drawer`'s box is content-driven (auto width
capped by `max-width`), so its actual rendered width can be narrower than the cap regardless of
this fix, which isn't what #57 is about. Also found: `vw`-based computed styles can lag a tick
behind `page.setViewportSize()` itself — reading immediately after a resize returned the PRIOR
viewport's resolved value, so the test polls via `waitForFunction` rather than reading once.

**Test:** `tests/mobile.spec.js` — "the expanded landscape drawer's max-width scales down at
narrow widths instead of a flat 320px (#57)", confirmed failing against the pre-fix flat value
before the CSS change, per red-green discipline.

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
| Compose | Tonnetz, Drawer pull, Record, Play, Undo, Clear, Save, Stats |

This inventory is the reference list INV-13 (below) checks against, and the vocabulary the
rest of this doc and its tests should stay consistent with.
