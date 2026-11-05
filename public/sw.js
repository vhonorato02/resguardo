/* Service worker: offline app shell, incoming push and notification interactions. */
const CACHE = 'resguardo-rc7-20261105';
const SHELL = ['/', '/index.html', '/style.css', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest',
  '/src/app.mjs', '/src/config.mjs', '/src/domain.mjs', '/src/idb.mjs', '/src/auth.mjs', '/src/sync.mjs', '/src/exports.mjs'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))]));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => response).catch(() => caches.match('/index.html')));
  } else {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(c => c.put(request, response.clone()));
      return response;
    })));
  }
});
self.addEventListener('push', event => {
  let message = { title: 'Resguardo', body: 'Que tal conferir seus registros de hoje?' };
  try { if (event.data) message = { ...message, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'resguardo-checkin',
    requireInteraction: false, data: { url: '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    for (const client of windows) {
      if ('focus' in client) { await client.focus(); return; }
    }
    return self.clients.openWindow('/');
  }));
});
