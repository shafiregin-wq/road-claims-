// Totals for the screens, and the values that go into reimbursement Excel files.
// Expenses here use MITAK's app shape:
//   { id, category, amount, date: "YYYY-MM-DD", time: "HH:MM", paidBy, createdBy, description,
//     location, trip, details: {…}, receipts: [...], createdAt, updatedAt }

import { CAT, CATEGORIES } from "./fields.js";
import { r2, monthOf, monthLabel, monthStart, monthEnd, dayName, todayISO } from "./util.js";

export function totals(list) {
  const out = { total: 0, count: 0, byUser: {}, byCat: Object.fromEntries(CATEGORIES.map(c => [c.id, 0])), catCount: Object.fromEntries(CATEGORIES.map(c => [c.id, 0])) };
  for (const e of list) {
    const a = +e.amount || 0;
    out.total += a; out.count++;
    out.byUser[e.paidBy] = (out.byUser[e.paidBy] || 0) + a;
    out.byCat[e.category] = (out.byCat[e.category] || 0) + a;
    out.catCount[e.category] = (out.catCount[e.category] || 0) + 1;
  }
  out.total = r2(out.total);
  for (const k in out.byUser) out.byUser[k] = r2(out.byUser[k]);
  for (const k in out.byCat) out.byCat[k] = r2(out.byCat[k]);
  return out;
}

export const inMonth = (list, month) => list.filter(e => monthOf(e.date) === month);
export const onDay = (list, iso) => list.filter(e => e.date === iso);

export function byDay(list, month) {
  const days = {};
  for (const e of inMonth(list, month)) {
    const d = days[e.date] || (days[e.date] = { total: 0, byUser: {}, count: 0 });
    d.total = r2(d.total + (+e.amount || 0)); d.count++;
    d.byUser[e.paidBy] = r2((d.byUser[e.paidBy] || 0) + (+e.amount || 0));
  }
  return days;
}

// Expenses grouped by their optional trip label, with who paid what.
export function byTrip(list) {
  const trips = {};
  for (const e of list) {
    const name = (e.trip || "").trim(); if (!name) continue;
    const t = trips[name] || (trips[name] = { name, total: 0, count: 0, byUser: {}, first: e.date, last: e.date });
    t.total = r2(t.total + (+e.amount || 0)); t.count++;
    t.byUser[e.paidBy] = r2((t.byUser[e.paidBy] || 0) + (+e.amount || 0));
    if (e.date < t.first) t.first = e.date;
    if (e.date > t.last) t.last = e.date;
  }
  return Object.values(trips).sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
}

export const newestFirst = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.time || "").localeCompare(a.time || "") || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
export const oldestFirst = (a, b) => -newestFirst(a, b);

const nameOf = (members, id) => (members.find(m => m.userId === id) || {}).displayName || "Former member";
const numOrNull = v => (v === "" || v == null || !isFinite(+v)) ? null : +v;
const vehicleKey = e => String((e.details || {}).vehicle || "").trim().toLowerCase() || "paid-by:" + e.paidBy;

// For each fuel expense: the previous odometer reading for the same vehicle (or the same person
// when no vehicle is entered), across all months.
export function previousOdometers(all) {
  const prev = {}, groups = {};
  for (const e of all) {
    if (e.category !== "fuel" || numOrNull((e.details || {}).odometer) == null) continue;
    (groups[vehicleKey(e)] ||= []).push(e);
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => oldestFirst(a, b) || (+a.details.odometer - +b.details.odometer));
    for (let i = 1; i < list.length; i++) prev[list[i].id] = +list[i - 1].details.odometer;
  }
  return prev;
}

export function reportExpenses(all, { category, month, paidBy }) {
  return all.filter(e => e.category === category && monthOf(e.date) === month && (!paidBy || e.paidBy === paidBy));
}

// Everything a template can ask for, for one category and month.
export function buildReportData({ expenses, members, workspaceName = "MITAK", category, month, paidBy = "", sort = "oldest", today = todayISO() }) {
  const list = reportExpenses(expenses, { category, month, paidBy }).sort(sort === "newest" ? newestFirst : oldestFirst);
  const prevOdo = category === "fuel" ? previousOdometers(expenses) : {};
  const rows = list.map((e, i) => {
    const d = e.details || {};
    const amount = r2(e.amount);
    const vat = r2(amount * 5 / 105);
    const odo = numOrNull(d.odometer), prev = prevOdo[e.id] ?? null;
    const litres = numOrNull(d.litres);
    const ppl = numOrNull(d.price_per_litre) ?? (litres ? r2(amount / litres) : null);
    return {
      row_number: i + 1,
      expense_date: e.date,
      expense_time: (e.time || "").slice(0, 5),
      day_name: dayName(e.date),
      category: CAT[e.category] ? CAT[e.category].label : e.category,
      amount,
      amount_excl_vat: r2(amount - vat),
      vat_amount: vat,
      description: e.description || "",
      location: e.location || "",
      trip: e.trip || "",
      paid_by: nameOf(members, e.paidBy),
      vehicle: d.vehicle || "",
      odometer: odo,
      odometer_previous: prev,
      distance_km: odo != null && prev != null && odo > prev ? odo - prev : null,
      litres,
      price_per_litre: ppl,
      fuel_station: d.fuel_station || "",
      toll_gate: d.toll_gate || "",
      duration: d.duration || "",
      receipt: (e.receipts || []).length ? "Yes" : "No",
      receipt_count: (e.receipts || []).length,
      added_by: nameOf(members, e.createdBy)
    };
  });

  const people = paidBy ? members.filter(m => m.userId === paidBy) : members;
  const joinProfile = key => [...new Set(people.map(m => String((m.profile || {})[key] || "").trim()).filter(Boolean))].join(" / ");
  const vehicles = {};
  rows.forEach(r => { if (r.vehicle) vehicles[r.vehicle] = (vehicles[r.vehicle] || 0) + 1; });
  const topVehicle = Object.keys(vehicles).sort((a, b) => vehicles[b] - vehicles[a])[0] || "";
  const sum = k => r2(rows.reduce((s, r) => s + (+r[k] || 0), 0));

  const header = {
    employee_name: people.map(m => m.displayName).join(" & "),
    employee_id: joinProfile("employee_id"),
    designation: joinProfile("designation"),
    department: joinProfile("department"),
    vehicle: topVehicle || joinProfile("vehicle"),
    month_label: monthLabel(month),
    month_start: monthStart(month),
    month_end: monthEnd(month),
    generated_date: today,
    total_amount: sum("amount"),
    total_vat: sum("vat_amount"),
    expense_count: rows.length,
    total_litres: sum("litres"),
    total_distance: Math.round(rows.reduce((s, r) => s + (r.distance_km || 0), 0)),
    category_name: CAT[category] ? CAT[category].label : category,
    workspace_name: workspaceName
  };
  return { rows, header, list };
}
