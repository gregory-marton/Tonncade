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
 * life.js - Life Mode: cellular automata on the Tonnetz lattice, driven by YAML automaton files
 * (each file carries both a rule and a starting state). The goal is to explore which automata make
 * pretty music on the Tonnetz. See docs/life-rules.md for the rule language.
 *
 * This file is being built bottom-up. Landed so far: the neighbour geometry and the isotropy
 * classifier -- the pure core the rule evaluator keys on. The evaluator, YAML loader, mode UI and
 * sound come next.
 */

const Life = {
    // The 6 adjacent hexes -- the "consonant ring" -- in cyclic order around the hexagon. These
    // are the neighbours `count` and `isotropy` see. Intervals via getMidi(p,q)=60+7p+3q.
    RING: [
        { name: 'fifth_up',         dp: 1,  dq: 0 },   // +7  (P5)
        { name: 'major_third_up',   dp: 1,  dq: -1 },  // +4  (M3)
        { name: 'minor_third_down', dp: 0,  dq: -1 },  // -3  (m3)
        { name: 'fifth_down',       dp: -1, dq: 0 },   // -7  (P5)
        { name: 'major_third_down', dp: -1, dq: 1 },   // -4  (M3)
        { name: 'minor_third_up',   dp: 0,  dq: 1 },   // +3  (m3)
    ],

    // Non-adjacent but musically important neighbours, each the nearest lattice cell at that exact
    // interval (see docs/life-rules.md). Rules can require/forbid these by name.
    INTERVALS: {
        semitone_up:   { dp: 1,  dq: -2 },  // +1
        semitone_down: { dp: -1, dq: 2 },   // -1
        tone_up:       { dp: -1, dq: 3 },   // +2
        tone_down:     { dp: 1,  dq: -3 },  // -2
        tritone_up:    { dp: 0,  dq: 2 },   // +6
        tritone_down:  { dp: 0,  dq: -2 },  // -6
    },

    // Named canonical arrangements of the live consonant ring (see docs/life-rules.md). The
    // canonical form is the lexicographically-largest rotation/reflection of the 6-bit ring, so a
    // block of leading 1s reads out the familiar shapes.
    ISOTROPY_NAMES: {
        '000000': 'empty',
        '100000': 'single',
        '110000': 'ortho',
        '101000': 'meta',
        '100100': 'para',
        '111000': 'vicinal',
        '111111': 'full',
    },

    // Classify a live consonant ring (array of 6 truthy/falsy in RING slot order) by its orbit
    // under the dihedral group -- i.e. up to rotation AND reflection. Returns the active `count`,
    // the `canonical` bit-string, a `name` (a known arrangement or just the count), and whether the
    // arrangement is `symmetric` (has a reflection axis / achiral) vs `chiral` (its mirror is a
    // DISTINCT arrangement) -- and a reflection of the ring is a musical inversion, so chirality
    // carries harmonic meaning.
    classifyRing: function(ring) {
        const n = 6;
        const bits = [];
        for (let i = 0; i < n; i++) bits.push(ring[i] ? 1 : 0);
        const count = bits.reduce((s, b) => s + b, 0);

        const rotate = (a, r) => a.map((_, i) => a[(i + r) % n]);
        const asStr = (a) => a.join('');

        const rotations = [];
        for (let r = 0; r < n; r++) rotations.push(rotate(bits, r));
        const mirror = bits.slice().reverse();
        const reflections = [];
        for (let r = 0; r < n; r++) reflections.push(rotate(mirror, r));

        // Canonical = the largest string over all 12 dihedral forms (rotations + reflections).
        let canonical = asStr(bits);
        for (const f of rotations.concat(reflections)) {
            const s = asStr(f);
            if (s > canonical) canonical = s;
        }

        // Symmetric iff some reflection maps the ring to itself (a reflection axis exists).
        const ringStr = asStr(bits);
        const symmetric = reflections.some((f) => asStr(f) === ringStr);

        const name = this.ISOTROPY_NAMES[canonical] || String(count);
        return { count, canonical, name, symmetric, chiral: !symmetric };
    },

    // The neighbourhood of a cell: which of its named neighbours (the 6 consonant ring slots and
    // the extended interval neighbours) are alive. isAlive(p,q) -> truthy. Returns the ring as a
    // 6-bit array (RING slot order) plus a get(name) for any ring/interval name.
    neighbourhood: function(p, q, isAlive) {
        const named = {};
        const ring = this.RING.map((d) => {
            const on = !!isAlive(p + d.dp, q + d.dq);
            named[d.name] = on;
            return on ? 1 : 0;
        });
        for (const nm in this.INTERVALS) {
            const d = this.INTERVALS[nm];
            named[nm] = !!isAlive(p + d.dp, q + d.dq);
        }
        return { ring: ring, get: (nm) => !!named[nm] };
    },

    // Normalise a birth/survival spec into a list of clauses. A flat list of integers is the
    // shorthand for a single count clause, e.g. `birth: [2]` == `[{ ring_count: [2] }]`.
    _clauses: function(spec) {
        if (!spec) return [];
        if (Array.isArray(spec) && spec.every((x) => typeof x === 'number')) {
            return [{ ring_count: spec }];
        }
        return Array.isArray(spec) ? spec : [spec];
    },

    // Does one clause match this neighbourhood? All present constraints must hold (AND):
    //  - ring_count: the live-ring count is in this set
    //  - isotropy:   the ring's arrangement class (or symmetric/asymmetric) is in this set
    //  - require:    every named neighbour here is alive
    //  - forbid:     every named neighbour here is dead
    _matchesClause: function(clause, nb, cls) {
        if (clause.ring_count && clause.ring_count.indexOf(cls.count) === -1) return false;
        if (clause.isotropy) {
            const meta = cls.symmetric ? 'symmetric' : 'asymmetric';
            if (clause.isotropy.indexOf(cls.name) === -1 && clause.isotropy.indexOf(meta) === -1) {
                return false;
            }
        }
        if (clause.require) {
            for (const nm of clause.require) if (!nb.get(nm)) return false;
        }
        if (clause.forbid) {
            for (const nm of clause.forbid) if (nb.get(nm)) return false;
        }
        return true;
    },

    // The cell's next state: born/survive if ANY clause of the relevant list matches (OR).
    nextState: function(rule, currentlyAlive, nb) {
        const cls = this.classifyRing(nb.ring);
        const clauses = this._clauses(currentlyAlive ? rule.survival : rule.birth);
        return clauses.some((c) => this._matchesClause(c, nb, cls));
    },

    // Every offset a rule can reach from a cell (the ring + the named intervals). The set is
    // closed under negation, so the cells that could be born next are exactly {live + offset}.
    _offsets: function() {
        if (this._offsetCache) return this._offsetCache;
        const offs = this.RING.map((d) => ({ dp: d.dp, dq: d.dq }));
        for (const nm in this.INTERVALS) offs.push({ dp: this.INTERVALS[nm].dp, dq: this.INTERVALS[nm].dq });
        this._offsetCache = offs;
        return offs;
    },

    // One generation. liveSet is a Set of "p,q" keys; returns the next generation as a new Set.
    // Candidates are the live cells plus every cell within a rule-reachable offset of a live cell
    // (i.e. anything whose neighbourhood contains a live cell, so anything that could be born).
    step: function(liveSet, rule) {
        const isAlive = (p, q) => liveSet.has(p + ',' + q);
        const candidates = new Set(liveSet);
        const offs = this._offsets();
        for (const key of liveSet) {
            const parts = key.split(',');
            const p = +parts[0], q = +parts[1];
            for (const d of offs) candidates.add((p + d.dp) + ',' + (q + d.dq));
        }
        const next = new Set();
        for (const key of candidates) {
            const parts = key.split(',');
            const p = +parts[0], q = +parts[1];
            const nb = this.neighbourhood(p, q, isAlive);
            if (this.nextState(rule, isAlive(p, q), nb)) next.add(key);
        }
        return next;
    },

    // ---- Multi-state automata (e.g. Wuensche's 3-state "beehive" rule) -------------------------
    // A cell has a state 0..N-1 (0 = empty). Its next state is looked up in a transition table by
    // the COUNTS of its 6 ring-neighbours in each nonzero state (the cell's own state is ignored).
    // For a 3-state rule the table is a matrix indexed by (count of state 2, count of state 1) --
    // but sources differ on that index order, so `order` selects it ('21' = table[c2][c1], '12' =
    // table[c1][c2]). Board is a Map "p,q" -> state (>=1); absent = state 0.

    stepStates: function(stateMap, table, order) {
        const stateAt = (p, q) => stateMap.get(p + ',' + q) || 0;
        const candidates = new Set();
        for (const key of stateMap.keys()) {
            candidates.add(key);
            const parts = key.split(','); const p = +parts[0], q = +parts[1];
            for (const d of this.RING) candidates.add((p + d.dp) + ',' + (q + d.dq));
        }
        const next = new Map();
        for (const key of candidates) {
            const parts = key.split(','); const p = +parts[0], q = +parts[1];
            let c1 = 0, c2 = 0;
            for (const d of this.RING) {
                const s = stateAt(p + d.dp, q + d.dq);
                if (s === 1) c1++; else if (s === 2) c2++;
            }
            const row = (order === '12') ? table[c1] : table[c2];
            const col = (order === '12') ? c2 : c1;
            const ns = (row && col < row.length) ? row[col] : 0;
            if (ns > 0) next.set(key, ns);
        }
        return next;
    },

    // ---- YAML loading -------------------------------------------------------------------------
    // A deliberately small YAML SUBSET parser for automaton files (docs/life-rules.md): block
    // mappings (indent-based), block sequences (`- ...`), flow collections (`[...]` / `{...}`),
    // scalars (numbers, booleans, quoted/bare strings) and `#` comments. Enough for the schema,
    // with no external dependency (keeps the app free-software-clean, no vendored YAML lib).

    parseYaml: function(text) {
        const lines = [];
        for (const raw of String(text).split(/\r?\n/)) {
            const noComment = this._stripComment(raw);
            if (noComment.trim() === '') continue;
            lines.push({ indent: noComment.match(/^ */)[0].length, text: noComment.trim() });
        }
        const state = { lines, i: 0 };
        return this._parseNode(state, 0);
    },

    _parseNode: function(st, minIndent) {
        if (st.i >= st.lines.length || st.lines[st.i].indent < minIndent) return null;
        const indent = st.lines[st.i].indent;
        if (st.lines[st.i].text[0] === '-') {
            const arr = [];
            while (st.i < st.lines.length && st.lines[st.i].indent === indent && st.lines[st.i].text[0] === '-') {
                const after = st.lines[st.i].text.slice(1).trim();
                if (after === '') {
                    st.i++;
                    arr.push(this._parseNode(st, indent + 1));
                } else if (this._isMapEntry(after)) {
                    // `- key: value` starts an inline map; its entries continue on following lines
                    // aligned two columns in (past the "- ").
                    st.lines[st.i] = { indent: indent + 2, text: after };
                    arr.push(this._parseNode(st, indent + 2));
                } else {
                    arr.push(this._scalar(after));
                    st.i++;
                }
            }
            return arr;
        }
        const map = {};
        while (st.i < st.lines.length && st.lines[st.i].indent === indent && st.lines[st.i].text[0] !== '-') {
            const kv = this._splitKey(st.lines[st.i].text);
            if (kv.val === '') {
                st.i++;
                map[kv.key] = this._parseNode(st, indent + 1);
            } else {
                map[kv.key] = this._scalar(kv.val);
                st.i++;
            }
        }
        return map;
    },

    _stripComment: function(line) {
        let inQ = null;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) { if (c === inQ) inQ = null; }
            else if (c === '"' || c === "'") inQ = c;
            else if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return line.slice(0, i);
        }
        return line;
    },

    // Split "key: value" at the first top-level colon (outside brackets/quotes, followed by space
    // or end of line). Returns { key, val }; val is '' when the value is a nested block below.
    _splitKey: function(text) {
        let depth = 0, inQ = null;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) { if (c === inQ) inQ = null; continue; }
            if (c === '"' || c === "'") inQ = c;
            else if (c === '[' || c === '{') depth++;
            else if (c === ']' || c === '}') depth--;
            else if (c === ':' && depth === 0 && (i + 1 >= text.length || text[i + 1] === ' ')) {
                return { key: text.slice(0, i).trim(), val: text.slice(i + 1).trim() };
            }
        }
        return { key: text.trim(), val: '' };
    },

    _isMapEntry: function(text) {
        return this._splitKey(text).val !== '' || /:\s*$/.test(text);
    },

    // A block scalar value: a flow collection, a quoted or bare string, a number or a boolean.
    _scalar: function(str) {
        const s = str.trim();
        if (s === '') return null;
        if (s[0] === '[' || s[0] === '{') return this._parseFlow(s);
        if (s[0] === '"' || s[0] === "'") return this._flowQuoted({ s, i: 0 });
        return this._coerce(s);
    },

    _coerce: function(tok) {
        if (tok === 'true') return true;
        if (tok === 'false') return false;
        if (tok === 'null' || tok === '~') return null;
        if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
        return tok;
    },

    // Flow collections: JSON-like [...] / {...} with bare or quoted keys/values.
    _parseFlow: function(s) {
        const ctx = { s: s.trim(), i: 0 };
        return this._flowValue(ctx);
    },
    _flowWs: function(ctx) { while (ctx.i < ctx.s.length && /\s/.test(ctx.s[ctx.i])) ctx.i++; },
    _flowValue: function(ctx) {
        this._flowWs(ctx);
        const c = ctx.s[ctx.i];
        if (c === '[') return this._flowSeq(ctx);
        if (c === '{') return this._flowMap(ctx);
        if (c === '"' || c === "'") return this._flowQuoted(ctx);
        let start = ctx.i;
        while (ctx.i < ctx.s.length && ',]}'.indexOf(ctx.s[ctx.i]) === -1) ctx.i++;
        return this._coerce(ctx.s.slice(start, ctx.i).trim());
    },
    _flowSeq: function(ctx) {
        ctx.i++; const arr = []; this._flowWs(ctx);
        if (ctx.s[ctx.i] === ']') { ctx.i++; return arr; }
        while (ctx.i < ctx.s.length) {
            arr.push(this._flowValue(ctx));
            this._flowWs(ctx);
            if (ctx.s[ctx.i] === ',') { ctx.i++; continue; }
            if (ctx.s[ctx.i] === ']') { ctx.i++; break; }
            break;
        }
        return arr;
    },
    _flowMap: function(ctx) {
        ctx.i++; const map = {}; this._flowWs(ctx);
        if (ctx.s[ctx.i] === '}') { ctx.i++; return map; }
        while (ctx.i < ctx.s.length) {
            this._flowWs(ctx);
            let key;
            if (ctx.s[ctx.i] === '"' || ctx.s[ctx.i] === "'") key = this._flowQuoted(ctx);
            else { let s = ctx.i; while (ctx.i < ctx.s.length && ':,}]'.indexOf(ctx.s[ctx.i]) === -1) ctx.i++; key = ctx.s.slice(s, ctx.i).trim(); }
            this._flowWs(ctx);
            if (ctx.s[ctx.i] === ':') ctx.i++;
            map[key] = this._flowValue(ctx);
            this._flowWs(ctx);
            if (ctx.s[ctx.i] === ',') { ctx.i++; continue; }
            if (ctx.s[ctx.i] === '}') { ctx.i++; break; }
            break;
        }
        return map;
    },
    _flowQuoted: function(ctx) {
        const q = ctx.s[ctx.i]; ctx.i++;
        let start = ctx.i;
        while (ctx.i < ctx.s.length && ctx.s[ctx.i] !== q) ctx.i++;
        const str = ctx.s.slice(start, ctx.i); ctx.i++;
        return str;
    },
};

// ============================================================================================
// LifeMode -- the playable mode: load an automaton (rule + initial state + sound spec), draw its
// live cells on the pannable Tonnetz lattice, step generations on a clock, and sound each cell as
// the automaton's sound spec dictates (default: on birth, at its own getMidi(p,q) pitch).
// ============================================================================================
const LifeMode = {
    state: {
        live: new Set(),          // "p,q" keys of currently-live cells
        initial: [],              // seed cell keys, for reset
        rule: { survival: [], birth: [] },
        sound: { when: 'born', duration: 0.4, velocity: 80 },
        tempo: 180,               // generations per minute
        running: false,
        timer: null,
        generation: 0,
        viewX: null, viewY: null, zoom: 1,
    },

    // The first automaton, used until one is loaded from the life/ folder or a local file. Also
    // the seed shipped as life/3-5-2.yaml -- 3,5/2 (survive on 3 or 5, born on 2), the classic
    // hexagonal variant the user wanted to hear first.
    DEFAULT_AUTOMATON: {
        name: '3,5 / 2',
        rule: { survival: [3, 5], birth: [2] },
        sound: { when: 'born', duration: 0.4, velocity: 80 },
        initial: { cells: [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] },
        tempo: 180,
    },

    init: function() {
        Render.init('tonnetz-svg');
        // Life doesn't use Sandbox's piece carousel or chord guide -- hide them so they don't
        // linger in the sidebar from a previous Sandbox session.
        const palette = document.getElementById('palette');
        if (palette) { palette.style.display = 'none'; palette.classList.remove('floating-queue'); }
        const guide = document.getElementById('sandbox-guide');
        if (guide) guide.style.display = 'none';
        if (this.state.live.size === 0 && this.state.initial.length === 0) {
            this.loadAutomaton(this.DEFAULT_AUTOMATON);
        }
        this.refreshLattice();
        this.setupEvents();
        this.updateControls();
        this.loadOnlineFolder();
    },

    // Load an automaton from the online life/ folder (a relative fetch, like Melody's midi/ --
    // works on any http(s) host, simply absent under file:// or offline, where the built-in
    // DEFAULT_AUTOMATON already loaded above stands in). Two sources, no built-in default tier.
    loadOnlineFolder: async function() {
        try {
            const res = await fetch('./life/index.json');
            if (!res.ok) return;
            const index = await res.json();
            if (!Array.isArray(index) || !index.length) return;
            this.onlineIndex = index;
            this.populateSelector();
            if (!this._loadedOnline) {
                await this.loadAutomatonFile(index[0].file);
                this._loadedOnline = true;
            }
        } catch (e) { /* offline / file:// -- keep the built-in default */ }
    },

    // Fill the automaton <select> from the online index (the file-picker for the bundled automata).
    populateSelector: function() {
        const sel = document.getElementById('life-automaton');
        if (!sel || !this.onlineIndex) return;
        sel.innerHTML = '';
        this.onlineIndex.forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.file;
            opt.textContent = a.name;
            sel.appendChild(opt);
        });
        const group = document.getElementById('life-automaton-group');
        if (group) group.style.display = '';
    },

    loadAutomatonFile: async function(file) {
        try {
            const yres = await fetch('./life/' + file);
            if (!yres.ok) return;
            this.loadAutomaton(Life.parseYaml(await yres.text()));
        } catch (e) { /* ignore -- keep whatever is loaded */ }
    },

    // Adopt a parsed automaton object (from Life.parseYaml or the default). Sound defaults to
    // on-birth when the file omits `sound` (see docs/life-rules.md).
    loadAutomaton: function(a) {
        this.stop();
        this.state.rule = a.rule || { survival: [], birth: [] };
        this.state.sound = a.sound || { when: 'born', duration: 0.4, velocity: 80 };
        this.state.tempo = a.tempo || 180;
        const cells = (a.initial && a.initial.cells) || [];
        this.state.initial = cells.map((c) => c[0] + ',' + c[1]);
        this.state.live = new Set(this.state.initial);
        this.state.generation = 0;
        if (Render.svg) { this.refreshLattice(); this.updateControls(); }
    },

    refreshLattice: function() {
        Render.drawLattice({ minP: -15, maxP: 15, minQ: -15, maxQ: 15 }, {});
        this.state.zoom = Render.getResponsiveZoom();
        const v = Render.panView(this.state.viewX, this.state.viewY, this.state.zoom);
        this.state.viewX = v.viewX;
        this.state.viewY = v.viewY;
        this.paintLive();
    },

    // Colour the live cells (a .life-alive class; see css/style.css). Clears prior colouring first.
    paintLive: function() {
        if (!Render.svg) return;
        Render.svg.querySelectorAll('polygon.cell.life-alive').forEach((p) => p.classList.remove('life-alive'));
        for (const key of this.state.live) {
            const parts = key.split(',');
            const poly = Render.svg.querySelector(`polygon.cell:not(.ghost)[data-p="${parts[0]}"][data-q="${parts[1]}"]`);
            if (poly) poly.classList.add('life-alive');
        }
    },

    toggleCell: function(p, q) {
        const key = p + ',' + q;
        if (this.state.live.has(key)) this.state.live.delete(key);
        else {
            this.state.live.add(key);
            Synth.playNote(Tonnetz.getMidi(p, q), 0, 0.3); // audible feedback while composing
        }
        this.paintLive();
    },

    // Advance one generation and sound newly-born cells (the default sound spec).
    stepOnce: function() {
        const before = this.state.live;
        const after = Life.step(before, this.state.rule);
        if (this.state.sound && this.state.sound.when === 'born') {
            const dur = this.state.sound.duration === 'generation'
                ? (60 / this.state.tempo)
                : (typeof this.state.sound.duration === 'number' ? this.state.sound.duration : 0.4);
            for (const key of after) {
                if (!before.has(key)) {
                    const parts = key.split(',');
                    Synth.playNote(Tonnetz.getMidi(+parts[0], +parts[1]), 0, dur);
                }
            }
        }
        this.state.live = after;
        this.state.generation++;
        this.paintLive();
        // Nothing left alive -- stop the clock rather than tick a dead board forever.
        if (after.size === 0) this.stop();
        this.updateControls();
    },

    play: function() {
        if (this.state.running) return;
        this.state.running = true;
        this.state.timer = setInterval(() => this.stepOnce(), 60000 / this.state.tempo);
        this.updateControls();
    },
    stop: function() {
        this.state.running = false;
        if (this.state.timer) { clearInterval(this.state.timer); this.state.timer = null; }
        this.updateControls();
    },
    togglePlay: function() { this.state.running ? this.stop() : this.play(); },
    clear: function() { this.stop(); this.state.live = new Set(); this.state.generation = 0; this.paintLive(); this.updateControls(); },
    reset: function() { this.stop(); this.state.live = new Set(this.state.initial); this.state.generation = 0; this.paintLive(); this.updateControls(); },

    setupEvents: function() {
        const svg = Render.svg;
        if (svg && !this._tapBound) {
            // Tap a cell to toggle it alive/dead. (Panning is a later refinement -- the automaton
            // evolves around the origin, which the centred view already shows.)
            let down = null;
            svg.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
            svg.addEventListener('pointerup', (e) => {
                if (!down) return;
                const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
                if (moved <= 6 && e.target && e.target.hasAttribute && e.target.hasAttribute('data-p')) {
                    this.toggleCell(parseInt(e.target.getAttribute('data-p')), parseInt(e.target.getAttribute('data-q')));
                }
                down = null;
            });
            this._tapBound = true;
        }
        const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = () => fn.call(this); };
        bind('life-play-pause', this.togglePlay);
        bind('life-step', this.stepOnce);
        bind('life-clear', this.clear);
        bind('life-reset', this.reset);
        const sel = document.getElementById('life-automaton');
        if (sel) sel.onchange = () => this.loadAutomatonFile(sel.value);
    },

    updateControls: function() {
        const pp = document.getElementById('life-play-pause');
        if (pp) { pp.textContent = this.state.running ? '⏸' : '▶'; pp.title = this.state.running ? 'Pause' : 'Play'; }
        const gen = document.getElementById('life-generation');
        if (gen) gen.textContent = this.state.generation;
    },

    cleanup: function() { this.stop(); },
};

if (typeof module !== 'undefined') {
    module.exports = Life;
}
