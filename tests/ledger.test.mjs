import test from "node:test";
import assert from "node:assert/strict";
import { balances, categoryTotals, monthlyFlow, postDue, transactionsForPeriod, upcomingBankObligations, validateTransaction, withCategory } from "../src/ledger.ts";

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
  assert.equal(upcomingBankObligations(ledger, "2026-10-29"), 1000);
  assert.equal(upcomingBankObligations(ledger, "2026-10-31"), 0);
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
