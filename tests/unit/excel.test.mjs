import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { shiftFormula, fillDown, inspectTemplate, mappingFromInspection, fillTemplate, loadWorkbook, buildPlainWorkbook } from "../../js/excel.js";
import { buildReportData } from "../../js/reports.js";
import { DEFAULT_COLUMNS } from "../../js/fields.js";
import { fuelTemplate, tollTemplate } from "../fixtures/make-templates.mjs";

const A = "user-a", B = "user-b";
const members = [
  { userId: A, displayName: "Shafi", role: "owner", profile: { employee_id: "E-104", vehicle: "Plate A 12345" } },
  { userId: B, displayName: "Ahmed", role: "member", profile: { employee_id: "E-221" } }
];
function fuel(n, month = "2026-10", paidBy = A) {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${month}-${i}`, category: "fuel", amount: 100 + i, date: `${month}-${String(1 + (i % 28)).padStart(2, "0")}`, time: "08:15",
    paidBy, createdBy: paidBy, description: "", location: "", trip: i % 2 ? "Abu Dhabi → Dubai" : "",
    details: { vehicle: "Car 1", odometer: 120000 + i * 300, litres: 40 + i, fuel_station: "ADNOC" }, receipts: i % 3 ? [] : [{ path: "x" }]
  }));
}

test("formula references move when rows are inserted", () => {
  const o = { sheet: "Fuel Claim", at: 17, count: 4, tableStart: 7, tableEnd: 16 };
  assert.equal(shiftFormula("SUM(H7:H16)", o), "SUM(H7:H20)", "total over the table grows");
  assert.equal(shiftFormula("H17*2+$H$18", o), "H21*2+$H$22", "cells below move, $ too");
  assert.equal(shiftFormula("H16+H5", o), "H16+H5", "cells above stay");
  assert.equal(shiftFormula('"Total H17"&H17', o), '"Total H17"&H21', "text in quotes is left alone");
  assert.equal(shiftFormula("LOG10(H17)+ATAN2(1,2)", o), "LOG10(H21)+ATAN2(1,2)", "function names are not cells");
  assert.equal(shiftFormula("'Fuel Claim'!H17+Other!H17", o, "Summary"), "'Fuel Claim'!H21+Other!H17", "only refs into the changed sheet move");
  assert.equal(shiftFormula("H17", o, "Summary"), "H17", "unqualified refs on another sheet point at that sheet");
  assert.equal(shiftFormula("COUNTA('Fuel Claim'!B7:B16)", o, "Summary"), "COUNTA('Fuel Claim'!B7:B20)");
  assert.equal(fillDown("IF(H16>0,F16*$G$16,\"\")", 2), "IF(H18>0,F18*$G$16,\"\")");
});

test("finds the table, headings and label cells in a typical fuel form", async () => {
  const wb = await loadWorkbook(ExcelJS, await fuelTemplate());
  const ins = inspectTemplate(wb);
  assert.equal(ins.sheet, "Fuel Claim");
  assert.equal(ins.headerRow, 6);
  assert.equal(ins.firstDataRow, 7);
  assert.equal(ins.lastDataRow, 16);
  const m = mappingFromInspection(ins);
  assert.deepEqual(m.columns, { row_number: "A", expense_date: "B", vehicle: "C", fuel_station: "D", odometer: "E", litres: "F", price_per_litre: "G", amount: "H" });
  assert.deepEqual(m.cells, { C3: "employee_name", H3: "month_label", C4: "employee_id", H4: "vehicle" });
});

test("fills a template in place and keeps its look and formulas", async () => {
  const tpl = await fuelTemplate();
  const wb0 = await loadWorkbook(ExcelJS, tpl);
  const mapping = mappingFromInspection(inspectTemplate(wb0));
  const data = buildReportData({ expenses: fuel(3), members, category: "fuel", month: "2026-10", paidBy: A, today: "2026-10-31" });
  const buf = await fillTemplate(ExcelJS, tpl, mapping, data);
  const out = await loadWorkbook(ExcelJS, buf);
  const ws = out.getWorksheet("Fuel Claim");
  assert.equal(ws.getCell("C3").value, "Shafi");
  assert.equal(ws.getCell("H3").value, "October 2026");
  assert.equal(ws.getCell("C4").value, "E-104");
  assert.equal(ws.getCell("A7").value, 1);
  assert.equal(ws.getCell("B7").value.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(ws.getCell("B7").numFmt, "dd/mm/yyyy");
  assert.equal(ws.getCell("H9").value, 102);
  assert.equal(ws.getCell("H9").numFmt, "#,##0.00", "template number format kept");
  assert.ok(ws.getCell("H9").border && ws.getCell("H9").border.left, "borders kept");
  assert.equal(ws.getCell("H10").value, null, "unused rows stay blank");
  assert.equal(ws.getCell("H17").formula, "SUM(H7:H16)");
  assert.equal(ws.getCell("I8").formula, 'IF(H8>0,F8*G8,"")', "the template's row formulas stay");
  assert.ok(ws.model.merges.includes("A17:G17") && ws.model.merges.includes("A1:I1"));
  assert.equal(ws.getCell("A20").value, "Employee Signature");
  const xml = await (await JSZip.loadAsync(buf)).file("xl/workbook.xml").async("string");
  assert.match(xml, /fullCalcOnLoad="1"/, "Excel recalculates the template's totals on opening");
});

test("adds rows above the totals when there are more expenses than template rows", async () => {
  const tpl = await fuelTemplate();
  const mapping = mappingFromInspection(inspectTemplate(await loadWorkbook(ExcelJS, tpl)));
  const data = buildReportData({ expenses: fuel(14), members, category: "fuel", month: "2026-10", paidBy: A, today: "2026-10-31" });
  const out = await loadWorkbook(ExcelJS, await fillTemplate(ExcelJS, tpl, mapping, data));
  const ws = out.getWorksheet("Fuel Claim");
  assert.equal(ws.getCell("A20").value, 14, "14 rows written from row 7");
  assert.equal(ws.getCell("H20").value, 113);
  assert.ok(ws.getCell("H20").border && ws.getCell("H20").border.bottom, "new rows copy the template row's borders");
  assert.equal(ws.getCell("H20").numFmt, "#,##0.00");
  assert.equal(ws.getCell("A21").value, "Total", "totals row moved down");
  assert.ok(ws.model.merges.includes("A21:G21"), "totals merge moved with it");
  assert.ok(!ws.model.merges.includes("A17:G17"));
  assert.equal(ws.getCell("H21").formula, "SUM(H7:H20)", "total covers all 14 rows");
  assert.equal(ws.getCell("I19").formula, 'IF(H19>0,F19*G19,"")', "row formula copied down");
  assert.equal(ws.getCell("A24").value, "Employee Signature");
  assert.ok(ws.model.merges.includes("F25:H25"));
  assert.equal(ws.pageSetup.printArea, "A1:I25");
  assert.ok(ws.dataValidations.model.C19, "dropdowns extend into new rows");
  assert.ok(ws.dataValidations.model.C7);
  assert.equal(ws.conditionalFormattings[0].ref, "H7:H20");
  const img = ws.getImages()[0];
  assert.equal(img.range.tl.nativeRow, 24, "logo/signature image moved down");
  const sum = out.getWorksheet("Summary");
  assert.equal(sum.getCell("B1").formula, "'Fuel Claim'!H21", "other sheets follow the moved total");
  assert.equal(sum.getCell("B2").formula, "COUNTA('Fuel Claim'!B7:B20)");
  assert.equal(ws.getCell("C3").value, "Shafi", "cells above the table unchanged");
});

test("mapping by heading text, as written by hand", async () => {
  const tpl = await fuelTemplate();
  const mapping = { columns: { expense_date: "Date", amount: "Amount (AED)", fuel_station: "fuel station", odometer: "ODOMETER" }, cells: { C3: "employee_name" } };
  const data = buildReportData({ expenses: fuel(2), members, category: "fuel", month: "2026-10", paidBy: "", today: "2026-10-31" });
  const ws = (await loadWorkbook(ExcelJS, await fillTemplate(ExcelJS, tpl, mapping, data))).getWorksheet("Fuel Claim");
  assert.equal(ws.getCell("D7").value, "ADNOC");
  assert.equal(ws.getCell("E8").value, 120300);
  assert.equal(ws.getCell("H8").value, 101);
  assert.equal(ws.getCell("A7").value, null, "unmapped columns are not touched");
  assert.equal(ws.getCell("C3").value, "Shafi & Ahmed", "both people when the file is for both");
});

test("label cells with blanks, and templates with no ready-made rows", async () => {
  const tpl = await tollTemplate();
  const ins = inspectTemplate(await loadWorkbook(ExcelJS, tpl));
  const mapping = mappingFromInspection(ins);
  assert.deepEqual(mapping.columns, { row_number: "A", expense_date: "B", expense_time: "C", toll_gate: "D", amount: "E" });
  assert.deepEqual(mapping.cells.A1, { field: "employee_name", label: "Name: " });
  assert.equal(mapping.cells.B2, "month_label");
  assert.equal(mapping.lastDataRow, null, "no border and no totals: rows are simply written downwards");
  const exp = Array.from({ length: 30 }, (_, i) => ({ id: "t" + i, category: "toll", amount: 4, date: "2026-10-05", time: `07:${String(i).padStart(2, "0")}`, paidBy: B, createdBy: B, details: { toll_gate: "Salik – Al Safa" }, receipts: [] }));
  const data = buildReportData({ expenses: exp, members, category: "toll", month: "2026-10", paidBy: B });
  const ws = (await loadWorkbook(ExcelJS, await fillTemplate(ExcelJS, tpl, mapping, data))).getWorksheet("Salik");
  assert.equal(ws.getCell("A1").value, "Name: Ahmed");
  assert.equal(ws.getCell("B2").value, "October 2026");
  assert.equal(ws.getCell("A34").value, 30);
  assert.equal(ws.getCell("C34").value, "07:29");
  assert.equal(ws.getCell("D5").value, "Salik – Al Safa");
});

test("report values: VAT, price per litre and km since the previous fill-up", () => {
  const list = [
    { id: "1", category: "fuel", amount: 105, date: "2026-09-28", paidBy: A, details: { vehicle: "Car 1", odometer: 1000 } },
    { id: "2", category: "fuel", amount: 210, date: "2026-10-03", paidBy: A, details: { vehicle: "car 1 ", odometer: 1450, litres: 70 } },
    { id: "3", category: "fuel", amount: 50, date: "2026-10-04", paidBy: B, details: { odometer: 300 } },
    { id: "4", category: "toll", amount: 4, date: "2026-10-04", paidBy: A, details: {} }
  ];
  const d = buildReportData({ expenses: list, members, category: "fuel", month: "2026-10", today: "2026-10-31" });
  assert.equal(d.rows.length, 2);
  const r = d.rows[0];
  assert.equal(r.vat_amount, 10);
  assert.equal(r.amount_excl_vat, 200);
  assert.equal(r.price_per_litre, 3);
  assert.equal(r.odometer_previous, 1000, "previous reading comes from last month, same vehicle");
  assert.equal(r.distance_km, 450);
  assert.equal(d.rows[1].distance_km, null);
  assert.equal(d.header.total_amount, 260);
  assert.equal(d.header.employee_id, "E-104 / E-221");
  assert.equal(d.header.month_end, "2026-10-31");
});

test("plain workbook when no template is uploaded", async () => {
  const data = buildReportData({ expenses: fuel(5), members, category: "fuel", month: "2026-10", paidBy: A });
  const ws = (await loadWorkbook(ExcelJS, await buildPlainWorkbook(ExcelJS, data, DEFAULT_COLUMNS.fuel, "Fuel"))).worksheets[0];
  assert.equal(ws.getCell("A5").value, "Row number (1, 2, 3…)".replace(/ \(.*\)$/, ""));
  assert.equal(ws.getCell("B6").value.toISOString().slice(0, 10), "2026-10-01");
  const amountCol = DEFAULT_COLUMNS.fuel.indexOf("amount") + 1;
  assert.match(ws.getRow(11).getCell(amountCol).formula, /^SUM\(J6:J10\)$/);
});
