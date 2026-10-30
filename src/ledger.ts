export type Item = { id: string; [key: string]: any };
export type Data = {
  accounts: Item[];
  transactions: Item[];
  schedules: Item[];
  budgets: Item[];
  trips: Item[];
  goals: Item[];
  categories: Record<string, string[]>;
  categoryIcons: Record<string, string>;
  subcategoryIcons: Record<string, Record<string, string>>;
  skippedSources: string[];
};

export function withCategory(
  data: Data,
  group: string,
  subgroup = "",
  groupIcon = "",
  subgroupIcon = "",
): Data {
  const categories = {
    ...data.categories,
    [group]: [...new Set([...(data.categories[group] || []), ...(subgroup ? [subgroup] : [])])],
  };
  return {
    ...data,
    categories,
    categoryIcons: groupIcon
      ? { ...data.categoryIcons, [group]: groupIcon }
      : data.categoryIcons,
    subcategoryIcons: subgroup && subgroupIcon
      ? {
          ...data.subcategoryIcons,
          [group]: { ...(data.subcategoryIcons[group] || {}), [subgroup]: subgroupIcon },
        }
      : data.subcategoryIcons,
  };
}

const monthOf = (date: string) => date.slice(0, 7);
const shiftMonth = (month: string, count: number) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + count, 1)).toISOString().slice(0, 7);
};
const dueDate = (month: string, day: number) => {
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(1, day), lastDay)).padStart(2, "0")}`;
};

export function transactionsForPeriod(data: Data, month: string, annual: boolean, page: string) {
  const yearly = annual && (page === "dashboard" || page === "reports");
  return data.transactions.filter((transaction) =>
    yearly ? transaction.date.startsWith(month.slice(0, 4)) : monthOf(transaction.date) === month,
  );
}

export function monthlyFlow(transactions: Item[], endMonth: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const month = shiftMonth(endMonth, index - count + 1);
    const matching = transactions.filter((transaction) => monthOf(transaction.date) === month);
    return {
      month,
      income: matching.filter((transaction) => transaction.type === "income")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
      expense: matching.filter((transaction) => transaction.type === "expense")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    };
  });
}

export function categoryTotals(transactions: Item[]) {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense" || transaction.amount <= 0) continue;
    const category = transaction.category || "Uncategorized";
    totals.set(category, (totals.get(category) || 0) + transaction.amount);
  }
  return [...totals].map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function upcomingBankObligations(data: Data, today: string) {
  const currentMonth = monthOf(today);
  return data.schedules
    .filter((schedule) => {
      const account = data.accounts.find((item) => item.id === schedule.account);
      const due = dueDate(currentMonth, schedule.day);
      const source = `${schedule.id}:${currentMonth}`;
      return schedule.type === "expense" && account?.type === "bank" &&
        !account.archived && due >= today && due >= (schedule.start || "0000-00-00") &&
        !data.transactions.some((transaction) => transaction.source === source) &&
        !data.skippedSources.includes(source);
    })
    .reduce((sum, schedule) => sum + schedule.amount, 0);
}

export function balances(data: Data) {
  const result: Record<string, number> = {};
  data.accounts.forEach((account) => (result[account.id] = account.opening || 0));
  data.transactions.forEach((transaction) => {
    if (!(transaction.account in result)) return;
    if (transaction.type === "income" || transaction.type === "adjustment")
      result[transaction.account] += transaction.amount;
    else if (transaction.type === "expense")
      result[transaction.account] +=
        data.accounts.find((account) => account.id === transaction.account)?.type === "card"
          ? transaction.amount
          : -transaction.amount;
    else if (transaction.type === "transfer" || transaction.type === "payment") {
      result[transaction.account] -= transaction.amount;
      if (transaction.to in result)
        result[transaction.to] += transaction.type === "payment" ? -transaction.amount : transaction.amount;
    }
  });
  return result;
}

export function validateTransaction(
  transaction: Record<string, any>,
  accounts: Item[],
  original?: Item,
): string | null {
  const source = accounts.find((account) => account.id === transaction.account);
  if (!source) return "Choose a valid account.";
  if (source.archived && original?.account !== source.id)
    return "Archived accounts cannot receive new transactions.";
  if (!Number.isSafeInteger(transaction.amount) || transaction.amount === 0)
    return "Enter a nonzero amount with no more than two decimal places.";
  if (transaction.type !== "adjustment" && transaction.amount < 0)
    return "Only balance adjustments can have a negative amount.";
  if (!/^(income|expense|transfer|payment|adjustment)$/.test(transaction.type))
    return "Choose a transaction type.";
  if ((transaction.type === "income" || transaction.type === "transfer" || transaction.type === "payment") && source.type !== "bank")
    return "Choose a bank or cash account for this transaction type.";
  if (transaction.type === "transfer" || transaction.type === "payment") {
    const destination = accounts.find((account) => account.id === transaction.to);
    if (!destination || (destination.archived && original?.to !== destination.id) || destination.id === source.id)
      return "Choose a different, active destination account.";
    const requiredType = transaction.type === "payment" ? "card" : "bank";
    if (destination.type !== requiredType)
      return transaction.type === "payment"
        ? "Choose a credit card as the repayment destination."
        : "Choose a bank or cash account as the transfer destination.";
  }
  return null;
}

export function postDue(data: Data, today: string) {
  let changed = false;
  const transactions = [...data.transactions];
  const known = new Set([
    ...transactions.map((transaction) => transaction.source),
    ...data.skippedSources,
  ]);
  for (const schedule of data.schedules) {
    let month = monthOf(schedule.start || today);
    const end = monthOf(today);
    const earliestSupported = shiftMonth(end, -119);
    if (month < earliestSupported) month = earliestSupported;
    let guard = 0;
    while (month <= end && guard++ < 120) {
      const due = dueDate(month, schedule.day);
      const source = `${schedule.id}:${month}`;
      if (due >= (schedule.start || "0000-00-00") && due <= today && !known.has(source)) {
        transactions.push({
          id: crypto.randomUUID(),
          date: due,
          type: schedule.type,
          amount: schedule.amount,
          account: schedule.account,
          category: schedule.category,
          sub: schedule.sub,
          note: schedule.name,
          source,
        });
        known.add(source);
        changed = true;
      }
      month = shiftMonth(month, 1);
    }
  }
  return changed ? { ...data, transactions } : data;
}
