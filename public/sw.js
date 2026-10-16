// WAYLINE Service Worker - v1.0.0
const CACHE_NAME = 'wayline-cache-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip WebSocket connections or non-http
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/peer/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached and refresh cache in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
        }).catch(() => {/* Offline */});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // If navigating and offline, return cached index.html
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});

// Broadcast offline readiness confirmation
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_CACHE_STATUS') {
    caches.open(CACHE_NAME).then((cache) => {
      return cache.keys();
    }).then((keys) => {
      const hasCore = PRECACHE_ASSETS.every(asset => 
        keys.some(k => new URL(k.url).pathname === asset || (asset === '/' && new URL(k.url).pathname === '/index.html'))
      );
      event.ports[0].postMessage({
        ready: hasCore,
        cachedCount: keys.length,
        cacheName: CACHE_NAME
      });
    });
  }
});
