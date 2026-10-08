// Small shared helpers: dates, money, text.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const pad = n => String(n).padStart(2, "0");
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoOf(new Date());
export const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const monthOf = iso => String(iso || "").slice(0, 7);
export const parseISO = iso => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d || 1); };
export const validISO = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || "") && isoOf(parseISO(iso)) === iso;
export const monthLabel = key => { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const monthShort = key => { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${y}`; };
export const shiftMonth = (key, n) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const daysInMonth = key => { const [y, m] = key.split("-").map(Number); return new Date(y, m, 0).getDate(); };
export const monthStart = key => `${key}-01`;
export const monthEnd = key => `${key}-${pad(daysInMonth(key))}`;
export const dayName = iso => DAYS[parseISO(iso).getDay()];
export const fmtDate = iso => { if (!validISO(iso)) return iso || ""; const d = parseISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
export const fmtDayMonth = iso => { if (!validISO(iso)) return iso || ""; const d = parseISO(iso); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
export const fmtLongDay = iso => { if (!validISO(iso)) return iso || ""; const d = parseISO(iso); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtTime = t => t ? String(t).slice(0, 5) : "";

const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const r2 = n => Math.round((+n || 0) * 100) / 100;
export const money = n => nf2.format(r2(n));
export const aed = n => "AED " + money(n);
export const compact = n => { const v = +n || 0; return v >= 10000 ? nf0.format(v / 1000) + "k" : nf0.format(Math.round(v)); };
export const num = v => { if (v === "" || v == null) return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, "")); return isFinite(n) ? n : NaN; };

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const fileSafe = s => String(s || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
export const formatInvite = code => String(code || "").replace(/(.{4})(?=.)/g, "$1-");
