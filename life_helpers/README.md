# Tonncade Life Helpers

This directory contains a suite of computational search and simulation tools built to discover **gliders** and **glider guns** for the Tonncade Hexagonal Life engine.

## The Quest for Flyer Guns

The primary goal of this toolset was to synthesize a "flyer gun" (a periodic pattern that continuously emits translating glider patterns) that could be loaded into Tonncade's Life mode to generate continuously evolving musical patterns on the Tonnetz.

### 1. The 3,5/2 Rule (B2/S35)
We initially focused on the classic hexagonal Life variant `3,5/2` (survival on 3 or 5 neighbors, birth on exactly 2). While this rule is rich with oscillators (like *Grem's Theme One*), our computational searches revealed a major roadblock for gun construction:
- **Exhaustive Search (`find_gliders.js`)**: Tested every possible connected pattern up to size 6. **Result: 0 gliders.**
- **Random Soup Search (`find_gliders_large.js`)**: Sampled thousands of random patterns up to size 12. **Result: 0 gliders.**

Without small-to-medium gliders to act as the emitted "flyers," building a glider gun in 3,5/2 is practically impossible (barring the existence of massive, undiscovered macroscopic spaceships). 

### 2. Engineering the Ortho2/S2 Rule
To overcome the lack of gliders in count-based rules, we leveraged Tonncade's **isotropy-aware rule language**. Using `design_rule.js` and `engineer_glider.js`, we engineered a custom rule designed specifically to favor directional propagation:
- **Rule**: `Ortho2/S2` (Birth on exactly 2 neighbors in an *ortho* adjacent-pair arrangement; survive on exactly 2).
- **Result**: Massive success. The rule supports 63 distinct small gliders and hundreds of oscillators. 
- **Guns**: Using `build_gun_v2.js`, we collided gliders and ran random soup searches to discover dozens of periodic guns. We successfully extracted 5 distinct 6-cell period-3 guns (`Ortho Gun Alpha`, `Epsilon`, `Zeta`, `Eta`, and `Kappa`).

### 3. The 3-State Beehive Rule
To satisfy the request for guns in more than one rule system, we also explored the known 3-state "Beehive" rule, which already had a confirmed 5-cell glider.
- **Search**: We ran extensive random soup searches (`beehive_gun.js`) looking for configurations that naturally emit separating components.
- **Result**: We discovered a highly active "puffer/gun" pattern that continuously sheds 5-cell beehive gliders. It was verified with `verify_beehive.js` and added as `Beehive Gun`.

## Script Overview

### Core Library
* **`simulate.js`**: Core Hex Life simulation library wrapping the Tonncade Life engine. Includes utilities for bounding boxes, connected components, canonicalization (to account for D6 hexagonal symmetry), and pattern classification (still life, oscillator, spaceship).

### Search & Discovery
* **`find_gliders.js`**: Exhaustive multi-rule glider search for sizes ≤ 6.
* **`find_gliders_large.js`**: Random sampling glider search for sizes 7–12.
* **`design_rule.js`**: Tests custom isotropy-aware rule candidates to find ones that support small gliders.
* **`engineer_glider.js` & `engineer_glider_v2.js`**: Reverse-engineering scripts. They take a desired small glider shape and mathematically deduce the birth/survival counts and isotropy requirements needed to make it translate.

### Gun Construction
* **`build_gun.js`**: Constructs guns by intentionally colliding known gliders with known oscillators.
* **`build_gun_v2.js`**: A more targeted search that looks for continuous component separation (glider shedding) from random clusters and glider-glider collisions.
* **`beehive_gun.js`**: Soup search specifically tuned for the 3-state Beehive rule to find patterns that emit the known Beehive glider.

### Verification & Output
* **`verify_guns.js`**: Detailed verification of `Ortho2/S2` gun candidates. Proves period and emission counts, then generates the `.yaml` output files.
* **`verify_beehive.js`**: Verifies the best Beehive gun candidate and generates `beehive-gun.yaml`.
* **`test_guns.js`**: A self-contained test suite that parses the generated YAML files, runs them through the Tonncade engine, and asserts that they emit at least 3 gliders within 30 generations.
