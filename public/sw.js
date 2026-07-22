// public/sw.js
const CACHE_NAME = "alliance-lms-v4";

// Assets to cache immediately on install
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/images/Alliance-LMS.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting(); // activate immediately
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim(); // take control of all clients
});

self.addEventListener("fetch", (event) => {
  // For JavaScript and CSS files, try network first, fall back to cache
  if (event.request.url.endsWith(".js") || event.request.url.endsWith(".css")) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Optionally update the cache with the fresh file
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => {
          // If network fails (offline), serve the cached version
          return caches.match(event.request);
        })
    );
    return;
  }

  // For all other static assets, serve from cache first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
