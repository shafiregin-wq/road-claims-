// Builds sample reimbursement templates shaped like typical company forms, for the tests and
// for trying the template feature before the real templates arrive.
import ExcelJS from "exceljs";

const thin = { style: "thin" };
const box = { top: thin, bottom: thin, left: thin, right: thin };
// 1×1 orange PNG, standing in for a company logo.
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==", "base64");

export async function fuelTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fuel Claim");
  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = "FUEL REIMBURSEMENT FORM";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("B3").value = "Employee Name:";
  ws.mergeCells("C3:E3");
  ws.getCell("G3").value = "Month:";
  ws.getCell("B4").value = "Employee ID:";
  ws.getCell("G4").value = "Vehicle No.:";
  ["S.No", "Date", "Vehicle No.", "Fuel Station", "Odometer", "Litres", "Rate", "Amount (AED)", "Check"].forEach((h, i) => {
    const c = ws.getRow(6).getCell(i + 1); c.value = h; c.font = { bold: true }; c.border = box;
  });
  for (let r = 7; r <= 16; r++) for (let c = 1; c <= 9; c++) {
    const cell = ws.getRow(r).getCell(c);
    cell.border = box;
    if (c === 8) cell.numFmt = "#,##0.00";
  }
  for (let r = 7; r <= 16; r++) ws.getCell(`I${r}`).value = { formula: `IF(H${r}>0,F${r}*G${r},"")` };
  ws.mergeCells("A17:G17");
  ws.getCell("A17").value = "Total";
  ws.getCell("H17").value = { formula: "SUM(H7:H16)" };
  ws.getCell("H17").border = box;
  ws.getCell("A20").value = "Employee Signature";
  ws.getCell("F20").value = "Approved by";
  ws.mergeCells("F21:H21");
  ws.dataValidations.add("C7:C16", { type: "list", allowBlank: true, formulae: ['"Car 1,Car 2"'] });
  ws.addConditionalFormatting({ ref: "H7:H16", rules: [{ type: "cellIs", operator: "greaterThan", formulae: ["500"], style: { font: { color: { argb: "FFFF0000" } } } }] });
  ws.pageSetup.printArea = "A1:I21";
  const img = wb.addImage({ buffer: LOGO, extension: "png" });
  ws.addImage(img, { tl: { col: 0, row: 20 }, ext: { width: 40, height: 20 } });
  const sum = wb.addWorksheet("Summary");
  sum.getCell("A1").value = "Fuel total";
  sum.getCell("B1").value = { formula: "'Fuel Claim'!H17" };
  sum.getCell("A2").value = "Rows";
  sum.getCell("B2").value = { formula: "COUNTA('Fuel Claim'!B7:B16)" };
  return wb.xlsx.writeBuffer();
}

export async function tollTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Salik");
  ws.getCell("A1").value = "Name: ______________";
  ws.getCell("A2").value = "For the month of:";
  ws.getCell("A4").value = "Sr";
  ws.getCell("B4").value = "Date";
  ws.getCell("C4").value = "Time";
  ws.getCell("D4").value = "Toll Gate";
  ws.getCell("E4").value = "Amount";
  return wb.xlsx.writeBuffer();
}
