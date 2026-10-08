// The service worker shows a notification when a push arrives (delivered through Chrome's
// DevTools protocol, standing in for the push service).
import test from "node:test";
import assert from "node:assert/strict";
import { serve } from "./harness.mjs";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }

test("a push becomes a notification", async () => {
  const { server, url } = await serve();
  // The full Chromium build: the lighter headless shell refuses notification permission.
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: url.replace(/\/$/, "") });
    const page = await ctx.newPage();
    await page.goto(url + "manifest.webmanifest");
    await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    const regs = await new Promise(resolve => cdp.on("ServiceWorker.workerRegistrationUpdated", e => { if (e.registrations.length) resolve(e.registrations); }));
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: url.replace(/\/$/, ""), registrationId: regs[0].registrationId,
      data: JSON.stringify({ title: "Shafi added an expense", body: "⛽ Fuel · AED 150.00 · ADNOC", tag: "expense-1" })
    });
    let shown = [];
    for (let i = 0; i < 50 && !shown.length; i++) {
      shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag })));
      if (!shown.length) await page.waitForTimeout(100);
    }
    assert.deepEqual(shown, [{ title: "Shafi added an expense", body: "⛽ Fuel · AED 150.00 · ADNOC", tag: "expense-1" }]);
  } finally { await browser.close(); server.close(); }
});
