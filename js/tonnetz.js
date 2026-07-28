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
 * tonnetz.js - Core coordinate and music math for Tonncade.
 * 
 * Lattice Geometry:
 * - p-axis (horizontal): Perfect Fifths (+7 semitones)
 * - q-axis (diagonal up-right): Major Thirds (+4 semitones)
 * - third axis (diagonal up-left): Minor Thirds (+3 semitones)
 * 
 * Coordinates are axial (p, q).
 */

const Tonnetz = {
    // Harmonic Table mapping: 
    // p-axis (horizontal): +7 (Fifth)
    // q-axis (sw-ne): +3 (Minor Third)
    // Resultant (nw-se): +4 (Major Third)  [ (p+1, q-1) -> 7-3=4 ]
    getMidi: function(p, q) {
        if (typeof App !== 'undefined' && App.currentMode === 'gravity') {
            // Base 23 (not 35) puts Gravity's board an octave lower, so its pile end sits in deep-
            // but-audible bass now that true pitch is played (INV-46). Same interval geometry
            // (fifths down p, major thirds up q), just an octave down.
            return 23 + (p * -3) + (q * 4);
        }
        return 60 + (p * 7) + (q * 3);
    },

    getNoteName: function(midi) {
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return names[((midi % 12) + 12) % 12];
    },

    getOctave: function(midi) {
        return Math.floor(midi / 12) - 1;
    },

    // Standard MIDI-to-Hz conversion (A4 = MIDI 69 = 440Hz), unclamped -- deliberately NOT the
    // same as what actually comes out of the speaker for an extreme note (Synth.playNote octave-
    // wraps anything outside MIDI 21-108 before computing its OWN frequency from that wrapped
    // value -- see js/synth.js). This is for DISPLAY: showing a note's true pitch, e.g. to tell
    // two different-octave "E"s apart at a glance (see INV-25), not the possibly-different pitch
    // that note actually plays back at.
    getFrequency: function(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    },

    // The range of human hearing, ~20 Hz to ~20 kHz. In MIDI terms (inverse of getFrequency) that
    // is ~15.5 to ~135.1, so MIDI 135 (~19.9 kHz) is the highest fully-audible integer note and
    // MIDI 16 (~20.6 Hz) the lowest. The pannable lattice is drawn out to the TOP of hearing --
    // replacing the old MIDI-protocol ceiling of 127 (~12.5 kHz), which stopped ~7.5 semitones
    // short of it. (The math is defined far beyond hearing; this is just how far we draw.)
    HEARING_MIN_HZ: 20,
    HEARING_MAX_HZ: 20000,
    midiFromFrequency: function(hz) {
        return 69 + 12 * Math.log2(hz / 440);
    },
    audibleMaxMidi: function() {
        return Math.floor(this.midiFromFrequency(this.HEARING_MAX_HZ)); // 135
    },
    audibleMinMidi: function() {
        return Math.ceil(this.midiFromFrequency(this.HEARING_MIN_HZ));   // 16
    },
    isAudible: function(midi) {
        return midi >= this.audibleMinMidi() && midi <= this.audibleMaxMidi();
    },

    // Gravity <-> canonical coordinate transforms (for cross-mode copy/paste).
    //
    // Gravity's pitch mapping (23 - 3p + 4q) is EXACTLY the standard Tonnetz (60 + 7p + 3q) rotated
    // 120 degrees -- an integer lattice automorphism (the same interval set {3,4,7} per hex step,
    // reassigned to different directions). So there is one canonical coordinate system (standard),
    // and Gravity's coords convert to/from it by a fixed affine integer transform that PRESERVES
    // PITCH. Cross-mode copy/paste stores canonical (p,q) and lets Gravity translate at its edge;
    // pitch is then preserved automatically, with no frequency search and no same-pitch collisions.
    //
    // Derived from getMidi_standard(canonical) === getMidi_gravity(p,q); verified by test.
    gravityToCanonical: function(p, q) {
        return { p: q - 4, q: -p - q - 3 };
    },
    canonicalToGravity: function(p, q) {
        return { p: -p - q - 7, q: p + 4 };
    },

    // Neighbors in 6 directions
    getNeighbors: function(p, q) {
        return [
            { p: p + 1, q: q },     // +5th
            { p: p - 1, q: q },     // -5th
            { p: p, q: q + 1 },     // +Maj3
            { p: p, q: q - 1 },     // -Maj3
            { p: p - 1, q: q + 1 }, // +Min3 (up-left)
            { p: p + 1, q: q - 1 }  // -Min3 (down-right)
        ];
    },

    // Check if a MIDI note is within the standard 0-127 range
    isValid: function(p, q) {
        const midi = this.getMidi(p, q);
        return midi >= 0 && midi <= 127;
    },

    // getMidi(p,q) = 60 + 7p + 3q is not injective -- any given pitch sits at infinitely many
    // (p,q), differing by multiples of (3,-7) (since 7*3 + 3*-7 = 0). Given a target midi pitch
    // and a reference point, finds the specific (p,q) solution closest (by hex distance) to that
    // reference -- used by Compose mode to lay a loaded melody (which only stores midi/time/
    // duration, not p/q) out on the lattice as one coherent, connected path rather than an
    // arbitrary one. Standard tuning only (the p:+7/q:+3 mapping); not meaningful in Gravity mode.
    // Shared by nearestCoordFor and allCoordsFor below: exactly one baseP in {0,1,2} solves
    // target - 7*baseP === 0 (mod 3), since 7 === 1 (mod 3); every other solution is
    // (baseP + 3t, baseQ - 7t) for integer t.
    _baseCoordFor: function(target) {
        for (let p = 0; p < 3; p++) {
            const rem = target - 7 * p;
            if (rem % 3 === 0) return { p, q: rem / 3 };
        }
        return { p: 0, q: 0 }; // unreachable -- some p in 0..2 always solves it
    },

    nearestCoordFor: function(midi, near) {
        near = near || { p: 0, q: 0 };
        const base = this._baseCoordFor(midi - 60);

        // Hex distance from `near` grows roughly linearly with |t|, so a small bracketing
        // window is always sufficient.
        let best = base;
        let bestDist = Infinity;
        for (let t = -6; t <= 6; t++) {
            const p = base.p + 3 * t;
            const q = base.q - 7 * t;
            const dp = p - near.p;
            const dq = q - near.q;
            const dist = (Math.abs(dp) + Math.abs(dq) + Math.abs(dp + dq)) / 2;
            if (dist < bestDist) {
                bestDist = dist;
                best = { p, q };
            }
        }
        return best;
    },

    // All (p,q) solutions to getMidi(p,q) === midi within `maxT` steps of the (3,-7) family --
    // used by Blast's chord-placement search (js/blast.js), which needs every candidate, not
    // just the nearest one, since a piece can slide along this exact direction and keep every
    // cell's pitch unchanged (that's *why* more than one on-board placement can match the same
    // played chord). maxT=6 comfortably covers Board.radius (5) from any starting point, since
    // hex distance grows ~linearly with |t|.
    allCoordsFor: function(midi, maxT = 6) {
        const base = this._baseCoordFor(midi - 60);
        const coords = [];
        for (let t = -maxT; t <= maxT; t++) {
            coords.push({ p: base.p + 3 * t, q: base.q - 7 * t });
        }
        return coords;
    },

    analyzeChord: function(midis) {
        const matches = this.analyzeAllChords(midis);
        if (matches.length === 0) return null;
        return matches.join(' / ');
    },

    // Analyze all possible chord names for a list of MIDI notes
    analyzeAllChords: function(midis) {
        if (!midis || midis.length === 0) return [];
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const uniquePitches = [...new Set(midis.map(m => ((m % 12) + 12) % 12))];

        if (uniquePitches.length <= 1) {
            return [];
        }

        const templates = [
            // 4-note
            { intervals: [0, 4, 7, 11], name: 'Maj7' },
            { intervals: [0, 3, 7, 10], name: 'm7' },
            { intervals: [0, 4, 7, 10], name: '7' },
            { intervals: [0, 3, 6, 10], name: 'm7b5' },
            { intervals: [0, 3, 6, 9], name: 'dim7' },
            { intervals: [0, 4, 7, 9], name: '6' },
            { intervals: [0, 3, 7, 9], name: 'm6' },
            { intervals: [0, 2, 7, 9], name: 'Pentatonic Stack' },
            { intervals: [0, 5, 7, 10], name: '7sus4' },
            { intervals: [0, 3, 7, 11], name: 'm(Maj7)' },
            { intervals: [0, 4, 6, 10], name: '7b5' },
            { intervals: [0, 4, 8, 10], name: '7#5' },
            { intervals: [0, 4, 8, 11], name: 'Maj7#5' },
            { intervals: [0, 2, 4, 7], name: 'add9' },
            { intervals: [0, 2, 3, 7], name: 'madd9' },
            { intervals: [0, 1, 4, 10], name: '7b9 (shell)' },
            { intervals: [0, 3, 4, 10], name: '7#9 (shell)' },
            { intervals: [0, 2, 7, 10], name: '7sus2' },
            { intervals: [0, 3, 5, 10], name: 'Quartal Stack' },
            // 3-note
            { intervals: [0, 4, 7], name: 'Major' },
            { intervals: [0, 3, 7], name: 'Minor' },
            { intervals: [0, 2, 7], name: 'Sus2' },
            { intervals: [0, 5, 7], name: 'Sus4' },
            { intervals: [0, 7, 11], name: 'Maj7 (shell)' },
            { intervals: [0, 7, 10], name: '7 (shell)' },
            { intervals: [0, 4, 11], name: 'Maj7 (shell)' },
            { intervals: [0, 4, 10], name: '7 (shell)' },
            { intervals: [0, 3, 10], name: 'm7 (shell)' },
            { intervals: [0, 3, 11], name: 'm(Maj7) (shell)' },
            { intervals: [0, 3, 6], name: 'dim' },
            { intervals: [0, 4, 8], name: 'aug' },
            // 2-note
            { intervals: [0, 7], name: '5 (Fifth)' },
            { intervals: [0, 4], name: 'Major 3rd' },
            { intervals: [0, 3], name: 'Minor 3rd' },
            { intervals: [0, 5], name: '4th' },
            { intervals: [0, 9], name: '6th' },
            { intervals: [0, 10], name: 'm7 (interval)' },
            { intervals: [0, 11], name: 'Maj7 (interval)' },
            { intervals: [0, 2], name: 'Major 2nd' },
            { intervals: [0, 8], name: 'Minor 6th' },
            { intervals: [0, 6], name: 'Tritone' }
        ];

        const matches = [];
        for (const t of templates) {
            for (const root of uniquePitches) {
                const rel = uniquePitches.map(p => (p - root + 12) % 12).sort((a, b) => a - b);
                if (rel.length === t.intervals.length && rel.every((v, i) => v === t.intervals[i])) {
                    matches.push(`${noteNames[root]} ${t.name}`);
                }
            }
        }

        return matches;
    }
};

// Export for tests if needed, but keep it global for file:// usage
if (typeof module !== 'undefined') {
    module.exports = Tonnetz;
}
