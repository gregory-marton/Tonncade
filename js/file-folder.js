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
 * file-folder.js - a local folder + bundled-online-tier file source, one <select> per mode, shared
 * by Melody/Compose (js/midi-folder.js's MidiFolder, .mid files) and Life (js/life.js's LifeFolder,
 * .yaml files). Extracted from what used to be MidiFolder's own hard-coded implementation, the same
 * way js/board.js's createBoard(shape) factors Board/GravityBoard out of one shared shape -- each
 * FileFolder.create(config) instance is independent (its own online index URL, extension filter,
 * read mode), but all instances remember the SAME local folder handle (one shared IndexedDB entry):
 * a player who once points Tonncade at "my tonncade files" folder has that folder work for Melody,
 * Compose, AND Life alike, each just filtering it down to the files it understands.
 *
 * Chrome-only progressive enhancement for the local-folder tier: uses the File System Access API
 * (window.showDirectoryPicker), which Safari/Firefox don't implement, matching the same Chrome-only
 * precedent already established for Web MIDI (js/midi-input.js). Unsupported browsers fall back to a
 * mode's own plain <input type=file> picker (kept untouched, just hidden when the folder tier is
 * available) plus whatever the bundled online tier provides.
 *
 * The single <select> a mode wires this to (config passed as `ids.sourceSelect`) lists, top to
 * bottom: an optional synthetic "Random" entry (config.hasRandom -- Melody only, its existing
 * offline-degrade made an explicit, reselectable choice); then either the bundled online songs OR,
 * once a local folder is set, that folder's own listing (never both -- the folder supersedes the
 * bundled tier, per the whole point of "once established, browse from there"); then a trailing
 * "Choose Local Folder…" / "Change Folder…" / "Reconnect Folder" action item, present whenever the
 * File System Access API exists at all.
 */
const FileFolder = {
    // All instances remember the same directory -- see the module comment above.
    DB_NAME: 'tonncade_file_folder',
    STORE_NAME: 'handles',
    HANDLE_KEY: 'folder',

    create: function(config) {
        return Object.assign(Object.create(FileFolder._proto), {
            onlineIndexUrl: config.onlineIndexUrl,
            bundledPathPrefix: config.bundledPathPrefix,
            extensionPattern: config.extensionPattern,
            readAs: config.readAs || 'arrayBuffer',          // 'arrayBuffer' | 'text'
            mimeType: config.mimeType || 'application/octet-stream',
            loadMethod: config.loadMethod || 'loadMelodyFromArrayBuffer',
            // Life's bundled default auto-loads on first visit (its long-standing behavior);
            // Melody/Compose don't -- Melody already has its own offline-degrade default
            // (randomMelody), and Compose has no "starting content" concept at all.
            autoLoadFirstBundled: !!config.autoLoadFirstBundled,
            onlineIndex: null,
            fileHandles: null,
            folderHandle: null,
            needsReconnect: false,
            currentValue: null,
            _token: 0,
            _autoLoaded: false,
        });
    },

    _proto: {
        // Invalidates any load still in flight for this instance -- call ONLY from js/main.js's
        // setMode, at the moment a mode that actually owns this instance is being left, so a
        // bundled/folder fetch that resolves after the player has moved elsewhere never repaints
        // the shared canvas out from under whatever mode is now showing (#15, #16). setup()'s own
        // fresh token on RE-entry already covers the "left Life and came back" case; this covers
        // "left and went somewhere else entirely."
        //
        // Deliberately NOT called from each mode's own cleanup(): several modes' cleanup() is
        // reused internally too (e.g. MelodyMode.resetGame() calls this.cleanup() as part of normal
        // ENTRY, not just on exit), so it fires far more often than "the player actually left."
        // setMode is the one place that reliably knows the outgoing mode was really outgoing.
        invalidate: function() {
            this._token++;
        },

        isSupported: function() {
            return typeof window !== 'undefined' && !!window.showDirectoryPicker;
        },

        openDB: function() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(FileFolder.DB_NAME, 1);
                req.onupgradeneeded = () => { req.result.createObjectStore(FileFolder.STORE_NAME); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        },

        saveHandle: async function(handle) {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(FileFolder.STORE_NAME, 'readwrite');
                tx.objectStore(FileFolder.STORE_NAME).put(handle, FileFolder.HANDLE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        },

        loadHandle: async function() {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(FileFolder.STORE_NAME, 'readonly');
                const req = tx.objectStore(FileFolder.STORE_NAME).get(FileFolder.HANDLE_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        },

        // Wires the single <select> and attempts to restore the shared local folder. `ids` names
        // this mode's own DOM elements (sourceSelect, sourceStatus, uploadGroup); `opts.hasRandom`
        // is Melody's own synthetic top entry. Re-entrant: called again every time a mode is
        // (re-)entered, same as before -- a fresh `_token` guards any load still in flight from a
        // previous visit against repainting after the player has moved on (#15, #16's fix,
        // generalized here rather than staying Life-only).
        setup: async function(mode, ids, opts) {
            this.mode = mode;
            this.ids = ids;
            this.hasRandom = !!(opts && opts.hasRandom);
            const token = ++this._token;
            if (this.hasRandom && this.currentValue === null) this.currentValue = 'random';

            const select = document.getElementById(ids.sourceSelect);
            if (select) {
                select.onchange = () => this.handleSelect(select.value);
                // Re-list on open, not just at setup/reconnect/choose-folder/post-save time -- a
                // FileSystemDirectoryHandle's .values() genuinely re-reads the OS on every call
                // (Chrome doesn't cache directory contents), so the underlying data was never
                // stale; only the trigger to re-read it was missing, meaning a file moved/renamed/
                // added on disk outside the app stayed invisible until one of those other actions
                // happened to fire. mousedown/focus fire before the native dropdown paints, so this
                // is necessarily best-effort (the async re-list can't block a synchronous native
                // popup) -- the CURRENT open may still show what was cached, but the next one won't.
                const refresh = () => this.refreshFileList();
                select.addEventListener('mousedown', refresh);
                select.addEventListener('focus', refresh);
            }

            await this.setupOnline(token);
            if (token !== this._token) return;

            if (this.isSupported()) {
                const uploadGroup = document.getElementById(ids.uploadGroup);
                if (uploadGroup) uploadGroup.style.display = 'none';
                await this.restore(token);
                if (token !== this._token) return;
            }

            this.renderOptions();
        },

        _fetchBundled: async function(file) {
            const res = await fetch(this.bundledPathPrefix + file);
            if (!res.ok) throw new Error(String(res.status));
            return this.readAs === 'text' ? res.text() : res.arrayBuffer();
        },

        // Populates the bundled online tier from onlineIndexUrl -- a plain relative fetch, works on
        // any http(s) host, simply absent under file:// or offline (caught, left null).
        setupOnline: async function(token) {
            try {
                const res = await fetch(this.onlineIndexUrl);
                if (!res.ok) throw new Error(String(res.status));
                const index = await res.json();
                this.onlineIndex = (Array.isArray(index) && index.length) ? index : null;
            } catch (err) {
                this.onlineIndex = null;
            }
            if (token !== this._token) return;
            // Only ever once (`_autoLoaded`, not just "no folder chosen yet") -- otherwise every
            // re-entry into a mode (e.g. Life) would re-fetch and overwrite the player's current
            // live state with the pristine bundled seed, violating INV-48 (switching away from a
            // mode must pause its state, never reset or re-advance it).
            if (this.autoLoadFirstBundled && this.onlineIndex && !this._autoLoaded && !(this.fileHandles && this.fileHandles.length)) {
                this._autoLoaded = true;
                await this.loadOnlineFile(0, token);
            }
        },

        loadOnlineFile: async function(index, token) {
            const song = this.onlineIndex && this.onlineIndex[index];
            if (!song) return;
            try {
                const content = await this._fetchBundled(song.file);
                if (token !== undefined && token !== this._token) return;
                this.mode[this.loadMethod](content, song.file);
                this.currentValue = 'bundled:' + index;
            } catch (err) {
                console.warn(`Could not load bundled file "${song.name}":`, err);
            }
            this.renderOptions();
        },

        // Attempts to silently pick back up the remembered shared folder. A granted permission
        // survives quietly; a lapsed one needs a single user-gesture click to re-grant (browsers
        // require this for security -- silently re-requesting isn't possible), surfaced as a
        // "Reconnect Folder" entry in the select rather than a hidden failure.
        restore: async function(token) {
            let handle;
            try {
                handle = await this.loadHandle();
            } catch (err) {
                console.warn('Could not read the remembered folder:', err);
                return;
            }
            if (!handle || (token !== undefined && token !== this._token)) return;
            this.folderHandle = handle;
            // 'readwrite', not 'read' -- saveFileAs needs to actually write into this folder, not
            // just list it. A folder granted under the old read-only default (before this fix)
            // queries as not-granted here and correctly falls into needsReconnect below, prompting
            // one re-grant click rather than silently downgrading writes to a download forever.
            const permission = await handle.queryPermission({ mode: 'readwrite' });
            if (token !== undefined && token !== this._token) return;
            if (permission === 'granted') {
                await this.listFiles(handle, token);
            } else {
                this.needsReconnect = true;
            }
        },

        reconnect: async function() {
            if (!this.folderHandle) return;
            const permission = await this.folderHandle.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') await this.listFiles(this.folderHandle);
            else this.renderOptions();
        },

        chooseFolder: async function() {
            let handle;
            try {
                // 'readwrite' -- without this, showDirectoryPicker defaults to read-only, and
                // saveFileAs's write below throws (permission denied), silently falling back to a
                // browser download instead of writing into the chosen folder as the player expects.
                handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (err) {
                // AbortError: the player closed the picker without choosing anything -- expected,
                // not worth logging. Either way, put the select back to what's actually loaded.
                if (err && err.name !== 'AbortError') console.warn('Folder selection failed:', err);
                this.renderOptions();
                return;
            }

            // Persisting the handle (so next visit, and every other mode, can skip re-picking) is a
            // nice-to-have, separate from actually being able to browse the folder THIS session.
            try { await this.saveHandle(handle); }
            catch (err) { console.warn('Could not remember this folder for next time:', err); }

            await this.copyDefaultsInto(handle);
            await this.listFiles(handle);
        },

        // Backfills the newly-chosen folder with this mode's bundled defaults it doesn't already
        // have (by filename), so "the dropdown should be populated from there" doesn't mean losing
        // the built-in songs/automata the player already knows -- they get copied in once, not
        // re-copied or overwritten on every visit.
        copyDefaultsInto: async function(handle) {
            if (!this.onlineIndex) return;
            for (const song of this.onlineIndex) {
                try {
                    const existing = await handle.getFileHandle(song.file).catch(() => null);
                    if (existing) continue;
                    const content = await this._fetchBundled(song.file);
                    const fileHandle = await handle.getFileHandle(song.file, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                } catch (err) {
                    console.warn(`Could not copy bundled file "${song.file}" into the folder:`, err);
                }
            }
        },

        listFiles: async function(handle, token) {
            this.folderHandle = handle;
            this.needsReconnect = false;
            const files = [];
            for await (const entry of handle.values()) {
                if (entry.kind === 'file' && this.extensionPattern.test(entry.name)) files.push(entry);
            }
            files.sort((a, b) => a.name.localeCompare(b.name));
            this.fileHandles = files;
            if (token !== undefined && token !== this._token) return;
            if (files.length > 0) await this.loadFileAt(0, token);
            else this.renderOptions();
        },

        // Re-reads the folder's listing WITHOUT touching what's currently loaded -- unlike
        // listFiles (which always auto-loads index 0), this is meant to run silently just from
        // the player opening the dropdown, and must never replace their in-progress content just
        // because they hovered a menu. Since the listing is re-sorted alphabetically every time,
        // a plain numeric index can silently point at a DIFFERENT file after an external rename/
        // add/remove -- so the currently-selected file is re-found by NAME in the fresh listing
        // and currentValue's index is corrected to match, rather than trusting the old index.
        refreshFileList: async function() {
            if (!this.folderHandle || this.needsReconnect) return;
            const currentName = (this.currentValue && this.currentValue.startsWith('local:') && this.fileHandles)
                ? (this.fileHandles[parseInt(this.currentValue.slice(6), 10)] || {}).name
                : null;

            const files = [];
            try {
                for await (const entry of this.folderHandle.values()) {
                    if (entry.kind === 'file' && this.extensionPattern.test(entry.name)) files.push(entry);
                }
            } catch (err) {
                console.warn('Could not refresh the folder listing:', err);
                return;
            }
            files.sort((a, b) => a.name.localeCompare(b.name));
            this.fileHandles = files;

            if (currentName) {
                const newIndex = files.findIndex((f) => f.name === currentName);
                // Still present -- keep pointing at the SAME file at its (possibly new) index. If
                // it's gone (renamed/moved/deleted externally), leave currentValue as-is; it just
                // won't match any option, which is a display-only quirk, not a content change.
                if (newIndex >= 0) this.currentValue = 'local:' + newIndex;
            }
            this.renderOptions();
        },

        loadFileAt: async function(index, token) {
            const entry = this.fileHandles && this.fileHandles[index];
            if (!entry) return;
            const file = await entry.getFile();
            const content = this.readAs === 'text' ? await file.text() : await file.arrayBuffer();
            if (token !== undefined && token !== this._token) return;
            this.mode[this.loadMethod](content, file.name);
            this.currentValue = 'local:' + index;
            this.renderOptions();
        },

        handleSelect: function(value) {
            if (value === 'choose-folder') { this.chooseFolder(); return; }
            if (value === 'reconnect-folder') { this.reconnect(); return; }
            if (value === 'random') {
                this.currentValue = 'random';
                if (this.mode && typeof this.mode.loadDefault === 'function') this.mode.loadDefault();
                return;
            }
            const sep = value.indexOf(':');
            const tier = value.slice(0, sep);
            const idx = parseInt(value.slice(sep + 1), 10);
            if (tier === 'bundled') this.loadOnlineFile(idx);
            else if (tier === 'local') this.loadFileAt(idx);
        },

        renderOptions: function() {
            const select = document.getElementById(this.ids.sourceSelect);
            if (!select) return;
            select.innerHTML = '';
            const addOption = (value, label, disabled) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label;
                if (disabled) opt.disabled = true;
                select.appendChild(opt);
            };

            if (this.hasRandom) addOption('random', 'Random');

            const usingFolder = this.fileHandles && this.fileHandles.length > 0;
            if (usingFolder) {
                this.fileHandles.forEach((f, i) => addOption('local:' + i, f.name.replace(this.extensionPattern, '')));
            } else if (this.onlineIndex) {
                this.onlineIndex.forEach((song, i) => addOption('bundled:' + i, song.name));
            }

            if (this.isSupported()) {
                addOption('__sep__', '──────', true);
                if (this.needsReconnect) {
                    addOption('reconnect-folder', `Reconnect "${this.folderHandle.name}"`);
                } else if (this.folderHandle) {
                    addOption('choose-folder', 'Change Folder…');
                } else {
                    addOption('choose-folder', 'Choose Local Folder…');
                }
            }

            select.value = this.currentValue || select.value;

            const status = document.getElementById(this.ids.sourceStatus);
            if (status) {
                status.textContent = (usingFolder && this.folderHandle)
                    ? `${this.folderHandle.name} (${this.fileHandles.length} file${this.fileHandles.length === 1 ? '' : 's'})`
                    : '';
            }
        },

        // Writes a file into the remembered shared folder -- falls back to a plain <a download>
        // blob link when no folder is set (Safari/Firefox, or Chrome before a folder's been chosen
        // this session), so Save always works regardless of browser/state.
        saveFileAs: async function(name, content) {
            if (this.folderHandle && !this.needsReconnect) {
                try {
                    const fileHandle = await this.folderHandle.getFileHandle(name, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    await this.listFiles(this.folderHandle); // the new file becomes pickable immediately
                    return true;
                } catch (err) {
                    console.warn('Could not save into the remembered folder, falling back to a download:', err);
                }
            }

            const blob = new Blob([content], { type: this.mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            link.click();
            URL.revokeObjectURL(url);
            return false;
        },
    },
};

if (typeof module !== 'undefined') {
    module.exports = FileFolder;
}
