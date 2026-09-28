// Minimal service worker for PWA installability. It deliberately does not
// cache anything: every request goes straight to the network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
