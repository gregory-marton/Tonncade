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
// undo-stack.js - a plain LIFO stack of inversion closures, shared by Sandbox/Blast/Life (#17).
// Each mode's own mutator pushes a closure that undoes exactly what it just did (not a typed
// entry + a switch-statement inverter elsewhere -- the mutator itself is what knows how to
// invert its own change, so that's where the inversion logic lives). Follows this project's own
// factory convention for "one shared implementation, several independent instances"
// (js/board.js's createBoard(shape), js/file-folder.js's FileFolder.create(config),
// js/difficulty-barbell.js's DifficultyBarbell.create(config)) -- same shape, applied here to a
// per-mode undo history instead of a board or a file source.
const UndoStack = {
    // Capped so a long session can't grow this unboundedly -- matches this project's own
    // established pattern for a capped, amortized-eviction log (Replay.log/Replay.soundLog).
    DEFAULT_LIMIT: 50,

    create: function(limit) {
        return Object.assign(Object.create(UndoStack._proto), {
            _entries: [],
            _limit: limit || UndoStack.DEFAULT_LIMIT,
        });
    },

    _proto: {
        // Call after making a change, with a closure that reverses exactly that change (and
        // nothing else -- no redraw, no other side effects; the caller's own undo() does that
        // once, after invoking whichever closure comes off the stack).
        push: function(invert) {
            this._entries.push(invert);
            if (this._entries.length > this._limit) this._entries.shift();
        },

        // Pops and runs the most recent inversion closure. Returns true if there was one to run
        // (so the caller knows whether a redraw is actually needed), false on an empty stack --
        // undoing with nothing to undo is a silent no-op, not an error.
        undo: function() {
            const invert = this._entries.pop();
            if (!invert) return false;
            invert();
            return true;
        },

        // Called wherever a mode's own "this is a fresh start, not a correction" boundary
        // already exists (Blast's New Game, Life's loading a new automaton) -- undoing PAST that
        // boundary back into a previous game/automaton doesn't mean anything, so the history
        // resets there rather than accumulating across it.
        clear: function() {
            this._entries = [];
        },
    },
};
