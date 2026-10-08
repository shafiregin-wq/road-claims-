// MITAK field definitions: expense categories, the extra fields each category asks for,
// and every value that can be written into a reimbursement Excel template.
//
// To add a field later (for example once the company templates arrive):
//   1. add it to DETAIL_FIELDS so it appears on the Add Expense form, and
//   2. add it to ROW_FIELDS (one value per expense row) or HEADER_FIELDS (one value per file)
//      so it can be mapped to an Excel column or cell.
// The `match` words are what MITAK looks for in a template's headings to suggest the mapping.

export const CATEGORIES = [
  { id: "fuel", label: "Fuel", emoji: "⛽", color: "#F97316", report: true },
  { id: "toll", label: "Toll", emoji: "🛣️", color: "#2563EB", report: true },
  { id: "food", label: "Food", emoji: "🍴", color: "#16A34A", report: false },
  { id: "parking", label: "Parking", emoji: "🅿️", color: "#7C3AED", report: true }
];
export const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

// Fuel with this Site / Type is a shared bill: it appears on both people's fuel forms.
export const SHARED_FUEL_SITE = "Deployment";

export const STATIONS = ["ADNOC", "ENOC", "EPPCO", "Emarat"];
export const TOLL_GATES = [
  "Salik – Al Garhoud Bridge", "Salik – Al Maktoum Bridge", "Salik – Al Barsha", "Salik – Al Safa", "Salik – Al Safa South",
  "Salik – Airport Tunnel", "Salik – Al Mamzar", "Salik – Jebel Ali", "Salik – Business Bay Crossing",
  "Darb – Sheikh Zayed Bridge", "Darb – Sheikh Khalifa Bridge", "Darb – Al Maqta Bridge", "Darb – Mussafah Bridge"
];
export const PLACES = [
  "Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah", "Al Ain", "Ruwais", "Mussafah",
  "Khalifa City", "Mohammed Bin Zayed City", "KIZAD", "Abu Dhabi Airport", "Dubai Airport", "Jebel Ali", "Dubai Marina", "Deira"
];

// Optional, category-specific fields on the Add Expense form (stored in expense.details).
// `remember: true` pre-fills the value from the same person's previous expense.
export const DETAIL_FIELDS = {
  fuel: [
    // On the fuel claim form, "Deployment" fuel is one shared car: the bill goes on both people's
    // forms and each claims half. "AEP Client Site" fuel is your own car: your form only, claimed in full.
    { key: "site_type", label: "Site / Type", type: "choice", options: ["Deployment", "AEP Client Site"], remember: true, initial: "Deployment",
      hint: { "Deployment": "Shared car: this bill goes on both your fuel forms, half claimed by each.", "AEP Client Site": "Own car: only on your fuel form, claimed in full." } },
    { key: "kms", label: "KMs travelled", unit: "km", type: "number", step: "1" },
    { key: "bill_attached", label: "Bill attached", type: "choice", options: ["Y", "N"], optionLabels: { Y: "Yes", N: "No" }, initial: "Y" },
    { key: "vehicle", label: "Vehicle", type: "text", placeholder: "e.g. Plate A 12345", remember: true },
    { key: "odometer", label: "Odometer", unit: "km", type: "number", step: "1" },
    { key: "litres", label: "Litres", type: "number", step: "0.01" },
    { key: "fuel_station", label: "Fuel station", type: "text", list: "dl-stations", placeholder: "ADNOC, ENOC, EPPCO…" },
    { key: "price_per_litre", label: "Price per litre", unit: "AED", type: "number", step: "0.01" }
  ],
  toll: [
    { key: "toll_gate", label: "Toll gate", type: "text", list: "dl-tolls", placeholder: "Salik / Darb gate" },
    { key: "vehicle", label: "Vehicle", type: "text", placeholder: "e.g. Plate A 12345", remember: true }
  ],
  parking: [
    { key: "duration", label: "Duration", type: "text", placeholder: "e.g. 2 hours" },
    { key: "vehicle", label: "Vehicle", type: "text", placeholder: "e.g. Plate A 12345", remember: true }
  ],
  food: []
};

// Extra details each member can keep in Settings, for the top of reimbursement files.
export const PROFILE_FIELDS = [
  { key: "employee_id", label: "Employee ID" },
  { key: "designation", label: "Designation" },
  { key: "department", label: "Department" },
  { key: "vehicle", label: "Usual vehicle", placeholder: "e.g. Plate A 12345" }
];

// One value per expense: these fill the rows of a template's table.
// type: "date" | "money" | "number" | "int" | "text"
export const ROW_FIELDS = [
  { key: "row_number", label: "Row number (1, 2, 3…)", type: "int", match: ["s no", "sno", "sl no", "sr no", "serial", "serial no", "no", "#", "item", "s n", "sr"] },
  { key: "expense_date", label: "Date", type: "date", match: ["date", "bill date", "receipt date", "invoice date", "transaction date", "date of expense", "expense date", "trip date"] },
  { key: "expense_time", label: "Time", type: "text", match: ["time", "transaction time"] },
  { key: "day_name", label: "Day of week", type: "text", match: ["day"] },
  { key: "category", label: "Expense type", type: "text", match: ["type", "category", "expense type", "nature of expense", "expense category"] },
  { key: "site_type", label: "Site / Type (Deployment, AEP Client Site)", type: "text", match: ["site type", "site", "site name", "type of site"] },
  { key: "amount", label: "Amount (AED)", type: "money", match: ["amount", "amount aed", "aed", "total", "total amount", "total aed", "cost", "value", "amount claimed", "claim amount", "amount paid", "bill amount", "net amount"] },
  { key: "amount_excl_vat", label: "Amount before 5% VAT", type: "money", match: ["amount before vat", "amount excl vat", "amount excluding vat", "excl vat", "taxable amount", "amount without vat"] },
  { key: "vat_amount", label: "5% VAT included in amount", type: "money", match: ["vat", "vat amount", "vat 5", "tax", "tax amount"] },
  { key: "description", label: "Description / note", type: "text", match: ["description", "details", "particulars", "remarks", "remark", "purpose", "narration", "note", "notes", "comments"] },
  { key: "location", label: "Location", type: "text", match: ["location", "place", "area", "city", "site"] },
  { key: "trip", label: "Trip", type: "text", match: ["trip", "journey", "route", "travel", "from to", "travel details"] },
  { key: "paid_by", label: "Paid by (name)", type: "text", match: ["paid by", "employee", "employee name", "name", "staff name", "claimant", "driver", "driver name"] },
  { key: "vehicle", label: "Vehicle", type: "text", match: ["vehicle", "vehicle no", "vehicle number", "plate", "plate no", "plate number", "car", "car no", "registration no", "reg no"] },
  { key: "odometer", label: "Odometer (km)", type: "int", match: ["odometer", "odometer reading", "km reading", "mileage", "meter reading", "odo", "odometer km", "current km", "closing km", "closing reading", "end km"] },
  { key: "odometer_previous", label: "Previous odometer (km)", type: "int", match: ["previous odometer", "opening km", "opening reading", "previous km", "last km", "start km", "starting km"] },
  { key: "kms_travelled", label: "KMs travelled, as text (e.g. 520 KM)", type: "text", match: ["kms travelled", "km travelled", "kilometers travelled", "kilometres travelled", "kms driven"] },
  { key: "kms", label: "KMs travelled, as a number", type: "int", match: ["kms travelled number"] },
  { key: "distance_km", label: "Km since previous fill-up", type: "int", match: ["distance", "km", "kms", "km driven", "distance km", "total km", "kilometers", "kilometres", "km travelled"] },
  { key: "litres", label: "Litres", type: "number", match: ["litres", "liters", "litre", "liter", "ltr", "ltrs", "qty", "quantity", "volume", "fuel qty", "quantity ltr"] },
  { key: "price_per_litre", label: "Price per litre (AED)", type: "money", match: ["rate", "price", "price per litre", "rate per litre", "unit price", "price ltr", "rate ltr", "per litre", "price per liter"] },
  { key: "fuel_station", label: "Fuel station", type: "text", match: ["station", "fuel station", "petrol station", "petrol pump", "filling station", "supplier", "vendor", "merchant", "company"] },
  { key: "toll_gate", label: "Toll gate", type: "text", match: ["toll gate", "gate", "toll", "salik gate", "darb gate", "toll point"] },
  { key: "duration", label: "Parking duration", type: "text", match: ["duration", "hours", "parking duration"] },
  { key: "bill_attached", label: "Bill attached (Y / N)", type: "text", match: ["bill attached y n", "bill attached", "bill y n", "bills attached"] },
  { key: "receipt", label: "Receipt photo attached (Yes / No)", type: "text", match: ["receipt", "bill", "receipt attached", "attachment", "receipt yes no"] },
  { key: "my_share", label: "Payer’s own share (AED)", type: "money", match: ["own share", "my share"] },
  { key: "other_share", label: "Colleague’s share (AED)", type: "money", match: ["colleague share", "shared amount"] },
  { key: "receipt_count", label: "Number of receipt files", type: "int", match: ["no of receipts", "receipts"] },
  { key: "added_by", label: "Added by (name)", type: "text", match: ["added by", "entered by"] }
];

// One value per file: these fill single cells, usually at the top (name, month) or bottom (total).
export const HEADER_FIELDS = [
  { key: "employee_name", label: "Employee name", type: "text", match: ["employee name", "name", "name of employee", "staff name", "claimant", "employee", "claimant name", "submitted by", "driver name"] },
  { key: "employee_name_caps", label: "Employee name in CAPITALS (for signatures)", type: "text", match: ["employee signature", "signature"] },
  { key: "employee_id", label: "Employee ID", type: "text", match: ["employee id", "emp id", "staff id", "employee no", "emp no", "staff no", "id no", "employee number", "badge no"] },
  { key: "designation", label: "Designation", type: "text", match: ["designation", "position", "job title", "title"] },
  { key: "department", label: "Department", type: "text", match: ["department", "dept", "division", "section", "cost center", "cost centre"] },
  { key: "vehicle", label: "Vehicle", type: "text", match: ["vehicle", "vehicle no", "vehicle number", "plate no", "car no", "registration no"] },
  { key: "month_label", label: "Month (e.g. October 2026)", type: "text", match: ["month", "claim month", "for the month of", "month of", "period", "claim period", "for the month"] },
  { key: "month_start", label: "First day of month", type: "date", match: ["from", "from date", "period from", "start date"] },
  { key: "month_end", label: "Last day of month", type: "date", match: ["to", "to date", "period to", "end date"] },
  { key: "signature_date", label: "Signing date (month end, or today if earlier)", type: "date", match: ["signature date", "date signed"] },
  { key: "generated_date", label: "Date the file is made", type: "date", match: ["date", "submission date", "date of submission", "report date", "claim date"] },
  { key: "total_amount", label: "Total amount (AED)", type: "money", match: ["total", "grand total", "total amount", "total aed", "amount payable", "net payable", "total claim", "total claimed"] },
  { key: "total_vat", label: "Total 5% VAT included", type: "money", match: ["total vat"] },
  { key: "expense_count", label: "Number of expenses", type: "int", match: ["no of bills", "number of bills", "no of receipts", "count"] },
  { key: "total_litres", label: "Total litres", type: "number", match: ["total litres", "total liters"] },
  { key: "total_distance", label: "Total km since previous fill-ups", type: "int", match: ["total km", "total distance"] },
  { key: "category_name", label: "Expense type (Fuel, Toll…)", type: "text", match: ["claim type", "expense type"] },
  { key: "workspace_name", label: "Workspace name", type: "text", match: [] }
];

export const ROW_FIELD = Object.fromEntries(ROW_FIELDS.map(f => [f.key, f]));
export const HEADER_FIELD = Object.fromEntries(HEADER_FIELDS.map(f => [f.key, f]));

// Columns used for the plain workbook MITAK makes when no template has been uploaded yet.
export const DEFAULT_COLUMNS = {
  fuel: ["row_number", "expense_date", "site_type", "amount", "kms_travelled", "bill_attached", "vehicle", "fuel_station", "odometer", "litres", "description", "trip"],
  toll: ["row_number", "expense_date", "expense_time", "paid_by", "toll_gate", "vehicle", "amount", "description", "trip", "receipt"],
  parking: ["row_number", "expense_date", "expense_time", "paid_by", "location", "duration", "vehicle", "amount", "description", "trip", "receipt"],
  food: ["row_number", "expense_date", "expense_time", "paid_by", "description", "location", "amount", "trip", "receipt"]
};

// Company forms built into MITAK, used until a different form is uploaded in Settings.
export const BUILTIN_TEMPLATES = {
  fuel: {
    fileName: "Fuel Expense Claim Form.xlsx",
    url: "templates/fuel-claim-form.xlsx",
    mapping: {
      version: 1,
      sheet: "Fuel Expense Claim",
      headerRow: 12,
      firstDataRow: 13,
      lastDataRow: 20,
      columns: {
        row_number: "B",
        expense_date: "C",
        site_type: "D",
        amount: "E",
        kms_travelled: "G",
        bill_attached: "H",
        description: "I"
      },
      cells: {
        C6: "employee_name",
        E6: "designation",
        C7: "employee_id",
        C25: "employee_name_caps",
        H25: { field: "signature_date", label: "Date: " }
      },
      dateFormat: "dd-mmm-yyyy",
      sort: "oldest"
    }
  }
};
