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

            bindBtn('m-btn-ccw', 'ArrowLeft', 'ArrowLeft', true); // CCW Rotate
            bindBtn('m-btn-cw', 'ArrowUp', 'ArrowUp', false);     // CW Rotate
            bindBtn('m-btn-up', 'y');                             // Move Up (y in puzzle)
            bindBtn('m-btn-left', 'ArrowLeft');                   // Move Left (f / ArrowLeft)
            bindBtn('m-btn-right', 'ArrowRight');                 // Move Right (h / ArrowRight)
            bindBtn('m-btn-down', 'ArrowDown');                   // Move Down / Soft Drop (v / ArrowDown)
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
