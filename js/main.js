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
 * main.js - Entry point, mode switching, and touch gesture handling.
 */

const App = {
    currentMode: '',

    // Cross-mode clipboard: a flat list of CANONICAL (standard-mapping) cells {p,q}. Copy/paste
    // preserves true pitch (INV-46) across every mode; each mode translates canonical coords to/from
    // its own at its edge (Gravity via Tonnetz.gravity<->canonical, the rest identity). See
    // docs/invariants.md INV-47.
    clipboard: [],

    // The mode module for the current mode, for routing copy/paste (and future cross-mode ops).
    modeModule: function() {
        return ({
            sandbox: typeof SandboxMode !== 'undefined' ? SandboxMode : null,
            melody: typeof MelodyMode !== 'undefined' ? MelodyMode : null,
            compose: typeof ComposeMode !== 'undefined' ? ComposeMode : null,
            snake: typeof SnakeMode !== 'undefined' ? SnakeMode : null,
            blast: typeof BlastMode !== 'undefined' ? BlastMode : null,
            gravity: typeof GravityMode !== 'undefined' ? GravityMode : null,
            life: typeof LifeMode !== 'undefined' ? LifeMode : null,
        })[this.currentMode] || null;
    },

    // Copy every placed cell of the current mode into the clipboard, as canonical coords.
    copy: function() {
        const m = this.modeModule();
        if (!m || typeof m.copyCells !== 'function') return;
        const cells = m.copyCells() || [];
        // De-dup identical canonical cells so repeated placements don't pile up.
        const seen = new Set();
        this.clipboard = cells.filter((c) => {
            const k = c.p + ',' + c.q;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        this.flashClipboardButton('copy-btn');
        // Also write to the REAL system clipboard, fire-and-forget -- copy's own synchronous
        // behavior (and every existing caller of it) is unaffected either way. Without this,
        // App.clipboard is just this one tab's own JS memory: invisible to a second Tonncade
        // window/tab, so a copy there could never be pasted here. Falls back to the in-memory
        // clipboard alone if the Clipboard API is unavailable or permission is denied (e.g. an
        // insecure context) -- same-tab copy/paste keeps working regardless.
        if (this.clipboard.length && typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(this._formatClipboardText(this.clipboard)).catch(() => {});
        }
    },

    // A short marker identifying OUR clipboard payload among whatever else might be on the
    // system clipboard (plain text from anywhere else, or a previous unrelated copy).
    CLIPBOARD_MARKER: 'TONNCADE_CELLS_V1',

    // Renders a copied cell set as clipboard TEXT: a human-readable line of note names (so
    // pasting into a text editor/chat/etc. shows something legible as music, per the request),
    // followed by the exact machine-readable payload a paste back into Tonncade parses. Note
    // names alone can't round-trip losslessly -- the Tonnetz places the same pitch at many
    // different (p,q) positions (that's the whole point of it), so reconstructing a copied
    // SHAPE (not just its pitch classes) needs the true canonical coordinates, not just names.
    _formatClipboardText: function(cells) {
        const names = cells.map((c) => {
            const midi = Tonnetz.getMidi(c.p, c.q);
            return Tonnetz.getNoteName(midi) + Tonnetz.getOctave(midi);
        });
        const payload = JSON.stringify({ [this.CLIPBOARD_MARKER]: 1, cells });
        return `${names.join(' ')}\n${payload}`;
    },

    // The inverse of _formatClipboardText: finds our JSON payload among the clipboard text (which
    // may carry other content around it, or be entirely unrelated) and returns its cells, or null
    // if this text isn't ours.
    _parseClipboardText: function(text) {
        if (typeof text !== 'string') return null;
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) continue;
            try {
                const obj = JSON.parse(trimmed);
                if (obj && obj[this.CLIPBOARD_MARKER] && Array.isArray(obj.cells)) return obj.cells;
            } catch (e) { /* not JSON, or not ours -- keep looking */ }
        }
        return null;
    },

    // Paste the clipboard into the current mode (each mode applies its own placement rules).
    // Reads App.clipboard -- this tab's own in-memory copy -- directly and synchronously; see
    // pasteFromClipboardOrOS for the real Paste button/Ctrl+V entry point, which first tries to
    // refresh App.clipboard from the real OS clipboard (so paste can pull from a DIFFERENT
    // Tonncade window/tab), then calls this.
    paste: function() {
        const m = this.modeModule();
        if (!m || typeof m.pasteClipboard !== 'function' || !this.clipboard.length) return;
        m.pasteClipboard(this.clipboard);
        this.flashClipboardButton('paste-btn');
    },

    // The real Paste button/Ctrl+V entry point: try the real OS clipboard first (so a copy in
    // ANOTHER Tonncade window/tab can be pasted here), falling back to whatever's already in
    // App.clipboard (this tab's own last copy) if the Clipboard API is unavailable, permission is
    // denied, or the OS clipboard doesn't currently hold Tonncade data.
    pasteFromClipboardOrOS: async function() {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
            try {
                const text = await navigator.clipboard.readText();
                const parsed = this._parseClipboardText(text);
                if (parsed && parsed.length) this.clipboard = parsed;
            } catch (e) { /* permission denied/unavailable -- fall back to App.clipboard as-is */ }
        }
        this.paste();
    },

    flashClipboardButton: function(id) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.style.transform = 'scale(1.35)';
        btn.style.opacity = '1';
        setTimeout(() => { btn.style.transform = ''; btn.style.opacity = ''; }, 180);
    },

    // Sandbox/Blast/Life/Compose each own an UndoStack (#17); Melody/Snake/Gravity don't support
    // undo at all (see docs/invariants.md INV-54) and are simply absent here, so #undo-btn stays
    // disabled in those modes regardless of any mode module's own state.
    undo: function() {
        const m = this.modeModule();
        if (!m || typeof m.undo !== 'function') return;
        m.undo();
    },

    // Keeps the single header #undo-btn (which replaced four separate per-mode buttons, #17) in
    // sync with "is there anything to undo in the CURRENT mode right now" -- called on every mode
    // switch, and (via UndoStack's own push/undo/clear) every time any mode's stack actually
    // changes, so the button never goes stale without needing each of the ~20 individual mutator
    // call sites across sandbox.js/blast.js/life.js/compose.js to remember to poke it themselves.
    refreshUndoButton: function() {
        const btn = document.getElementById('undo-btn');
        if (!btn) return;
        const m = this.modeModule();
        const canUndo = !!(m && m.state && m.state.undoStack && typeof m.undo === 'function' && m.state.undoStack.canUndo());
        btn.disabled = !canUndo;
        btn.style.opacity = canUndo ? '0.6' : '0.25';
        btn.style.cursor = canUndo ? 'pointer' : 'default';
    },

    // Zoomable is exactly pannable: every non-restricted mode has its own free-pan Tonnetz view
    // and gets in-app zoom too (wheel, ctrl+wheel/trackpad pinch, and touch pinch -- see
    // setupZoomGestures/setupTouchGestures). Restricted-board modes (Render.RESTRICTED_MODES --
    // Blast/Gravity/Snake) fit their own fixed board to the screen and silently ignore zoom input
    // entirely -- there's nothing to zoom, by design. Deliberately the SAME predicate
    // Render.getPanBounds uses, not a separately-maintained list, so the two can't drift apart.
    isZoomableMode: function() {
        return typeof Render !== 'undefined' && !Render.RESTRICTED_MODES.includes(this.currentMode);
    },

    // Multiplies the current mode's zoom by `factor` (>1 zooms out, <1 zooms in -- matches
    // Render.updateView's convention where a LARGER zoom means a larger viewBox, i.e. more world
    // visible), clamped to Render.MIN_ZOOM/MAX_ZOOM, then re-pans at the same center so the view
    // doesn't jump. A no-op in a restricted mode.
    applyZoomDelta: function(factor) {
        if (!this.isZoomableMode()) return;
        const m = this.modeModule();
        if (!m || !m.state) return;
        const current = m.state.zoom || Render.getResponsiveZoom();
        const next = Math.min(Render.MAX_ZOOM, Math.max(Render.MIN_ZOOM, current * factor));
        if (next === current) return;
        m.state.zoom = next;
        const v = Render.panView(m.state.viewX, m.state.viewY, next);
        m.state.viewX = v.viewX;
        m.state.viewY = v.viewY;
    },

    // Desktop scroll-wheel zoom. Trackpad pinch and Ctrl+scroll both arrive here as native `wheel`
    // events (browsers synthesize them that way) -- listening for plain wheel too, not just
    // ctrlKey ones, covers a physical scroll-wheel mouse as well, per the reported request.
    // preventDefault only inside an eligible mode, so page/browser zoom and scroll are only ever
    // intercepted where this actually does something -- restricted modes silently fall through to
    // whatever the browser would otherwise do (matches the reported "should silently have no
    // effect").
    setupZoomGestures: function() {
        const container = document.getElementById('game-container');
        if (!container) return;
        container.addEventListener('wheel', (e) => {
            if (!this.isZoomableMode()) return;
            e.preventDefault();
            // A small exponential step per event: smooth under a trackpad's continuous stream of
            // small deltas, and still a sensible single step from one physical wheel notch.
            this.applyZoomDelta(Math.exp(e.deltaY * 0.001));
        }, { passive: false });
    },

    // Ctrl/Cmd+C / Ctrl/Cmd+V / Ctrl/Cmd+Z (desktop) + the header copy/paste/undo buttons (touch).
    // The keyboard path steps aside when the user is editing text or has a real text selection, so
    // normal text copy/paste/undo still works; otherwise it acts on Tonnetz cells.
    setupClipboard: function() {
        const editable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' || el.isContentEditable);
        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const k = e.key.toLowerCase();
            if (k !== 'c' && k !== 'v' && k !== 'z') return;
            if (editable(e.target)) return;
            if (k === 'c' && String(window.getSelection())) return; // real text selection -> let it copy
            e.preventDefault();
            if (k === 'c') this.copy();
            else if (k === 'v') this.pasteFromClipboardOrOS();
            else this.undo();
        });
        const copyBtn = document.getElementById('copy-btn');
        const pasteBtn = document.getElementById('paste-btn');
        const undoBtn = document.getElementById('undo-btn');
        if (copyBtn) copyBtn.onclick = () => this.copy();
        if (pasteBtn) pasteBtn.onclick = () => this.pasteFromClipboardOrOS();
        if (undoBtn) undoBtn.onclick = () => this.undo();
        this.refreshUndoButton();
    },

    init: function() {
        if (typeof Replay !== 'undefined') Replay.init();

        // Migrate localStorage keys from Tonntris to Tonncade to preserve player scores
        const oldKeys = ['tonntris_gravity_best', 'tonntris_midi_best', 'tonntris_puzzle_best', 'tonntris_snake_best'];
        oldKeys.forEach(oldKey => {
            const val = localStorage.getItem(oldKey);
            if (val !== null) {
                const newKey = oldKey.replace('tonntris', 'tonncade');
                localStorage.setItem(newKey, val);
                localStorage.removeItem(oldKey);
            }
        });

        // Migrate the Puzzle Mode -> Blast Mode rename's localStorage key too
        const oldBlastKey = 'tonncade_puzzle_best';
        const blastVal = localStorage.getItem(oldBlastKey);
        if (blastVal !== null) {
            localStorage.setItem('tonncade_blast_best', blastVal);
            localStorage.removeItem(oldBlastKey);
        }

        const options = document.querySelectorAll('.mode-option');
        options.forEach((opt, idx) => {
            opt.onclick = () => this.setMode(opt.getAttribute('data-mode'), idx);
        });
        
        this.setupMobileControls();
        this.setupTouchGestures();
        this.setupZoomGestures();
        this.updateVersionTag();
        this.setupMidiInput();
        this.setupRotateView();
        this.setupClipboard();

        window.addEventListener('resize', () => {
            // setupMobileControls calls updateNotationBar, which re-renders the active mode's
            // Timeline too (see its own comment) -- covers a plain window resize picking up
            // #notation-bar's new width, not just a mode switch.
            this.setupMobileControls();
        });

        // Pannable modes (everything not in Render.RESTRICTED_MODES -- Sandbox/Melody/Compose/Life)
        // refit their aspect-matched viewBox only when redrawn, and -- unlike the restricted modes,
        // which each run their own ResizeObserver on #game-container -- nothing else redraws them
        // on a resize. Without this their viewBox stays matched to the size at mode entry and
        // letterboxes after any resize (see Render.panView / INV-44). A ResizeObserver (not the
        // synchronous window 'resize' event) for the same reason the restricted modes use one: it
        // fires AFTER layout settles, so it measures the final container size rather than a
        // mid-transition one (a real bug on mobile-landscape, where the drawer's own reflow lands
        // a frame after the resize event). Checked against Render.RESTRICTED_MODES rather than a
        // second hardcoded mode list, so a new pannable mode (like Life was) is covered
        // automatically instead of silently missing its resize refit the way Life's own did.
        if (typeof ResizeObserver !== 'undefined') {
            const gc = document.getElementById('game-container');
            if (gc) {
                this._panResizeObserver = new ResizeObserver(() => {
                    if (typeof Render !== 'undefined' && !Render.RESTRICTED_MODES.includes(this.currentMode)) {
                        const refresh = this.modeRefreshFns[this.currentMode];
                        if (refresh) refresh();
                    }
                });
                this._panResizeObserver.observe(gc);
            }
        }

        // Open the mode named in the URL hash (shareable deep-link, e.g. #gravity), defaulting to
        // Sandbox. Also re-route when the hash changes (back/forward or an edited URL).
        this._applyHashRoute();
        window.addEventListener('hashchange', () => this._applyHashRoute());
    },

    // URL <-> mode names. Every mode's internal id already matches its own friendly URL name
    // (Melody's internal id used to be 'midi', a mismatch this table existed to bridge -- see
    // the mode-identifier rename); kept as general infrastructure in case a future mode needs
    // the same split again, but currently has no entries.
    MODE_URL_NAMES: {},
    _modeToUrl: function(mode) { return this.MODE_URL_NAMES[mode] || mode; },
    _urlToMode: function(name) {
        for (const m in this.MODE_URL_NAMES) if (this.MODE_URL_NAMES[m] === name) return m;
        return name;
    },

    // Route to whatever mode the current hash names (stripping an optional leading slash), or
    // Sandbox if it names nothing valid. history.replaceState (in setMode) doesn't fire hashchange,
    // so this never loops.
    _applyHashRoute: function() {
        const name = (location.hash || '').replace(/^#\/?/, '').toLowerCase();
        const mode = this._urlToMode(name);
        const options = [...document.querySelectorAll('.mode-option')];
        const idx = options.findIndex((o) => o.getAttribute('data-mode') === mode);
        if (idx >= 0) this.setMode(mode, idx);
        else this.setMode('sandbox', options.findIndex((o) => o.getAttribute('data-mode') === 'sandbox'));
    },

    setMode: function(mode, idx) {
        if (this.currentMode === mode) return;

        // Picking a mode is "done with the menu" -- same as selecting a piece from the Sandbox
        // chord-guide (js/sandbox.js), the drawer should get out of the way afterward instead of
        // permanently occupying screen space on mobile.
        this.collapseMobileDrawer();

        const stats = document.getElementById('blast-stats');
        const sandboxCtrls = document.getElementById('sandbox-controls');
        const clickAction = document.getElementById('click-action');
        const activePill = document.querySelector('.mode-slider-active');
        const options = document.querySelectorAll('.mode-option');

        // Update active class on options
        options.forEach(opt => opt.classList.remove('active'));
        options[idx].classList.add('active');

        // Slide the active background indicator
        if (activePill) {
            const isLandscape = window.innerWidth <= 950 && window.innerWidth > window.innerHeight;
            if (isLandscape) {
                activePill.style.transform = `translateY(${idx * 100}%)`;
            } else {
                activePill.style.transform = `translateX(${idx * 100}%)`;
            }
        }

        // Clean up global listeners
        window.onkeydown = null;
        window.onmousemove = null;
        if (Render.svg) {
            Render.svg.onmousedown = null;
        }

        if (typeof GravityMode !== 'undefined' && GravityMode.cleanup) {
            GravityMode.cleanup();
        }

        if (typeof BlastMode !== 'undefined' && BlastMode.cleanup) {
            BlastMode.cleanup();
        }

        if (typeof MelodyMode !== 'undefined') {
            MelodyMode.cleanup();
        }

        if (typeof SnakeMode !== 'undefined') {
            SnakeMode.cleanup();
        }

        if (typeof SandboxMode !== 'undefined' && SandboxMode.cleanup) {
            SandboxMode.cleanup();
        }

        if (typeof ComposeMode !== 'undefined' && ComposeMode.cleanup) {
            ComposeMode.cleanup();
        }

        if (typeof LifeMode !== 'undefined' && LifeMode.cleanup) {
            LifeMode.cleanup();
        }

        // Invalidate whichever FileFolder instance (js/file-folder.js) the OUTGOING mode actually
        // owns, so a bundled/folder load still in flight for it never lands after the player has
        // moved elsewhere (#15, #16, generalized from Life-only). Scoped to this.currentMode (the
        // mode we're actually leaving) rather than each mode's own cleanup() -- several modes'
        // cleanup() is reused internally too (e.g. MelodyMode.resetGame() calls it on normal entry,
        // not just on exit), so invalidating from there fires far more often than "really left."
        if ((this.currentMode === 'melody' || this.currentMode === 'compose') && typeof MidiFolder !== 'undefined') {
            MidiFolder.invalidate();
        }
        if (this.currentMode === 'life' && typeof LifeFolder !== 'undefined') {
            LifeFolder.invalidate();
        }

        this.currentMode = mode;

        // Reflect the mode in the address bar so the deep-link is shareable and discoverable
        // (replaceState doesn't fire hashchange, so no re-route loop). Skip if unchanged.
        if (typeof history !== 'undefined' && history.replaceState) {
            const want = '#' + this._modeToUrl(mode);
            if (location.hash !== want) history.replaceState(null, '', want);
        }
        document.getElementById('app').setAttribute('data-mode', mode);

        // Gravity's "down" is fixed in its own falling-piece logic (see Render.getEffectiveRotation),
        // so rotating its view would desync what the player sees from what the game means by
        // "down" -- hide the control there rather than let it silently do nothing.
        const rotateBtn = document.getElementById('rotate-view-btn');
        if (rotateBtn) rotateBtn.style.display = mode === 'gravity' ? 'none' : 'inline';

        // Configure mobile action button text based on active mode. Compose has no
        // selected-piece/"place" concept this button models -- its own Record/Play/Undo/Clear/
        // Save buttons in #compose-controls are the real controls, so this one just stays out
        // of the way (same reasoning as hiding the palette for Compose above).
        const actionBtn = document.getElementById('m-btn-action');
        if (actionBtn) {
            if (mode === 'compose') {
                actionBtn.style.display = 'none';
            } else {
                actionBtn.style.display = 'block';
                if (mode === 'gravity') {
                    actionBtn.textContent = '▼'; // Reused as the soft-drop button in Gravity
                } else {
                    actionBtn.textContent = mode === 'sandbox' ? 'Place / Pick up' : 'Place Piece';
                }
            }
        }

        // Hide/show palette
        const palette = document.getElementById('palette');
        if (palette) {
            palette.style.display = (mode === 'melody' || mode === 'snake' || mode === 'compose') ? 'none' : 'block';
        }

        // Hide/show mobile controls
        const mobileContainer = document.getElementById('mobile-controls');
        if (mobileContainer) {
            const isMobileWidth = Render.isMobileViewport();
            if (isMobileWidth && mode === 'gravity') {
                mobileContainer.style.display = 'flex';
            } else {
                mobileContainer.style.display = 'none';
            }
        }

        // Hide all mode-specific panels first
        stats.style.display = 'none';
        document.getElementById('gravity-controls').style.display = 'none';
        if (document.getElementById('melody-controls')) {
            document.getElementById('melody-controls').style.display = 'none';
        }
        if (document.getElementById('snake-controls')) {
            document.getElementById('snake-controls').style.display = 'none';
        }
        if (document.getElementById('compose-controls')) {
            document.getElementById('compose-controls').style.display = 'none';
        }
        if (document.getElementById('life-controls')) {
            document.getElementById('life-controls').style.display = 'none';
        }
        document.getElementById('placement-controls').style.display = 'none';
        const hexNavControls = document.getElementById('hex-nav-controls');
        if (hexNavControls) hexNavControls.style.display = 'none';
        sandboxCtrls.style.display = 'none';
        const guide = document.getElementById('sandbox-guide');
        if (guide) {
            guide.style.display = 'none';
        }

        // Settles #sidebar/#notation-bar's visibility (and so #game-container's final size)
        // BEFORE the mode's own init() below computes its first zoom/pan fit -- Melody/Compose
        // otherwise fit against the pre-notation-bar layout (sidebar still visible, bar not
        // shown yet), and that fit then persists un-recomputed on every later redraw by design
        // (a real user zoom/pan must survive a redraw), silently wrong forever after. Harmless
        // to call again at the end of setupMobileControls below -- idempotent.
        this.updateNotationBar();

        if (mode === 'sandbox') {
            document.getElementById('placement-controls').style.display = 'block';
            if (hexNavControls) hexNavControls.style.display = 'block';
            sandboxCtrls.style.display = 'block';
            if (guide) guide.style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place/Pick up';
            SandboxMode.init();
        } else if (mode === 'blast') {
            // '' (not 'block'): #blast-stats needs to be a flex row on mobile but a plain block
            // on desktop (see css/style.css), and CSS alone can't express that once JS also owns
            // this same inline property for hide/show -- clearing it lets each breakpoint's own
            // CSS rule apply. Found live: hardcoding either 'block' or 'flex' here needs a CSS
            // !important to win on the OTHER breakpoint, and !important on 'display: flex' also
            // defeats this same inline style's 'none' when hiding the panel in other modes --
            // that's exactly what made all three panels stack visibly on top of each other.
            stats.style.display = '';
            document.getElementById('placement-controls').style.display = 'block';
            if (hexNavControls) hexNavControls.style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place Piece';
            BlastMode.init();
        } else if (mode === 'gravity') {
            document.getElementById('gravity-controls').style.display = '';
            GravityMode.init();
        } else if (mode === 'melody') {
            document.getElementById('melody-controls').style.display = 'block';
            MelodyMode.init();
        } else if (mode === 'snake') {
            document.getElementById('snake-controls').style.display = '';
            SnakeMode.init();
        } else if (mode === 'compose') {
            document.getElementById('compose-controls').style.display = 'block';
            ComposeMode.init();
        } else if (mode === 'life') {
            document.getElementById('life-controls').style.display = 'block';
            LifeMode.init();
        }

        this.setupMobileControls();
        this.refreshUndoButton();
    },

    setupMobileControls: function() {
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const mobileContainer = document.getElementById('mobile-controls');
        
        const isMobileWidth = Render.isMobileViewport();

        if (mobileContainer) {
            if (isMobileWidth && this.currentMode === 'gravity') {
                mobileContainer.style.display = 'flex';
            } else {
                mobileContainer.style.display = 'none';
            }
        }

        const snakeContainer = document.getElementById('snake-mobile-controls');
        if (snakeContainer) {
            if (isMobileWidth && this.currentMode === 'snake') {
                snakeContainer.style.display = 'flex';
            } else {
                snakeContainer.style.display = 'none';
            }
        }

        if (isTouch && mobileContainer && !this.mobileControlsBound) {
            this.mobileControlsBound = true;
            const bindBtn = (id, key, code = '', shiftKey = false) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                
                const trigger = (e) => {
                    e.preventDefault();
                    const event = new KeyboardEvent('keydown', {
                        key: key,
                        code: code,
                        shiftKey: shiftKey,
                        bubbles: true
                    });
                    window.dispatchEvent(event);
                };
                
                btn.ontouchstart = trigger;
                btn.onclick = trigger;
            };

            // GravityMode's Space handler treats `rotation + 1` (no shift) as its default
            // step and `rotation + 5` (shift) as the reverse — but per real screen coordinates
            // (see tests/run_tests.js's "rotation direction" test), +1 is actually
            // counter-clockwise on screen and +5 is actually clockwise. These two bindings were
            // previously swapped, making the ↻/↺ icons rotate backwards from what they show.
            bindBtn('m-btn-ccw', ' ', 'Space', false); // CCW Rotate (Space -> rotation+1, actually CCW)
            bindBtn('m-btn-cw', ' ', 'Space', true);   // CW Rotate (Shift+Space -> rotation+5, actually CW)
            bindBtn('m-btn-left', 'f');                           // Left (f)
            bindBtn('m-btn-right', 'h');                          // Right (h)
            bindBtn('m-btn-action', 'g', '', true);               // Shift-G to place/pick
            bindBtn('m-btn-action-2', 'v');                       // Gravity-only duplicate soft-drop button (landscape clusters only, never shown outside Gravity)

            // Snake's 6-direction pad — matches the T/Y/F/H/V/B keyboard scheme SnakeMode's
            // own keydown handler already listens for.
            bindBtn('snake-btn-ul', 't');
            bindBtn('snake-btn-ur', 'y');
            bindBtn('snake-btn-left', 'f');
            bindBtn('snake-btn-right', 'h');
            bindBtn('snake-btn-dl', 'v');
            bindBtn('snake-btn-dr', 'b');

            // Gravity has no "place" action — reuse this same button/slot as its soft-drop
            // button instead, dispatching 'v' (the key GravityMode's own handler already
            // listens for) whenever the player is in Gravity mode.
            const actionBtnEl = document.getElementById('m-btn-action');
            if (actionBtnEl) {
                const placeTrigger = actionBtnEl.onclick;
                const dispatchTrigger = (e) => {
                    if (this.currentMode === 'gravity') {
                        e.preventDefault();
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
                    } else {
                        placeTrigger(e);
                    }
                };
                actionBtnEl.ontouchstart = dispatchTrigger;
                actionBtnEl.onclick = dispatchTrigger;
            }
        }

        const topDrawer = document.getElementById('top-drawer');
        const menuToggle = document.getElementById('menu-toggle');

        // 'expanded'/'collapsed' are two sides of one state, not independent flags -- setting
        // them via two separate classList.toggle() calls can desync (e.g. the drawer starts
        // with NEITHER class present, so the very first toggle adds both at once instead of
        // just one), landing on "expanded collapsed" simultaneously. Always derive the target
        // from one boolean and set both classes to match it.
        const toggleDrawer = () => {
            const nowExpanded = !topDrawer.classList.contains('expanded');
            topDrawer.classList.toggle('expanded', nowExpanded);
            topDrawer.classList.toggle('collapsed', !nowExpanded);
        };

        if (topDrawer && menuToggle) {
            if (isMobileWidth) {
                // Initialize drawer interactions once
                if (!this.topDrawerInitialized) {
                    this.topDrawerInitialized = true;

                    menuToggle.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleDrawer();
                    });

                    const drawerHandle = document.getElementById('drawer-handle');
                    if (drawerHandle) {
                        let dragStartX = 0;
                        let dragStartY = 0;
                        // A real tap almost always drifts a few pixels, which the touchmove
                        // handler below treats as a drag and toggles the drawer on its own. The
                        // browser then still fires a synthesized click for that same physical
                        // tap — without this flag, click's own unconditional toggle immediately
                        // undoes what the drag just did, making the drawer feel impossible to
                        // close reliably.
                        let toggledByDrag = false;
                        drawerHandle.onclick = () => {
                            if (toggledByDrag) {
                                toggledByDrag = false;
                                return;
                            }
                            toggleDrawer();
                        };
                        drawerHandle.addEventListener('touchstart', (e) => {
                            dragStartX = e.touches[0].clientX;
                            dragStartY = e.touches[0].clientY;
                            toggledByDrag = false;
                        }, { passive: true });
                        drawerHandle.addEventListener('touchmove', (e) => {
                            const dx = e.touches[0].clientX - dragStartX;
                            const dy = e.touches[0].clientY - dragStartY;
                            const isLandscape = window.innerWidth > window.innerHeight;

                            const delta = isLandscape ? dx : dy;

                            if (delta > 20 && !topDrawer.classList.contains('expanded')) {
                                topDrawer.classList.add('expanded');
                                topDrawer.classList.remove('collapsed');
                                toggledByDrag = true;
                            } else if (delta < -20 && topDrawer.classList.contains('expanded')) {
                                topDrawer.classList.remove('expanded');
                                topDrawer.classList.add('collapsed');
                                toggledByDrag = true;
                            }
                        }, { passive: true });
                    }
                    
                    // Prevent clicks inside drawer from passing to grid
                    ['touchstart', 'touchmove', 'touchend', 'click', 'mousedown', 'mousemove', 'mouseup'].forEach(evtType => {
                        topDrawer.addEventListener(evtType, (e) => {
                            e.stopPropagation();
                        }, { passive: false });
                    });
                }
                
                // Set up contents of the drawer depending on mode
                const sandboxTools = document.getElementById('sandbox-mobile-tools');
                const drawerInjected = document.getElementById('drawer-injected-tools');
                const palette = document.getElementById('palette');
                const guide = document.getElementById('sandbox-guide');
                const sidebar = document.getElementById('sidebar');

                if (drawerInjected) drawerInjected.style.display = 'none';

                if (this.currentMode === 'sandbox') {
                    if (sandboxTools) {
                        sandboxTools.style.display = 'flex';
                        if (palette) {
                            palette.style.display = 'block';
                            palette.classList.remove('floating-queue');
                            sandboxTools.appendChild(palette);
                        }
                        // Move just the dropdown + its reset button (not the label/instructions)
                        // into the always-visible area. Moving the whole .control-group (rather
                        // than just the <select>) brings #chord-guide-reset along with it —
                        // previously it stayed behind in #sandbox-guide, which gets hidden below,
                        // orphaning the only way to dismiss/clear the chord guide on mobile.
                        const chordControlGroup = document.querySelector('#sandbox-guide .control-group');
                        const chordResults = document.getElementById('chord-guide-results');
                        if (chordControlGroup && !sandboxTools.contains(chordControlGroup)) {
                            sandboxTools.appendChild(chordControlGroup);
                        }
                        if (chordResults && !sandboxTools.contains(chordResults)) {
                            sandboxTools.appendChild(chordResults);
                        }
                    }
                    // Hide the full guide in the drawer (label + instruction text stay hidden)
                    if (guide) guide.style.display = 'none';
                    if (drawerInjected) drawerInjected.style.display = 'none';
                } else if (this.currentMode === 'blast' || this.currentMode === 'gravity') {
                    if (sandboxTools) sandboxTools.style.display = 'none';
                    // #palette doubles as Blast/Gravity's next-piece queue (their own
                    // renderNextQueue writes into #piece-list) — return it from wherever a
                    // previous mode left it and show it as a floating overlay over the board.
                    if (palette && sidebar && palette.parentElement !== sidebar) sidebar.appendChild(palette);
                    if (palette) {
                        palette.style.display = 'block';
                        palette.classList.add('floating-queue');
                    }
                } else {
                    if (sandboxTools) sandboxTools.style.display = 'none';
                    if (palette && sidebar && palette.parentElement !== sidebar) sidebar.appendChild(palette);
                    if (palette) {
                        palette.style.display = 'none';
                        palette.classList.remove('floating-queue');
                    }
                }
            } else {
                // On desktop, ensure the drawer doesn't act like a drawer
                topDrawer.classList.remove('expanded');
                topDrawer.classList.remove('collapsed');

                // Ensure palette and guide are back in sidebar
                const palette = document.getElementById('palette');
                const guide = document.getElementById('sandbox-guide');
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    if (palette && palette.parentElement !== sidebar) sidebar.appendChild(palette);
                    if (guide && guide.parentElement !== sidebar) sidebar.appendChild(guide);
                }
            }
        }

        this.updateNotationBar();
    },

    // Melody's and Compose's whole control panel (#melody-controls/#compose-controls) plus their
    // own Timeline (#melody-notation-scroll/#compose-notation-scroll, js/timeline.js) move into
    // #notation-bar -- a top bar with controls on the left and the Timeline filling the rest --
    // whenever that mode is active, at EVERY viewport (a narrow phone doesn't have much width to
    // split, so css/style.css's mobile breakpoints stack the two into thin-controls-then-Timeline
    // instead of side by side, but the placement itself -- not the sidebar -- is consistent
    // everywhere; see live feedback). #sidebar is hidden while the bar is showing, since it would
    // otherwise just be an empty reserved-width column with nothing left in it. Every other mode
    // is untouched: its own control panel stays in #sidebar exactly as before, and the bar stays
    // hidden.
    updateNotationBar: function() {
        const bar = document.getElementById('notation-bar');
        const barControls = document.getElementById('notation-bar-controls');
        if (!bar || !barControls) return;

        const sidebar = document.getElementById('sidebar');
        const melodyControls = document.getElementById('melody-controls');
        const melodyScroll = document.getElementById('melody-notation-scroll');
        const melodyStatsGroup = document.getElementById('melody-stats-group');
        const composeControls = document.getElementById('compose-controls');
        const composeScroll = document.getElementById('compose-notation-scroll');
        const composeEditGroup = document.getElementById('compose-edit-group');

        if (this.currentMode === 'melody') {
            if (melodyControls && melodyControls.parentElement !== barControls) barControls.appendChild(melodyControls);
            if (melodyScroll && melodyScroll.parentElement !== bar) bar.appendChild(melodyScroll);
        } else {
            // Restore to their normal sidebar-panel homes -- melodyControls itself, then its own
            // notation-scroll back inside melodyStatsGroup (its authored position, last child).
            if (melodyControls && sidebar && melodyControls.parentElement !== sidebar) sidebar.appendChild(melodyControls);
            if (melodyScroll && melodyStatsGroup && melodyScroll.parentElement !== melodyStatsGroup) melodyStatsGroup.appendChild(melodyScroll);
        }

        if (this.currentMode === 'compose') {
            if (composeControls && composeControls.parentElement !== barControls) barControls.appendChild(composeControls);
            if (composeScroll && composeScroll.parentElement !== bar) bar.appendChild(composeScroll);
        } else {
            if (composeControls && sidebar && composeControls.parentElement !== sidebar) sidebar.appendChild(composeControls);
            // insertBefore, not appendChild -- its authored position sits between the transport
            // and edit-controls groups, not at the end (after stats).
            if (composeScroll && composeControls && composeScroll.parentElement !== composeControls) {
                if (composeEditGroup) composeControls.insertBefore(composeScroll, composeEditGroup);
                else composeControls.appendChild(composeScroll);
            }
        }

        const showBar = this.currentMode === 'melody' || this.currentMode === 'compose';
        bar.style.display = showBar ? 'flex' : 'none';
        // #sidebar would otherwise sit there as an empty reserved-width column (its own CSS
        // gives it a fixed width) with nothing left in it once its one visible panel moves into
        // the bar -- every other mode's own panel is already display:none (see setMode) whether
        // or not the bar is showing.
        if (sidebar) sidebar.style.display = showBar ? 'none' : '';

        // Whatever triggered this (mode switch, resize) already rendered the Timeline once,
        // reading its container's width BEFORE the reparenting above -- e.g. still the old
        // sidebar's ~260px on first entering Melody, not #notation-bar's actual (much wider)
        // Timeline half. Re-render now that it's actually landed in its final spot, so it fills
        // the width it really has. Guarded by .timeline existing: setMode calls this BEFORE
        // MelodyMode.init()/ComposeMode.init() too (see its own comment), and on that mode's
        // very first-ever visit this runs before init() has created .timeline at all.
        if (this.currentMode === 'melody' && MelodyMode.timeline) MelodyMode.updateDifficultyUI();
        else if (this.currentMode === 'compose' && ComposeMode.timeline) ComposeMode.refreshStaff();
    },

    setupTouchGestures: function() {
        const svg = document.getElementById('tonnetz-svg');
        if (!svg) return;

        let startAngle = 0;
        let lastAngle = 0;
        let isGesture = false;
        let lastTouchCell = null;
        let preTouchHoverCell = null;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let touchStartCell = null;
        let isDragging = false;
        let twoFingerStartCenter = null;
        let twoFingerStartView = null;
        let lastPinchDistance = null; // updated every touchmove -- see the shared 2-finger handler

        // Compose-only: was the touched cell (at touchstart) an already-selected note? If so, a
        // drag-past-threshold is a note-drag (translateSelection at touchend) rather than
        // whatever a stray one-finger drag over empty board would otherwise do (nothing).
        let composeDragCandidate = false;

        // Compose recording, 2+ fingers: a stationary multi-finger touch is chord entry: still
        // fingers on distinct cells that never moved past the same tap-vs-drag threshold every
        // other drag in this file already uses. Movement past it promotes the whole gesture to
        // the ordinary pan/rotate below instead -- pan/rotate stays fully available while
        // recording, disambiguated the same way a tap is told apart from a drag anywhere else.
        const CHORD_MOVE_THRESHOLD_PX = 10;
        let composeChordCandidates = null; // [{ identifier, startX, startY, cell, time }]
        let composeCommittedTouchIds = new Set(); // solo touches already recorded -- never re-added as a candidate

        // Phone-only: pickup and placement are each their own dedicated gesture (hold), so
        // a plain tap never does double duty. HOLD_DURATION_MS sits comfortably above the
        // 250ms tap-duration ceiling below, so a fired hold and a recognized tap can never
        // both apply to the same touch.
        const HOLD_DURATION_MS = 400;
        let holdTimer = null;
        let holdFired = false;

        const getAngle = (t1, t2) => {
            return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
        };

        const getDistance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

        const getCellFromTouch = (touch) => {
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            if (element && element.tagName.toLowerCase() === 'polygon') {
                const p = parseInt(element.getAttribute('data-p'));
                const q = parseInt(element.getAttribute('data-q'));
                return { p, q };
            }
            return null;
        };

        // Fires when a hold is recognized (see the phone branch of touchstart). Holding the
        // candidate ghost places it (mirrors tap-on-ghost's rotate); holding any placed piece
        // picks it up, regardless of whether a candidate is currently selected -- unlike the
        // old tap-to-pick-up, which silently failed whenever the tap happened to land near the
        // candidate ghost (reported as "tap to pick up only works sometimes", GitHub issue #4).
        const performHoldAction = (cell) => {
            if (!cell || this.currentMode !== 'sandbox' && this.currentMode !== 'blast') return;
            const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
            const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

            // Check pickup before placement: a placed piece's own cell is also where the
            // candidate's ghost sits right after placing it (nothing moves the ghost away on
            // its own), so holding there again must mean "pick this back up," not "place here
            // again" -- which would just silently no-op anyway, since that cell is occupied.
            if (this.currentMode === 'sandbox') {
                const isOnPlacedPiece = SandboxMode.state.placedPieces.some(piece => {
                    const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
                    return cells.some(c => c.p === cell.p && c.q === cell.q);
                });
                if (isOnPlacedPiece) {
                    SandboxMode.pickupPieceAt(cell.p, cell.q);
                    return;
                }
            }

            if (pieceType) {
                const ghostCells = Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation);
                if (ghostCells.some(c => c.p === cell.p && c.q === cell.q)) {
                    if (this.currentMode === 'sandbox') {
                        if (SandboxMode.canPlace(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation)) {
                            SandboxMode.placePiece(modeObj.state.hoverCell.p, modeObj.state.hoverCell.q);
                        }
                    } else if (Board.checkPlacement(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation)) {
                        BlastMode.placePiece(modeObj.state.hoverCell.p, modeObj.state.hoverCell.q);
                    }
                }
            } else if (this.currentMode === 'sandbox') {
                // Note-play tool, empty cell: touch equivalent of the same task #24 highlight
                // mouse gets via sandbox.js's own hold-timer. Cleared in touchend below.
                SandboxMode.showSameNoteHighlight(cell.p, cell.q);
            }
        };

        svg.addEventListener('touchstart', (e) => {
            if (this.currentMode === 'snake') {
                // Steering is handled entirely by #snake-mobile-controls now — just block
                // default scroll/zoom while playing.
                e.preventDefault();
                return;
            }

            if (this.currentMode === 'compose' && ComposeMode.state.isRecording) {
                e.preventDefault();
                if (isGesture) return; // already promoted to pan/rotate; extra touchdowns don't reset it

                // A lone finger has no competing pan/rotate meaning to wait out (never has, even
                // before chord entry existed) -- record it immediately, exactly as before.
                if (e.touches.length === 1) {
                    const t = e.touches[0];
                    const cell = getCellFromTouch(t);
                    if (cell) ComposeMode.recordTouch(cell.p, cell.q);
                    composeCommittedTouchIds.add(t.identifier);
                    return;
                }

                // 2+ fingers down: could be a stationary chord-tap or the start of a pan/rotate
                // drag (2 fingers' existing meaning everywhere else) -- don't commit either way
                // yet. Merge in any newly-arrived fingers rather than resetting ones already
                // tracked (a chord can land across a couple of closely-spaced touchstart events,
                // not only in one), and skip any identifier already recorded via the solo path
                // above so it's never double-counted.
                composeChordCandidates = composeChordCandidates || [];
                const known = new Set(composeChordCandidates.map(c => c.identifier));
                for (const t of e.touches) {
                    if (known.has(t.identifier) || composeCommittedTouchIds.has(t.identifier)) continue;
                    composeChordCandidates.push({
                        identifier: t.identifier,
                        startX: t.clientX,
                        startY: t.clientY,
                        cell: getCellFromTouch(t),
                        time: (performance.now() - ComposeMode.state.recordStartTime) / 1000
                    });
                }
                return;
            }

            if (this.currentMode === 'melody' || this.currentMode === 'compose') {
                if (e.touches.length === 1) {
                    const cell = getCellFromTouch(e.touches[0]);
                    if (cell) {
                        e.preventDefault();
                        if (this.currentMode === 'compose') {
                            // isRecording is handled entirely above now -- only editing reaches
                            // here. Don't resolve the tap yet: touchend resolves it as a plain tap
                            // unless a hold fired (touch equivalent of shift-tap, toggling
                            // selection) or a drag occurred (note-drag, see touchmove/touchend
                            // below) -- mirrors compose.js's own mouse dragCandidate handling,
                            // which has the same three-way split.
                            touchStartCell = cell;
                            touchStartX = e.touches[0].clientX;
                            touchStartY = e.touches[0].clientY;
                            touchStartTime = Date.now();
                            isDragging = false;
                            holdFired = false;
                            composeDragCandidate = ComposeMode.notesAt(cell.p, cell.q)
                                .some(i => ComposeMode.state.selectedIndices.includes(i));
                            clearTimeout(holdTimer);
                            holdTimer = setTimeout(() => {
                                holdFired = true;
                                ComposeMode.tapCell(cell.p, cell.q, { shiftKey: true });
                            }, HOLD_DURATION_MS);
                        } else {
                            const midi = Tonnetz.getMidi(cell.p, cell.q);
                            MelodyMode.playUserNote(midi, cell.p, cell.q);
                        }
                    }
                    return;
                }
                // Falls through to the shared two-finger gesture setup below for a 2-touch
                // start -- neither Melody nor Compose has a selected-piece concept to rotate via
                // twist, so only the pan half of that gesture ever does anything here (touchmove).
            }

            if (this.currentMode === 'gravity') return;

            const isPhone = Render.isMobileViewport();

            if (e.touches.length === 1) {
                isGesture = false;
                const touch = e.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                touchStartTime = Date.now();
                touchStartCell = getCellFromTouch(touch);
                isDragging = false;

                const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
                const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

                if (modeObj && modeObj.state && modeObj.state.hoverCell) {
                    preTouchHoverCell = { p: modeObj.state.hoverCell.p, q: modeObj.state.hoverCell.q };
                } else {
                    preTouchHoverCell = null;
                }

                clearTimeout(holdTimer);
                holdFired = false;

                if (isPhone) {
                    if (pieceType) {
                        e.preventDefault();
                    }
                    if (touchStartCell) {
                        holdTimer = setTimeout(() => {
                            holdFired = true;
                            performHoldAction(touchStartCell);
                        }, HOLD_DURATION_MS);
                    }
                } else {
                    // Standard Tablet/Desktop touch tap-tap-place behavior
                    const cell = touchStartCell;
                    if (cell) {
                        lastTouchCell = cell;
                        if (pieceType) {
                            e.preventDefault();
                        }
                        
                        let isPickup = false;
                        if (this.currentMode === 'sandbox') {
                            isPickup = SandboxMode.state.placedPieces.some(piece => {
                                const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
                                return cells.some(c => c.p === cell.p && c.q === cell.q);
                            });
                        }

                        if (isPickup || !pieceType) {
                            modeObj.state.hoverCell = cell;
                            if (this.currentMode === 'sandbox') {
                                SandboxMode.handleAction(cell.p, cell.q);
                            } else {
                                const midi = Tonnetz.getMidi(cell.p, cell.q);
                                Synth.playNote(midi);
                            }
                        } else {
                            // A plain board tap never places a piece here -- double-tap-to-place
                            // was tried and removed (see js/sandbox.js). Placement only happens
                            // via the place-wedge, carousel tap/drag, or swipe-down (Sandbox), or
                            // swipe/piece-queue tap (Blast).
                            modeObj.state.hoverCell = cell;
                            modeObj.updateGhost();
                        }
                    }
                }
            } else if (e.touches.length === 2) {
                isGesture = true;
                startAngle = getAngle(e.touches[0], e.touches[1]);
                lastAngle = startAngle;
                twoFingerStartCenter = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
                twoFingerStartView = {
                    x: Render.viewX,
                    y: Render.viewY
                };
                lastPinchDistance = getDistance(e.touches[0], e.touches[1]);
                e.preventDefault(); // Stop viewport scaling/panning while twisting
            }
        }, { passive: false });

        svg.addEventListener('touchmove', (e) => {
            if (this.currentMode === 'snake') {
                e.preventDefault();
                return;
            }

            // Compose editing (not recording): track movement so touchend can tell a plain tap
            // from a note-drag. A single touch while recording is still tap-to-play(-and-record),
            // handled entirely in touchstart -- unaffected here.
            if (this.currentMode === 'compose' && !ComposeMode.state.isRecording && e.touches.length === 1) {
                const touch = e.touches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    if (!isDragging) clearTimeout(holdTimer); // real movement means this isn't a hold
                    isDragging = true;
                }
                if (isDragging && composeDragCandidate) e.preventDefault(); // suppress scroll while dragging a note
                return;
            }

            // Compose recording, 2+-finger candidates: movement past the same tap-vs-drag
            // threshold used everywhere else promotes this into an ordinary pan/rotate gesture --
            // the candidates are discarded (never committed as notes) and control passes to the
            // shared 2-finger gesture code below, using this event as its baseline. No movement
            // yet just re-blocks default scroll/zoom and waits.
            if (this.currentMode === 'compose' && ComposeMode.state.isRecording && composeChordCandidates && composeChordCandidates.length > 0) {
                const promote = Array.from(e.touches).some(t => {
                    const c = composeChordCandidates.find(cand => cand.identifier === t.identifier);
                    return c && (Math.abs(t.clientX - c.startX) > CHORD_MOVE_THRESHOLD_PX || Math.abs(t.clientY - c.startY) > CHORD_MOVE_THRESHOLD_PX);
                });
                if (!promote || e.touches.length < 2) {
                    e.preventDefault();
                    return;
                }
                composeChordCandidates = null;
                isGesture = true;
                startAngle = getAngle(e.touches[0], e.touches[1]);
                lastAngle = startAngle;
                twoFingerStartCenter = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
                twoFingerStartView = { x: Render.viewX, y: Render.viewY };
                lastPinchDistance = getDistance(e.touches[0], e.touches[1]);
                e.preventDefault();
                return;
            }

            // Compose recording, no live chord candidates: either a solo touch (handled entirely
            // in touchstart, nothing to do on move) or an already-promoted gesture, which falls
            // through to the shared 2-finger code below like every other mode.
            if (this.currentMode === 'compose' && ComposeMode.state.isRecording && !isGesture) {
                e.preventDefault();
                return;
            }

            // A single touch in Melody/Compose is tap-to-play (handled entirely in touchstart) --
            // only a 2-touch pan gesture (below) applies here.
            if ((this.currentMode === 'melody' || this.currentMode === 'compose') && e.touches.length !== 2) {
                e.preventDefault();
                return;
            }

            if (this.currentMode === 'gravity') return;

            const isPhone = Render.isMobileViewport();

            if (e.touches.length === 1 && !isGesture) {
                const touch = e.touches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;

                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    if (!isDragging) clearTimeout(holdTimer); // real movement means this isn't a hold
                    isDragging = true;
                }

                if (isPhone) {
                    const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
                    const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

                    if (pieceType && isDragging) {
                        e.preventDefault();
                        const cell = getCellFromTouch(touch);
                        if (cell) {
                            modeObj.state.hoverCell = cell;
                            modeObj.updateGhost();
                        }
                    }
                } else {
                    const cell = getCellFromTouch(touch);
                    if (cell) {
                        lastTouchCell = cell;
                        const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
                        const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

                        // Disable standard page panning/scrolling while dragging an active piece
                        if (this.currentMode === 'blast' || (this.currentMode === 'sandbox' && SandboxMode.state.selectedPiece)) {
                            e.preventDefault();
                            modeObj.state.hoverCell = cell;
                            modeObj.updateGhost();
                        }
                    }
                }
            } else if (e.touches.length === 2) {
                e.preventDefault(); // We handle zoom ourselves below -- block the browser's native pinch-zoom
                const currentAngle = getAngle(e.touches[0], e.touches[1]);
                let diff = currentAngle - lastAngle;

                // Handle angular boundary wrap around
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;

                // Twist angle threshold: 30 degrees. Melody has no selected/active-piece concept
                // to rotate this way, so this whole sub-branch is Sandbox/Blast only -- letting
                // 'melody' fall through here would read/write BlastMode's own state from inside a
                // completely unrelated mode's gesture.
                if (Math.abs(diff) > 30 && (this.currentMode === 'sandbox' || this.currentMode === 'blast')) {
                    const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
                    const rotateDir = diff > 0 ? -1 : 1; // Physical CW twist → CW piece rotation
                    const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

                    if (pieceType) {
                        if (rotateDir > 0) {
                            modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                        } else {
                            modeObj.state.rotation = (modeObj.state.rotation + 5) % 6;
                        }
                        // updateGhost() itself sounds the new orientation's cells.
                        modeObj.updateGhost();
                    }

                    lastAngle = currentAngle;
                }
                
                // 2. Pinch zoom: fingers spreading apart (currentDistance > lastPinchDistance)
                // zooms IN; pinching closer zooms out. Applied against the distance since the
                // LAST move event (not the gesture start), matching how the wheel handler applies
                // a small step per event -- smooth and continuous rather than one big jump.
                if (lastPinchDistance) {
                    const currentDistance = getDistance(e.touches[0], e.touches[1]);
                    if (currentDistance > 0) {
                        this.applyZoomDelta(lastPinchDistance / currentDistance);
                        lastPinchDistance = currentDistance;
                    }
                }

                // 3. Panning drag logic
                if (twoFingerStartCenter && twoFingerStartView) {
                    const currentCenter = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                    const dx = currentCenter.x - twoFingerStartCenter.x;
                    const dy = currentCenter.y - twoFingerStartCenter.y;

                    // Multiply delta by zoom since zoom scales coordinates. Render.zoom reflects
                    // step 2's pinch-zoom, if any just happened this same move event.
                    const newViewX = twoFingerStartView.x - dx * Render.zoom;
                    const newViewY = twoFingerStartView.y - dy * Render.zoom;

                    Render.updateView(newViewX, newViewY, Render.zoom);

                    // Keep the mode's own persisted view state in sync with the (possibly
                    // clamped) result -- otherwise the next refreshBoard() (resetGame, loading a
                    // new melody, the rotate-view button) would read the stale pre-drag value and
                    // silently discard wherever the player just panned to. Every zoomable mode is
                    // pannable (and vice versa -- see isZoomableMode), so this is exactly the same
                    // set of modes, driven off the mode object rather than a separately-listed
                    // if/else chain.
                    if (this.isZoomableMode()) {
                        const m = this.modeModule();
                        if (m && m.state) {
                            m.state.viewX = Render.viewX;
                            m.state.viewY = Render.viewY;
                        }
                    }
                }
            }
        }, { passive: false });

        svg.addEventListener('touchend', (e) => {
            const isPhone = Render.isMobileViewport();

            if (e.touches.length === 0) {
                isGesture = false;
            }

            clearTimeout(holdTimer);
            if (this.currentMode === 'sandbox') SandboxMode.clearNoteHighlight();

            // Compose recording: any candidate finger(s) that lifted without ever crossing the
            // move threshold (never promoted to a pan/rotate drag) commit now as a chord, each
            // using the time it actually touched down rather than whenever it happened to lift.
            if (this.currentMode === 'compose' && ComposeMode.state.isRecording && composeChordCandidates) {
                e.preventDefault();
                for (const t of e.changedTouches) {
                    const idx = composeChordCandidates.findIndex(c => c.identifier === t.identifier);
                    if (idx === -1) continue;
                    const c = composeChordCandidates[idx];
                    composeChordCandidates.splice(idx, 1);
                    if (c.cell) ComposeMode.recordTouch(c.cell.p, c.cell.q, c.time);
                }
                if (composeChordCandidates.length === 0) composeChordCandidates = null;
                if (e.touches.length === 0) composeCommittedTouchIds.clear();
                return;
            }

            if (e.touches.length === 0 && this.currentMode === 'compose') composeCommittedTouchIds.clear();

            if (e.changedTouches.length === 1 && this.currentMode === 'compose' && !ComposeMode.state.isRecording) {
                e.preventDefault();
                if (isDragging && composeDragCandidate) {
                    // A note-drag: resolve the final cell and translate the whole selection by
                    // the same (dp, dq) -- mirrors compose.js's own mouse dragCandidate handling.
                    const endCell = getCellFromTouch(e.changedTouches[0]);
                    if (endCell && touchStartCell) {
                        ComposeMode.translateSelection(endCell.p - touchStartCell.p, endCell.q - touchStartCell.q);
                    }
                } else if (!holdFired && !isDragging && touchStartCell) {
                    // A plain tap (not a hold, not a drag): resolve exactly as a non-shift tap --
                    // select-only, insert-after-selected, or clear-selection-and-play. The hold
                    // case already resolved its own action from touchstart's timer; nothing
                    // further needed here for it.
                    ComposeMode.tapCell(touchStartCell.p, touchStartCell.q, { shiftKey: false });
                }
                return;
            }

            if (e.changedTouches.length === 1 && (this.currentMode === 'sandbox' || this.currentMode === 'blast')) {
                e.preventDefault();
                const touch = e.changedTouches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                const duration = Date.now() - touchStartTime;

                const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
                const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

                if (isPhone) {
                    // Phone: pickup and placement are both holds now (see performHoldAction,
                    // fired from touchstart's timer, not here) -- a plain tap only ever rotates
                    // the candidate or moves it, never places or picks anything up. Swipe up/
                    // down used to double as pick-up/place here too, which is gone along with
                    // tap-to-pick-up: both were two intents sharing one ambiguous gesture.
                    const isTap = !isDragging && !holdFired;
                    if (isTap) {
                        if (pieceType) {
                            const tapCell = touchStartCell;
                            const ghostCells = tapCell
                                ? Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation)
                                : [];
                            const tappedGhost = tapCell && ghostCells.some(c => c.p === tapCell.p && c.q === tapCell.q);

                            if (!tapCell || tappedGhost) {
                                // Tap on the candidate itself (or couldn't resolve a cell) ->
                                // rotate clockwise. Holding the candidate places it instead (see
                                // performHoldAction). updateGhost() itself sounds the new
                                // orientation's cells.
                                modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                                modeObj.updateGhost();
                            } else if (this.currentMode === 'blast' && !Board.isCellEmpty(tapCell.p, tapCell.q)) {
                                // Blast has no pickup — ignore taps on locked cells
                            } else {
                                // Tap elsewhere -> move the candidate here instead of rotating.
                                // Picking up a placed piece is a hold now, never a plain tap.
                                modeObj.state.hoverCell = tapCell;
                                modeObj.updateGhost();
                            }
                        } else {
                            // Nothing selected -> the note-play tool: a tap ALWAYS plays the
                            // note under the finger, regardless of any placed piece there.
                            // Picking up a placed piece is a hold (see performHoldAction),
                            // never a plain tap with nothing selected, so idly tapping around
                            // to hear notes can never accidentally disturb something placed.
                            if (touchStartCell) {
                                const midi = Tonnetz.getMidi(touchStartCell.p, touchStartCell.q);
                                Synth.playNote(midi);
                            }
                        }
                    }
                    // If it was a drag or a hold (not a tap), do nothing further here -- a drag
                    // just leaves the ghost where dropped, and a hold already fired its own
                    // action from the touchstart timer.
                } else {
                    // Tablet/desktop touch: unchanged from before this gesture redesign --
                    // touchstart already handles pickup/note-play immediately, so this is a
                    // fallback for the tap-to-rotate and swipe-to-place/pick-up paths tablet
                    // still uses.
                    const isVerticalSwipe = duration < 400 && Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5;
                    const isTap = !isDragging && duration < 250 && Math.abs(dx) < 15 && Math.abs(dy) < 15;

                    if (isVerticalSwipe) {
                        // Revert the piece position to where it was before the swipe started
                        if (preTouchHoverCell) {
                            modeObj.state.hoverCell = preTouchHoverCell;
                            modeObj.updateGhost();
                        }

                        if (dy > 50) {
                            // Swipe Down -> Place piece at current ghost position
                            const cell = modeObj.state.hoverCell;
                            if (cell && pieceType) {
                                if (this.currentMode === 'sandbox') {
                                    if (SandboxMode.canPlace(SandboxMode.state.selectedPiece, cell.p, cell.q, SandboxMode.state.rotation)) {
                                        SandboxMode.placePiece(cell.p, cell.q);
                                    }
                                } else {
                                    if (Board.checkPlacement(BlastMode.state.activePiece, cell.p, cell.q, BlastMode.state.rotation)) {
                                        BlastMode.placePiece(cell.p, cell.q);
                                    }
                                }
                            }
                        } else if (dy < -50) {
                            // Swipe Up -> Pick up ONLY (never place)
                            if (this.currentMode === 'sandbox' && preTouchHoverCell) {
                                SandboxMode.pickupPieceAt(preTouchHoverCell.p, preTouchHoverCell.q);
                            }
                        }
                    } else if (isTap) {
                        const isOnPlacedPiece = (cell) => this.currentMode === 'sandbox' && cell && SandboxMode.state.placedPieces.some(piece => {
                            const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
                            return cells.some(c => c.p === cell.p && c.q === cell.q);
                        });
                        if (pieceType) {
                            const tapCell = touchStartCell;
                            const ghostCells = tapCell
                                ? Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation)
                                : [];
                            const tappedGhost = tapCell && ghostCells.some(c => c.p === tapCell.p && c.q === tapCell.q);

                            if (!tapCell || tappedGhost) {
                                modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                                modeObj.updateGhost();
                            } else if (isOnPlacedPiece(tapCell)) {
                                modeObj.state.hoverCell = tapCell;
                                SandboxMode.pickupPieceAt(tapCell.p, tapCell.q);
                            } else if (this.currentMode === 'blast' && !Board.isCellEmpty(tapCell.p, tapCell.q)) {
                                // Blast has no pickup — ignore taps on locked cells
                            } else {
                                modeObj.state.hoverCell = tapCell;
                                modeObj.updateGhost();
                            }
                        } else {
                            if (touchStartCell) {
                                const midi = Tonnetz.getMidi(touchStartCell.p, touchStartCell.q);
                                Synth.playNote(midi);
                            }
                        }
                    }
                    // If it was a drag (not a swipe, not a tap), do nothing on touchend.
                    // The ghost stays where the user dragged it.
                }
            }
        });
    },

    setupMidiInput: function() {
        const btn = document.getElementById('midi-connect-btn');
        if (!btn) return;
        if (typeof MidiInput === 'undefined' || !MidiInput.isSupported()) {
            btn.style.display = 'none';
            return;
        }
        btn.onclick = () => {
            MidiInput.connect().catch(err => console.warn('MIDI connection failed:', err));
        };
    },

    // Which function actually redraws each mode's board -- differs by mode (see js/blast.js's
    // own comment on why it needs refreshUI specifically, not refreshBoard alone). Gravity is
    // deliberately absent: its rotate button stays hidden (see setMode below), since
    // Render.getEffectiveRotation() always renders Gravity at 0 regardless of this setting.
    modeRefreshFns: {
        sandbox: () => SandboxMode.refreshLattice(),
        blast: () => BlastMode.refreshUI(),
        melody: () => MelodyMode.refreshBoard(),
        snake: () => SnakeMode.refreshBoard(),
        compose: () => ComposeMode.refreshBoard(),
        life: () => LifeMode.refreshLattice(),
    },

    // A hexagon has 60-degree self-symmetry, so a hex lattice looks like a clean, uniformly-
    // rotated field of tiles at ANY rotation angle -- there's no "wrong" step size the way there
    // would be for e.g. a square grid. 30-degree steps cover both the pointy-top (0/60/120/...)
    // and flat-top (30/90/150/...) families, plus exact quarter-turns to match screen
    // portrait/landscape or a MIDI controller's own physical orientation.
    setupRotateView: function() {
        const btn = document.getElementById('rotate-view-btn');
        if (!btn) return;
        btn.onclick = () => {
            Render.setRotation(Render.rotationDeg + 30);
            const refresh = this.modeRefreshFns[this.currentMode];
            if (refresh) refresh();
        };
    },

    collapseMobileDrawer: function() {
        const drawer = document.getElementById('top-drawer');
        if (drawer) {
            drawer.classList.remove('expanded');
            drawer.classList.add('collapsed');
        }
    },

    updateVersionTag: async function() {
        const el = document.querySelector('.version-tag');
        if (!el) return;

        // Set initial display to local commit version
        const localVer = typeof GIT_VERSION !== 'undefined' ? GIT_VERSION : 'local';
        el.textContent = localVer;

        const host = window.location.hostname;
        const path = window.location.pathname;

        if (host.includes('github.io')) {
            const username = host.split('.')[0];
            const repo = path.split('/').filter(Boolean)[0] || 'Tonncade';

            const cachedSha = sessionStorage.getItem('tonncade_commit_sha');
            const cachedParentSha = sessionStorage.getItem('tonncade_parent_sha') || '';
            if (cachedSha && cachedParentSha) {
                const currentSha = localVer.replace('git-', '');
                if (currentSha !== cachedSha && currentSha !== cachedParentSha) {
                    el.textContent = `${localVer} (update available: git-${cachedSha})`;
                }
                return;
            }

            try {
                const response = await fetch(`https://api.github.com/repos/${username}/${repo}/commits/main`);
                if (response.ok) {
                    const data = await response.json();
                    const shortSha = data.sha.substring(0, 7);
                    const parentSha = data.parents && data.parents[0] ? data.parents[0].sha.substring(0, 7) : '';
                    
                    sessionStorage.setItem('tonncade_commit_sha', shortSha);
                    sessionStorage.setItem('tonncade_parent_sha', parentSha);
                    
                    const currentSha = localVer.replace('git-', '');
                    if (currentSha !== shortSha && currentSha !== parentSha) {
                        el.textContent = `${localVer} (update available: git-${shortSha})`;
                    }
                }
            } catch (err) {
                console.warn('Could not fetch git version:', err);
            }
        }
    }
};

window.onload = () => {
    App.init();

    // Register Service Worker for PWA compatibility. Skipped entirely on file:// --
    // registration is fundamentally unsupported there ("URL protocol of the current
    // origin ('null') is not supported"), not just blocked, so there's no useful
    // outcome to wait on.
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        // Captured BEFORE register() -- true only if some earlier service worker was already
        // controlling this page (a returning visitor). A brand-new visitor's page loads
        // uncontrolled, then sw.js's activate handler (self.clients.claim()) claims it for the
        // first time -- that transition fires 'controllerchange' too, indistinguishable from a
        // real update UNLESS this is checked first. Reported live: a new visitor would see the
        // page render once, then get force-reloaded by the (below) 'controllerchange' handler
        // for no reason at all -- an extra, unnecessary navigation that on a real network (not
        // this codebase's fast localhost test server) can leave the app visibly uninitialized
        // for the gap between the two loads, matching "sees emptiness, resolves on reload".
        const hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                if (reg) {
                    console.log('Service Worker registered:', reg.scope);
                    // Force-check for updates on server to bypass cache
                    reg.update().catch(err => console.warn('Service worker update check failed:', err));
                }
            })
            .catch(err => {
                if (err && err.message && err.message.includes('blocked')) {
                    console.log('Service Worker registration was blocked as expected.');
                } else {
                    console.error('Service Worker registration failed:', err);
                }
            });

        // Auto-reload the app immediately when a new service worker REPLACES one that was
        // already controlling this page (a real update) -- but not on a first-ever visit, where
        // this same event fires from simply going uncontrolled -> controlled and there's no
        // newer content to pick up by reloading.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing && hadController) {
                refreshing = true;
                window.location.reload();
            }
        });
    }
};
