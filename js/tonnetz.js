/**
 * tonnetz.js - Core coordinate and music math for Tonntris.
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
    }
};

// Export for tests if needed, but keep it global for file:// usage
if (typeof module !== 'undefined') {
    module.exports = Tonnetz;
}
