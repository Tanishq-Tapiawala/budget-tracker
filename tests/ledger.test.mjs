import test from "node:test";
import assert from "node:assert/strict";
import { balances, postDue, transactionsForPeriod, upcomingBankObligations, validateTransaction } from "../src/ledger.ts";

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
