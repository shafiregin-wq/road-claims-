# Reimbursement templates

MITAK fills in the company's own Excel forms instead of making its own report. Upload one template
per expense type in **Settings › Reimbursement templates**; MITAK stores it in the shared workspace, so
both of you use the same form.

## The built-in fuel claim form

`templates/fuel-claim-form.xlsx` is the company's fuel expense claim form with the sample rows and
personal details removed. Its mapping is `BUILTIN_TEMPLATES.fuel` in [`js/fields.js`](../js/fields.js):
name, designation and employee ID at the top, rows from 13 (S.No, Date, Site / Type, Full Fuel Amount,
KMs Travelled, Bill Attached, Remarks), the signature name and date at the bottom. The Reimbursable
Amount column and the totals stay formulas. With more than 8 fuel expenses, rows are added above the
total. Uploading another fuel form in Settings replaces it.

## What MITAK changes in a template

Only the cells in the mapping. Everything else (logo, headings, borders, column widths, merged cells,
formulas, dropdowns, print area) is kept. In particular:

- **Rows of the table** are written from the *first expense row* downwards, one expense per row.
- **More expenses than ready rows?** MITAK inserts rows just above the totals, copies the last ready row's
  formatting and row formulas, and moves everything below down: the totals row, signature lines, images,
  merged cells and dropdowns. Formulas like `SUM(H7:H16)` grow to cover the new rows, and references from
  other sheets follow.
- **Totals and other formulas** in the template are recalculated by Excel when the file is opened.
- **Single cells** (name, employee ID, month, total…) are written where the mapping says.
- Dates use the template cell's date format, or `dd/mm/yyyy` if the cell has none. Amounts keep the cell's
  number format (`#,##0.00` if none).

Use `.xlsx` files. An old `.xls` must be saved as `.xlsx` in Excel first. Macros (`.xlsm`) are not kept.

## The mapping

When a template is uploaded, MITAK looks for the row of column headings (`Date`, `Amount`, `Station`,
`Odometer`…), the ready-made rows under it (until a *Total* row, a signature line, or the end of the
bordered table), and labels such as `Employee Name:` or `Month:` with an empty cell beside them. The
suggestion opens in an editor where each column and cell can be changed. **Try with …** makes a test file
from the selected month's real data.

The mapping is saved as JSON and can also be edited directly (**Advanced: edit as text**):

```json
{
  "sheet": "Fuel Claim",
  "headerRow": 6,
  "firstDataRow": 7,
  "lastDataRow": 16,
  "columns": {
    "row_number": "A",
    "expense_date": "B",
    "vehicle": "C",
    "fuel_station": "D",
    "odometer": "E",
    "litres": "F",
    "price_per_litre": "G",
    "amount": "H"
  },
  "cells": {
    "C3": "employee_name",
    "H3": "month_label",
    "C4": "employee_id",
    "A1": { "field": "employee_name", "label": "Name: " }
  },
  "sort": "oldest"
}
```

| Key | Meaning |
| --- | --- |
| `sheet` | Sheet name. Empty: the first visible sheet. |
| `headerRow` | Row with the column headings. Empty: found automatically. |
| `firstDataRow` | First row for expenses. Empty: the row under the headings. |
| `lastDataRow` | Last ready-made row. More expenses insert rows above the totals. Empty: no limit, rows are written downwards. |
| `columns` | MITAK field → column letter (`"B"`) or heading text (`"Amount (AED)"`). Heading text is matched ignoring case and punctuation; use `{ "header": "KM" }` for a heading that looks like a column letter. |
| `cells` | Cell → MITAK value for the whole file. `{ "field": …, "label": "Name: " }` keeps a label in front of the value, for cells like `Name: ________`. |
| `sort` | `"oldest"` (default) or `"newest"` first. |

A mapping written by hand can be as short as the example in the original brief:

```json
{ "columns": { "expense_date": "Date", "amount": "Amount", "fuel_station": "Station", "odometer": "Odometer" } }
```

## Values for columns (one per expense)

| Field | Value | Headings it recognises |
| --- | --- | --- |
| `row_number` | Row number (1, 2, 3…) | “s no”, “sno”, “sl no”, “sr no”, “serial”, “serial no” |
| `expense_date` | Date | “date”, “bill date”, “receipt date”, “invoice date”, “transaction date”, “date of expense” |
| `expense_time` | Time | “time”, “transaction time” |
| `day_name` | Day of week | “day” |
| `category` | Expense type | “type”, “category”, “expense type”, “nature of expense”, “expense category” |
| `amount` | Amount (AED) | “amount”, “amount aed”, “aed”, “total”, “total amount”, “total aed” |
| `amount_excl_vat` | Amount before 5% VAT | “amount before vat”, “amount excl vat”, “amount excluding vat”, “excl vat”, “taxable amount”, “amount without vat” |
| `vat_amount` | 5% VAT included in amount | “vat”, “vat amount”, “vat 5”, “tax”, “tax amount” |
| `description` | Description / note | “description”, “details”, “particulars”, “remarks”, “remark”, “purpose” |
| `location` | Location | “location”, “place”, “area”, “city”, “site” |
| `trip` | Trip | “trip”, “journey”, “route”, “travel”, “from to”, “travel details” |
| `paid_by` | Paid by (name) | “paid by”, “employee”, “employee name”, “name”, “staff name”, “claimant” |
| `vehicle` | Vehicle | “vehicle”, “vehicle no”, “vehicle number”, “plate”, “plate no”, “plate number” |
| `odometer` | Odometer (km) | “odometer”, “odometer reading”, “km reading”, “mileage”, “meter reading”, “odo” |
| `odometer_previous` | Previous odometer (km) | “previous odometer”, “opening km”, “opening reading”, “previous km”, “last km”, “start km” |
| `distance_km` | Km since previous fill-up | “distance”, “km”, “kms”, “km driven”, “distance km”, “total km” |
| `litres` | Litres | “litres”, “liters”, “litre”, “liter”, “ltr”, “ltrs” |
| `price_per_litre` | Price per litre (AED) | “rate”, “price”, “price per litre”, “rate per litre”, “unit price”, “price ltr” |
| `fuel_station` | Fuel station | “station”, “fuel station”, “petrol station”, “petrol pump”, “filling station”, “supplier” |
| `toll_gate` | Toll gate | “toll gate”, “gate”, “toll”, “salik gate”, “darb gate”, “toll point” |
| `duration` | Parking duration | “duration”, “hours”, “parking duration” |
| `receipt` | Receipt attached (Yes / No) | “receipt”, “bill”, “receipt attached”, “bill attached”, “attachment”, “receipt yes no” |
| `receipt_count` | Number of receipt files | “no of receipts”, “receipts” |
| `added_by` | Added by (name) | “added by”, “entered by” |

Fuel's *previous odometer* and *km since previous fill-up* come from the same vehicle's previous fuel
expense (any month), or the same person's when no vehicle is entered. *VAT* assumes the amount includes
the UAE's 5% VAT.

## Values for single cells (one per file)

| Field | Value | Labels it recognises |
| --- | --- | --- |
| `employee_name` | Employee name | “employee name”, “name”, “name of employee”, “staff name”, “claimant”, “employee” |
| `employee_id` | Employee ID | “employee id”, “emp id”, “staff id”, “employee no”, “emp no”, “staff no” |
| `designation` | Designation | “designation”, “position”, “job title”, “title” |
| `department` | Department | “department”, “dept”, “division”, “section”, “cost center”, “cost centre” |
| `vehicle` | Vehicle | “vehicle”, “vehicle no”, “vehicle number”, “plate no”, “car no”, “registration no” |
| `month_label` | Month (e.g. October 2026) | “month”, “claim month”, “for the month of”, “month of”, “period”, “claim period” |
| `month_start` | First day of month | “from”, “from date”, “period from”, “start date” |
| `month_end` | Last day of month | “to”, “to date”, “period to”, “end date” |
| `generated_date` | Date the file is made | “date”, “submission date”, “date of submission”, “report date”, “claim date” |
| `total_amount` | Total amount (AED) | “total”, “grand total”, “total amount”, “total aed”, “amount payable”, “net payable” |
| `total_vat` | Total 5% VAT included | “total vat” |
| `expense_count` | Number of expenses | “no of bills”, “number of bills”, “no of receipts”, “count” |
| `total_litres` | Total litres | “total litres”, “total liters” |
| `total_distance` | Total km since previous fill-ups | “total km”, “total distance” |
| `category_name` | Expense type (Fuel, Toll…) | “claim type”, “expense type” |
| `workspace_name` | Workspace name |  |

Name, employee ID, designation, department and vehicle come from each person's **Settings › Your
details**. When the file is for both people, both names are written (`Sami & Omar`).

## Adding a field

Fields are defined in [`js/fields.js`](../js/fields.js):

1. To ask for something new on the Add Expense form, add it to `DETAIL_FIELDS` for that category.
2. To make it available in templates, add it to `ROW_FIELDS` or `HEADER_FIELDS`, with `match` words for
   the headings it should be recognised by, and give it its value in `buildReportData` in
   [`js/reports.js`](../js/reports.js).
