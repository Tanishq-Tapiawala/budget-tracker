# My Money — GitHub Pages + Supabase

Personal budget tracker built with React, TypeScript, Vite and Supabase. GitHub Pages serves the frontend; Supabase handles private email/password login and synchronized financial data.

## Features

- Bank and credit-card balances; purchases and card repayments recorded separately
- Card purchases update current debt. Use **Set statement** when a billing cycle closes to copy current debt into a dated statement balance. Later purchases leave it unchanged; linked repayments reduce the remaining amount due.
- Income and expenses, transfers, group/subgroup categories
- Monthly recurring income and charges (posted on next app opening after a due date)
- Link a manual income or expense to its recurring month to avoid duplicate posting, or skip a month in Planning. Creating a backdated schedule previews the number of past entries before posting.
- Card payment reminders show the statement amount still due and open a repayment form; they never post an expense automatically.
- Category budgets, savings goals with monthly contributions, and a safe-to-spend estimate
- Mark bank accounts as savings to exclude their balance from safe to spend. Link transfers into or out of savings to a goal to track net contributions; transfers are not expenses.
- Goal progress is a record of starting allocations and linked transfers. The goals screen separately shows actual savings account balances and warns when recorded allocations exceed them.
- Opening balances are locked after an account has transactions. Use a balance adjustment to correct an existing account.
- Safe-to-spend subtracts current card debt, upcoming spendable-bank and card charges this month, and the unfulfilled portion of monthly savings reserves without counting posted charges or contributions twice
- Income/expense trend charts show exact amounts for a selected month; reports include a printable monthly amount table
- Create category groups and subcategories, with icons, while recording an expense
- Archived zero-balance accounts retain their transaction history and can be restored
- Trips with linked expenses and budgets
- Manual transactions use actual dates through today; future plans belong in recurring schedules
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
- The save indicator reflects the server response. Failed saves keep forms open; other failed actions offer a retry.
- Scheduled income and bills are posted on the next visit to the app, **not by a server-side timer**. A schedule posts at most once per month.
- Statement balances are manually captured or edited; the app does not know issuer closing dates, fees, or adjustments. Repayments made after a statement is set are linked to that statement, and older entries without a statement ID need a new capture to track remaining due. Reports use browser Print → Save as PDF.
- Safe-to-spend is a planning estimate for the current month; it does not predict unscheduled spending or future income.
- Savings transfers are records in this app. Make the actual transfer with your bank separately. Goal progress uses the starting allocation you enter plus linked transfers; unlinked account activity does not change a goal's recorded allocation.
- Deleting a goal removes its future monthly reserve but retains historical transfers and their recorded savings amounts in reports.
- This remains an early personal-finance app. Check calculations and use backups before treating it as a financial source of truth.
