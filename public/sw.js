// public/sw.js
const CACHE_NAME = "alliance-lms-v1";

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
  const url = new URL(event.request.url);

  // For the API data endpoint, use stale-while-revalidate
  if (url.pathname === "/api/all") {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cachedResponse) => {
          const networkFetch = fetch(event.request).then((networkResponse) => {
            // Cache the fresh response (clone it because response can only be consumed once)
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
          // Return cached response immediately if exists, otherwise wait for network
          return cachedResponse || networkFetch;
        })
      )
    );
    return;
  }

  // For all other requests (static files, etc.), cache-first with network fallback
  event.respondWith(
    caches
      .match(event.request)
      .then((cachedResponse) => cachedResponse || fetch(event.request))
  );
});
