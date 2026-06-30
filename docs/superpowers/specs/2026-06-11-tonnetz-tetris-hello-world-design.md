# Design Spec: Tonntris "Chop Mode" (Hello World)

**Date:** 2026-06-11  
**Status:** Draft  
**Target:** Chop Mode (Infinite Sandbox)

## 1. Vision
The "Hello World" of Tonntris. A pure sandbox where the player can explore Euler's Tonnetz, hear the harmonic relationships, and place pieces (tetrahexes) to hear them as chords. No gravity, no line clears, no score—just harmony and geometry.

## 2. Core Mechanics

### 2.1 The Lattice (Tonnetz)
- **Geometry:** Hexagonal lattice (Harmonic Table layout).
- **Coordinate System:** $(p, q)$ axial coordinates.
  - $p$-axis (horizontal): Perfect Fifths (+7 semitones).
  - $q$-axis (diagonal up-right): Major Thirds (+4 semitones).
  - The third axis (diagonal up-left) naturally becomes Minor Thirds (+3 semitones).
- **Cell Content:** One hexagon = one note.
- **Visuals:** Hexagons labeled with note names (C, G, E, etc.).
- **Extent:** Bounded to the functional MIDI range (0-127) to provide "natural pitch clamping."
- **Visible Scale:** The initial viewport should show ~12-25 notes across (e.g., a 20x12 grid) to provide a rich harmonic landscape.
- **Navigation:** Dragging empty space pans the lattice, allowing the player to explore the full MIDI range.

### 2.2 The Pieces (Tetrahexes)
- **Definition:** Exactly **4 hexagons** joined edge-to-edge.
- **Note Mapping:** Each hexagon represents **one single note**. A piece therefore always consists of **exactly 4 notes**.
- **Set:** The **10 one-sided tetrahexes** (rotatable but not flippable).
  - **Achiral (4):** Bar (I), Bee (O), Propeller (Y), Arch (C).
  - **Chiral Pairs (6):** Worm (L/J), Pistol (P/Q), Wave (S/Z).
- **Selection:** A palette or "shop" where the player picks a piece.
- **Rotation:** 60° increments. Rotation changes the internal intervals of the piece, thus changing the chord.

### 2.3 Interaction
- **Click Empty Cell:** Plays the single note at that coordinate.
- **Pick Piece:** Select a tetrahex from the palette.
- **Rotate:** Key/Button to rotate the active piece.
- **Place Piece:** Click an empty area to drop the piece.
- **Placement Sound:** A quick "rolled" chord (staggered note starts).
- **Pickup:** Clicking a piece already on the board picks it back up.
- **Navigation:** Drag empty space to pan the lattice.

## 3. Technical Architecture

### 3.1 Stack
- **Language:** Vanilla JavaScript (No ES modules, runnable via `file://`).
- **Rendering:** SVG for the lattice and pieces.
- **Audio:** Web Audio API.
  - Synth: Triangle wave oscillator.
  - Envelope: Gentle attack/decay (~2.6kHz lowpass filter).
  - Voice limit: Polysynth capable of playing at least 4 notes (one tetrahex).

### 3.2 Modules (Classic Scripts)
- `tonnetz.js`: Coordinate math, pitch mapping, lattice geometry.
- `synth.js`: Audio engine, note/chord playback.
- `pieces.js`: Tetrahex generation, rotation logic.
- `render.js`: SVG rendering for hexes and pieces.
- `chop.js`: Main controller for Chop mode.

## 4. Testing Strategy (TDD)
- **Lattice Logic:** Verify $(p, q) \to \text{MIDI}$ mapping and neighbor calculations.
- **Piece Geometry:** Verify rotation math and tetrahex connectivity.
- **Collision:** Ensure pieces can only be placed in empty cells.
- **Audio:** Mock Web Audio (if possible) or verify frequency calculations.

## 5. Open Questions & Refinements
- **Palette UI:** Should it be a sidebar or a floating tray? (Default: sidebar).
- **Rotation Key:** Standard Tetris (Up arrow or X/Z)? (Default: X/Z and Up arrow).
- **Pan Limits:** Exact boundaries for the MIDI 0-127 range.
- **Note Labels:** How to handle octaves (e.g., "C3" vs just "C")? (Default: just "C" for cleanliness, maybe "C3" on hover).
