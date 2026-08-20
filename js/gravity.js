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
 * gravity.js - Controller for Gravity Mode (falling blocks with slide physics).
 */

const GravityMode = {
    state: {
        nextQueue: [],
        linesCleared: 0,
        isGameOver: false,
        isPaused: false,
        activePiece: null, // Piece type key ('I', 'O', etc.)
        p: 0,
        q: 17,
        rotation: 0,
        dropInterval: 1000, // ms
        timer: null,
        difficulty: DifficultyBarbell.migrateLevel('tonncade_gravity_difficulty', 3),
        nextGroupId: 1, // Every locked piece / pasted cell gets a persistent rigid-group id --
                         // see _assignGroupId and _boardComponents.
    },

    init: function() {
        // Every mode's init must be self-sufficient -- reachable as the FIRST mode of a session
        // (e.g. a #94 deep-link straight here), not only via a click from a mode that already ran
        // Render.init. This used to be missing, relying on Sandbox always running first; a direct
        // deep-link to Gravity crashed drawLattice (Render.svg undefined). Init is idempotent.
        Render.init('tonnetz-svg');

        const pauseBtn = document.getElementById('gravity-start-pause');
        const resetBtn = document.getElementById('gravity-reset');
        
        if (pauseBtn) pauseBtn.onclick = () => this.togglePause();
        if (resetBtn) resetBtn.onclick = () => this.reset();

        // #tonnetz-svg's on-screen box can still be settling the first time refreshBoard() runs
        // here (mobile layout uses `100dvh`, which Chromium can take an extra tick to resolve to
        // its final value) -- refreshBoard()'s aspect-matched fit (see
        // Render.getAspectMatchedRefBox) would otherwise permanently fit against that transient,
        // too-small size, since nothing else re-triggers it once the game is running. A
        // ResizeObserver re-fits whenever the element's actual box changes, for any reason,
        // self-correcting regardless of the specific cause.
        //
        // Observes #game-container, not Render.svg itself (INV-40): fitContentBox sizes Render.svg
        // FROM #game-container's own box, so #game-container is the real upstream signal. Watching
        // Render.svg directly missed real changes whenever fitContentBox's OWN output size
        // happened to be insensitive to the exact container width (a common case: this board's
        // shape is often height-bound, so its fitted size doesn't change even though its centered
        // X-offset should) -- found live via the mobile drawer's open/close animation leaving the
        // board offset stuck mid-transition, never settling back to its pre-open position.
        if (!this._resizeObserver && typeof ResizeObserver !== 'undefined' && Render.svg) {
            this._resizeObserver = new ResizeObserver(() => this.refreshBoard());
            const container = document.getElementById('game-container');
            this._resizeObserver.observe(container || Render.svg);
        }

        // A mode switch pauses -- it never resets (INV-48/#15/#16's sibling for Blast/Gravity).
        // Only the very first entry (no piece has ever spawned) or the player's own Reset button
        // starts a fresh game; returning to Gravity mid-game just repaints exactly where it was
        // left, still paused (cleanup() already stopped the timer on the way out).
        if (!this.state.activePiece) this.reset();
        else this.refreshUI();
        this.setupEvents();
    },

    // Real report (issue #9): the "done" Gravity board stayed on screen after switching to
    // another mode. Root cause was that nothing ever called this -- js/main.js's setMode only
    // ever cleared state.timer inline, leaving the ResizeObserver above watching Render.svg (the
    // one <svg> every mode shares) forever. Since its callback unconditionally repaints Gravity's
    // own viewport + GravityBoard.cells, any LATER layout reflow -- e.g. switching to a mode whose
    // sidebar content is a different size -- fired it again and overwrote the new mode's board
    // with Gravity's stale one. Nulling both the timer and the observer here, matching every
    // other mode's own cleanup(), is what actually stops it for good.
    cleanup: function() {
        // Leaving mid-game pauses (INV-48) -- reflect that in isPaused/the button label too, so
        // returning shows an accurate "Resume" rather than a "Pause" that would actually start it
        // from a dead stop.
        if (this.state.timer) {
            clearInterval(this.state.timer);
            this.state.timer = null;
            this.state.isPaused = true;
            const pauseBtn = document.getElementById('gravity-start-pause');
            if (pauseBtn) pauseBtn.textContent = 'Resume';
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    },

    reset: function() {
        GravityBoard.cells.clear();
        this.state.linesCleared = 0;
        this.state.isGameOver = false;
        this.state.isPaused = false;
        this.state.dropInterval = 1000;
        this.state.nextQueue = [this.randomPiece(), this.randomPiece(), this.randomPiece()];
        
        const pauseBtn = document.getElementById('gravity-start-pause');
        if (pauseBtn) pauseBtn.textContent = 'Pause';

        if (this.state.timer) {
            clearInterval(this.state.timer);
        }
        
        this.spawnPiece();
        this.startTimer();
        this.refreshUI();
    },

    togglePause: function() {
        if (this.state.isGameOver) return;
        
        const pauseBtn = document.getElementById('gravity-start-pause');
        if (this.state.isPaused) {
            this.state.isPaused = false;
            if (pauseBtn) pauseBtn.textContent = 'Pause';
            this.startTimer();
        } else {
            this.state.isPaused = true;
            if (pauseBtn) pauseBtn.textContent = 'Resume';
            if (this.state.timer) clearInterval(this.state.timer);
        }
        this.refreshUI();
    },

    // Level 4 has no entry in the shared Pieces.DIFFICULTY_KEYS (that array is also Blast's, which
    // has no weld concept and stays capped at 3) -- the lookup falls through to TETRAHEX_KEYS,
    // the SAME pool level 3 already uses, since level 4 is only about welding (see setDifficulty),
    // not piece size.
    randomPiece: function() {
        const keys = Pieces.DIFFICULTY_KEYS[this.state.difficulty - 1] || Pieces.TETRAHEX_KEYS;
        return keys[Math.floor(Math.random() * keys.length)];
    },

    // Piece-size difficulty level (task #39): 1=small pieces .. 3=tetrahexes only. Level 4 (#93
    // follow-up) keeps level 3's piece pool but turns off settleFloatingCellsStep's rest-time weld
    // -- Gravity-only, so bounded at 4 here rather than sharing Blast's own DIFFICULTY_KEYS.length
    // bound. Persisted, and reflected in the shared DifficultyBarbell control.
    setDifficulty: function(level) {
        if (level < 1 || level > 4) return;
        this.state.difficulty = level;
        try { localStorage.setItem('tonncade_gravity_difficulty', String(level)); } catch (e) {}
        this._difficultyBarbell.setLevel(level);
    },

    spawnPiece: function() {
        this.state.activePiece = this.state.nextQueue.shift();
        this.state.nextQueue.push(this.randomPiece());
        
        // Spawn at height 17 (q = 17), centered column index (col = 0)
        // Since col = p + floor(q/2) => 0 = p + 8 => p = -8
        this.state.p = -8;
        this.state.q = 17;
        this.state.rotation = 0;

        // Check if spawn position is blocked (using active placement with wider bounds)
        if (!GravityBoard.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, this.state.rotation)) {
            this.state.isGameOver = true;
            if (this.state.timer) clearInterval(this.state.timer);
            setTimeout(() => alert("Game Over! Lines cleared: " + this.state.linesCleared), 100);
        } else {
            this.playActivePieceSound(0.08, 0.4); // soft sound on spawn
        }
    },

    startTimer: function() {
        if (this.state.timer) clearInterval(this.state.timer);
        this.state.timer = setInterval(() => this.tick(), this.state.dropInterval);
    },

    updateSpeed: function() {
        // Logarithmic decay from 1000ms toward a 100ms floor, not linear -- requested live: linear
        // (20ms/line) hit the floor by line 45, too soon. Log decay front-loads the speedup (still
        // feels snappy in the first ~20 lines) but takes roughly 4x as many lines (~200) to
        // actually bottom out, so the late game keeps getting incrementally harder for much longer.
        this.state.dropInterval = Math.max(100, Math.round(1000 - 170 * Math.log(1 + this.state.linesCleared)));
        this.startTimer();
    },

    tick: function() {
        if (typeof Replay !== 'undefined') Replay.recordTick();
        if (this.state.isGameOver || this.state.isPaused) return;

        // Any pasted (or otherwise loose) pile debris falls one row this tick too -- same cadence
        // as the active piece, so nothing moves without the player seeing/hearing it. Runs
        // alongside the active piece's own step below, not instead of it: there's no reason
        // debris settling elsewhere on the board should freeze the piece the player is actively
        // steering.
        if (this.settleFloatingCellsStep()) this.refreshUI();

        // A row completed by debris settling (not just by the active piece locking) is caught
        // here, every tick -- nothing special about HOW a row got completed, only whether it's
        // full. And what happens above a cleared row is likewise nothing special: clearing just
        // deletes the row; whatever was above is now floating and falls via the SAME
        // settleFloatingCellsStep on the next tick, one row at a time, not a separate instant
        // shift.
        if (this.checkForClears()) this.refreshUI();

        const down = this.getDown(this.state.p, this.state.q);
        
        // 1. Try to move straight down
        if (GravityBoard.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
            this.state.p = down.p;
            this.state.q = down.q;
            this.playActivePieceSound(0.06, 0.3); // tick sound
            this.refreshUI();
        } else {
            // 2. Straight down path is blocked. Slide down diagonally as a rigid body:
            // If q is odd, straight down was DL (p, q-1), so alternative is DR (p+1, q-1)
            // If q is even, straight down was DR (p+1, q-1), so alternative is DL (p, q-1)
            let slidePos;
            if (this.state.q % 2 !== 0) {
                slidePos = { p: this.state.p + 1, q: this.state.q - 1 };
            } else {
                slidePos = { p: this.state.p, q: this.state.q - 1 };
            }

            if (GravityBoard.checkActivePlacement(this.state.activePiece, slidePos.p, slidePos.q, this.state.rotation)) {
                this.state.p = slidePos.p;
                this.state.q = slidePos.q;
                this.playActivePieceSound(0.06, 0.3);
                this.refreshUI();
            } else {
                // Both blocked: lock the piece in place rigidly
                this.lockActivePiece();
            }
        }
    },

    lockActivePiece: function() {
        const cells = Pieces.getAbsoluteCells(this.state.activePiece, this.state.p, this.state.q, this.state.rotation);
        GravityBoard.fillCells(cells, this.state.activePiece, Pieces.TYPES[this.state.activePiece].color);

        // checkActivePlacement lets a piece overhang the side wall while steering (a "toe-hold" is
        // enough) -- findFullLines never looks past col -5..4, so an overhanging cell can never be
        // part of a completed row, but it's real board state, not deleted: it can still fall back
        // into bounds later exactly the way it got there, via settleFloatingCellsStep's own
        // canOffset (which has no wall check at all -- see that function's note) -- reported live:
        // a piece overhanging on one side would settle, over several later ticks, diagonally back
        // within the wall and land exactly in a gap only reachable from that angle. An earlier
        // version of this function deleted the overhanging cells immediately at lock time, which
        // silently discarded that recovery path along with the piece's own material -- correctness
        // overkill for a danger (unrelated debris welding to permanent off-grid clutter) that's now
        // handled at its actual root (_assignGroupId's connectivity split), not by never letting
        // anything sit off-grid in the first place.
        //
        // The piece's TRUE anchor is (state.p, state.q) itself -- the absolute position of
        // whichever of its cells has relative offset (0,0) -- not just whichever cell happens to
        // be first in Pieces.TYPES' own cell-list order (see _assignGroupId's own note on why
        // this matters).
        this._assignGroupId(cells, `${this.state.p},${this.state.q}`);

        // Solid placement chord
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        Synth.playChord(midis, true, 0.16, 1.2);

        // Checked immediately, not deferred to the next scheduled tick -- reported live, line
        // clearing felt slow specifically because of this gap: tick()'s own checkForClears() call
        // runs BEFORE the active piece's movement/lock step, so a row THIS lock just completed
        // used to sit there, visibly full, for up to one whole dropInterval (as slow as 1000ms at
        // the start of a game) before clearing. Debris-triggered completions (settleFloatingCellsStep)
        // don't have this gap -- tick() already checks right after settling, same tick -- so this
        // is the one place a completion could go unnoticed until later than it should.
        this.checkForClears();

        if (!this.state.isGameOver) {
            this.spawnPiece();
            this.refreshUI();
        }
    },

    // Clears every currently-complete line: deletes its cells and plays the clear chord, but does
    // NOT shift anything above it -- whatever's now floating over the gap falls via the ordinary
    // per-tick settleFloatingCellsStep (see tick()), exactly like any other loose pile cell, not a
    // special instant cascade. Called every tick, so a row completed by debris settling is caught
    // exactly the same way as one completed by a piece locking. Returns true if anything cleared.
    //
    // findFullLines only checks col -5..4 (a line's own definition never needed the overhang), but
    // clearing sweeps the WHOLE row, off-board cells included -- requested live: "if I clear a
    // line, clear the *whole* line, in or out of the cup." This also fixes a real bug the same
    // conversation surfaced: an overhanging piece's off-board cells are kept (not trimmed, so they
    // can slide back into bounds -- see settleFloatingCellsStep's own note), but if only its
    // IN-BOUNDS cells were part of a completed row, clearing just those could leave the off-board
    // remainder disconnected from whatever it was resting through, with ZERO wall toe-hold of its
    // own -- permanently stuck, since nothing can ever move it back in from there. Sweeping the
    // whole row removes the stuck fragment along with the row it was riding on, the same tick.
    checkForClears: function() {
        const lines = GravityBoard.findFullLines();
        if (lines.length === 0) return false;
        const allNotes = [];
        const affectedGroupIds = new Set();
        lines.forEach((line) => {
            const q = line[0].q;
            const offBoardAtQ = [];
            GravityBoard.cells.forEach((v, key) => {
                const [p, cq] = key.split(',').map(Number);
                if (cq !== q) return;
                const col = p + Math.floor(cq / 2);
                if (col < -5 || col > 4) offBoardAtQ.push({ p, q: cq });
            });
            const fullLine = line.concat(offBoardAtQ);
            fullLine.forEach((c) => {
                allNotes.push(Tonnetz.getMidi(c.p, c.q));
                const v = GravityBoard.cells.get(`${c.p},${c.q}`);
                if (v) affectedGroupIds.add(v.groupId);
            });
            GravityBoard.clearCells(fullLine);
            this.state.linesCleared++;
        });
        this._resplitGroups(affectedGroupIds);
        Synth.playChord([...new Set(allNotes)], false, 0.22, 1.5);
        this.updateSpeed();
        return true;
    },

    getDown: function(p, q) {
        if (q % 2 !== 0) {
            return { p: p, q: q - 1 };
        } else {
            return { p: p + 1, q: q - 1 };
        }
    },

    hardDrop: function() {
        let p = this.state.p;
        let q = this.state.q;
        let moved = true;

        // Simulate falling path with sliding rules to find landing spot
        while (moved) {
            const down = this.getDown(p, q);
            if (GravityBoard.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
                p = down.p;
                q = down.q;
            } else {
                let slidePos;
                if (q % 2 !== 0) {
                    slidePos = { p: p + 1, q: q - 1 };
                } else {
                    slidePos = { p: p, q: q - 1 };
                }

                if (GravityBoard.checkActivePlacement(this.state.activePiece, slidePos.p, slidePos.q, this.state.rotation)) {
                    p = slidePos.p;
                    q = slidePos.q;
                } else {
                    moved = false;
                }
            }
        }

        this.state.p = p;
        this.state.q = q;
        this.lockActivePiece();
    },

    playActivePieceSound: function(peak = 0.1, dur = 0.8) {
        if (!this.state.activePiece) return;
        const cells = Pieces.getAbsoluteCells(this.state.activePiece, this.state.p, this.state.q, this.state.rotation);
        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
        Synth.playChord(midis, true, peak, dur);
    },

    // ---- Cross-mode copy/paste (App.copy/App.paste; docs/invariants.md INV-47) ----
    // Gravity's mapping is the standard Tonnetz rotated 120deg, so its board cells convert to/from
    // canonical coords via Tonnetz.gravity<->canonical (pitch-preserving). Copy = the pile. Paste =
    // send each canonical cell to its gravity cell and place it iff that cell is in the cup and
    // empty -- so cells outside the cup or overlapping the pile are ignored (per the user's rules).
    // Cells land wherever they land, including mid-air -- paste itself never settles them (a
    // connected piece can legitimately be pasted only PART way in, e.g. clipped by the cup wall
    // under the 120deg rotation, and forcing an all-or-nothing rigid placement would silently
    // refuse a large piece just because it "didn't quite fit"; independent per-cell placement, a
    // "snow of 1x1s," is the least-surprising reading of a paste that partially overlaps the cup).
    // What happens next is exactly what happens to any other pile cell: settleFloatingCellsStep()
    // runs from tick(), so mid-air cells fall one row per tick, visibly and audibly, the same way
    // the active piece does -- never a silent, precomputed jump straight to their resting spot.
    // Gravity is paused while the player is off in another mode pasting (INV-48), so nothing
    // actually falls until they resume; it then falls exactly as if freshly dropped.
    copyCells: function() {
        return [...GravityBoard.cells.keys()].map((k) => {
            const parts = k.split(',');
            return Tonnetz.gravityToCanonical(+parts[0], +parts[1]);
        });
    },
    pasteClipboard: function(cells) {
        const placed = [];
        const midis = [];
        cells.forEach((c) => {
            const g = Tonnetz.canonicalToGravity(c.p, c.q);
            if (GravityBoard.isCellEmpty(g.p, g.q)) {
                placed.push({ p: g.p, q: g.q });
                midis.push(Tonnetz.getMidi(g.p, g.q));
            }
        });
        if (!placed.length) return;
        GravityBoard.fillCells(placed, 'paste', '#6fae9b');
        // Each pasted cell is its OWN independent rigid group (a "snow of 1x1s", per the paste
        // design above) -- never fused with the pile it lands near just because it happens to
        // touch it. See _assignGroupId/_boardComponents.
        placed.forEach((c) => this._assignGroupId([c]));
        this.refreshBoard();
        Synth.playChord(midis, false, 0.12, 0.9); // soft confirmation
    },

    // Stamps `cells` with fresh group ids, one per CONNECTED component within them (BFS over
    // Tonnetz.getNeighbors -- the same 6-direction adjacency Gravity's own getDown/settle logic
    // already uses), never one shared id for the whole input regardless of whether it's actually
    // one contiguous shape. Cells that share a group id always move together as one rigid mass in
    // settleFloatingCellsStep, so this matters whenever a caller's `cells` might not be contiguous
    // -- reported live: a line clear can remove the one cell bridging two parts of an already-
    // settled piece (see _resplitGroups below), leaving two disconnected in-bounds fragments that
    // used to get welded into one group just because they were assigned together, freezing
    // whichever one wasn't itself blocked the instant the OTHER one hit anything. (An earlier,
    // reverted version of lockActivePiece trimmed a piece's off-board overhang before grouping,
    // which could split it the same way -- no longer applies now that overhanging cells are kept,
    // but the underlying connectivity-safety this function provides is still exactly what a
    // resplit needs.)
    //
    // preferredAnchorKey (optional, "p,q"): each resulting component's settleFloatingCellsStep
    // reference cell (see its own note) defaults to comp[0] -- whichever cell happened to be
    // first in `cells`' own order -- but for a just-locked piece that's an ARBITRARY cell, not
    // its true anchor (state.p, state.q), and reported live, that distinction is visible: it
    // determines which of the hex grid's two "straight down" offsets a group uses, so anchoring
    // on the wrong cell can drift the whole shape a column off from where the piece's own anchor
    // would have carried it. Whichever component actually CONTAINS preferredAnchorKey uses it;
    // components that don't (including every component when the preferred cell was itself
    // removed by the clear that triggered a resplit, or absent for a non-piece caller like
    // pasteClipboard) fall back to comp[0] -- there's no "true" anchor to prefer once it's gone,
    // so any consistent pick is the best available.
    // Splits `cells` into arrays of mutually-connected cells (BFS over Tonnetz.getNeighbors --
    // the same 6-direction adjacency Gravity's own getDown/settle logic already uses). Shared by
    // _assignGroupId (which stamps one fresh group id per component) and _resplitGroups (which
    // ALSO needs each component on its own, to check wall toe-hold per fragment rather than across
    // the whole -- possibly still-disconnected -- survivor set).
    _connectedComponents: function(cells) {
        const byKey = new Map(cells.map((c) => [`${c.p},${c.q}`, c]));
        const visited = new Set();
        const components = [];
        for (const start of cells) {
            const startKey = `${start.p},${start.q}`;
            if (visited.has(startKey)) continue;
            const comp = [];
            const stack = [start];
            visited.add(startKey);
            while (stack.length) {
                const cur = stack.pop();
                comp.push(cur);
                for (const n of Tonnetz.getNeighbors(cur.p, cur.q)) {
                    const nk = `${n.p},${n.q}`;
                    const neighbor = byKey.get(nk);
                    if (neighbor && !visited.has(nk)) { visited.add(nk); stack.push(neighbor); }
                }
            }
            components.push(comp);
        }
        return components;
    },

    _assignGroupId: function(cells, preferredAnchorKey) {
        if (cells.length === 0) return;
        this._connectedComponents(cells).forEach((comp) => {
            const gid = this.state.nextGroupId++;
            const preferredIdx = preferredAnchorKey != null
                ? comp.findIndex((c) => `${c.p},${c.q}` === preferredAnchorKey)
                : -1;
            const anchorPos = preferredIdx >= 0 ? preferredIdx : 0;
            comp.forEach((c, i) => {
                const v = GravityBoard.cells.get(`${c.p},${c.q}`);
                if (!v) return;
                v.groupId = gid;
                // Reset explicitly (not just "set true on the chosen index") since a resplit can
                // reuse cells that carried an isAnchor flag from their OLD, now-defunct group.
                v.isAnchor = (i === anchorPos);
            });
        });
    },

    // A line clear can remove the one cell bridging two parts of an already-settled piece --
    // reported live (a real captured play session, not a synthetic repro): the survivors kept
    // the OLD shared groupId even though the clear physically severed them, so a totally
    // disconnected fragment stayed welded to (and blocked by) whatever the OTHER fragment
    // happened to be resting on, freezing debris that no longer had anything in common with it.
    // Re-splits each group that just lost at least one cell -- _assignGroupId's own connectivity
    // split (see above) handles the rest. Groups the clear didn't touch are left alone -- "a line
    // clear shouldn't change already-settled pieces' relative relationship to each other" still
    // holds for every piece the clear didn't gut. Passes through whichever surviving cell was
    // already this group's anchor, so a clear that doesn't happen to remove the anchor itself
    // doesn't lose it -- same reasoning as lockActivePiece's own preferredAnchorKey.
    _resplitGroups: function(groupIds) {
        groupIds.forEach((gid) => {
            const members = [];
            let anchorKey = null;
            GravityBoard.cells.forEach((v, key) => {
                if (v.groupId !== gid) return;
                if (v.isAnchor) anchorKey = key;
                const [p, q] = key.split(',').map(Number);
                members.push({ p, q, key });
            });
            if (members.length === 0) return;
            this._connectedComponents(members).forEach((comp) => {
                const preferredKey = comp.some((c) => c.key === anchorKey) ? anchorKey : null;
                this._assignGroupId(comp, preferredKey);
            });
        });
    },

    // The board's rigid groups, as arrays of {p, q, val}. Reported live: grouping this by fresh
    // geometric adjacency (BFS over Tonnetz.getNeighbors) every tick was the actual bug behind
    // "line clears stop falling" -- any falling debris whose descent merely brushed past an
    // unrelated, already-settled piece got welded to it and froze solid as one mass, since a rigid
    // body can only move as far as its LEAST mobile cell. Real pieces that fell connected should
    // stay connected, and a piece resting on another should be individually blocked by it -- but
    // that's ordinary per-group occupancy collision (see settleFloatingCellsStep's canOffset), not
    // a reason to fuse two originally-separate pieces into one bigger rigid mass. Grouping by the
    // persistent groupId each cell was stamped with at lock/paste time (_assignGroupId) gives
    // exactly that: pieces keep the shape they fell with, forever, and a line clear changes
    // nothing about how already-settled pieces relate to each other -- it only deletes cells.
    //
    // The one deliberate exception: difficulty 1-3 welds a group to whatever it comes to rest
    // touching (_weldIfTouching, called from settleFloatingCellsStep) -- a real merge, not the old
    // fresh-adjacency-every-tick bug, since it only fires once, at the moment a group is BLOCKED
    // from moving further, and the result still splits correctly on a later clear via
    // _resplitGroups the same as any other group. Difficulty 4 skips welding entirely.
    _boardComponents: function() {
        const byGroup = new Map();
        GravityBoard.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            if (!byGroup.has(val.groupId)) byGroup.set(val.groupId, []);
            byGroup.get(val.groupId).push({ p, q, val, key });
        });
        return [...byGroup.values()];
    },

    // Welds `comp` (a group that just settled and is now genuinely blocked from moving further)
    // into one shared group with every DIFFERENT group any of its cells directly touches --
    // requested live: "if you happen to be touching another piece... choose that" (as a rest-time
    // weld, not a fall-time preference, which is the simpler half of that idea to build first).
    // Preserves comp's own anchor (see _assignGroupId) so its established fall direction carries
    // over to the merged mass unchanged; if comp itself was never anchored (shouldn't normally
    // happen -- every group gets one at creation), falls back to _assignGroupId's own comp[0]
    // default. Marks the new merged id (and comp's OLD id, now defunct) as processed in the
    // caller's `processedGroupIds` set, so if the just-absorbed group's own turn hasn't come up
    // yet in this same settleFloatingCellsStep() pass, it's skipped rather than re-processed under
    // its now-stale, incomplete comp array.
    _weldIfTouching: function(comp, processedGroupIds) {
        const ownGroupId = comp[0].val.groupId;
        const touchingGroupIds = new Set();
        comp.forEach((c) => {
            for (const n of Tonnetz.getNeighbors(c.p, c.q)) {
                const nv = GravityBoard.cells.get(`${n.p},${n.q}`);
                if (nv && nv.groupId !== ownGroupId) touchingGroupIds.add(nv.groupId);
            }
        });
        if (touchingGroupIds.size === 0) return;
        const allCells = [];
        GravityBoard.cells.forEach((v, key) => {
            if (v.groupId === ownGroupId || touchingGroupIds.has(v.groupId)) {
                const [p, q] = key.split(',').map(Number);
                allCells.push({ p, q });
            }
        });
        const anchor = comp.find((c) => c.val.isAnchor);
        this._assignGroupId(allCells, anchor ? `${anchor.p},${anchor.q}` : null);
        // allCells[0]'s value object is live -- its groupId now reads whatever _assignGroupId
        // just stamped it with, so this is the actual merged id, not comp's old (now defunct) one.
        if (processedGroupIds && allCells.length) {
            processedGroupIds.add(GravityBoard.cells.get(`${allCells[0].p},${allCells[0].q}`).groupId);
        }
    },

    // Advance every currently-floating connected component of the LOCKED pile by exactly ONE row
    // (called every tick, same cadence AND alongside the active piece's own fall -- see tick();
    // debris settling elsewhere on the board is no reason to freeze the piece being steered). Each
    // component falls as a RIGID mass -- translated by one cell's offset per step (a uniform
    // translation preserves shape; moving cells individually would shear the mass, #6) -- straight
    // down first, then the same diagonal-slide fallback the active piece's own tick() tries if
    // that's blocked, so debris settles exactly as far as a normal falling piece would each tick,
    // nothing special. A component rests when both offsets would take any of its cells below the
    // true floor (q<0, absolute) or onto a cell that isn't its own. Returns true if anything moved,
    // so callers can decide whether to sound/redraw. This used to loop to completion in one silent
    // jump (right after a paste) -- now every fall, pasted or otherwise, is this same one-row-per-
    // tick step, so nothing a player didn't cause moves without them seeing and hearing it happen.
    //
    // canOffset has NO wall check at all, unlike board.js's checkActivePlacement -- the col -5..4
    // boundary only matters for STEERING legality (a player can't park the active piece entirely
    // outside the cup) and for line-clear eligibility (findFullLines only scans col -5..4). Once a
    // piece is locked, resting debris falls on floor and collision alone, in or out of the cup,
    // exactly the same either way -- requested live, after two narrower attempts at this each
    // proved incomplete: first a toe-hold-tolerant version of this same check (an overhanging piece
    // used to freeze the instant it locked, since the ORIGINAL all-cells-in-bounds version was
    // stricter than the rule the same piece just obeyed as an active piece one tick earlier), which
    // fixed pieces that KEPT some in-bounds cell but still left a piece that drifted fully off-board
    // stuck floating (zero cells could ever satisfy "one cell in bounds" again). No wall check at
    // all is both simpler and correct: every piece keeps falling to the floor or a real collision,
    // regardless of column, the same as it always did before any of this -- "let everybody settle."
    //
    // ref MUST be the group's own persistent anchor (_assignGroupId's isAnchor flag), not just
    // "whichever cell happens to be comp[0] this tick" -- reported live, precisely: a 2-tall
    // fragment visibly drifted one column further right than it should have while falling
    // unobstructed. Root cause: the hex grid has two equally valid "straight down" offsets
    // ((p,q-1) or (p+1,q-1)) depending on q's parity, and DIFFERENT cells of the same rigid group
    // can have different parities -- getDown(ref) picks whichever offset matches ref's own q, and
    // applies it to the WHOLE group uniformly (correct rigid translation, given a ref). But
    // GravityBoard.cells is a Map; every move deletes and re-inserts each cell, which can silently
    // reorder which cell iteration encounters FIRST, so an unflagged comp[0] could pick a
    // DIFFERENT reference cell (and therefore a different offset) from one tick to the next even
    // though nothing about the group itself changed -- an unintended, incidental drift, not a
    // deliberate diagonal-slide (that fallback only fires when the primary offset is blocked; this
    // was the primary offset, just computed from the wrong cell). A stable anchor, chosen once at
    // group-creation time and carried forward on the cell's own value object (moved along with it,
    // no separate bookkeeping needed), makes the choice consistent for the group's entire life.
    settleFloatingCellsStep: function() {
        let moved = false;
        const movedMidis = [];
        // A group already welded (or absorbed INTO one) earlier in THIS tick's loop must not be
        // processed again under its own now-stale comp array -- see _weldIfTouching's note.
        const processedGroupIds = new Set();
        for (const comp of this._boardComponents()) {
            const liveGroupId = comp[0].val.groupId;
            if (processedGroupIds.has(liveGroupId)) continue;
            processedGroupIds.add(liveGroupId);

            const ref = comp.find((c) => c.val.isAnchor) || comp[0];
            const selfKeys = new Set(comp.map((c) => c.p + ',' + c.q));
            const canOffset = (dp, dq) => comp.every((c) => {
                const np = c.p + dp, nq = c.q + dq;
                if (nq < 0) return false; // the floor is absolute; there is no wall check at all
                const nk = np + ',' + nq;
                return selfKeys.has(nk) || !GravityBoard.cells.has(nk);
            });

            // Straight down first (getDown's zigzag); if blocked, the SAME diagonal-slide fallback
            // the active piece's own tick() tries -- the hex grid has no true "straight down", only
            // two descending diagonals, and a real falling piece isn't stopped by one being blocked
            // if the other is open. Debris gets the identical fallback so it settles exactly as far
            // as a normal falling piece would, not "anything special."
            const down = this.getDown(ref.p, ref.q);
            let dp = down.p - ref.p, dq = down.q - ref.q;
            if (!canOffset(dp, dq)) {
                const slide = (ref.q % 2 !== 0) ? { p: ref.p + 1, q: ref.q - 1 } : { p: ref.p, q: ref.q - 1 };
                dp = slide.p - ref.p; dq = slide.q - ref.q;
                if (!canOffset(dp, dq)) {
                    // Genuinely at rest -- difficulty 1-3 welds it to whatever it's now resting
                    // against (see _weldIfTouching); difficulty 4 leaves it independent, so pieces
                    // that merely happen to end up touching can keep splitting apart on later
                    // clears instead of fusing into one mass (#93 follow-up, requested live:
                    // "static electricity... you could even imagine this being difficulty-
                    // controlled" -- easy stays tidy, hard embraces the confusing fissures).
                    if (this.state.difficulty <= 3) this._weldIfTouching(comp, processedGroupIds);
                    continue;
                }
            }

            const moves = comp.map((c) => ({ nk: (c.p + dp) + ',' + (c.q + dq), val: GravityBoard.cells.get(c.p + ',' + c.q) }));
            comp.forEach((c) => GravityBoard.cells.delete(c.p + ',' + c.q));
            moves.forEach((m) => {
                GravityBoard.cells.set(m.nk, m.val);
                const [p, q] = m.nk.split(',').map(Number);
                movedMidis.push(Tonnetz.getMidi(p, q));
            });
            moved = true;
        }
        if (moved) Synth.playChord(movedMidis, false, 0.06, 0.3); // same soft tick sound the active piece's own step uses
        return moved;
    },

    refreshUI: function() {
        this.renderNextQueue();

        // #gravity-controls's own text content must be set BEFORE refreshBoard() (which measures
        // its real rendered size via Render.fitContentBox/measureChromeClearance, INV-40) --
        // these used to be populated AFTER refreshBoard(), so the very first fit of a session
        // measured an empty, not-yet-sized panel instead of its true final height, occasionally
        // leaving the board mis-fit until some later, unrelated resize happened to correct it
        // (found live via INV-10 flaking on rapid mode entry).
        const linesEl = document.getElementById('gravity-lines-count');
        if (linesEl) linesEl.textContent = this.state.linesCleared;

        const best = parseInt(localStorage.getItem('tonncade_gravity_best') || '0');
        if (this.state.linesCleared > best) {
            localStorage.setItem('tonncade_gravity_best', this.state.linesCleared.toString());
        }
        const bestVal = Math.max(best, this.state.linesCleared);
        const bestEl = document.getElementById('gravity-best-count');
        if (bestEl) {
            bestEl.textContent = bestVal;
        }
        Render.setStatBar('gravity-lines-fill', this.state.linesCleared, bestVal);

        const speedEl = document.getElementById('gravity-speed-level');
        if (speedEl) speedEl.textContent = (1000 / this.state.dropInterval).toFixed(1) + 'x';

        this.refreshBoard();
    },

    renderNextQueue: function() {
        const list = document.getElementById('piece-list');
        if (!list) return;

        list.innerHTML = '<h3>Next Pieces</h3>';
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

    refreshBoard: function() {
        // Draw 10-wide, 20-high cup background (q from 0 to 19, spawn area up to 19)
        const viewport = { minP: -20, maxP: 10, minQ: -2, maxQ: 20 };
        Render.drawLattice(viewport, { isGravity: true });

        // Render settled cells from Board
        GravityBoard.cells.forEach((val, key) => {
            const [p, q] = key.split(',').map(Number);
            if (q < 20) {
                const hex = Render.createHex(p, q, {
                    fill: val.color,
                    stroke: 'white',
                    strokeWidth: 2,
                    className: 'placed-piece',
                    data: { p, q }
                });
                Render.appendToLattice(hex);
            }
        });

        // Render active falling piece (above-cup cells visible)
        if (this.state.activePiece && !this.state.isGameOver) {
            const cells = Pieces.getAbsoluteCells(this.state.activePiece, this.state.p, this.state.q, this.state.rotation);
            const color = Pieces.TYPES[this.state.activePiece].color;
            cells.forEach(c => {
                const hex = Render.createHex(c.p, c.q, {
                    fill: color,
                    stroke: 'white',
                    strokeWidth: 2,
                    className: 'active-piece'
                });
                Render.appendToLattice(hex);
            });

            // Draw active piece labels
            cells.forEach(c => {
                const midi = Tonnetz.getMidi(c.p, c.q);
                const label = Render.createLabel(c.p, c.q, Tonnetz.getNoteName(midi));
                Render.appendToLattice(label);
                Render.appendToLattice(Render.createOctaveLabel(c.p, c.q, midi));
            });

            // Render ghost projection
            this.updateGhost();
        }

        const cupCells = [];
        for (let q = 0; q < 20; q++) {
            for (let p = -20; p <= 10; p++) {
                const col = p + Math.floor(q / 2);
                if (col < -5 || col > 4) continue;
                cupCells.push({ p, q });
            }
        }
        // The cup is much taller than wide -- fit it against #tonnetz-svg's own actual on-screen
        // aspect ratio (see Render.getAspectMatchedRefBox) rather than the historical fixed 4:3
        // reference box, so it fills the element's real box instead of being letterboxed inside
        // a mismatched shape.
        // Choose the sides-vs-top control layout from the cup's width against the viewport (not
        // orientation) BEFORE measuring chrome, so the two chrome-measurement passes below see the
        // controls in their chosen positions. See Render.updateGravityLayout.
        Render.updateGravityLayout(cupCells);
        Render.updateChromeInsets();
        Render.fitContentBox(cupCells, Render.HEX_R * 2);
        const { refW, refH } = Render.getAspectMatchedRefBox();
        // scale 1.15 (like Snake) rather than 1: the board is a tall grid and its aspect-matched
        // box often can't fill both axes of the container, so scale=1 left the cells noticeably
        // shy of the box on the binding axis, wasting reclaimable space (the user's "make it bigger
        // if there's room"). 1.15 zooms the cells to fill the box while keeping the whole cup
        // visible (verified: no cell clipped -- INV-11/35).
        const fit = Render.getFitView(cupCells, Render.HEX_R * 2, 1.15, refW, refH);
        Render.updateView(fit.viewX, fit.viewY, fit.zoom, refW, refH);
    },

    updateGhost: function() {
        if (!this.state.activePiece || this.state.isGameOver) return;
        
        let ghostQ = this.state.q;
        let ghostP = this.state.p;
        let next = this.getDown(ghostP, ghostQ);
        
        // Trace ghost landing using slide physics path
        let moved = true;
        while (moved) {
            const down = this.getDown(ghostP, ghostQ);
            if (GravityBoard.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
                ghostP = down.p;
                ghostQ = down.q;
            } else {
                let slidePos;
                if (ghostQ % 2 !== 0) {
                    slidePos = { p: ghostP + 1, q: ghostQ - 1 };
                } else {
                    slidePos = { p: ghostP, q: ghostQ - 1 };
                }

                if (GravityBoard.checkActivePlacement(this.state.activePiece, slidePos.p, slidePos.q, this.state.rotation)) {
                    ghostP = slidePos.p;
                    ghostQ = slidePos.q;
                } else {
                    moved = false;
                }
            }
        }

        const cells = Pieces.getAbsoluteCells(this.state.activePiece, ghostP, ghostQ, this.state.rotation);
        const color = Pieces.TYPES[this.state.activePiece].color;
        
        cells.forEach(c => {
            const hex = Render.createHex(c.p, c.q, {
                fill: color,
                className: 'ghost'
            });
            hex.style.pointerEvents = 'none';
            Render.appendToLattice(hex);
        });
    },

    // The 5 actions below (moveLeft/moveRight/softDrop/rotateCW/rotateCCW) are the same 5
    // actions the portrait D-pad exposes (m-btn-left/ccw/action/cw/right) -- named and shared
    // here so both the keyboard handler and MidiInput's note-on routing (see handleMidiNote,
    // issue #11) drive the exact same placement-check-then-mutate-then-sound-then-refresh logic
    // instead of duplicating it.
    moveLeft: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        if (GravityBoard.checkActivePlacement(this.state.activePiece, this.state.p - 1, this.state.q, this.state.rotation)) {
            this.state.p -= 1;
            this.playActivePieceSound(0.06, 0.3);
            this.refreshUI();
        }
    },

    moveRight: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        if (GravityBoard.checkActivePlacement(this.state.activePiece, this.state.p + 1, this.state.q, this.state.rotation)) {
            this.state.p += 1;
            this.playActivePieceSound(0.06, 0.3);
            this.refreshUI();
        }
    },

    softDrop: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        const down = this.getDown(this.state.p, this.state.q);
        if (GravityBoard.checkActivePlacement(this.state.activePiece, down.p, down.q, this.state.rotation)) {
            this.state.p = down.p;
            this.state.q = down.q;
            this.playActivePieceSound(0.06, 0.3);
            this.refreshUI();
        }
    },

    rotateCW: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        const nextRot = (this.state.rotation + 1) % 6;
        if (GravityBoard.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
            this.state.rotation = nextRot;
            this.playActivePieceSound(0.08, 0.4);
            this.refreshUI();
        }
    },

    rotateCCW: function() {
        if (this.state.isPaused || this.state.isGameOver) return;
        const nextRot = (this.state.rotation + 5) % 6;
        if (GravityBoard.checkActivePlacement(this.state.activePiece, this.state.p, this.state.q, nextRot)) {
            this.state.rotation = nextRot;
            this.playActivePieceSound(0.08, 0.4);
            this.refreshUI();
        }
    },

    // Issue #11: a MIDI keyboard's middle C/D/E/F/G (MIDI 60/62/64/65/67) drive the same 5
    // actions as the portrait D-pad, left-to-right, matching the notes' own left-to-right
    // ascending order on a real keyboard -- C=left, D=CCW, E=soft-drop, F=CW, G=right. Regular
    // keyboard/touch controls stay exactly as they were; this is purely an additional input.
    handleMidiNote: function(midi) {
        const action = { 60: 'moveLeft', 62: 'rotateCCW', 64: 'softDrop', 65: 'rotateCW', 67: 'moveRight' }[midi];
        if (action) this[action]();
    },

    setupEvents: function() {
        // Dumbbell-barbell difficulty picker (js/difficulty-barbell.js): click the Nth weight to
        // set the piece-size level.
        this._difficultyBarbell = DifficultyBarbell.create({
            containerId: 'gravity-difficulty',
            levelCount: 4,
            labels: [
                { title: 'Easy — small pieces', ariaLabel: 'Easy' },
                { title: 'Medium', ariaLabel: 'Medium' },
                { title: 'Hard — full four-cell pieces', ariaLabel: 'Hard' },
                { title: 'Chaos — hard pieces, no welding at rest', ariaLabel: 'Chaos' },
            ],
            onSelect: (level) => this.setDifficulty(level),
        });
        this._difficultyBarbell.render();
        this._difficultyBarbell.setLevel(this.state.difficulty);

        window.onkeydown = (e) => {
            const key = e.key.toLowerCase();

            // Allow toggling pause with 'Escape' or 'p' key
            if (e.key === 'Escape' || e.key === 'Esc' || key === 'p') {
                e.preventDefault();
                this.togglePause();
                return;
            }

            if (this.state.isPaused || this.state.isGameOver) return;

            // Prevent default browser scrolling actions on game controls
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key) || e.code === 'Space') {
                e.preventDefault();
            }

            // 1. Move Left/Right (allows half-step columns [-6, 5])
            if (key === 'f' || e.key === 'ArrowLeft') {
                this.moveLeft();
            } else if (key === 'h' || e.key === 'ArrowRight') {
                this.moveRight();
            } else if (key === 'v' || key === 's' || e.key === 'ArrowDown') { // Soft drop
                this.softDrop();
            }

            // 2. Rotate (Space, ArrowUp, or g)
            if (e.code === 'Space') {
                if (e.shiftKey) this.rotateCCW(); else this.rotateCW();
            } else if (key === 'g' && !e.shiftKey || e.key === 'ArrowUp') {
                this.rotateCW();
            } else if (e.key === 'ArrowLeft' && e.shiftKey) { // CCW fallback
                this.rotateCCW();
            }
        };
    }
};
