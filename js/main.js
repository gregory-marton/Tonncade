/**
 * main.js - Entry point and mode switching logic.
 */

const App = {
    currentMode: 'chop',

    init: function() {
        const toggleBtn = document.getElementById('toggle-mode');
        toggleBtn.onclick = () => this.switchMode();
        
        // Start in Chop Mode
        ChopMode.init();
    },

    switchMode: function() {
        const badge = document.getElementById('mode-badge');
        const toggleBtn = document.getElementById('toggle-mode');
        const stats = document.getElementById('puzzle-stats');
        const chopCtrls = document.getElementById('chop-controls');
        const clickAction = document.getElementById('click-action');

        // Clean up global listeners
        window.onkeydown = null;
        window.onmousemove = null;
        Render.svg.onmousedown = null;

        if (this.currentMode === 'chop') {
            this.currentMode = 'puzzle';
            badge.textContent = 'PUZZLE MODE';
            toggleBtn.textContent = 'Switch to Chop Mode';
            stats.style.display = 'block';
            chopCtrls.style.display = 'none';
            clickAction.textContent = 'Place Piece';
            PuzzleMode.init();
        } else {
            this.currentMode = 'chop';
            badge.textContent = 'CHOP MODE';
            toggleBtn.textContent = 'Switch to Puzzle Mode';
            stats.style.display = 'none';
            chopCtrls.style.display = 'block';
            clickAction.textContent = 'Place/Pick up';
            ChopMode.init();
        }
    }
};

window.onload = () => App.init();
