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
// Shared vertical dumbbell-barbell difficulty widget (task #93), factored out because Blast,
// Gravity, and Melody had each hand-duplicated the exact same lit-icon logic and the exact same
// SVG markup. Levels are plain 1-indexed integers -- what a given level MEANS (piece sizes for
// Blast/Gravity, practice-hint density for Melody) stays each mode's own choice, along with how
// many levels it has; only the representation and rendering are shared. Follows this project's
// established factory convention for one shared implementation, several independent instances
// (js/board.js's createBoard(shape), js/file-folder.js's FileFolder.create(config)).
const DifficultyBarbell = {
    // One glyph in one place, instead of hand-tripled across index.html's three barbell blocks.
    _SVG: '<svg class="dumbbell" viewBox="0 0 16 24" aria-hidden="true"><g fill="currentColor"><rect x="3" y="1" width="10" height="3" rx="1"/><rect x="6.5" y="4" width="3" height="4" rx="0.5"/><rect x="7" y="8" width="2" height="8"/><rect x="6.5" y="16" width="3" height="4" rx="0.5"/><rect x="3" y="20" width="10" height="3" rx="1"/></g></svg>',

    // One-time migration for a persisted difficulty read under the old word-based scheme
    // ('easy'/'medium'/'hard'). Same localStorage key, the stored value just moves from a word to
    // a digit -- the next setDifficulty() call re-saves it as a plain digit, so this is
    // self-resolving, not permanent cruft. Only Blast/Gravity persist difficulty; Melody doesn't.
    migrateLevel: function(key, fallback) {
        const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(key);
        if (!raw) return fallback;
        const legacy = { easy: 1, medium: 2, hard: 3 };
        if (legacy[raw]) return legacy[raw];
        const n = parseInt(raw, 10);
        return Number.isInteger(n) && n > 0 ? n : fallback;
    },

    // config: { containerId, levelCount, labels: [{title, ariaLabel}, ...] (levelCount long),
    //           onSelect: (level) => {} }
    create: function(config) {
        return Object.assign(Object.create(DifficultyBarbell._proto), {
            containerId: config.containerId,
            levelCount: config.levelCount,
            labels: config.labels || [],
            onSelect: config.onSelect,
            currentLevel: 1,
        });
    },

    _proto: {
        // Builds the N buttons into the (empty) container -- markup is generated, not hand-tripled
        // in index.html, so a mode choosing a different levelCount needs no HTML edit at all.
        render: function() {
            const container = document.getElementById(this.containerId);
            if (!container) return;
            container.innerHTML = '';
            for (let level = 1; level <= this.levelCount; level++) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'weight-icon';
                btn.dataset.difficulty = String(level);
                const label = this.labels[level - 1] || {};
                if (label.title) btn.title = label.title;
                btn.setAttribute('aria-label', label.ariaLabel || label.title || `Level ${level}`);
                btn.innerHTML = DifficultyBarbell._SVG;
                btn.addEventListener('click', () => this.select(level));
                container.appendChild(btn);
            }
            this.updateLit();
        },

        select: function(level) {
            this.currentLevel = level;
            this.updateLit();
            if (this.onSelect) this.onSelect(level);
        },

        // Programmatic set (e.g. restoring a persisted level on init) -- updates the lit icons
        // without re-firing onSelect, so restoring a saved level doesn't replay its own side
        // effects (re-persisting the value it was just read from).
        setLevel: function(level) {
            this.currentLevel = level;
            this.updateLit();
        },

        updateLit: function() {
            const container = document.getElementById(this.containerId);
            if (!container) return;
            container.querySelectorAll('.weight-icon').forEach((el, i) => {
                el.classList.toggle('lit', i < this.currentLevel);
            });
        },
    },
};
