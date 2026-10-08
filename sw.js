// MITAK service worker: lets the installed app open without a connection, and shows push
// notifications (sent by the Supabase Edge Function "notify") when the colleague adds an expense.
// App files: newest from the network, saved copy when offline. Libraries from the CDN are
// versioned, so the saved copy is used. Supabase (accounts, data, receipts) is never cached here.
const VERSION = "mitak-v4";
const SHELL = [
  "./", "./index.html", "./app.css", "./config.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./js/app.js", "./js/balance.js", "./js/data.js", "./js/excel.js", "./js/expense-form.js", "./js/fields.js", "./js/push.js", "./js/reports.js",
  "./js/state.js", "./js/templates-ui.js", "./js/ui.js", "./js/util.js", "./js/views.js",
  "./templates/fuel-claim-form.xlsx"
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

// A notification from the colleague's phone (see supabase/functions/notify).
self.addEventListener("push", event => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(msg.title || "MITAK", {
    body: msg.body || "",
    tag: msg.tag || undefined,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: self.registration.scope }
  }));
});

// Tapping it opens MITAK (or brings it forward and refreshes it).
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(w => w.url.startsWith(self.registration.scope));
    if (open) { await open.focus(); open.postMessage({ type: "refresh" }); return; }
    await self.clients.openWindow(self.registration.scope);
  })());
});
