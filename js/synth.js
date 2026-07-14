/**
 * synth.js - Web Audio engine for Tonntris.
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

        // Biquad lowshelf filter to boost bass on smaller speakers
        this.lowshelf = this.ctx.createBiquadFilter();
        this.lowshelf.type = 'lowshelf';
        this.lowshelf.frequency.value = 320; // Boost frequencies below ~320Hz (E4)
        this.lowshelf.gain.value = 8; // 8dB boost

        this.master.connect(this.lowshelf);
        this.lowshelf.connect(this.lowpass);
        this.lowpass.connect(this.ctx.destination);
    },

    playNote: function(midi, t0 = 0, dur = 0.8, peak = 0.16, isHarmonic = false) {
        this.init();
        
        let playableMidi = midi;
        if (!isHarmonic) {
            while (playableMidi < 21) playableMidi += 12;
            while (playableMidi > 108) playableMidi -= 12;
        }

        const now = this.ctx.currentTime;
        const startTime = now + t0;

        // Progressive volume scaling for low notes:
        let notePeak = peak;
        if (!isHarmonic && playableMidi < 60) {
            const octavesBelow = (60 - playableMidi) / 12;
            notePeak = peak * (1.0 + octavesBelow * 0.6); // Up to 2.8x volume boost
        }
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.value = 440 * Math.pow(2, (playableMidi - 69) / 12);
        
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(notePeak, startTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0006, startTime + dur);
        
        osc.connect(gain);
        gain.connect(this.master);
        
        osc.start(startTime);
        osc.stop(startTime + dur + 0.05);

        // Psychoacoustic bass enhancement: add a subtle higher-octave harmonic for low notes
        if (!isHarmonic && playableMidi < 50) {
            this.playNote(playableMidi + 12, t0, dur, notePeak * 0.4, true);
        }
    },

    playChord: function(midis, rolled = true, peak = 0.16, dur = 1.2) {
        this.init();
        midis.forEach((m, i) => {
            const delay = rolled ? i * 0.06 : 0;
            this.playNote(m, delay, dur, peak);
        });
    }
};
