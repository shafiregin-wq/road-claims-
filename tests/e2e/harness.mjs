// Shared helpers for the browser tests: a tiny static server for the app, and CDN libraries served
// from node_modules so the tests run offline.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json", ".svg": "image/svg+xml" };

export function serve(port = 0, { config } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    if (p === "/config.js" && config) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(`window.MITAK_CONFIG = ${JSON.stringify(config)};`); return; }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT) || file.includes("node_modules")) { res.writeHead(404); res.end(); return; }
    try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }); res.end(body); }
    catch (e) { res.writeHead(404); res.end("not found"); }
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

const LIBS = {
  "exceljs": require.resolve("exceljs/dist/exceljs.min.js"),
  "@supabase/supabase-js": require.resolve("@supabase/supabase-js/dist/umd/supabase.js")
};
export async function routeCdn(context) {
  await context.route(/cdn\.jsdelivr\.net\/npm\//, async route => {
    const u = route.request().url();
    const key = Object.keys(LIBS).find(k => u.includes(`/npm/${k}@`));
    if (!key) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(LIBS[key]) });
  });
}
