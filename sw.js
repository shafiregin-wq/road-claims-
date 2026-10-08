// MITAK service worker: lets the installed app open without a connection.
// App files: newest from the network, saved copy when offline. Libraries from the CDN are
// versioned, so the saved copy is used. Supabase (accounts, data, receipts) is never cached here.
const VERSION = "mitak-v1";
const SHELL = [
  "./", "./index.html", "./app.css", "./config.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./js/app.js", "./js/data.js", "./js/excel.js", "./js/expense-form.js", "./js/fields.js", "./js/reports.js",
  "./js/state.js", "./js/templates-ui.js", "./js/ui.js", "./js/util.js", "./js/views.js"
];
const LIBS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"
];

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
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) cache.put(req.mode === "navigate" ? "./index.html" : req, res.clone());
        return res;
      } catch (e) {
        return (await cache.match(req.mode === "navigate" ? "./index.html" : req, { ignoreSearch: req.mode === "navigate" })) || Response.error();
      }
    })());
    return;
  }
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
