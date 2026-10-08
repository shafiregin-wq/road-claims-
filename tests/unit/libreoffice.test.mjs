// Opens a filled template in LibreOffice (when installed) to prove the file is valid and that the
// template's own total formula is recalculated over the inserted rows.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { fillTemplate, inspectTemplate, mappingFromInspection, loadWorkbook } from "../../js/excel.js";
import { buildReportData } from "../../js/reports.js";
import { fuelTemplate } from "../fixtures/make-templates.mjs";

const soffice = ["/usr/bin/soffice", "/usr/local/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].find(existsSync);

test("filled file opens in LibreOffice and the total recalculates", { skip: !soffice && "LibreOffice not installed", timeout: 120000 }, async () => {
  const tpl = await fuelTemplate();
  const mapping = mappingFromInspection(inspectTemplate(await loadWorkbook(ExcelJS, tpl)));
  const expenses = Array.from({ length: 14 }, (_, i) => ({ id: "e" + i, category: "fuel", amount: 100 + i, date: `2026-10-${String(i + 1).padStart(2, "0")}`, paidBy: "a", details: { litres: 10, price_per_litre: 2 }, receipts: [] }));
  const data = buildReportData({ expenses, members: [{ userId: "a", displayName: "Shafi", profile: {} }], category: "fuel", month: "2026-10", paidBy: "a" });
  const dir = mkdtempSync(join(tmpdir(), "mitak-lo-"));
  writeFileSync(join(dir, "filled.xlsx"), Buffer.from(await fillTemplate(ExcelJS, tpl, mapping, data)));
  execFileSync(soffice, ["--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,1", "--outdir", dir, join(dir, "filled.xlsx")], { stdio: "ignore", env: { ...process.env, HOME: dir } });
  const csv = readFileSync(join(dir, "filled-Fuel Claim.csv"), "utf8").split(/\r?\n/);
  const total = csv.find(l => l.startsWith("Total"));
  assert.ok(total, "totals row present");
  assert.match(total, /1,?491/, `total of the 14 amounts (100…113) is 1,491: ${total}`);
  assert.match(csv[19], /^14,/, "14th expense on row 20");
  assert.match(csv[19], /,20$/, `row formula (litres × rate) recalculated on a new row: ${csv[19]}`);
});
