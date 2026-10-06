// Road Claims service worker: keeps the app working offline.
const VERSION = "road-claims-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
];
// Live services are never cached: maps routing, place search and receipt reading.
const LIVE = /(^|\.)anthropic\.com$|nominatim\.openstreetmap\.org$|router\.project-osrm\.org$/;
const CACHEABLE = /(^|\.)(jsdelivr\.net|cloudflare\.com|gstatic\.com|googleapis\.com)$/;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(LIBS.map(url => fetch(url, { mode: "cors" }).then(r => r.ok && cache.put(url, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (LIVE.test(url.hostname)) return;

  // Pages: try the network for the newest version, fall back to the saved copy offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put("./index.html", copy)); }
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Everything else: saved copy first, then network (and save it for next time).
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && (url.origin === self.location.origin || CACHEABLE.test(url.hostname))) {
        const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
