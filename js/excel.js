// MITAK Excel engine.
//
// Fills a company's own reimbursement template (.xlsx) with expenses, keeping the template's
// layout, styles, merged cells, formulas, data validation and print settings. Works the same in
// the browser and in Node: pass in the ExcelJS library.
//
// A mapping says where each value goes:
//   {
//     "sheet": "Fuel Claim",          // sheet name; empty = first sheet
//     "headerRow": 6,                 // row with the column headings; empty = find it automatically
//     "firstDataRow": 7,              // first expense row; empty = the row under the headings
//     "lastDataRow": 16,              // last ready-made row in the template; extra rows are inserted
//                                     //   above the totals when there are more expenses; empty = no limit
//     "columns": { "expense_date": "B", "amount": "Amount (AED)" },   // field → column letter or heading text
//     "cells": { "C3": "employee_name", "H3": "month_label" },        // cell → one value for the whole file
//     "sort": "oldest"                // or "newest"
//   }
// Heading text is matched without regard to case or punctuation. Use { "header": "KM" } to force a
// heading that looks like a column letter. A cell value can also be { "field": "...", "label": "Name: " }
// to keep a label in front of the value (for cells like "Name: ________").

import { ROW_FIELDS, HEADER_FIELDS, ROW_FIELD, HEADER_FIELD } from "./fields.js";

/* ---------------- Cell references ---------------- */

export function colToNum(letters) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function splitRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(ref).trim());
  return m ? { col: colToNum(m[1]), row: +m[2] } : null;
}
const isColumnLetter = v => typeof v === "string" && /^[A-Z]{1,2}$/.test(v.trim());
const MAX_COL = 16384;

export function normText(s) {
  return String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/* ---------------- Formula reference shifting ---------------- */

const REF = String.raw`(\$?)([A-Z]{1,3})(\$?)(\d+)`;
const REF_RE = new RegExp(String.raw`(?<![A-Za-z0-9_.$'])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?` + REF + String.raw`(?::` + REF + String.raw`)?(?![A-Za-z0-9_(!'])`, "g");
const unquoteSheet = p => p ? p.slice(0, -1).replace(/^'(.*)'$/, "$1").replace(/''/g, "'") : null;

// Rewrites every A1-style reference in a formula (or a plain range list) outside string literals.
function mapRefs(text, fn) {
  return String(text).split(/("(?:[^"]|"")*")/).map((part, i) => i % 2 ? part : part.replace(REF_RE,
    (m, prefix, c1a, c1, r1a, r1, c2a, c2, r2a, r2) => {
      if (colToNum(c1) > MAX_COL || (c2 && colToNum(c2) > MAX_COL)) return m;
      const out = fn({ sheet: unquoteSheet(prefix), a: { colAbs: c1a, col: c1, rowAbs: r1a, row: +r1 }, b: c2 ? { colAbs: c2a, col: c2, rowAbs: r2a, row: +r2 } : null });
      if (!out) return m;
      const s = x => `${x.colAbs}${x.col}${x.rowAbs}${x.row}`;
      return (prefix || "") + s(out.a) + (out.b ? ":" + s(out.b) : "");
    })).join("");
}

// Row insertion: `count` rows inserted at row `at` of sheet `sheet`. References at or below `at` move
// down. Ranges that end on the template's last data row (and start inside the table) grow, so totals
// such as SUM(H7:H16) keep covering every expense row.
function insertionShift({ sheet, at, count, tableStart, tableEnd }) {
  return (text, homeSheet) => mapRefs(text, ({ sheet: s, a, b }) => {
    const target = s == null ? homeSheet : s;
    if (!target || target.toLowerCase() !== sheet.toLowerCase()) return null;
    const na = { ...a }, nb = b ? { ...b } : null;
    if (na.row >= at) na.row += count;
    if (nb) {
      if (nb.row >= at) nb.row += count;
      else if (tableEnd != null && nb.row === tableEnd && a.row >= tableStart - 1 && a.row <= tableEnd) nb.row += count;
    }
    return { a: na, b: nb };
  });
}
export function shiftFormula(formula, opts, homeSheet = opts.sheet) { return insertionShift(opts)(formula, homeSheet); }

// Copying a formula down by `k` rows: relative row references move, $-anchored ones stay.
export function fillDown(formula, k) {
  return mapRefs(formula, ({ a, b }) => {
    const mv = x => x.rowAbs ? { ...x } : { ...x, row: x.row + k };
    return { a: mv(a), b: b ? mv(b) : null };
  });
}

/* ---------------- Workbook helpers ---------------- */

export async function loadWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb;
}
export function pickSheet(wb, name) {
  if (name) {
    const byName = wb.worksheets.find(w => w.name.toLowerCase() === String(name).toLowerCase());
    if (byName) return byName;
    if (Number.isInteger(+name) && wb.worksheets[+name - 1]) return wb.worksheets[+name - 1];
  }
  return wb.worksheets.find(w => w.state !== "hidden" && w.state !== "veryHidden") || wb.worksheets[0];
}
const master = cell => (cell.isMerged && cell.master) ? cell.master : cell;
function cellText(cell) {
  const v = master(cell).value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || v instanceof Date) return "";
  if (v.richText) return v.richText.map(t => t.text).join("");
  if (v.text != null) return String(v.text);
  return "";
}
const hasFormula = cell => { const v = cell.value; return !!(v && typeof v === "object" && (v.formula || v.sharedFormula)); };
const formulaOf = cell => cell.formula || (cell.value && cell.value.formula) || "";
const isPlaceholder = s => /^[\s_.:\-–—…]*$/.test(s);
const hasBorder = cell => { const b = cell.style && cell.style.border; return !!(b && (b.top || b.bottom || b.left || b.right)); };

function eachCell(ws, fn) {
  ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => fn(cell, row.number, cell.col)));
}

// Shared formulas are stored once and referenced by the other cells; turn them into ordinary
// formulas so rows can be moved safely.
function unshareFormulas(wb) {
  for (const ws of wb.worksheets) {
    const fixes = [];
    eachCell(ws, cell => {
      const v = cell.value;
      if (v && typeof v === "object" && (v.sharedFormula || v.shareType)) fixes.push([cell, { formula: cell.formula || v.formula, result: v.result }]);
    });
    fixes.forEach(([cell, val]) => { if (val.formula) cell.value = val; });
  }
}

/* ---------------- Finding the table and labels in a template ---------------- */

function bestMatch(text, fields) {
  const t = normText(text);
  if (!t || t.length > 60) return null;
  let best = null;
  for (const f of fields) for (const syn of f.match || []) {
    let score = 0;
    if (t === syn) score = 100 + syn.length;
    else if (syn.length >= 3 && (` ${t} `).includes(` ${syn} `)) score = syn.length;
    if (score && (!best || score > best.score)) best = { field: f.key, score };
  }
  return best;
}

function assignRow(ws, rowNumber, fields) {
  const cands = [];
  ws.getRow(rowNumber).eachCell({ includeEmpty: false }, cell => {
    if (cell.isMerged && cell.master !== cell) return;
    const text = cellText(cell);
    if (!text) return;
    const m = bestMatch(text, fields);
    cands.push({ col: cell.col, text: text.trim(), match: m });
  });
  const used = new Set(), byCol = {};
  cands.filter(c => c.match).sort((x, y) => y.match.score - x.match.score).forEach(c => {
    if (!used.has(c.match.field)) { used.add(c.match.field); byCol[c.col] = c.match.field; }
  });
  const score = cands.reduce((s, c) => s + (byCol[c.col] ? (c.match.score >= 100 ? 3 : 1) : 0), 0);
  return { cells: cands.map(c => ({ col: c.col, letter: numToCol(c.col), text: c.text, field: byCol[c.col] || "" })), score, matched: Object.keys(byCol).length };
}

export function findHeaderRow(ws) {
  let best = null;
  const last = Math.min(ws.rowCount || 0, 80);
  for (let r = 1; r <= last; r++) {
    const a = assignRow(ws, r, ROW_FIELDS);
    if (a.matched >= 2 && (!best || a.score > best.score)) best = { row: r, ...a };
  }
  return best;
}

// Where the ready-made expense rows end: just above a "Total" row, a SUM over the rows above,
// a signature/approval line, or the end of the bordered table.
export function findTableEnd(ws, firstDataRow, cols) {
  const firstBordered = cols.some(c => hasBorder(ws.getRow(firstDataRow).getCell(c)));
  const last = Math.max(ws.rowCount || 0, firstDataRow);
  for (let r = firstDataRow; r <= Math.min(last, firstDataRow + 1000); r++) {
    const row = ws.getRow(r);
    let stop = false;
    row.eachCell({ includeEmpty: false }, cell => {
      if (stop) return;
      const t = normText(cellText(cell));
      if (/^(grand )?total\b|^sub ?total\b|signature|approved|prepared|verified|certif|declar|authori[sz]ed|checked by|received by/.test(t)) stop = true;
      if (hasFormula(cell)) {
        let spans = false;
        mapRefs(formulaOf(cell), ({ a, b }) => { if (b && b.row < r && b.row > a.row) spans = true; return null; });
        if (spans) stop = true;
      }
    });
    if (stop) return r - 1;
    if (firstBordered && r > firstDataRow && !cols.some(c => hasBorder(row.getCell(c)))) return r - 1;
  }
  return firstBordered ? last : null;
}

function findLabels(ws, skipFrom, skipTo) {
  const out = [], used = new Set();
  const last = Math.min(ws.rowCount || 0, 400);
  for (let r = 1; r <= last; r++) {
    if (r >= skipFrom && r <= skipTo) continue;
    ws.getRow(r).eachCell({ includeEmpty: false }, cell => {
      if (cell.isMerged && cell.master !== cell) return;
      const raw = cellText(cell).trim();
      if (!raw) return;
      const colon = raw.indexOf(":");
      const labelPart = colon >= 0 ? raw.slice(0, colon) : raw;
      const after = colon >= 0 ? raw.slice(colon + 1) : "";
      const m = bestMatch(labelPart, HEADER_FIELDS);
      // Exact label ("Employee Name"), or a looser one when it ends in a colon ("Name of employee:").
      if (!m || (m.score < 100 && !(colon >= 0 && m.score >= 4)) || used.has(m.field)) return;
      // "Name: ________" in one cell: write the value into that cell, keeping the label.
      if (colon >= 0 && after.trim() && isPlaceholder(after)) {
        used.add(m.field);
        out.push({ cell: cell.address, label: raw, field: m.field, keepLabel: raw.slice(0, colon + 1) + " " });
        return;
      }
      if (after.trim()) return;
      // Otherwise the value goes in the next free cell to the right.
      const span = cell.isMerged ? mergeWidth(ws, cell) : 1;
      for (let c = cell.col + span; c <= cell.col + span + 6; c++) {
        const target = ws.getRow(r).getCell(c);
        const m2 = master(target);
        const txt = cellText(m2).trim();
        if (txt && !isPlaceholder(txt)) {
          if (bestMatch(txt.replace(/:.*/, ""), HEADER_FIELDS)) break;
          continue;
        }
        if (typeof m2.value === "number" || m2.value instanceof Date || hasFormula(m2)) break;
        used.add(m.field);
        out.push({ cell: m2.address, label: raw, field: m.field });
        break;
      }
    });
  }
  return out;
}
function mergeWidth(ws, cell) {
  for (const range of ws.model.merges || []) {
    const [a, b] = range.split(":").map(splitRef);
    if (a && b && a.row === cell.row && a.col === cell.col) return b.col - a.col + 1;
  }
  return 1;
}

// Looks at a template and suggests a mapping. `opts.sheet` / `opts.headerRow` override the guesses.
export function inspectTemplate(wb, opts = {}) {
  const ws = pickSheet(wb, opts.sheet);
  const sheets = wb.worksheets.map(w => w.name);
  let header = opts.headerRow ? { row: +opts.headerRow, ...assignRow(ws, +opts.headerRow, ROW_FIELDS) } : findHeaderRow(ws);
  const result = { sheets, sheet: ws.name, headerRow: header ? header.row : null, headers: header ? header.cells : [], firstDataRow: null, lastDataRow: null, labels: [], totalCells: [] };
  if (!header) return result;
  // A second heading row (e.g. "Odometer" over "Start | End") pushes the data down a row.
  let first = header.row + 1;
  const next = ws.getRow(first);
  let texts = 0, nonText = 0;
  next.eachCell({ includeEmpty: false }, c => { if (cellText(c)) texts++; else if (c.value != null) nonText++; });
  if (texts >= 2 && !nonText && !/total/i.test(next.values.join(" "))) {
    const sub = assignRow(ws, first, ROW_FIELDS.filter(f => !header.cells.some(h => h.field === f.key)));
    sub.cells.forEach(sc => {
      const existing = result.headers.find(h => h.col === sc.col);
      if (existing) { existing.text = `${existing.text} / ${sc.text}`; if (!existing.field) existing.field = sc.field; }
      else result.headers.push(sc);
    });
    result.headers.sort((x, y) => x.col - y.col);
    first++;
  }
  result.firstDataRow = first;
  const cols = result.headers.map(h => h.col);
  result.lastDataRow = findTableEnd(ws, first, cols);
  const tableEnd = result.lastDataRow ?? first;
  result.labels = findLabels(ws, header.row, tableEnd);
  // A "Total" row with an empty amount cell: put the total there (a formula already there is kept).
  const amountCol = result.headers.find(h => h.field === "amount");
  if (amountCol && result.lastDataRow != null) {
    const totalRow = result.lastDataRow + 1, cell = ws.getRow(totalRow).getCell(amountCol.col);
    let isTotal = false;
    ws.getRow(totalRow).eachCell({ includeEmpty: false }, c => { if (/total/.test(normText(cellText(c)))) isTotal = true; });
    if (isTotal && cell.value == null && !result.labels.some(l => l.field === "total_amount")) {
      result.labels.push({ cell: cell.address, label: "Total row", field: "total_amount" });
    }
  }
  return result;
}

export function mappingFromInspection(ins) {
  const columns = {}, cells = {};
  ins.headers.forEach(h => { if (h.field && !columns[h.field]) columns[h.field] = h.letter; });
  ins.labels.forEach(l => { cells[l.cell] = l.keepLabel ? { field: l.field, label: l.keepLabel } : l.field; });
  return { version: 1, sheet: ins.sheet, headerRow: ins.headerRow, firstDataRow: ins.firstDataRow, lastDataRow: ins.lastDataRow, columns, cells, sort: "oldest" };
}

/* ---------------- Writing values ---------------- */

function utcDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function setStyle(cell, patch) { cell.style = { ...JSON.parse(JSON.stringify(cell.style || {})), ...patch }; }
const generalFmt = f => !f || f === "General" || f === "@";

function writeValue(cell, value, type, opts = {}) {
  cell = master(cell);
  if (value == null || value === "") { cell.value = opts.label ? opts.label.trimEnd() : null; return; }
  if (opts.label) { cell.value = opts.label + formatPlain(value, type, opts.dateFormat); return; }
  if (type === "date") {
    const d = utcDate(value);
    if (!d) { cell.value = String(value); return; }
    cell.value = d;
    if (generalFmt(cell.numFmt)) setStyle(cell, { numFmt: opts.dateFormat || "dd/mm/yyyy" });
    return;
  }
  if (type === "money" || type === "number" || type === "int") {
    const n = Number(value);
    if (!isFinite(n)) { cell.value = String(value); return; }
    cell.value = n;
    if (type === "money" && generalFmt(cell.numFmt)) setStyle(cell, { numFmt: "#,##0.00" });
    return;
  }
  cell.value = String(value);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Dates written as text (e.g. after a label) follow the mapping's dateFormat: dd, d, mm, mmm, yyyy, yy.
function formatPlain(value, type, dateFormat = "dd/mm/yyyy") {
  if (type === "date") {
    const d = utcDate(value);
    if (!d) return String(value);
    const day = d.getUTCDate(), mon = d.getUTCMonth(), yr = d.getUTCFullYear();
    return dateFormat.replace(/yyyy|yy|mmm|mm|dd|d/g, t => ({ yyyy: String(yr), yy: String(yr).slice(2), mmm: MON[mon], mm: String(mon + 1).padStart(2, "0"), dd: String(day).padStart(2, "0"), d: String(day) })[t]);
  }
  if (type === "money") return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}

/* ---------------- Inserting rows without breaking the template ---------------- */

function shiftRangeList(text, shift, sheetName) { return shift(text, sheetName); }

export function insertRows(wb, ws, { after, count, tableStart }) {
  if (count <= 0) return;
  const at = after + 1;
  const ctx = { sheet: ws.name, at, count, tableStart, tableEnd: after };
  const shift = insertionShift(ctx);

  // 1. Merged cells below the insertion point are taken apart and put back once rows have moved.
  const merges = (ws.model.merges || []).map(r => { const [a, b] = r.split(":").map(splitRef); return { r, a, b }; }).filter(m => m.a && m.b);
  const remerge = [];
  for (const m of merges) {
    const inSource = m.a.row === after && m.b.row === after;
    if (m.b.row >= at || (m.b.row === after && m.a.row >= tableStart && !inSource)) {
      ws.unMergeCells(m.r);
      const top = m.a.row >= at ? m.a.row + count : m.a.row;
      remerge.push([top, m.a.col, m.b.row + count, m.b.col]);
    }
    if (inSource) for (let k = 1; k <= count; k++) remerge.push([after + k, m.a.col, after + k, m.b.col]);
  }

  // 2. Remember the template row being repeated, then open up space.
  const src = ws.getRow(after);
  const srcCells = [];
  src.eachCell({ includeEmpty: true }, cell => srcCells.push({ col: cell.col, style: JSON.parse(JSON.stringify(cell.style || {})), value: cell.value, formula: hasFormula(cell) ? formulaOf(cell) : null }));
  const srcHeight = src.height;
  const images = typeof ws.getImages === "function" ? ws.getImages() : [];
  ws.spliceRows(at, 0, ...Array.from({ length: count }, () => []));

  // 3. Every formula in the workbook that points at moved rows is updated.
  for (const sheet of wb.worksheets) {
    eachCell(sheet, (cell, r) => {
      if (sheet === ws && r >= at && r < at + count) return;
      if (!hasFormula(cell)) return;
      const f = formulaOf(cell), nf = shift(f, sheet.name);
      if (nf !== f) cell.value = { formula: nf, result: cell.value.result };
    });
  }

  // 4. The new rows look like the template row (borders, formats, row formulas).
  for (let k = 1; k <= count; k++) {
    const row = ws.getRow(after + k);
    if (srcHeight) row.height = srcHeight;
    for (const c of srcCells) {
      const cell = row.getCell(c.col);
      cell.style = JSON.parse(JSON.stringify(c.style));
      if (c.formula) cell.value = { formula: fillDown(shift(c.formula, ws.name), k) };
      else if (c.value != null && typeof c.value !== "object") cell.value = c.value;
    }
  }
  remerge.forEach(([t, l, b, r]) => { try { ws.mergeCells(t, l, b, r); } catch (e) { /* overlapping merge in the template: leave it */ } });

  // 5. Data validation, conditional formatting, images, print area and filters follow the rows.
  const dv = ws.dataValidations && ws.dataValidations.model;
  if (dv) {
    const next = {};
    for (const [key, rule] of Object.entries(dv)) {
      const ref = splitRef(key);
      if (ref) {
        next[ref.row >= at ? `${numToCol(ref.col)}${ref.row + count}` : key] = rule;
        if (ref.row === after) for (let k = 1; k <= count; k++) next[`${numToCol(ref.col)}${after + k}`] = rule;
      } else next[shiftRangeList(key, shift, ws.name)] = rule;
    }
    ws.dataValidations.model = next;
  }
  for (const cf of ws.conditionalFormattings || []) {
    if (cf.ref) cf.ref = shiftRangeList(cf.ref, shift, ws.name);
    for (const rule of cf.rules || []) if (Array.isArray(rule.formulae)) rule.formulae = rule.formulae.map(f => typeof f === "string" ? shift(f, ws.name) : f);
  }
  for (const img of images) {
    for (const anchor of [img.range && img.range.tl, img.range && img.range.br]) {
      if (anchor && typeof anchor.nativeRow === "number" && anchor.nativeRow + 1 >= at) anchor.nativeRow += count;
    }
  }
  if (ws.pageSetup && ws.pageSetup.printArea) ws.pageSetup.printArea = shiftRangeList(ws.pageSetup.printArea, shift, ws.name);
  if (ws.autoFilter && typeof ws.autoFilter === "string") ws.autoFilter = shiftRangeList(ws.autoFilter, shift, ws.name);
}

/* ---------------- Filling a template ---------------- */

// data = { rows: [{ field: value }], header: { field: value } } (see reports.js)
export async function fillTemplate(ExcelJS, templateData, mapping, data) {
  const wb = await loadWorkbook(ExcelJS, templateData);
  unshareFormulas(wb);
  const ws = pickSheet(wb, mapping.sheet);
  const ins = (!mapping.headerRow || !mapping.firstDataRow || Object.values(mapping.columns || {}).some(v => !isColumnLetter(v)))
    ? inspectTemplate(wb, { sheet: ws.name, headerRow: mapping.headerRow }) : null;

  const headerRow = +mapping.headerRow || (ins && ins.headerRow) || null;
  const first = +mapping.firstDataRow || (ins && ins.firstDataRow) || (headerRow ? headerRow + 1 : null);
  if (!first) throw Object.assign(new Error("MITAK couldn't find where the expense rows start in this template. Set the first data row in the template settings."), { code: "no_table" });
  const last = mapping.lastDataRow === "" || mapping.lastDataRow == null ? (mapping.headerRow ? null : ins && ins.lastDataRow) : +mapping.lastDataRow;

  // Columns: letters as given, heading text looked up in the heading row.
  const columns = [];
  for (const [field, target] of Object.entries(mapping.columns || {})) {
    if (!target || !ROW_FIELD[field]) continue;
    let col = null;
    if (isColumnLetter(target)) col = colToNum(target.trim());
    else {
      const want = normText(typeof target === "object" ? target.header : target);
      const h = ins && ins.headers.find(x => normText(x.text) === want || normText(x.text.split(" / ").pop()) === want);
      if (h) col = h.col;
      else if (headerRow) ws.getRow(headerRow).eachCell({ includeEmpty: false }, c => { if (!col && normText(cellText(c)) === want) col = c.col; });
    }
    if (col) columns.push({ field, col, type: ROW_FIELD[field].type });
  }

  const rows = data.rows || [];
  const capacity = last != null && last >= first - 1 ? last - first + 1 : Infinity;
  let inserted = 0, insertAt = null;
  if (rows.length > capacity) {
    inserted = rows.length - capacity;
    const after = Math.max(last, first - 1);
    insertAt = after + 1;
    insertRows(wb, ws, { after, count: inserted, tableStart: first });
  }

  rows.forEach((row, i) => {
    const r = ws.getRow(first + i);
    for (const c of columns) writeValue(r.getCell(c.col), row[c.field], c.type, mapping);
  });

  for (const [ref, spec] of Object.entries(mapping.cells || {})) {
    const s = typeof spec === "string" ? { field: spec } : spec || {};
    const f = HEADER_FIELD[s.field];
    const at = splitRef(ref);
    if (!f || !at) continue;
    const row = insertAt != null && at.row >= insertAt ? at.row + inserted : at.row;
    writeValue(ws.getRow(row).getCell(at.col), (data.header || {})[s.field], f.type, { ...mapping, label: s.label });
  }

  // Excel recalculates the template's own formulas (totals etc.) when the file is opened.
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return wb.xlsx.writeBuffer();
}

/* ---------------- Plain workbook when no template is uploaded ---------------- */

export async function buildPlainWorkbook(ExcelJS, data, fieldKeys, title) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MITAK";
  const ws = wb.addWorksheet((title || "Expenses").slice(0, 31));
  const fields = fieldKeys.map(k => ROW_FIELD[k]).filter(Boolean);
  const h = data.header || {};
  const orange = "FFF97316", line = { style: "thin", color: { argb: "FFE5E7EB" } };
  ws.mergeCells(1, 1, 1, Math.max(4, fields.length));
  ws.getCell("A1").value = `${h.category_name || ""} reimbursement — ${h.month_label || ""}`.trim();
  ws.getCell("A1").font = { bold: true, size: 15, color: { argb: orange } };
  ws.getCell("A2").value = `${h.employee_name || ""}${h.employee_id ? " · Employee ID " + h.employee_id : ""}`;
  ws.getCell("A3").value = "Made with MITAK. Upload your company template in MITAK › Settings › Reimbursement templates to get this file in that format.";
  ws.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  const hr = 5;
  fields.forEach((f, i) => {
    const c = ws.getRow(hr).getCell(i + 1);
    c.value = f.label.replace(/ \(.*\)$/, f.type === "money" ? " (AED)" : "");
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: orange } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = { top: line, bottom: line, left: line, right: line };
  });
  (data.rows || []).forEach((row, ri) => {
    const r = ws.getRow(hr + 1 + ri);
    fields.forEach((f, i) => {
      const c = r.getCell(i + 1);
      c.border = { top: line, bottom: line, left: line, right: line };
      writeValue(c, row[f.key], f.type, {});
    });
  });
  const n = (data.rows || []).length, tr = hr + 1 + n;
  const ai = fields.findIndex(f => f.key === "amount");
  ws.getRow(tr).getCell(1).value = "Total";
  ws.getRow(tr).font = { bold: true };
  if (ai >= 0) {
    const L = numToCol(ai + 1);
    ws.getRow(tr).getCell(ai + 1).value = { formula: n ? `SUM(${L}${hr + 1}:${L}${tr - 1})` : "0", result: Number(h.total_amount) || 0 };
    ws.getRow(tr).getCell(ai + 1).numFmt = "#,##0.00";
  }
  fields.forEach((f, i) => { ws.getColumn(i + 1).width = f.key === "row_number" ? 6 : f.type === "date" ? 12 : f.key === "description" || f.key === "trip" ? 28 : 16; });
  ws.views = [{ state: "frozen", ySplit: hr }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return wb.xlsx.writeBuffer();
}
