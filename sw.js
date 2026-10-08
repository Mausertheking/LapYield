// Offline cache: the app works at the track even without mobile signal once it has been opened.
const VERSION = 'ecoline-v2';
const FILES = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/analysis.js', 'js/physics.js', 'js/track.js', 'js/sample.js', 'js/i18n.js', 'js/storage.js',
  'js/recorder.js', 'js/charts.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// network first (so updates arrive), cache as fallback when offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
