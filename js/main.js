/**
 * main.js - Entry point, mode switching, and touch gesture handling.
 */

const App = {
    currentMode: '',

    init: function() {
        const options = document.querySelectorAll('.mode-option');
        options.forEach((opt, idx) => {
            opt.onclick = () => this.setMode(opt.getAttribute('data-mode'), idx);
        });
        
        this.setupMobileControls();
        this.setupTouchGestures();
        this.updateVersionTag();

        // Start in Melody Mode
        this.setMode('midi', 0);
    },

    setMode: function(mode, idx) {
        if (this.currentMode === mode) return;

        const stats = document.getElementById('puzzle-stats');
        const chopCtrls = document.getElementById('chop-controls');
        const clickAction = document.getElementById('click-action');
        const activePill = document.querySelector('.mode-slider-active');
        const options = document.querySelectorAll('.mode-option');

        // Update active class on options
        options.forEach(opt => opt.classList.remove('active'));
        options[idx].classList.add('active');

        // Slide the active background indicator
        if (activePill) {
            activePill.style.transform = `translateX(${idx * 100}%)`;
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

        this.currentMode = mode;

        // Configure mobile action button text based on active mode
        const actionBtn = document.getElementById('m-btn-action');
        if (actionBtn) {
            if (mode === 'gravity') {
                actionBtn.style.display = 'none'; // The down arrow is sufficient for Gravity
            } else {
                actionBtn.style.display = 'block';
                actionBtn.textContent = mode === 'chop' ? 'Place / Pick up' : 'Place Piece';
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

        // Hide/show mobile controls
        const mobileContainer = document.getElementById('mobile-controls');
        if (mobileContainer) {
            if (mode === 'midi' || mode === 'snake') {
                mobileContainer.style.display = 'none';
            } else {
                const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                if (isTouch) mobileContainer.style.display = 'flex';
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
        chopCtrls.style.display = 'none';

        if (mode === 'chop') {
            document.getElementById('placement-controls').style.display = 'block';
            chopCtrls.style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place/Pick up';
            ChopMode.init();
        } else if (mode === 'puzzle') {
            stats.style.display = 'block';
            document.getElementById('placement-controls').style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place Piece';
            PuzzleMode.init();
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
    },

    setupMobileControls: function() {
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const mobileContainer = document.getElementById('mobile-controls');
        
        if (isTouch && mobileContainer) {
            mobileContainer.style.display = 'flex';
            
            const bindBtn = (id, key, code = '', shiftKey = false) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                
                // Use touchstart for instantaneous mobile response, fallback to click
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
            bindBtn('m-btn-ul', 't');                             // Up-Left (t)
            bindBtn('m-btn-ur', 'y');                             // Up-Right (y)
            bindBtn('m-btn-left', 'f');                           // Left (f)
            bindBtn('m-btn-right', 'h');                          // Right (h)
            bindBtn('m-btn-dl', 'v');                             // Down-Left (v) / Soft-drop in Gravity
            bindBtn('m-btn-dr', 'b');                             // Down-Right (b)
            bindBtn('m-btn-action', 'g', '', true);               // Shift-G to place/pick
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
                e.preventDefault();
                return;
            }

            if (this.currentMode === 'midi') {
                if (e.touches.length === 1) {
                    const cell = getCellFromTouch(e.touches[0]);
                    if (cell) {
                        e.preventDefault();
                        MidiMode.handleCellInput(cell.p, cell.q);
                    }
                }
                return;
            }

            if (this.currentMode === 'gravity') return; // Gravity mode handles falling loops, skip touch drag/twist

            if (e.touches.length === 1) {
                isGesture = false;
                const cell = getCellFromTouch(e.touches[0]);
                if (cell) {
                    lastTouchCell = cell;
                    const modeObj = this.currentMode === 'chop' ? ChopMode : PuzzleMode;
                    const pieceType = this.currentMode === 'chop' ? ChopMode.state.selectedPiece : PuzzleMode.state.activePiece;

                    // If a piece is active, prevent default simulated mouse events to block unwanted panning
                    if (pieceType) {
                        e.preventDefault();
                    }

                    // Check for instant pick up in Chop Mode
                    let isPickup = false;
                    if (this.currentMode === 'chop') {
                        isPickup = ChopMode.state.placedPieces.some(piece => {
                            const cells = Pieces.getAbsoluteCells(piece.type, piece.p, piece.q, piece.rotation);
                            return cells.some(c => c.p === cell.p && c.q === cell.q);
                        });
                    }

                    if (isPickup || !pieceType) {
                        // Instant action for notes and picking up pieces
                        modeObj.state.hoverCell = cell;
                        if (this.currentMode === 'chop') {
                            ChopMode.handleAction(cell.p, cell.q);
                        } else {
                            const midi = Tonnetz.getMidi(cell.p, cell.q);
                            Synth.playNote(midi);
                        }
                        lastTapCell = null;
                    } else {
                        // Regular placement flow (preview on first tap, place on second)
                        const isSameCell = lastTapCell && lastTapCell.p === cell.p && lastTapCell.q === cell.q;
                        modeObj.state.hoverCell = cell;
                        modeObj.updateGhost();

                        if (isSameCell) {
                            if (this.currentMode === 'chop') {
                                if (ChopMode.canPlace(ChopMode.state.selectedPiece, cell.p, cell.q, ChopMode.state.rotation)) {
                                    ChopMode.placePiece(cell.p, cell.q);
                                }
                            } else {
                                if (Board.checkPlacement(PuzzleMode.state.activePiece, cell.p, cell.q, PuzzleMode.state.rotation)) {
                                    PuzzleMode.placePiece(cell.p, cell.q);
                                }
                            }
                            lastTapCell = null; // Clear tap
                        } else {
                            lastTapCell = cell;
                        }
                    }
                }
            } else if (e.touches.length === 2) {
                isGesture = true;
                startAngle = getAngle(e.touches[0], e.touches[1]);
                lastAngle = startAngle;
                e.preventDefault(); // Stop viewport scaling/panning while twisting
            }
        }, { passive: false });

        svg.addEventListener('touchmove', (e) => {
            if (this.currentMode === 'midi' || this.currentMode === 'snake') {
                e.preventDefault();
                return;
            }

            if (this.currentMode === 'gravity') return;

            if (e.touches.length === 1 && !isGesture) {
                const cell = getCellFromTouch(e.touches[0]);
                if (cell) {
                    lastTouchCell = cell;
                    const modeObj = this.currentMode === 'chop' ? ChopMode : PuzzleMode;
                    const pieceType = this.currentMode === 'chop' ? ChopMode.state.selectedPiece : PuzzleMode.state.activePiece;

                    // Disable standard page panning/scrolling while dragging an active piece
                    if (this.currentMode === 'puzzle' || (this.currentMode === 'chop' && ChopMode.state.selectedPiece)) {
                        e.preventDefault();
                        modeObj.state.hoverCell = cell;
                        modeObj.updateGhost();
                        lastTapCell = cell; // Align double-tap coordinates to latest dragged cell
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
                    const modeObj = this.currentMode === 'chop' ? ChopMode : PuzzleMode;
                    const rotateDir = diff > 0 ? 1 : -1;
                    const pieceType = this.currentMode === 'chop' ? ChopMode.state.selectedPiece : PuzzleMode.state.activePiece;

                    if (pieceType) {
                        if (rotateDir > 0) {
                            modeObj.state.rotation = (modeObj.state.rotation + 1) % 6;
                        } else {
                            modeObj.state.rotation = (modeObj.state.rotation + 5) % 6;
                        }
                        modeObj.updateGhost();

                        // Sound confirmation of twist rotation
                        const cells = Pieces.getAbsoluteCells(pieceType, modeObj.state.hoverCell.p, modeObj.state.hoverCell.q, modeObj.state.rotation);
                        const midis = cells.map(c => Tonnetz.getMidi(c.p, c.q));
                        Synth.playChord(midis, true, 0.08, 0.4);
                    }

                    lastAngle = currentAngle;
                }
            }
        }, { passive: false });

        svg.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                isGesture = false;
            }
        });
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
            const repo = path.split('/').filter(Boolean)[0] || 'Tonntris';

            const cachedSha = sessionStorage.getItem('tonntris_commit_sha');
            const cachedParentSha = sessionStorage.getItem('tonntris_parent_sha') || '';
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
                    
                    sessionStorage.setItem('tonntris_commit_sha', shortSha);
                    sessionStorage.setItem('tonntris_parent_sha', parentSha);
                    
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
                console.log('Service Worker registered:', reg.scope);
                // Force-check for updates on server to bypass cache
                reg.update().catch(err => console.warn('Service worker update check failed:', err));
            })
            .catch(err => console.error('Service Worker registration failed:', err));

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
