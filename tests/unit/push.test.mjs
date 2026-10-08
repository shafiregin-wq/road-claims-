// Web Push encryption and VAPID signing in the "notify" Edge Function, checked against the
// independent http_ece library (the one the web-push package uses).
import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, webcrypto } from "node:crypto";
import ece from "http_ece";
import { encryptPayload, vapidHeader, generateVapidKeys, b64uEncode, b64uDecode } from "../../supabase/functions/notify/index.ts";

function receiver() {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, p256dh: b64uEncode(ecdh.getPublicKey()), authB64: b64uEncode(auth) };
}

test("a phone can decrypt what the function sends (RFC 8291, aes128gcm)", async () => {
  const r = receiver();
  const message = JSON.stringify({ title: "Shafi added an expense", body: "⛽ Fuel · AED 150.25 · ADNOC" });
  const body = await encryptPayload(message, r.p256dh, r.authB64);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096, "record size");
  assert.equal(body[20], 65, "sender key length");
  const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: r.ecdh, authSecret: r.auth });
  assert.equal(plain.toString("utf8"), message);
  const again = await encryptPayload(message, r.p256dh, r.authB64);
  assert.notDeepEqual(Buffer.from(again), Buffer.from(body), "fresh keys and salt every time");
});

test("VAPID header is a valid ES256 token for the push service", async () => {
  const keys = await generateVapidKeys();
  assert.equal(b64uDecode(keys.publicKey).length, 65);
  const h = await vapidHeader("https://web.push.apple.com/QAbc123?x=1", { ...keys, subject: "https://shafiregin-wq.github.io" }, Date.UTC(2026, 9, 8));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], "base64url")), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(m[2], "base64url"));
  assert.deepEqual(claims, { aud: "https://web.push.apple.com", exp: Date.UTC(2026, 9, 8) / 1000 + 43200, sub: "https://shafiregin-wq.github.io" });
  const pub = await webcrypto.subtle.importKey("raw", b64uDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64uDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok, "signature verifies with the public key");
});
