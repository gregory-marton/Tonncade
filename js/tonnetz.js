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
            return 35 + (p * -3) + (q * 4);
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
