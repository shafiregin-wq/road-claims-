// The main screens: Dashboard, Calendar, Expenses, Monthly Summary, Reports, Settings.

import { S, me, colleague, whoLabel, rerender } from "./state.js";
import { CATEGORIES, CAT, PROFILE_FIELDS, BUILTIN_TEMPLATES } from "./fields.js";
import { totals, inMonth, onDay, byDay, byTrip, newestFirst, oldestFirst, reportExpenses, balance } from "./reports.js";
import { esc, aed, compact, todayISO, monthOf, monthLabel, monthShort, shiftMonth, daysInMonth, parseISO, pad, fmtDayMonth, fmtLongDay, fmtTime, formatInvite, MONTHS } from "./util.js";
import { ic } from "./ui.js";
import { bannerDismissed } from "./push.js";

const pct = (v, total) => total > 0 ? Math.max(2, Math.round(v / total * 100)) : 0;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ---------- Pieces ---------- */

export function expenseRow(e, opts = {}) {
  const c = CAT[e.category] || { emoji: "•", label: e.category, color: "#999" };
  const other = colleague();
  const share = +e.otherShare > 0 ? (e.paidBy === S.user.id ? `${other ? other.displayName : "Colleague"} owes ${aed(e.otherShare)}` : `you owe ${aed(e.otherShare)}`) : "";
  const sub = [whoLabel(e.paidBy), opts.noDate ? "" : fmtDayMonth(e.date), fmtTime(e.time), share, e.trip ? "🧭 " + e.trip : ""].filter(Boolean).join(" · ");
  return `<button class="xrow" data-act="edit-expense" data-id="${esc(e.id)}">
    <span class="xemoji" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>
    <span class="xmain"><span class="xtitle">${esc(c.label)}${e.description ? ` <span class="muted">· ${esc(e.description)}</span>` : ""}</span><span class="xsub">${esc(sub)}</span></span>
    <span class="xamt"><span class="money">${aed(e.amount)}</span>${(e.receipts || []).length ? `<span class="xclip" title="Receipt attached">${ic("clip", 13)}</span>` : ""}</span>
  </button>`;
}
const list = (items, opts) => `<div class="xlist">${items.map(e => expenseRow(e, opts)).join("")}</div>`;

function peopleRows(byUser, total, { totalLabel = "Total", strong = false } = {}) {
  const my = me(), other = colleague();
  return `<dl class="split${strong ? " strong" : ""}">
    <div><dt>My spending</dt><dd class="money">${aed(byUser[my && my.userId] || 0)}</dd></div>
    <div><dt>${other ? esc(other.displayName) + "’s spending" : "Colleague’s spending"}</dt><dd class="money">${other ? aed(byUser[other.userId] || 0) : `<span class="muted small">not joined yet</span>`}</dd></div>
    <div class="sum"><dt>${totalLabel}</dt><dd class="money">${aed(total)}</dd></div>
  </dl>`;
}

function monthNav(month, act) {
  const cur = monthOf(todayISO());
  return `<div class="month-nav">
    <button class="icon-btn" data-act="${act}" data-d="-1" aria-label="Previous month">${ic("chevL", 18)}</button>
    <span class="month-label">${monthLabel(month)}</span>
    <button class="icon-btn" data-act="${act}" data-d="1" aria-label="Next month">${ic("chevR", 18)}</button>
    ${month !== cur ? `<button class="chip small" data-act="${act}" data-d="0">This month</button>` : ""}
  </div>`;
}

function inviteBanner() {
  const ws = S.workspace;
  if (!ws || colleague()) return "";
  if (!ws.inviteCode) return `<div class="note">Your colleague hasn’t joined yet.</div>`;
  return `<div class="note invite">
    <div><b>Invite your colleague</b><span class="muted small">They create an account in MITAK and enter this code. It works once.</span></div>
    <div class="code-big" data-testid="invite-code">${esc(formatInvite(ws.inviteCode))}</div>
    <div class="row-btns"><button class="btn primary" data-act="share-invite">${ic("share", 18)} Share invite</button><button class="btn" data-act="copy-invite">${ic("copy", 18)} Copy code</button></div>
  </div>`;
}

export function balanceCard() {
  const other = colleague(); if (!other) return "";
  const b = balance(S.expenses, S.settlements, S.user.id, other.userId), name = esc(other.displayName);
  const line = b.net > 0 ? `<span class="owe-amt pos money">${aed(b.net)}</span><span>${name} owes you</span>`
    : b.net < 0 ? `<span class="owe-amt neg money">${aed(-b.net)}</span><span>You owe ${name}</span>`
    : `<span class="owe-amt money">AED 0.00</span><span>All settled up</span>`;
  return `<section class="card owe-card" data-testid="balance-card">
    <div class="card-head"><h2>Who owes who</h2><button class="link" data-act="open-balance">Details</button></div>
    <div class="owe-line">${line}</div>
    <div class="row-btns"><button class="btn small" data-act="record-payment">Record a payment</button></div>
  </section>`;
}

function pushBanner() {
  const other = colleague();
  if (!other || !S.push || S.push.state !== "off" || bannerDismissed() || !("Notification" in window) || Notification.permission !== "default") return "";
  return `<div class="note push-note" data-testid="push-banner"><span>🔔 Get a notification when ${esc(other.displayName)} adds an expense.</span>
    <span class="row-btns"><button class="btn primary small" data-act="push-on">Turn on</button><button class="btn small" data-act="push-dismiss">Not now</button></span></div>`;
}

function notificationsCard() {
  const other = colleague(), who = other ? esc(other.displayName) : "your colleague";
  const st = (S.push && S.push.state) || "checking";
  const body = {
    checking: `<p class="muted small">Checking…</p>`,
    demo: `<p class="small">Notifications work in the real app, not in the demo.</p>`,
    "ios-browser": `<p class="small">On iPhone, notifications need MITAK on your Home Screen: in Safari tap <b>Share</b> › <b>Add to Home Screen</b>, open MITAK from there, and turn them on here.</p>`,
    unsupported: `<p class="small">This browser can’t show notifications. Try Chrome or Safari, or add MITAK to your Home Screen.</p>`,
    denied: `<p class="small">Notifications are blocked for MITAK. Allow them in your phone’s settings (on iPhone: Settings › Notifications › MITAK), then come back here.</p>`,
    off: `<p class="small">Get a notification on this phone when ${who} adds an expense.</p><button class="btn primary" data-act="push-on">🔔 Turn on notifications</button>`,
    on: `<p class="small">${ic("check", 16)} On for this phone. You’ll be notified when ${who} adds an expense.</p>
      <div class="row-btns"><button class="btn" data-act="push-test">Send a test</button><button class="btn" data-act="push-off">Turn off</button></div>`
  }[st] || "";
  return `<section class="card stack" id="notifications" data-testid="notifications" data-state="${st}"><h2>Notifications</h2>${body}</section>`;
}

/* ---------- Dashboard ---------- */

export function viewHome() {
  const today = todayISO(), month = monthOf(today);
  const tT = totals(onDay(S.expenses, today));
  const monthList = inMonth(S.expenses, month);
  const mT = totals(monthList);
  const my = me();
  const recent = S.expenses.slice().sort(newestFirst).slice(0, 5);
  return `
  <section class="hello">
    <h1>Hi ${esc(my ? my.displayName : "")}</h1>
    <p class="muted">${fmtLongDay(today)}</p>
  </section>
  <button class="btn primary xl add-main" data-act="add-expense">${ic("plus", 24)} Add Expense</button>
  ${inviteBanner()}
  ${pushBanner()}
  <section class="card">
    <div class="card-head"><h2>Today</h2><span class="muted small">${plural(tT.count, "expense")}</span></div>
    ${peopleRows(tT.byUser, tT.total)}
  </section>
  ${balanceCard()}
  <section class="card">
    <div class="card-head"><h2>${monthLabel(month)}</h2><button class="link" data-act="go" data-to="summary">Summary</button></div>
    ${peopleRows(mT.byUser, mT.total, { totalLabel: "Combined total", strong: true })}
  </section>
  <section>
    <div class="sec-head"><h2>This month by type</h2></div>
    <div class="cat-grid">
      ${CATEGORIES.map(c => `<button class="cat-card" data-act="filter-cat" data-cat="${c.id}" data-month="${month}" style="--c:${c.color}">
        <span class="cat-emoji" aria-hidden="true">${c.emoji}</span>
        <span class="cat-label">${c.label}</span>
        <span class="cat-amt money">${aed(mT.byCat[c.id])}</span>
        <span class="muted small">${plural(mT.catCount[c.id], "expense")}</span>
      </button>`).join("")}
    </div>
  </section>
  <section>
    <div class="sec-head"><h2>Recent</h2>${S.expenses.length > 5 ? `<button class="link" data-act="go" data-to="expenses">See all</button>` : ""}</div>
    ${recent.length ? list(recent) : `<div class="empty">No expenses yet. Tap <b>Add Expense</b> to record the first one.</div>`}
  </section>`;
}

/* ---------- Calendar ---------- */

export function viewCalendar() {
  const month = S.calMonth;
  const days = byDay(S.expenses, month);
  const mT = totals(inMonth(S.expenses, month));
  const first = parseISO(month + "-01");
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const n = daysInMonth(month), today = todayISO();
  if (monthOf(S.calDay) !== month) S.calDay = month === monthOf(today) ? today : month + "-01";
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(`<span class="cal-cell blank" aria-hidden="true"></span>`);
  for (let d = 1; d <= n; d++) {
    const iso = `${month}-${pad(d)}`, info = days[iso];
    cells.push(`<button class="cal-cell${info ? " has" : ""}${iso === today ? " today" : ""}${iso === S.calDay ? " sel" : ""}" data-act="cal-day" data-d="${iso}" aria-label="${fmtLongDay(iso)}: ${info ? aed(info.total) : "nothing spent"}" aria-pressed="${iso === S.calDay}">
      <span class="cal-n">${d}</span><span class="cal-amt">${info ? compact(info.total) : ""}</span></button>`);
  }
  const sel = S.calDay, dayList = onDay(S.expenses, sel).sort(oldestFirst), dT = totals(dayList);
  const my = me(), other = colleague();
  const d0 = parseISO(sel);
  return `
  <div class="view-head"><h1>Calendar</h1></div>
  ${monthNav(month, "cal-month")}
  <section class="card tight">${peopleRows(mT.byUser, mT.total, { totalLabel: "Month total" })}</section>
  <section class="cal" aria-label="${monthLabel(month)}">
    <div class="cal-wd">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => `<span>${w}</span>`).join("")}</div>
    <div class="cal-grid">${cells.join("")}</div>
    <p class="hint">Amounts in AED. Days with expenses are highlighted.</p>
  </section>
  <section class="card day-panel" data-testid="day-panel">
    <div class="card-head"><h2>${MONTHS[d0.getMonth()]} ${d0.getDate()}</h2><span class="money total-pill">Total: ${aed(dT.total)}</span></div>
    <dl class="split compact">
      <div><dt>${esc(my ? my.displayName : "Me")}</dt><dd class="money">${aed(dT.byUser[my && my.userId] || 0)}</dd></div>
      ${other ? `<div><dt>${esc(other.displayName)}</dt><dd class="money">${aed(dT.byUser[other.userId] || 0)}</dd></div>` : ""}
    </dl>
    ${dayList.length ? list(dayList, { noDate: true }) : `<p class="muted">Nothing spent on this day.</p>`}
    <button class="btn" data-act="add-expense" data-date="${sel}">${ic("plus", 18)} Add expense on ${fmtDayMonth(sel)}</button>
  </section>`;
}

/* ---------- Expense history ---------- */

function filteredExpenses() {
  const f = S.xf;
  return S.expenses.filter(e => {
    if (f.date) { if (e.date !== f.date) return false; }
    else if (f.month && monthOf(e.date) !== f.month) return false;
    if (f.user && e.paidBy !== f.user) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.trip && (e.trip || "").trim() !== f.trip) return false;
    return true;
  }).sort(f.sort === "oldest" ? oldestFirst : newestFirst);
}

export function viewExpenses() {
  const f = S.xf, items = filteredExpenses(), t = totals(items);
  const months = [...new Set([monthOf(todayISO()), ...S.expenses.map(e => monthOf(e.date))])].filter(Boolean).sort().reverse();
  if (f.month && !months.includes(f.month)) months.push(f.month);
  const my = me(), other = colleague();
  const chip = (act, v, cur, label) => `<button class="chip" data-act="${act}" data-v="${esc(v)}" aria-pressed="${v === cur}">${label}</button>`;
  return `
  <div class="view-head"><h1>Expenses</h1></div>
  <section class="card filters">
    <div class="frow">
      <label>Month<select id="xf-month"><option value="">All months</option>${months.map(m => `<option value="${m}" ${m === f.month ? "selected" : ""}>${monthShort(m)}</option>`).join("")}</select></label>
      <label>Date<input id="xf-date" type="date" value="${esc(f.date)}"></label>
    </div>
    <div class="seg" role="group" aria-label="Paid by">
      ${chip("xf-user", "", f.user, "Everyone")}${my ? chip("xf-user", my.userId, f.user, "Me") : ""}${other ? chip("xf-user", other.userId, f.user, esc(other.displayName)) : ""}
    </div>
    <div class="seg" role="group" aria-label="Expense type">
      ${chip("xf-cat", "", f.category, "All types")}${CATEGORIES.map(c => chip("xf-cat", c.id, f.category, `${c.emoji} ${c.label}`)).join("")}
    </div>
    <div class="frow">
      <label>Sort<select id="xf-sort"><option value="newest" ${f.sort !== "oldest" ? "selected" : ""}>Newest first</option><option value="oldest" ${f.sort === "oldest" ? "selected" : ""}>Oldest first</option></select></label>
      ${f.trip ? `<div class="trip-filter"><span class="muted small">Trip</span><button class="chip" data-act="xf-trip-clear" aria-pressed="true">🧭 ${esc(f.trip)} ${ic("x", 14)}</button></div>` : "<span></span>"}
    </div>
  </section>
  <div class="list-head"><span>${plural(t.count, "expense")}${f.date ? " on " + fmtDayMonth(f.date) : f.month ? " in " + monthShort(f.month) : ""}</span><span class="money">${aed(t.total)}</span></div>
  ${items.length ? list(items) : `<div class="empty">No expenses match these filters.</div>`}`;
}

/* ---------- Monthly summary ---------- */

export function viewSummary() {
  const month = S.sumMonth, items = inMonth(S.expenses, month), t = totals(items);
  const people = S.members.slice().sort((a, b) => (a.userId === S.user.id ? -1 : b.userId === S.user.id ? 1 : 0));
  const trips = byTrip(items);
  const maxCat = Math.max(0, ...CATEGORIES.map(c => t.byCat[c.id]));
  return `
  <div class="view-head"><h1>Monthly Summary</h1></div>
  ${monthNav(month, "sum-month")}
  <section class="card total-card">
    <span class="eyebrow">Total</span>
    <span class="big money" data-testid="summary-total">${aed(t.total)}</span>
    <span class="muted">${plural(t.count, "expense")} this month</span>
  </section>
  <section class="card">
    <div class="card-head"><h2>By person</h2></div>
    <div class="bars">${people.map(m => `<div class="bar-row">
      <div class="bar-top"><span>${esc(m.displayName)}${m.userId === S.user.id ? ` <span class="muted small">(me)</span>` : ""}</span><span class="money">${aed(t.byUser[m.userId] || 0)}</span></div>
      <div class="bar"><i style="width:${pct(t.byUser[m.userId] || 0, t.total)}%"></i></div></div>`).join("")}</div>
  </section>
  <section class="card">
    <div class="card-head"><h2>By type</h2></div>
    <div class="bars">${CATEGORIES.map(c => `<button class="bar-row as-btn" data-act="filter-cat" data-cat="${c.id}" data-month="${month}">
      <div class="bar-top"><span>${c.emoji} ${c.label} <span class="muted small">${plural(t.catCount[c.id], "expense")}</span></span><span class="money">${aed(t.byCat[c.id])}</span></div>
      <div class="bar"><i style="width:${maxCat ? Math.round(t.byCat[c.id] / maxCat * 100) : 0}%;background:${c.color}"></i></div></button>`).join("")}</div>
  </section>
  ${trips.length ? `<section class="card">
    <div class="card-head"><h2>Trips</h2><span class="muted small">${plural(trips.length, "trip")}</span></div>
    <div class="trips">${trips.map(tr => {
      const who = Object.keys(tr.byUser);
      const tag = who.length > 1 ? `<span class="tag together">Together</span>` : `<span class="tag">${esc(whoLabel(who[0]))} alone</span>`;
      return `<button class="trip-row" data-act="filter-trip" data-trip="${esc(tr.name)}" data-month="${month}">
        <span class="trip-name">🧭 ${esc(tr.name)} ${tag}</span>
        <span class="money">${aed(tr.total)}</span>
        <span class="muted small trip-sub">${tr.first === tr.last ? fmtDayMonth(tr.first) : fmtDayMonth(tr.first) + " – " + fmtDayMonth(tr.last)} · ${who.map(u => `${esc(whoLabel(u))} ${aed(tr.byUser[u])}`).join(" · ")}</span>
      </button>`;
    }).join("")}</div>
  </section>` : ""}`;
}

/* ---------- Reports ---------- */

export function viewReports() {
  const month = S.repMonth, my = me(), other = colleague();
  if (S.repWho == null) S.repWho = S.user.id;
  const who = S.repWho;
  const chip = (v, label) => `<button class="chip" data-act="rep-who" data-v="${esc(v)}" aria-pressed="${v === who}">${label}</button>`;
  const cats = CATEGORIES.filter(c => c.report || S.templates[c.id]);
  return `
  <div class="view-head"><h1>Reports</h1></div>
  ${monthNav(month, "rep-month")}
  <section class="card tight">
    <span class="lbl">Whose expenses</span>
    <div class="seg" role="group" aria-label="Whose expenses">${my ? chip(my.userId, "Only mine") : ""}${other ? chip(other.userId, "Only " + esc(other.displayName) + "’s") : ""}${chip("", "Both of us")}</div>
  </section>
  ${cats.map(c => {
    const items = reportExpenses(S.expenses, { category: c.id, month, paidBy: who });
    const total = items.reduce((s, e) => s + (+e.amount || 0), 0);
    const tpl = S.templates[c.id];
    return `<section class="card report-card" data-testid="report-${c.id}">
      <div class="card-head"><h2>${c.emoji} ${c.label}</h2><span class="muted small">${plural(items.length, "expense")}</span></div>
      <p class="report-total">Total: <span class="money">${aed(total)}</span></p>
      <p class="small ${tpl && tpl.filePath || BUILTIN_TEMPLATES[c.id] ? "" : "muted"}">${tpl && tpl.filePath ? `${ic("sheet", 15)} Form: ${esc(tpl.fileName)}` : BUILTIN_TEMPLATES[c.id] ? `${ic("sheet", 15)} Form: ${esc(BUILTIN_TEMPLATES[c.id].fileName.replace(/\.xlsx$/, ""))}` : `No ${c.label.toLowerCase()} template yet: MITAK makes a simple Excel layout. <button class="link" data-act="go" data-to="settings" data-anchor="templates">Upload template</button>`}</p>
      <button class="btn primary" data-act="generate" data-cat="${c.id}" ${items.length ? "" : "disabled"}>${ic("sheet", 18)} Generate Excel</button>
    </section>`;
  }).join("")}
  <p class="hint">Food has no reimbursement file unless a food template is uploaded in Settings.</p>`;
}

/* ---------- Settings ---------- */

export function viewSettings() {
  const my = me() || { displayName: "", profile: {} };
  const p = my.profile || {};
  const demo = S.backend && S.backend.kind === "demo";
  return `
  <div class="view-head"><h1>Settings</h1></div>
  ${demo ? `<section class="card demo-card">
    <h2>Demo mode</h2>
    <p class="small">You’re trying MITAK on this device only. Nothing is shared or sent anywhere. Open a second tab to act as the other person.</p>
    <div class="row-btns"><button class="btn" data-act="demo-switch">${ic("users", 18)} Switch to the other person</button><button class="btn" data-act="demo-reset">Start the demo again</button><button class="btn" data-act="leave-demo">Leave demo</button></div>
  </section>` : ""}
  <section class="card stack">
    <h2>Your details</h2>
    <p class="hint">Your name is what your colleague sees. The other details can be printed on reimbursement files.</p>
    <div class="field"><label class="lbl" for="pf-name">Your name</label><input id="pf-name" value="${esc(my.displayName)}" maxlength="40" autocomplete="name"></div>
    <div class="g2">${PROFILE_FIELDS.map(f => `<div class="field"><label class="lbl" for="pf-${f.key}">${f.label}</label><input id="pf-${f.key}" data-pf="${f.key}" value="${esc(p[f.key] || "")}" placeholder="${esc(f.placeholder || "")}"></div>`).join("")}</div>
    <button class="btn primary" data-act="save-profile">Save details</button>
  </section>
  <section class="card stack">
    <h2>Workspace</h2>
    <ul class="members">${S.members.map(m => `<li>${ic("users", 18)}<span>${esc(m.displayName)}${m.userId === S.user.id ? " (you)" : ""}</span><span class="muted small">${m.role === "owner" ? "created MITAK" : "joined"}</span></li>`).join("")}</ul>
    ${colleague() ? `<p class="hint">${ic("lock", 14)} This workspace is closed: only the two of you can see its expenses and files.</p>` : inviteBanner()}
    ${!colleague() && my.role === "owner" && !demo ? `<button class="link" data-act="new-invite">Make a new invite code</button>` : ""}
  </section>
  ${notificationsCard()}
  <section class="card stack" id="templates">
    <h2>Reimbursement templates</h2>
    <p class="hint">Upload your company’s Excel form for each type. MITAK fills it in each month and keeps its layout, formulas and formatting.</p>
    <div class="tpl-list">${CATEGORIES.map(c => {
      const t = S.templates[c.id];
      const cols = t && t.mapping && t.mapping.columns ? Object.keys(t.mapping.columns).length : 0;
      return `<div class="tpl-row" data-testid="tpl-${c.id}">
        <span class="xemoji" style="--c:${c.color}">${c.emoji}</span>
        <div class="tpl-main"><b>${c.label}</b><span class="muted small">${t && t.filePath ? `${esc(t.fileName)} · ${plural(cols, "column")} mapped` : BUILTIN_TEMPLATES[c.id] ? "Company claim form (built in)" : "No template"}</span></div>
        <div class="tpl-btns">${t && t.filePath ? `<button class="btn small" data-act="tpl-edit" data-cat="${c.id}">Mapping</button><button class="icon-btn" data-act="tpl-menu" data-cat="${c.id}" aria-label="More for ${c.label} template">${ic("chevD", 16)}</button>`
          : BUILTIN_TEMPLATES[c.id] ? `<button class="btn small" data-act="tpl-builtin" data-cat="${c.id}">${ic("download", 16)} Form</button><button class="btn small" data-act="tpl-upload" data-cat="${c.id}">${ic("upload", 16)} Replace</button>`
          : `<button class="btn small" data-act="tpl-upload" data-cat="${c.id}">${ic("upload", 16)} Upload</button>`}</div>
      </div>`;
    }).join("")}</div>
  </section>
  <section class="card stack">
    <h2>Account</h2>
    <p class="small">${demo ? "Demo account on this device" : `Signed in as <b>${esc(S.user.email)}</b>`}</p>
    <div class="row-btns">${demo ? "" : `<button class="btn" data-act="change-password">${ic("lock", 18)} Change password</button>`}<button class="btn" data-act="sign-out">${ic("logout", 18)} Sign out</button></div>
  </section>
  <p class="hint center">MITAK · private expense tracking for two</p>`;
}

export const VIEWS = { home: viewHome, calendar: viewCalendar, expenses: viewExpenses, summary: viewSummary, reports: viewReports, settings: viewSettings };
export const TABS = [["home", "home", "Home"], ["calendar", "calendar", "Calendar"], ["expenses", "list", "Expenses"], ["summary", "chart", "Summary"], ["reports", "sheet", "Reports"]];

/* ---------- Screen actions ---------- */

export const VIEW_ACTIONS = {
  "cal-month": b => { const d = +b.dataset.d; S.calMonth = d ? shiftMonth(S.calMonth, d) : monthOf(todayISO()); rerender(); },
  "cal-day": b => { S.calDay = b.dataset.d; rerender(); },
  "sum-month": b => { const d = +b.dataset.d; S.sumMonth = d ? shiftMonth(S.sumMonth, d) : monthOf(todayISO()); rerender(); },
  "rep-month": b => { const d = +b.dataset.d; S.repMonth = d ? shiftMonth(S.repMonth, d) : monthOf(todayISO()); rerender(); },
  "rep-who": b => { S.repWho = b.dataset.v; rerender(); },
  "xf-user": b => { S.xf.user = b.dataset.v; rerender(); },
  "xf-cat": b => { S.xf.category = b.dataset.v; rerender(); },
  "xf-trip-clear": () => { S.xf.trip = ""; rerender(); }
};

export function onViewChange(el) {
  if (el.id === "xf-month") { S.xf.month = el.value; S.xf.date = ""; rerender(); return true; }
  if (el.id === "xf-date") { S.xf.date = el.value; if (el.value) S.xf.month = monthOf(el.value); rerender(); return true; }
  if (el.id === "xf-sort") { S.xf.sort = el.value; rerender(); return true; }
  return false;
}
