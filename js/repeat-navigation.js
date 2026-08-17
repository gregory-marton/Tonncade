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
 * repeat-navigation.js - unrolls MusicXML repeat/jump structure (<repeat>, <ending> "voltas", and
 * the dacapo/dalsegno/tocoda/fine/segno/coda <sound> directives) into a flat, ordered list of
 * measure elements to play -- one small navigation state machine, per docs/melody-notation-design.md:
 *
 *   "Repeats AND D.C./D.S./Coda/Fine, both fully unrolled at import via one navigation state
 *   machine ... Read-only, one-way ... Not displayed."
 *
 * This module only ever produces a measure ORDER (with the same <measure> element appearing more
 * than once for a repeated section) -- it never mutates the document, never gets called from
 * MusicXML.write (there is no reverse direction: a piece written by this app is always already
 * flat), and the result is never rendered as repeat/jump notation, only as the plain sequence of
 * notes it expands to.
 *
 * Deliberately bounded, not a general score-navigation engine: exactly one repeat pass (a measure
 * range plays twice, matching <repeat> without an explicit times="N"), one Segno, one Coda. Real
 * folk/children's songs -- this app's actual content -- essentially never need more than that;
 * flagged rather than silently limiting further without saying so.
 */
const RepeatNavigation = {
    // Reads each measure's own navigation-relevant markers into a plain descriptor, without
    // touching the DOM. `endingNumbers` supports MusicXML's comma-separated "1,2" form (a single
    // ending bracket covering more than one pass).
    describeMeasure: function(measureEl) {
        const repeatForward = !!measureEl.querySelector('barline[location="left"] repeat[direction="forward"]');
        const repeatBackwardEl = measureEl.querySelector('barline[location="right"] repeat[direction="backward"]');
        const endingStartEl = measureEl.querySelector('barline ending[number]');
        let endingNumbers = null;
        if (endingStartEl) {
            endingNumbers = endingStartEl.getAttribute('number').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        }
        const soundEl = measureEl.querySelector('sound');
        const soundAttr = (name) => soundEl && soundEl.hasAttribute(name) ? soundEl.getAttribute(name) : null;
        return {
            repeatForward,
            repeatBackward: !!repeatBackwardEl,
            endingNumbers,
            dacapo: soundAttr('dacapo') === 'yes',
            dalsegno: soundAttr('dalsegno'), // a segno "name" to jump to (usually the only one)
            tocoda: soundAttr('tocoda'),
            fine: soundAttr('fine') === 'yes',
            segno: soundAttr('segno'),
            coda: soundAttr('coda'),
        };
    },

    // Returns the ordered list of <measure> ELEMENTS to actually play (the same element may
    // appear more than once, for a repeated section) -- callers walk this instead of the
    // document's own raw measure order.
    resolveMeasureOrder: function(measureEls) {
        const measures = [...measureEls];
        const desc = measures.map((el) => this.describeMeasure(el));
        if (measures.length === 0) return [];

        // The Segno/Coda markers must be known BEFORE the walk ever needs them -- a D.S. jump
        // typically fires from a measure that comes BEFORE the Coda section physically appears in
        // the score (that's the whole point: the performer jumps forward to content not yet
        // reached on the first linear pass), so discovering them lazily while walking would mean
        // "Where's the coda?" gets asked before it's ever been seen. One pre-scan up front, not
        // folded into the navigation walk below.
        let segnoIndex = null;
        let codaIndex = null;
        desc.forEach((d, idx) => {
            if (d.segno) segnoIndex = idx;
            if (d.coda) codaIndex = idx;
        });

        const order = [];
        let i = 0;
        let lastRepeatStart = 0;
        const passCountAt = {}; // repeatStartIndex -> how many times that section has been entered
        let returning = false; // true once a D.C./D.S. has sent us backward -- gates tocoda/fine,
                                // which are only honored on the pass BACK, never the first time through
        let guard = 0;
        const GUARD_LIMIT = measures.length * 8 + 32; // generous but finite -- a malformed/circular
                                                        // file must still terminate, not hang the import

        while (i < measures.length && guard++ < GUARD_LIMIT) {
            const d = desc[i];

            const currentPass = passCountAt[lastRepeatStart] || 1;
            if (d.endingNumbers && !d.endingNumbers.includes(currentPass)) {
                i++;
                continue; // this measure belongs to a DIFFERENT pass's ending -- skip its content entirely
            }

            order.push(measures[i]);

            if (d.repeatForward) lastRepeatStart = i;

            if (d.repeatBackward) {
                const nextPass = (passCountAt[lastRepeatStart] || 1) + 1;
                if (nextPass <= 2) { // exactly one repeat pass supported, see file header
                    passCountAt[lastRepeatStart] = nextPass;
                    i = lastRepeatStart;
                    continue;
                }
            }

            if (returning && d.fine) break;
            if (returning && d.tocoda && codaIndex !== null) { i = codaIndex; continue; }
            if (d.dacapo) { returning = true; i = 0; continue; }
            if (d.dalsegno && segnoIndex !== null) { returning = true; i = segnoIndex; continue; }

            i++;
        }
        return order;
    },
};

if (typeof module !== 'undefined') {
    module.exports = RepeatNavigation;
}
