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

export function goalProgress(data: Data, goalId: string, through: string) {
  const starting = data.goals.find((goal) => goal.id === goalId)?.starting || 0;
  const contributions = data.transactions.filter((transaction) =>
    transaction.type === "transfer" && transaction.goal === goalId &&
    transaction.date && transaction.date <= through && Number.isSafeInteger(transaction.goalDelta),
  );
  return {
    total: starting + contributions.reduce((sum, transaction) => sum + transaction.goalDelta, 0),
    month: contributions.filter((transaction) => monthOf(transaction.date) === monthOf(through))
      .reduce((sum, transaction) => sum + transaction.goalDelta, 0),
  };
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

export function upcomingExpenseSchedules(data: Data, today: string) {
  const currentMonth = monthOf(today);
  return data.schedules
    .filter((schedule) => {
      const account = data.accounts.find((item) => item.id === schedule.account);
      const due = dueDate(currentMonth, schedule.day);
      const source = `${schedule.id}:${currentMonth}`;
      return schedule.type === "expense" && (account?.type === "bank" || account?.type === "card") &&
        !account.archived && due >= today && due >= (schedule.start || "0000-00-00") &&
        !data.transactions.some((transaction) => transaction.source === source) &&
        !data.skippedSources.includes(source);
    })
    .sort((a, b) => a.day - b.day);
}

export function upcomingExpenseObligations(data: Data, today: string) {
  return upcomingExpenseSchedules(data, today)
    .reduce((sum, schedule) => sum + schedule.amount, 0);
}

export function balances(data: Data, through?: string) {
  const result: Record<string, number> = {};
  data.accounts.forEach((account) => (result[account.id] = account.opening || 0));
  data.transactions.forEach((transaction) => {
    if (through && transaction.date && transaction.date > through) return;
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

export function captureCardStatement(data: Data, cardId: string, today: string): Data {
  const card = data.accounts.find((account) => account.id === cardId);
  if (!card || card.type !== "card" || card.archived) return data;
  const statement = Math.max(0, balances(data, today)[cardId] || 0);
  return {
    ...data,
    accounts: data.accounts.map((account) =>
      account.id === cardId ? { ...account, statement, statementDate: today } : account),
  };
}

export function safeToSpend(data: Data, today: string) {
  const current = balances(data, today);
  const upcoming = upcomingExpenseSchedules(data, today);
  const active = data.accounts.filter((account) => !account.archived);
  const cash = active.filter((account) => account.type === "bank" && !account.isSavings)
    .reduce((sum, account) => sum + (current[account.id] || 0), 0);
  const bankCharges = upcoming
    .filter((schedule) => active.some((account) => account.id === schedule.account && account.type === "bank" && !account.isSavings))
    .reduce((sum, schedule) => sum + schedule.amount, 0);
  const projectedCardDebt = active.filter((account) => account.type === "card")
    .reduce((sum, account) => {
      const pending = upcoming.filter((schedule) => schedule.account === account.id)
        .reduce((total, schedule) => total + schedule.amount, 0);
      return sum + Math.max(0, (current[account.id] || 0) + pending);
    }, 0);
  const reserves = data.goals.reduce((sum, goal) => {
    const progress = goalProgress(data, goal.id, today);
    if (goal.amount > 0 && progress.total >= goal.amount) return sum;
    return sum + Math.max(0, (goal.monthly || 0) - Math.max(0, progress.month));
  }, 0);
  return cash - bankCharges - projectedCardDebt - reserves;
}

export function validateAmount(raw: string, label: string, allowZero = false): string | null {
  const value = raw.trim();
  const cents = Math.round(Number(value) * 100);
  if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(cents) || (!allowZero && cents === 0))
    return `Enter a ${allowZero ? "nonnegative" : "positive"} ${label} with no more than two decimal places.`;
  return null;
}

export function validateManualDate(date: string, today: string): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return "Choose a valid transaction date.";
  if (date > today) return "Future-dated transactions are not supported. Use a recurring schedule for planned activity.";
  return null;
}

export function validateTransaction(
  transaction: Record<string, any>,
  accounts: Item[],
  original?: Item,
  goals: Item[] = [],
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
    if (transaction.goal) {
      if (transaction.type !== "transfer") return "Only bank transfers can be linked to a savings goal.";
      if (!goals.some((goal) => goal.id === transaction.goal) && original?.goal !== transaction.goal)
        return "Choose an existing savings goal.";
      const sameHistoricalTransfer = original?.goal === transaction.goal &&
        original?.account === transaction.account && original?.to === transaction.to &&
        Number.isSafeInteger(original?.goalDelta);
      if (Boolean(source.isSavings) === Boolean(destination.isSavings) && !sameHistoricalTransfer)
        return "A savings goal transfer must move between spendable cash and a savings account.";
    }
  }
  if (transaction.goal && transaction.type !== "transfer")
    return "Only bank transfers can be linked to a savings goal.";
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
