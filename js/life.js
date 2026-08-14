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

// Life's own file source (js/file-folder.js): the bundled life/ folder plus a local folder --
// the SAME shared remembered folder Melody/Compose use (js/midi-folder.js's MidiFolder), just
// filtered down to .yaml. Auto-loads the first bundled automaton on first visit (Life's own
// long-standing behavior, unlike Melody's reselectable "Random" default).
const LifeFolder = FileFolder.create({
    onlineIndexUrl: './life/index.json',
    bundledPathPrefix: './life/',
    extensionPattern: /\.ya?ml$/i,
    readAs: 'text',
    mimeType: 'text/yaml',
    loadMethod: 'loadAutomatonFromText',
    autoLoadFirstBundled: true,
});

// ============================================================================================
// LifeMode -- the playable mode: load an automaton (rule + initial state + sound spec), draw its
// live cells on the pannable Tonnetz lattice, step generations on a clock, and sound each cell as
// the automaton's sound spec dictates (default: on birth, at its own getMidi(p,q) pitch).
// ============================================================================================
const LifeMode = {
    state: {
        live: new Map(),          // "p,q" -> state (>=1); absent = dead/empty (state 0)
        initial: [],              // [key, state] seed pairs, for reset
        rule: { survival: [], birth: [] },
        multi: null,              // multi-state config {states, table, order} or null for 2-state
        sound: { when: 'born', duration: 0.4, velocity: 80 },
        sounds: null,             // per-state sound specs {state -> spec} (multi-state); null = use `sound`
        tempo: 180,               // generations per minute
        running: false,
        timer: null,
        generation: 0,
        // null until the first draw: viewX/viewY center on the origin (see Render.panView / INV-44);
        // zoom picks the responsive default. Once the player zooms (wheel/pinch, see main.js's
        // applyZoomDelta) it must persist across redraws, not reset to a fixed value.
        viewX: null, viewY: null, zoom: null,
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
        if (typeof LifeFolder !== 'undefined') {
            LifeFolder.setup(this, {
                sourceSelect: 'life-source',
                sourceStatus: 'life-source-status',
                uploadGroup: 'life-upload-group',
            });
        }
    },

    // FileFolder's load contract (js/file-folder.js) for a text-based source: parse and adopt an
    // automaton loaded from the bundled life/ folder, the shared local folder, or a plain local
    // upload (see setupEvents' #life-file-input handler below, which calls this too). `filename` is
    // only used for the upload-fallback's status span -- FileFolder's own dropdown already reflects
    // bundled/folder selections.
    loadAutomatonFromText: function(text, filename) {
        try {
            this.loadAutomaton(Life.parseYaml(text));
            const filenameEl = document.getElementById('life-filename');
            if (filenameEl) filenameEl.textContent = filename || '';
        } catch (err) {
            alert(`Could not read "${filename}" as a Life automaton: ${err.message}`);
        }
    },

    // Adopt a parsed automaton object (from Life.parseYaml or the default). Sound defaults to
    // on-birth when the file omits `sound` (see docs/life-rules.md). Two flavours:
    //   * 2-state (birth/survival rule): `rule`, cells [[p,q],...] all seeded to state 1.
    //   * multi-state (transition table, e.g. beehive): `states`/`transition`/`order`, cells
    //     [[p,q,state],...]. Optional per-state `sounds` (a list of {state, velocity, duration}).
    loadAutomaton: function(a) {
        this.stop();
        this.state.rule = a.rule || { survival: [], birth: [] };
        this.state.sound = a.sound || { when: 'born', duration: 0.4, velocity: 80 };
        this.state.tempo = a.tempo || 180;
        const isMulti = (a.states && a.states > 2) || Array.isArray(a.transition);
        if (isMulti) {
            this.state.multi = {
                states: a.states || (a.transition ? a.transition.length + 1 : 3),
                table: a.transition || [],
                order: String(a.order || '21'),
            };
            this.state.sounds = this._parseSounds(a.sounds);
        } else {
            this.state.multi = null;
            this.state.sounds = null;
        }
        const cells = (a.initial && a.initial.cells) || [];
        // Each seed is [p, q] (2-state -> state 1) or [p, q, state] (multi-state).
        this.state.initial = cells.map((c) => [c[0] + ',' + c[1], c.length > 2 ? c[2] : 1]);
        this.state.live = new Map(this.state.initial);
        this.state.generation = 0;
        if (Render.svg) { this.refreshLattice(); this.updateControls(); }
    },

    // Normalise a `sounds:` list into a {state -> spec} lookup. Absent -> null (fall back to `sound`).
    _parseSounds: function(list) {
        if (!Array.isArray(list) || !list.length) return null;
        const out = {};
        list.forEach((s, i) => {
            const st = (s && s.state != null) ? Number(s.state) : (i + 1);
            out[st] = s || {};
        });
        return out;
    },

    // The sound spec that applies to a cell entering `state` this generation: its per-state entry
    // if the file gave one, otherwise the automaton-wide `sound`.
    soundFor: function(state) {
        if (this.state.sounds && this.state.sounds[state]) return this.state.sounds[state];
        return this.state.sound;
    },

    // The drawn extent of the Tonnetz (what refreshLattice renders). This is NOT a sound gate: a
    // cell sounds wherever it is, on- or off-screen, as long as it's a real cell doing something
    // (INV-46 + #13). Off-screen cells keep living, sound their own true pitch, and are saveable;
    // this bound only governs what's drawn. Wide enough that zooming out to Render.MAX_ZOOM never
    // reveals blank space past the drawn edge (matches Sandbox's own -26..26 default viewport).
    BOUNDS: { minP: -26, maxP: 26, minQ: -26, maxQ: 26 },

    // A far outer safety cap on where cells may LIVE. The math goes on forever, but a running
    // automaton needs some hard bound so an explosive rule can't grow without limit and freeze the
    // tab. Set well beyond the drawn bounds so off-screen gliders travel (and return) freely and
    // saved files may specify cells far outside the drawn Tonnetz.
    HARD_BOUNDS: { minP: -64, maxP: 64, minQ: -64, maxQ: 64 },

    inHardBounds: function(key) { return this._within(key, this.HARD_BOUNDS); }, // living cap
    _within: function(key, b) {
        const parts = key.split(',');
        const p = +parts[0], q = +parts[1];
        return p >= b.minP && p <= b.maxP && q >= b.minQ && q <= b.maxQ;
    },

    refreshLattice: function() {
        Render.drawLattice(this.BOUNDS, {});
        this.state.zoom = this.state.zoom || Render.getResponsiveZoom();
        const v = Render.panView(this.state.viewX, this.state.viewY, this.state.zoom);
        this.state.viewX = v.viewX;
        this.state.viewY = v.viewY;
        this.paintLive();
    },

    // Colour the live cells: .life-alive plus .life-s{state} so each state gets a distinct hue
    // (see injectStateStyles / css/style.css). Clears prior colouring first.
    paintLive: function() {
        if (!Render.svg) return;
        Render.svg.querySelectorAll('polygon.cell.life-alive').forEach((p) => {
            p.classList.remove('life-alive');
            for (let s = 1; s <= 6; s++) p.classList.remove('life-s' + s);
        });
        for (const [key, st] of this.state.live) {
            const parts = key.split(',');
            const poly = Render.svg.querySelector(`polygon.cell:not(.ghost)[data-p="${parts[0]}"][data-q="${parts[1]}"]`);
            if (poly) { poly.classList.add('life-alive'); poly.classList.add('life-s' + st); }
        }
    },

    // Tap a cell to cycle it through its states: empty -> 1 -> 2 -> ... -> (states-1) -> empty.
    // For a 2-state automaton that's the familiar alive/dead toggle; for a multi-state one it's the
    // only way to hand-place cells in states beyond 1. Each newly-nonzero tap sounds the cell's own
    // pitch (the pitch invariant) as composing feedback.
    toggleCell: function(p, q) {
        const key = p + ',' + q;
        const states = this.state.multi ? this.state.multi.states : 2;
        const next = ((this.state.live.get(key) || 0) + 1) % states;
        if (next === 0) this.state.live.delete(key);
        else {
            this.state.live.set(key, next);
            Synth.playNote(Tonnetz.getMidi(p, q), 0, 0.3); // audible feedback while composing
        }
        this.paintLive();
    },

    // Issue #11: a live MIDI keyboard should have SOME effect in every mode. Life's own action is
    // toggling a specific cell, and a pitch exists at multiple (p,q) on the infinite Tonnetz (see
    // Tonnetz.nearestCoordFor), so this toggles whichever one is nearest the current view center --
    // "the one you're probably looking at" -- the same cell pressing that key would mean if you
    // tapped what's on screen. toggleCell already sounds the result, so nothing further to do here.
    handleMidiNote: function(midi) {
        const W = Render.HEX_W, H = 45; // H matches getScreenPos's own fixed row-height constant
        const qNear = Math.round(-(this.state.viewY || 0) / H);
        const pNear = Math.round(((this.state.viewX || 0) - qNear * (W / 2)) / W);
        const { p, q } = Tonnetz.nearestCoordFor(midi, { p: pNear, q: qNear });
        this.toggleCell(p, q);
    },

    // The concrete note duration for a sound spec, resolving the 'generation' keyword against tempo.
    _durationOf: function(spec) {
        if (!spec) return 0.4;
        if (spec.duration === 'generation') return 60 / this.state.tempo;
        return (typeof spec.duration === 'number') ? spec.duration : 0.4;
    },

    // The Synth peak (volume) for a sound spec's `velocity` (0..127). Velocity 80 maps to the
    // Synth's own default peak (0.16); higher/lower scales proportionally, clamped to a sane range.
    // This is how a state may sound at a different VOLUME while keeping the same pitch (invariant).
    _peakOf: function(spec) {
        const v = (spec && typeof spec.velocity === 'number') ? spec.velocity : 80;
        return Math.max(0.02, Math.min(0.32, 0.16 * (v / 80)));
    },

    // Advance one generation. Sound every cell that ENTERS a (nonzero) state this generation --
    // for 2-state that's births; for multi-state that's each head/tail transition. The pitch is
    // ALWAYS the cell's own getMidi(p,q) (project invariant); only timbre/velocity/decay vary by
    // state via the per-state sound spec.
    stepOnce: function() {
        const before = this.state.live;
        const after = this.state.multi
            ? Life.stepStates(before, this.state.multi.table, this.state.multi.order)
            : this._step2(before);
        // The Tonnetz is unbounded, so off-screen cells keep living and evolving -- only drop cells
        // past the far HARD_BOUNDS so an explosive rule can't grow without limit (#13).
        for (const key of [...after.keys()]) {
            if (!this.inHardBounds(key)) after.delete(key);
        }
        if (this.state.sound && this.state.sound.when === 'born') {
            for (const [key, st] of after) {
                // Sound every cell that ENTERS a state -- even off-screen: it's a real cell doing
                // something, and the founding invariant is that real active cells sound, not that
                // only on-screen ones do (#13). We always use the cell's CURRENT position, so a
                // moving pattern never re-sounds a stale note from a cell it has left; and far
                // cells sound their own true (effectively-inaudible) pitch rather than being folded
                // into an audible drone -- the actual bug behind #13, fixed by INV-46, not by
                // silencing off-screen cells.
                if (before.get(key) !== st) { // newly this state
                    const parts = key.split(',');
                    const spec = this.soundFor(st);
                    Synth.playNote(Tonnetz.getMidi(+parts[0], +parts[1]), 0, this._durationOf(spec), this._peakOf(spec));
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

    // One 2-state generation, keeping the board as a Map (all live cells are state 1).
    _step2: function(before) {
        const afterSet = Life.step(new Set(before.keys()), this.state.rule);
        const m = new Map();
        for (const k of afterSet) m.set(k, 1);
        return m;
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
    clear: function() { this.stop(); this.state.live = new Map(); this.state.generation = 0; this.paintLive(); this.updateControls(); },
    reset: function() { this.stop(); this.state.live = new Map(this.state.initial); this.state.generation = 0; this.paintLive(); this.updateControls(); },

    // Serializes the CURRENT automaton -- rule (or multi-state transition table), sound spec(s),
    // tempo, and the LIVE cells right now (not the original seed -- a hand-tapped or mid-evolution
    // pattern the player wants to keep is exactly the point of Save As) -- back into this
    // project's own life/ YAML schema (see docs/life-rules.md). The inverse of parseYaml, but only
    // as much of the format as this schema actually needs: a hand-rolled minimal writer to match
    // parseYaml's own hand-rolled minimal parser, not a generic YAML library either direction.
    toYaml: function(name) {
        const lines = [];
        lines.push(`name: "${String(name).replace(/"/g, '\\"')}"`);
        if (this.state.multi) {
            lines.push(`states: ${this.state.multi.states}`);
            lines.push(`order: "${this.state.multi.order}"`);
            lines.push('transition:');
            this.state.multi.table.forEach((row) => lines.push(`  - [${row.join(', ')}]`));
        } else {
            lines.push('rule:');
            lines.push(`  survival: [${this.state.rule.survival.join(', ')}]`);
            lines.push(`  birth: [${this.state.rule.birth.join(', ')}]`);
        }
        const soundFlow = (s) => {
            const parts = [`when: ${s.when}`, `duration: ${s.duration}`];
            if (s.velocity != null) parts.push(`velocity: ${s.velocity}`);
            return `{ ${parts.join(', ')} }`;
        };
        lines.push(`sound: ${soundFlow(this.state.sound)}`);
        if (this.state.sounds) {
            lines.push('sounds:');
            Object.keys(this.state.sounds).sort().forEach((st) => {
                const spec = this.state.sounds[st] || {};
                const parts = [`state: ${st}`];
                if (spec.velocity != null) parts.push(`velocity: ${spec.velocity}`);
                if (spec.duration != null) parts.push(`duration: ${spec.duration}`);
                lines.push(`  - { ${parts.join(', ')} }`);
            });
        }
        lines.push('initial:');
        lines.push('  cells:');
        for (const [key, st] of this.state.live) {
            const [p, q] = key.split(',').map(Number);
            lines.push(this.state.multi ? `    - [${p}, ${q}, ${st}]` : `    - [${p}, ${q}]`);
        }
        lines.push(`tempo: ${this.state.tempo}`);
        return lines.join('\n') + '\n';
    },

    // "Save As": persist the current automaton to a life/ YAML file -- same icon-button pattern
    // as Compose's own Save (js/compose.js), same remembered-folder-with-download-fallback UX,
    // via LifeFolder (js/file-folder.js) -- the same shared local folder Melody/Compose use,
    // filtered down to .yaml.
    save: async function() {
        if (this.state.live.size === 0) {
            alert('Nothing to save yet -- place or evolve some cells first.');
            return;
        }
        const name = prompt('Save as:', 'my-automaton.yaml');
        if (!name) return;
        const filename = /\.ya?ml$/i.test(name) ? name : `${name}.yaml`;
        const text = this.toYaml(filename.replace(/\.ya?ml$/i, ''));

        if (typeof LifeFolder !== 'undefined') {
            await LifeFolder.saveFileAs(filename, text); // downloads as a plain blob if no folder is set
            return;
        }
        // LifeFolder itself missing entirely (shouldn't happen outside tests) -- last-resort download.
        const blob = new Blob([text], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    },

    setupEvents: function() {
        const svg = Render.svg;
        if (svg) {
            // Tap a cell to toggle it alive/dead; drag to pan (Life is a free-pan mode like
            // Sandbox/Melody/Compose -- see Render.RESTRICTED_MODES -- and wheel/pinch zoom
            // already applied here before drag-to-pan did, which was the actual gap: zoom worked,
            // but there was no way to move the view at all on a mouse-driven desktop). Bound fresh
            // on every init and torn down in cleanup() (#15/#16): `Render.svg` is the ONE <svg>
            // every mode shares, so a listener added via addEventListener -- unlike the
            // `.onmousedown =` property other modes use, which the next mode's own assignment
            // naturally overwrites -- survives both drawLattice's `innerHTML = ''` and a mode
            // switch. Left unremoved, it kept firing on taps made in whatever mode came next,
            // toggling Life's own (now invisible) cells from underneath the player.
            let down = null;   // pointerdown origin -- total distance from here decides tap vs. drag
            let last = null;   // last pointermove position -- per-frame pan delta
            let panning = false;
            this._onPointerDown = (e) => { down = { x: e.clientX, y: e.clientY }; last = down; panning = false; };
            this._onPointerMove = (e) => {
                if (!down) return;
                if (!panning && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) panning = true;
                if (panning) {
                    this.state.viewX -= (e.clientX - last.x);
                    this.state.viewY -= (e.clientY - last.y);
                    const v = Render.panView(this.state.viewX, this.state.viewY, this.state.zoom);
                    this.state.viewX = v.viewX;
                    this.state.viewY = v.viewY;
                }
                last = { x: e.clientX, y: e.clientY };
            };
            this._onPointerUp = (e) => {
                if (!down) return;
                if (!panning && e.target && e.target.hasAttribute && e.target.hasAttribute('data-p')) {
                    this.toggleCell(parseInt(e.target.getAttribute('data-p')), parseInt(e.target.getAttribute('data-q')));
                }
                down = null; last = null; panning = false;
            };
            svg.addEventListener('pointerdown', this._onPointerDown);
            svg.addEventListener('pointermove', this._onPointerMove);
            svg.addEventListener('pointerup', this._onPointerUp);
        }
        const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = () => fn.call(this); };
        bind('life-play-pause', this.togglePlay);
        bind('life-step', this.stepOnce);
        bind('life-clear', this.clear);
        bind('life-reset', this.reset);
        bind('life-save', this.save);

        // Open a LOCAL automaton file -- e.g. one previously written by Save As, or shared by
        // someone else -- distinct from the dropdown above (bundled/remembered-folder tiers,
        // js/file-folder.js). Mirrors Melody/Compose's own upload input exactly (same pattern,
        // different file type: YAML text here via readAsText, not an arrayBuffer). Only shown at
        // all when the folder tier isn't available (see LifeFolder.setup).
        const fileInput = document.getElementById('life-file-input');
        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => this.loadAutomatonFromText(event.target.result, file.name);
                reader.readAsText(file);
            };
        }
    },

    updateControls: function() {
        const pp = document.getElementById('life-play-pause');
        if (pp) { pp.textContent = this.state.running ? '⏸' : '▶'; pp.title = this.state.running ? 'Pause' : 'Play'; }
        const gen = document.getElementById('life-generation');
        if (gen) gen.textContent = this.state.generation;
    },

    // ---- Cross-mode copy/paste (App.copy/App.paste; see js/main.js, docs/invariants.md INV-47) ----
    // Life uses the standard mapping, so its (p,q) are already canonical. Copy flattens state away
    // (just positions); paste makes every cell state 1 (the user can then tap-cycle states).
    copyCells: function() {
        return [...this.state.live.keys()].map((k) => {
            const parts = k.split(',');
            return { p: +parts[0], q: +parts[1] };
        });
    },
    pasteClipboard: function(cells) {
        const midis = [];
        cells.forEach((c) => {
            this.state.live.set(c.p + ',' + c.q, 1);
            midis.push(Tonnetz.getMidi(c.p, c.q));
        });
        this.paintLive();
        this.updateControls();
        if (midis.length) Synth.playChord(midis, false, 0.12, 0.9); // soft confirmation
    },

    cleanup: function() {
        this.stop();
        if (Render.svg && this._onPointerDown) {
            Render.svg.removeEventListener('pointerdown', this._onPointerDown);
            Render.svg.removeEventListener('pointermove', this._onPointerMove);
            Render.svg.removeEventListener('pointerup', this._onPointerUp);
            this._onPointerDown = null;
            this._onPointerMove = null;
            this._onPointerUp = null;
        }
    },
};

if (typeof module !== 'undefined') {
    module.exports = Life;
}
