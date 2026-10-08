// Runs MITAK against real Supabase components on this machine: PostgreSQL + Supabase Auth (GoTrue)
// + PostgREST, with schema.sql applied, and drives two people through the app in Chromium.
// Storage is an in-memory stand-in (its access rules are covered by tests/sql).
//
//   node tests/supabase-local/run.mjs
//
// Needs PostgreSQL 15+ binaries; downloads PostgREST and Supabase Auth into ~/.cache/mitak-test.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import ece from "http_ece";
import { startGateway, jwt } from "./gateway.mjs";
import { handle as notifyHandler } from "../../supabase/functions/notify/index.ts";
import { serve, routeCdn, ROOT } from "../e2e/harness.mjs";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }

const CACHE = join(homedir(), ".cache", "mitak-test");
const PGRST = { url: "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz", bin: join(CACHE, "postgrest") };
const AUTH = { url: "https://github.com/supabase/auth/releases/download/v2.164.0/auth-v2.164.0-x86.tar.gz", dir: join(CACHE, "auth") };
const SECRET = "mitak-local-test-secret-at-least-32-characters";
const PG_PORT = 54340, AUTH_PORT = 54341, REST_PORT = 54342, GW_PORT = 54343;
const procs = [];
let dataDir, gateway, app, browser;
const inbox = [];

function sh(cmd, args, opts = {}) { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString(); }
function fetchBinaries() {
  mkdirSync(CACHE, { recursive: true });
  if (!existsSync(PGRST.bin)) sh("bash", ["-c", `curl -sSL "${PGRST.url}" | tar xJ -C "${CACHE}"`]);
  if (!existsSync(join(AUTH.dir, "auth"))) { mkdirSync(AUTH.dir, { recursive: true }); sh("bash", ["-c", `curl -sSL "${AUTH.url}" | tar xz -C "${AUTH.dir}"`]); }
}
const pgbin = () => readdirSync("/usr/lib/postgresql").sort((a, b) => b - a).map(v => `/usr/lib/postgresql/${v}/bin`)[0];
const asPg = process.getuid && process.getuid() === 0 ? ["runuser", "-u", "postgres", "--"] : [];
const pg = (bin, args, opts) => { const full = [...asPg, join(pgbin(), bin), ...args]; return sh(full[0], full.slice(1), opts); };
function psql(file) {
  return pg("psql", ["-h", dataDir, "-p", String(PG_PORT), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" } });
}
function start(cmd, args, env) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; p.stdout.on("data", d => { log += d; }); p.stderr.on("data", d => { log += d; });
  p.logText = () => log;
  procs.push(p); return p;
}
async function waitFor(url, proc) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch (e) {}
    if (proc && proc.exitCode != null) throw new Error("process exited:\n" + proc.logText());
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("timed out waiting for " + url + (proc ? "\n" + proc.logText() : ""));
}

before(async () => {
  fetchBinaries();
  dataDir = mkdtempSync(join(tmpdir(), "mitak-sb-"));
  if (asPg.length) sh("chown", ["postgres", dataDir]);
  pg("initdb", ["-D", join(dataDir, "data"), "-U", "postgres", "-A", "trust"]);
  pg("pg_ctl", ["-D", join(dataDir, "data"), "-o", `-k ${dataDir} -p ${PG_PORT} -c listen_addresses=127.0.0.1`, "-l", join(dataDir, "log"), "-w", "start"]);
  psql(join(ROOT, "tests/supabase-local/setup.sql"));
  const auth = start(join(AUTH.dir, "auth"), [], {
    GOTRUE_DB_DRIVER: "postgres", DATABASE_URL: `postgres://supabase_auth_admin:test@127.0.0.1:${PG_PORT}/postgres?search_path=auth&sslmode=disable`,
    GOTRUE_DB_MIGRATIONS_PATH: join(AUTH.dir, "migrations"), GOTRUE_API_HOST: "127.0.0.1", PORT: String(AUTH_PORT),
    API_EXTERNAL_URL: `http://127.0.0.1:${GW_PORT}/auth/v1`, GOTRUE_SITE_URL: "http://127.0.0.1", GOTRUE_URI_ALLOW_LIST: "*",
    GOTRUE_JWT_SECRET: SECRET, GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_AUD: "authenticated", GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated", GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "false", GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", GOTRUE_MAILER_AUTOCONFIRM: "true", GOTRUE_LOG_LEVEL: "warn", GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000"
  });
  await waitFor(`http://127.0.0.1:${AUTH_PORT}/health`, auth);
  psql(join(ROOT, "tests/supabase-local/after-auth.sql"));
  psql(join(ROOT, "supabase/schema.sql"));
  const rest = start(PGRST.bin, [], {
    PGRST_DB_URI: `postgres://authenticator:test@127.0.0.1:${PG_PORT}/postgres`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(REST_PORT), PGRST_SERVER_HOST: "127.0.0.1", PGRST_LOG_LEVEL: "warn"
  });
  await waitFor(`http://127.0.0.1:${REST_PORT}/`, rest);
  const serviceKey = jwt({ role: "service_role", iss: "supabase", iat: 1700000000, exp: 2000000000 }, SECRET);
  const notifyEnv = { url: `http://127.0.0.1:${GW_PORT}`, key: serviceKey, allowHttp: true };
  gateway = await startGateway({ port: GW_PORT, authPort: AUTH_PORT, restPort: REST_PORT, inbox, functions: { notify: req => notifyHandler(req, notifyEnv) } });
  const anonKey = jwt({ role: "anon", iss: "supabase", iat: 1700000000, exp: 2000000000 }, SECRET);
  app = await serve(0, { config: { supabaseUrl: `http://127.0.0.1:${GW_PORT}`, supabaseAnonKey: anonKey } });
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (app) app.server.close();
  if (gateway) gateway.close();
  procs.forEach(p => p.kill());
  try { pg("pg_ctl", ["-D", join(dataDir, "data"), "-m", "immediate", "stop"]); } catch (e) {}
});

const errors = [];
// A phone's push keys, and a stand-in for the browser's push support that uses them.
function phoneKeys(name) {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { name, ecdh, auth, endpoint: `http://127.0.0.1:${GW_PORT}/push/${name}`, p256dh: ecdh.getPublicKey().toString("base64url"), authB64: auth.toString("base64url") };
}
function fakePush(cfg) {
  let sub = null, permission = "default";
  const make = () => ({ endpoint: cfg.endpoint, toJSON: () => ({ endpoint: cfg.endpoint, keys: { p256dh: cfg.p256dh, auth: cfg.auth } }), unsubscribe: async () => { sub = null; return true; } });
  const reg = { scope: location.origin + "/", pushManager: { getSubscription: async () => sub, subscribe: async o => { window.__serverKey = o.applicationServerKey; sub = make(); return sub; } } };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => reg, register: async () => reg, addEventListener() {} } });
  window.PushManager = window.PushManager || function () {};
  window.Notification = class { static get permission() { return permission; } static async requestPermission() { permission = "granted"; return permission; } };
}
async function nextPush(phone, after) {
  for (let i = 0; i < 100; i++) {
    const hit = inbox.slice(after).find(m => m.phone === phone.name);
    if (hit) return { ...hit, message: JSON.parse(ece.decrypt(hit.body, { version: "aes128gcm", privateKey: phone.ecdh, authSecret: phone.auth }).toString("utf8")) };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("no push arrived for " + phone.name);
}

async function person(phone) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await routeCdn(ctx);
  if (phone) await ctx.addInitScript(fakePush, { endpoint: phone.endpoint, p256dh: phone.p256dh, auth: phone.authB64 });
  // Live updates (Realtime) aren't part of this local setup.
  await ctx.route(/\/realtime\/v1\//, r => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  return page;
}
async function errText(page, sel) { await page.waitForSelector(`${sel}:not(:empty)`); return page.textContent(sel); }
async function signUp(page, email, password = "test-password-1") {
  await page.goto(app.url);
  await page.click("[data-act=auth-mode][data-m=signup]");
  await page.fill("#a-email", email);
  await page.fill("#a-pass", password);
  await page.click("#auth-form [type=submit]");
}
async function addExpense(page, category, amount, extra = async () => {}) {
  await page.click(".add-main");
  await page.click(`[data-pick=category][data-v=${category}]`);
  await page.fill("#e-amount", String(amount));
  await extra();
  await page.click("[data-x=save]");
  await page.waitForSelector(".toast >> text=Expense added successfully.");
  await page.waitForSelector("[data-testid=expense-sheet]", { state: "detached" });
}

test("two colleagues on a real Supabase stack", async () => {
  const a = await person();
  await signUp(a, "shafi@example.com");
  await a.waitForSelector("#onboard-form");
  await a.fill("#o-name", "Shafi");
  await a.click("[data-act=create-ws]");
  const code = (await a.textContent("[data-testid=invite-code-sheet]")).trim();
  assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  await a.click(".sheet [data-close]");
  await addExpense(a, "fuel", "150.25", async () => {
    await a.fill("#d-odometer", "120345");
    await a.setInputFiles("[data-file][multiple]", { name: "r.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  });

  // A stranger can sign up while the second place is free, but can't create or see anything.
  const x = await person();
  await signUp(x, "stranger@example.com");
  await x.waitForSelector("#onboard-form");
  await x.fill("#o-name", "Eve");
  await x.click("[data-act=create-ws]");
  assert.match(await errText(x, "#onboard-form .err"), /already set up MITAK/);
  await x.fill("#o-code", "0000-0000-0000");
  await x.click("#onboard-form [type=submit]");
  assert.match(await errText(x, "#onboard-form .err"), /isn’t right/);

  // The colleague joins with the code.
  const ahmedPhone = phoneKeys("ahmed");
  const b = await person(ahmedPhone);
  await b.goto(app.url + "?invite=" + code);
  await b.click("[data-act=auth-mode][data-m=signup]");
  await b.fill("#a-email", "ahmed@example.com");
  await b.fill("#a-pass", "test-password-2");
  await b.click("#auth-form [type=submit]");
  await b.waitForSelector("#onboard-form");
  await b.fill("#o-name", "Ahmed");
  await b.click("#onboard-form [type=submit]");
  await b.waitForSelector(".hello");
  assert.match(await b.textContent(".split.strong"), /Shafi’s spending\s*AED 150\.25/);
  await addExpense(b, "parking", 20);
  const row = b.locator(".xrow", { hasText: "Fuel" }).first();
  await row.click();
  await b.waitForSelector("[data-testid=expense-view]");
  const view = await b.textContent("[data-testid=expense-view]");
  assert.match(view, /Receipt 1/);
  assert.match(view, /Only Shafi can change or delete this expense/);
  await b.click(".sheet [data-close]");

  // Notifications: Ahmed turns them on from the Home banner; Shafi adds an expense; Ahmed's phone gets it.
  await b.waitForSelector("[data-testid=push-banner]");
  await b.click("[data-testid=push-banner] [data-act=push-on]");
  await b.waitForSelector(".toast >> text=Notifications are on for this phone.");
  await b.click("#gear");
  await b.waitForSelector("[data-testid=notifications][data-state=on]");
  assert.equal(await b.evaluate(() => window.__serverKey.length), 65, "subscribed with the function's public key");
  let seen = inbox.length;
  await addExpense(a, "toll", "8", async () => { await a.fill("#e-desc", "Salik"); });
  let push = await nextPush(ahmedPhone, seen);
  assert.deepEqual(push.message, { title: "Shafi added an expense", body: "🛣️ Toll · AED 8.00 · Salik", tag: push.message.tag });
  assert.match(push.headers.authorization, /^vapid t=.+, k=.+/);
  assert.equal(push.headers["content-encoding"], "aes128gcm");
  // Lunch for 30, of which 20 is Ahmed's: Ahmed is told his share.
  await a.reload();
  await a.waitForFunction(() => /Ahmed’s spending/.test((document.querySelector(".split.strong") || {}).textContent || ""));
  seen = inbox.length;
  await addExpense(a, "food", "30", async () => { await a.click("[data-split=custom]"); await a.fill("#e-theirs", "20"); });
  push = await nextPush(ahmedPhone, seen);
  assert.equal(push.message.body, "🍴 Food · AED 30.00 · your share AED 20.00");
  // Ahmed's own expenses don't notify Ahmed; the test button does.
  seen = inbox.length;
  await b.click("[data-act=push-test]");
  await b.waitForSelector(".toast >> text=Test sent.");
  push = await nextPush(ahmedPhone, seen);
  assert.equal(push.message.body, "Notifications are working on this phone.");
  assert.equal(inbox.slice(seen).length, 1, "nothing else was sent");
  const anon = await fetch(`http://127.0.0.1:${GW_PORT}/functions/v1/notify`, { method: "POST", body: "{}" });
  assert.equal(anon.status, 401, "the function needs a signed-in member");
  await b.click(".tab[data-to=home]");

  // Shafi sees Ahmed's expense but can't change it; Ahmed can.
  await a.reload();
  await a.waitForFunction(() => /Ahmed’s spending\s*AED 20\.00/.test((document.querySelector(".split.strong") || {}).textContent || ""));
  await a.locator(".xrow", { hasText: "Parking" }).first().click();
  await a.waitForSelector("[data-testid=expense-view] >> text=Only Ahmed can change or delete this expense.");
  await a.click(".sheet [data-close]");
  await b.reload();
  await b.waitForFunction(() => /Shafi’s spending\s*AED 188\.25/.test((document.querySelector(".split.strong") || {}).textContent || ""));
  await b.locator(".xrow", { hasText: "Parking" }).first().click();
  await b.fill("#e-amount", "25");
  await b.click("[data-x=save]");
  await b.waitForSelector(".toast >> text=Expense updated.");

  // Who owes who: Ahmed owes Shafi 20 for lunch, pays it back, and they're settled.
  assert.match(await b.textContent("[data-testid=balance-card]"), /AED 20\.00\s*You owe Shafi/);
  await b.click("[data-act=record-payment]");
  assert.equal(await b.getAttribute("[data-dir=me-to-them]", "aria-pressed"), "true");
  assert.equal(await b.inputValue("#p-amount"), "20");
  await b.click("[data-testid=payment-sheet] [data-x=save]");
  await b.waitForSelector(".toast >> text=Payment recorded.");
  await a.reload();
  await a.waitForFunction(() => /All settled up/.test((document.querySelector("[data-testid=balance-card]") || {}).textContent || ""));

  // The stranger still sees nothing; new sign-ups are now refused.
  await x.reload();
  await x.waitForSelector("#onboard-form");
  await x.fill("#o-name", "Eve");
  await x.fill("#o-code", code);
  await x.click("#onboard-form [type=submit]");
  assert.match(await errText(x, "#onboard-form .err"), /isn’t right|already has its two members/);
  const y = await person();
  await signUp(y, "late@example.com");
  assert.match(await errText(y, "#auth-form .err"), /already has its two members/);

  // Reports from the real data (the built-in fuel form); Ahmed deletes his own expense.
  await a.click(".tab[data-to=reports]");
  assert.equal(await a.textContent("[data-testid=report-parking] .report-total .money"), "AED 0.00", "only mine by default");
  await a.click("[data-act=rep-who]:has-text('Both of us')");
  assert.equal(await a.textContent("[data-testid=report-parking] .report-total .money"), "AED 25.00");
  await a.click("[data-act=rep-who]:has-text('Only mine')");
  await a.click("[data-testid=report-fuel] [data-act=generate]");
  await a.waitForSelector("[data-save]");
  await a.click(".sheet [data-close]");
  await b.click(".tab[data-to=expenses]");
  await b.locator(".xrow", { hasText: "Parking" }).first().click();
  await b.click("[data-x=delete]");
  await b.click(".dialog [data-v='1']");
  await b.waitForSelector(".toast >> text=Expense deleted.");
  // After a reload MITAK shows the saved copy first, then the fresh data.
  await b.click(".tab[data-to=home]");
  await b.reload();
  await b.waitForFunction(() => /My spending\s*AED 0\.00/.test((document.querySelector(".split.strong") || {}).textContent || ""));

  // Profile and sign out / sign in again.
  await b.click("#gear");
  await b.fill("#pf-employee_id", "E-221");
  await b.click("[data-act=save-profile]");
  await b.waitForSelector(".toast >> text=Details saved.");
  await b.click("[data-act=sign-out]");
  await b.click(".dialog [data-v='1']");
  await b.waitForSelector("#auth-form");
  await b.fill("#a-email", "ahmed@example.com");
  await b.fill("#a-pass", "wrong-password");
  await b.click("#auth-form [type=submit]");
  assert.match(await errText(b, "#auth-form .err"), /email or password isn’t right/);
  await b.fill("#a-pass", "test-password-2");
  await b.click("#auth-form [type=submit]");
  await b.waitForSelector(".hello");
  assert.deepEqual(errors, []);
});

test("a database that hasn't been updated says so clearly", async () => {
  const sql = join(dataDir, "old-db.sql");
  writeFileSync(sql, "alter table public.expenses drop column other_share cascade; notify pgrst, 'reload schema';");
  psql(sql);
  const a = await person();
  await a.goto(app.url);
  await a.fill("#a-email", "shafi@example.com");
  await a.fill("#a-pass", "test-password-1");
  await a.click("#auth-form [type=submit]");
  await a.waitForSelector(".hello");
  await a.click(".add-main");
  await a.click("[data-pick=category][data-v=food]");
  await a.fill("#e-amount", "10");
  await a.click("[data-x=save]");
  assert.match(await errText(a, "#e-err"), /database needs an update.*schema\.sql/);
});
