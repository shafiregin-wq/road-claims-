// MITAK: start-up, sign-in, workspace set-up, navigation and screen actions.

import { S, me, setRenderer } from "./state.js";
import { SupabaseBackend, DemoBackend } from "./data.js";
import { VIEWS, TABS, VIEW_ACTIONS, onViewChange } from "./views.js";
import { openExpense, errText } from "./expense-form.js";
import { pickTemplate, openMappingEditor, openTemplateMenu, runReport } from "./templates-ui.js";
import { PROFILE_FIELDS, PLACES, STATIONS, TOLL_GATES } from "./fields.js";
import { esc, formatInvite } from "./util.js";
import { $, ic, toast, openSheet, confirmDialog, copyText, SHEETS } from "./ui.js";
import { refreshPushState, enablePush, disablePush, testPush, dismissBanner } from "./push.js";

const CACHE_KEY = "mitak.cache.v1";
const MODE_KEY = "mitak.mode";
const INVITE_KEY = "mitak.invite";

const AUTH_ERRORS = {
  bad_login: "That email or password isn’t right.",
  email_unconfirmed: "Confirm your email first: open the link we sent you, then sign in.",
  user_exists: "There’s already an account with this email. Sign in instead.",
  weak_password: "Use a password of at least 8 characters.",
  MITAK_SIGNUPS_CLOSED: "MITAK is private and already has its two members, so no new accounts can be made.",
  missing: "Enter your email and password.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  offline: "No connection. Check your internet and try again.",
  MITAK_WORKSPACE_EXISTS: "Your colleague has already set up MITAK. Ask them for the invite code and join below.",
  MITAK_INVITE_INVALID: "That invite code isn’t right, or it has already been used. Check it with your colleague.",
  MITAK_WORKSPACE_FULL: "This MITAK workspace already has its two members.",
  MITAK_NAME_REQUIRED: "Enter your name.",
  MITAK_OWNER_ONLY: "Only the person who set up MITAK can do that."
};
const authErr = (e, fallback) => AUTH_ERRORS[e && e.code] || errText(e, fallback);

/* ===================== Cache (instant start, works offline for viewing) ===================== */

function readCache() { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); return c && S.user && c.userId === S.user.id && c.kind === S.backend.kind ? c : null; } catch (e) { return null; } }
function writeCache() {
  if (!S.user || !S.workspace) return;
  try {
    const s = JSON.stringify({ kind: S.backend.kind, userId: S.user.id, workspace: S.workspace, members: S.members, expenses: S.expenses, templates: S.templates, at: Date.now() });
    if (s.length < 3_000_000) localStorage.setItem(CACHE_KEY, s);
  } catch (e) {}
}
const clearCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} };

/* ===================== Start-up ===================== */

let authMode = "signin", authMsg = "", authErrMsg = "", unsub = null;

function pickBackend(q) {
  const cfg = window.MITAK_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/YOUR-PROJECT/.test(cfg.supabaseUrl));
  if (q.has("demo")) { try { localStorage.setItem(MODE_KEY, "demo"); } catch (e) {} }
  const demo = q.has("demo") || (localStorage.getItem(MODE_KEY) === "demo");
  if (demo) return new DemoBackend({ seed: q.get("demo") !== "empty", latency: q.has("latency") ? +q.get("latency") : undefined });
  if (configured) return new SupabaseBackend(cfg);
  return null;
}

async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get("invite")) { try { sessionStorage.setItem(INVITE_KEY, q.get("invite")); } catch (e) {} }
  S.backend = pickBackend(q);
  if (q.has("invite") || q.has("demo")) {
    q.delete("invite"); q.delete("demo"); q.delete("latency");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
  }
  insertDatalists();
  if (!S.backend) { S.phase = "config"; render(); return; }
  S.backend.onAuth(ev => {
    if (ev === "PASSWORD_RECOVERY") { authMode = "recovery"; S.phase = "auth"; render(); return; }
    if (ev === "SIGNED_OUT") { leave(); return; }
    if (ev === "SIGNED_IN" && (!S.user || S.user.id !== (S.backend.user && S.backend.user.id))) enter();
  });
  try { await S.backend.init(); }
  catch (e) { S.phase = "config"; S.bootError = e; render(); return; }
  await enter();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").then(() => { if (S.phase === "app") refreshPushState(); }).catch(() => {});
    // Tapping a notification brings MITAK forward: show the new expense straight away.
    navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "refresh") onRemoteChange(); });
  }
}

async function enter() {
  S.user = S.backend.user;
  if (!S.user) { S.phase = "auth"; render(); return; }
  if (authMode === "recovery") { S.phase = "auth"; render(); return; }
  const cached = readCache();
  if (cached) {
    Object.assign(S, { workspace: cached.workspace, members: cached.members, expenses: cached.expenses, templates: cached.templates || {}, phase: "app", loaded: true });
    render();
  } else if (S.phase !== "app") { S.phase = "loading"; render(); }
  try {
    const w = await S.backend.loadWorkspace();
    if (!w) { S.workspace = null; S.members = []; S.phase = "onboard"; clearCache(); render(); return; }
    S.workspace = w.workspace; S.members = w.members;
    const [expenses, templates] = await Promise.all([S.backend.listExpenses(), S.backend.listTemplates()]);
    S.expenses = expenses; S.templates = templates; S.loaded = true; S.phase = "app";
    writeCache(); render();
    if (unsub) unsub();
    unsub = S.backend.subscribe(onRemoteChange);
    refreshPushState();
  } catch (e) {
    if (e.code === "session_expired") { await S.backend.signOut().catch(() => {}); return; }
    if (S.phase === "app") toast(e.code === "offline" ? "Offline: showing the last saved data." : errText(e, "Couldn’t refresh. Showing the last saved data."), "bad", 4500);
    else { S.phase = "error"; S.bootError = e; render(); }
  }
}

function leave() {
  if (unsub) { unsub(); unsub = null; }
  SHEETS.slice().forEach(s => s.close());
  clearCache();
  Object.assign(S, { user: null, workspace: null, members: [], expenses: [], templates: {}, loaded: false, phase: "auth", view: "home" });
  authMode = "signin"; authErrMsg = ""; render();
}

// When the colleague saves something, refresh quietly.
let refreshTimer = null, refreshing = false;
function onRemoteChange() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshData, 400);
}
async function refreshData() {
  if (refreshing || S.phase !== "app") return;
  refreshing = true;
  try {
    const w = await S.backend.loadWorkspace();
    if (!w) { await enter(); return; }
    S.workspace = w.workspace; S.members = w.members;
    [S.expenses, S.templates] = await Promise.all([S.backend.listExpenses(), S.backend.listTemplates()]);
    writeCache(); render();
  } catch (e) { /* stay on what we have */ }
  finally { refreshing = false; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.phase === "app") { onRemoteChange(); refreshPushState(); } });

function insertDatalists() {
  const dl = (id, arr) => `<datalist id="${id}">${arr.map(v => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
  document.body.insertAdjacentHTML("beforeend", dl("dl-places", PLACES) + dl("dl-stations", STATIONS) + dl("dl-tolls", TOLL_GATES));
}

/* ===================== Rendering ===================== */

const logo = `<span class="logo" aria-hidden="true">M</span>`;

function render() {
  const root = $("#root"), shell = $("#shell");
  if (S.phase !== "app") {
    shell.hidden = true; root.hidden = false;
    // Keep what was typed (except passwords) when the screen redraws, e.g. after an error.
    const keep = {};
    root.querySelectorAll("input[id]:not([type=password])").forEach(i => { keep[i.id] = i.value; });
    root.innerHTML = S.phase === "config" ? screenConfig() : S.phase === "auth" ? screenAuth() : S.phase === "onboard" ? screenOnboard() : S.phase === "error" ? screenError() : `<div class="splash">${logo}<p class="muted">Loading MITAK…</p></div>`;
    for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el && v && !el.value) el.value = v; }
    const f = root.querySelector("[autofocus]"); if (f) f.focus();
    return;
  }
  root.hidden = true; shell.hidden = false;
  if (!VIEWS[S.view]) S.view = "home";
  const main = $("#main");
  const a = document.activeElement;
  const fid = a && a.id && main.contains(a) ? a.id : null;
  $("#tabs").innerHTML = TABS.map(([v, i, l]) => `<button class="tab" data-act="go" data-to="${v}" ${S.view === v ? 'aria-current="page"' : ""}>${ic(i, 22)}<span>${l}</span></button>`).join("");
  const demo = S.backend.kind === "demo", my = me();
  $("#who").innerHTML = demo ? `<span class="demo-badge" title="Demo mode">Demo · ${esc(my ? my.displayName : "")}</span>` : "";
  $("#gear").setAttribute("aria-current", S.view === "settings" ? "page" : "false");
  $("#fab").hidden = S.view === "home" || S.view === "settings";
  main.innerHTML = VIEWS[S.view]();
  if (fid) { const el = document.getElementById(fid); if (el) el.focus({ preventScroll: true }); }
  SHEETS.slice().forEach(s => s.refresh && s.refresh());
}
setRenderer(render);

function go(view, anchor) {
  S.view = VIEWS[view] ? view : "home";
  try { history.replaceState(null, "", "#" + S.view); } catch (e) {}
  render(); window.scrollTo(0, 0);
  if (anchor) { const el = document.getElementById(anchor); if (el) el.scrollIntoView({ block: "start" }); }
}
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== S.view && S.phase === "app") { S.view = v; render(); } });

/* ===================== Screens before the app ===================== */

function screenConfig() {
  const e = S.bootError;
  return `<div class="gate">
    <div class="brand">${logo}<h1 class="word">MITAK</h1><p class="muted">Shared travel expenses for two colleagues.</p></div>
    <section class="card stack">
      <h2>${e ? "Couldn’t reach MITAK’s database" : "MITAK isn’t connected yet"}</h2>
      ${e ? `<p>${esc(errText(e, "The connection failed."))}</p>` : `<p>MITAK keeps your shared expenses in your own free Supabase project. Whoever looks after the app sets it up once (about 10 minutes, see <b>SETUP.md</b>), then puts the project address and key in <code>config.js</code>.</p>`}
      <button class="btn primary xl" data-act="start-demo">Try the demo</button>
      <p class="hint">The demo runs only on this device with sample expenses. Nothing is shared.</p>
      ${e ? `<button class="btn" data-act="reload">Try again</button>` : ""}
    </section>
  </div>`;
}

function screenError() {
  return `<div class="gate"><div class="brand">${logo}<h1 class="word">MITAK</h1></div>
    <section class="card stack"><h2>Couldn’t load your expenses</h2><p>${esc(errText(S.bootError, "Something went wrong."))}</p>
    <button class="btn primary" data-act="reload">Try again</button><button class="btn" data-act="sign-out">Sign out</button></section></div>`;
}

function screenAuth() {
  const invited = (() => { try { return sessionStorage.getItem(INVITE_KEY); } catch (e) { return null; } })();
  const m = authMode;
  const title = { signin: "Sign in", signup: "Create your account", forgot: "Reset your password", recovery: "Choose a new password", sent: "Check your email" }[m];
  let body = "";
  if (m === "signin" || m === "signup") body = `
      <div class="field"><label class="lbl" for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" autocapitalize="off" required autofocus></div>
      <div class="field"><label class="lbl" for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="${m === "signup" ? "new-password" : "current-password"}" minlength="${m === "signup" ? 8 : 1}" required>${m === "signup" ? `<span class="hint">At least 8 characters.</span>` : ""}</div>
      <button class="btn primary xl" type="submit">${m === "signup" ? "Create account" : "Sign in"}</button>
      ${m === "signin" ? `<button class="link" type="button" data-act="auth-mode" data-m="forgot">Forgot password?</button>` : ""}`;
  if (m === "forgot") body = `
      <p class="small">We’ll email you a link to choose a new password.</p>
      <div class="field"><label class="lbl" for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" required autofocus></div>
      <button class="btn primary xl" type="submit">Send reset link</button>
      <button class="link" type="button" data-act="auth-mode" data-m="signin">Back to sign in</button>`;
  if (m === "recovery") body = `
      <div class="field"><label class="lbl" for="a-pass">New password</label><input id="a-pass" type="password" autocomplete="new-password" minlength="8" required autofocus><span class="hint">At least 8 characters.</span></div>
      <button class="btn primary xl" type="submit">Save new password</button>`;
  if (m === "sent") body = `<p>${authMsg}</p><button class="btn" type="button" data-act="auth-mode" data-m="signin">Back to sign in</button>`;
  return `<div class="gate">
    <div class="brand">${logo}<h1 class="word">MITAK</h1><p class="muted">Shared travel expenses for two colleagues.</p></div>
    ${invited && (m === "signin" || m === "signup") ? `<div class="note">You’ve been invited to MITAK. ${m === "signup" ? "Create your account, then you’ll join with the code." : "New here? Create an account first."}</div>` : ""}
    ${m === "signin" || m === "signup" ? `<div class="seg two auth-tabs" role="tablist"><button class="chip" role="tab" data-act="auth-mode" data-m="signin" aria-pressed="${m === "signin"}">Sign in</button><button class="chip" role="tab" data-act="auth-mode" data-m="signup" aria-pressed="${m === "signup"}">Create account</button></div>` : ""}
    <form class="card stack" id="auth-form" novalidate>
      <h2>${title}</h2>
      ${body}
      <p class="err" role="alert">${esc(authErrMsg)}</p>
    </form>
    ${S.backend.kind === "demo" ? `<div class="note">Demo on this device. ${S.backend.db.users.length ? `Sample accounts: <b>sami@demo.mitak</b> and <b>omar@demo.mitak</b>, password <b>demo-demo</b>.` : ""} <button class="link" data-act="leave-demo">Leave demo</button></div>` : ""}
    <p class="hint center">${ic("lock", 14)} Private to the two members of your MITAK workspace.</p>
  </div>`;
}

function screenOnboard() {
  const invited = (() => { try { return sessionStorage.getItem(INVITE_KEY) || ""; } catch (e) { return ""; } })();
  return `<div class="gate">
    <div class="brand">${logo}<h1>Welcome to MITAK</h1><p class="muted">Signed in as ${esc(S.user.email)}</p></div>
    <form class="card stack" id="onboard-form" novalidate>
      <div class="field"><label class="lbl" for="o-name">Your name</label><input id="o-name" maxlength="40" autocomplete="given-name" placeholder="How your colleague will see you" required autofocus></div>
      ${invited ? "" : `<div class="choice">
        <h2>Starting MITAK?</h2>
        <p class="small muted">The first of you creates the workspace and gets an invite code for the other.</p>
        <button class="btn primary" type="button" data-act="create-ws">Create the MITAK workspace</button>
      </div>
      <div class="or"><span>or</span></div>`}
      <div class="choice">
        <h2>Joining your colleague?</h2>
        <div class="field"><label class="lbl" for="o-code">Invite code</label><input id="o-code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="e.g. 7F3A-9C2E-B014" value="${esc(formatInvite(String(invited).toUpperCase().replace(/[^0-9A-F]/g, "")))}"></div>
        <button class="btn ${invited ? "primary" : ""}" type="submit">Join with this code</button>
      </div>
      <p class="err" role="alert">${esc(authErrMsg)}</p>
    </form>
    <button class="link center" data-act="sign-out">Sign out</button>
  </div>`;
}

/* ===================== Forms before the app ===================== */

document.addEventListener("submit", async ev => {
  const form = ev.target;
  if (form.id !== "auth-form" && form.id !== "onboard-form") return;
  ev.preventDefault();
  const btn = form.querySelector("[type=submit]"); if (btn) btn.disabled = true;
  authErrMsg = "";
  const errEl = form.querySelector(".err"); if (errEl) errEl.textContent = "";
  try {
    if (form.id === "onboard-form") await join();
    else await submitAuth();
  } catch (e) {
    authErrMsg = authErr(e, "Something went wrong. Try again.");
    if (S.phase !== "app") render();
  } finally { if (btn && btn.isConnected) btn.disabled = false; }
});

async function submitAuth() {
  const email = ($("#a-email") || {}).value, pass = ($("#a-pass") || {}).value;
  const b = S.backend;
  if (authMode === "signin") {
    if (!email || !pass) throw Object.assign(new Error("missing"), { code: "missing" });
    await b.signIn(email.trim(), pass);
    await enter();
  } else if (authMode === "signup") {
    if (!/^\S+@\S+\.\S+$/.test(email || "")) { authErrMsg = "Enter your email address."; render(); return; }
    if (!pass || pass.length < 8) { authErrMsg = AUTH_ERRORS.weak_password; render(); return; }
    const r = await b.signUp(email.trim(), pass);
    if (r.needsConfirmation) { authMode = "sent"; authMsg = `We sent a confirmation link to <b>${esc(email)}</b>. Open it on this device, then sign in.`; render(); return; }
    await enter();
  } else if (authMode === "forgot") {
    if (!email) { authErrMsg = "Enter your email address."; render(); return; }
    await b.sendPasswordReset(email.trim());
    authMode = "sent"; authMsg = `If there’s a MITAK account for <b>${esc(email)}</b>, a reset link is on its way.`; render();
  } else if (authMode === "recovery") {
    if (!pass || pass.length < 8) { authErrMsg = AUTH_ERRORS.weak_password; render(); return; }
    await b.updatePassword(pass);
    authMode = "signin"; toast("Password changed.", "ok");
    await enter();
  }
}

function onboardName() {
  const n = ($("#o-name") || {}).value || "";
  if (!n.trim()) { authErrMsg = AUTH_ERRORS.MITAK_NAME_REQUIRED; render(); return null; }
  return n.trim();
}
async function createWorkspace() {
  const errEl = $("#onboard-form .err"); if (errEl) errEl.textContent = "";
  const name = onboardName(); if (!name) return;
  try {
    const r = await S.backend.createWorkspace(name);
    await enter();
    showInviteSheet(r.inviteCode, true);
  } catch (e) { authErrMsg = authErr(e); render(); }
}
async function join() {
  const name = onboardName(); if (!name) return;
  const code = ($("#o-code") || {}).value || "";
  if (!code.trim()) { authErrMsg = "Enter the invite code from your colleague."; render(); return; }
  try {
    await S.backend.joinWorkspace(code, name);
    try { sessionStorage.removeItem(INVITE_KEY); } catch (e) {}
    await enter();
    toast("You’ve joined MITAK.", "ok");
  } catch (e) { authErrMsg = authErr(e); render(); }
}

/* ===================== Invite ===================== */

const inviteLink = code => `${location.origin}${location.pathname}?invite=${code}`;
const inviteText = code => `Join me on MITAK to track our travel expenses together.\n\n1. Open ${inviteLink(code)}\n2. Create an account\n3. Enter the invite code: ${formatInvite(code)}`;

async function shareInvite() {
  const code = S.workspace && S.workspace.inviteCode; if (!code) return;
  try {
    if (navigator.share) { await navigator.share({ title: "Join me on MITAK", text: inviteText(code) }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  if (await copyText(inviteText(code))) toast("Invite copied. Paste it in WhatsApp or email.", "ok");
}
function showInviteSheet(code, fresh) {
  const sh = openSheet(fresh ? "MITAK is ready" : "Invite your colleague", { small: true });
  sh.body.innerHTML = `<p>${fresh ? "Now invite your colleague. " : ""}They create an account in MITAK and enter this code. It works once; after that, MITAK is closed to everyone else.</p>
    <div class="code-big" data-testid="invite-code-sheet">${esc(formatInvite(code))}</div>
    <button class="btn primary xl" data-x="share">${ic("share", 20)} Share invite</button>
    <button class="btn" data-x="copy">${ic("copy", 18)} Copy code</button>
    <p class="hint">You can find the code later on the Home screen and in Settings.</p>`;
  sh.body.addEventListener("click", async ev => {
    const x = ev.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "share") shareInvite();
    if (x.dataset.x === "copy" && await copyText(formatInvite(code))) toast("Code copied.", "ok");
  });
}

/* ===================== Settings actions ===================== */

async function saveProfile() {
  const name = ($("#pf-name").value || "").trim();
  if (!name) { toast("Enter your name.", "bad"); return; }
  const profile = {};
  PROFILE_FIELDS.forEach(f => { const v = ($(`#pf-${f.key}`).value || "").trim(); if (v) profile[f.key] = v; });
  try {
    await S.backend.updateMyProfile(name, profile);
    const m = me(); if (m) { m.displayName = name; m.profile = profile; }
    writeCache(); render(); toast("Details saved.", "ok");
  } catch (e) { toast(errText(e, "Couldn’t save your details."), "bad"); }
}

function changePassword() {
  const sh = openSheet("Change password", { small: true });
  sh.body.innerHTML = `<form class="stack" id="pw-form"><div class="field"><label class="lbl" for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
    <button class="btn primary" type="submit">Save password</button><p class="err" role="alert"></p></form>`;
  $("#pw-form", sh.body).addEventListener("submit", async ev => {
    ev.preventDefault();
    const v = $("#pw-new", sh.body).value;
    if (v.length < 8) { $(".err", sh.body).textContent = AUTH_ERRORS.weak_password; return; }
    try { await S.backend.updatePassword(v); sh.close(); toast("Password changed.", "ok"); }
    catch (e) { $(".err", sh.body).textContent = authErr(e, "Couldn’t change the password."); }
  });
  setTimeout(() => $("#pw-new", sh.body).focus(), 50);
}

/* ===================== Global actions ===================== */

const ACT = {
  ...VIEW_ACTIONS,
  "go": b => go(b.dataset.to, b.dataset.anchor),
  "reload": () => location.reload(),
  "start-demo": () => { try { localStorage.setItem(MODE_KEY, "demo"); } catch (e) {} location.reload(); },
  "auth-mode": b => { authMode = b.dataset.m; authErrMsg = ""; render(); },
  "create-ws": () => createWorkspace(),
  "add-expense": b => openExpense(null, { date: b.dataset.date }),
  "edit-expense": b => openExpense(b.dataset.id),
  "filter-cat": b => { S.xf = { ...S.xf, month: b.dataset.month || S.xf.month, date: "", category: b.dataset.cat, user: "", trip: "" }; go("expenses"); },
  "filter-trip": b => { S.xf = { ...S.xf, month: b.dataset.month || "", date: "", category: "", user: "", trip: b.dataset.trip }; go("expenses"); },
  "share-invite": () => shareInvite(),
  "copy-invite": async () => { if (S.workspace && S.workspace.inviteCode && await copyText(formatInvite(S.workspace.inviteCode))) toast("Code copied.", "ok"); },
  "new-invite": async () => {
    if (!await confirmDialog("Make a new invite code?", { okLabel: "New code", danger: false, detail: "The old code will stop working." })) return;
    try { S.workspace.inviteCode = await S.backend.regenerateInvite(); render(); showInviteSheet(S.workspace.inviteCode); }
    catch (e) { toast(authErr(e, "Couldn’t make a new code."), "bad"); }
  },
  "save-profile": () => saveProfile(),
  "push-on": () => enablePush(),
  "push-off": () => disablePush(),
  "push-test": () => testPush(),
  "push-dismiss": () => dismissBanner(),
  "generate": b => runReport(b.dataset.cat),
  "tpl-upload": b => pickTemplate(b.dataset.cat),
  "tpl-edit": b => openMappingEditor(b.dataset.cat),
  "tpl-menu": b => openTemplateMenu(b.dataset.cat),
  "change-password": () => changePassword(),
  "leave-demo": () => {
    try { localStorage.removeItem(MODE_KEY); } catch (e) {}
    clearCache(); location.href = location.pathname;
  },
  "sign-out": async () => {
    if (S.phase === "app" && !await confirmDialog("Sign out of MITAK?", { okLabel: "Sign out", danger: false })) return;
    // This phone shouldn't keep getting notifications for someone who signed out.
    if (S.push && S.push.state === "on") await disablePush({ quiet: true });
    try { await S.backend.signOut(); } catch (e) {}
    leave();
  },
  "demo-switch": async () => { await S.backend.switchUser(); clearCache(); await enter(); toast(`You’re now ${me() ? me().displayName : "the other person"}.`); },
  "demo-reset": async () => {
    if (!await confirmDialog("Start the demo again?", { okLabel: "Start again", detail: "Demo expenses on this device are replaced with fresh sample data." })) return;
    S.backend.reset(); clearCache(); location.reload();
  }
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const fn = ACT[b.dataset.act]; if (fn) { e.preventDefault(); fn(b, e); }
});
document.addEventListener("change", e => { if (S.phase === "app" && $("#main").contains(e.target)) onViewChange(e.target); });
document.addEventListener("keydown", e => {
  if (S.phase !== "app" || SHEETS.length || e.target.closest("input,textarea,select")) return;
  if (e.key === "n" || e.key === "+") { e.preventDefault(); openExpense(null); }
});

/* ===================== Boot ===================== */

$("#fab").innerHTML = `${ic("plus", 22)} Add Expense`;
$("#gear").innerHTML = ic("gear", 22);
{ const h = location.hash.slice(1); if (VIEWS[h]) S.view = h; }
boot();
