# Implementation Plan - Mobile Layout & Gesture Redesign

This document outlines the layout and touch gesture redesign for mobile devices to solve the lack of hover state on mobile, distinguish between tablets and phones, and provide a guide on the mobile emulator and automated testing landscape.

It also tracks status: what's already shipped, how the implementation diverged from the original plan below, and the next round of work (renames, pan clamping, mobile cell sizing, and carousel fixes).

---

## Status as of 2026-07-16

The original plan (see "Goal Description" below) is substantially implemented and verified, and so are the eight rounds of follow-up work that came after it:

1. **Renames/polish/carousel fixes** — renames, chord-guide placeholder text, mobile cell size, pan clamp, and the carousel scroll/drag-to-place fixes, including two follow-up root causes found post-launch: a `touch-action: none` rule that was unintentionally blocking the carousel's own scroll, and a flexbox `min-width: auto` trap that kept `#palette` from ever actually overflowing/clipping. Implementation plan and commit history: `docs/superpowers/plans/2026-07-15-sandbox-blast-rename-and-mobile-polish.md`.
2. **Chord Guide draggable pieces + tap-to-move candidate** — chord-guide results now show a correctly-oriented, draggable piece preview instead of a static "Use" badge (reusing a generalized version of the carousel's drag-to-candidate gesture), an X button resets the guide dropdown without disturbing a selected candidate, and touch taps on the board now move the candidate to wherever you tapped (or pick up an existing placed piece in Sandbox) instead of always rotating it. Implementation plan and commit history: `docs/superpowers/plans/2026-07-15-chord-guide-drag-and-tap-to-move.md`.
3. **Melody mode note-list clarity + live tracking** — `#midi-note-list`'s past notes now fade progressively by recency instead of a flat opacity, and `updateDifficultyUI()` takes an optional override index so `playTargetSequence()` (the teaching intro) and `playPreview()` (the "Play Melody" button) both scrub the note list live as they play, instead of leaving it frozen. `stopPreview()` restores the list to reflect actual game progress once playback stops.
4. **Blast mode mobile layout** — `Render.getFitView(cells, padding, scale)` centers and auto-fits the board to its actual radius-5 playable region (fixing both an off-center bug and a viewBox-too-small clipping bug that only manifested at the mobile responsive zoom, later scaled 1.25x bigger per follow-up feedback); the next-piece queue (`#palette`/`#piece-list`, shared with Sandbox's carousel) no longer gets stranded inside a hidden container when switching away from Sandbox, and now shows as a floating overlay on mobile; `#main-content` got `position: relative` so floating overlays (`#blast-stats` and the new queue panel) anchor to the game area instead of falling back to the viewport and landing near/behind the header. Follow-up: the active piece's ghost now appears immediately after each placement (previously nothing showed until the player's first touch, since mobile has no `mousemove` equivalent), and the queue's first slot shows the active piece itself with a down-arrow overlay — clicking it places the pending ghost, same as swipe-down, gated so it never commits an invalid placement.
5. **Gravity mode mobile layout** — same `Render.getFitView` fix applied to `GravityMode.refreshBoard()` (previously a hardcoded `Render.updateView(-720, -940, 1.8)`, fit to the cup's actual playable cells: `0<=q<20`, column `p+floor(q/2)` in `[-5,4]`); `#m-btn-action` (dead center of the 5-button mobile pad, previously hidden for Gravity since it only dispatched Shift-G "place piece") now shows as a "▼" soft-drop button dispatching `'v'`; Gravity's next-piece queue now shows as a floating overlay on mobile via the same mechanism built for Blast.
6. **Snake mode mobile controls + the landscape root-cause fix** — replaced the broken tap-to-turn gesture (a mirrored sector table sent 4 of 6 diagonal taps in the wrong direction) with a two-cluster 6-button pad (`#snake-mobile-controls`, split left/right for two-thumb reach, bottom corners in portrait / left+right edges in landscape), reusing the existing `bindBtn` synthetic-keydown pattern so `SnakeMode`'s own keyboard handler drives it with no game-logic changes needed. Building this surfaced two much bigger, previously-undiscovered bugs affecting mobile **landscape** orientation broadly (not Snake-specific): (1) `js/main.js`/`js/render.js` had 7 call sites checking only `max-width:767px` for "is this mobile," missing the CSS's separate landscape breakpoint entirely — fixed via a new shared `Render.isMobileViewport()`. (2) `css/style.css`'s big `@media (max-width: 767px)` block (opened line 426) was never closed, silently nesting the *entire rest of the stylesheet* — including both landscape-specific media blocks — inside it, making every landscape override mathematically unreachable. Fixed with the missing `}`, plus extending `#sidebar { display: contents }` (and `#main-content`/`#game-container`'s positioning) to landscape too, since it previously had no landscape treatment at all and was still rendering as a full desktop sidebar there. Together these bugs had made carousel drag, carousel scroll, and drawer open/close all silently non-functional in landscape — undetected because both Playwright mobile projects default to portrait viewports.
7. **Gravity mode landscape split + iOS bottom-chrome overlap fix** — `#mobile-controls` now splits into two 3-button clusters (left: ◀ ↺ ▼, right: ▼ ↻ ▶) in landscape, pinned to the left/right edges like Snake's pad; portrait is visually unchanged (the duplicate down button stays hidden there via `display:contents` unwrapping). Same root-cause class as before: `#mobile-controls` had `position`/`left`/`right`/`z-index` only in the portrait-scoped rule, so landscape fell back to the desktop base rule (`position:static`) — fixed by moving those properties into the unscoped base rule (harmless there since the element is always `display:none` on desktop). Also fixed, from real-device reports: both bottom-anchored portrait pads (`#snake-mobile-controls`, `#mobile-controls`) sat at a bare `bottom:10px`, which real iOS Safari chrome (address bar/tab-switcher row) can fully obscure — reported as Gravity's pad being entirely invisible and Snake's bottom row fully covered. Added `viewport-fit=cover` to the viewport meta tag and a shared `--mobile-pad-safe-bottom: calc(80px + env(safe-area-inset-bottom, 0px))` custom property used by both pads.
8. **Blast mode landscape queue reorientation + third-occurrence `position:absolute` sweep** — `#palette.floating-queue` now reorients to a vertical column docked under `#blast-stats` in Blast's landscape layout, with the active-piece/place button (`.active-item`) breaking out via `position:absolute` to dock at the game area's bottom-left, achieved without any DOM restructuring (the queue list flows normally at the top; only `.active-item` opts out). Root-causing this surfaced the *same* `position:absolute`-only-in-portrait bug for a third time, this time hitting `#blast-stats`, `#gravity-controls`, `#snake-controls`, `#palette.floating-queue`, and `#midi-controls` all at once — rather than patch each individually again, consolidated the shared floating-overlay chrome for all of them into one new combined-condition media query (`@media (max-width: 767px), (max-width: 950px) and (orientation: landscape)`), now the standard pattern for any future floating mobile overlay. Applying the new landscape queue styling unconditionally briefly regressed Gravity (its landscape queue, sharing the same `#palette.floating-queue` class, started overlapping Gravity's own left control cluster) — caught by the existing Gravity landscape test going red before it shipped, fixed by adding a general-purpose `#app[data-mode="<mode>"]` scoping attribute (set in `App.setMode()`) and re-scoping the new Blast queue rules to `#app[data-mode="blast"] #palette.floating-queue`.

- **8/8 unit tests pass** (`node tests/run_tests.js`)
- **103/103 Playwright tests pass** across Desktop Chrome, Mobile Chrome (Pixel 5), and Tablet Chrome (`npx playwright test`) — covering hex/label visibility, piece carousel and chord-guide drag-to-candidate, chord dropdown (including the reset button), drag/tap/swipe/pickup gestures, pan clamping, mobile cell sizing, drawer handle, keyboard-hiding, MIDI/Snake/Gravity controls (including landscape clusters and iOS safe-area clearance), Melody note-list rendering, Blast/Gravity/Snake board and pad centering/fit/queue/positioning, and more.

The real implementation evolved past the original spec text below in a few ways — this is expected drift from iterative work, not a bug:

- The bottom "Pieces / Chord Guide" tabbed drawer described below was **not** what got built. Instead, the sidebar controls collapse into a `#top-drawer` at the top of the screen (`drawer-handle`, swipe or tap to expand/collapse), and Sandbox mode's piece palette renders as a horizontally-scrolling **piece carousel** (`#sandbox-mobile-tools #palette` / `#piece-list`) inside that drawer's always-visible area, alongside the chord guide dropdown.
- The floating gamepad-style `#mobile-controls` pad is shown **only in Gravity mode** on phones, not "Snake & Gravity" as originally planned — Snake mode uses its own touch-steering instead (see the Next Round backlog below — this hasn't held up in practice).
- Chop Mode was renamed to Sandbox Mode and Puzzle Mode to Blast Mode in the code (`js/sandbox.js`/`SandboxMode`, `js/blast.js`/`BlastMode`, mode strings `'sandbox'`/`'blast'`), matching the UI display names that already said "Sandbox"/"Blast".
- Dragging a carousel/chord-guide piece onto the board leaves a **candidate** placement (tap-to-rotate/tap-to-move/swipe-to-place still apply) rather than placing immediately on release — this diverged from the original "drag-to-place" framing below once real-device feedback showed immediate placement was too eager.

---

## Next Round: Realtime-mode polish (backlog, not yet speced, 2026-07-15)

Raw notes from real-device feedback, captured for the next brainstorming pass — none of this has been designed or planned yet:

- **Melody mode MIDI file source**: replace the raw upload picker with a local MIDI folder the player sets once, browsed via a dropdown of its contents — no search/download feature (supersedes the earlier "offer to search for one" idea).
- **Melody mode post-playback transform**: after playing the melody, its notes stay highlighted and become a moveable shape as a whole — draggable to translate/transpose, two-finger rotate for harmonic variation — with a new control to save the altered MIDI afterward.
- **Melody mode bundled songs**: ship a dozen or so public-domain children's songs alongside "Hot Cross Buns." Open question (explicitly for later exploration/conversation, not yet decided): bundle them as part of the app's files, or serve them from a web directory that could double as a shareable alternative to a local MIDI folder — writable web directories may not be a realistic option, so this needs more thought before designing.
- **Sandbox mode tap-and-hold note highlighting**: tap-and-hold a cell to highlight every other cell with the same note name across the lattice, with each highlighted cell's frequency overlaid (e.g. "440Hz" on the As).
- **Sandbox mode "Choose a Chord" dropdown in landscape**: the dropdown is cut off vertically (its text isn't fully readable) and is much wider than the carousel above it. Two options to consider: (a) make it taller and constrain its width to match the carousel, or (b) widen the carousel to a 2×N grid and constrain the dropdown to match that width instead. (Surfaced only after the landscape root-cause fix in Status item 6 — previously landscape mobile styling never activated at all, so this was hidden.)
- **Sandbox mode double-tap bug + pickup redesign**: the first tap of a double-tap is currently interpreted as a rotate (falls through to normal single-tap logic), so the piece can end up in an unintended orientation by the time the second tap lands. Fix planned: remove double-tap-to-pick-up entirely; instead, a single tap picks up a placed piece whenever it's not part of a double-tap AND not within one cell of the current candidate ghost (which more likely means "rotate"). Double-tap-to-place stays as is.
- **Blast mode**: consider adding a Restart button (currently has none).
- **Snake mode**: (1) remove the status message (`#snake-game-status`) entirely; (2) the D-pad arrows should continuously highlight whichever direction is currently "next" (`SnakeMode.state.nextDirection`), not just flash on press, so the active heading is always visible at a glance.

---

## Goal Description (original)
Mobile devices do not have a cursor hover state. In Desktop mode, hover is used to show piece previews/ghosts and trigger chord tooltips. 
To solve this on mobile, we will implement **natural touch gestures** for piece manipulation, floating overlays for realtime modes, and a collapsible bottom drawer for sidebar controls.

Specifically, we will:
1. **Sandbox & Blast Mode Gestures**:
   - **Drag-to-Move**: Dragging on the lattice moves the active piece preview/ghost to follow the finger.
   - **Tap-to-Rotate**: A quick tap rotates the active piece clockwise.
   - **Swipe Down-to-Place**: A fast downward swipe places the active piece on the lattice.
   - **Swipe Up-to-Pickup**: A fast upward swipe picks up a placed piece under the starting touch point (Sandbox/Chop mode only).
   - **Taps (without active piece)**: Plays the note under the finger, serving as a virtual keyboard.
2. **Realtime Modes (Snake & Gravity)**:
   - Floating gamepad-style overlay pads positioned at the bottom corners of the board (d-pad on the left, action/rotate buttons on the right), displayed only in Snake and Gravity modes to keep Sandbox and Blast screens clean and gesture-driven.
3. **Collapsible Bottom Dock**:
   - On phones, a slide-up drawer houses the Sandbox piece palette and Chord Guide, so they do not eat up layout height.
4. **Mobile Testing & Emulator Walkthrough**:
   - Document exactly how to run a local virtual emulator (Android/iOS) and how to configure Playwright for automated mobile testing.

*(Note: item 2 shipped as Gravity-only, and item 3 shipped as a top drawer with a piece carousel rather than a bottom tabbed dock — see "Status as of 2026-07-15" above.)*

---

## User Review Required
No breaking changes to the desktop layout. Gestures are mapped using standard Pointer/Touch listeners on the SVG canvas and are active only on touch-enabled device widths.

---

## Verification Plan

### Manual Verification
1. **DevTools emulation**: Verify layout, drawer toggling, gesture detection, cell size, and pan clamping under mobile viewports.
2. **Local network test**: Run local server and verify gesture response (tap to rotate, swipe to place, carousel scroll, carousel drag-to-place) on a real device.

### Automated Tests
```
node tests/run_tests.js
npx playwright test
```

---

## Mobile Testing & Emulation Landscape

To manually test the mobile interface before pushing your code, you can use either built-in browser emulators or OS-level emulators:

### 1. Browser Device Emulation (Fastest & Easiest)
Your standard web browser has built-in mobile layout and touch event emulation.
1. Open your project on `localhost` or your local server.
2. Open DevTools (Right-click -> Inspect, or press `Option+Cmd+I` on Mac).
3. Toggle Device Toolbar (click the Mobile/Tablet icon, or `Cmd+Shift+M`).
4. Select a preset (e.g., iPhone SE or Pixel 5).
5. Drag your mouse to test the **Drag-to-Move** gestures. Flick downwards/upwards quickly to test the **Swipe** gestures. Click quickly to test the **Tap-to-Rotate** gesture.

### 2. Desktop Android Emulator (OS-Level Emulation)
If you want to test on a virtual device running a complete Android OS:
1. **Download Android Studio**: Visit [developer.android.com/studio](https://developer.android.com/studio) and install it.
2. **Create a Virtual Device**:
   * Open Android Studio.
   * Open the **Device Manager** (found in settings or tools menu).
   * Click **Create Device**, select a hardware profile (e.g., Pixel 7), choose a system image (e.g., API 34), and click **Finish**.
3. **Run the Emulator**:
   * Launch the virtual device from the Device Manager.
   * Open the **Google Chrome** app inside the virtual device.
4. **Access Host Local Server**:
   * Run your local project server on your computer (e.g., `python3 -m http.server 8000`).
   * Inside the Android Emulator's Chrome browser, navigate to the special loopback address: **`http://10.0.2.2:8000`**. This points directly to the host machine's port `8000`!
   * You can now test the touch interfaces exactly as they would run on a native Android phone.

### 3. Automated Mobile Testing (Playwright)
Playwright is already set up in this repo (`playwright.config.js`, `tests/desktop.spec.js`, `tests/mobile.spec.js`), covering Desktop Chrome, Mobile Chrome (Pixel 5), and Tablet Chrome projects.

1. **Install** (already in `package.json` devDependencies): `npm install`
2. **Run a local server** the config points at (`baseURL: 'http://localhost:8001'`), e.g. `python3 -m http.server 8001`.
3. **Run the tests**:
   ```bash
   npx playwright test
   ```
   Playwright runs headless browsers in the background, executing touch events and asserting that SVG lattice elements, the drawer, the carousel, and gesture-driven state updates all behave correctly.
