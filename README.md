# Tonntris

A musical falling-block game played on Euler's *Tonnetz* — a hexagonal lattice of consonant musical intervals. Placing, moving, and rotating pieces behaves both as a spatial geometry puzzle **and** a music sequencer. 

Built in pure vanilla JavaScript, HTML5 SVG, and Web Audio API, the game runs completely client-side and can be run locally via a `file://` URL (no server or build steps needed) or installed as a standalone offline mobile app.

---

## Core Concept
Euler's Tonnetz organizes notes by harmonic relationships rather than scalar steps. In this pointy-top hexagonal representation:
*   **Horizontal Axis ($p$):** Perfect Fifths (+7 semitones)
*   **Diagonal Up-Right Axis ($q$):** Minor Thirds (+3 semitones)
*   **Resulting Diagonal Axis:** Major Thirds (+4 semitones)

Each hexagon cell represents **one note**. The pieces are **tetrahexes** (4 hexagons joined edge-to-edge), meaning each piece represents a **4-note chord**. 

Rotating a piece 60° cycles the internal intervals along the Tonnetz axes, re-voicing the chord in real-time. For example, rotating a straight "I" piece changes it between:
*   `C-G-D-A` (fifths: suspended, open)
*   `C-E-G#-C` (major thirds: augmented)
*   `C-Eb-F#-A` (minor thirds: diminished)

---

## Game Modes

### 1. Chop Mode (Infinite Sandbox)
Select any piece from the palette or keyboard letters, position and rotate it freely, and place it anywhere on an infinite scrolling grid. Clicking a placed piece picks it back up. Panning is supported by dragging empty space.

### 2. Puzzle Mode (Hex Bounded Board)
A strategic mode on a radius-5 hexagonal board. You are fed random pieces from a queue to fit into the grid. Completing a full axis-line of cells clears them. Game over occurs when no further pieces can be placed.

### 3. Gravity Mode (Falling Cup Block Mode)
A fast-paced falling block mode inside a 10x15 cup-shaped board:
*   **Falling Physics:** Pieces spawn at row 20 and drop down. On a hex grid, vertical paths alternate down-left and down-right steps to maintain columns.
*   **Rigid Piece Sliding:** If the vertical path is blocked, the active piece slides diagonally down as a single rigid body if there is a slope valley available.
*   **Vertical Shifting Clears:** Completing a horizontal row of fifths clears the line and shifts all cells above it straight down, maintaining column structures.
*   **Speed Escalation:** Gravity starts slow (1000ms steps) and gets 50ms faster for each cleared line (clamped to a 100ms limit).

---

## Controls

### Chop & Puzzle Modes
*   **F T Y H B V:** Move selection
*   **Space / G / Arrows:** Rotate (Shift-Space: CCW)
*   **Letters:** Select piece type (Chop Mode only)
*   **Shift + G / Click:** Place or pick up pieces

### Gravity Mode
*   **ArrowLeft / f:** Move Left
*   **ArrowRight / h:** Move Right
*   **ArrowDown / v / s:** Soft Drop (moves down faster, holding slides rapidly)
*   **Space / ArrowUp / g:** Rotate CW (Shift-Space: CCW)
*   **Escape / p:** Pause / Resume
*   **Click:** Controls are keyboard-focused; click the sidebar buttons to Pause/Restart

---

## PWA Installation (Offline Play)
This project is configured as a **Progressive Web App (PWA)**:
*   **Android (Chrome / Firefox / Samsung Internet):** Visit the hosted page. A badge saying "Install App" or "Add to Home Screen" will appear in the URL address bar or as a popup banner. Click it to install the game into your device's app drawer.
*   **iOS (Safari):** Open the page in Safari, tap the **Share** button (box with an up arrow), and select **Add to Home Screen**. 

---

## Deployment & Hosting
Since PWAs require secure HTTPS connections, you can deploy the game for free in seconds:
1.  Push this codebase to a public GitHub repository.
2.  Go to repository **Settings** -> **Pages**.
3.  Select deployment source as **Deploy from a branch**, pick `main` (or root directory), and click **Save**.
4.  Your game will be publicly accessible and installable at `https://<your-username>.github.io/<repo-name>/`.

---

## License
Licensed under the **GNU General Public License v3 (GPLv3)**. See the `LICENSE` file for the full text.
