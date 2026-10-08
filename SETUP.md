# Setting up MITAK

About 10–15 minutes, done once by whoever looks after the app. You need:

- the GitHub repository with this code (already hosted with GitHub Pages, like Road Claims was), and
- a free [Supabase](https://supabase.com) account. Supabase stores your shared expenses, logins and receipt photos.

> **Moving from Road Claims?** Road Claims kept its data only on your phone. MITAK replaces it at the same web address, so **before you publish MITAK, open Road Claims and save a backup** (Settings › Save backup). Your old claims stay in that backup file.

## 1. Create the Supabase project

1. Sign in at supabase.com and choose **New project**.
2. Name it `MITAK`, set a strong database password (keep it somewhere safe), and pick the region closest to the UAE.
3. Wait a minute or two while the project starts.

## 2. Create MITAK's tables and privacy rules

1. In the project, open **SQL Editor** › **New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql) from this repository, copy all of it, paste it into the editor and press **Run**.
3. It should finish with “Success. No rows returned”.

This creates the expense tables, a private storage folder for receipts and templates, and the rules that let only the two members see anything. It's safe to run again later after an update.

## 3. Sign-in settings

In **Authentication**:

1. **URL Configuration** › **Site URL**: your app's address, for example `https://your-github-name.github.io/road-claims-/`. Add the same address under **Redirect URLs**.
   (Confirmation and password-reset emails send people back here.)
2. **Sign In / Providers** › **Email**: keep it enabled. Leaving **Confirm email** on is recommended: each of you confirms your address once.

## 4. Connect the app

1. In Supabase open **Project Settings** › **API** (on newer projects: **API Keys**) and copy:
   - the **Project URL**, like `https://abcdefghijkl.supabase.co`
   - the **anon / public** key (newer projects call it the **publishable** key).
2. In GitHub, open [`config.js`](config.js), press the pencil (edit) button and paste both values:

   ```js
   window.MITAK_CONFIG = {
     supabaseUrl: "https://abcdefghijkl.supabase.co",
     supabaseAnonKey: "eyJhbGciOi…"
   };
   ```

3. **Commit changes.** GitHub Pages publishes the update within a minute or two.

The anon/publishable key is meant to be public; the database rules protect the data. **Never** put the `service_role` / secret key in `config.js`.

If GitHub Pages isn't on yet: repository **Settings** › **Pages** › *Deploy from a branch* › `main`, folder `/ (root)`.

## 5. Start using it

**First person**
1. Open the app address on your phone (Safari on iPhone).
2. **Create account** with your email and a password (8+ characters). Confirm the email if asked, then sign in.
3. Enter your name and tap **Create the MITAK workspace**.
4. Tap **Share invite** and send it to your colleague (WhatsApp, email…). The code is also on the Home screen until they join.

**Second person**
1. Open the invite link, **Create account**, confirm the email, and sign in.
2. Enter your name; the invite code is already filled in. Tap **Join with this code**.

From then on the workspace is closed: the code no longer works and nobody else can create an account.

**Install it like an app:** in Safari tap **Share** › **Add to Home Screen**.

## 6. Reimbursement templates

**Fuel** already uses the company's fuel claim form (built in): Reports › Fuel › **Generate Excel**
fills in your name, designation and employee ID (from Settings › Your details), one row per fuel
expense with Site / Type, amount, KMs travelled and Bill attached, and the form's own formulas work out
the reimbursable amount (half for Deployment, full for AEP Client Site) and the total.

For the other types, when you have the company's Excel forms:

1. **Settings** › **Reimbursement templates** › **Upload** next to Fuel, Toll or Parking (Food too, if there's a form for it).
2. MITAK finds the table of headings and suggests where each value goes. Check the columns, change any that are wrong, and **Save mapping**. **Try with …** makes a test file from the current month so you can open it in Excel and check.
3. Each month: **Reports** › choose the month › **Generate Excel** › Download.

Until a template is uploaded, **Generate Excel** makes a simple MITAK layout instead. See [docs/TEMPLATES.md](docs/TEMPLATES.md) for the details of the mapping.

## 7. Notifications

MITAK can notify one of you when the other adds an expense. It needs one small server program in
Supabase, which you add once:

1. Run [`supabase/schema.sql`](supabase/schema.sql) again in the **SQL Editor** (it adds the tables
   for notifications; running it again is safe).
2. In Supabase open **Edge Functions** › **Deploy a new function** › **Via Editor**.
3. Name it exactly `notify`. Delete the example code, paste the whole of
   [`supabase/functions/notify/index.ts`](supabase/functions/notify/index.ts), and press **Deploy**.
4. Open the function's **Details** (or settings), turn **off** “Enforce JWT verification” (sometimes
   called “Verify JWT”), and save. The function checks who is signed in itself.

Then each of you, on your own phone:

- **iPhone:** notifications only work from the Home Screen app (iOS 16.4 or later). In Safari tap
  **Share** › **Add to Home Screen**, open MITAK from the Home Screen, then **Settings** ›
  **Notifications** › **Turn on notifications** and allow them.
- **Android:** open MITAK in Chrome (or the installed app) › **Settings** › **Turn on notifications**.

**Send a test** in the same place checks that it works. A notification appears for the other person
each time one of you adds an expense (not for edits or deletions).

## Updating MITAK

When an update changes the database (the release notes say so), run
[`supabase/schema.sql`](supabase/schema.sql) again in the **SQL Editor**: select all, delete, paste the new
file, **Run**. Your data stays. If the update changes the notification function, open **Edge Functions** ›
`notify` › **Code**, replace it with the new
[`supabase/functions/notify/index.ts`](supabase/functions/notify/index.ts) and **Deploy**.

## Good to know

- **Free Supabase projects pause after about a week with no use.** Using MITAK keeps it awake. If it ever pauses, open the Supabase dashboard and press **Restore**; nothing is lost.
- **Forgot password:** the sign-in screen has *Forgot password?*, which emails a reset link.
- **Starting over:** to reset everything, delete the project in Supabase and repeat these steps.
- **Trying it first:** with `config.js` still empty, the app offers **Try the demo**, which runs only on that device with sample data. You can also add `?demo` to the address at any time.
