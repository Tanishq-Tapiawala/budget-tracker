# My Money — GitHub Pages + Supabase

Personal budget tracker built with React, TypeScript, Vite and Supabase. GitHub Pages serves the frontend; Supabase handles private email/password login and synchronized financial data.

## Features

- Bank and credit-card balances; purchases and card repayments recorded separately
- Income and expenses, transfers, group/subgroup categories
- Monthly recurring income and charges (posted on next app opening after a due date)
- Skipped recurring occurrences stay skipped; creating a due schedule posts it immediately
- Category budgets, monthly savings reserves and safe-to-spend estimate
- Income/expense trend charts and category spending charts on the dashboard and reports
- Create category groups and subcategories, with icons, while recording an expense
- Archived zero-balance accounts retain their transaction history and can be restored
- Trips with linked expenses and budgets
- Monthly/yearly dashboard, insights, CSV export, printable reports

## 1. Create the Supabase project

1. Create a free Supabase project at https://supabase.com/dashboard.
2. Open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql).
3. Under **Authentication → Providers → Email**, use email/password authentication. The app has a sign-up form. For a private one-person app, create your user and then disable public self-signup in Supabase; the sign-up form will then be rejected by Supabase.
4. Under **Authentication → Users**, create or invite **your one user** using a private email address. Set the password in the provider's secure interface; never commit it.
5. Under **Project Settings → API**, copy the Project URL and the **publishable/anon** key. **Never use the `service_role` or secret key in this frontend.**
6. In Authentication URL configuration, add your GitHub Pages URL to allowed redirect URLs if using email invitation or recovery links.

## 2. GitHub repository

Target repository: `https://github.com/Tanishq-Tapiawala/budget-tracker`.

1. Add these files to that repository's `main` branch. Preserve existing files until reviewed; the project files here are intended to be the repository root.
2. In GitHub **Settings → Secrets and variables → Actions → Variables**, set:
   - `VITE_SUPABASE_URL` — your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase publishable or legacy anon key
3. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as source.
4. Push to `main`, or run the **Deploy My Money to GitHub Pages** workflow manually.
5. Expected site URL: `https://tanishq-tapiawala.github.io/budget-tracker/` (subject to GitHub username/repository casing and Pages settings).

**GitHub Pages on GitHub Free ordinarily requires a public repository.** Source files and the public Supabase key may be visible, but the financial records are protected by Supabase row-level security. Never put financial exports, passwords, service-role tokens or private data in the repo.

## 3. Run locally

```bash
npm ci
cp .env.example .env.local
# Fill in your Supabase Project URL and public anon/publishable key in .env.local
npm run dev
```

Run the ledger checks with `npm test`.

The GitHub Pages build uses relative asset paths (`base: './'`) so the app works in the `/budget-tracker/` subpath.

## 4. Moving data from the existing ChatGPT Site

The current Site has a **different database**. This migration does not silently move existing financial records. If records exist there, export them securely, map the ledger JSON, and import into the Supabase `user_ledgers.payload` row for your new authenticated user. Do not publish exports in GitHub. Leave the original Site running until data is verified.

## Security and limitations

- The app includes a sign-up form. Whether registration succeeds is controlled by Supabase's public signup setting. Each signed-in user has a separate ledger; the app does not share one household ledger between users.
- Financial data is scoped to the authenticated user's UUID by row-level security.
- Each ledger save uses a revision condition to avoid silently overwriting another device's changes. If there is a conflict, reload and retry.
- Scheduled income and bills are posted on the next visit to the app, **not by a server-side timer**. A schedule posts at most once per month.
- Statement amounts are manually managed and reports use browser Print → Save as PDF.
- This remains an early personal-finance app. Check calculations and use backups before treating it as a financial source of truth.
