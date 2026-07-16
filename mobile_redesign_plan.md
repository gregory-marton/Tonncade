# Implementation Plan - Mobile Layout & Gesture Redesign

This document outlines the layout and touch gesture redesign for mobile devices to solve the lack of hover state on mobile, distinguish between tablets and phones, and provide a guide on the mobile emulator and automated testing landscape.

It also tracks status: what's already shipped, how the implementation diverged from the original plan below, and the next round of work (renames, pan clamping, mobile cell sizing, and carousel fixes).

---

## Status as of 2026-07-15

The original plan (see "Goal Description" below) is substantially implemented and verified, and so are the two rounds of follow-up work that came after it:

1. **Renames/polish/carousel fixes** — renames, chord-guide placeholder text, mobile cell size, pan clamp, and the carousel scroll/drag-to-place fixes, including two follow-up root causes found post-launch: a `touch-action: none` rule that was unintentionally blocking the carousel's own scroll, and a flexbox `min-width: auto` trap that kept `#palette` from ever actually overflowing/clipping. Implementation plan and commit history: `docs/superpowers/plans/2026-07-15-sandbox-blast-rename-and-mobile-polish.md`.
2. **Chord Guide draggable pieces + tap-to-move candidate** — chord-guide results now show a correctly-oriented, draggable piece preview instead of a static "Use" badge (reusing a generalized version of the carousel's drag-to-candidate gesture), an X button resets the guide dropdown without disturbing a selected candidate, and touch taps on the board now move the candidate to wherever you tapped (or pick up an existing placed piece in Sandbox) instead of always rotating it. Implementation plan and commit history: `docs/superpowers/plans/2026-07-15-chord-guide-drag-and-tap-to-move.md`.

- **8/8 unit tests pass** (`node tests/run_tests.js`)
- **57/57 Playwright tests pass** across Desktop Chrome, Mobile Chrome (Pixel 5), and Tablet Chrome (`npx playwright test`) — covering hex/label visibility, piece carousel and chord-guide drag-to-candidate, chord dropdown (including the reset button), drag/tap/swipe/pickup gestures, pan clamping, mobile cell sizing, drawer handle, keyboard-hiding, MIDI/Snake touch, and more.

The real implementation evolved past the original spec text below in a few ways — this is expected drift from iterative work, not a bug:

- The bottom "Pieces / Chord Guide" tabbed drawer described below was **not** what got built. Instead, the sidebar controls collapse into a `#top-drawer` at the top of the screen (`drawer-handle`, swipe or tap to expand/collapse), and Sandbox mode's piece palette renders as a horizontally-scrolling **piece carousel** (`#sandbox-mobile-tools #palette` / `#piece-list`) inside that drawer's always-visible area, alongside the chord guide dropdown.
- The floating gamepad-style `#mobile-controls` pad is shown **only in Gravity mode** on phones, not "Snake & Gravity" as originally planned — Snake mode uses its own touch-steering instead (see the Next Round backlog below — this hasn't held up in practice).
- Chop Mode was renamed to Sandbox Mode and Puzzle Mode to Blast Mode in the code (`js/sandbox.js`/`SandboxMode`, `js/blast.js`/`BlastMode`, mode strings `'sandbox'`/`'blast'`), matching the UI display names that already said "Sandbox"/"Blast".
- Dragging a carousel/chord-guide piece onto the board leaves a **candidate** placement (tap-to-rotate/tap-to-move/swipe-to-place still apply) rather than placing immediately on release — this diverged from the original "drag-to-place" framing below once real-device feedback showed immediate placement was too eager.

---

## Next Round: Realtime-mode and Melody polish (backlog, not yet speced, 2026-07-15)

Raw notes from real-device feedback, captured for the next brainstorming pass — none of this has been designed or planned yet:

- **Gravity mode**: the board should resize to fill the available space (it doesn't currently). Needs a "down" button in the center of the other four direction buttons on the mobile control pad.
- **Blast mode**: the puzzle area should fill the available space instead of sitting off to one side. If the player pans it to a better fit, don't reset their pan (i.e. `refreshBoard()`'s hardcoded `Render.updateView(-400, -300, ...)` shouldn't clobber a manual pan).
- **Gravity and Blast modes** both need to show upcoming pieces (Blast already has a next-piece queue on desktop via `renderNextQueue`/`#piece-list` — needs a mobile-visible equivalent; Gravity has none at all).
- **Snake mode**: no visible on-screen controls on mobile — needs a bottom control set similar to Gravity's pad. The existing tap/drag/turn touch-steering gesture (in `main.js`'s `touchstart` snake-mode branch) doesn't work predictably and needs investigation.
- **Pause button** should be visible on mobile (currently not surfaced there).
- **Melody (MIDI) mode**: the "notes to repeat" line updates nicely as the player plays ahead, but it's not clear which note was just played vs. which is next. Playing the full melody (and the example playthrough the player is meant to follow) should update this line in real time too, the same way it does when the player plays it themselves.

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
