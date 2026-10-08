// End-to-end tests in a real browser (Chromium via Playwright), using MITAK's on-device demo backend.
// Run: npm run test:e2e   (needs the `playwright` package and a Chromium it can find)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { serve, routeCdn } from "./harness.mjs";
import { fuelTemplate } from "../fixtures/make-templates.mjs";

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }

let server, url, browser, dir;
const errors = [];
before(async () => {
  ({ server, url } = await serve());
  browser = await chromium.launch();
  dir = await mkdtemp(join(tmpdir(), "mitak-e2e-"));
});
after(async () => { await browser.close(); server.close(); });

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  return page;
}
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, timezoneId: "Asia/Dubai" });
  await routeCdn(ctx);
  return ctx;
}
// Error messages appear after the async check finishes.
async function errText(page, sel) { await page.waitForSelector(`${sel}:not(:empty)`); return page.textContent(sel); }
const money = s => Number(String(s).replace(/[^0-9.]/g, ""));
async function readXlsx(download) {
  const p = join(dir, download.suggestedFilename());
  await download.saveAs(p);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(p));
  return wb;
}

test("demo: dashboard, add, edit and delete an expense", async () => {
  const ctx = await phone(); const page = await newPage(ctx);
  await page.goto(url + "?demo&latency=0");
  await page.waitForSelector(".hello");
  assert.match(await page.textContent(".hello h1"), /Hi Sami/);
  const before = money(await page.textContent(".split.strong .sum dd"));

  await page.click(".add-main");
  await page.click("[data-pick=category][data-v=fuel]");
  await page.fill("#e-amount", "125.50");
  await page.fill("#e-desc", "ADNOC Khalifa City");
  assert.equal(await page.inputValue("#d-vehicle"), "Plate A 12345", "vehicle remembered from the last fuel expense");
  await page.fill("#d-litres", "44");
  await page.fill("#d-odometer", "85000");
  assert.match(await page.textContent("#e-calc"), /2\.85 per litre/);
  await page.setInputFiles("[data-file][multiple]", { name: "receipt.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==", "base64") });
  await page.waitForSelector(".thumb img");
  await page.click("[data-x=save]");
  await page.waitForSelector(".toast >> text=Expense added successfully.");
  await page.waitForSelector("[data-testid=expense-sheet]", { state: "detached" });
  assert.equal(money(await page.textContent(".split.strong .sum dd")), +(before + 125.5).toFixed(2), "month total updated");
  const row = page.locator(".xlist .xrow", { hasText: "ADNOC Khalifa City" });
  assert.match(await row.textContent(), /AED 125\.50/);

  // Edit: the receipt is there, change the amount.
  await row.click();
  await page.waitForSelector(".thumb img[src]");
  await page.fill("#e-amount", "130");
  await page.click("[data-x=save]");
  await page.waitForSelector(".toast >> text=Expense updated.");
  assert.match(await row.textContent(), /AED 130\.00/);

  // Delete: cancel first, then confirm.
  await row.click();
  await page.click("[data-x=delete]");
  assert.equal(await page.textContent(".dialog-q"), "Delete this expense?");
  await page.click(".dialog [data-v='0']");
  assert.ok(await page.isVisible("[data-testid=expense-sheet]"), "cancel keeps the expense");
  await page.click("[data-x=delete]");
  await page.click(".dialog [data-v='1']");
  await page.waitForSelector(".toast >> text=Expense deleted.");
  assert.equal(money(await page.textContent(".split.strong .sum dd")), before);

  // Validation
  await page.click(".add-main");
  await page.click("[data-x=save]");
  assert.match(await errText(page, "#e-err"), /Choose the expense type/);
  await page.click("[data-pick=category][data-v=toll]");
  await page.click("[data-x=save]");
  assert.match(await errText(page, "#e-err"), /Enter the amount/);
  await ctx.close();
});

test("demo: calendar day details, filters and monthly summary agree", async () => {
  const ctx = await phone(); const page = await newPage(ctx);
  await page.goto(url + "?demo&latency=0#calendar");
  await page.waitForSelector(".cal-grid");
  const day = page.locator(".cal-cell.has").first();
  const cellAmount = Number((await day.locator(".cal-amt").textContent()).replace(/,/g, ""));
  await day.click();
  const panel = page.locator("[data-testid=day-panel]");
  const total = money(await panel.locator(".total-pill").textContent());
  assert.equal(Math.round(total), cellAmount, "day cell shows the day's total");
  const people = await panel.locator(".split dd").allTextContents();
  assert.equal(+(people.map(money).reduce((a, b) => a + b, 0)).toFixed(2), total, "the two people add up to the day's total");
  const rows = await panel.locator(".xrow .money").allTextContents();
  assert.equal(+(rows.map(money).reduce((a, b) => a + b, 0)).toFixed(2), total, "listed expenses add up");

  // Expenses page: fuel only, paid by me
  await page.click(".tab[data-to=expenses]");
  const all = money(await page.textContent(".list-head .money"));
  await page.click("[data-act=xf-cat][data-v=fuel]");
  await page.click("[data-act=xf-user]:has-text('Me')");
  const titles = await page.locator(".xrow .xtitle").allTextContents();
  assert.ok(titles.length && titles.every(t => t.startsWith("Fuel")));
  const subs = await page.locator(".xrow .xsub").allTextContents();
  assert.ok(subs.every(s => s.startsWith("Me")));
  await page.selectOption("#xf-sort", "oldest");
  const dates = await page.locator(".xrow .xsub").allTextContents();
  assert.ok(dates.length > 1);

  // Monthly summary total = everything this month
  await page.click(".tab[data-to=summary]");
  assert.equal(money(await page.textContent("[data-testid=summary-total]")), all);
  const cats = await page.locator(".bars .as-btn .money").allTextContents();
  assert.equal(+(cats.map(money).reduce((a, b) => a + b, 0)).toFixed(2), all, "types add up to the total");
  await page.click(".trip-row >> nth=0");
  assert.ok(await page.isVisible(".trip-filter"), "tapping a trip filters the expenses");
  await ctx.close();
});

test("demo: Excel reports, with and without the company template", async () => {
  const ctx = await phone(); const page = await newPage(ctx);
  await page.goto(url + "?demo&latency=0#reports");
  await page.waitForSelector("[data-testid=report-fuel]");
  assert.equal(await page.getAttribute("[data-act=rep-who][aria-pressed=true]", "data-v") !== "", true, "reports start with only my expenses");
  await page.click("[data-act=rep-who]:has-text('Both of us')");
  const fuelTotal = money(await page.textContent("[data-testid=report-fuel] .report-total .money"));
  await page.click("[data-act=rep-who]:has-text('Only mine')");
  assert.match(await page.textContent("[data-testid=report-fuel]"), /Form: Fuel Expense Claim Form/);
  assert.match(await page.textContent("[data-testid=report-fuel]"), /Claimable: AED [\d,.]+/);

  // Fuel: the company's fuel claim form, built in
  await page.click("[data-testid=report-fuel] [data-act=generate]");
  await page.waitForSelector("[data-save]");
  let [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-save]")]);
  assert.match(dl.suggestedFilename(), /^MITAK_Fuel_[A-Z][a-z]+_\d{4}_Sami\.xlsx$/);
  let ws = (await readXlsx(dl)).getWorksheet("Fuel Expense Claim");
  assert.equal(ws.getCell("B2").value, "FUEL EXPENSE CLAIM FORM");
  assert.equal(ws.getCell("C6").value, "Sami");
  assert.equal(ws.getCell("B13").value, 1);
  assert.ok(["Deployment", "AEP Client Site"].includes(ws.getCell("D13").value));
  assert.match(String(ws.getCell("G13").value), /^\d+ KM$/);
  assert.equal(ws.getCell("H13").value, "Y");
  await page.click(".sheet [data-close]");

  // Toll has no form: MITAK's simple layout
  await page.click("[data-testid=report-toll] [data-act=generate]");
  await page.waitForSelector("[data-save]");
  [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-save]")]);
  ws = (await readXlsx(dl)).worksheets[0];
  assert.match(String(ws.getCell("A1").value), /Toll reimbursement/);
  await page.click(".sheet [data-close]");

  // Upload the company template from Settings
  const tplPath = join(dir, "Fuel claim form.xlsx");
  await writeFile(tplPath, Buffer.from(await fuelTemplate()));
  await page.click("#gear");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-act=tpl-upload][data-cat=fuel]")]);
  await chooser.setFiles(tplPath);
  await page.waitForSelector("[data-testid=mapping-sheet]");
  assert.equal(await page.inputValue("#m-head"), "6");
  assert.equal(await page.inputValue("#m-first"), "7");
  assert.equal(await page.inputValue("#m-last"), "16");
  assert.equal(await page.inputValue("select[data-col=H]"), "amount");
  assert.equal(await page.inputValue("select[data-cell=C3]"), "employee_name");
  await page.selectOption("select[data-col=I]", "receipt");
  await page.click("[data-x=save]");
  await page.waitForSelector(".toast >> text=Mapping saved.");
  assert.match(await page.textContent("[data-testid=tpl-fuel]"), /Fuel claim form\.xlsx · 9 columns mapped/);

  // Generate for "only mine": the template is filled in place
  await page.click(".tab[data-to=reports]");
  const mine = money(await page.textContent("[data-testid=report-fuel] .report-total .money"));
  assert.ok(mine > 0 && mine < fuelTotal);
  await page.click("[data-testid=report-fuel] [data-act=generate]");
  await page.waitForSelector("[data-save]");
  [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-save]")]);
  assert.match(dl.suggestedFilename(), /_Sami\.xlsx$/);
  ws = (await readXlsx(dl)).getWorksheet("Fuel Claim");
  assert.equal(ws.getCell("A1").value, "FUEL REIMBURSEMENT FORM");
  assert.equal(ws.getCell("C3").value, "Sami");
  assert.equal(ws.getCell("A7").value, 1);
  assert.equal(ws.getCell("C7").value, "Plate A 12345");
  let sum = 0;
  for (let r = 7; r < 40 && typeof ws.getCell(`H${r}`).value === "number"; r++) sum += ws.getCell(`H${r}`).value;
  assert.equal(+sum.toFixed(2), mine, "every one of my fuel expenses is in the file");
  await ctx.close();
});

test("demo: only your own expenses can be changed; splits and payments add up", async () => {
  const ctx = await phone(); const page = await newPage(ctx);
  await page.goto(url + "?demo&latency=0");
  await page.waitForSelector("[data-testid=balance-card]");
  const net = async () => { const el = page.locator("[data-testid=balance-card] .owe-amt"); const v = money(await el.textContent()); return (await el.getAttribute("class")).includes("neg") ? -v : v; };
  const before = await net();

  // Omar's expense opens read-only for Sami.
  await page.click(".tab[data-to=expenses]");
  await page.click("[data-act=xf-user]:has-text('Omar')");
  await page.locator(".xrow").first().click();
  await page.waitForSelector("[data-testid=expense-view]");
  assert.match(await page.textContent("[data-testid=expense-view]"), /Only Omar can change or delete this expense/);
  assert.equal(await page.locator("[data-testid=expense-view] [data-x=save], [data-testid=expense-view] [data-x=delete]").count(), 0);
  await page.click(".sheet [data-close]");

  // Food for 60, of which 40 is Omar's.
  await page.click("#fab");
  assert.equal(await page.locator("[data-pick=paidBy]").count(), 0, "no choosing someone else as the payer");
  await page.click("[data-pick=category][data-v=food]");
  await page.fill("#e-amount", "60");
  await page.click("[data-split=custom]");
  await page.fill("#e-theirs", "40");
  assert.equal(await page.inputValue("#e-mine"), "20");
  assert.match(await page.textContent("#e-split-hint"), /Omar owes you AED 40\.00/);
  await page.click("[data-x=save]");
  await page.waitForSelector(".toast >> text=Expense added successfully.");
  await page.click(".tab[data-to=home]");
  assert.equal(await net(), +(before + 40).toFixed(2));

  // Deployment fuel goes on both fuel forms, but doesn't create a debt (that's settled outside the app).
  await page.click(".add-main");
  await page.click("[data-pick=category][data-v=fuel]");
  assert.equal(await page.getAttribute("[data-detail=site_type][data-v='AEP Client Site']", "aria-pressed"), "true", "remembers Sami's last fuel (a client site)");
  await page.click("[data-detail=site_type][data-v=Deployment]");
  assert.match(await page.textContent("[data-testid=expense-sheet]"), /this bill goes on both your fuel forms/);
  assert.equal(await page.getAttribute("[data-split=none]", "aria-pressed"), "true", "not split in the app");
  await page.click(".sheet [data-close]");

  // Omar pays 40 back.
  await page.click("[data-act=record-payment]");
  await page.click("[data-dir=them-to-me]");
  await page.fill("#p-amount", "40");
  await page.fill("#p-note", "Cash");
  await page.click("[data-testid=payment-sheet] [data-x=save]");
  await page.waitForSelector(".toast >> text=Payment recorded.");
  assert.equal(await net(), before);
  await page.click("[data-act=open-balance]");
  assert.match(await page.textContent("[data-testid=balance-sheet]"), /Omar paid you · Cash/);
  assert.ok(await page.locator("[data-testid=balance-sheet] [data-open]").count() > 0, "shared expenses are listed");
  await ctx.close();
});

test("two people: sign up, create the workspace, invite, join, share expenses; nobody else can join", async () => {
  const ctx = await phone();
  const a = await newPage(ctx);
  await a.goto(url + "?demo=empty&latency=0");
  await a.click("[data-act=auth-mode][data-m=signup]");
  await a.fill("#a-email", "first@example.com");
  await a.fill("#a-pass", "short");
  await a.click("#auth-form [type=submit]");
  assert.match(await errText(a, "#auth-form .err"), /at least 8/);
  await a.fill("#a-email", "first@example.com");
  await a.fill("#a-pass", "a-good-password");
  await a.click("#auth-form [type=submit]");
  await a.waitForSelector("#onboard-form");
  await a.click("[data-act=create-ws]");
  assert.match(await errText(a, "#onboard-form .err"), /Enter your name/);
  await a.fill("#o-name", "Shafi");
  await a.click("[data-act=create-ws]");
  const code = (await a.textContent("[data-testid=invite-code-sheet]")).trim();
  assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  await a.click(".sheet [data-close]");
  assert.match(await a.textContent("[data-testid=invite-code]"), new RegExp(code));
  await a.click(".add-main");
  await a.click("[data-pick=category][data-v=toll]");
  await a.fill("#e-amount", "4");
  await a.click("[data-x=save]");
  await a.waitForSelector(".toast >> text=Expense added successfully.");

  // The colleague, in another tab, follows the invite link.
  const b = await newPage(ctx);
  await b.goto(url + "?invite=" + code.replace(/-/g, "") + "&demo=empty&latency=0");
  await signOutIfNeeded(b);
  await b.click("[data-act=auth-mode][data-m=signup]");
  assert.match(await b.textContent(".gate"), /invited to MITAK/);
  await b.fill("#a-email", "second@example.com");
  await b.fill("#a-pass", "another-password");
  await b.click("#auth-form [type=submit]");
  await b.waitForSelector("#onboard-form");
  assert.equal(await b.inputValue("#o-code"), code, "invite code filled in from the link");
  assert.equal(await b.isVisible("[data-act=create-ws]"), false, "invited people only see Join");
  await b.fill("#o-name", "Ahmed");
  await b.fill("#o-code", "0000-0000-0000");
  await b.click("#onboard-form [type=submit]");
  assert.match(await errText(b, "#onboard-form .err"), /isn’t right/);
  await b.fill("#o-code", code.toLowerCase());
  await b.click("#onboard-form [type=submit]");
  await b.waitForSelector(".hello");
  assert.match(await b.textContent(".split.strong"), /Shafi’s spending\s*AED 4\.00/);
  await b.click(".add-main");
  await b.click("[data-pick=category][data-v=food]");
  await b.fill("#e-amount", "45");
  await b.click("[data-x=save]");
  await b.waitForSelector(".toast >> text=Expense added successfully.");

  // The first tab sees the colleague's expense without reloading.
  await a.waitForFunction(() => /Ahmed’s spending\s*AED 45\.00/.test(document.querySelector(".split.strong").textContent), null, { timeout: 5000 });
  assert.equal(await a.isVisible("[data-testid=invite-code]"), false, "invite disappears once the colleague joined");

  // A third person can't create an account any more, or reuse the code.
  const c = await newPage(ctx);
  await c.goto(url + "?invite=" + code + "&demo=empty&latency=0");
  await signOutIfNeeded(c);
  await c.click("[data-act=auth-mode][data-m=signup]");
  await c.fill("#a-email", "third@example.com");
  await c.fill("#a-pass", "third-password");
  await c.click("#auth-form [type=submit]");
  assert.match(await errText(c, "#auth-form .err"), /already has its two members/);
  await ctx.close();
});

async function signOutIfNeeded(p) {
  await p.waitForSelector(".gate, .hello");
  if (await p.isVisible(".hello")) {
    await p.click("#gear");
    await p.click("[data-act=sign-out]");
    await p.click(".dialog [data-v='1']");
    await p.waitForSelector(".gate");
  }
}

test("no console errors", () => { assert.deepEqual(errors, []); });
