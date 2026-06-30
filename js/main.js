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
        
        // Start in Chop Mode
        ChopMode.init();
    },

    setMode: function(mode, idx) {
        if (this.currentMode === mode) return;

        const badge = document.getElementById('mode-badge');
        const stats = document.getElementById('puzzle-stats');
        const chopCtrls = document.getElementById('chop-controls');
        const clickAction = document.getElementById('click-action');
        const activePill = document.querySelector('.mode-slider-active');
        const options = document.querySelectorAll('.mode-option');

        // Update active class on options
        options.forEach(opt => opt.classList.remove('active'));
        options[idx].classList.add('active');

        // Slide the active background indicator
        activePill.style.transform = `translateX(${idx * 100}%)`;

        // Clean up global listeners
        window.onkeydown = null;
        window.onmousemove = null;
        Render.svg.onmousedown = null;

        if (typeof GravityMode !== 'undefined' && GravityMode.state.timer) {
            clearInterval(GravityMode.state.timer);
        }

        this.currentMode = mode;

        if (mode === 'chop') {
            badge.textContent = 'CHOP MODE';
            stats.style.display = 'none';
            document.getElementById('gravity-controls').style.display = 'none';
            document.getElementById('placement-controls').style.display = 'block';
            chopCtrls.style.display = 'block';
            clickAction.textContent = 'Place/Pick up';
            ChopMode.init();
        } else if (mode === 'puzzle') {
            badge.textContent = 'PUZZLE MODE';
            stats.style.display = 'block';
            document.getElementById('gravity-controls').style.display = 'none';
            document.getElementById('placement-controls').style.display = 'block';
            chopCtrls.style.display = 'none';
            clickAction.textContent = 'Place Piece';
            PuzzleMode.init();
        } else if (mode === 'gravity') {
            badge.textContent = 'GRAVITY MODE';
            stats.style.display = 'none';
            document.getElementById('gravity-controls').style.display = 'block';
            document.getElementById('placement-controls').style.display = 'none';
            chopCtrls.style.display = 'none';
            GravityMode.init();
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
