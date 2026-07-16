# Implementation Plan - Mobile Layout & Gesture Redesign

This document outlines the layout and touch gesture redesign for mobile devices to solve the lack of hover state on mobile, distinguish between tablets and phones, and provide a guide on the mobile emulator and automated testing landscape.

It also tracks status: what's already shipped, how the implementation diverged from the original plan below, and the next round of work (renames, pan clamping, mobile cell sizing, and carousel fixes).

---

## Status as of 2026-07-15

The original plan (see "Goal Description" below) is substantially implemented and verified. The "Next Round" spec below it (renames, chord-guide text, mobile cell size, pan clamp, carousel fixes) is now **done** — see `docs/superpowers/plans/2026-07-15-sandbox-blast-rename-and-mobile-polish.md` for the implementation plan and commit history for the six task commits.

- **8/8 unit tests pass** (`node tests/run_tests.js`)
- **43/43 Playwright tests pass** across Desktop Chrome, Mobile Chrome (Pixel 5), and Tablet Chrome (`npx playwright test`) — covering hex/label visibility, piece carousel (including native scroll non-interference and drag-to-place), chord dropdown, drag/tap/swipe gestures, pan clamping, mobile cell sizing, drawer handle, keyboard-hiding, MIDI/Snake touch, and more.

The real implementation evolved past the original spec text below in a few ways — this is expected drift from iterative work, not a bug:

- The bottom "Pieces / Chord Guide" tabbed drawer described below was **not** what got built. Instead, the sidebar controls collapse into a `#top-drawer` at the top of the screen (`drawer-handle`, swipe or tap to expand/collapse), and Sandbox mode's piece palette renders as a horizontally-scrolling **piece carousel** (`#sandbox-mobile-tools #palette` / `#piece-list`) inside that drawer's always-visible area, alongside the chord guide dropdown.
- The floating gamepad-style `#mobile-controls` pad is shown **only in Gravity mode** on phones, not "Snake & Gravity" as originally planned — Snake mode uses its own touch-steering instead.
- Chop Mode was renamed to Sandbox Mode and Puzzle Mode to Blast Mode in the code (`js/sandbox.js`/`SandboxMode`, `js/blast.js`/`BlastMode`, mode strings `'sandbox'`/`'blast'`), matching the UI display names that already said "Sandbox"/"Blast".

**Remaining manual-verification item:** the carousel's native horizontal scroll (`touch-action: pan-x`, unblocked by the new drag-to-place JS) can't be exercised by synthetic `TouchEvent` dispatch in Playwright — only real OS-level touch input triggers native browser scrolling. Confirm on a real phone or DevTools device emulation that dragging a carousel piece sideways scrolls it smoothly.

---

## Next Round: Renames, Polish, and Carousel Fixes (spec, 2026-07-15)

### 1. Renames (mechanical)

- `js/chop.js` → `js/sandbox.js`; global `ChopMode` → `SandboxMode`; mode string `'chop'` → `'sandbox'`.
- `js/puzzle.js` → `js/blast.js`; global `PuzzleMode` → `BlastMode`; mode string `'puzzle'` → `'blast'`.
- Rename any remaining `chop-*`/`puzzle-*` ids and classes to `sandbox-*`/`blast-*` (many elements already say `sandbox-*`, e.g. `sandbox-guide`, `sandbox-mobile-tools` — those are already correct and untouched).
- Propagate through every reference: `index.html` (`data-mode` attributes, `<script src>` tags), `sw.js` (cache `ASSETS` list), `css/style.css` selectors, `tests/run_tests.js`, `tests/mobile.spec.js`, `tests/desktop.spec.js`, `tests/test.html`.
- **Do not touch** the `oldKeys`/`tonntris_*` → `tonncade_*` localStorage migration block in `main.js` (`App.init`) — it deliberately references the old literal key names to migrate existing players' saved scores, and must stay as-is.
- Update remaining `tonntris` references now that the GitHub repo itself has been renamed to Tonncade (Tonntris just forwards to it):
  - `package.json`: `"name"` → `"tonncade"`, and `repository.url` / `bugs.url` / `homepage` → `github.com/gregory-marton/Tonncade`.
  - Local git `origin` remote: `git remote set-url origin https://github.com/gregory-marton/Tonncade.git`.

### 2. Remove chord-guide explanation text

Delete the static placeholder line `Select a chord to see which pieces and rotations create it.` — it's self-evident and not worth the space on mobile.

- `index.html`: remove the static text inside `#chord-guide-results`.
- `js/sandbox.js` (renamed from `chop.js`), `updateGuideResults()`: when `val` is falsy, leave the results div empty instead of re-inserting that sentence.

### 3. Mobile cell size (1.5x bigger)

**Root cause:** `Render.updateView()` always sets the SVG `viewBox` to `800 * zoom` × `600 * zoom`, and `zoom` is never actually changed from `1` anywhere in the codebase — it's device-agnostic. Measured live on a Pixel-5-sized viewport, this results in **25 visible rows** of hexes (q from −12 to 12) crammed into the phone screen.

The real (non-repeating) playable height of the tonnetz is about 16 rows, so cells can afford to be ~1.5x bigger.

**Fix:** On phone-width viewports (`matchMedia('(max-width: 767px)')`), use `zoom ≈ 0.667` (`1 / 1.5`) when establishing the viewBox, so the same on-screen area shows fewer lattice units and each hex renders 1.5x larger (~16-17 rows instead of 25). Recalculate alongside the existing `isMobileWidth` / resize-driven checks (`main.js`'s `resize` listener already calls `setupMobileControls()` — the view/zoom recalculation should hook in near there or in `Render.updateView`'s callers).

### 4. Pan clamp (can't pan past the audible edge)

Currently nothing bounds `Render.viewX` / `Render.viewY` — both `js/sandbox.js`'s desktop mouse-drag pan and `main.js`'s two-finger touch-drag pan (`setupTouchGestures`) can pan arbitrarily far into blank space beyond the last playable hex.

**Fix:** Centralize clamping in `Render.updateView(viewX, viewY, zoom)` — the single choke point every pan path already calls through. Compute the on-screen bounding box of valid (MIDI 0-127) hexes for the current mode numerically (iterate the same `p`/`q` range each mode already draws, using `Tonnetz.getMidi` + `Render.getScreenPos`, rather than deriving it algebraically — this stays correct automatically if the lattice formula or draw range ever changes). Clamp incoming `viewX`/`viewY` to that box with **~1 hex-width of slack** past the edge (confirmed with you — enough that edge cells aren't glued to the screen border, but you can't scroll into a large blank void).

Both call sites need a small follow-up fix: `js/sandbox.js`'s `mousemove` handler tracks its own `state.viewX`/`state.viewY` and accumulates further deltas from it — after calling `Render.updateView(...)`, it must read back the *clamped* `Render.viewX`/`Render.viewY` into `state.viewX`/`state.viewY`, or panning will "stick" at the clamp boundary and then jump once you reverse direction. Same fix applies to `main.js`'s two-finger pan syncing `ChopMode.state.viewX/viewY` (soon `SandboxMode.state.viewX/viewY`).

### 5. Piece carousel: fix scroll + add drag-to-place

You reported that trying to pan the piece carousel in Sandbox mode instead pans the tonnetz board. Investigation so far: the carousel (`#sandbox-mobile-tools #palette` / `#piece-list`) lives in the `<header>`, structurally outside the `<svg id="tonnetz-svg">` subtree that the board's pan listeners (`svg.addEventListener('touchstart'/'touchmove'/...)`) are bound to — so it's not obviously a simple event-bubbling conflict, and reproducing it through headless/synthetic touch simulation didn't give a clean signal. Rather than guess-fix from static reading, root-causing this happens live during implementation: write a Playwright regression test that does a realistic touch-drag over a carousel item, confirm it currently misbehaves, find the actual mechanism, then fix it as part of building the two intended gestures below (per the standard red-green testing discipline: write the failing test first, confirm it fails, fix, confirm it passes).

Target behavior (touch/mobile only — desktop already has click-to-select from the sidebar palette plus separate placement):

- **Horizontal drag** on a carousel item → native scroll of the carousel (browsing pieces), left untouched/unblocked so the browser's own `touch-action: pan-x` handles it.
- **Downward drag** on a carousel item → picks up that piece (mirrors the disambiguation already used elsewhere, e.g. `Math.abs(dy) > Math.abs(dx) * 1.5`), shows a ghost following the finger across into the board's coordinate space, and places it if released over a valid cell — same underlying `canPlace`/`placePiece` as the existing on-board swipe-to-place gesture.

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
