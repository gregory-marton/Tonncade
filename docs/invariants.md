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


Below are TBR notes: this means To-Be-Renamed. Numbers are fine for
genai assistants, but names help humans keep track of which invariant
is which. When convenient, global search-and-replace the numeric
version with the identifier suggested.  Until that is performed, genai
assistants should try to refer to the invariant with both its number
and its named identifier.

---
### INV-4: A cell always sounds its own pitch — the founding invariant
TBR: INV-Pitch

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

This is the founding invariant of the whole project, stated at its strongest: a cell at `(p, q)`
sounds **exactly** `Tonnetz.getFrequency(getMidi(p, q))` — its own pitch — *everywhere, always, in
every mode*. What may vary per context (mode, cell state, event) is timbre/instrument, volume, and
attack/decay/duration. What may **never** vary is the **pitch**. The Tonnetz position *is* the
pitch; that mapping is inviolable. There is no per-mode exception: the restricted modes
(Snake/Blast/Gravity) aren't a different rule, they're simply *restricted* to fewer cells, each of
which still sounds its own pitch.

Consequences that follow directly:
- **No octave-folding.** The synth must never shift a note into a "comfortable" register to make
  it audible — that plays a *different pitch*. It commands the note's true frequency across the
  whole range of human hearing and beyond; whether a given device can reproduce an extreme
  frequency is the device's business, not a license to change the note. (`js/synth.js` used to
  fold everything into MIDI 21–108; that was a long-standing violation, removed when this
  invariant was codified.)
- **The lattice reaches human hearing.** Pannable modes draw out to the top of hearing
  (`Tonnetz.audibleMaxMidi()` ≈ MIDI 135 ≈ 20 kHz), not the old MIDI-protocol ceiling of 127.
- **The only sounds are real cells doing something — anywhere.** A sound comes only from a real
  cell/piece actively acting on the Tonnetz, but *not* only from on-screen ones: it's fine to hear
  an off-viewport glider recede. What's forbidden is a **phantom or stale** note — a cell sounding
  a pitch from a position it has left. Since a cell always sounds its own *current* `getMidi`, a
  moving pattern never smears pitch (see Life #13).

**Tests:** `tests/invariants.spec.js` — the three "INV-4: ..." tests, plus "INV-4: the synth
sounds each note at its own true getFrequency(midi), never octave-shifted" (sweeps a range of MIDI
values, including the extremes the old fold used to relocate). The lattice-reach half is covered
in `tests/desktop.spec.js` ("Tonnetz draws cells up to the top of human hearing").

**Accepted trade-off:** Gravity's board tuning (`35 − 3p + 4q`) spans ~130 semitones (MIDI 23–153),
so with the fold gone its top rows are genuinely ultrasonic and go unheard, and its low end is
comparatively high. On review (2026-07-28) the honest-pitch result sounded good enough in play that
a retune wasn't worth it — the top was judged fine and, at most, the bottom could drop an octave
someday. So this is a known, accepted characteristic, not an open task. This invariant is what
surfaced it.

### INV-1: Every mode is reachable from every screen, in every orientation
TBR: INV-ModesReachable

You can always navigate from any mode to any other mode (Sandbox, Melody, Snake, Blast,
Gravity), regardless of current viewport size or orientation. On mobile/tablet widths the mode
list lives inside the collapsible `#top-drawer` (open it first); on desktop it's always
visible. Either way, the path to switching modes must never be blocked.

Selecting a mode collapses the drawer afterward (same as picking a piece from the Sandbox
chord guide) — it doesn't stay open across multiple selections, so switching modes twice in a
row on mobile means reopening the drawer each time.

**Test:** `tests/invariants.spec.js` — "INV-1: every mode is reachable from every other mode,
in portrait and landscape"

### INV-13: Primary elements are reachable in every orientation
TBR: INV-ElementsReachable

The same guarantee as INV-1, one level down: every primary element listed in the "Primary
Elements" table above must be reachable (present, non-zero size, not hidden behind a collapsed
drawer once opened) in both portrait and landscape — not just whichever orientation someone
happened to test by hand. The one documented exception is Gravity's duplicate down-button
(`#m-btn-action-2`), which only exists as a distinct primary element in landscape (5 D-pad
buttons in portrait, 6 in landscape); the test checks that one specifically, in both directions,
instead of just excluding it.

**Test:** `tests/invariants.spec.js` — "INV-13: every mode's primary elements are reachable in
both portrait and landscape"

**Coverage gap, found live:** `PRIMARY_ELEMENTS` (the test's own copy of the table above) is
hand-maintained, and both copies missed real controls before anyone noticed — Melody's own song
source dropdown (this week's regression) and, discovered while fixing that, Blast's Restart
button (`#blast-reset`) had apparently never been listed at all, unlike Gravity/Snake's own
Restart buttons. Full auto-discovery isn't possible here: "primary element" is a semantic
judgment call, not a structural one — Compose's tempo/subdivision/Quantize/Metronome inputs sit
at the exact same DOM depth as its Record/Play/Save buttons but are deliberately NOT primary
(settings, not top-level actions), and a naive "every visible control counts" scan would
misclassify them.

What CAN be automated is noticing when the classification call was never made at all: a second
test walks every interactive element inside each mode's own `#<mode>-controls`/`#<mode>-stats`
container and fails if it's neither in `PRIMARY_ELEMENTS` nor in `SECONDARY_ELEMENTS` (the
explicit "yes, deliberately not primary" list, with a reason) nor nested inside a sub-container
the static markup itself starts `display:none` (the existing signal for "conditional, shown
only in some state," e.g. `#compose-edit-group`). A `SECONDARY_ELEMENTS` entry may also name a
wrapping container's own id (not just a leaf control's) — Blast/Gravity's Easy/Medium/Hard
difficulty buttons have no ids of their own at all, only `class="weight-icon"`, so the whole
group is classified via its own `#blast-difficulty`/`#gravity-difficulty` wrapper. A newly
added control that fits none of these buckets now fails loud immediately, instead of silently
having zero reachability coverage the way `#melody-source` did.

**Test:** `tests/invariants.spec.js` — "INV-13 coverage: every interactive control in a mode's
panel is classified as primary or secondary, none forgotten"

### INV-2: Anything you can summon, you can dismiss
TBR: INV-SummonDismiss

Any interactive element or state the player can open/invoke must have a way to close/undo it:
the mobile drawer opens and closes, the chord guide populates and clears, a candidate piece
can be picked up and put back down without being forced to place it.

**Tests:** `tests/invariants.spec.js` — the three "INV-2: ..." tests (drawer, chord guide,
candidate piece)

### INV-3: No dead click targets
TBR: Merge with INV-ElementsReachable. 

The converse of INV-2: nothing that JS explicitly relocates into an "always visible" area is
ever left unreachable because it (or something JS forgot to move alongside it) ends up behind
a hidden ancestor. This is exactly the bug class `#chord-guide-reset` had — the `<select>` and
results got moved into `#mobile-always-visible`, but the reset button was left behind inside
`#sandbox-guide`, which then got hidden, orphaning it.

**Test:** `tests/invariants.spec.js` — "INV-3: nothing moved into the always-visible mobile
area is left unreachable by a hidden ancestor"

**Follow-up gap, found live:** the test above only checks elements that DID get relocated for
ending up orphaned afterward — it has no way to catch an element that was supposed to be
relocated but wasn't, since it never looks anywhere else. That's exactly what happened:
Melody's dropdown reorg (task, one-`<select>` #melody-source-group) added a new control, but
`js/main.js`'s mobile-drawer relocation logic still only knew the OLD ids it replaced
(`#midi-folder-group`/`#midi-online-group`) — those lookups silently returned `null` (an
already-existing `if (el) ...` guard swallowed it with no error), so `#melody-source-group` was
never moved anywhere and stayed stranded inside `#melody-controls`, which this same code
correctly hides wholesale on mobile once redistribution is done. The dropdown existed in the
DOM the entire time — invisible to any check that doesn't measure actual rendered visibility.

Fixed the code, and closed the general gap with a second, deliberately id-agnostic test: once a
mode's own `#<mode>-controls` panel ends up `display:none` (the split-relocation pattern, today
only Melody), that panel must contain zero remaining interactive descendants — everything in it
was supposed to have somewhere else to go. This needs no id list and needs no maintenance as
Melody's controls change or as any future mode adopts the same pattern; it checks the one
property that must always hold for split-relocation to be correct, not a name that can drift
out of sync with `index.html`.

**Test:** `tests/invariants.spec.js` — "INV-3: once a mode-controls panel is hidden for mobile
split-relocation, nothing interactive is left behind inside it"

**Complementary, non-visual check:** the *underlying* mechanism (a stale `getElementById`/
`querySelector` string literal after an id was renamed/removed) is general well beyond mobile
relocation — any silently-null DOM lookup is a bug the moment it's introduced, regardless of
whether a runtime test happens to exercise that exact code path. `scripts/check-dom-ids.js`
(run on every `npm test`, no browser needed) statically cross-checks every literal id
`js/*.js` looks up against every id `index.html` (or JS itself) actually defines, and would
have caught this at edit time rather than days later, live.

### INV-5: Audio and visuals stay in sync
TBR: INV-VisibleSound

When a cell sounds, that exact cell shows visible feedback (the `active-note` class) — not a
neighboring cell, not all of them.

**Test:** `tests/invariants.spec.js` — "INV-5: tapping a cell in Melody mode both sounds its
note AND visibly highlights that exact cell"

### INV-6: Tonnetz translational isomorphism
TBR: INV-Tonnetz

The lattice is a true Tonnetz: translating by one step along any axis shifts the resulting
pitch by the same fixed interval everywhere on the lattice, for both the Standard tuning
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
must also reach the practice game's own logic (`MelodyMode.handleUserInputNote`), so playing the
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

Melody mode's matching (`MelodyMode.handleUserInputNote`) compares exact pitch, not just pitch
class — two different-octave "E"s are genuinely different notes to it, and that's the correct
rule: a melody's octave is part of the tune, not an incidental detail a player should be free to
substitute. Real report: a player found it possible to play "the wrong E" against a real
keyboard, which is an understandable mix-up, not a matching-logic bug — a big board (or a
keyboard with several octaves of physical keys) puts more than one cell with the same bare pitch
class within easy reach, and pitch class alone doesn't say which one is meant.

Fixed at the legibility layer rather than by relaxing the match: the pitch row (part of the
shared Timeline — INV-55) shows each note's octave-qualified pitch (e.g. "E4", not just "E") —
that's what resolves the "wrong E," since it says exactly which cell/pitch is meant. The practice
strip (Melody's decorated Timeline) additionally colors the next three notes to play in a
distinct hue matching the Tonnetz's glow on the corresponding cells; that coloring is
practice-strip-specific, not part of the base Timeline Compose also uses. `Tonnetz.getFrequency`
remains for other readouts, e.g. Sandbox's tap-and-hold, INV-24 — a pitch's frequency isn't shown
here at all, since the octave-qualified pitch already disambiguates without it.

**Test:** `tests/invariants.spec.js` — "INV-25: Melody mode rejects a different-octave note with
the same name, and accepts the exact pitch" and "INV-25: Melody's current-target readout shows
an octave-qualified note name"; `tests/run_tests.js` — "Tonnetz.
getFrequency tests" (pure MIDI-to-Hz correctness, independent of any UI).

---

### INV-26: Melody's drilled segment is user-selectable and tries to be helpful and fun

The drilled segment starts at the left (start) scrubber and ends at the right (end) scrubber,
`state.startIndex`/`state.endIndex` — both inclusive (`endIndex` IS the last included note's
index, symmetric with `startIndex`), starting at `[0, 0]`. The end scrubber auto-advances with
correct play, once per correct play (or the user can move it directly) — continuous, no streak
required. The beginning scrubber auto-advances by a measure once the player has cleanly played
*that specific measure* (the one `startIndex` currently sits in, not the whole possibly-longer
segment up to `endIndex`) `k` correct plays in a row, where `k` is currently 3 (or the user can
move it directly); a mistake resets that streak to 0. Scoping the streak to one measure rather
than the whole segment keeps the mastery bar constant as the segment grows.

`MelodyMode.seekTo(index)` clears any pending mistake/going-ahead timers, sets `startIndex`, and
calls `playTargetSequence()`, which schedules relative to `melody[startIndex].time` instead of
always `melody[0].time`. A wrong note resets `userIndex` back to `startIndex`, not always 0.
`seekTo` is a no-op during a full-melody preview (`isPlayingPreview`), a different,
position-independent playback path. Dragging either scrubber directly is ungated — no
proof-of-mastery required, matching this project's general stance (e.g. copy/paste into Blast is
unrestricted too).

**Test:** `tests/desktop.spec.js` — "Melody mode: ... scrub marker/control ..." / "a wrong note
resets progress back to the scrub position" tests, "dragging the marker near the timeline edge
scrolls it" (#46 edge-scroll), "the end of the drilled segment grows immediately with each
correct play", "3 clean playthroughs of the current measure auto-advance the start into the next
measure" (#46 part 5). `tests/mobile.spec.js` — "a real single-finger touch drag moves the scrub
marker to the touched note", using genuine dispatched `Touch`/`TouchEvent` objects.

---

### INV-55: The Timeline component's two markers always reuse the same DOM nodes across a drag

`js/timeline.js`'s `Timeline` component (shared by Melody's practice strip and Compose — see
"Why Compose exists" in docs/melody-notation-design.md) draws two draggable boundary markers
over the aligned pitch row. Each marker is created once and only ever repositioned via
`style.left` afterward — never recreated, never removed and re-added mid-drag. Found necessary
the hard way (a full re-render mid-gesture detaches whatever a real `touchstart` captured as its
event target, silently breaking the rest of a real touch drag) and still binding: any future
change to marker rendering must preserve this, not just get it right by accident.

Positioning uses each note's own x-position as `Notation.render` itself reports it (stable
regardless of scroll position), not `getBoundingClientRect()`. Dragging near either edge of the
scroll container auto-scrolls it. `Timeline.refresh(notes, opts)` re-renders the staff, the
pitch row (with an optional per-mode `decorate` hook — Melody's practice strip uses it for its
color hints, Compose uses it for its own `.selected` highlight), and the barline overlay together
each time; a mode's own decision of WHAT `startIndex`/`endIndex` currently are lives entirely
outside this component, passed in fresh on every `refresh()` call.

By default a marker's clickable area spans the whole staff+labels+timeline stack (`top:0;
bottom:0` in its own positioned ancestor). Compose overrides this to just the pitch row's own
height (`#compose-notation-scroll .timeline-marker`, css/style.css) — its staff is ITSELF
click-to-add/drag-to-repitch editable (INV-33/Task #9), so a full-height marker sitting at the
same x as a note would silently swallow every click meant for that note instead of the staff's
own handler. Melody has no competing click target on its staff, so it keeps the full-stack span.

**Test:** `tests/desktop.spec.js` — "Timeline.refresh: renders the staff, pitch row, and both
markers at the right notes", "Timeline: dragging the start marker to a different note calls
onStartCommit with that note's id, exactly once, on release".

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
- `MelodyMode.writeMIDI(melodySeq)` — a Standard MIDI File writer (single-track format-0), the
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

The local-folder mechanism itself later generalized into `js/file-folder.js`'s
`FileFolder.create(config)`, the single shared implementation behind both `MidiFolder`
(Melody/Compose, `.mid` files) and `LifeFolder` (Life, `.yaml` files). Two real guarantees this
shared code must hold, found violated live against Life's own Save As:
- **Writes actually reach the folder, never silently downgrade to a download.**
  `showDirectoryPicker()`/`queryPermission`/`requestPermission` must all request `'readwrite'`
  (not `'read'`, which is enough to *list* the folder but not to write into it) at every call site
  (`chooseFolder`, `restore`, `reconnect`) — a folder granted under a stale read-only permission
  queries as not-granted on the next `restore()`, correctly surfacing the "Reconnect Folder" flow
  rather than silently falling back to `saveFileAs`'s `<a download>` forever.
- **The dropdown re-lists live, not just at a few fixed trigger points.** `handle.values()`
  genuinely re-reads the OS on every call (the data is never stale — only the trigger to re-read
  it can be missing), so opening the dropdown itself (`refreshFileList`, on `mousedown`/`focus`)
  must re-list, picking up a file moved/renamed/added on disk outside the app. This is
  deliberately a separate method from the full `listFiles` (restore/reconnect/chooseFolder/
  post-save) path, which unconditionally loads index 0 — hovering the dropdown must never
  silently replace the player's in-progress content. Since the listing re-sorts alphabetically on
  every read, `refreshFileList` re-finds the currently-loaded file by *name* in the fresh listing
  and corrects its index, rather than trusting a numeric index that can now point elsewhere.

**Test:** `tests/run_tests.js` — "Tonnetz.nearestCoordFor" (every returned coord actually
produces the requested pitch; prefers a genuinely adjacent solution over a more distant one in
the same family; keeps a short melody's path connected) and "MelodyMode.writeMIDI round-trip"
(reproduces midi/time/duration through `parseMIDI` within one tick's tolerance, including the
empty-melody edge case). `tests/desktop.spec.js` — six "Compose: ..." tests covering recording,
playback ordering, Undo, Clear, a Save round-trip through a faked folder handle, and loading an
existing file into a connected on-lattice path; plus "MidiFolder: choosing/restoring/reconnecting
... requests readwrite permission, not just read" (three call sites), "MidiFolder: opening the
dropdown re-lists the folder, picking up an externally added file" (also asserts the
currently-loaded file's content is untouched — `parseMIDI` called exactly once), and "LifeFolder:
choosing a folder requests readwrite permission, not just read" (confirms Life inherits the same
shared-code fix). The permission tests assert on *what was requested* via a recorded `{fn, mode}`
call log on the fake's `queryPermission`/`requestPermission`, since a real
`FileSystemDirectoryHandle` never grants more than requested — exactly how the bug went uncaught
originally.

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
`ResizeObserver`, matching the pattern `MelodyMode`/`SnakeMode`/`SandboxMode`/`ComposeMode` already
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

### INV-32: Live MIDI hardware input is supported in every mode

**Not currently met.** `js/midi-input.js`'s `MidiInput.handleNoteOn` has a real, per-mode-specific
routing branch for Sandbox, Melody (INV-23), Gravity, Snake, Blast, and Life — but none at all for
**Compose**, the one remaining mode. A MIDI note-on while Compose is active is silently dropped.
See next_steps.md for the planned fix; not yet designed in enough detail to schedule.

`MidiInput.handleNoteOn` originally only routed to Sandbox and Melody — "other modes have no
'play a free note' concept" was true at the time (issue #11), but the user asked for real
per-mode mappings instead, fully specified in the issue itself; Life's own mapping (a MIDI note
toggles the nearest cell, `LifeMode.handleMidiNote`) was added later the same way. Regular
keyboard/touch controls are untouched everywhere below; MIDI is purely an additional input.

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

### INV-33: Compose's note-editing transforms apply the same exact linear shift to every selected note, never per-note approximation

Translation and rotation on the Tonnetz are both *linear* transforms on `(p,q)`, and
`Tonnetz.getMidi(p,q) = 60 + 7p + 3q` is linear too — so dragging a multi-note selection by
`(Δp,Δq)` applies that same `(Δp,Δq)` to every selected note, which shifts every selected note's
pitch by the *same* number of semitones: a clean transposition, not per-note special-casing.
Rotate reuses `Pieces.rotate`/`Pieces.rotateCCW` — the exact rigid-rotation math already used for
rotating a piece shape — around the first-selected note as pivot, applied to every selected
note's offset from it. A future "optimization" that computes each note's new position
independently (rather than applying one shared transform to the whole set) would risk drifting
off-lattice or losing this exactness; there's no approximation to introduce here, the math is
already exact.

**Test:** `tests/desktop.spec.js` — mouse-drag transposing a multi-note selection (verified via
real `page.mouse` press-move-release) and Rotate CW's pivot math (pivot note unchanged, the other
note's new `(p,q)` matching `Pieces.rotate`'s own formula by hand). `tests/mobile.spec.js` — a
real single-finger touch drag transposing a selected note.

---

### INV-34: Board shape is per-mode configuration, and switching modes never leaks state into another mode

Each restricted-board mode's (Blast/Gravity/Snake) playable cell set is defined by one entry in a
single shared `RESTRICTED_BOARD_CELLS` config, not mode-specific inline logic — adding a new
bounded-board mode means adding one config entry, and it's automatically covered by centering and
cell-visibility checks rather than needing new hand-written ones. Switching between modes must
never leak one mode's board/UI state into another: `#palette`/`#piece-list` (a single shared DOM
element repopulated differently per mode — Sandbox's carousel, Blast/Gravity's next-piece queue,
hidden entirely for Melody/Snake/Compose) must always show the *arriving* mode's own correct
content, regardless of which modes were visited to get there. Checked across every possible
3-mode sequence (N³, N = however many modes exist, fetched from the live UI rather than
hard-coded), not just a couple of hand-picked paths.

**Test:** `tests/mobile.spec.js` — `${mode} board is centered...` and `every playable ${mode}
board cell is visible...` (looping `RESTRICTED_BOARD_CELLS`), and "switching through any 3-mode
sequence leaves the shared palette/piece-list correct for the final mode (N^3 triplets)".

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
`MelodyMode.writeMIDI` — the correct tool now that it exists and is tested, rather than hand-rolling
SMF bytes a second time. Run that script again to regenerate the files (e.g. after a `writeMIDI`
change) or to add another song.

**Test:** `tests/desktop.spec.js` — three "MidiFolder online: ..." tests using `page.route` to
mock the `index.json`/`.mid` fetches: the dropdown populates and a selected song actually loads
(verified via a real `writeMIDI`-produced buffer parsed back through the real `loadMelodyFromArrayBuffer`,
not a stubbed loader), a failed fetch hides the group instead of erroring, and Compose gets the
same bundled list via its own dropdown.

---

### INV-36: Every gesture reachable by mouse is reachable by touch, and vice versa

A general standing rule for this codebase, not a per-feature detail: any interaction built for
one input method (`onmousedown`/`onmousemove`/`onmouseup` vs. `main.js`'s shared touch hold-timer
and drag-disambiguation infrastructure) must be built for the other too, using that input
method's own existing idiom rather than a bespoke one-off. Concretely checked today by Sandbox's
tap-and-hold same-note highlight (task #24): holding an empty cell while the note-play tool is
active highlights every other on-screen cell sharing the same note NAME, across every octave —
`SandboxMode.showSameNoteHighlight` sweeps the full rendered range for any `(p,q)` whose
`Tonnetz.getMidi(p,q) % 12` matches, labeling each with its own octave-qualified name and
frequency (`Tonnetz.getNoteName`/`getOctave`/`getFrequency`, the same formatting INV-25 uses for
Melody). Mouse gets its own hold-timer mirroring touch's existing `HOLD_DURATION_MS` shape; touch
reuses `main.js`'s existing `performHoldAction`.

**Test:** `tests/desktop.spec.js` — "Sandbox: holding an empty cell highlights every same-named
cell with its own octave+Hz label, and releasing clears it" (mouse, real `page.mouse`
press-hold-release). `tests/mobile.spec.js` — "holding an empty cell with the note-play tool
active highlights same-named cells..." (touch, genuine `Touch`/`TouchEvent` dispatch).

---

### INV-38: Compose's tempo/quantization is opt-in, and writeMIDI's real tempo event only appears when actually used

Task #52: a recording-session tempo (BPM) and subdivision grid (`state.tempoBPM`/
`state.subdivision`, `QUANTIZE_GRID` covers straight 1/8 through 1/32 and both triplet
subdivisions), an optional metronome click while recording, and `quantizeNotes()` snapping
`state.notes`' raw (freely-tapped) times/durations onto that grid. Deliberately opt-in (a
`Quantize` checkbox, unchecked by default) rather than automatic on every recording — per the
user's own explicit call earlier this session: a rough recording is cheap to redo, so this
shouldn't silently mangle a capture nobody asked to have quantized.

`MelodyMode.writeMIDI` gained an optional second `tempoBPM` argument to make any of this
meaningful in a written MIDI file: previously it always assumed a fixed 120bpm and emitted no
tempo meta event at all. Passing an explicit tempo now emits a real `FF 51 03` tempo meta event
at tick 0; omitting it is byte-for-byte identical to before. `WRITE_TICKS_PER_BEAT` (480) is
divisible by both 32 and 3, so every grid unit `QUANTIZE_GRID` supports lands on an exact
integer tick count once written, independent of the tempo/PPQN choice itself. Note: Compose's own
Save no longer goes through `writeMIDI` at all — it saves MusicXML (see `ComposeMode.save`),
which always bakes in its own beat quantization regardless of `quantizeEnabled` (MusicXML has no
"raw timestamp" mode the way MIDI does). `tempoBPM` is exercised today by Melody's own MIDI
round-trip and by `scripts/generate-bundled-midi.js`, not by Compose.

**A genuinely vacuous test, caught before it shipped**: the first version of the tempo-emission
test checked only that `parseMIDI(writeMIDI(notes, 90))` round-tripped to the same times as the
input. That assertion can never fail regardless of whether a real tempo event is written or the
BPM argument is silently ignored — `writeMIDI` and `parseMIDI` always agree with whatever tempo
each one independently assumes (explicit or defaulted), so the seconds cancel out correctly no
matter what value was actually requested. Fixed by inspecting the raw output bytes directly for
the `FF 51 03` meta event and decoding its 3-byte value, which only passes if a real, correctly-
computed tempo was actually written.

Chord entry (multiple notes at one time value, grouping near-simultaneous taps) remains
explicitly out of scope here, tracked separately.

**Test:** `tests/run_tests.js` — "MelodyMode.writeMIDI explicit-tempo tests" (raw-byte tempo-event
inspection, plus confirming the no-arg default is unchanged) and "ComposeMode.quantizeNotes
tests" (grid-snapping math at two different tempo/subdivision combinations, confirming the
function actually reads current state rather than a hardcoded assumption).
`tests/desktop.spec.js` — three "Compose: ..." tests: the metronome clicks at the chosen tempo
while recording and stops the instant recording stops, the Quantize checkbox actually applies on
stop, and Save emits a real tempo event matching the chosen BPM when quantize was used.

### INV-39: Compose's real multitouch chord entry never sacrifices pan/rotate/pinch/twist to get it

Real multitouch (several fingers landing on distinct cells while recording) records a chord --
several notes sharing one `time` value -- without disabling the existing 2-finger pan/rotate/
pinch/twist gesture Melody and Compose already share. The two are told apart exactly the way a
tap is told apart from a drag everywhere else in this codebase: a finger that never moves past
the same 10px threshold `main.js`'s existing single-touch drag logic uses is a stationary
chord-tap; a finger that moves past it promotes the whole gesture to the ordinary pan/rotate,
discarding any not-yet-committed candidates (never recorded as notes). A lone touch has no
competing gesture meaning, so it still records instantly.

2+ touches are held as candidates (`main.js`'s `composeChordCandidates`, keyed by touch
`identifier`) until resolution: `touchmove` promotes to pan/rotate the moment any candidate moves
past threshold; `touchend` commits any candidate that never moved via
`ComposeMode.recordTouch(p, q, time)`, using the time it actually touched down, not whenever the
disambiguation happened to finish. `recordTouch` buffers commits for `CHORD_WINDOW_MS` (50ms,
mirroring Blast's own near-simultaneous-note-on buffering) before pushing into `state.notes`, so
fingers landing a few milliseconds apart still share one `time` value rather than becoming a fast
arpeggio of separately-timed notes. Mouse input is unaffected -- a mouse can only ever tap one
cell at a time.

**Scope note**: fingers landing in genuinely separate events more than `CHORD_WINDOW_MS` apart
resolve as separate notes/chords, matching the same tolerance already documented for Blast's own
chord-buffering window.

**Test:** `tests/mobile.spec.js` — "Compose: touching 3 distinct cells at once while recording
appends a real chord -- one shared time, not three arpeggiated notes", "Compose: a genuine
2-finger drag while recording still pans the view (not a chord)", and "Compose: touching 2
distinct cells with no movement records a chord even after a genuine pan/rotate drag already
happened" (gesture-state reset between the two). `tests/desktop.spec.js` — "Compose: Undo
reverses a recorded chord (multiple simultaneous notes) as ONE action".

### INV-40: A restricted board's on-screen shape matches its own content's aspect ratio, not whatever shape leftover chrome space happens to produce

For Snake/Gravity/Blast, `#tonnetz-svg` is sized (`Render.fitContentBox`, inline style so it wins
over the CSS `@media` rules) to the largest box matching the board cells' own natural aspect
ratio (`Render.computeCellBounds`, shared with `getFitView` so both always agree on exactly what
content needs to fit) that fits within the space left after `Render.measureChromeClearance(mode)`
— the current mode's actually-visible stats panel, D-pad (including Snake/Gravity's landscape
left/right clusters, measured individually), and, for Blast, its floating next-piece queue. It is
never stretched to fill whatever oddly-shaped leftover space a flat chrome-inset guess would
produce: fitting content into a reference box with the wrong aspect ratio necessarily wastes
space on whichever axis isn't the tight constraint. `getAspectMatchedRefBox()` derives its
aspect ratio from this correctly-shaped element's own rect, not from raw leftover space, so
`getFitView`'s zoom carries near-zero waste on either axis.

The flat rectangular clearance model breaks down for Snake in portrait: its D-pad is two narrow
columns hugging the left/right edges with an empty gap down the center, and the board's own widest
point (its hexagon's left/right vertices) sits at that same vertical center — so a correct fit
reaches full width, tapering flanks sliding into the gap between the columns, which no rectangular
clearance band can express. `Render.fitBoardShapeAware` (Snake portrait only) instead
binary-searches the largest board whose actual cells clear each real chrome rectangle
individually, predicted through the exact `getFitView`→viewBox mapping so the prediction can't
drift from what renders. Gravity and Blast keep the flat-clearance path — their chrome genuinely
is full-width bands.

Chrome clearance itself is fluid, not a flat pixel guess: `--chrome-*`/`--dpad-*` and
`--mobile-pad-safe-bottom` scale down via `clamp()` toward short viewports (padding/gap/
button-size first, text size only once even shorter) so the measured footprint
`measureChromeClearance` feeds into the fit stays accurate at any screen height, and a
`ResizeObserver` on `#game-container` (the real upstream signal `fitContentBox` depends on, not
`Render.svg` itself, whose own output size can stay unchanged across a resize) keeps the fit
correct through drawer open/close transitions and rapid mode switches.

**Test:** `tests/invariants.spec.js`'s "INV-40: Snake/Gravity/Blast size #tonnetz-svg to match
their own board shape, not the leftover chrome space" asserts `#tonnetz-svg`'s own rendered aspect
ratio matches `Render.computeCellBounds`'s content aspect ratio (within 5%) for each restricted
mode, in both portrait and landscape. "INV-43: ..." separately asserts, for Snake portrait across
a sweep of sizes, that the board's rendered width spans more than 80% of the container width and
that no cell overlaps chrome (`measureBoardOcclusion`).

### INV-41: the restricted board reaches within one hex-diameter of two opposite edges of its available space

A sharper, more direct restatement of the same property INV-40 checks indirectly via aspect
ratio. Matching an aspect ratio while still being arbitrarily small (a scaling bug elsewhere,
unrelated to the reference-box-shape bug INV-40 fixes) would pass INV-40 but shouldn't pass this:
on whichever axis the board is actually bound by (its own shape vs. the available space's), the
rendered board should reach within one hex diameter of *both* edges of the available area on that
axis -- not just correctly shaped, but actually maximized within it. `2 * Render.HEX_R` (one hex
diameter) is the same constant every `getFitView` call already passes as its own `padding`
argument, so this checks that the fit lands where that existing padding convention already
implies it should -- not a new number invented for the test.

Verified against real numbers before writing the exact tolerance: at `scale=1` (Gravity, Blast),
the margin on the binding axis is architecturally *exactly* one hex diameter (the padding itself,
with no extra zoom-in beyond it); a `scale > 1` caller (Snake's 1.15, chosen so a very large
radius-7 board doesn't clip 2 of 169 cells at some sampled aspect ratios) zooms in *past* the
padding, so its own margin ends up smaller still. A 5% tolerance above the exact one-diameter
figure absorbs floating-point rounding at that boundary case without weakening the check itself.

**Test:** `tests/invariants.spec.js`'s "INV-41: ..." — for Snake/Gravity/Blast across both
orientations, transforms the board's own lattice-space bounding box (cells ± `HEX_R`) through
`getScreenCTM()` into real screen coordinates, compares against `measureChromeClearance`'s
available-space edges, and requires the margin on at least one full axis (both left+right, or
both top+bottom) to fall within one hex diameter -- itself measured on-screen via the same CTM
transform, so it tracks the current zoom rather than assuming a fixed pixel constant. Confirmed
failing on the pre-INV-40 code (`Render.measureChromeClearance` didn't exist yet) before writing
the fix, per red-green discipline.

### INV-42: Only the current mode's own mode-specific controls are visible at a time (controls shared across modes are INV-34's concern instead)

Exactly one of `#blast-stats`/`#gravity-controls`/`#snake-controls` is visible at a time on
mobile — each mode gets its own separate panel element (unlike `#palette`/`#piece-list`, the
single shared element INV-34 governs). `App.setMode` clears a panel's inline `display` style to
`''` (never forces a value) when showing it, and sets `'none'` only when hiding it, so the mobile
CSS media query's own `display: flex` layout applies for the active mode and default styling
governs the rest — only `'none'` is ever set inline, never a forced `'flex'`/`'block'` that could
outrank the *other* panels' own `'none'`.

**Test:** `tests/invariants.spec.js`'s "INV-42: ..." switches between Blast/Gravity/Snake on a
mobile viewport and asserts `getComputedStyle(...).display` is `'flex'` for the active mode's own
panel and `'none'` for the other two.

### INV-44: pannable modes fill the game-container -- viewBox aspect matches the container

The restricted modes (INV-40) size themselves to their own fixed board. The **pannable** modes
(Sandbox/Melody/Compose/Life -- everything not in `Render.RESTRICTED_MODES`) have an effectively
infinite, pannable lattice, so their *visible window*
should instead match the game-container's aspect ratio and fill it edge-to-edge. They used to call
`Render.updateView` with the historical fixed 800×600 (4:3) reference box, which `preserveAspectRatio`
then letterboxed inside any non-4:3 container -- wasting the sides of a wide desktop window (a wide
Melody showed the lattice squished into a 4:3 center band). `Render.panView` (the pannable modes'
shared view entry) now derives `refH` from the element's real aspect (`getAspectMatchedRefBox`,
`refW` fixed at 800), so the viewBox maps onto the whole container with no letterbox.

`panView` works in view-**center** coordinates, not the viewBox top-left: aspect-matching makes
the top-left depend on `refH`, so preserving the top-left across a resize/device-rotate would slide
the content, whereas holding the center fixed keeps it put. It also **clears any inline SVG sizing**
a previously-active restricted mode left (see INV-45), and the pannable modes refit on container
resize via a `ResizeObserver` in `js/main.js` (the synchronous window `resize` event fires before
the mobile-landscape reflow settles).

**Test:** `tests/invariants.spec.js`'s "INV-44: ..." asserts, for each pannable mode across wide/
tall/near-square containers, that the viewBox aspect ratio matches the container's within 5% (no
letterbox). INV-9/INV-12's view-persistence check was correspondingly updated to compare the view
*center* rather than the aspect-dependent top-left. Confirmed failing on the pre-fix fixed-4:3 code
before implementing, per red-green discipline.

Found live by this same test, later: when Life shipped it was correctly kept out of
`Render.RESTRICTED_MODES` (so INV-44 legitimately applies to it), but `js/main.js`'s resize-refit
`ResizeObserver` and its `modeRefreshFns` lookup both hardcoded the pre-Life pannable mode list
(`['sandbox', 'melody', 'compose']`) instead of deriving from `Render.RESTRICTED_MODES` /
including Life's own refresh function -- so Life's viewBox refit correctly on mode entry but never
again on a subsequent resize. The `ResizeObserver` guard now reads
`!Render.RESTRICTED_MODES.includes(mode)` instead of a second hand-maintained list, so a future
pannable mode can't silently repeat this.

### INV-45: Every mode's `#tonnetz-svg` sizing is independent — no mode inherits another's leftover inline styling

On a mobile viewport the restricted modes size `#tonnetz-svg` with an inline `width`/`height` +
`position:absolute` (`fitContentBox`, INV-40) fit to their own board's box. Inline styles beat the
`svg { width/height:100% }` CSS and persist even when the viewport later widens, so entering a
pannable mode must not render into a restricted mode's leftover inline sizing. `Render.panView`
clears that inline sizing at the start of every pannable draw, so the board falls back to filling
the container. (At desktop widths `fitContentBox` no-ops, so this only matters at mobile
viewports.)

**Test:** `tests/invariants.spec.js`'s "INV-45: ..." enters each restricted mode at a mobile
viewport (confirming it set an inline SVG width), switches to each pannable mode, and asserts the
inline `width`/`height`/`position` were cleared. Confirmed failing (inline sizing stuck) on the
pre-fix code before implementing, per red-green discipline.

### INV-47: copy/paste preserves true pitch across modes

Cross-mode copy/paste (Ctrl/Cmd+C/V, or the header ⧉/📋 buttons) moves cells between modes and
must **preserve their true pitch** — the corollary of INV-4 for material that travels. The
clipboard stores plain **canonical** (standard-mapping) coordinates: every mode is either the
standard Tonnetz (`60+7p+3q`) or Gravity, and Gravity's mapping is exactly the standard Tonnetz
rotated 120° (`Tonnetz.gravityToCanonical`/`canonicalToGravity`, an exact pitch-preserving integer
transform). So a pasted cell reproduces the copied pitch in the target mode's mapping — identically
for the five standard modes, and via the rotation for Gravity — with **no frequency search and no
same-pitch collisions** (coordinates keep distinct same-pitch cells distinct, which pitch alone
could not). Each mode then applies its own placement rules (Gravity: in-cup, non-overlapping; Snake:
in-bounds food; etc.), so some cells may be dropped — but any cell that IS placed carries its exact
original pitch. Rotation/translation are deliberately not offered here (paste into Compose for
those). Melody, a fixed practice drill, doesn't participate.

(This is distinct from Compose's own `copySelected`/`pasteGroup`, #82's in-mode "duplicate the
selected notes as a new group": that's a same-mode operation on a *subset* of notes with their
relative timing preserved, using the header's cross-mode clipboard only by convention of naming,
not by sharing `App.clipboard` itself.)

**Tests:** `tests/desktop.spec.js` — the gravity↔canonical transform (pitch + round-trip),
Sandbox→Life (same-mapping, exact cells + pitches), Gravity→Sandbox (cross-mapping, pitches
preserved), and paste-into-Gravity honoring cup/overlap. `tests/invariants.spec.js` — "INV-47"
asserts a copied set's pitch multiset survives a copy → switch mode → paste.

---

### INV-48: mode state is independent, and switching modes pauses it — never discards or advances it

Every mode owns its own state. Switching the mode selector away from a mode and back must leave
that mode's state **exactly** as it was left — not reset to a fresh start, not advanced by
anything that would have happened had it kept running, and not overwritten by whatever the player
did in another mode meanwhile. Concretely:

- **No shared mutable state between modes.** A Map, array, or object holding one mode's game
  state must never be the same object another mode reads or writes — not even two modes that
  happen to look similar (Blast's radius-5 hex board and Gravity's cup board are visually and
  mechanically distinct games and must never share one `Board.cells`, however that state ends up
  represented internally).
- **A mode switch pauses; it never auto-resumes.** Any timer/interval driving a mode forward
  (Gravity's drop tick, Snake's move tick, Life's generation tick) stops on `cleanup()` and stays
  stopped until the player explicitly restarts it after returning (a Play/Pause button, etc.) — it
  never keeps ticking while the mode is offscreen, and never silently resumes just because the
  player switched back.
- **A mode switch never resets.** `init()` must not discard prior progress just because the mode
  is being entered (again) — only the mode's own explicit action (a New Game/Reset/Clear button,
  or genuinely the first-ever entry with no prior state) may do that.

This is the corollary of INV-47 for state that does *not* travel: INV-47 governs the one
sanctioned, opt-in way to move material between modes (copy/paste); INV-48 governs everything
else, which must never move between modes at all, on pain of exactly the bugs this codifies
(#15, #16 — Life's board momentarily overwriting whatever mode the player had switched to,
traced to a stale online-automaton fetch repainting the shared `#tonnetz-svg` after the player
had already left Life; and Blast/Gravity's shared `Board.cells`, which silently let each
overwrite the other's board and reset progress on every re-entry).

---

### INV-49: a mode's difficulty is a plain integer level, rendered by one shared component

Blast, Gravity, and Melody each show a difficulty control as a vertical dumbbell-barbell of
lit/unlit weight icons (task #93). What "difficulty" MEANS, and how many levels it has, is each
mode's own choice — Blast/Gravity's levels select piece-size pools (`Pieces.DIFFICULTY_KEYS`,
task #39), Melody's select how much note-list/Tonnetz hinting shows while drilling — but the
*representation* (a 1-indexed integer level) and the *rendering* (lighting the first N of the
mode's own icons) are identical across all three, so `js/difficulty-barbell.js`'s
`DifficultyBarbell.create(config)` is the one shared implementation, following this project's own
factory convention for "one implementation, several independent instances"
(`js/board.js`'s `createBoard(shape)`, `js/file-folder.js`'s `FileFolder.create(config)`). Before
this, the exact same `{easy:1,medium:2,hard:3}` lookup and the exact same 3-button SVG markup were
independently hand-duplicated three times each (in `js/blast.js`/`js/gravity.js`/`js/melody.js`
and three times in `index.html`) — found live while auditing the invariant tests for exactly this
shape of drift risk.

A mode calls `DifficultyBarbell.create({containerId, levelCount, labels, onSelect})` and
`.render()`s it into what's now an empty `.difficulty-weights` container in `index.html` (the
button markup, including the dumbbell SVG glyph, is generated by the component, not hand-authored
per mode) — so a mode choosing a different `levelCount` needs no HTML edit at all. Levels are
1-indexed with lit-count equal to the level directly (level 1 -> 1 lit icon, level N -> N lit).

Blast/Gravity persist their level to localStorage (`tonncade_blast_difficulty`/
`tonncade_gravity_difficulty`, unchanged keys); `DifficultyBarbell.migrateLevel(key, fallback)`
reads a value stored under the old word-based scheme (`'easy'/'medium'/'hard'`) and converts it to
the equivalent digit once, on read — the next `setDifficulty()` call re-saves it as a plain digit,
so this is self-resolving, not permanent cruft. Melody's difficulty was never persisted and still
isn't, matching its own prior, deliberate design.

**Tests:** `tests/desktop.spec.js` — "Melody: the difficulty control is the same dumbbell-barbell
as Blast/Gravity, not a dropdown", "Piece-size difficulty presets (Blast/Gravity)" (click-to-set
wiring + cumulative lit count for each level, asserted as an integer, and the piece-size pool each
level actually draws from), and the "Deep-linking..." test's default-difficulty lit-count check
(reads each mode's own `_difficultyBarbell.levelCount` rather than a bare literal, so it can't
silently drift if a mode's level count ever changes).

**Test:** `tests/invariants.spec.js` — "INV-48: ... survives a switch to ... and back untouched",
once per stateful mode (Sandbox, Blast, Gravity, Snake, Life, Compose, **Melody**). Each
mutates the mode via a real UI interaction, switches to the next mode round-robin and mutates
that one too (proving no leakage either direction), waits past any relevant timer interval, then
switches back and asserts the mode's black-box fingerprint — every meaningfully-classed painted
cell on the shared canvas plus every mode's own score/counter text, read from the DOM rather than
from internal `state` objects — is unchanged from right after its own mutation.

**Melody was a real violation, found live, not just a coverage gap.** The doc previously exempted
Melody here as "a fixed practice drill [that] doesn't hold placed/scored state, matching its
exemption from INV-47" — that claim was simply wrong: Melody's drill progress (`endIndex`,
`userIndex`, `startIndex`, the streak) is exactly the kind of state every other mode's own
exemption-from-exemption already covers. `MelodyMode.init()` called `resetGame()`
**unconditionally** on every entry, including mere re-entry after switching away — silently
discarding progress and auto-replaying the intro sequence, precisely what this invariant forbids.
Fixed with a `state.gameStarted` flag: `resetGame()` (still called unconditionally by the
legitimate reset paths — first-ever entry, the explicit Restart button, loading a new song) sets
it; `init()` only calls `resetGame()` itself when it's still `false`, otherwise just repaints the
UI from the untouched progress state, exactly mirroring "leaving pauses, entering never
auto-resumes or resets" as every other mode already does.

The exemption existed because nobody had re-checked it against what the code actually does since
it was written — the same underlying failure mode as a stale reference (see `scripts/check-dom-ids.js`'s
own history): a claim about the code, recorded once, drifting silently out of sync with reality,
with nothing to catch it. There's no automatable check to prevent an *incorrect test-scope
exemption* the way there is for a stale id string — the real defense here is `STATEFUL_MODES`
covering every mode with any progress worth preserving, so no mode gets to claim an unverified
exemption from this invariant going forward.

---

### INV-53: hex cells shrink/grow in sync with real browser page-zoom, not just the sidebar

Reported live: in Chrome, Ctrl+Minus (page zoom out) correctly shrinks the sidebar/controls (plain
fixed-CSS-px content — buttons, text — shrinks automatically with browser zoom, no app code
involved) but the Tonnetz's hex cells didn't shrink at all, and the board read as *bigger*.

Root cause: `#sidebar` is a fixed `300px`; `#game-container` fills the rest via `flex-grow: 1`.
Real browser page-zoom changes the CSS-px viewport size layout reflows against (zooming out
reports *more* CSS px available), so the fixed sidebar becomes a smaller proportion of the wider
viewport and the fluid board area grows to fill the difference — while the Tonnetz's `viewBox` was
computed purely from "however big the container's CSS-px box happens to be," with zero dependency
on the browser's actual zoom level, so the cells rendered inside it never shrank at all.

**This container-area shift is intentional and unchanged by this fix** — the sidebar responding
to a zoom-resized viewport is correct, expected fluid-layout behavior, exactly like any other
percentage/flex-based content on the page. What was actually broken, and the only thing this fix
addresses, is that individual hex cells should shrink/grow *in sync* with the rest of the page's
zoom (matching how zooming out on a map reveals more of it at a smaller scale) — which required
detecting real browser zoom at all, something nothing in this codebase did (confirmed via
`grep -rn "devicePixelRatio" js/` — only `js/replay.js`'s one-shot metadata snapshot, never read
back). Real browser page-zoom changes `window.devicePixelRatio` proportionally to the zoom level;
`Render._baselineDPR` (captured once, at script-parse time — i.e. once per real page load) and
`Render.getBrowserZoomFactor()` (`devicePixelRatio / _baselineDPR`, a *ratio* rather than an
absolute check, so a HiDPI/Retina display's `dPR > 1` at 100% zoom doesn't itself trigger anything
— the ratio stays exactly 1.0 there until the user actually zooms) are read in exactly one place:
the first line of `Render.updateView(viewX, viewY, zoom, refW, refH)`, `zoom = zoom /
getBrowserZoomFactor()`, before that `zoom` flows into the pan-bounds clamp and the final
`viewBox` string exactly as before.

That single hook is sufficient for every mode, no other file needs to change: `updateView` is the
one place the `viewBox` attribute is ever actually set, reached by every pannable mode's
`panView(centerX, centerY, zoom)` (`sandbox`/`melody`/`compose`/`life`, passing the mode's own
persisted `state.zoom` — the player's pinch/wheel preference, clamped by `applyZoomDelta`'s
`MIN_ZOOM`/`MAX_ZOOM` *before* this compensation ever applies, so `state.zoom` keeps meaning
exactly what it already meant, untouched by browser zoom) and by every restricted mode's
`getFitView(...)` + `updateView(...)` (`blast`/`gravity`/`snake`, which have no persisted zoom at
all — each refresh computes a fresh `fit.zoom`). Real browser zoom already reflows layout (it's
the very mechanism the original bug depends on), which already fires the existing
`ResizeObserver`s (the pannable-mode one in `js/main.js`, and each restricted mode's own) that
already call the mode's refresh function — no new listener needed, the fix is picked up on the
next resize-triggered redraw for free. `this.zoom` (what `updateView` stores) holds the
*compensated* value, matching what `js/main.js`'s two-finger pan-drag math reads back
(`Render.zoom` as a screen-px-to-world-units conversion), so drag panning stays correct too.

**Accepted simplification:** the compensation applies *after* `applyZoomDelta`'s own
`MIN_ZOOM`/`MAX_ZOOM` clamp, so an extreme combination (pinched to `MAX_ZOOM` *and* the browser
heavily zoomed out) isn't re-clamped against those bounds — real browser zoom levels rarely reach
extremes in practice, not worth a combined clamp for a first pass.

**Non-goal:** OS/mobile-Safari-style visual-viewport pinch-zoom (a compositor-level zoom that
doesn't reflow layout or change `devicePixelRatio`) is a different mechanism from desktop browser
page-zoom and isn't addressed here — the report was specifically about Ctrl+/Ctrl-, and the app's
own in-canvas pinch/wheel zoom (a pure `state.zoom` multiplier, no container/dPR reads at all)
already worked correctly and is untouched.

**Test:** `tests/desktop.spec.js` — "Render: browser zoom (devicePixelRatio change) scales cell
size in Sandbox..." and "...in Gravity too (a restricted mode...)". `page.setViewportSize()`
(used elsewhere to simulate the *container-area* half of this bug) does not change
`devicePixelRatio`, so these tests instead stub it directly via a configurable getter installed
with `page.addInitScript()` *before* any app script runs (so `Render._baselineDPR` captures the
stubbed value at parse time, exactly like a real page load), then change the stub mid-test and
force a redraw, asserting the `viewBox`'s world-unit span changed by the inverse ratio — isolated
from the container-area effect, since the viewport itself is never resized in these tests.

---

### INV-54: Undo reverses the last human action, scoped per-mode to where it actually makes sense

Issue #17 asked for Undo, scoped explicitly per mode rather than uniformly: Sandbox and Blast get
it (placement mistakes are the whole point of the request — "one user tried to move and
accidentally placed a lot"); Compose already had a narrow one (`js/compose.js`'s `undo()`, a plain
`notes.pop()` — extended below, not left as-is, since it only correctly reversed "the last note I
just recorded" and silently did the wrong thing after Delete/rotate/translate/paste-group); Life
gets it for **human edits only, never simulation effects** (running the automaton forward isn't a
mistake to correct — it's the whole point of watching one run); Melody, Snake, and Gravity
deliberately don't (Melody tolerates wrong notes instead of rewinding them; Snake and Gravity are
continuous real-time play with no discrete, reversible "placement moment" the way Blast has one —
Gravity's pieces settle and keep free-falling every tick indefinitely, never locking into a single
undo-able event).

**Shared mechanism**: `js/undo-stack.js`'s `UndoStack.create()` — a plain LIFO stack of inversion
closures, one per mode (`state.undoStack`), following this project's established factory
convention (`createBoard(shape)`, `FileFolder.create(config)`, `DifficultyBarbell.create(config)`).
Each mutator pushes a closure that reverses exactly what it just did, at the moment it changes
state — the mutator itself is what knows how to invert its own change, not a typed entry plus a
switch-statement inverter living somewhere else. `undo()` pops and runs the most recent one, then
redraws once; an empty stack is a silent no-op.

- **Sandbox** (`js/sandbox.js`): `placePiece`, both pickup call sites (`handleAction`'s pickup
  branch and `pickupPieceAt`), and `pasteClipboard` each push their own inversion. Pickup and
  placement are symmetric (pickup already re-arms the palette; its own undo closure does nothing
  more than push the exact same piece object back onto `placedPieces`). Paste only undoes the
  cells *that specific paste actually added* (some may have been skipped as already-occupied
  duplicates) — tracked by pushing the exact objects `pasteClipboard` itself pushed into
  `placedCells`, and filtering by reference identity on undo, not by re-deriving from the pasted
  coordinates. No New-Game-equivalent exists for Sandbox (there's no Clear button), so its history
  is never explicitly cleared — it simply accumulates for the session.

- **Blast** (`js/blast.js`): the interesting case, since a single `placePiece` call can
  synchronously trigger a line-clear cascade (`processClears`) that removes cells belonging to
  *earlier* placements too, not just the one just made — `findFullLines()` scans the whole board.
  `processClears` now returns exactly what it removed (`{cells: [{key, value}], linesCleared}`),
  and `placePiece`'s own undo closure restores those cells **before** deleting the cells this
  placement added — correct even when a just-placed cell was itself part of the cleared line (it
  gets restored, then immediately deleted again, netting to "not present," which is right: it
  never existed before this placement). Also restores `activePiece`/`nextQueue` (a one-way random
  draw — the queue's tail can't be reconstructed any other way), `rotation`, `linesCleared`, and
  `isGameOver`, all snapshotted before the mutation. `pasteClipboard` gets its own, simpler
  closure (paste never triggers `processClears`). `reset()` (New Game) clears the undo history —
  undoing past that boundary back into a previous game doesn't mean anything.

- **Life** (`js/life.js`): `toggleCell` (one tap = one undo; confirmed no drag-multi-toggle
  gesture exists to batch), `clear`, `reset`, and `pasteClipboard` each push a closure restoring
  `state.live` (a full `Map` snapshot — simplest correct approach, and cheap at this board's
  `HARD_BOUNDS` scale) and `state.generation`. Critically, `stepOnce()` — the sole generation-
  advance function, called identically by both the Step button and continuous Play's own
  interval — pushes **nothing**, and shares no code path with any human-edit function. Undo after
  a Step reverses whatever the last *edit* was (wherever the board currently sits, post-step), not
  the step itself — `state.generation` is never decremented by `undo()`. `loadAutomaton` clears
  the undo history (a new automaton's rule/live cells is a fresh start, not a correction to make).

- **Compose** (`js/compose.js`): the most mutators of any mode — `tapCell`'s record branch and
  `flushChordBuffer` (a whole recorded chord is ONE undo action, not one per note, since all its
  notes landed together), `deleteSelected` and `clear` (both wholesale-*replace* `state.notes`, so
  the prior array reference is simply snapshotted and restored, same shape as Life's `clear`/
  `reset`), and `insertAfterSelected`/`translateSelection`/`rotateSelection`/`pasteGroup` (all
  mutate existing note objects **in place** — `n.time`/`n.p`/`n.q`/`n.midi` — so each snapshots
  the *prior* values of every note it's about to touch, before touching it, and restores those
  exact values on undo, rather than trying to recompute an inverse transform). `selectedIndices`
  is restored alongside `notes` by every closure that changes it, so the UI selection stays
  coherent after an undo, not just the note data. `loadMelodyFromArrayBuffer` clears the undo
  history (a freshly-loaded file is a fresh start, matching Blast/Life's own boundary).

**One shared header button, not four per-mode ones.** Sandbox/Blast/Life/Compose originally each
got their own `#<mode>-undo` button inside their own panel — simple, but it meant four buttons to
keep in sync, and one (`#sandbox-undo`) leaked visible into every mode for a while because its
wrapper `div` had no `id` and was never touched by `setMode`'s hide/show logic (reported live as
"two undos in Blast"). Per follow-up direction, these were consolidated into a single `#undo-btn`
in the header (`index.html`, next to `#copy-btn`/`#paste-btn`) — always present, never hidden, and
simply **disabled** wherever undo isn't currently applicable: no undo support in the current mode
at all (Melody/Snake/Gravity), or that mode's own `undoStack` is currently empty. `App.undo()`
(`js/main.js`) dispatches to `App.modeModule().undo()`; `App.refreshUndoButton()` reads
`App.modeModule().state.undoStack.canUndo()` (a new `UndoStack._proto` method) to set the
button's `disabled`/opacity/cursor. Rather than requiring every one of the ~20 individual mutator
call sites across the four mode files to remember to poke the button, `UndoStack.push()`/`undo()`/
`clear()` themselves call `App.refreshUndoButton()` on every change (guarded for contexts where
`App` isn't defined) — so the button can never go stale. Ctrl/Cmd+Z is wired the same way Ctrl/Cmd+C
and Ctrl/Cmd+V already are (`App.setupClipboard`), stepping aside for editable fields and real text
selections.

**Test:** `tests/desktop.spec.js` — "Sandbox: Undo reverses a placement/pickup/paste", "Sandbox:
Undo on an empty history is a silent no-op", "Blast: Undo reverses a placement" (plain, and the
line-clear-cascade case, asserting the board's exact pre-placement `Map` contents round-trip),
"Blast: Undo reverses a paste", "Blast: New Game clears the undo history", "Life: Undo reverses a
single cell toggle", "Life: Undo reverses Clear and Reset", "Life: a simulation step is never
undo-able" (asserts `generation` is unaffected by `undo()` after a Step), "Life: Undo reverses a
paste", "Life: loading a new automaton clears the undo history", "Compose: Undo reverses a
recorded chord/Delete/Insert/translate/rotate/paste-group/Clear" (the Insert and paste-group cases
deliberately use scenarios where a naive `notes.pop()` would coincidentally produce the same
result as a real inversion for a *simpler* scenario — multi-note, non-trailing-position setups —
so the test actually discriminates between the two, confirmed red against the old `pop()` code
before landing), "Compose: loading a file clears the undo history". `tests/invariants.spec.js` —
"INV-48: Sandbox/Blast/Life/Compose's undo history survives a switch away and back untouched"
(each mode's `undoStack` is untouched by `cleanup()`/`init()`'s resume branch, same shape as
Melody's own `cleanStreak`, INV-26 — asserted directly since `paintedFingerprint`'s black-box DOM
check has no visible representation of undo history to catch a regression here). Also "Undo (#17):
the single header button stays disabled everywhere undo has nothing to do, and enables once there
is something to undo" — covers the always-disabled modes (Melody/Snake/Gravity), the
empty-stack-disables/non-empty-enables transition (Sandbox, Blast), and that clicking back down to
an empty stack re-disables it (not a one-way latch).

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
| Blast | Tonnetz, the preview/place control, Restart, Stats, Drawer pull |
| Snake | Tonnetz, each of the 6 D-pad arrows individually, Pause, Restart, Stats, Drawer pull |
| Melody | Tonnetz, Drawer pull, Song source, Play, Restart, Stats, Sequence message |
| Sandbox | Tonnetz, Drawer pull, Carousel, Chord picker |
| Compose | Tonnetz, Drawer pull, Song source, Record, Play, Clear, Save, Stats |
| Life | Tonnetz, Drawer pull, Automaton source, Play/Pause, Step, Reset, Clear, Save, Generation counter |

This inventory is the reference list INV-13 (below) checks against, and the vocabulary the
rest of this doc and its tests should stay consistent with. Undo (#17) isn't in any per-mode
row: it consolidated into a single header control (`#undo-btn`, next to Copy/Paste) that lives
outside every mode's own panel and is simply disabled where inapplicable — see INV-54.
