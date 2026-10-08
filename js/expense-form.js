// Add / edit expense form.

import { S, me, colleague, memberName, rerender } from "./state.js";
import { CATEGORIES, CAT, DETAIL_FIELDS } from "./fields.js";
import { newestFirst } from "./reports.js";
import { esc, aed, num, r2, uid, todayISO, nowTime, validISO, fmtDate } from "./util.js";
import { $, ic, openSheet, toast, confirmDialog, compressImage } from "./ui.js";
import { notifyColleague } from "./push.js";

const DRAFT_KEY = "mitak.draft.v1";
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; } };
const writeDraft = F => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(F)); } catch (e) {} };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} };

const PLACEHOLDER = { fuel: "e.g. ADNOC", toll: "e.g. Dubai Salik", food: "e.g. Lunch", parking: "e.g. Airport parking" };

export const ERRORS = {
  offline: "You’re offline. Connect to the internet and try again.",
  session_expired: "You’ve been signed out. Sign in again and retry.",
  MITAK_PAID_BY_NOT_MEMBER: "“Paid by” must be one of the two members.",
  rate_limited: "Too many requests right now. Wait a minute and try again."
};
export const errText = (e, fallback) => ERRORS[e && e.code] || fallback || "Something went wrong. Try again.";

function recentTrips() {
  const seen = new Set(), out = [];
  for (const e of S.expenses.slice().sort(newestFirst)) {
    const t = (e.trip || "").trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); if (out.length >= 15) break; }
  }
  return out;
}
function rememberedValue(key) {
  const uidMe = S.user.id;
  const prev = S.expenses.filter(e => e.paidBy === uidMe && e.details && e.details[key]).sort(newestFirst)[0];
  if (prev) return prev.details[key];
  const m = me();
  return (m && m.profile && m.profile[key]) || "";
}
function fillRemembered(F) {
  for (const f of DETAIL_FIELDS[F.category] || []) {
    if (f.remember && !F.details[f.key]) { const v = rememberedValue(f.key); if (v) F.details[f.key] = v; }
  }
}

export function openExpense(id, preset = {}) {
  const existing = id ? S.expenses.find(e => e.id === id) : null;
  if (id && !existing) { toast("That expense no longer exists.", "bad"); return; }
  let restored = false;
  let F;
  if (existing) F = structuredClone(existing);
  else {
    const d = readDraft();
    if (d && d.id && !S.expenses.some(e => e.id === d.id) && !preset.date) { F = d; restored = true; }
    else F = { id: uid(), category: preset.category || "", amount: "", date: preset.date || todayISO(), time: nowTime(), paidBy: S.user.id, description: "", location: "", trip: "", details: {}, receipts: [] };
  }
  F.details = F.details || {}; F.receipts = F.receipts || [];
  if (typeof F.amount === "number") F.amount = String(F.amount);
  const added = [];   // new receipt files waiting to be uploaded: { blob, name, type, url }
  const removed = []; // paths of saved receipts the user took off
  let err = "", saving = false;

  const sh = openSheet(existing ? "Edit expense" : "Add expense", { sticky: true });
  sh.el.dataset.testid = "expense-sheet";
  const persist = () => { if (!existing) writeDraft(F); };
  sh.onClose = () => added.forEach(a => URL.revokeObjectURL(a.url));

  function draw() {
    const other = colleague(), my = me();
    const fields = DETAIL_FIELDS[F.category] || [];
    const c = CAT[F.category];
    const detailsOpen = F.category === "fuel" || fields.some(f => F.details[f.key]);
    sh.body.innerHTML = `
      ${restored ? `<div class="note">We kept the expense you hadn’t saved. <button class="link" data-x="discard">Start a new one</button></div>` : ""}
      <div class="field"><span class="lbl">Expense type</span>
        <div class="type-grid" role="group" aria-label="Expense type">${CATEGORIES.map(k => `<button class="type-chip" data-pick="category" data-v="${k.id}" aria-pressed="${F.category === k.id}" style="--c:${k.color}"><span aria-hidden="true">${k.emoji}</span>${k.label}</button>`).join("")}</div>
      </div>
      <div class="field"><label class="lbl" for="e-amount">Amount</label>
        <div class="amount-wrap"><span>AED</span><input id="e-amount" class="amount-in" data-f="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(F.amount)}"></div>
      </div>
      <div class="g2">
        <div class="field"><label class="lbl" for="e-date">Date</label><input id="e-date" data-f="date" type="date" max="${todayISO()}" value="${esc(F.date)}"></div>
        <div class="field"><label class="lbl" for="e-time">Time</label><input id="e-time" data-f="time" type="time" value="${esc(F.time || "")}"></div>
      </div>
      <div class="field"><span class="lbl">Paid by</span>
        <div class="seg two" role="group" aria-label="Paid by">
          <button class="chip" data-pick="paidBy" data-v="${esc(S.user.id)}" aria-pressed="${F.paidBy === S.user.id}">Me${my ? ` <span class="muted-in">(${esc(my.displayName)})</span>` : ""}</button>
          ${other ? `<button class="chip" data-pick="paidBy" data-v="${esc(other.userId)}" aria-pressed="${F.paidBy === other.userId}">${esc(other.displayName)}</button>` : ""}
          ${F.paidBy !== S.user.id && (!other || F.paidBy !== other.userId) ? `<button class="chip" aria-pressed="true" disabled>${esc(memberName(F.paidBy))}</button>` : ""}
        </div>
      </div>
      <div class="field"><label class="lbl" for="e-desc">Description / note <em>optional</em></label><input id="e-desc" data-f="description" maxlength="500" placeholder="${esc(PLACEHOLDER[F.category] || "e.g. ADNOC, Salik, Lunch")}" value="${esc(F.description)}"></div>
      <div class="field" id="e-receipts"></div>
      ${fields.length ? `<details class="more" ${detailsOpen ? "open" : ""}><summary>${esc(c.label)} details <em>optional</em></summary><div class="inner">
        <div class="g2">${fields.map(f => `<div class="field"><label class="lbl" for="d-${f.key}">${f.label}${f.unit ? ` <em>${f.unit}</em>` : ""}</label>
          <input id="d-${f.key}" data-d="${f.key}" ${f.type === "number" ? `type="text" inputmode="decimal"` : `type="text"`} ${f.list ? `list="${f.list}"` : ""} placeholder="${esc(f.placeholder || "")}" value="${esc(F.details[f.key] ?? "")}"></div>`).join("")}</div>
        <p class="hint" id="e-calc"></p>
      </div></details>` : ""}
      <details class="more" ${F.trip || F.location ? "open" : ""}><summary>Trip & location <em>optional</em></summary><div class="inner">
        <div class="field"><label class="lbl" for="e-trip">Trip</label><input id="e-trip" data-f="trip" list="dl-trips" maxlength="120" placeholder="e.g. Abu Dhabi → Dubai" value="${esc(F.trip)}">
          <datalist id="dl-trips">${recentTrips().map(t => `<option value="${esc(t)}"></option>`).join("")}</datalist>
          <span class="hint">Use the same trip name for both of you to see a trip’s total together.</span></div>
        <div class="field"><label class="lbl" for="e-loc">Location</label><input id="e-loc" data-f="location" list="dl-places" maxlength="200" placeholder="e.g. Dubai Marina" value="${esc(F.location)}"></div>
      </div></details>
      ${existing ? `<p class="hint">Added by ${esc(memberName(existing.createdBy))}${existing.createdAt ? " on " + fmtDate(String(existing.createdAt).slice(0, 10)) : ""}${existing.updatedBy && existing.updatedAt && existing.updatedAt !== existing.createdAt ? ` · last changed by ${esc(memberName(existing.updatedBy))} on ${fmtDate(String(existing.updatedAt).slice(0, 10))}` : ""}</p>` : ""}
      <p class="err" id="e-err" role="alert">${esc(err)}</p>`;
    drawReceipts(); drawCalc(); drawFoot();
  }

  function drawReceipts() {
    const box = $("#e-receipts", sh.body); if (!box) return;
    const all = [...F.receipts.map((r, i) => ({ kind: "saved", i, name: r.name, type: r.type, path: r.path })), ...added.map((a, i) => ({ kind: "new", i, name: a.name, type: a.type, url: a.url }))];
    box.innerHTML = `<span class="lbl">Receipt <em>optional</em></span>
      ${all.length ? `<div class="thumbs">${all.map(r => `<div class="thumb">${/^image\//.test(r.type || "") ? `<img alt="Receipt" ${r.url ? `src="${esc(r.url)}"` : `data-path="${esc(r.path)}"`}>` : `<span class="thumb-file">${ic("file", 22)}<small>${esc((r.name || "PDF").slice(0, 14))}</small></span>`}
        ${r.kind === "saved" ? `<button class="thumb-open" data-open="${esc(r.path)}" aria-label="Open receipt"></button>` : ""}
        <button class="thumb-x" data-rm="${r.kind}:${r.i}" aria-label="Remove receipt">${ic("x", 14)}</button></div>`).join("")}</div>` : ""}
      <div class="row-btns">
        <label class="btn">${ic("camera", 18)} Take photo<input class="vh" type="file" accept="image/*" capture="environment" data-file></label>
        <label class="btn">${ic("clip", 18)} Attach file<input class="vh" type="file" accept="image/*,application/pdf" multiple data-file></label>
      </div>`;
    box.querySelectorAll("img[data-path]").forEach(async img => {
      try { img.src = await S.backend.fileUrl(img.dataset.path); } catch (e) { img.alt = "Couldn’t load"; }
    });
  }
  function drawCalc() {
    const el = $("#e-calc", sh.body); if (!el) return;
    const a = num(F.amount), l = num(F.details.litres), p = num(F.details.price_per_litre);
    el.textContent = F.category === "fuel" && a > 0 && l > 0 && !(p > 0) ? `That’s AED ${(a / l).toFixed(2)} per litre.` : "";
  }
  function drawFoot() {
    sh.foot.innerHTML = `${existing ? `<button class="btn danger" data-x="delete">${ic("trash", 18)} Delete</button>` : ""}<span class="grow"></span>
      <button class="btn primary save-btn" data-x="save" ${saving ? "disabled" : ""}>${saving ? `<span class="spin"></span> Saving…` : "Save Expense"}</button>`;
  }

  sh.body.addEventListener("input", ev => {
    const el = ev.target;
    if (el.dataset.f) F[el.dataset.f] = el.value;
    else if (el.dataset.d) F.details[el.dataset.d] = el.value;
    else return;
    drawCalc(); persist();
  });
  sh.body.addEventListener("change", async ev => {
    const el = ev.target;
    if (el.hasAttribute("data-file") && el.files && el.files.length) {
      const files = [...el.files]; el.value = "";
      for (const f of files) {
        if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is larger than 15 MB.`, "bad"); continue; }
        const blob = await compressImage(f);
        const type = blob.type || f.type || "application/octet-stream";
        added.push({ blob, type, name: f.name || "receipt", url: URL.createObjectURL(blob) });
      }
      drawReceipts();
    }
  });
  sh.body.addEventListener("click", async ev => {
    const b = ev.target.closest("button"); if (!b || !sh.body.contains(b)) return;
    if (b.dataset.pick) {
      ev.preventDefault();
      F[b.dataset.pick] = b.dataset.v;
      err = "";
      if (b.dataset.pick === "category") fillRemembered(F);
      persist(); draw();
      if (b.dataset.pick === "category" && !num(F.amount)) $("#e-amount", sh.body).focus();
      return;
    }
    if (b.dataset.rm) {
      const [kind, i] = b.dataset.rm.split(":");
      if (kind === "new") { URL.revokeObjectURL(added[+i].url); added.splice(+i, 1); }
      else { removed.push(F.receipts[+i].path); F.receipts.splice(+i, 1); }
      drawReceipts(); return;
    }
    if (b.dataset.open) {
      const w = window.open("", "_blank");
      try { const u = await S.backend.fileUrl(b.dataset.open); if (w) w.location = u; else location.href = u; } catch (e) { if (w) w.close(); toast("Couldn’t open the receipt.", "bad"); }
      return;
    }
    if (b.dataset.x === "discard") { clearDraft(); F = { id: uid(), category: "", amount: "", date: todayISO(), time: nowTime(), paidBy: S.user.id, description: "", location: "", trip: "", details: {}, receipts: [] }; restored = false; draw(); }
  });
  sh.foot.addEventListener("click", async ev => {
    const b = ev.target.closest("button[data-x]"); if (!b) return;
    if (b.dataset.x === "save") await save();
    if (b.dataset.x === "delete") await del();
  });
  sh.body.addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target.tagName === "INPUT") { ev.preventDefault(); save(); } });

  function validate() {
    const a = num(F.amount);
    if (!F.category) return "Choose the expense type: Fuel, Toll, Food or Parking.";
    if (a == null) return "Enter the amount in AED.";
    if (isNaN(a)) return "The amount must be a number, like 125 or 125.50.";
    if (a <= 0) return "The amount must be more than zero.";
    if (a >= 1000000) return "That amount looks too high. Check the figure.";
    if (!validISO(F.date)) return "Enter a valid date.";
    if (F.date > todayISO()) return "The date can’t be in the future.";
    for (const f of DETAIL_FIELDS[F.category] || []) {
      if (f.type !== "number") continue;
      const v = num(F.details[f.key]);
      if (v != null && (isNaN(v) || v < 0)) return `${f.label} must be a number.`;
    }
    return "";
  }
  function cleanDetails() {
    const out = {};
    for (const f of DETAIL_FIELDS[F.category] || []) {
      const raw = F.details[f.key];
      if (raw === "" || raw == null) continue;
      if (f.type === "number") { const v = num(raw); if (v != null && !isNaN(v)) out[f.key] = f.step === "1" ? Math.round(v) : r2(v); }
      else { const s = String(raw).trim(); if (s) out[f.key] = s; }
    }
    return out;
  }

  async function save() {
    if (saving) return;
    err = validate();
    const errEl = $("#e-err", sh.body);
    if (err) { errEl.textContent = err; errEl.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (!navigator.onLine && S.backend.kind !== "demo") { errEl.textContent = ERRORS.offline; return; }
    saving = true; errEl.textContent = ""; drawFoot();
    const uploaded = [];
    try {
      for (const a of added) {
        const ext = a.type === "application/pdf" ? "pdf" : a.type === "image/png" ? "png" : a.type === "image/webp" ? "webp" : "jpg";
        const path = `receipts/${F.id}/${uid()}.${ext}`;
        await S.backend.uploadFile(path, a.blob, a.type);
        uploaded.push({ path, name: a.name, type: a.type, size: a.blob.size });
      }
      const obj = {
        id: F.id, category: F.category, amount: r2(num(F.amount)), date: F.date, time: F.time || "", paidBy: F.paidBy || S.user.id,
        description: String(F.description || "").trim(), location: String(F.location || "").trim(), trip: String(F.trip || "").trim(),
        details: cleanDetails(), receipts: [...F.receipts, ...uploaded]
      };
      const saved = await S.backend.saveExpense(obj);
      if (removed.length) S.backend.deleteFiles(removed).catch(() => {});
      const i = S.expenses.findIndex(e => e.id === saved.id);
      if (i >= 0) S.expenses[i] = saved; else S.expenses.push(saved);
      if (!existing) { clearDraft(); notifyColleague(saved.id); }
      sh.close();
      toast(existing ? "Expense updated." : "Expense added successfully.", "ok");
      rerender();
    } catch (e) {
      if (uploaded.length) S.backend.deleteFiles(uploaded.map(u => u.path)).catch(() => {});
      saving = false; drawFoot();
      const el = $("#e-err", sh.body); if (el) el.textContent = errText(e, "Couldn’t save. Check your connection and tap Save again; your entry is kept.");
    }
  }

  async function del() {
    const ok = await confirmDialog("Delete this expense?", { detail: `${CAT[existing.category].label} · ${aed(existing.amount)} · ${fmtDate(existing.date)}` });
    if (!ok) return;
    try {
      await S.backend.deleteExpense(existing);
      S.expenses = S.expenses.filter(e => e.id !== existing.id);
      sh.close();
      toast("Expense deleted.", "ok");
      rerender();
    } catch (e) { toast(errText(e, "Couldn’t delete. Try again."), "bad"); }
  }

  draw();
  if (!existing && !F.category) setTimeout(() => { const b = sh.body.querySelector(".type-chip"); if (b) b.focus({ preventScroll: true }); }, 50);
}
