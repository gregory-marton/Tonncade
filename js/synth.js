/**
 * synth.js - Web Audio engine for Tonnetz Tetris.
 * Ported and expanded from mockup.
 */

const Synth = {
    ctx: null,
    master: null,
    lowpass: null,

    init: function() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        
        this.lowpass = this.ctx.createBiquadFilter();
        this.lowpass.type = 'lowpass';
        this.lowpass.frequency.value = 2600;
        
        this.master.connect(this.lowpass);
        this.lowpass.connect(this.ctx.destination);
    },

    playNote: function(midi, t0 = 0, dur = 0.8, peak = 0.16) {
        this.init();
        const now = this.ctx.currentTime;
        const startTime = now + t0;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
        
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(peak, startTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0006, startTime + dur);
        
        osc.connect(gain);
        gain.connect(this.master);
        
        osc.start(startTime);
        osc.stop(startTime + dur + 0.05);
    },

    playChord: function(midis, rolled = true) {
        this.init();
        const t = 0;
        midis.forEach((m, i) => {
            const delay = rolled ? i * 0.06 : 0;
            this.playNote(m, delay, 1.2);
        });
    }
};
