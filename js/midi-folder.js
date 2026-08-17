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
 * midi-folder.js - Melody and Compose's shared MIDI source (task #27): the bundled online songs in
 * midi/, plus a local folder the player sets once and browses via one dropdown. The actual
 * mechanism -- remembered folder handle, bundled-tier fetch, dropdown rendering, save-into-folder --
 * lives in js/file-folder.js (FileFolder.create), shared with Life's own YAML automaton source
 * (js/life.js's LifeFolder) rather than reimplemented per mode. Melody and Compose call
 * MidiFolder.setup() with their own DOM ids but this SAME instance, so they browse (and remember)
 * the one folder of songs together.
 */
const MidiFolder = FileFolder.create({
    onlineIndexUrl: './midi/index.json',
    bundledPathPrefix: './midi/',
    // All three listable/browsable in the SAME folder -- MusicXML is the canonical format going
    // forward (docs/melody-notation-design.md), MIDI stays a fully-supported import for files that
    // already exist, and .mxl (compressed MusicXML -- a ZIP container, js/mxl.js) is the format
    // real notation software (MuseScore, Finale, Sibelius) actually exports by default.
    // extensionPattern governs the LOCAL FOLDER listing filter; the bundled online tier's own
    // files are whatever midi/index.json says regardless of this regex.
    extensionPattern: /\.(midi?|musicxml|mxl|xml)$/i,
    readAs: 'arrayBuffer',              // default for anything NOT matched by fileTypes below (.mid)
    mimeType: 'audio/midi',
    loadMethod: 'loadMelodyFromArrayBuffer',
    fileTypes: [
        { pattern: /\.musicxml$/i, readAs: 'text', loadMethod: 'loadMelodyFromMusicXML' },
        { pattern: /\.xml$/i, readAs: 'text', loadMethod: 'loadMelodyFromMusicXML' },
        { pattern: /\.mxl$/i, readAs: 'arrayBuffer', loadMethod: 'loadMelodyFromMxl' },
    ],
    autoLoadFirstBundled: false,
});

if (typeof module !== 'undefined') {
    module.exports = MidiFolder;
}
