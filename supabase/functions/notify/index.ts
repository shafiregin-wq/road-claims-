// MITAK push notifications: Supabase Edge Function "notify".
//
// When one person adds an expense, the app calls this function and it sends a push notification
// to the other person's phones. It also hands out the public key phones need to subscribe, and
// sends test notifications.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor → name it "notify" →
// replace the example code with this whole file → Deploy. Then in the function's Details, turn
// off "Enforce JWT verification" (this function checks the signed-in user itself).
//
// Needs no secrets: the notification keys are created on first use and kept in the private
// push_config table (see supabase/schema.sql). No libraries: Web Push encryption (RFC 8291) and
// VAPID (RFC 8292) are done with the built-in Web Crypto API.

const enc = new TextEncoder();
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const CATS: Record<string, string> = { fuel: "⛽ Fuel", toll: "🛣️ Toll", food: "🍴 Food", parking: "🅿️ Parking" };

/* ---------- bytes ---------- */

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* ---------- Web Push ---------- */

export type Vapid = { publicKey: string; privateJwk: JsonWebKey; subject: string };
export type Subscription = { endpoint: string; p256dh: string; auth: string };

export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = b64uEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey, privateJwk: { kty, crv, x, y, d } };
}

// Encrypts a message for one subscription (aes128gcm, single record).
export async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh), authSecret = b64uDecode(auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const one = new Uint8Array([1]);
  const ikm = await hmac(await hmac(authSecret, shared), concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, one));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), one))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), one))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

export async function vapidHeader(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64uEncode(sig)}, k=${vapid.publicKey}`;
}

export async function sendPush(sub: Subscription, message: unknown, vapid: Vapid, allowHttp = false): Promise<number> {
  if (!/^https:\/\//.test(sub.endpoint) && !allowHttp) return 400;
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
      Authorization: await vapidHeader(sub.endpoint, vapid)
    },
    body: await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth)
  });
  await res.body?.cancel();
  return res.status;
}

/* ---------- Supabase access (with the project's service key) ---------- */

export type Env = { url: string; key: string; allowHttp?: boolean };

function db(env: Env) {
  const headers: Record<string, string> = { apikey: env.key, "Content-Type": "application/json" };
  if (env.key.startsWith("eyJ")) headers.Authorization = `Bearer ${env.key}`;
  const call = async (method: string, path: string, body?: unknown, prefer?: string) => {
    const res = await fetch(`${env.url}/rest/v1/${path}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`database ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body: unknown, prefer = "return=minimal") => call("POST", path, body, prefer),
    del: (path: string) => call("DELETE", path)
  };
}

async function signedInUser(env: Env, req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token === env.key) return null;
  const res = await fetch(`${env.url}/auth/v1/user`, { headers: { apikey: env.key, Authorization: `Bearer ${token}` } });
  if (!res.ok) { await res.body?.cancel(); return null; }
  const u = await res.json();
  return u && u.id ? { id: u.id } : null;
}

async function vapidKeys(d: ReturnType<typeof db>, origin: string | null): Promise<Vapid> {
  const read = async () => (await d.get("push_config?id=eq.1&select=public_key,private_jwk,subject"))[0];
  let row = await read();
  if (!row) {
    const k = await generateVapidKeys();
    const subject = origin && /^https:\/\//.test(origin) ? origin : "mailto:mitak@users.noreply.github.com";
    await d.post("push_config?on_conflict=id", { id: 1, public_key: k.publicKey, private_jwk: k.privateJwk, subject }, "resolution=ignore-duplicates,return=minimal");
    row = await read();
  }
  return { publicKey: row.public_key, privateJwk: row.private_jwk, subject: row.subject };
}

const money = (n: number) => "AED " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Sends to every device of the given people; forgets devices whose subscription has expired.
async function deliver(env: Env, d: ReturnType<typeof db>, userIds: string[], message: unknown, vapid: Vapid) {
  if (!userIds.length) return 0;
  const subs: Subscription[] = await d.get(`push_subscriptions?user_id=in.(${userIds.join(",")})&select=endpoint,p256dh,auth`);
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      const status = await sendPush(s, message, vapid, env.allowHttp);
      if (status >= 200 && status < 300) sent++;
      else if (status === 404 || status === 410) await d.del(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`);
    } catch (_) { /* one bad device shouldn't stop the others */ }
  }));
  return sent;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const user = await signedInUser(env, req);
    if (!user) return json({ error: "Sign in to MITAK first" }, 401);
    const d = db(env);
    const me = (await d.get(`members?user_id=eq.${user.id}&select=workspace_id,display_name`))[0];
    if (!me) return json({ error: "Not a member of the MITAK workspace" }, 403);
    const body = await req.json().catch(() => ({}));
    const vapid = await vapidKeys(d, req.headers.get("origin"));

    if (body.action === "key") return json({ publicKey: vapid.publicKey });

    if (body.action === "test") {
      const sent = await deliver(env, d, [user.id], { title: "MITAK", body: "Notifications are working on this phone.", tag: "mitak-test" }, vapid);
      return json({ sent });
    }

    if (body.action === "expense") {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.expense_id || ""))) return json({ error: "expense_id missing" }, 400);
      const e = (await d.get(`expenses?id=eq.${body.expense_id}&workspace_id=eq.${me.workspace_id}&select=id,category,amount,description,paid_by`))[0];
      if (!e) return json({ error: "Expense not found" }, 404);
      const members = await d.get(`members?workspace_id=eq.${me.workspace_id}&select=user_id,display_name`);
      const others = members.filter((m: { user_id: string }) => m.user_id !== user.id);
      const payer = members.find((m: { user_id: string }) => m.user_id === e.paid_by);
      let sent = 0;
      for (const o of others) {
        const paid = e.paid_by === user.id ? "" : e.paid_by === o.user_id ? " · paid by you" : payer ? ` · paid by ${payer.display_name}` : "";
        const message = {
          title: `${me.display_name} added an expense`,
          body: `${CATS[e.category] || e.category} · ${money(e.amount)}${e.description ? " · " + e.description : ""}${paid}`,
          tag: `expense-${e.id}`
        };
        sent += await deliver(env, d, [o.user_id], message, vapid);
      }
      return json({ sent });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
}

// The project's service key: the classic service_role key, or the newer secret key.
function serviceKey(get: (k: string) => string | undefined): string {
  const legacy = get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const all = JSON.parse(get("SUPABASE_SECRET_KEYS") || "{}"); const v = all.default || Object.values(all)[0]; if (v) return String(v); } catch (_) { /* not set */ }
  return get("SUPABASE_SECRET_KEY") || "";
}

// deno-lint-ignore no-explicit-any
const runtime = (globalThis as any).Deno;
if (runtime) {
  const env: Env = { url: runtime.env.get("SUPABASE_URL") || "", key: serviceKey(k => runtime.env.get(k)) };
  runtime.serve((req: Request) => handle(req, env));
}
