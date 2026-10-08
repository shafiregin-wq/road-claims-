// Who owes who: shared expenses and payments between the two colleagues.

import { S, colleague, memberName, rerender } from "./state.js";
import { CAT } from "./fields.js";
import { balance } from "./reports.js";
import { esc, aed, num, r2, uid, todayISO, validISO, fmtDate, fmtDayMonth } from "./util.js";
import { $, openSheet, toast, confirmDialog } from "./ui.js";
import { errText, openExpense } from "./expense-form.js";

export function openBalance() {
  const other = colleague(); if (!other) return;
  const sh = openSheet("Who owes who");
  sh.el.dataset.testid = "balance-sheet";
  function draw() {
    const b = balance(S.expenses, S.settlements, S.user.id, other.userId), name = esc(other.displayName);
    const head = b.net > 0 ? `<b>${name} owes you ${aed(b.net)}</b>` : b.net < 0 ? `<b>You owe ${name} ${aed(-b.net)}</b>` : "<b>You’re all settled up.</b>";
    const pays = S.settlements.slice().sort((x, y) => (y.date || "").localeCompare(x.date || "") || String(y.createdAt).localeCompare(String(x.createdAt)));
    sh.body.innerHTML = `
      <div class="card stack">
        <p class="big-line">${head}</p>
        <dl class="kv">
          <dt>${name}’s share of what you paid</dt><dd class="plus">+ ${aed(b.owedToMe)}</dd>
          <dt>Your share of what ${name} paid</dt><dd class="minus">− ${aed(b.iOwe)}</dd>
          ${b.paidToMe ? `<dt>${name} has paid you</dt><dd class="minus">− ${aed(b.paidToMe)}</dd>` : ""}
          ${b.paidByMe ? `<dt>You have paid ${name}</dt><dd class="plus">+ ${aed(b.paidByMe)}</dd>` : ""}
        </dl>
        <button class="btn primary" data-x="pay">Record a payment</button>
      </div>
      <section class="stack">
        <h3>Payments</h3>
        ${pays.length ? `<div class="ledger">${pays.map(p => `<div class="ledger-row" data-testid="payment">
          <span>${p.fromUser === S.user.id ? `You paid ${name}` : `${name} paid you`}${p.note ? ` · ${esc(p.note)}` : ""}</span><span class="money">${aed(p.amount)}</span>
          <span class="muted small">${fmtDate(p.date)}${p.createdBy === S.user.id ? ` · <button class="link" data-del="${esc(p.id)}">Delete</button>` : ` · added by ${esc(memberName(p.createdBy))}`}</span>
        </div>`).join("")}</div>` : `<p class="muted small">No payments yet.</p>`}
      </section>
      <section class="stack">
        <h3>Shared expenses</h3>
        ${b.shared.length ? `<div class="ledger">${b.shared.map(e => { const c = CAT[e.category] || { emoji: "", label: e.category }; const mine = e.paidBy === S.user.id; return `<button class="ledger-row" data-open="${esc(e.id)}">
          <span>${c.emoji} ${esc(c.label)}${e.description ? ` · ${esc(e.description)}` : ""}</span><span class="money ${mine ? "plus" : "minus"}">${mine ? "+" : "−"} ${aed(e.otherShare)}</span>
          <span class="muted small">${fmtDayMonth(e.date)} · ${mine ? `you paid ${aed(e.amount)}, ${name}’s share` : `${name} paid ${aed(e.amount)}, your share`}</span>
        </button>`; }).join("")}</div>` : `<p class="muted small">Nothing shared yet. When you add an expense, choose “Half each” or “Custom” under “Shared with ${name}?”.</p>`}
      </section>`;
  }
  sh.body.addEventListener("click", async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.x === "pay") openPayment();
    if (b.dataset.open) openExpense(b.dataset.open);
    if (b.dataset.del) {
      if (!await confirmDialog("Delete this payment?")) return;
      try {
        await S.backend.deleteSettlement(b.dataset.del);
        S.settlements = S.settlements.filter(p => p.id !== b.dataset.del);
        toast("Payment deleted.", "ok"); rerender();
      } catch (e) { toast(errText(e, "Couldn’t delete the payment."), "bad"); }
    }
  });
  sh.refresh = draw;
  draw();
}

export function openPayment() {
  const other = colleague(); if (!other) return;
  const b = balance(S.expenses, S.settlements, S.user.id, other.userId), name = esc(other.displayName);
  const P = { id: uid(), dir: b.net < 0 ? "me-to-them" : "them-to-me", amount: b.net ? String(Math.abs(b.net)) : "", date: todayISO(), note: "" };
  const sh = openSheet("Record a payment", { small: true });
  sh.el.dataset.testid = "payment-sheet";
  let saving = false;
  function draw() {
    sh.body.innerHTML = `
      <div class="seg two" role="group" aria-label="Who paid">
        <button class="chip" data-dir="them-to-me" aria-pressed="${P.dir === "them-to-me"}">${name} paid me</button>
        <button class="chip" data-dir="me-to-them" aria-pressed="${P.dir === "me-to-them"}">I paid ${name}</button>
      </div>
      <div class="field"><label class="lbl" for="p-amount">Amount</label><div class="amount-wrap"><span>AED</span><input id="p-amount" class="amount-in" type="text" inputmode="decimal" value="${esc(P.amount)}" placeholder="0.00"></div></div>
      <div class="g2">
        <div class="field"><label class="lbl" for="p-date">Date</label><input id="p-date" type="date" max="${todayISO()}" value="${esc(P.date)}"></div>
        <div class="field"><label class="lbl" for="p-note">Note <em>optional</em></label><input id="p-note" maxlength="200" placeholder="e.g. Cash, bank transfer" value="${esc(P.note)}"></div>
      </div>
      <p class="hint">${b.net > 0 ? `${name} owes you ${aed(b.net)} right now.` : b.net < 0 ? `You owe ${name} ${aed(-b.net)} right now.` : "You’re settled up right now."}</p>
      <p class="err" role="alert"></p>`;
    sh.foot.innerHTML = `<span class="grow"></span><button class="btn primary save-btn" data-x="save" ${saving ? "disabled" : ""}>${saving ? `<span class="spin"></span> Saving…` : "Save payment"}</button>`;
  }
  sh.body.addEventListener("input", ev => {
    if (ev.target.id === "p-amount") P.amount = ev.target.value;
    if (ev.target.id === "p-date") P.date = ev.target.value;
    if (ev.target.id === "p-note") P.note = ev.target.value;
  });
  sh.body.addEventListener("click", ev => { const d = ev.target.closest("[data-dir]"); if (d) { P.dir = d.dataset.dir; draw(); } });
  sh.foot.addEventListener("click", async ev => {
    if (!ev.target.closest("[data-x=save]") || saving) return;
    const a = num(P.amount), errEl = $(".err", sh.body);
    const err = a == null || isNaN(a) || a <= 0 ? "Enter the amount paid." : !validISO(P.date) || P.date > todayISO() ? "Enter a valid date (not in the future)." : "";
    if (err) { errEl.textContent = err; return; }
    saving = true; draw();
    try {
      const saved = await S.backend.saveSettlement({
        id: P.id, amount: r2(a), date: P.date, note: P.note.trim(),
        fromUser: P.dir === "me-to-them" ? S.user.id : other.userId, toUser: P.dir === "me-to-them" ? other.userId : S.user.id
      });
      S.settlements.push(saved);
      sh.close(); toast("Payment recorded.", "ok"); rerender();
    } catch (e) {
      saving = false; draw();
      $(".err", sh.body).textContent = errText(e, "Couldn’t save the payment. Try again.");
    }
  });
  draw();
  setTimeout(() => { const i = $("#p-amount", sh.body); if (i) i.focus(); }, 50);
}
