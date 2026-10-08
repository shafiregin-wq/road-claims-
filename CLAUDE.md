# MITAK — notes for Claude

Private travel-expense tracker for two colleagues (Regin and Ashkar): fuel, toll, food, parking in AED.
Static PWA on GitHub Pages (`https://shafiregin-wq.github.io/road-claims-/`) + Supabase (auth, Postgres,
storage, realtime, one Edge Function). No build step. The owner is not a developer: explain steps
in plain words, one at a time, with exact Supabase/GitHub clicks.

## How changes go live
- Work on a branch, open a PR to `main`, merge it (the owner has asked for this flow). GitHub Pages
  publishes `main` in 1–2 minutes; the app's service worker is network-first, so a reopen picks it up.
  Bump `VERSION` in `sw.js` when the list of app files changes.
- **Database changes** go in `supabase/schema.sql`, which must stay safe to re-run (`if not exists`,
  `drop policy if exists`, `create or replace`). After merging, tell the owner to run the whole file again
  in Supabase › SQL Editor (select all, delete, paste, Run). The app shows "MITAK's database needs an
  update" if they forget.
- **Edge Function** `supabase/functions/notify/index.ts` (push notifications): single file, no imports,
  deployed by pasting into Supabase › Edge Functions › notify › Code › Deploy, with "Enforce JWT
  verification" off (it checks the user itself).
- `config.js` holds the Supabase URL and publishable key (public by design). The repo is public: never
  commit personal data (the fuel form template was stripped of names/IDs and file author).

## Rules the app enforces (also in the database via RLS)
- Exactly two members; one-time invite code; sign-ups refused once both joined.
- Each person adds, edits and deletes only their own expenses and receipt files (`paid_by = auth.uid()`);
  the colleague's expenses open read-only.
- "Who owes who": per-expense split (`none` / `equal` / `custom`, `other_share` = colleague's part) and
  `settlements` (payments). Deployment fuel is NOT split automatically — they settle that outside the app.

## Fuel claim form (built in)
`templates/fuel-claim-form.xlsx`, mapping `BUILTIN_TEMPLATES.fuel` in `js/fields.js`. Site / Type:
- **Deployment** = one shared car, one bill → appears on BOTH people's forms; the form's formula claims half.
- **AEP Client Site** = own car → only on the payer's form, claimed in full.
Toll/parking/food use uploaded templates (Settings › Reimbursement templates) or a plain layout; the owner
will send the real toll/parking forms later.

## Code map
`js/app.js` start-up/auth/navigation · `js/views.js` screens · `js/expense-form.js` add/edit/read-only view ·
`js/balance.js` who owes who · `js/templates-ui.js` + `js/excel.js` Excel templates (ExcelJS, row insertion
with formula shifting) · `js/reports.js` totals, report values, balance · `js/fields.js` categories, form and
template fields · `js/data.js` Supabase and demo backends · `js/push.js` notifications · `sw.js` offline + push.

## Tests (run before every PR)
```
npm install
npm test                 # Excel engine, reports, balance, push crypto (+ LibreOffice check)
npm run test:sql         # schema.sql rules on a throwaway PostgreSQL (needs PostgreSQL 15+)
npm run test:e2e         # app in Chromium with the demo backend (Playwright)
npm run test:supabase    # app against local Supabase Auth + PostgREST (downloads binaries once)
```
`?demo` in the URL runs the app with on-device sample data (no Supabase needed).

## Related
Villa 21 (`shafiregin-wq/villa21`) is a separate flat-share app on Firebase; its push notifications are
sent through this Supabase project's Edge Function `villa-notify` (code lives in the villa21 repo).
