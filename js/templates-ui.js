// Reimbursement templates: upload, field mapping editor, and generating the monthly Excel files.

import { S, memberName, rerender } from "./state.js";
import { CAT, ROW_FIELDS, HEADER_FIELDS, DEFAULT_COLUMNS, BUILTIN_TEMPLATES } from "./fields.js";
import { buildReportData } from "./reports.js";
import { loadWorkbook, inspectTemplate, mappingFromInspection, fillTemplate, buildPlainWorkbook, splitRef, colToNum } from "./excel.js";
import { esc, aed, monthLabel, fileSafe, MONTHS } from "./util.js";
import { $, ic, openSheet, toast, busy, confirmDialog, toFile, showFile, downloadFile, getExcelJS } from "./ui.js";
import { errText } from "./expense-form.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const libError = e => e && e.code === "offline" ? "MITAK needs the internet the first time it makes an Excel file. Connect and try again." : null;

/* ---------- Upload ---------- */

export function pickTemplate(category) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.xlsm," + XLSX_TYPE;
  input.className = "vh";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (file) await uploadTemplate(category, file);
  });
  input.click();
}

export async function uploadTemplate(category, file) {
  if (/\.xls$/i.test(file.name)) { toast("That’s an old .xls file. Open it in Excel and save it as .xlsx, then upload it again.", "bad", 6000); return; }
  const b = busy("Reading the template…");
  try {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw Object.assign(new Error("not xlsx"), { code: "not_xlsx" });
    const ExcelJS = await getExcelJS();
    let wb;
    try { wb = await loadWorkbook(ExcelJS, buf); } catch (e) { throw Object.assign(new Error("bad"), { code: "not_xlsx" }); }
    const mapping = mappingFromInspection(inspectTemplate(wb));
    b.set("Saving the template…");
    const path = `templates/${category}.xlsx`;
    await S.backend.uploadFile(path, new Blob([buf], { type: XLSX_TYPE }), XLSX_TYPE);
    S.templates[category] = await S.backend.saveTemplate(category, { fileName: file.name, filePath: path, mapping });
    b.done();
    rerender();
    toast(`${CAT[category].label} template saved. Check where each value goes.`, "ok");
    await openMappingEditor(category, wb);
  } catch (e) {
    b.done();
    toast(e && e.code === "not_xlsx" ? "That file isn’t an Excel .xlsx workbook." : libError(e) || errText(e, "Couldn’t save the template. Try again."), "bad", 5000);
  }
}

async function templateWorkbook(category) {
  const t = S.templates[category];
  const blob = await S.backend.fileBlob(t.filePath);
  return { wb: await loadWorkbook(await getExcelJS(), await blob.arrayBuffer()), blob };
}

/* ---------- Template actions menu ---------- */

export function openTemplateMenu(category) {
  const t = S.templates[category], c = CAT[category];
  const sh = openSheet(`${c.label} template`, { small: true });
  sh.body.innerHTML = `
    <p class="small"><b>${esc(t.fileName)}</b><br><span class="muted">Updated ${t.updatedAt ? new Date(t.updatedAt).toLocaleDateString("en-GB") : ""}${t.updatedBy ? " by " + esc(memberName(t.updatedBy)) : ""}</span></p>
    <button class="btn" data-x="map">${ic("wand", 18)} Edit field mapping</button>
    <button class="btn" data-x="replace">${ic("upload", 18)} Replace with a new file</button>
    <button class="btn" data-x="download">${ic("download", 18)} Download the empty template</button>
    <button class="btn danger" data-x="remove">${ic("trash", 18)} Remove template</button>`;
  sh.body.addEventListener("click", async ev => {
    const x = ev.target.closest("[data-x]"); if (!x) return;
    if (x.dataset.x === "map") { sh.close(); openMappingEditor(category); }
    if (x.dataset.x === "replace") { sh.close(); pickTemplate(category); }
    if (x.dataset.x === "download") {
      try { downloadFile(toFile(await S.backend.fileBlob(t.filePath), t.fileName || `${c.label}.xlsx`)); } catch (e) { toast(errText(e, "Couldn’t download the template."), "bad"); }
    }
    if (x.dataset.x === "remove") {
      if (!await confirmDialog(`Remove the ${c.label.toLowerCase()} template?`, { okLabel: "Remove", detail: "Reports will use MITAK’s simple layout until you upload another one." })) return;
      try {
        await S.backend.deleteTemplate(category);
        if (t.filePath) S.backend.deleteFiles([t.filePath]).catch(() => {});
        delete S.templates[category];
        sh.close(); rerender(); toast("Template removed.", "ok");
      } catch (e) { toast(errText(e, "Couldn’t remove the template."), "bad"); }
    }
  });
}

/* ---------- Mapping editor ---------- */

const fieldOptions = (fields, cur) => `<option value="">— Leave empty —</option>${fields.map(f => `<option value="${f.key}" ${f.key === cur ? "selected" : ""}>${esc(f.label)}</option>`).join("")}`;
const cellSpec = v => typeof v === "string" ? { field: v } : (v || {});

export async function openMappingEditor(category, wbGiven) {
  const t = S.templates[category], c = CAT[category];
  let wb = wbGiven;
  if (!wb) {
    const b = busy("Opening the template…");
    try { wb = (await templateWorkbook(category)).wb; b.done(); }
    catch (e) { b.done(); toast(libError(e) || errText(e, "Couldn’t open the template."), "bad"); return; }
  }
  let M = JSON.parse(JSON.stringify(t.mapping && Object.keys(t.mapping).length ? t.mapping : mappingFromInspection(inspectTemplate(wb))));
  M.columns = M.columns || {}; M.cells = M.cells || {};
  let ins = inspectTemplate(wb, { sheet: M.sheet, headerRow: M.headerRow });
  let err = "";

  const sh = openSheet(`${c.label} template: where values go`, { sticky: true });
  sh.el.dataset.testid = "mapping-sheet";

  function headerList() {
    // Headings found in the heading row, plus any mapped column that isn't one of them.
    const rows = ins.headers.map(h => ({ letter: h.letter, text: h.text }));
    for (const v of Object.values(M.columns)) if (/^[A-Z]{1,2}$/.test(v) && !rows.some(r => r.letter === v)) rows.push({ letter: v, text: "" });
    return rows.sort((a, b) => colToNum(a.letter) - colToNum(b.letter));
  }
  const fieldAt = letter => Object.keys(M.columns).find(k => M.columns[k] === letter) || "";
  function cellLabel(ref) {
    const r = splitRef(ref); if (!r) return "";
    const ws = wb.worksheets.find(w => w.name === ins.sheet) || wb.worksheets[0];
    for (let col = r.col - 1; col >= Math.max(1, r.col - 4); col--) {
      const v = ws.getRow(r.row).getCell(col).value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function draw() {
    const heads = headerList();
    sh.body.innerHTML = `
      <p class="small">MITAK found the expense table in <b>${esc(t.fileName)}</b>. Check each column, then save. Nothing in the template is changed except the cells listed here.</p>
      ${ins.sheets.length > 1 ? `<div class="field"><label class="lbl" for="m-sheet">Sheet</label><select id="m-sheet">${ins.sheets.map(s => `<option ${s === ins.sheet ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>` : ""}
      <div class="g3">
        <div class="field"><label class="lbl" for="m-head">Heading row</label><input id="m-head" type="number" min="1" inputmode="numeric" value="${esc(M.headerRow ?? "")}"></div>
        <div class="field"><label class="lbl" for="m-first">First expense row</label><input id="m-first" type="number" min="1" inputmode="numeric" value="${esc(M.firstDataRow ?? "")}"></div>
        <div class="field"><label class="lbl" for="m-last">Last ready row</label><input id="m-last" type="number" min="1" inputmode="numeric" placeholder="no limit" value="${esc(M.lastDataRow ?? "")}"></div>
      </div>
      <p class="hint">When there are more expenses than ready rows, MITAK adds rows above the totals and copies the row’s formatting and formulas.</p>
      <h3>Columns <span class="muted small">one row per expense</span></h3>
      ${heads.length ? `<div class="map-list">${heads.map(h => `<div class="map-row"><span class="map-ref">${h.letter}</span><span class="map-text">${esc(h.text || "(no heading)")}</span>
        <select data-col="${h.letter}" aria-label="Value for column ${h.letter}">${fieldOptions(ROW_FIELDS, fieldAt(h.letter))}</select></div>`).join("")}</div>`
        : `<p class="note warn">No headings found in row ${esc(M.headerRow ?? "?")}. Enter the row number that has the column headings.</p>`}
      <div class="add-row"><input id="m-newcol" placeholder="Column, e.g. K" maxlength="2" aria-label="Column letter"><select id="m-newcolf" aria-label="Value">${fieldOptions(ROW_FIELDS, "")}</select><button class="btn small" data-x="addcol">Add</button></div>
      <h3>Single cells <span class="muted small">one value per file</span></h3>
      <div class="map-list">${Object.entries(M.cells).map(([ref, v]) => { const s = cellSpec(v); const lbl = s.label || cellLabel(ref); return `<div class="map-row"><span class="map-ref">${esc(ref)}</span><span class="map-text">${esc(lbl || "")}</span>
        <select data-cell="${esc(ref)}" aria-label="Value for cell ${esc(ref)}">${fieldOptions(HEADER_FIELDS, s.field)}</select><button class="icon-btn" data-rmcell="${esc(ref)}" aria-label="Remove ${esc(ref)}">${ic("x", 14)}</button></div>`; }).join("") || `<p class="muted small">None yet.</p>`}</div>
      <div class="add-row"><input id="m-newcell" placeholder="Cell, e.g. C3" maxlength="8" aria-label="Cell"><select id="m-newcellf" aria-label="Value">${fieldOptions(HEADER_FIELDS, "")}</select><button class="btn small" data-x="addcell">Add</button></div>
      <div class="row-btns"><button class="btn" data-x="detect">${ic("wand", 18)} Detect again</button><button class="btn" data-x="test">${ic("sheet", 18)} Try with ${monthLabel(S.repMonth)}</button></div>
      <details class="more"><summary>Advanced: edit as text</summary><div class="inner">
        <p class="hint">For developers: <code>columns</code> maps a MITAK field to a column letter or heading text, <code>cells</code> maps a cell to a field.</p>
        <textarea id="m-json" spellcheck="false" rows="12">${esc(JSON.stringify(M, null, 2))}</textarea>
        <button class="btn small" data-x="json">Apply text</button>
      </div></details>
      <p class="err" role="alert">${esc(err)}</p>`;
    sh.foot.innerHTML = `<button class="btn" data-x="cancel">Cancel</button><span class="grow"></span><button class="btn primary" data-x="save">Save mapping</button>`;
  }
  const reinspect = () => { ins = inspectTemplate(wb, { sheet: M.sheet, headerRow: M.headerRow }); };

  sh.body.addEventListener("change", ev => {
    const el = ev.target;
    if (el.dataset.col) {
      const letter = el.dataset.col, field = el.value;
      for (const k of Object.keys(M.columns)) if (M.columns[k] === letter || k === field) delete M.columns[k];
      if (field) M.columns[field] = letter;
      draw(); return;
    }
    if (el.dataset.cell) { const s = cellSpec(M.cells[el.dataset.cell]); M.cells[el.dataset.cell] = s.label ? { ...s, field: el.value } : el.value; return; }
    if (el.id === "m-sheet") { M.sheet = el.value; M.headerRow = null; const fresh = mappingFromInspection(inspectTemplate(wb, { sheet: el.value })); M = { ...M, ...fresh }; reinspect(); draw(); return; }
    if (el.id === "m-head") {
      M.headerRow = el.value ? +el.value : null; reinspect();
      if (ins.headerRow) { M.firstDataRow = ins.firstDataRow; M.lastDataRow = ins.lastDataRow; }
      draw(); return;
    }
    if (el.id === "m-first") { M.firstDataRow = el.value ? +el.value : null; return; }
    if (el.id === "m-last") { M.lastDataRow = el.value ? +el.value : null; return; }
  });
  const onClick = async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.rmcell) { delete M.cells[b.dataset.rmcell]; draw(); return; }
    const x = b.dataset.x; if (!x) return;
    if (x === "addcol") {
      const L = ($("#m-newcol", sh.body).value || "").trim().toUpperCase(), f = $("#m-newcolf", sh.body).value;
      if (!/^[A-Z]{1,2}$/.test(L) || !f) { err = "Enter a column letter (like K) and choose a value."; draw(); return; }
      for (const k of Object.keys(M.columns)) if (M.columns[k] === L) delete M.columns[k];
      M.columns[f] = L; err = ""; draw();
    }
    if (x === "addcell") {
      const ref = ($("#m-newcell", sh.body).value || "").trim().toUpperCase(), f = $("#m-newcellf", sh.body).value;
      if (!splitRef(ref) || !f) { err = "Enter a cell (like C3) and choose a value."; draw(); return; }
      M.cells[ref] = f; err = ""; draw();
    }
    if (x === "detect") { M = { ...mappingFromInspection(inspectTemplate(wb, { sheet: M.sheet })) }; reinspect(); err = ""; draw(); toast("Mapping detected again from the template."); }
    if (x === "json") {
      try {
        const v = JSON.parse($("#m-json", sh.body).value);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
        M = { ...v, columns: v.columns || {}, cells: v.cells || {} }; reinspect(); err = ""; draw(); toast("Mapping updated from the text.");
      } catch (e) { err = "That text isn’t valid JSON."; draw(); }
    }
    if (x === "test") await runReport(category, { mapping: M, test: true });
    if (x === "cancel") sh.close();
    if (x === "save") {
      if (!Object.keys(M.columns).length) { err = "Map at least one column, such as Date or Amount."; draw(); return; }
      if (M.firstDataRow && M.lastDataRow && M.lastDataRow < M.firstDataRow - 1) { err = "The last ready row can’t be above the first expense row."; draw(); return; }
      try {
        S.templates[category] = await S.backend.saveTemplate(category, { fileName: t.fileName, filePath: t.filePath, mapping: M });
        sh.close(); rerender(); toast("Mapping saved.", "ok");
      } catch (e) { err = errText(e, "Couldn’t save the mapping. Try again."); draw(); }
    }
  };
  sh.body.addEventListener("click", onClick);
  sh.foot.addEventListener("click", onClick);
  draw();
}

/* ---------- Generate Excel ---------- */

// The company form shipped with MITAK (used until another one is uploaded).
async function builtinTemplate(category) {
  const b = BUILTIN_TEMPLATES[category];
  const res = await fetch(b.url, { cache: "no-cache" });
  if (!res.ok) throw Object.assign(new Error("builtin"), { code: "offline" });
  return res.arrayBuffer();
}
export async function downloadBuiltin(category) {
  try { downloadFile(toFile(await builtinTemplate(category), BUILTIN_TEMPLATES[category].fileName)); }
  catch (e) { toast("Couldn’t download the form. Check your connection.", "bad"); }
}

export async function runReport(category, opts = {}) {
  const month = S.repMonth, who = S.repWho == null ? S.user.id : S.repWho, c = CAT[category];
  const t = S.templates[category] && S.templates[category].filePath ? S.templates[category] : null;
  const builtin = !t && BUILTIN_TEMPLATES[category];
  const mapping = opts.mapping || (t && t.mapping) || (builtin && builtin.mapping) || {};
  const data = buildReportData({ expenses: S.expenses, members: S.members, workspaceName: S.workspace ? S.workspace.name : "MITAK", category, month, paidBy: who, sort: mapping.sort });
  if (!data.rows.length && !opts.test) { toast(`No ${c.label.toLowerCase()} expenses in ${monthLabel(month)}.`, "bad"); return; }
  const b = busy("Making the Excel file…");
  try {
    const ExcelJS = await getExcelJS();
    let buf, usedTemplate = false;
    if (t) {
      const blob = await S.backend.fileBlob(t.filePath);
      buf = await fillTemplate(ExcelJS, await blob.arrayBuffer(), mapping, data);
      usedTemplate = true;
    } else if (builtin) {
      buf = await fillTemplate(ExcelJS, await builtinTemplate(category), mapping, data);
      usedTemplate = true;
    } else buf = await buildPlainWorkbook(ExcelJS, data, DEFAULT_COLUMNS[category], c.label);
    const [y, m] = month.split("-").map(Number);
    const person = who ? "_" + fileSafe(memberName(who)) : "";
    const file = toFile(buf, `MITAK_${c.label}_${MONTHS[m - 1]}_${y}${person}${opts.test ? "_TEST" : ""}.xlsx`);
    b.done();
    showFile(opts.test ? "Test file ready" : "Excel file ready", file,
      `${c.emoji} ${c.label} · ${monthLabel(month)} · ${who ? esc(memberName(who)) : "both of you"}<br>${data.rows.length} expense${data.rows.length === 1 ? "" : "s"}, total <b>${aed(data.header.total_amount)}</b>.${usedTemplate ? "" : "<br><span class=\"muted\">Simple MITAK layout: no template uploaded for this type yet.</span>"}`);
  } catch (e) {
    b.done();
    toast(libError(e) || (e && e.code === "no_table" ? e.message : errText(e, "Couldn’t make the Excel file. Check the template mapping in Settings.")), "bad", 6000);
  }
}
