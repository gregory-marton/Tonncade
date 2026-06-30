/**
 * main.js - Entry point and mode switching logic.
 */

const App = {
    currentMode: 'chop',

    init: function() {
        const options = document.querySelectorAll('.mode-option');
        options.forEach((opt, idx) => {
            opt.onclick = () => this.setMode(opt.getAttribute('data-mode'), idx);
        });
        
        this.setupMobileControls();

        // Start in Chop Mode
        ChopMode.init();
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
        Render.svg.onmousedown = null;

        if (typeof GravityMode !== 'undefined' && GravityMode.state.timer) {
            clearInterval(GravityMode.state.timer);
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

        if (mode === 'chop') {
            stats.style.display = 'none';
            document.getElementById('gravity-controls').style.display = 'none';
            document.getElementById('placement-controls').style.display = 'block';
            chopCtrls.style.display = 'block';
            if (clickAction) clickAction.textContent = 'Place/Pick up';
            ChopMode.init();
        } else if (mode === 'puzzle') {
            stats.style.display = 'block';
            document.getElementById('gravity-controls').style.display = 'none';
            document.getElementById('placement-controls').style.display = 'block';
            chopCtrls.style.display = 'none';
            if (clickAction) clickAction.textContent = 'Place Piece';
            PuzzleMode.init();
        } else if (mode === 'gravity') {
            stats.style.display = 'none';
            document.getElementById('gravity-controls').style.display = 'block';
            document.getElementById('placement-controls').style.display = 'none';
            chopCtrls.style.display = 'none';
            GravityMode.init();
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

            bindBtn('m-btn-ccw', 'ArrowLeft', 'ArrowLeft', true); // CCW Rotate fallback
            bindBtn('m-btn-cw', 'ArrowUp', 'ArrowUp', false);     // CW Rotate fallback
            bindBtn('m-btn-ul', 't');                             // Up-Left (t)
            bindBtn('m-btn-ur', 'y');                             // Up-Right (y)
            bindBtn('m-btn-left', 'f');                           // Left (f)
            bindBtn('m-btn-right', 'h');                          // Right (h)
            bindBtn('m-btn-dl', 'v');                             // Down-Left (v) / Soft-drop in Gravity
            bindBtn('m-btn-dr', 'b');                             // Down-Right (b)
            bindBtn('m-btn-action', 'g', '', true);               // Shift-G to place/pick
        }
    }
};

window.onload = () => {
    App.init();

    // Register Service Worker for PWA compatibility
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    }
};
