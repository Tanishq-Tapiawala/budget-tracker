import test from "node:test";
import assert from "node:assert/strict";
import { balances, captureCardStatement, cardPaymentReminders, cardStatementDueDate, categoryTotals, goalProgress, monthlyFlow, occurrenceSource, postDue, remainingStatementDue, safeToSpend, transactionsForPeriod, upcomingExpenseObligations, upcomingExpenseSchedules, validateAmount, validateDay, validateManualDate, validateSignedAmount, validateTransaction, withCategory } from "../src/ledger.ts";

const accounts = [
  { id: "checking", name: "Checking", type: "bank", opening: 10000 },
  { id: "savings", name: "Savings", type: "bank", opening: 0 },
  { id: "card", name: "Card", type: "card", opening: 0 },
];
const data = (changes = {}) => ({
  accounts,
  transactions: [],
  schedules: [],
  budgets: [],
  trips: [],
  goals: [],
  categories: {},
  categoryIcons: {},
  subcategoryIcons: {},
  skippedSources: [],
  ...changes,
});

test("transfer and repayment require a valid destination", () => {
  assert.match(validateTransaction({ type: "transfer", amount: 2000, account: "checking" }, accounts), /destination/);
  assert.match(validateTransaction({ type: "payment", amount: 2000, account: "checking", to: "savings" }, accounts), /credit card/);
  assert.equal(validateTransaction({ type: "transfer", amount: 2000, account: "checking", to: "savings" }, accounts), null);
  assert.equal(validateTransaction({ type: "payment", amount: 2000, account: "checking", to: "card" }, accounts), null);
});

test("negative ordinary transactions are rejected but adjustments are allowed", () => {
  assert.match(validateTransaction({ type: "expense", amount: -500, account: "checking" }, accounts), /Only balance adjustments/);
  assert.equal(validateTransaction({ type: "adjustment", amount: -500, account: "checking" }, accounts), null);
});

test("card purchase and repayment change debt without double counting the purchase", () => {
  const result = balances(data({ transactions: [
    { id: "purchase", type: "expense", amount: 3000, account: "card" },
    { id: "repayment", type: "payment", amount: 2000, account: "checking", to: "card" },
  ] }));
  assert.deepEqual(result, { checking: 8000, savings: 0, card: 1000 });
});

test("card statement captures current debt through today and remains a snapshot", () => {
  const ledger = data({ accounts: accounts.map((account) =>
    account.id === "card" ? { ...account, opening: 10000, statement: 4000 } : account),
    transactions: [
      { id: "purchase", date: "2026-10-20", type: "expense", amount: 5000, account: "card" },
      { id: "payment", date: "2026-10-25", type: "payment", amount: 2000, account: "checking", to: "card" },
      { id: "future", date: "2026-11-01", type: "expense", amount: 3000, account: "card" },
    ],
  });
  const captured = captureCardStatement(ledger, "card", "2026-10-30");
  assert.equal(captured.accounts.find((account) => account.id === "card").statement, 13000);
  assert.equal(captured.accounts.find((account) => account.id === "card").statementDate, "2026-10-30");
  assert.ok(captured.accounts.find((account) => account.id === "card").statementId);
  assert.equal(captured.accounts.find((account) => account.id === "checking"), ledger.accounts.find((account) => account.id === "checking"));
  assert.equal(captureCardStatement(captured, "checking", "2026-10-30"), captured);
  assert.equal(balances(captured, "2026-11-01").card, 16000);
  assert.equal(captured.accounts.find((account) => account.id === "card").statement, 13000);
  const credit = data({ accounts: accounts.map((account) =>
    account.id === "card" ? { ...account, opening: -1000 } : account),
  });
  assert.equal(captureCardStatement(credit, "card", "2026-10-30").accounts.find((account) => account.id === "card").statement, 0);
});

test("repayments reduce only the statement they are linked to", () => {
  const card = { ...accounts[2], statement: 10000, statementDate: "2026-10-10", statementId: "oct", due: 30 };
  const ledger = data({ accounts: [accounts[0], accounts[1], card], transactions: [
    { id: "old", type: "payment", to: "card", amount: 2000, date: "2026-10-01", statementId: "oct" },
    { id: "current", type: "payment", to: "card", amount: 3000, date: "2026-10-20", statementId: "oct" },
    { id: "other", type: "payment", to: "card", amount: 1000, date: "2026-10-22", statementId: "sep" },
  ] });
  assert.equal(remainingStatementDue(ledger, "card", "2026-10-21"), 7000);
  assert.equal(remainingStatementDue(ledger, "card", "2026-10-30"), 7000);
  assert.equal(remainingStatementDue(data(), "card", "2026-10-30"), null);
});

test("card reminders show statement due without posting spending", () => {
  const card = { ...accounts[2], statement: 10000, statementDate: "2026-10-01", statementId: "oct", due: 30 };
  const ledger = data({ accounts: [accounts[0], accounts[1], card], schedules: [
    { id: "reminder", type: "card_reminder", account: "card", start: "2026-10-01" },
  ] });
  assert.equal(cardPaymentReminders(ledger, "2026-10-20").length, 1);
  assert.equal(cardStatementDueDate(card), "2026-10-30");
  assert.equal(cardStatementDueDate({ ...card, statementDate: "2026-10-31" }), "2026-11-30");
  assert.equal(postDue(ledger, "2026-10-30"), ledger);
  assert.equal(safeToSpend(ledger, "2026-10-20"), 10000);
  const paid = data({ ...ledger, transactions: [
    { id: "pay", type: "payment", account: "checking", to: "card", amount: 10000,
      date: "2026-10-20", statementId: "oct" },
  ] });
  assert.equal(cardPaymentReminders(paid, "2026-10-20").length, 0);
  assert.equal(remainingStatementDue(paid, "card", "2026-10-20"), 0);
  const nextMonth = data({ ...ledger, accounts: [accounts[0], accounts[1],
    { ...card, statementDate: "2026-10-31", due: 15 }] });
  assert.equal(cardPaymentReminders(nextMonth, "2026-10-31").length, 1);
  assert.equal(cardStatementDueDate(nextMonth.accounts[2]), "2026-11-15");
});

test("a skipped recurring occurrence does not reappear", () => {
  const schedule = { id: "rent", name: "Rent", type: "expense", amount: 1000, account: "checking", day: 1, start: "2026-10-01" };
  const first = postDue(data({ schedules: [schedule] }), "2026-10-29");
  assert.equal(first.transactions.length, 1);
  assert.equal(first.transactions[0].source, "rent:2026-10");
  const skipped = postDue(data({ schedules: [schedule], skippedSources: ["rent:2026-10"] }), "2026-10-29");
  assert.equal(skipped.transactions.length, 0);
  const next = postDue(data({ schedules: [schedule], skippedSources: ["rent:2026-10"] }), "2026-11-02");
  assert.equal(next.transactions.length, 1);
  assert.equal(next.transactions[0].source, "rent:2026-11");
});

test("a linked manual payment replaces the recurring occurrence for its month", () => {
  const schedule = { id: "rent", name: "Rent", type: "expense", amount: 1000, account: "checking", day: 30, start: "2026-10-01" };
  const manual = { id: "paid", type: "expense", amount: 900, account: "checking", date: "2026-10-20",
    source: occurrenceSource("rent", "2026-10"), linkedManually: true };
  const ledger = data({ schedules: [schedule], transactions: [manual] });
  assert.equal(postDue(ledger, "2026-10-30"), ledger);
  assert.equal(upcomingExpenseSchedules(ledger, "2026-10-20").length, 0);
  assert.equal(balances(ledger, "2026-10-30").checking, 9100);
});

test("old recurring schedules still post the current month", () => {
  const old = { id: "old", name: "Old bill", type: "expense", amount: 100, account: "checking", day: 1, start: "2010-01-01" };
  const current = postDue(data({ schedules: [old] }), "2026-10-30");
  assert.ok(current.transactions.some((item) => item.source === "old:2026-10"));
});

test("yearly selection does not change monthly transaction and budget pages", () => {
  const ledger = data({ transactions: [
    { id: "oct", date: "2026-10-10" },
    { id: "sep", date: "2026-09-10" },
  ] });
  assert.equal(transactionsForPeriod(ledger, "2026-10", true, "reports").length, 2);
  assert.deepEqual(transactionsForPeriod(ledger, "2026-10", true, "transactions").map((item) => item.id), ["oct"]);
  assert.deepEqual(transactionsForPeriod(ledger, "2026-10", true, "budgets").map((item) => item.id), ["oct"]);
});

test("upcoming obligations use today's month and exclude future-starting schedules", () => {
  const ledger = data({ schedules: [
    { id: "rent", type: "expense", amount: 1000, account: "checking", day: 30, start: "2026-01-01" },
    { id: "future", type: "expense", amount: 2000, account: "checking", day: 30, start: "2026-11-01" },
  ] });
  assert.equal(upcomingExpenseObligations(ledger, "2026-10-29"), 1000);
  assert.equal(upcomingExpenseObligations(ledger, "2026-10-31"), 0);
});

test("a recurring bill is not subtracted twice on its due date", () => {
  const schedule = { id: "rent", type: "expense", amount: 1000, account: "checking", day: 30, start: "2026-01-01" };
  assert.equal(upcomingExpenseObligations(data({ schedules: [schedule] }), "2026-10-30"), 1000);
  assert.equal(upcomingExpenseObligations(data({ schedules: [schedule], transactions: [
    { id: "posted", type: "expense", amount: 1000, account: "checking", source: "rent:2026-10" },
  ] }), "2026-10-30"), 0);
  assert.equal(upcomingExpenseObligations(data({ schedules: [schedule], skippedSources: ["rent:2026-10"] }), "2026-10-30"), 0);
});

test("safe-to-spend stays steady when bank and card schedules post", () => {
  const ledger = data({ schedules: [
    { id: "rent", type: "expense", amount: 1200, account: "checking", day: 30, start: "2026-10-01" },
    { id: "subscription", type: "expense", amount: 500, account: "card", day: 30, start: "2026-10-01" },
  ] });
  ledger.goals = [{ id: "reserve", monthly: 300 }];
  const before = safeToSpend(ledger, "2026-10-29");
  const afterPosting = postDue(ledger, "2026-10-30");
  assert.deepEqual(upcomingExpenseSchedules(ledger, "2026-10-29").map((schedule) => schedule.id), ["rent", "subscription"]);
  assert.equal(upcomingExpenseObligations(ledger, "2026-10-29"), 1700);
  assert.deepEqual(upcomingExpenseSchedules(afterPosting, "2026-10-30"), []);
  assert.equal(upcomingExpenseObligations(afterPosting, "2026-10-30"), 0);
  assert.equal(safeToSpend(afterPosting, "2026-10-30"), before);
  const withCardCredit = data({ ...ledger, accounts: accounts.map((account) =>
    account.id === "card" ? { ...account, opening: -300 } : account),
  });
  const creditBefore = safeToSpend(withCardCredit, "2026-10-29");
  const creditAfter = safeToSpend(postDue(withCardCredit, "2026-10-30"), "2026-10-30");
  assert.equal(creditAfter, creditBefore);
});

test("future-dated entries do not change today's balance", () => {
  const ledger = data({ transactions: [
    { id: "today", type: "expense", amount: 1000, account: "checking", date: "2026-10-30" },
    { id: "future", type: "expense", amount: 2000, account: "checking", date: "2026-11-01" },
  ] });
  assert.equal(balances(ledger, "2026-10-30").checking, 9000);
  assert.equal(balances(ledger, "2026-11-01").checking, 7000);
  assert.match(validateManualDate("2026-11-01", "2026-10-30"), /Future-dated/);
  assert.match(validateManualDate("2026-02-30", "2026-10-30"), /valid transaction date/);
});

test("money limits and reserves require valid cents", () => {
  assert.match(validateAmount("-10", "monthly reserve", true), /nonnegative/);
  assert.match(validateAmount("0", "monthly limit"), /positive/);
  assert.match(validateAmount("1.234", "savings target"), /two decimal places/);
  assert.equal(validateAmount("0", "monthly reserve", true), null);
  assert.equal(validateAmount("100.25", "monthly limit"), null);
  assert.equal(validateSignedAmount("-30.25", "opening balance"), null);
  assert.match(validateSignedAmount("1.234", "opening balance"), /two decimal places/);
  assert.match(validateSignedAmount("Infinity", "opening balance"), /valid/);
  assert.equal(validateDay("31", "due day"), null);
  assert.match(validateDay("32", "due day"), /1 to 31/);
});

test("income and expense chart totals are grouped by month", () => {
  const points = monthlyFlow([
    { id: "a", date: "2026-09-03", type: "income", amount: 1000 },
    { id: "b", date: "2026-10-03", type: "expense", amount: 250 },
    { id: "c", date: "2026-10-04", type: "transfer", amount: 500 },
  ], "2026-10", 2);
  assert.deepEqual(points, [
    { month: "2026-09", income: 1000, expense: 0 },
    { month: "2026-10", income: 0, expense: 250 },
  ]);
});

test("category chart includes uncategorized spending", () => {
  assert.deepEqual(categoryTotals([
    { id: "a", type: "expense", amount: 200, category: "Food" },
    { id: "b", type: "expense", amount: 100 },
    { id: "c", type: "income", amount: 500 },
  ]), [
    { category: "Food", amount: 200 },
    { category: "Uncategorized", amount: 100 },
  ]);
});

test("a transaction can create a group and subcategory with icons in one ledger update", () => {
  const updated = withCategory(data(), "Pets", "Food", "🐾", "🥦");
  assert.deepEqual(updated.categories.Pets, ["Food"]);
  assert.equal(updated.categoryIcons.Pets, "🐾");
  assert.equal(updated.subcategoryIcons.Pets.Food, "🥦");
  const renamedIcon = withCategory(updated, "Pets", "Food", "", "🧾");
  assert.deepEqual(renamedIcon.categories.Pets, ["Food"]);
  assert.equal(renamedIcon.subcategoryIcons.Pets.Food, "🧾");
});

test("savings transfers require a real goal and one savings account", () => {
  const savingsAccounts = accounts.map((account) => account.id === "savings" ? { ...account, isSavings: true } : account);
  const goals = [{ id: "emergency", monthly: 3000 }];
  const contribution = { type: "transfer", account: "checking", to: "savings", amount: 2000, goal: "emergency" };
  assert.equal(validateTransaction(contribution, savingsAccounts, undefined, goals), null);
  assert.equal(validateTransaction({ ...contribution, account: "savings", to: "checking" }, savingsAccounts, undefined, goals), null);
  assert.match(validateTransaction({ ...contribution, goal: "missing" }, savingsAccounts, undefined, goals), /existing savings goal/);
  assert.match(validateTransaction(contribution, accounts, undefined, goals), /savings account/);
  assert.equal(validateTransaction({ ...contribution, id: "old" }, accounts,
    { ...contribution, id: "old", goalDelta: 2000 }, goals), null);
  assert.equal(validateTransaction({ ...contribution, id: "old" }, savingsAccounts,
    { ...contribution, id: "old", goalDelta: 2000 }, []), null);
  assert.match(validateTransaction({ ...contribution, type: "expense" }, savingsAccounts, undefined, goals), /Only bank transfers/);
});

test("monthly savings progress reduces the remaining reserve exactly once", () => {
  const savingsAccounts = accounts.map((account) => account.id === "savings" ? { ...account, isSavings: true, opening: 5000 } : account);
  const base = data({ accounts: savingsAccounts, goals: [{ id: "emergency", amount: 100000, monthly: 3000 }] });
  assert.equal(safeToSpend(base, "2026-10-30"), 7000);
  const withContribution = data({ ...base, transactions: [
    { id: "oct", date: "2026-10-15", type: "transfer", account: "checking", to: "savings", amount: 2000, goal: "emergency", goalDelta: 2000 },
    { id: "nov", date: "2026-11-15", type: "transfer", account: "checking", to: "savings", amount: 1000, goal: "emergency", goalDelta: 1000 },
  ] });
  assert.deepEqual(goalProgress(withContribution, "emergency", "2026-10-30"), { total: 2000, month: 2000 });
  assert.equal(safeToSpend(withContribution, "2026-10-30"), 7000);
  const withWithdrawal = data({ ...withContribution, transactions: [
    ...withContribution.transactions,
    { id: "withdraw", date: "2026-10-20", type: "transfer", account: "savings", to: "checking", amount: 500, goal: "emergency", goalDelta: -500 },
  ] });
  assert.deepEqual(goalProgress(withWithdrawal, "emergency", "2026-10-30"), { total: 1500, month: 1500 });
  assert.equal(safeToSpend(withWithdrawal, "2026-10-30"), 7000);
  const reached = data({ ...base, goals: [{ id: "emergency", amount: 5000, monthly: 3000, starting: 5000 }] });
  assert.deepEqual(goalProgress(reached, "emergency", "2026-10-30"), { total: 5000, month: 0 });
  assert.equal(safeToSpend(reached, "2026-10-30"), 10000);
});
