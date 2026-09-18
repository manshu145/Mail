const CACHE = "neximail-static-v2";
const STATIC = ["/offline", "/icons/icon-192.svg", "/icons/icon-512.svg", "/icons/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always fetch app navigations and Next.js build assets from the current release.
  // Hashed Next assets already have browser-level caching; service-worker cache-first
  // can keep an old application shell alive across deployments.
  if (request.mode === "navigate" || url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(request).catch(() => request.mode === "navigate" ? caches.match("/offline") : Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })),
    );
  }
});
