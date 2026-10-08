// MITAK data layer. Two interchangeable backends with the same methods:
//   • SupabaseBackend — the real shared workspace (accounts, database, receipt files, live updates).
//   • DemoBackend     — a stand-in kept in this browser, for trying MITAK before Supabase is set up.
//                       It follows the same rules (two members, invite codes) so it behaves alike.
//
// Expenses use the app shape: { id, category, amount, date, time, paidBy, createdBy, updatedBy,
// description, location, trip, details, receipts, createdAt, updatedAt }. File paths are relative
// to the workspace, e.g. "receipts/<expense id>/<file>.jpg".

import { uid, todayISO, shiftMonth, monthOf, pad, sleep } from "./util.js";

export const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js";

export class AppError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  const msg = String((err && (err.message || err.error_description || err.msg)) || err || "");
  const status = err && (err.status || err.statusCode);
  const mitak = /MITAK_[A-Z_]+/.exec(msg);
  if (mitak) return new AppError(mitak[0], msg);
  if (/Invalid login credentials/i.test(msg)) return new AppError("bad_login", msg);
  if (/Email not confirmed/i.test(msg)) return new AppError("email_unconfirmed", msg);
  if (/already registered|already been registered|user_already_exists/i.test(msg)) return new AppError("user_exists", msg);
  if (/Database error saving new user/i.test(msg)) return new AppError("MITAK_SIGNUPS_CLOSED", msg);
  if (/row-level security/i.test(msg)) return new AppError("not_owner", msg);
  if (/Signups not allowed|signup.*disabled/i.test(msg)) return new AppError("MITAK_SIGNUPS_CLOSED", msg);
  if (/Password should|weak.?password|at least \d+ characters/i.test(msg)) return new AppError("weak_password", msg);
  if (status === 429 || /rate limit|too many/i.test(msg)) return new AppError("rate_limited", msg);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return new AppError("offline", msg);
  if (/JWT|session.*(missing|expired)|not authenticated/i.test(msg)) return new AppError("session_expired", msg);
  return new AppError("error", msg);
}
const guard = async fn => { try { return await fn(); } catch (e) { throw toAppError(e); } };
const check = ({ data, error }) => { if (error) throw toAppError(error); return data; };

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new AppError("offline", "Couldn't load " + src));
    document.head.appendChild(s);
  });
}

const expenseFromRow = r => ({
  id: r.id, category: r.category, amount: Number(r.amount), date: r.expense_date, time: r.expense_time ? String(r.expense_time).slice(0, 5) : "",
  paidBy: r.paid_by, createdBy: r.created_by, updatedBy: r.updated_by, description: r.description || "", location: r.location || "",
  trip: r.trip || "", details: r.details || {}, receipts: r.receipts || [], split: r.split || "none", otherShare: Number(r.other_share || 0),
  createdAt: r.created_at, updatedAt: r.updated_at
});
const expenseToRow = (e, workspaceId) => ({
  id: e.id, workspace_id: workspaceId, category: e.category, amount: e.amount, expense_date: e.date, expense_time: e.time || null,
  paid_by: e.paidBy, description: e.description || "", location: e.location || "", trip: e.trip || "",
  details: e.details || {}, receipts: e.receipts || [], split: e.split || "none", other_share: e.split && e.split !== "none" ? e.otherShare || 0 : 0
});
const settlementFromRow = r => ({ id: r.id, fromUser: r.from_user, toUser: r.to_user, amount: Number(r.amount), date: r.settle_date, note: r.note || "", createdBy: r.created_by, createdAt: r.created_at });
const memberFromRow = r => ({ userId: r.user_id, displayName: r.display_name, role: r.role, profile: r.profile || {}, joinedAt: r.joined_at });
const templateFromRow = r => ({ category: r.category, fileName: r.file_name || "", filePath: r.file_path || "", mapping: r.mapping || {}, updatedAt: r.updated_at, updatedBy: r.updated_by });

/* ===================================================================== */

export class SupabaseBackend {
  constructor({ supabaseUrl, supabaseAnonKey }) {
    this.kind = "supabase";
    this.url = supabaseUrl; this.key = supabaseAnonKey;
    this.client = null; this.user = null; this.workspaceId = null;
    this.listeners = new Set(); this.channel = null;
  }
  async init() {
    if (!window.supabase) await loadScript(SUPABASE_JS);
    this.client = window.supabase.createClient(this.url, this.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "mitak.auth" }
    });
    this.client.auth.onAuthStateChange((event, session) => {
      this.user = session ? { id: session.user.id, email: session.user.email } : null;
      // Don't call Supabase from inside this callback; let it finish first.
      setTimeout(() => this.listeners.forEach(fn => fn(event)), 0);
    });
    const { data } = await this.client.auth.getSession();
    this.user = data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
    return this.user;
  }
  onAuth(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  redirectUrl() { return location.origin + location.pathname; }

  signUp(email, password) {
    return guard(async () => {
      const data = check(await this.client.auth.signUp({ email, password, options: { emailRedirectTo: this.redirectUrl() } }));
      // Supabase answers a repeated sign-up with a user that has no identities.
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new AppError("user_exists");
      return { needsConfirmation: !data.session };
    });
  }
  signIn(email, password) { return guard(async () => { check(await this.client.auth.signInWithPassword({ email, password })); }); }
  signOut() { return guard(async () => { this.unsubscribe(); await this.client.auth.signOut(); this.user = null; this.workspaceId = null; }); }
  sendPasswordReset(email) { return guard(async () => { check(await this.client.auth.resetPasswordForEmail(email, { redirectTo: this.redirectUrl() })); }); }
  updatePassword(password) { return guard(async () => { check(await this.client.auth.updateUser({ password })); }); }

  loadWorkspace() {
    return guard(async () => {
      const ws = check(await this.client.from("workspaces").select("*").maybeSingle());
      if (!ws) { this.workspaceId = null; return null; }
      this.workspaceId = ws.id;
      const members = check(await this.client.from("members").select("*").order("joined_at"));
      return { workspace: { id: ws.id, name: ws.name, inviteCode: ws.invite_code }, members: members.map(memberFromRow) };
    });
  }
  createWorkspace(displayName) { return guard(async () => { const r = check(await this.client.rpc("create_workspace", { p_display_name: displayName })); return { inviteCode: r.invite_code }; }); }
  joinWorkspace(code, displayName) { return guard(async () => { check(await this.client.rpc("join_workspace", { p_code: code, p_display_name: displayName })); }); }
  regenerateInvite() { return guard(async () => check(await this.client.rpc("regenerate_invite"))); }
  updateMyProfile(displayName, profile) {
    return guard(async () => { check(await this.client.from("members").update({ display_name: displayName, profile }).eq("user_id", this.user.id)); });
  }
  renameWorkspace(name) { return guard(async () => { check(await this.client.from("workspaces").update({ name }).eq("id", this.workspaceId)); }); }

  listExpenses() {
    return guard(async () => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = check(await this.client.from("expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + 999));
        out.push(...rows.map(expenseFromRow));
        if (rows.length < 1000) return out;
      }
    });
  }
  saveExpense(e) {
    return guard(async () => expenseFromRow(check(await this.client.from("expenses").upsert(expenseToRow(e, this.workspaceId)).select().single())));
  }
  deleteExpense(e) {
    return guard(async () => {
      check(await this.client.from("expenses").delete().eq("id", e.id));
      const paths = (e.receipts || []).map(r => r.path).filter(Boolean);
      if (paths.length) await this.deleteFiles(paths).catch(() => {});
    });
  }

  full(path) { return `${this.workspaceId}/${path}`; }
  uploadFile(path, blob, contentType) {
    return guard(async () => { check(await this.client.storage.from("mitak").upload(this.full(path), blob, { contentType: contentType || blob.type, upsert: true })); return path; });
  }
  fileUrl(path) { return guard(async () => check(await this.client.storage.from("mitak").createSignedUrl(this.full(path), 3600)).signedUrl); }
  fileBlob(path) { return guard(async () => check(await this.client.storage.from("mitak").download(this.full(path)))); }
  deleteFiles(paths) { return guard(async () => { check(await this.client.storage.from("mitak").remove(paths.map(p => this.full(p)))); }); }

  // Payments between the two, to settle up who owes who.
  listSettlements() {
    return guard(async () => check(await this.client.from("settlements").select("*").order("settle_date", { ascending: false }).order("created_at", { ascending: false })).map(settlementFromRow));
  }
  saveSettlement(st) {
    return guard(async () => settlementFromRow(check(await this.client.from("settlements")
      .insert({ id: st.id, workspace_id: this.workspaceId, from_user: st.fromUser, to_user: st.toUser, amount: st.amount, settle_date: st.date, note: st.note || "" }).select().single())));
  }
  deleteSettlement(id) { return guard(async () => { check(await this.client.from("settlements").delete().eq("id", id)); }); }

  listTemplates() {
    return guard(async () => Object.fromEntries(check(await this.client.from("report_templates").select("*")).map(r => [r.category, templateFromRow(r)])));
  }
  saveTemplate(category, t) {
    return guard(async () => templateFromRow(check(await this.client.from("report_templates")
      .upsert({ workspace_id: this.workspaceId, category, file_name: t.fileName, file_path: t.filePath, mapping: t.mapping || {} }).select().single())));
  }
  deleteTemplate(category) {
    return guard(async () => { check(await this.client.from("report_templates").delete().eq("workspace_id", this.workspaceId).eq("category", category)); });
  }

  subscribe(onChange) {
    this.unsubscribe();
    if (!this.workspaceId) return () => {};
    const f = `workspace_id=eq.${this.workspaceId}`;
    this.channel = this.client.channel("mitak-" + this.workspaceId)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: f }, p => onChange("expenses", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: f }, p => onChange("members", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "report_templates", filter: f }, p => onChange("templates", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "settlements", filter: f }, p => onChange("settlements", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${this.workspaceId}` }, p => onChange("members", p))
      .subscribe();
    return () => this.unsubscribe();
  }
  unsubscribe() { if (this.channel) { this.client.removeChannel(this.channel); this.channel = null; } }

  // Push notifications, sent by the Edge Function "notify".
  async invokeNotify(body) {
    const { data, error } = await this.client.functions.invoke("notify", { body });
    if (!error) return data;
    const status = error.context && error.context.status;
    if (status === 401) throw new AppError("session_expired", error.message);
    if (status === 404 || error.name === "FunctionsRelayError" || (error.name === "FunctionsFetchError" && navigator.onLine)) throw new AppError("push_not_set_up", error.message);
    throw toAppError(error);
  }
  pushPublicKey() { return guard(async () => (await this.invokeNotify({ action: "key" })).publicKey); }
  notifyExpense(expenseId) { return guard(() => this.invokeNotify({ action: "expense", expense_id: expenseId })); }
  testPush() { return guard(() => this.invokeNotify({ action: "test" })); }
  savePushSubscription(s) {
    return guard(async () => { check(await this.client.rpc("save_push_subscription", { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_user_agent: s.userAgent || "" })); });
  }
  deletePushSubscription(endpoint) { return guard(async () => { check(await this.client.rpc("delete_push_subscription", { p_endpoint: endpoint })); }); }
}

/* ===================================================================== */
// Demo: everything lives in this browser. Each browser tab can act as a different person, and
// tabs see each other's changes, so the two-person flow can be tried on one computer.

const DEMO_KEY = "mitak.demo.v1";
const DEMO_TAB_USER = "mitak.demo.user";
const DEMO_DB = "mitak-demo";

const idb = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(DEMO_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("files", mode), q = fn(t.objectStore("files"));
      t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
};

export class DemoBackend {
  constructor(opts = {}) {
    this.kind = "demo";
    this.opts = opts;
    this.listeners = new Set(); this.changeFns = new Set();
    this.urls = new Map();
    window.addEventListener("storage", e => { if (e.key === DEMO_KEY) this.changeFns.forEach(fn => fn("all")); });
  }
  read() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || null; } catch (e) { return null; } }
  write(db) { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); }
  get db() { return this.read() || { users: [], workspace: null, members: [], expenses: [], templates: {} }; }
  mutate(fn) { const db = this.db; const out = fn(db); this.write(db); return out; }
  get userId() { try { return sessionStorage.getItem(DEMO_TAB_USER) || this.db.lastUser || null; } catch (e) { return this.db.lastUser || null; } }
  set userId(v) { try { if (v) sessionStorage.setItem(DEMO_TAB_USER, v); else sessionStorage.removeItem(DEMO_TAB_USER); } catch (e) {} this.mutate(db => { db.lastUser = v || null; }); }
  get user() { const u = this.db.users.find(x => x.id === this.userId); return u ? { id: u.id, email: u.email } : null; }
  async tick() { await sleep(this.opts.latency ?? 120); }
  emit(ev) { setTimeout(() => this.listeners.forEach(fn => fn(ev)), 0); }

  async init() {
    if (!this.read() && this.opts.seed !== false) this.write(seedDemo());
    return this.user;
  }
  onAuth(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async signUp(email, password) {
    await this.tick();
    email = String(email).trim().toLowerCase();
    if (String(password).length < 8) throw new AppError("weak_password", "Password should be at least 8 characters.");
    const db = this.db;
    if (db.users.some(u => u.email === email)) throw new AppError("user_exists");
    if (db.workspace && db.members.length >= 2) throw new AppError("MITAK_SIGNUPS_CLOSED");
    const id = uid();
    this.mutate(d => { d.users.push({ id, email, password }); });
    this.userId = id; this.emit("SIGNED_IN");
    return { needsConfirmation: false };
  }
  async signIn(email, password) {
    await this.tick();
    const u = this.db.users.find(x => x.email === String(email).trim().toLowerCase() && x.password === password);
    if (!u) throw new AppError("bad_login");
    this.userId = u.id; this.emit("SIGNED_IN");
  }
  async signOut() { this.userId = null; this.emit("SIGNED_OUT"); }
  async sendPasswordReset() { await this.tick(); }
  async updatePassword(password) { this.mutate(db => { const u = db.users.find(x => x.id === this.userId); if (u) u.password = password; }); }
  async switchUser() {
    const other = this.db.members.find(m => m.userId !== this.userId);
    if (other) { this.userId = other.userId; this.emit("SIGNED_IN"); }
  }

  member() { return this.db.members.find(m => m.userId === this.userId); }
  async loadWorkspace() {
    await this.tick();
    const db = this.db;
    if (!db.workspace || !db.members.some(m => m.userId === this.userId)) return null;
    return { workspace: { ...db.workspace }, members: db.members.map(m => ({ ...m })) };
  }
  async createWorkspace(displayName) {
    await this.tick();
    if (!this.userId) throw new AppError("MITAK_NOT_SIGNED_IN");
    if (this.member()) throw new AppError("MITAK_ALREADY_MEMBER");
    if (this.db.workspace) throw new AppError("MITAK_WORKSPACE_EXISTS");
    const name = cleanName(displayName);
    const code = inviteCode();
    this.mutate(db => {
      db.workspace = { id: uid(), name: "MITAK", inviteCode: code };
      db.members = [{ userId: this.userId, displayName: name, role: "owner", profile: {}, joinedAt: new Date().toISOString() }];
    });
    return { inviteCode: code };
  }
  async joinWorkspace(code, displayName) {
    await this.tick();
    if (this.member()) throw new AppError("MITAK_ALREADY_MEMBER");
    const c = String(code || "").toUpperCase().replace(/^\s*MITAK/, "").replace(/[^0-9A-F]/g, "");
    const db = this.db;
    if (!db.workspace || !db.workspace.inviteCode || c !== db.workspace.inviteCode) throw new AppError("MITAK_INVITE_INVALID");
    if (db.members.length >= 2) throw new AppError("MITAK_WORKSPACE_FULL");
    const name = cleanName(displayName);
    this.mutate(d => { d.members.push({ userId: this.userId, displayName: name, role: "member", profile: {}, joinedAt: new Date().toISOString() }); d.workspace.inviteCode = null; });
  }
  async regenerateInvite() {
    const m = this.member();
    if (!m || m.role !== "owner") throw new AppError("MITAK_OWNER_ONLY");
    if (this.db.members.length >= 2) throw new AppError("MITAK_WORKSPACE_FULL");
    const code = inviteCode();
    this.mutate(db => { db.workspace.inviteCode = code; });
    return code;
  }
  async updateMyProfile(displayName, profile) {
    await this.tick();
    this.mutate(db => { const m = db.members.find(x => x.userId === this.userId); if (m) { m.displayName = cleanName(displayName); m.profile = profile || {}; } });
  }
  async renameWorkspace(name) { this.mutate(db => { db.workspace.name = name; }); }

  async listExpenses() { await this.tick(); return this.db.expenses.map(e => ({ ...e })); }
  async saveExpense(e) {
    await this.tick();
    if (!this.db.members.some(m => m.userId === e.paidBy)) throw new AppError("MITAK_PAID_BY_NOT_MEMBER");
    const before = this.db.expenses.find(x => x.id === e.id);
    // Same rules as the database: only your own expenses.
    if (e.paidBy !== this.userId || (before && before.paidBy !== this.userId)) throw new AppError("not_owner");
    const share = e.split && e.split !== "none" ? Math.round(+e.otherShare * 100) / 100 : 0;
    if (share < 0 || share > +e.amount) throw new AppError("bad_split");
    return this.mutate(db => {
      const now = new Date().toISOString();
      const i = db.expenses.findIndex(x => x.id === e.id);
      const prev = i >= 0 ? db.expenses[i] : null;
      e = { ...e, split: e.split || "none", otherShare: share };
      const saved = { ...e, amount: Math.round(+e.amount * 100) / 100, createdBy: prev ? prev.createdBy : this.userId, createdAt: prev ? prev.createdAt : now, updatedBy: this.userId, updatedAt: now };
      if (i >= 0) db.expenses[i] = saved; else db.expenses.push(saved);
      return { ...saved };
    });
  }
  async deleteExpense(e) {
    await this.tick();
    const cur = this.db.expenses.find(x => x.id === e.id);
    if (cur && cur.paidBy !== this.userId) throw new AppError("not_owner");
    this.mutate(db => { db.expenses = db.expenses.filter(x => x.id !== e.id); });
    await this.deleteFiles((e.receipts || []).map(r => r.path).filter(Boolean)).catch(() => {});
  }
  async uploadFile(path, blob) { await idb.run("readwrite", s => s.put(blob, path)); return path; }
  async fileBlob(path) {
    const b = await idb.run("readonly", s => s.get(path));
    if (!b) throw new AppError("not_found", "File not found");
    return b;
  }
  async fileUrl(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const u = URL.createObjectURL(await this.fileBlob(path));
    this.urls.set(path, u); return u;
  }
  async deleteFiles(paths) { for (const p of paths) await idb.run("readwrite", s => s.delete(p)); }
  async listSettlements() { return (this.db.settlements || []).map(x => ({ ...x })); }
  async saveSettlement(st) {
    await this.tick();
    if (st.fromUser === st.toUser) throw new AppError("MITAK_SAME_PERSON");
    if (![st.fromUser, st.toUser].includes(this.userId)) throw new AppError("not_owner");
    return this.mutate(db => { const saved = { ...st, amount: Math.round(+st.amount * 100) / 100, createdBy: this.userId, createdAt: new Date().toISOString() }; (db.settlements ||= []).push(saved); return { ...saved }; });
  }
  async deleteSettlement(id) {
    const cur = (this.db.settlements || []).find(x => x.id === id);
    if (cur && cur.createdBy !== this.userId) throw new AppError("not_owner");
    this.mutate(db => { db.settlements = (db.settlements || []).filter(x => x.id !== id); });
  }
  async listTemplates() { return { ...(this.db.templates || {}) }; }
  async saveTemplate(category, t) {
    return this.mutate(db => { db.templates = db.templates || {}; db.templates[category] = { category, fileName: t.fileName, filePath: t.filePath, mapping: t.mapping || {}, updatedAt: new Date().toISOString(), updatedBy: this.userId }; return db.templates[category]; });
  }
  async deleteTemplate(category) { this.mutate(db => { if (db.templates) delete db.templates[category]; }); }
  subscribe(onChange) { this.changeFns.add(onChange); return () => this.changeFns.delete(onChange); }
  reset() { localStorage.removeItem(DEMO_KEY); try { sessionStorage.removeItem(DEMO_TAB_USER); } catch (e) {} indexedDB.deleteDatabase(DEMO_DB); }
}

function cleanName(n) {
  const s = String(n || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!s) throw new AppError("MITAK_NAME_REQUIRED");
  return s;
}
function inviteCode() { return uid().replace(/-/g, "").slice(0, 12).toUpperCase(); }

// A month and a half of believable expenses for two colleagues, so the demo isn't empty.
export function seedDemo(today = todayISO()) {
  const u1 = uid(), u2 = uid();
  const month = monthOf(today), prev = shiftMonth(month, -1);
  const day = Number(today.slice(8, 10));
  const ex = [];
  let odo1 = 84210, odo2 = 51990;
  const add = (date, paidBy, category, amount, extra = {}) => ex.push({
    id: uid(), category, amount, date, time: extra.time || "09:30", paidBy, createdBy: paidBy, updatedBy: paidBy,
    description: extra.description || "", location: extra.location || "", trip: extra.trip || "", details: extra.details || {}, receipts: [],
    split: extra.split || "none", otherShare: extra.split === "equal" ? Math.round(amount * 50) / 100 : extra.otherShare || 0,
    createdAt: `${date}T09:30:00.000Z`, updatedAt: `${date}T09:30:00.000Z`
  });
  const plan = [
    [prev, 2, "together"], [prev, 5, "u1"], [prev, 9, "together"], [prev, 13, "u2"], [prev, 17, "together"], [prev, 21, "u1"], [prev, 24, "u2"], [prev, 27, "together"],
    [month, 1, "together"], [month, 3, "u1"], [month, 4, "u2"], [month, 6, "together"], [month, 8, "u1"]
  ];
  for (const [m, d, who] of plan) {
    if (m === month && d > day) continue;
    const date = `${m}-${pad(d)}`;
    if (who === "together") {
      const trip = d % 2 ? "Abu Dhabi → Dubai" : "Abu Dhabi → Ruwais";
      odo1 += 380;
      add(date, u1, "fuel", 150 + (d % 4) * 12.5, { trip, time: "07:10", description: "ADNOC", split: "equal", details: { site_type: "Deployment", kms: 380, bill_attached: "Y", vehicle: "Plate A 12345", odometer: odo1, litres: 52.6, fuel_station: "ADNOC" } });
      add(date, u1, "toll", 8, { trip, time: "07:55", description: "Salik", details: { toll_gate: "Salik – Al Safa", vehicle: "Plate A 12345" } });
      add(date, u2, "food", 60, { trip, time: "13:20", description: "Lunch for both", split: "custom", otherShare: 25 + (d % 3) * 5 });
      add(date, u2, "parking", 20, { trip, time: "10:05", description: "Site parking", location: trip.endsWith("Dubai") ? "Dubai" : "Ruwais", details: { duration: "4 hours" } });
    } else if (who === "u1") {
      odo1 += 160;
      add(date, u1, "fuel", 120, { time: "18:40", description: "ENOC", details: { site_type: "AEP Client Site", kms: 160, bill_attached: "Y", vehicle: "Plate A 12345", odometer: odo1, litres: 41.2, fuel_station: "ENOC" } });
      add(date, u1, "parking", 15, { time: "11:00", description: "Mawaqif", location: "Abu Dhabi", details: { duration: "3 hours" } });
    } else {
      odo2 += 210;
      add(date, u2, "fuel", 135.5, { time: "08:05", description: "ADNOC", details: { site_type: "AEP Client Site", kms: 210, bill_attached: "Y", vehicle: "Plate B 67890", odometer: odo2, litres: 46.4, fuel_station: "ADNOC" } });
      add(date, u2, "food", 32, { time: "13:00", description: "Lunch" });
    }
  }
  return {
    users: [{ id: u1, email: "sami@demo.mitak", password: "demo-demo" }, { id: u2, email: "omar@demo.mitak", password: "demo-demo" }],
    lastUser: u1,
    workspace: { id: uid(), name: "MITAK", inviteCode: null },
    members: [
      { userId: u1, displayName: "Sami", role: "owner", profile: { vehicle: "Plate A 12345" }, joinedAt: `${prev}-01T08:00:00.000Z` },
      { userId: u2, displayName: "Omar", role: "member", profile: { vehicle: "Plate B 67890" }, joinedAt: `${prev}-01T08:05:00.000Z` }
    ],
    expenses: ex,
    settlements: [{ id: uid(), fromUser: u2, toUser: u1, amount: 100, date: `${prev}-28`, note: "Cash", createdBy: u2, createdAt: `${prev}-28T18:00:00.000Z` }],
    templates: {}
  };
}
