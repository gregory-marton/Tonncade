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

    init: function() {
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
        this.updateVersionTag();

        window.addEventListener('resize', () => {
            this.setupMobileControls();
        });

        // Start in Sandbox Mode
        this.setMode('sandbox', 0);
    },

    setMode: function(mode, idx) {
        if (this.currentMode === mode) return;

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

        if (typeof GravityMode !== 'undefined' && GravityMode.state.timer) {
            clearInterval(GravityMode.state.timer);
        }

        if (typeof MidiMode !== 'undefined') {
            MidiMode.cleanup();
        }

        if (typeof SnakeMode !== 'undefined') {
            SnakeMode.cleanup();
        }

        if (typeof SandboxMode !== 'undefined' && SandboxMode.cleanup) {
            SandboxMode.cleanup();
        }

        this.currentMode = mode;
        document.getElementById('app').setAttribute('data-mode', mode);

        // Configure mobile action button text based on active mode
        const actionBtn = document.getElementById('m-btn-action');
        if (actionBtn) {
            actionBtn.style.display = 'block';
            if (mode === 'gravity') {
                actionBtn.textContent = '▼'; // Reused as the soft-drop button in Gravity
            } else {
                actionBtn.textContent = mode === 'sandbox' ? 'Place / Pick up' : 'Place Piece';
            }
        }

        // Configure mobile navigation buttons based on active mode (hex layout)
        const btnUl = document.getElementById('m-btn-ul');
        const btnUr = document.getElementById('m-btn-ur');
        const btnDr = document.getElementById('m-btn-dr');
        const btnDl = document.getElementById('m-btn-dl');

        if (btnUl && btnUr && btnDr && btnDl) {
            if (mode === 'gravity') {
                btnUl.style.display = 'none';
                btnUr.style.display = 'none';
                btnDr.style.display = 'none';
                btnDl.textContent = '▼'; // Label as vertical down-arrow for gravity soft-drop
            } else {
                btnUl.style.display = 'block';
                btnUr.style.display = 'block';
                btnDr.style.display = 'block';
                btnDl.textContent = '↙';
            }
        }

        // Hide/show palette
        const palette = document.getElementById('palette');
        if (palette) {
            palette.style.display = (mode === 'midi' || mode === 'snake') ? 'none' : 'block';
        }

        // Hide/show mobile dock based on mode and screen width
        const mobileDock = document.getElementById('mobile-dock');
        if (mobileDock) {
            const isMobileWidth = Render.isMobileViewport();
            if (isMobileWidth && mode === 'sandbox') {
                mobileDock.style.display = 'block';
            } else {
                mobileDock.style.display = 'none';
            }
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
        if (document.getElementById('midi-controls')) {
            document.getElementById('midi-controls').style.display = 'none';
        }
        if (document.getElementById('snake-controls')) {
            document.getElementById('snake-controls').style.display = 'none';
        }
        document.getElementById('placement-controls').style.display = 'none';
        sandboxCtrls.style.display = 'none';
        const guide = document.getElementById('sandbox-guide');
        if (guide) {
            guide.style.display = 'none';
        }

        if (mode === 'sandbox') {
            document.getElementById('placement-controls').style.display = 'block';
            sandboxCtrls.style.display = 'block';
            if (guide) guide.style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place/Pick up';
            SandboxMode.init();
        } else if (mode === 'blast') {
            stats.style.display = 'block';
            document.getElementById('placement-controls').style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place Piece';
            BlastMode.init();
        } else if (mode === 'gravity') {
            document.getElementById('gravity-controls').style.display = 'block';
            GravityMode.init();
        } else if (mode === 'midi') {
            document.getElementById('midi-controls').style.display = 'block';
            MidiMode.init();
        } else if (mode === 'snake') {
            document.getElementById('snake-controls').style.display = 'block';
            SnakeMode.init();
        }
        
        this.setupMobileControls();
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

            bindBtn('m-btn-ccw', ' ', 'Space', true);  // CCW Rotate (Shift + Space)
            bindBtn('m-btn-cw', ' ', 'Space', false);   // CW Rotate (Space)
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
        
        if (topDrawer && menuToggle) {
            if (isMobileWidth) {
                // Initialize drawer interactions once
                if (!this.topDrawerInitialized) {
                    this.topDrawerInitialized = true;
                    
                    menuToggle.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        topDrawer.classList.toggle('expanded');
                        topDrawer.classList.toggle('collapsed');
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
                            topDrawer.classList.toggle('expanded');
                            topDrawer.classList.toggle('collapsed');
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
                const midiTools = document.getElementById('midi-mobile-tools');
                const drawerInjected = document.getElementById('drawer-injected-tools');
                const palette = document.getElementById('palette');
                const guide = document.getElementById('sandbox-guide');
                const sidebar = document.getElementById('sidebar');

                const midiUpload = document.getElementById('midi-upload-group');
                const midiStats = document.getElementById('midi-stats-group');
                const midiActions = document.getElementById('midi-actions-group');

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
                    if (midiTools) midiTools.style.display = 'none';
                } else if (this.currentMode === 'midi') {
                    if (sandboxTools) sandboxTools.style.display = 'none';
                    if (midiTools) {
                        midiTools.style.display = 'flex';
                        if (midiStats) midiTools.appendChild(midiStats);
                        if (midiActions) midiTools.appendChild(midiActions);
                    }
                    if (midiUpload && drawerInjected) {
                        drawerInjected.style.display = 'block';
                        drawerInjected.appendChild(midiUpload);
                    }
                    // #palette (Sandbox's carousel) isn't used in MIDI mode — return it home and
                    // hide it so it doesn't stay stranded inside a hidden sandboxTools.
                    if (palette && sidebar && palette.parentElement !== sidebar) sidebar.appendChild(palette);
                    if (palette) {
                        palette.style.display = 'none';
                        palette.classList.remove('floating-queue');
                    }
                } else if (this.currentMode === 'blast' || this.currentMode === 'gravity') {
                    if (sandboxTools) sandboxTools.style.display = 'none';
                    if (midiTools) midiTools.style.display = 'none';
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
                    if (midiTools) midiTools.style.display = 'none';
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
                // Ensure midi controls are back in midi-controls container
                const midiControls = document.getElementById('midi-controls');
                const midiUpload = document.getElementById('midi-upload-group');
                const midiActions = document.getElementById('midi-actions-group');
                const midiStats = document.getElementById('midi-stats-group');
                
                if (midiControls) {
                    if (midiUpload && midiUpload.parentElement !== midiControls) midiControls.appendChild(midiUpload);
                    if (midiActions && midiActions.parentElement !== midiControls) midiControls.appendChild(midiActions);
                    if (midiStats && midiStats.parentElement !== midiControls) midiControls.appendChild(midiStats);
                }
                
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
    },

    setupTouchGestures: function() {
        const svg = document.getElementById('tonnetz-svg');
        if (!svg) return;

        let startAngle = 0;
        let lastAngle = 0;
        let isGesture = false;
        let lastTapCell = null;
        let lastTouchCell = null;
        let preTouchHoverCell = null;

        let doubleTapLastCell = null;
        let doubleTapLastTime = 0;
        let doubleTapSnapshotRotation = null;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;
        let touchStartCell = null;
        let isDragging = false;
        let twoFingerStartCenter = null;
        let twoFingerStartView = null;

        const getAngle = (t1, t2) => {
            return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
        };

        const getCellFromTouch = (touch) => {
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            if (element && element.tagName.toLowerCase() === 'polygon') {
                const p = parseInt(element.getAttribute('data-p'));
                const q = parseInt(element.getAttribute('data-q'));
                return { p, q };
            }
            return null;
        };

        svg.addEventListener('touchstart', (e) => {
            if (this.currentMode === 'snake') {
                // Steering is handled entirely by #snake-mobile-controls now — just block
                // default scroll/zoom while playing.
                e.preventDefault();
                return;
            }

            if (this.currentMode === 'midi') {
                if (e.touches.length === 1) {
                    const cell = getCellFromTouch(e.touches[0]);
                    if (cell) {
                        e.preventDefault();
                        const midi = Tonnetz.getMidi(cell.p, cell.q);
                        MidiMode.playUserNote(midi, cell.p, cell.q);
                    }
                }
                return;
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

                if (isPhone) {
                    if (pieceType) {
                        e.preventDefault();
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
                            lastTapCell = null;
                        } else {
                            const isSameCell = lastTapCell && lastTapCell.p === cell.p && lastTapCell.q === cell.q;
                            modeObj.state.hoverCell = cell;
                            modeObj.updateGhost();

                            if (isSameCell) {
                                if (this.currentMode === 'sandbox') {
                                    if (SandboxMode.canPlace(SandboxMode.state.selectedPiece, cell.p, cell.q, SandboxMode.state.rotation)) {
                                        SandboxMode.placePiece(cell.p, cell.q);
                                    }
                                } else {
                                    if (Board.checkPlacement(BlastMode.state.activePiece, cell.p, cell.q, BlastMode.state.rotation)) {
                                        BlastMode.placePiece(cell.p, cell.q);
                                    }
                                }
                                lastTapCell = null;
                            } else {
                                lastTapCell = cell;
                            }
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
                e.preventDefault(); // Stop viewport scaling/panning while twisting
            }
        }, { passive: false });

        svg.addEventListener('touchmove', (e) => {
            if (this.currentMode === 'midi' || this.currentMode === 'snake') {
                e.preventDefault();
                return;
            }

            if (this.currentMode === 'gravity') return;

            const isPhone = Render.isMobileViewport();

            if (e.touches.length === 1 && !isGesture) {
                const touch = e.touches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                const dt = Date.now() - touchStartTime;

                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    isDragging = true;
                }

                if (isPhone) {
                    // Prevent visual jump if they are just swiping vertically
                    if (dt < 300 && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.5) {
                        return; // It's likely a swipe, don't move the piece
                    }
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
                            lastTapCell = cell; // Align double-tap coordinates to latest dragged cell
                        }
                    }
                }
            } else if (e.touches.length === 2) {
                e.preventDefault(); // Block double-finger zooming gestures
                const currentAngle = getAngle(e.touches[0], e.touches[1]);
                let diff = currentAngle - lastAngle;

                // Handle angular boundary wrap around
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;

                // Twist angle threshold: 30 degrees
                if (Math.abs(diff) > 30) {
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
                
                // 2. Panning drag logic
                if (twoFingerStartCenter && twoFingerStartView) {
                    const currentCenter = {
                        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                    };
                    const dx = currentCenter.x - twoFingerStartCenter.x;
                    const dy = currentCenter.y - twoFingerStartCenter.y;
                    
                    // Multiply delta by zoom since zoom scales coordinates
                    const newViewX = twoFingerStartView.x - dx * Render.zoom;
                    const newViewY = twoFingerStartView.y - dy * Render.zoom;

                    Render.updateView(newViewX, newViewY, Render.zoom);

                    // Keep SandboxMode.state in sync with the (possibly clamped) result
                    if (this.currentMode === 'sandbox') {
                        SandboxMode.state.viewX = Render.viewX;
                        SandboxMode.state.viewY = Render.viewY;
                    }
                }
            }
        }, { passive: false });

        svg.addEventListener('touchend', (e) => {
            const isPhone = Render.isMobileViewport();

            if (e.touches.length === 0) {
                isGesture = false;
            }

            if (e.changedTouches.length === 1 && (this.currentMode === 'sandbox' || this.currentMode === 'blast')) {
                e.preventDefault();
                const touch = e.changedTouches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                const duration = Date.now() - touchStartTime;

                // Swipe = fast vertical flick (< 400ms, > 50px vertical, mostly vertical)
                const isVerticalSwipe = duration < 400 && Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5;
                const isTap = !isDragging && duration < 250 && Math.abs(dx) < 15 && Math.abs(dy) < 15;

                const modeObj = this.currentMode === 'sandbox' ? SandboxMode : BlastMode;
                const pieceType = this.currentMode === 'sandbox' ? SandboxMode.state.selectedPiece : BlastMode.state.activePiece;

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
                    const isWithinOneCell = (a, b) => (a.p === b.p && a.q === b.q) ||
                        Tonnetz.getNeighbors(a.p, a.q).some(n => n.p === b.p && n.q === b.q);

                    if (pieceType) {
                        const tapCell = touchStartCell;
                        const ghostCells = tapCell
                            ? Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation)
                            : [];
                        const tappedGhost = tapCell && ghostCells.some(c => c.p === tapCell.p && c.q === tapCell.q);
                        const nearGhost = tapCell && ghostCells.some(c => isWithinOneCell(c, tapCell));

                        if (!tapCell || tappedGhost) {
                            // Tap on the candidate itself (or couldn't resolve a cell) -> rotate
                            // clockwise. updateGhost() itself sounds the new orientation's cells.
                            modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                            modeObj.updateGhost();
                        } else if (isOnPlacedPiece(tapCell) && !nearGhost) {
                            // Tap on an already-placed piece, away from the candidate -> pick it up
                            modeObj.state.hoverCell = tapCell;
                            SandboxMode.pickupPieceAt(tapCell.p, tapCell.q);
                        } else if (this.currentMode === 'blast' && !Board.isCellEmpty(tapCell.p, tapCell.q)) {
                            // Blast has no pickup — ignore taps on locked cells
                        } else {
                            // Tap elsewhere (including a placed piece near the candidate) ->
                            // move the candidate here instead of rotating or picking up
                            modeObj.state.hoverCell = tapCell;
                            modeObj.updateGhost();
                        }
                    } else {
                        // Nothing selected -> this is the note-play tool: a tap ALWAYS plays
                        // the note under the finger, regardless of any placed piece there.
                        // Picking up a placed piece is swipe-up (or tapping it while a
                        // different piece is already selected, above) — never a plain tap with
                        // nothing selected, so idly tapping around to hear notes can never
                        // accidentally disturb something already placed.
                        if (touchStartCell) {
                            const midi = Tonnetz.getMidi(touchStartCell.p, touchStartCell.q);
                            Synth.playNote(midi);
                        }
                    }
                }
                // If it was a drag (not a swipe, not a tap), do nothing on touchend.
                // The ghost stays where the user dragged it.
            }
        });
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

    // Register Service Worker for PWA compatibility
    if ('serviceWorker' in navigator) {
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

        // Auto-reload the app immediately when a new service worker finishes activation
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }
};
