/*
@licstart  The following is the entire license notice for the
JavaScript code in this file.

Copyright (C) 2026  Gregory Marton

The JavaScript code in this file is free software: you can
redistribute it and/or modify it under the terms of the GNU
General Public License (GNU GPL) as published by the Free Software
Foundation, either version 3 of the License, or (at your option)
any later version.  The code is distributed WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.

As additional permission under GNU GPL version 3 section 7, you
may distribute non-source (e.g., minimized or compacted) forms of
that code without the copy of the GNU GPL normally required by
section 4, provided you include this license notice and a URL
through which recipients can access the Corresponding Source.

@licend  The above is the entire license notice
for the JavaScript code in this file.
*/
/**
 * blast.js - Controller for Blast Mode.
 */

const BlastMode = {
    state: {
        nextQueue: [],
        linesCleared: 0,
        isGameOver: false,
        activePiece: null,
        rotation: 0,
        difficulty: (typeof localStorage !== 'undefined' && localStorage.getItem('tonncade_blast_difficulty')) || 'hard',
        hoverCell: { p: 0, q: 0 },
        lastChordKey: null,     // sorted-pitch signature of the last MIDI chord played
        chordCandidateIndex: 0  // which of that chord's matching placements is currently shown
    },

    init: function() {
        // Every mode's init must be self-sufficient -- reachable as the FIRST mode of a session
        // (e.g. a #94 deep-link straight here), not only via a click from a mode that already ran
        // Render.init. This used to be missing, relying on Sandbox always running first; a direct
        // deep-link to Blast crashed drawLattice (Render.svg undefined). Init is idempotent.
        Render.init('tonnetz-svg');

        // #tonnetz-svg's on-screen box can still be settling the first time refreshBoard() runs
        // here (mobile layout uses `100dvh`, which Chromium can take an extra tick to resolve to
        // its final value) -- refreshBoard()'s aspect-matched fit (see
        // Render.getAspectMatchedRefBox) would otherwise permanently fit against that transient,
        // too-small size, since nothing else re-triggers it once the game is running. A
        // ResizeObserver re-fits whenever the element's actual box changes, for any reason,
        // self-correcting regardless of the specific cause. Unlike Gravity's refreshBoard() (which
        // draws the active piece itself), Blast's refreshBoard() only draws the lattice and locked
        // cells -- the active-piece ghost is a separate updateGhost() step in refreshUI() -- so the
        // observer must call refreshUI(), not refreshBoard() alone, or its first (always-fires-once)
        // callback wipes the ghost via drawLattice() without redrawing it.
        //
        // Observes #game-container, not Render.svg itself (INV-40): fitContentBox sizes Render.svg
        // FROM #game-container's own box, so #game-container is the real upstream signal. Watching
        // Render.svg directly missed real changes whenever fitContentBox's OWN output size
        // happened to be insensitive to the exact container width (a common case: this board's
        // shape is often height-bound, so its fitted size doesn't change even though its centered
        // X-offset should) -- found live via the mobile drawer's open/close animation leaving the
        // board offset stuck mid-transition, never settling back to its pre-open position.
        if (!this._resizeObserver && typeof ResizeObserver !== 'undefined' && Render.svg) {
            this._resizeObserver = new ResizeObserver(() => this.refreshUI());
            const container = document.getElementById('game-container');
            this._resizeObserver.observe(container || Render.svg);
        }

        // A mode switch pauses -- it never resets (INV-48/#15/#16's sibling for Blast/Gravity).
        // Only the very first entry (no piece has ever been dealt) or the player's own Reset
        // button starts a fresh game; returning to Blast mid-game just repaints exactly where it
        // was left.
        if (!this.state.activePiece) this.reset();
        else this.refreshUI();
        this.setupEvents();
    },

    // Same latent bug INV-30 fixed in Gravity (js/gravity.js), found here while working on
    // issue #11's Blast MIDI routing: this ResizeObserver was never disconnected on leaving
    // Blast either, so a later layout reflow in a different mode could repaint Blast's stale
    // board over it. Not yet reported for Blast specifically, but the exact same fix applies.
    cleanup: function() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    },

    // ---- Cross-mode copy/paste (App.copy/App.paste; docs/invariants.md INV-47) ----
    // Blast uses the standard mapping, so its board cells are already canonical. Copy = the locked
    // cells. Paste = place each canonical cell that lands in-bounds and empty; ignore the rest.
    copyCells: function() {
        return [...Board.cells.keys()].map((k) => {
            const parts = k.split(',');
            return { p: +parts[0], q: +parts[1] };
        });
    },
    pasteClipboard: function(cells) {
        const placed = [];
        const midis = [];
        cells.forEach((c) => {
            if (Board.isCellEmpty(c.p, c.q)) {
                placed.push({ p: c.p, q: c.q });
                midis.push(Tonnetz.getMidi(c.p, c.q));
            }
        });
        if (!placed.length) return;
        Board.fillCells(placed, 'paste', '#6fae9b');
        this.refreshBoard();
        Synth.playChord(midis, false, 0.12, 0.9); // soft confirmation
    },

    reset: function() {
        Board.cells.clear();
        this.state.linesCleared = 0;
        this.state.isGameOver = false;
        this.state.nextQueue = [this.randomPiece(), this.randomPiece(), this.randomPiece()];
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        this.refreshUI();
    },

    randomPiece: function() {
        const keys = Pieces.DIFFICULTY_KEYS[this.state.difficulty] || Pieces.TETRAHEX_KEYS;
        return keys[Math.floor(Math.random() * keys.length)];
    },

    // Piece-size difficulty (task #39): easy=small pieces .. hard=tetrahexes only. Persisted, and
    // reflected in the dumbbell-triplet control. Takes effect for pieces dealt from here on.
    setDifficulty: function(diff) {
        if (!Pieces.DIFFICULTY_KEYS[diff]) return;
        this.state.difficulty = diff;
        try { localStorage.setItem('tonncade_blast_difficulty', diff); } catch (e) {}
        this.updateDifficultyUI();
    },

    // Highlight 1/2/3 of the dumbbell icons for easy/medium/hard.
    updateDifficultyUI: function() {
        const order = { easy: 1, medium: 2, hard: 3 };
        const lit = order[this.state.difficulty] || 3;
        document.querySelectorAll('#blast-difficulty .weight-icon').forEach((el, i) => {
            el.classList.toggle('lit', i < lit);
        });
    },

    refreshUI: function() {
        this.renderNextQueue();

        // #blast-stats/the queue's own text content must be set BEFORE refreshBoard() (which
        // measures their real rendered size via Render.fitContentBox/measureChromeClearance,
        // INV-40) -- these used to be populated AFTER refreshBoard(), so the very first fit of a
        // session measured an empty, not-yet-sized "Lines: / Best: " panel instead of its true
        // final height, occasionally leaving the board mis-fit until some later, unrelated
        // resize happened to correct it (found live via INV-10 flaking on rapid mode entry).
        const linesEl = document.getElementById('lines-count');
        if (linesEl) linesEl.textContent = this.state.linesCleared;

        const best = parseInt(localStorage.getItem('tonncade_blast_best') || '0');
        if (this.state.linesCleared > best) {
            localStorage.setItem('tonncade_blast_best', this.state.linesCleared.toString());
        }
        const bestVal = Math.max(best, this.state.linesCleared);
        const bestEl = document.getElementById('blast-best-count');
        if (bestEl) {
            bestEl.textContent = bestVal;
        }
        // Bar-graph fill: lines cleared as a fraction of the best (full bar == a new record).
        Render.setStatBar('blast-lines-fill', this.state.linesCleared, bestVal);

        this.refreshBoard();
        this.updateGhost();
    },

    renderNextQueue: function() {
        const list = document.getElementById('piece-list');
        if (!list) return;

        list.innerHTML = '';

        if (this.state.activePiece) {
            const piece = Pieces.TYPES[this.state.activePiece];
            const div = document.createElement('div');
            div.className = 'piece-item active-item';
            div.title = 'Tap to place (same as swipe down)';
            div.innerHTML = `
                <div class="active-item-arrow">▼</div>
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;
            div.onclick = () => this.placeActiveGhost();
            list.appendChild(div);

            const svg = div.querySelector('.piece-preview');
            SandboxMode.renderPiecePreview(svg, piece.cells, piece.color);
        }

        const heading = document.createElement('h3');
        heading.textContent = 'Next Pieces';
        list.appendChild(heading);

        this.state.nextQueue.forEach((key) => {
            const piece = Pieces.TYPES[key];
            const div = document.createElement('div');
            div.className = 'piece-item next-item';
            div.innerHTML = `
                <svg class="piece-preview"></svg>
                <div class="piece-name">${piece.name}</div>
            `;
            list.appendChild(div);

            const svg = div.querySelector('.piece-preview');
            SandboxMode.renderPiecePreview(svg, piece.cells, piece.color);
        });
    },

    // Places the active piece's current ghost, same as swipe-down — no-op if the ghost's
    // position isn't actually a valid placement.
    placeActiveGhost: function() {
        if (this.state.isGameOver || !this.state.activePiece) return;
        const { p, q } = this.state.hoverCell;
        if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
            this.placePiece(p, q);
        }
    },

    refreshBoard: function() {
        const viewport = { minP: -6, maxP: 6, minQ: -6, maxQ: 6 };
        Render.drawLattice(viewport, { isBlast: true });
        
        // Render placed cells from Board state
        Board.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            const hex = Render.createHex(p, q, {
                fill: val.color,
                stroke: 'white',
                strokeWidth: 2,
                className: 'placed-piece',
                data: { p, q }
            });
            Render.appendToLattice(hex);
        });

        const boardCells = [];
        for (let p = -Board.radius; p <= Board.radius; p++) {
            for (let q = -Board.radius; q <= Board.radius; q++) {
                if (Board.isInBounds(p, q)) boardCells.push({ p, q });
            }
        }
        // Fit the viewBox against the SVG element's actual on-screen aspect ratio rather than the
        // historical fixed 4:3 default (see Render.getAspectMatchedRefBox and #44's Gravity fix),
        // so the board fills the available space instead of leaving letterboxed margins.
        Render.updateChromeInsets();
        Render.fitContentBox(boardCells, Render.HEX_R * 2);
        const { refW, refH } = Render.getAspectMatchedRefBox();
        const fit = Render.getFitView(boardCells, Render.HEX_R * 2, 1.25, refW, refH);
        Render.updateView(fit.viewX, fit.viewY, fit.zoom, refW, refH);
    },

    setupEvents: function() {
        const svg = Render.svg;

        const resetBtn = document.getElementById('blast-reset');
        if (resetBtn) {
            resetBtn.onclick = () => {
                this.reset();
            };
        }

        // Dumbbell-triplet difficulty picker: click the Nth weight to set easy/medium/hard.
        document.querySelectorAll('#blast-difficulty .weight-icon').forEach(el => {
            el.onclick = () => this.setDifficulty(el.dataset.difficulty);
        });
        this.updateDifficultyUI();

        window.onmousemove = (e) => {
            if (this.state.isGameOver) return;
            this.updateGhost(e);
        };

        window.onkeydown = (e) => {
            if (this.state.isGameOver) return;
            
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key) || e.code === 'Space') {
                e.preventDefault();
            }

            const key = e.key.toLowerCase();

            // 1. Navigation (ftyhbv cluster)
            const move = {
                'f': {p:-1, q:0}, 'h': {p:1, q:0},
                'y': {p:0, q:1},  'v': {p:0, q:-1},
                't': {p:-1, q:1}, 'b': {p:1, q:-1}
            }[key];

            if (move) {
                this.state.hoverCell.p += move.p;
                this.state.hoverCell.q += move.q;
                this.updateGhost();
                return;
            }

            // 2. Rotation (Space, Arrows, or g)
            if (e.code === 'Space') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.state.rotation = (this.state.rotation + 5) % 6; // CCW
                } else {
                    this.state.rotation = (this.state.rotation + 1) % 6; // CW
                }
                this.updateGhost();
            } else if ((key === 'g' && !e.shiftKey) || e.key === 'ArrowRight') {
                this.state.rotation = (this.state.rotation + 1) % 6;
                this.updateGhost();
            } else if (e.key === 'ArrowLeft') {
                this.state.rotation = (this.state.rotation + 5) % 6;
                this.updateGhost();
            }

            // 3. Action (Shift-G)
            if (key === 'g' && e.shiftKey) {
                const {p, q} = this.state.hoverCell;
                if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
                    this.placePiece(p, q);
                }
            }
        };

        svg.onmousedown = (e) => {
            if (this.state.isGameOver) return;
            
            const isHex = e.target.tagName.toLowerCase() === 'polygon';
            const p = isHex ? parseInt(e.target.getAttribute('data-p')) : null;
            const q = isHex ? parseInt(e.target.getAttribute('data-q')) : null;

            if (isHex && this.state.activePiece) {
                const isSameCell = this.state.hoverCell.p === p && this.state.hoverCell.q === q;
                
                this.state.hoverCell = { p, q };
                this.updateGhost();

                if (isSameCell) {
                    if (Board.checkPlacement(this.state.activePiece, p, q, this.state.rotation)) {
                        this.placePiece(p, q);
                    }
                }
            }
        };
    },

    // Issue #11: "use chords to place: whichever notes are played in the chord, show them and
    // find a location and orientation that fit. If there is more than one, cycle through the
    // possible ones on each play of the chord. If there are none, just highlight the notes
    // without moving the candidate." Regular keyboard/touch controls are untouched -- this only
    // moves the ghost to a matching spot; committing the placement still goes through however
    // it always has (click the active queue item, swipe down, or the mobile action button).
    // MidiInput buffers near-simultaneous note-ons into one chord before calling this (see
    // js/midi-input.js) -- Sandbox/Melody still get each individual note instantly, since only
    // Blast needs chord grouping at all.
    handleMidiChord: function(midiNotes) {
        if (this.state.isGameOver || !this.state.activePiece) return;
        const chord = [...new Set(midiNotes)];
        if (chord.length === 0) return;

        // Highlight the played notes regardless of whether a placement is found.
        chord.forEach(m => Render.highlightByMidi(m, 400));

        const candidates = this.findChordPlacements(chord);
        const key = chord.slice().sort((a, b) => a - b).join(',');

        if (candidates.length === 0) {
            this.state.lastChordKey = null; // a later repeat of this same (still-unmatched) chord starts fresh, not mid-cycle
            return;
        }

        if (key === this.state.lastChordKey) {
            this.state.chordCandidateIndex = (this.state.chordCandidateIndex + 1) % candidates.length;
        } else {
            this.state.lastChordKey = key;
            this.state.chordCandidateIndex = 0;
        }

        const choice = candidates[this.state.chordCandidateIndex];
        this.state.hoverCell = { p: choice.p, q: choice.q };
        this.state.rotation = choice.rotation;
        this.updateGhost();
    },

    // Every (p, q, rotation) placement of the current active piece whose cells' pitches exactly
    // match `midiNotes` as a set (order-independent -- a chord has no inherent per-cell
    // assignment). A piece can slide along the (Δp,Δq)=(3,-7) lattice direction and keep every
    // cell's pitch unchanged (7*3 + 3*-7 = 0, see Tonnetz.allCoordsFor), so more than one
    // on-board placement can genuinely match the same played chord -- that's what
    // handleMidiChord above cycles through on repeated plays.
    findChordPlacements: function(midiNotes) {
        const type = this.state.activePiece;
        if (!type) return [];
        const chordSet = midiNotes.slice().sort((a, b) => a - b);
        if (chordSet.length !== Pieces.TYPES[type].cells.length) return [];

        const results = [];
        for (let rotation = 0; rotation < 6; rotation++) {
            const relCells = Pieces.getAbsoluteCells(type, 0, 0, rotation);
            const relPitches = relCells.map(c => 7 * c.p + 3 * c.q); // relative to an anchor at (0,0)

            for (const anchorNote of chordSet) {
                // Try `anchorNote` as the pitch landing on relCells[0]; check whether the rest of
                // the shape's relative pitches, shifted by that same anchor, reproduce the WHOLE
                // chord (a valid match must account for every played note, not just one).
                // anchorPitch is the absolute pitch the (0,0)-relative anchor cell itself would
                // need -- i.e. exactly what Tonnetz.getMidi(P,Q) must equal for the real anchor.
                const anchorPitch = anchorNote - relPitches[0];
                const expected = relPitches.map(r => anchorPitch + r).sort((a, b) => a - b);
                const matches = expected.length === chordSet.length && expected.every((v, i) => v === chordSet[i]);
                if (!matches) continue;

                Tonnetz.allCoordsFor(anchorPitch).forEach(coord => {
                    if (Board.checkPlacement(type, coord.p, coord.q, rotation)) {
                        results.push({ p: coord.p, q: coord.q, rotation });
                    }
                });
                break; // this rotation already matched via anchorNote -- no need to try others
            }
        }
        return results;
    },

    updateGhost: function(e) {
        const oldGhosts = document.querySelectorAll('.ghost');
        oldGhosts.forEach(g => g.remove());

        if (this.state.isGameOver || !this.state.activePiece) {
            this._lastGhostSoundKey = null;
            return;
        }

        let p, q;
        if (e && e.target && e.target.getAttribute('data-p')) {
            p = parseInt(e.target.getAttribute('data-p'));
            q = parseInt(e.target.getAttribute('data-q'));
            this.state.hoverCell = {p, q};
        } else {
            p = this.state.hoverCell.p;
            q = this.state.hoverCell.q;
        }

        if (p !== undefined && !isNaN(p) && !isNaN(q)) {
            const cells = Pieces.getAbsoluteCells(this.state.activePiece, p, q, this.state.rotation);
            const canPlace = cells.every(c => Board.isCellEmpty(c.p, c.q));
            const color = canPlace ? Pieces.TYPES[this.state.activePiece].color : '#555555';

            cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: color,
                    className: 'ghost',
                    data: { p: c.p, q: c.q }
                });
                hex.style.pointerEvents = 'none';
                Render.appendToLattice(hex);
            });

            // Every distinct ghost position/orientation sounds its own cells — see
            // SandboxMode.updateGhost for the full rationale. Deduped by (piece, p, q,
            // rotation) so repeated redraws within the same cell don't replay the chord.
            const soundKey = `${this.state.activePiece}|${p}|${q}|${this.state.rotation}`;
            if (this._lastGhostSoundKey !== soundKey) {
                this._lastGhostSoundKey = soundKey;
                const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
                Synth.playChord(midis, true, 0.08, 0.4);
            }
        }
    },

    placePiece: function(p, q) {
        const cells = Pieces.getAbsoluteCells(this.state.activePiece, p, q, this.state.rotation);
        Board.fillCells(cells, this.state.activePiece, Pieces.TYPES[this.state.activePiece].color);
        
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        Synth.playChord(midis);
        
        this.processClears();
        
        // Next piece
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        if (Board.checkGameOver(this.state.activePiece)) {
            this.state.isGameOver = true;
            setTimeout(() => alert(`Game Over! Cannot place piece: ${this.state.activePiece}\nLines cleared: ${this.state.linesCleared}`), 100);
        }
        
        this.refreshUI();
    },

    processClears: function() {
        const lines = Board.findFullLines();
        if (lines.length > 0) {
            const allNotes = [];
            lines.forEach(line => {
                line.forEach(c => allNotes.push(Tonnetz.getMidi(c.p, c.q)));
                Board.clearCells(line);
                this.state.linesCleared++;
            });
            // Simultaneous playback of all cleared notes
            Synth.playChord([...new Set(allNotes)], false);
        }
    }
};
