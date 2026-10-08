// Shared UI pieces: icons, bottom sheets, toasts, confirm dialogs, file saving, images.

import { esc, sleep } from "./util.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  chart: '<path d="M5 20V11M11 20V5M17 20v-7M3 20h18"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>',
  clip: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v4h16v-4"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  file: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  wand: '<path d="M4 20 15 9M14 4v2M19 9h2M17.5 5.5l1.4-1.4M10 6l1.5 1.5M18 13l-1.5-1.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
};
export const ic = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

/* ---------- Toasts ---------- */
export function toast(msg, tone, ms = 3000) {
  const el = document.createElement("div");
  el.className = "toast" + (tone === "bad" ? " bad" : tone === "ok" ? " ok" : "");
  el.innerHTML = tone === "ok" ? ic("check", 18) + "<span></span>" : "<span></span>";
  el.lastChild.textContent = msg;
  $("#toast").appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 250); }, ms);
}
export function busy(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="spin"></span><span></span>`;
  el.lastChild.textContent = msg;
  $("#toast").appendChild(el);
  return { set: m => { el.lastChild.textContent = m; }, done: () => el.remove() };
}

/* ---------- Sheets (full-height panels on phones, dialogs on desktop) ---------- */
export const SHEETS = [];
export function openSheet(title, opts = {}) {
  const scrim = document.createElement("div");
  scrim.className = "scrim" + (opts.small ? " small" : "");
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><h2></h2><button class="icon-btn" data-close aria-label="Close">${ic("x")}</button></div><div class="sheet-body"></div><div class="sheet-foot"></div></div>`;
  $("h2", scrim).textContent = title;
  $(".sheet", scrim).setAttribute("aria-label", title);
  document.body.appendChild(scrim);
  document.body.classList.add("locked");
  const api = {
    el: scrim, body: $(".sheet-body", scrim), foot: $(".sheet-foot", scrim), refresh: null, onClose: null,
    setTitle(t) { $("h2", scrim).textContent = t; },
    close() {
      if (!scrim.isConnected) return;
      scrim.remove();
      const i = SHEETS.indexOf(api); if (i >= 0) SHEETS.splice(i, 1);
      if (!SHEETS.length) document.body.classList.remove("locked");
      api.onClose && api.onClose();
    }
  };
  $("[data-close]", scrim).onclick = () => api.close();
  scrim.addEventListener("mousedown", e => { if (e.target === scrim && !opts.sticky) api.close(); });
  SHEETS.push(api);
  requestAnimationFrame(() => scrim.classList.add("in"));
  return api;
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && SHEETS.length) SHEETS[SHEETS.length - 1].close(); });

// "Delete this expense?  Cancel | Delete"
export function confirmDialog(question, { okLabel = "Delete", danger = true, detail = "" } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "dialog-scrim";
    wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><p class="dialog-q"></p>${detail ? `<p class="dialog-d muted"></p>` : ""}<div class="dialog-btns"><button class="btn" data-v="0">Cancel</button><button class="btn ${danger ? "danger-solid" : "primary"}" data-v="1"></button></div></div>`;
    $(".dialog-q", wrap).textContent = question;
    if (detail) $(".dialog-d", wrap).textContent = detail;
    $("[data-v='1']", wrap).textContent = okLabel;
    document.body.appendChild(wrap);
    const done = v => { wrap.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b) done(b.dataset.v === "1"); else if (e.target === wrap) done(false); });
    $("[data-v='0']", wrap).focus();
  });
}

/* ---------- Files ---------- */
const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", jpg: "image/jpeg", json: "application/json" };
export const toFile = (data, name) => new File([data], name, { type: MIME[name.split(".").pop().toLowerCase()] || "application/octet-stream" });

export async function shareFile(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: file.name });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
  }
  downloadFile(file);
  return "downloaded";
}
export function downloadFile(file) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
// iPhones only open the share menu straight after a tap, so a built file gets its own button.
export function showFile(title, file, intro = "") {
  const sh = openSheet(title, { small: true });
  sh.body.innerHTML = `${intro ? `<p>${intro}</p>` : ""}
    <div class="file-card">${ic("sheet", 26)}<div><b></b><span class="muted small">${Math.max(1, Math.round(file.size / 1024))} KB</span></div></div>
    <button class="btn primary xl" data-save>${ic("download", 22)} Download</button>
    <p class="hint">On iPhone, choose “Save to Files”, or send it by Mail or WhatsApp.</p>`;
  $(".file-card b", sh.body).textContent = file.name;
  $("[data-save]", sh.body).onclick = () => shareFile(file);
  return sh;
}

/* ---------- Images ---------- */
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
export async function compressImage(file, maxSide = 2000) {
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await loadImg(url); URL.revokeObjectURL(url);
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) { return file; }
}

/* ---------- Scripts from the CDN (cached by the service worker after first use) ---------- */
const scripts = {};
export function loadScript(src) {
  if (!scripts[src]) scripts[src] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => { delete scripts[src]; rej(Object.assign(new Error("lib"), { code: "offline" })); };
    document.head.appendChild(s);
  });
  return scripts[src];
}
export const EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
export async function getExcelJS() { if (!window.ExcelJS) await loadScript(EXCELJS); return window.ExcelJS; }

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {}
    t.remove(); return ok;
  }
}
export { esc, sleep };
