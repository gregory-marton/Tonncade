const CACHE_NAME = 'tonncade-v11';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/version.js',
    './js/tonnetz.js',
    './js/synth.js',
    './js/pieces.js',
    './js/board.js',
    './js/render.js',
    './js/sandbox.js',
    './js/blast.js',
    './js/gravity.js',
    './js/melody.js',
    './js/file-folder.js',
    './js/midi-folder.js',
    './js/midi-input.js',
    './js/compose.js',
    './js/snake.js',
    './js/life.js',
    './js/main.js',
    './favicon.svg',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Network-first, falling back to the cache only when the network is unavailable (offline/file://
// equivalent). A prior cache-first strategy here meant any file listed in ASSETS -- notably
// index.html itself -- stayed served from whatever snapshot a returning player's browser cached
// on THEIR first-ever visit, indefinitely, unless CACHE_NAME was manually bumped on every deploy
// that touched a precached file. It wasn't: index.html and js/main.js were each edited 60+ times
// across this project's history with zero CACHE_NAME bumps between them, so any returning player
// could be running arbitrarily old cached markup/JS mixed with newly-fetched (non-precached)
// files -- exactly what happened when index.html's Melody/Compose/Life control markup changed
// and a returning player's browser kept serving the OLD cached index.html, silently dropping the
// new #midi-source dropdown entirely (its element just didn't exist in their stale-cached page).
// Network-first for GET requests eliminates this whole class of staleness for any online player,
// while still degrading gracefully to the cache when genuinely offline -- the actual point of a
// service worker. The cache itself stays warm with whatever's actually being served (`cache.put`
// below), not a one-time install-time snapshot, so an offline visit after some online browsing
// gets recently-seen content, not necessarily the original ASSETS list.
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return; // let the browser handle these normally; can't cache them anyway

    e.respondWith(
        fetch(e.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                    const copy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                }
                return networkResponse;
            })
            .catch(() => caches.match(e.request))
    );
});
