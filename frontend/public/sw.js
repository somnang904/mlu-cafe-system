// Minimal service worker so browsers offer "Install app".
// It deliberately caches nothing: orders, stock and payments must always come from
// the live server, and a stale cached app shell could run against a newer API.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Some browsers still require a fetch handler for installability. Not calling
// event.respondWith() leaves every request to the normal network path.
self.addEventListener('fetch', () => {})
