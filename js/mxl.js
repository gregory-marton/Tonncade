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
 * mxl.js - Reads a .mxl file (compressed MusicXML -- a plain ZIP container; MuseScore/Finale/
 * Sibelius all export this by default, not bare .musicxml) and extracts the MusicXML text inside
 * it, using the browser's own native DecompressionStream('deflate-raw') rather than vendoring a
 * zip library -- one less third-party dependency/LibreJS review surface (js/vendor/README.md),
 * available in every browser this project already targets (Web MIDI already sets the Chrome-only
 * floor for progressive-enhancement features; DecompressionStream has shipped in Chrome/Edge since
 * 2020 and Firefox/Safari since 2023, well inside that floor).
 *
 * Only the small subset of the ZIP format an .mxl actually needs is implemented: the End Of
 * Central Directory record, central directory entries (name/size/local-header-offset), and each
 * entry's own local file header (read independently, per spec, rather than assumed identical to
 * the central directory's copy). CRC-32 fields are read but never verified -- integrity-checking
 * a file the browser's own fetch/File-System-Access API already delivered intact isn't this
 * module's job. Only STORED (0) and DEFLATE (8) compression methods are supported -- the only two
 * an .mxl in practice ever uses.
 */
const Mxl = {
    ZIP_EOCD_SIGNATURE: 0x06054b50,
    ZIP_CENTRAL_DIR_SIGNATURE: 0x02014b50,
    ZIP_LOCAL_FILE_SIGNATURE: 0x04034b50,

    // Scans backward from the end of the buffer for the End Of Central Directory record --
    // normally the last 22 bytes, but a ZIP may carry a trailing comment of up to 65535 bytes, so
    // the signature isn't necessarily at a fixed offset.
    _findEOCD: function(view, byteLength) {
        const searchFloor = Math.max(0, byteLength - 22 - 65535);
        for (let i = byteLength - 22; i >= searchFloor; i--) {
            if (view.getUint32(i, true) === this.ZIP_EOCD_SIGNATURE) return i;
        }
        throw new Error('Not a valid ZIP (.mxl) archive: no End Of Central Directory record found');
    },

    // Every entry's {name, compressionMethod, compressedSize, data (still COMPRESSED)} -- reading
    // the central directory for the entry list, then each entry's OWN local file header (which can
    // legally have different name/extra-field lengths than the central directory's copy) to find
    // where its actual data starts.
    _readEntries: function(buffer) {
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        const eocdOffset = this._findEOCD(view, buffer.byteLength);
        const entryCount = view.getUint16(eocdOffset + 10, true);
        let offset = view.getUint32(eocdOffset + 16, true); // central directory offset

        const entries = [];
        for (let i = 0; i < entryCount; i++) {
            if (view.getUint32(offset, true) !== this.ZIP_CENTRAL_DIR_SIGNATURE) {
                throw new Error('Malformed ZIP (.mxl) central directory');
            }
            const compressionMethod = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const nameLen = view.getUint16(offset + 28, true);
            const extraLen = view.getUint16(offset + 30, true);
            const commentLen = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
            entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
            offset += 46 + nameLen + extraLen + commentLen;
        }

        entries.forEach((e) => {
            const lo = e.localHeaderOffset;
            if (view.getUint32(lo, true) !== this.ZIP_LOCAL_FILE_SIGNATURE) {
                throw new Error('Malformed ZIP (.mxl) local file header for entry "' + e.name + '"');
            }
            const nameLen = view.getUint16(lo + 26, true);
            const extraLen = view.getUint16(lo + 28, true);
            const dataStart = lo + 30 + nameLen + extraLen;
            e.data = bytes.subarray(dataStart, dataStart + e.compressedSize);
        });
        return entries;
    },

    _inflate: async function(entry) {
        if (entry.compressionMethod === 0) return entry.data; // STORED -- already raw
        if (entry.compressionMethod === 8) { // DEFLATE
            const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error('Unsupported ZIP compression method ' + entry.compressionMethod + ' in .mxl entry "' + entry.name + '" (only STORED/DEFLATE are supported)');
    },

    // Extracts and returns the root MusicXML document's text from a .mxl ArrayBuffer. Per the
    // OPC/MusicXML container spec, META-INF/container.xml names the actual root file
    // (<rootfile full-path="...">); falls back to the first non-META-INF .xml/.musicxml entry if
    // container.xml is missing or its rootfile tag can't be found -- some real-world exporters
    // get this wrong, and a working file shouldn't be rejected over it.
    extractMusicXML: async function(buffer) {
        const entries = this._readEntries(buffer);
        const containerEntry = entries.find((e) => e.name === 'META-INF/container.xml');
        let rootPath = null;
        if (containerEntry) {
            const containerXml = new TextDecoder('utf-8').decode(await this._inflate(containerEntry));
            const match = containerXml.match(/full-path=["']([^"']+)["']/);
            if (match) rootPath = match[1];
        }
        let target = rootPath ? entries.find((e) => e.name === rootPath) : null;
        if (!target) {
            target = entries.find((e) => /\.(musicxml|xml)$/i.test(e.name) && e.name !== 'META-INF/container.xml');
        }
        if (!target) throw new Error('No MusicXML entry found inside this .mxl archive');
        return new TextDecoder('utf-8').decode(await this._inflate(target));
    },
};

if (typeof module !== 'undefined') {
    module.exports = Mxl;
}
