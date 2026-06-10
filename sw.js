const CACHE = 'holodex-v8';
const SHELL = ['/', '/index.html', '/app.js', '/manifest.json', '/scan-phone.html', '/favicon.ico', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never cache live API/function calls. This keeps QR polling and news fresh.
  if (url.pathname.startsWith('/.netlify/functions/') || url.pathname.startsWith('/api/') || url.hostname.includes('api.')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Network-first for app files so updates deploy cleanly, cache fallback for offline use.
  event.respondWith(
    fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
