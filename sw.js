const CACHE_NAME = 'tonnetz-tetris-v1';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/tonnetz.js',
    './js/synth.js',
    './js/pieces.js',
    './js/board.js',
    './js/render.js',
    './js/chop.js',
    './js/puzzle.js',
    './js/gravity.js',
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

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(e.request);
        })
    );
});
