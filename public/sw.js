// public/sw.js
const CACHE_NAME = "alliance-lms-v5";

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

  // Never cache API requests – always go network
  if (url.pathname.startsWith("/api")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For JavaScript and CSS files, network first, fall back to cache
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For all other static assets, cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
