const CACHE_NAME = 'atelier-yar-ios-v1.8.2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './assets/icon.svg', './assets/fonts/Vazirmatn.woff2', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png'];
// Install: download fresh copies (bypass the browser HTTP cache) and take over immediately.
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(ASSETS.map(u => fetch(new Request(u, {cache: 'reload'})).then(r => { if (!r.ok) throw new Error(u); return cache.put(u, r); })))));
});
// Activate: delete every old cache and control already-open pages.
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match('./index.html'))));
});
