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

  // Handle the API data endpoint – cache-first, then background refresh
  if (url.pathname === "/api/all") {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cachedResponse) => {
          // Revalidate in background
          const networkFetch = fetch(event.request)
            .then((networkResponse) => {
              cache.put(event.request, networkResponse.clone());
              console.log("✅ Service Worker – fresh /api/all cached");
              return networkResponse;
            })
            .catch(() =>
              console.warn(
                "⚠️ Service Worker – network fetch failed, using cache"
              )
            );

          if (cachedResponse) {
            console.log("⚡ Service Worker – serving /api/all from cache");
            return cachedResponse;
          }
          console.log("⏳ Service Worker – no cache, waiting for network");
          return networkFetch;
        })
      )
    );
    return;
  }

  // All other requests – cache-first with network fallback
  event.respondWith(
    caches
      .match(event.request)
      .then((cachedResponse) => cachedResponse || fetch(event.request))
  );
});
