# MITAK

Private, shared travel-expense tracking for two colleagues: **fuel, toll, food and parking**, in AED.
Each person records their own expenses; both see their own, their colleague's and the combined totals,
and MITAK fills in the company's reimbursement Excel forms at the end of the month.

**First time? See [SETUP.md](SETUP.md).** To try it without setting anything up, open the app with
`?demo` at the end of the address (sample data, this device only).

## What's in it

| Screen | |
| --- | --- |
| **Home** | Today and this month: my spending, my colleague's, the total; the four types this month; recent expenses; a big **Add Expense** button. |
| **Who owes who** | Mark an expense as shared (half each, or a custom split such as 20 / 40) and the other person owes you their part. Home shows the balance (“Ashkar owes you AED 40”); record payments to settle up. |
| **Add Expense** | Type, amount, date (today), time, paid by (me), note, receipt photo or PDF. Fuel asks optionally for vehicle, odometer, litres, station and price per litre. An optional trip name (e.g. *Abu Dhabi → Dubai*) groups expenses of a journey, whoever paid. |
| **Calendar** | Each day's total, days with spending highlighted; tap a day for both people's totals and its expenses. |
| **Expenses** | Everything, filtered by month, date, person and type, newest or oldest first. Tap to edit or delete (with confirmation). |
| **Summary** | A month's total, number of expenses, split by person, by type, and by trip (marked *Together* when both paid). |
| **Reports** | Per month and type: total and **Generate Excel**, for both of you or one person, filled into the uploaded company template. |
| **Settings** | Your name and details for the forms, notifications, the invite code, reimbursement templates and their field mapping, account. |
| **Notifications** | When one of you adds an expense, the other's phone gets a notification (“Shafi added an expense: ⛽ Fuel · AED 150.00”). |

Each person adds, changes and deletes only their own expenses; the colleague's expenses are visible
but read-only. Fuel reports fill in the company's fuel claim form (built in), with Site / Type
(Deployment = half claimed, AEP Client Site = full), KMs travelled and Bill attached.

Privacy: one closed workspace for exactly two people. The first person creates it and gets a one-time
invite code; once the colleague joins, the code is gone and new sign-ups are refused. Every row and file is
protected by database row-level security so only the two members can read it. There are no profiles,
feeds, search or sharing features.

## How it's built

A static web app (installable on the phone's home screen, works with GitHub Pages) with
[Supabase](https://supabase.com) for sign-in, the database, receipt storage and live updates. No build step.

```
index.html, app.css, config.js   app shell, styles, Supabase connection settings
js/app.js            start-up, sign-in, workspace set-up, navigation
js/views.js          Home, Calendar, Expenses, Summary, Reports, Settings
js/expense-form.js   add / edit / delete an expense
js/templates-ui.js   template upload, mapping editor, Excel generation
js/excel.js          template engine (fills .xlsx forms, inserts rows safely)
js/reports.js        totals and the values written into Excel
js/fields.js         categories, form fields and template fields: edit here to add fields
js/data.js           Supabase backend and the on-device demo backend
js/push.js           turning notifications on/off, notifying the colleague
js/balance.js        who owes who: shared expenses and payments
templates/fuel-claim-form.xlsx   the company fuel claim form used for fuel reports
supabase/schema.sql  tables, privacy rules, invite functions, storage bucket, notification phones
supabase/functions/notify/index.ts   Edge Function that sends the notifications (Web Push)
docs/TEMPLATES.md    how templates and mappings work
sw.js, manifest.webmanifest, icon-*.png   installable app, offline start
```

## Tests

```
npm install
npm test                # Excel engine, report values, notification encryption (+ LibreOffice check)
npm run test:sql        # schema.sql privacy rules on a throwaway PostgreSQL
npm run test:e2e        # the app in Chromium with the demo backend; a push shown as a notification
npm run test:supabase   # the app against local Supabase Auth + PostgREST + PostgreSQL, incl. notifications
```

The browser tests use Playwright's Chromium. `test:sql` and `test:supabase` need PostgreSQL 15+ installed;
`test:supabase` downloads PostgREST and Supabase Auth on first run.
