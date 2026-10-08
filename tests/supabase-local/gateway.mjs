// A small stand-in for Supabase's API gateway, for local testing only:
//   /auth/v1/*    → Supabase Auth (GoTrue)
//   /rest/v1/*    → PostgREST
//   /storage/v1/* → an in-memory file store (enough for receipts and templates; no access rules)
//   /functions/v1/<name> → the Edge Function's handler, run in this process
//   /push/<phone>  → a stand-in push service that keeps what it receives
import http from "node:http";
import { createHmac } from "node:crypto";

export function jwt(payload, secret) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" }), body = b64(payload);
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-upsert, cache-control, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version"
};

export function startGateway({ port, authPort, restPort, functions = {}, inbox = [] }) {
  const files = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
    const url = new URL(req.url, "http://x");
    const body = await new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
    if (url.pathname.startsWith("/storage/v1/")) return storage(req, res, url, body, files);
    if (url.pathname.startsWith("/push/")) {
      inbox.push({ phone: url.pathname.slice(6), headers: req.headers, body });
      res.writeHead(201); res.end(); return;
    }
    const fn = /^\/functions\/v1\/([^/]+)$/.exec(url.pathname);
    if (fn) {
      if (!functions[fn[1]]) { res.writeHead(404, CORS); res.end("{}"); return; }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const out = await functions[fn[1]](new Request(`http://127.0.0.1:${port}${url.pathname}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
      res.writeHead(out.status, { ...Object.fromEntries(out.headers), ...CORS });
      res.end(Buffer.from(await out.arrayBuffer())); return;
    }
    const target = url.pathname.startsWith("/auth/v1/") ? { port: authPort, path: url.pathname.slice(8) }
      : url.pathname.startsWith("/rest/v1/") ? { port: restPort, path: url.pathname.slice(8) } : null;
    if (!target) { res.writeHead(404, CORS); res.end("{}"); return; }
    const headers = { ...req.headers }; delete headers.host;
    const up = http.request({ host: "127.0.0.1", port: target.port, path: target.path + url.search, method: req.method, headers }, r => {
      const h = { ...r.headers, ...CORS }; delete h["access-control-allow-origin"]; Object.assign(h, CORS);
      res.writeHead(r.statusCode, h); r.pipe(res);
    });
    up.on("error", e => { res.writeHead(502, CORS); res.end(JSON.stringify({ message: e.message })); });
    up.end(body);
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r(server)));
}

function storage(req, res, url, body, files) {
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { ...CORS, "content-type": type }); res.end(typeof obj === "string" || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  let m;
  if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p)) && req.method === "POST") return send(200, { signedURL: `/object/public-signed/${m[1]}/${m[2]}?token=x` });
  if ((m = /^\/object\/(?:public-signed|authenticated)\/([^/]+)\/(.+)$/.exec(p)) && req.method === "GET") {
    const f = files.get(`${m[1]}/${m[2]}`); return f ? send(200, f.data, f.type) : send(404, { message: "Object not found" });
  }
  if ((m = /^\/object\/([^/]+)\/(.+)$/.exec(p)) && (req.method === "POST" || req.method === "PUT")) {
    files.set(`${m[1]}/${m[2]}`, { data: body, type: req.headers["content-type"] || "application/octet-stream" });
    return send(200, { Key: `${m[1]}/${m[2]}` });
  }
  if ((m = /^\/object\/([^/]+)\/?$/.exec(p)) && req.method === "DELETE") {
    const { prefixes = [] } = JSON.parse(body.toString() || "{}");
    prefixes.forEach(k => files.delete(`${m[1]}/${k}`)); return send(200, prefixes.map(name => ({ name })));
  }
  send(404, { message: "not supported in the test gateway: " + req.method + " " + p });
}
