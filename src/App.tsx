"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  LayoutDashboard,
  Landmark,
  CreditCard,
  Receipt,
  ChartPie,
  Plane,
  ChartColumn,
  Plus,
  Trash2,
  Download,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
} from "lucide-react";
import {
  configured,
  setRememberSession,
  signOut,
  inactivityMs,
  supabase,
} from "./supabase";
import type { User } from "@supabase/supabase-js";
import { balances, goalProgress, postDue, safeToSpend, transactionsForPeriod, upcomingExpenseSchedules, validateAmount, validateManualDate, validateTransaction, withCategory } from "./ledger";
import type { Data, Item } from "./ledger";
import { CashflowChart, CategoryDonut } from "./charts";
const blank: Data = {
  accounts: [],
  transactions: [],
  schedules: [],
  budgets: [],
  trips: [],
  goals: [],
  skippedSources: [],
  subcategoryIcons: {},
  categories: {
    Housing: ["Rent", "Utilities", "Internet"],
    Food: ["Groceries", "Dining", "Coffee"],
    Transport: ["Fuel", "Transit", "Parking"],
    Shopping: ["Clothing", "Electronics"],
    Entertainment: ["Subscriptions", "Events"],
    Health: ["Medical", "Fitness"],
    Travel: ["Flights", "Hotels", "Activities"],
    Other: ["Gifts", "Miscellaneous"],
  },
  categoryIcons: {
    Housing: "🏠",
    Food: "🍽️",
    Transport: "🚗",
    Shopping: "🛍️",
    Entertainment: "🎉",
    Health: "💊",
    Travel: "✈️",
    Other: "✨",
  },
};
const nav = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", icon: Receipt },
  { id: "accounts", label: "Accounts", icon: Landmark },
  { id: "planning", label: "Planning", icon: ChartPie },
  { id: "reports", label: "Reports", icon: ChartColumn },
];
const categoryIcons: Record<string, string> = {
  Housing: "🏠",
  Food: "🍽️",
  Transport: "🚗",
  Shopping: "🛍️",
  Entertainment: "🎉",
  Health: "💊",
  Travel: "✈️",
  Other: "✨",
};
const categoryIconOptions = ["🏠","🍽️","🚗","🛍️","🎉","💊","✈️","✨","💰","📁","🧾","🧺","🏡","🎯","💳","📦"];
const subcategoryIconOptions = ["🏷️","☕","🥦","🍔","🛒","🚕","🚆","⛽","💡","📱","🎬","🎁","💊","🏨","✈️","🧾","📦","✨"];
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
const now = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const mid = (s: string) => s.slice(0, 7);
const shift = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const amount = (v: any) => Math.round((Number(v) || 0) * 100);
const errorMessage = (value: unknown) =>
  value && typeof value === "object" && "message" in value && typeof value.message === "string"
    ? value.message
    : String(value);
const id = () => crypto.randomUUID();
const download = (rows: any[][], name: string) => {
  const text = rows
    .map((row) =>
      row
        .map((cell) => '"' + String(cell ?? "").replaceAll('"', '""') + '"')
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};
function MoneyApp({ user }: { user: User }) {
  const [d, setD] = useState<Data>(blank),
    [rev, setRev] = useState(0),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saveState, setSaveState] = useState<"saved" | "saving" | "failed" | "conflict">("saved"),
    [failedSave, setFailedSave] = useState<Data | null>(null),
    [loadAttempt, setLoadAttempt] = useState(0),
    [page, setPage] = useState("dashboard"),
    [accountTab, setAccountTab] = useState<"banks" | "cards">("banks"),
    [planningTab, setPlanningTab] = useState<"recurring" | "budgets" | "goals" | "trips">("recurring"),
    [showCategories, setShowCategories] = useState(false),
    [showOtherTypes, setShowOtherTypes] = useState(false),
    [mobile, setMobile] = useState(false),
    [month, setMonth] = useState(() => mid(now())),
    [annual, setAnnual] = useState(false),
    [modal, setModal] = useState(""),
    [f, setF] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateActivity = () => localStorage.setItem("my-money-last-activity", String(Date.now()));
    const onActivity = () => updateActivity();
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"]; 
    const check = () => {
      const last = Number(localStorage.getItem("my-money-last-activity") || "0");
      if (Date.now() - last > inactivityMs) {
        void signOut();
      }
    };

    updateActivity();
    events.forEach((event) => window.addEventListener(event, onActivity));
    const timer = window.setInterval(check, 30 * 1000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, onActivity));
      window.clearInterval(timer);
    };
  }, [user.id]);
  useEffect(() => {
    setReady(false);
    setError("");
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("user_ledgers")
          .select("payload,revision")
          .eq("owner_id", user.id)
          .maybeSingle();
        if (error) throw error;
        setD(data?.payload ? {
          ...blank,
          ...data.payload,
          categoryIcons: { ...blank.categoryIcons, ...(data.payload.categoryIcons || {}) },
          subcategoryIcons: data.payload.subcategoryIcons || {},
        } : blank);
        setRev(data?.revision ?? 0);
        setSaveState("saved");
        setFailedSave(null);
        setReady(true);
      } catch (e) {
        setError(`Unable to load your ledger. ${errorMessage(e)}`);
      }
    })();
  }, [user.id, loadAttempt]);
  async function save(next: Data) {
    setBusy(true);
    setSaveState("saving");
    setFailedSave(null);
    setError("");
    let conflict = false;
    try {
      let result;
      if (rev === 0) {
        result = await supabase
          .from("user_ledgers")
          .insert({ owner_id: user.id, payload: next, revision: 1 })
          .select("revision")
          .single();
      } else {
        result = await supabase
          .from("user_ledgers")
          .update({
            payload: next,
            revision: rev + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", user.id)
          .eq("revision", rev)
          .select("revision")
          .maybeSingle();
      }
      if (result.error) throw result.error;
      if (!result.data) {
        conflict = true;
        throw Error(
          "Another device changed your data. Please refresh before editing.",
        );
      }
      setD(next);
      setRev(result.data.revision);
      setSaveState("saved");
      return true;
    } catch (e) {
      setError(errorMessage(e));
      setSaveState(conflict ? "conflict" : "failed");
      if (!conflict && !modal) setFailedSave(next);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!ready) return;
    const next = postDue(d, now());
    if (next !== d) void save(next);
  }, [ready]);
  const today = now();
  const bal = useMemo(() => balances(d, today), [d, today]);
  const name = (key: string) =>
    d.accounts.find((a) => a.id === key)?.name || "Unknown";
  const bank = d.accounts.filter((a) => a.type === "bank" && !a.archived),
    cards = d.accounts.filter((a) => a.type === "card" && !a.archived),
    archivedBank = d.accounts.filter((a) => a.type === "bank" && a.archived),
    archivedCards = d.accounts.filter((a) => a.type === "card" && a.archived);
  const savingsBank = bank.filter((account) => account.isSavings);
  const spendingBank = bank.filter((account) => !account.isSavings);
  const bankTotal = bank.reduce((a, x) => a + (bal[x.id] || 0), 0),
    debt = cards.reduce((a, x) => a + Math.max(0, bal[x.id] || 0), 0);
  const period = transactionsForPeriod(d, month, annual, page);
  const income = period
      .filter((t) => t.type === "income")
      .reduce((a, t) => a + t.amount, 0),
    spent = period
      .filter((t) => t.type === "expense")
      .reduce((a, t) => a + t.amount, 0);
  const catSpent = (c: string) =>
    period
      .filter((t) => t.type === "expense" && t.category === c)
      .reduce((a, t) => a + t.amount, 0);
  const pendingExpenses = upcomingExpenseSchedules(d, today);
  const safe = safeToSpend(d, today);
  const savedThisMonth = d.goals.reduce((sum, goal) => sum + goalProgress(d, goal.id, today).month, 0);
  const savedInPeriod = period.filter((transaction) => transaction.type === "transfer" &&
    transaction.goal && Number.isSafeInteger(transaction.goalDelta))
    .reduce((sum, transaction) => sum + transaction.goalDelta, 0);
  function open(type: string, entry: Item | Record<string, any> = {}) {
    setError("");
    setModal(type);
    setShowOtherTypes(["transfer", "payment", "adjustment"].includes(String(entry.type || "")));
    const obj: Record<string, string> = {};
    Object.entries(entry).forEach(
      ([k, v]) =>
        (obj[k] = [
          "amount",
          "opening",
          "limit",
          "statement",
          "monthly",
          "budget",
          "starting",
        ].includes(k)
          ? String(Number(v) / 100)
          : String(v ?? "")),
    );
    setF(obj);
  }
  async function submit() {
    const key = f.id || id(),
      v = amount(f.amount),
      base: any = { ...f, id: key };
    if (!f.name?.trim() && ["account", "schedule", "trip", "goal"].includes(modal)) {
      setError("Name is required");
      return;
    }
    let next = { ...d };
    if (modal === "account") {
      const existing = d.accounts.find((account) => account.id === key);
      if (existing && existing.type !== f.type) {
        setError("Account type cannot change after creation. Add a new account instead.");
        return;
      }
      base.opening = v;
      base.isSavings = f.type === "bank" && f.isSavings === "true";
      base.limit = amount(f.limit);
      base.statement = amount(f.statement);
      next.accounts = [...d.accounts.filter((x) => x.id !== key), base];
    }
    if (modal === "transaction") {
      if (!/^-?\d+(\.\d{1,2})?$/.test((f.amount || "").trim())) {
        setError("Enter an amount with no more than two decimal places.");
        return;
      }
      base.amount = v;
      base.date = f.date || today;
      const dateProblem = validateManualDate(base.date, today);
      if (dateProblem) {
        setError(dateProblem);
        return;
      }
      base.type = f.type || "expense";
      if (base.type === "expense") {
        const newGroup = f.category === "__new__";
        const newSubgroup = f.sub === "__new__";
        const group = (newGroup ? f.newCategory : f.category || "").trim();
        const subgroup = (newSubgroup ? f.newSub : f.sub || "").trim();
        if (newGroup && !group) {
          setError("Enter a name for the new category group.");
          return;
        }
        if (newGroup && d.categories[group]) {
          setError("That category group already exists. Select it from the list.");
          return;
        }
        if (newSubgroup && !subgroup) {
          setError("Enter a name for the new subcategory.");
          return;
        }
        if (newSubgroup && !group) {
          setError("Choose or create a category group first.");
          return;
        }
        if (newSubgroup && d.categories[group]?.includes(subgroup)) {
          setError("That subcategory already exists. Select it from the list.");
          return;
        }
        if (newGroup || newSubgroup) {
          next = withCategory(
            next,
            group,
            subgroup,
            newGroup ? f.newCategoryIcon || "📁" : "",
            newSubgroup ? f.newSubIcon || "🏷️" : "",
          );
        }
        base.category = group;
        base.sub = subgroup;
      } else {
        delete base.category;
        delete base.sub;
        delete base.trip;
      }
      if (base.type !== "transfer" && base.type !== "payment") delete base.to;
      if (base.type !== "transfer" || !base.goal) {
        delete base.goal;
        delete base.goalDelta;
      }
      delete base.newCategory;
      delete base.newCategoryIcon;
      delete base.newSub;
      delete base.newSubIcon;
      const original = d.transactions.find((transaction) => transaction.id === key);
      const problem = validateTransaction(base, d.accounts, original, d.goals);
      if (problem) {
        setError(problem);
        return;
      }
      if (base.goal) {
        const destination = d.accounts.find((account) => account.id === base.to);
        const sameHistoricalTransfer = original?.goal === base.goal &&
          original?.account === base.account && original?.to === base.to &&
          Number.isSafeInteger(original?.goalDelta);
        base.goalDelta = sameHistoricalTransfer && original ? Math.sign(original.goalDelta) * v : destination?.isSavings ? v : -v;
      }
      next.transactions = [...d.transactions.filter((x) => x.id !== key), base];
    }
    if (modal === "schedule") {
      if (!/^(\d+)(\.\d{1,2})?$/.test((f.amount || "").trim()) || v <= 0) {
        setError("Enter a positive monthly amount with no more than two decimal places.");
        return;
      }
      if (!d.accounts.some((account) => account.id === f.account && !account.archived)) {
        setError("Choose an active account for this schedule.");
        return;
      }
      if ((f.type || "expense") === "income" &&
          !bank.some((account) => account.id === f.account)) {
        setError("Recurring income must go to a bank or cash account.");
        return;
      }
      base.amount = v;
      base.day = Math.max(1, Math.min(31, Number(f.day) || 1));
      base.start = f.start || now();
      base.type = f.type || "expense";
      next.schedules = [...d.schedules.filter((x) => x.id !== key), base];
      next = postDue(next, now());
    }
    if (modal === "budget") {
      if (!d.categories[f.category]) {
        setError("Choose a category for this budget.");
        return;
      }
      const problem = validateAmount(f.amount || "", "monthly limit");
      if (problem) {
        setError(problem);
        return;
      }
      base.amount = v;
      next.budgets = [...d.budgets.filter((x) => x.id !== key), base];
    }
    if (modal === "goal") {
      const problem = validateAmount(f.amount || "", "savings target") ||
        validateAmount(f.monthly || "0", "monthly reserve", true) ||
        validateAmount(f.starting || "0", "already saved amount", true);
      if (problem) {
        setError(problem);
        return;
      }
      base.amount = v;
      base.monthly = amount(f.monthly);
      base.starting = amount(f.starting);
      next.goals = [...d.goals.filter((x) => x.id !== key), base];
    }
    if (modal === "trip") {
      const problem = validateAmount(f.budget || "0", "trip budget", true);
      if (problem) {
        setError(problem);
        return;
      }
      if (Boolean(f.start) !== Boolean(f.end)) {
        setError("Enter both trip dates or leave both blank.");
        return;
      }
      if (f.start && f.end && f.end < f.start) {
        setError("Trip end date must be on or after the start date.");
        return;
      }
      base.budget = amount(f.budget);
      next.trips = [...d.trips.filter((x) => x.id !== key), base];
    }
    if (modal === "category") {
      const group = (f.name || f.category || "").trim(),
        sub = (f.sub || "").trim(),
        icon = (f.icon || d.categoryIcons[group] || categoryIcons[group] || "📁").trim();
      if (!group) {
        setError("Category group is required");
        return;
      }
      next = withCategory(next, group, sub, icon, sub ? f.subIcon || d.subcategoryIcons[group]?.[sub] || "🏷️" : "");
    }
    if (await save(next)) setModal("");
  }
  async function remove(type: "transactions" | "schedules" | "budgets" | "trips" | "goals", key: string) {
    if (type === "trips" && d.transactions.some((transaction) => transaction.trip === key)) {
      setError("This trip has linked expenses. Remove their trip links before deleting it.");
      return;
    }
    if (!confirm("Delete this item? Historical transactions will remain."))
      return;
    const arr = d[type];
    if (Array.isArray(arr)) {
      const removedSource = type === "transactions"
        ? d.transactions.find((transaction) => transaction.id === key)?.source
        : undefined;
      await save({
        ...d,
        [type]: arr.filter((x) => x.id !== key),
        skippedSources:
          removedSource
            ? [...new Set([...d.skippedSources, removedSource])]
            : d.skippedSources,
      });
    }
  }
  async function archiveAccount(account: Item) {
    if (bal[account.id] !== 0) {
      setError("Bring this account's balance to zero before archiving it.");
      return;
    }
    if (d.schedules.some((schedule) => schedule.account === account.id)) {
      setError("Remove or move this account's recurring entries before archiving it.");
      return;
    }
    if (d.accounts.some((item) => !item.archived && item.type === "card" && item.payFrom === account.id)) {
      setError("Change the repayment account on linked cards before archiving this bank account.");
      return;
    }
    if (!confirm(`Archive ${account.name}? Its transaction history will stay available.`)) return;
    await save({
      ...d,
      accounts: d.accounts.map((item) =>
        item.id === account.id ? { ...item, archived: true } : item,
      ),
    });
  }
  async function restoreAccount(account: Item) {
    await save({
      ...d,
      accounts: d.accounts.map((item) =>
        item.id === account.id ? { ...item, archived: false } : item,
      ),
    });
  }
  async function removeCategorySubgroup(group: string, sub: string) {
    const nextSubs = (d.categories[group] || []).filter((item) => item !== sub);
    const nextCategories = { ...d.categories, [group]: nextSubs };
    const groupInUse = d.transactions.some((transaction) => transaction.category === group) ||
      d.schedules.some((schedule) => schedule.category === group) ||
      d.budgets.some((budget) => budget.category === group);
    if (!nextSubs.length && !groupInUse) {
      delete nextCategories[group];
    }
    await save({
      ...d,
      categories: nextCategories,
    });
  }
  const select = (key: string, options: { id: string; name: string }[]) =>
    field(
      key,
      key,
      "select",
      options.map((x) => ({ value: x.id, label: x.name })),
    );
  function field(
    label: string,
    key: string,
    type = "text",
    options?: { value: string; label: string }[],
  ) {
    return (
      <label className="field">
        <span>{label}</span>
        {type === "select" ? (
          <select
            value={f[key] || ""}
            onChange={(e) => setF({ ...f, [key]: e.target.value })}
          >
            <option value="">Select…</option>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            step={type === "number" ? "0.01" : undefined}
            max={type === "date" && modal === "transaction" ? today : undefined}
            value={f[key] || ""}
            onChange={(e) => setF({ ...f, [key]: e.target.value })}
          />
        )}
      </label>
    );
  }
  const groups = Object.keys(d.categories).map((x) => ({ value: x, label: x })),
    accountOptions = d.accounts.filter((x) => !x.archived).map((x) => ({ value: x.id, label: x.name })),
    bankOptions = bank.map((x) => ({ value: x.id, label: x.name })),
    cardOptions = cards.map((x) => ({ value: x.id, label: x.name }));
  const originalTransaction = d.transactions.find((transaction) => transaction.id === f.id);
  const withArchived = (options: { value: string; label: string }[], selected?: string) => {
    const account = d.accounts.find((item) => item.id === selected && item.archived);
    return account && !options.some((option) => option.value === account.id)
      ? [...options, { value: account.id, label: `${account.name} (archived)` }]
      : options;
  };
  function row(
    title: string,
    description: string,
    value: string,
    edit: () => void,
    del?: () => void,
    actionLabel = "Edit",
    valueTone = "",
  ) {
    return (
      <div className="row">
        <div className="row-dot">
          <Wallet size={17} />
        </div>
        <div className="row-copy">
          <strong>{title}</strong>
          <small>{description}</small>
        </div>
        <b className={valueTone}>{value}</b>
        <button className={`row-action ${actionLabel === "Edit" ? "" : "restore"}`} onClick={edit} aria-label={actionLabel}>
          {actionLabel === "Edit" ? "✎" : actionLabel}
        </button>
        {del && (
          <button className="row-action red" onClick={del} aria-label="Delete">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    );
  }
  function section(title: string, sub: string, add?: string, nested = false) {
    return (
      <div className="section-heading">
        <div>
          {nested ? <h2>{title}</h2> : <h1>{title}</h1>}
          <p>{sub}</p>
        </div>
        {add && (
          <button
            className="primary"
            onClick={() =>
              open(
                add,
                add === "transaction"
                  ? { type: "expense", date: now() }
                  : add === "account"
                    ? { type: accountTab === "cards" ? "card" : "bank" }
                    : {},
              )
            }
          >
            <Plus size={17} /> Add {add}
          </button>
        )}
      </div>
    );
  }
  function tabs<T extends string>(items: { id: T; label: string }[], selected: T, choose: (value: T) => void, label: string) {
    return <div className="page-tabs" role="tablist" aria-label={label}>
      {items.map((item) => <button key={item.id} type="button" role="tab" aria-selected={selected === item.id}
        className={selected === item.id ? "selected" : ""} onClick={() => choose(item.id)}>{item.label}</button>)}
    </div>;
  }
  const empty = (text: string) => (
    <div className="empty">
      <Wallet size={27} />
      <p>{text}</p>
    </div>
  );
  const recent = [...d.transactions].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const transactionTone = (transaction: Item) =>
    transaction.type === "income" ? "green" : transaction.type === "expense" ? "red" : "";
  const transactionValue = (transaction: Item) =>
    `${transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : ""}${usd(transaction.amount)}`;
  const transactionTitle = (transaction: Item) => {
    const icon = transaction.sub ? d.subcategoryIcons[transaction.category]?.[transaction.sub] || "🏷️" : "";
    return `${icon ? `${icon} ` : ""}${transaction.note || transaction.sub || transaction.category || transaction.type}`;
  };
  const transactionAccounts = (transaction: Item) =>
    transaction.to ? `${name(transaction.account)} → ${name(transaction.to)}` : name(transaction.account);
  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? "visible" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <Wallet size={23} />
          </div>
          <div>
            my<span>money</span>
            <small>PERSONAL FINANCE</small>
          </div>
          <button className="mobile-close" onClick={() => setMobile(false)}>
            <X />
          </button>
        </div>
        <small className="nav-label">WORKSPACE</small>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setMobile(false);
              }}
            >
              <n.icon size={19} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          🔒 Private workspace<small>USD · No bank connections</small>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              display: "block",
              marginTop: 14,
              textDecoration: "underline",
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <button className="hamburger" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <span>
            Workspace <i>/</i> {nav.find((n) => n.id === page)?.label}
          </span>
          <div className={`top-status ${saveState === "failed" || saveState === "conflict" || (!ready && error) ? "failed" : ""}`}>
            {!ready ? (error ? "Load failed" : "Loading…") : busy ? "Saving…" : saveState === "conflict" ? "Save conflict" : saveState === "failed" ? "Not saved" : "Saved securely"}
            <span className="avatar">M</span>
          </div>
        </header>
        <div className="content">
          {error && !modal && (
            <div className="error" role="alert">
              <span>{error}</span>
              <div className="error-actions">
                {failedSave && !modal && <button disabled={busy} onClick={() => void save(failedSave)}>Retry save</button>}
                {saveState === "conflict" && <button onClick={() => {
                  if (confirm("Reload the latest ledger? Changes in the open form will be lost.")) window.location.reload();
                }}>Reload latest</button>}
                <button onClick={() => setError("")}>Dismiss</button>
              </div>
            </div>
          )}
          {!ready ? (
            error ? <div className="empty">
              <Wallet size={27} />
              <p>Your ledger could not be loaded.</p>
              <button className="secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry loading</button>
            </div> : empty("Loading your private finances…")
          ) : (
            <>
              {page === "dashboard" && (
                <>
                  {section(
                    "Your money, at a glance.",
                    "A clear view of what you have, owe and can safely spend.",
                  )}
                  <div className="toolbar">
                    <div className="month-switch">
                      <button type="button" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">
                        <ChevronLeft size={18} />
                      </button>
                      <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value || mid(now()))}
                        aria-label="Select month"
                      />
                      <button type="button" onClick={() => setMonth(shift(month, 1))} aria-label="Next month">
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    <button className="secondary" type="button" onClick={() => setMonth(mid(now()))}>
                      This month
                    </button>
                    <div className="segmented">
                      <button
                        className={!annual ? "selected" : ""}
                        onClick={() => setAnnual(false)}
                      >
                        Monthly
                      </button>
                      <button
                        className={annual ? "selected" : ""}
                        onClick={() => setAnnual(true)}
                      >
                        Yearly
                      </button>
                    </div>
                    <button
                      className="primary"
                      onClick={() =>
                        open("transaction", { type: "expense", date: now() })
                      }
                    >
                      <Plus size={16} /> Add transaction
                    </button>
                  </div>
                  <section className="safe-hero" aria-label="Safe to spend">
                    <div>
                      <span>Estimated safe to spend today</span>
                      <strong className={safe < 0 ? "red" : "green"}>{usd(safe)}</strong>
                      <small>Spendable cash less card debt, upcoming bills this month and remaining monthly savings reserves.</small>
                      {d.goals.length > 0 && <small className={savedThisMonth < 0 ? "red" : ""}>
                        Saved toward goals this month: {usd(savedThisMonth)}
                      </small>}
                    </div>
                    <button className="secondary" type="button" onClick={() => { setPage("planning"); setPlanningTab("recurring"); }}>
                      Review upcoming bills
                    </button>
                  </section>
                  <div className="stats">
                    {[
                      ["Total bank balances", bankTotal, `${bank.length} accounts${savingsBank.length ? " · includes savings" : ""}`],
                      ["Current card debt", debt, `${cards.length} cards · as of today`],
                      [
                        "Recorded income",
                        income,
                        annual ? "This year" : "This month",
                      ],
                      ["Recorded expenses", spent, "Excludes repayments"],
                    ].map(([title, value, sub]) => (
                      <div className="stat" key={title}>
                        <span>{title}</span>
                        <strong className={title === "Recorded income" ? "green" : title === "Recorded expenses" || title === "Current card debt" ? "red" : ""}>{usd(value as number)}</strong>
                        <small>{sub}</small>
                      </div>
                    ))}
                  </div>
                  <section className="panel chart-panel">
                    <div className="panel-head">
                      <h2>Income and expenses over time</h2>
                      <span className="tag">{annual ? "Jan–Dec" : "Last 6 months"}</span>
                    </div>
                    <CashflowChart transactions={d.transactions} endMonth={annual ? `${month.slice(0, 4)}-12` : month} count={annual ? 12 : 6} format={usd} />
                  </section>
                  <div className="columns">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Spending by category</h2>
                      </div>
                      <CategoryDonut transactions={period} format={usd} />
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Planning ahead</h2>
                        <Lightbulb size={20} />
                      </div>
                      <h3>Upcoming charges this month</h3>
                      {pendingExpenses
                        .slice(0, 5)
                        .map((s) => (
                          <div className="due" key={s.id}>
                            <div className="due-day">{s.day}</div>
                            <div>
                              <b>{s.name}</b>
                              <small>{name(s.account)}</small>
                            </div>
                            <strong className="red">{usd(s.amount)}</strong>
                          </div>
                        ))}
                      {!pendingExpenses.length &&
                        empty("No more scheduled charges this month.")}
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Recent activity</h2>
                      <button
                        className="text-button"
                        onClick={() => setPage("transactions")}
                      >
                        View all →
                      </button>
                    </div>
                    {recent.slice(0, 5).map((t) => (
                      <div key={t.id}>
                        {row(
                          transactionTitle(t),
                          `${t.date} · ${transactionAccounts(t)}`,
                          transactionValue(t),
                          () => open("transaction", t),
                          undefined,
                          "Edit",
                          transactionTone(t),
                        )}
                      </div>
                    ))}
                    {!recent.length &&
                      empty(
                        "Start with an account, income source or transaction.",
                      )}
                  </section>
                </>
              )}
              {page === "accounts" && (
                <>
                  {section("Accounts", "Track your cash and credit cards in one place.", "account")}
                  {tabs([
                    { id: "banks", label: "Bank & cash" },
                    { id: "cards", label: "Credit cards" },
                  ], accountTab, setAccountTab, "Account types")}
                  {accountTab === "banks" && <>
                  <div className="tiles">
                    {bank.map((a) => (
                      <div className="tile" key={a.id}>
                        <Landmark size={24} />
                        <small>{a.isSavings ? "SAVINGS ACCOUNT" : "BANK ACCOUNT"}</small>
                        <h2>{a.name}</h2>
                        <strong className={bal[a.id] < 0 ? "red" : "green"}>{usd(bal[a.id])}</strong>
                        <p>Opening: {usd(a.opening)}</p>
                        {a.isSavings && <p>Excluded from safe to spend</p>}
                        <div>
                          <button
                            onClick={() =>
                              open("account", { ...a, amount: a.opening })
                            }
                          >
                            Edit
                          </button>
                          <button onClick={() => archiveAccount(a)}>
                            Archive
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!bank.length && !archivedBank.length &&
                    empty("Add a checking or savings account to get started.")}
                  {archivedBank.length > 0 && (
                    <section className="panel">
                      <h2>Archived accounts</h2>
                      {archivedBank.map((account) => (
                        <div key={account.id}>{row(
                          account.name,
                          "Transaction history is retained",
                          usd(bal[account.id]),
                          () => restoreAccount(account),
                          undefined,
                          "Restore",
                        )}</div>
                      ))}
                    </section>
                  )}
                  <div className="notice">
                    Mark a bank account as savings to keep its balance outside safe to spend. Reconcile differences with an adjustment transaction.
                  </div>
                  </>}
                  {accountTab === "cards" && <>
                  <div className="tiles">
                    {cards.map((a) => (
                      <div className="tile card-tile" key={a.id}>
                        <CreditCard size={24} />
                        <small>CREDIT CARD</small>
                        <h2>{a.name}</h2>
                        <strong className={bal[a.id] > 0 ? "red" : "green"}>{usd(bal[a.id])}</strong>
                        <p>
                          Statement snapshot (manual): {usd(a.statement || 0)} · Day{" "}
                          {a.due || 1}
                        </p>
                        <p>Paid from {name(a.payFrom)}</p>
                        <div>
                          <button
                            onClick={() =>
                              open("account", { ...a, amount: a.opening })
                            }
                          >
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              open("transaction", {
                                type: "payment",
                                account: a.payFrom,
                                to: a.id,
                                date: now(),
                              })
                            }
                          >
                            Pay
                          </button>
                          <button onClick={() => archiveAccount(a)}>
                            Archive
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!cards.length && !archivedCards.length && empty("Add your first credit card.")}
                  {archivedCards.length > 0 && (
                    <section className="panel">
                      <h2>Archived cards</h2>
                      {archivedCards.map((account) => (
                        <div key={account.id}>{row(
                          account.name,
                          "Transaction history is retained",
                          usd(bal[account.id]),
                          () => restoreAccount(account),
                          undefined,
                          "Restore",
                        )}</div>
                      ))}
                    </section>
                  )}
                  </>}
                </>
              )}
              {page === "planning" && (
                <>
                  {section("Planning", "Stay on top of bills, budgets, goals and trips.")}
                  {tabs([
                    { id: "recurring", label: "Recurring" },
                    { id: "budgets", label: "Budgets" },
                    { id: "goals", label: "Goals" },
                    { id: "trips", label: "Trips" },
                  ], planningTab, setPlanningTab, "Planning sections")}
                  {planningTab === "recurring" && <>
                  {section("Recurring income & bills", "Monthly entries post when you open the app.", "schedule", true)}
                  <section className="panel">
                    {d.schedules.map((s) => (
                      <div key={s.id}>
                        {row(
                          s.name,
                          `${s.type} · Day ${s.day} · ${name(s.account)}`,
                          usd(s.amount),
                          () => open("schedule", s),
                          () => remove("schedules", s.id),
                          "Edit",
                          s.type === "income" ? "green" : "red",
                        )}
                      </div>
                    ))}
                    {!d.schedules.length &&
                      empty("Add salary, rent, utilities and subscriptions.")}
                  </section>
                  <div className="notice">
                    Each schedule posts once per month on or after its due date
                    when you open the site. Past entries remain if a schedule
                    changes.
                  </div>
                  </>}
                </>
              )}
              {page === "transactions" && (
                <>
                  {section(
                    "Transactions",
                    "Your complete history, with transfers excluded from spending.",
                    "transaction",
                  )}
                  <div className="toolbar">
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                    />
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          [
                            [
                              "Date",
                              "Type",
                              "Amount",
                              "Account",
                              "Destination",
                              "Group",
                              "Subgroup",
                              "Note",
                              "Trip",
                            ],
                            ...d.transactions.map((t) => [
                              t.date,
                              t.type,
                              t.amount / 100,
                              name(t.account),
                              name(t.to),
                              t.category,
                              t.sub,
                              t.note,
                              d.trips.find((trip) => trip.id === t.trip)?.name || t.trip,
                            ]),
                          ],
                          "my-money-transactions.csv",
                        )
                      }
                    >
                      <Download size={16} /> Export all CSV
                    </button>
                  </div>
                  <button className="secondary category-toggle" type="button" aria-expanded={showCategories}
                    onClick={() => setShowCategories((visible) => !visible)}>
                    {showCategories ? "Hide categories" : "Manage categories"}
                  </button>
                  {showCategories && <>
                  <div className="section-heading second">
                    <div>
                      <h2>Groups & subgroups</h2>
                      <p>Customize how expenses are classified.</p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => open("category", { name: "", sub: "" })}
                    >
                      + Add category
                    </button>
                  </div>
                  <section className="panel categories-panel">
                    {Object.entries(d.categories).map(([g, subs]) => (
                      <div className="category-group" key={g}>
                        <div className="category-group-header">
                          <div className="category-title-wrap">
                            <span className="category-icon" aria-hidden="true">
                              {d.categoryIcons?.[g] || categoryIcons[g] || "📁"}
                            </span>
                            <b>{g}</b>
                          </div>
                          <button
                            className="secondary small"
                            onClick={() => open("category", { name: g, sub: "" })}
                          >
                            + Subcategory
                          </button>
                        </div>
                        <div className="subcategory-list">
                          {subs.map((sub) => (
                            <span className="subcategory-pill" key={`${g}-${sub}`}>
                              <span className="subcategory-icon" aria-hidden="true">{d.subcategoryIcons[g]?.[sub] || "🏷️"}</span>
                              {sub}
                              <button
                                type="button"
                                className="subcategory-edit"
                                onClick={() => open("category", { name: g, sub, subIcon: d.subcategoryIcons[g]?.[sub] || "🏷️", editingSub: true })}
                                aria-label={`Edit ${sub} icon`}
                              >✎</button>
                              <button
                                type="button"
                                className="subcategory-remove"
                                onClick={() => removeCategorySubgroup(g, sub)}
                                aria-label={`Remove ${sub}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                  </>}
                  <section className="panel">
                    {period
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((t) => (
                        <div key={t.id}>
                          {row(
                            transactionTitle(t),
                            `${t.date} · ${t.type} · ${transactionAccounts(t)}`,
                            transactionValue(t),
                            () => open("transaction", t),
                            () => remove("transactions", t.id),
                            "Edit",
                            transactionTone(t),
                          )}
                        </div>
                      ))}
                    {!period.length && empty("No transactions in this period.")}
                  </section>

                </>
              )}
              {page === "planning" && planningTab === "budgets" && (
                <>
                  {section(
                    "Category budgets",
                    "Monthly category spending limits.",
                    "budget",
                    true,
                  )}
                  <section className="panel">
                    {d.budgets.map((b) => (
                      <div className="budget-row" key={b.id}>
                        <div className="budget-top">
                          <b>{b.category}</b>
                          <span>
                            <b className="red">{usd(catSpent(b.category))}</b> / {usd(b.amount)}{" "}
                            <button onClick={() => open("budget", b)}>✎</button>
                            <button onClick={() => remove("budgets", b.id)}>
                              ×
                            </button>
                          </span>
                        </div>
                        <div className="bar">
                          <div
                            style={{
                              width: `${Math.min(100, b.amount ? (catSpent(b.category) / b.amount) * 100 : 0)}%`,
                              background:
                                catSpent(b.category) > b.amount
                                  ? "#dc6868"
                                  : undefined,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {!d.budgets.length &&
                      empty("Set category limits to see budget progress.")}
                  </section>


                </>
              )}
              {page === "planning" && planningTab === "goals" && (
                <>
                  <div className="section-heading second">
                    <div>
                      <h2>Savings goals</h2>
                      <p>Track monthly contributions and progress toward each target.</p>
                    </div>
                    <button className="secondary" onClick={() => open("goal")}>
                      + Add goal
                    </button>
                  </div>
                  {(!savingsBank.length || !spendingBank.length) && <div className="notice savings-setup">
                    Mark one bank account as savings and keep another for spending before recording contributions.
                    <button className="text-button" onClick={() => { setPage("accounts"); setAccountTab("banks"); }}>Go to accounts →</button>
                  </div>}
                  <section className="panel">
                    {d.goals.map((g) => {
                      const progress = goalProgress(d, g.id, today);
                      const percent = g.amount > 0 ? Math.min(100, Math.max(0, progress.total / g.amount * 100)) : 0;
                      const reached = g.amount > 0 && progress.total >= g.amount;
                      const remaining = Math.max(0, g.monthly - Math.max(0, progress.month));
                      return <div className="goal-card" key={g.id}>
                        <div className="goal-head"><h3>{g.name}</h3><strong>{usd(Math.max(0, progress.total))} / {usd(g.amount)}</strong></div>
                        <div className="bar" role="progressbar" aria-label={`${g.name} progress`}
                          aria-valuenow={Math.round(percent)}
                          aria-valuemin={0} aria-valuemax={100}>
                          <div style={{ width: `${percent}%` }} />
                        </div>
                        <p>{reached ? "Goal reached · no further monthly reserve" : <>
                          This month: <b className={progress.month < 0 ? "red" : "green"}>{usd(progress.month)}</b>
                          {g.monthly > 0 ? ` of ${usd(g.monthly)} planned${remaining > 0 ? ` · ${usd(remaining)} left` : ""}` : " · No monthly amount set"}
                        </>}</p>
                        <div className="goal-actions">
                          <button className="primary" disabled={!savingsBank.length || !spendingBank.length || reached}
                            onClick={() => open("transaction", { type: "transfer", date: today, account: spendingBank[0]?.id, to: savingsBank[0]?.id, goal: g.id })}>
                            <Plus size={16} /> Add contribution
                          </button>
                          <button className="secondary" onClick={() => open("goal", g)}>Edit goal</button>
                          <button className="secondary" onClick={() => remove("goals", g.id)}>Delete</button>
                        </div>
                      </div>;
                    })}
                    {!d.goals.length && empty("Create a goal to plan monthly savings.")}
                  </section>
                  <div className="notice">Record a transfer here after moving money at your bank. Transfers are excluded from income and expenses.</div>
                </>
              )}
              {page === "planning" && planningTab === "trips" && (
                <>
                  {section(
                    "Trips",
                    "Trip expenses are also counted in your monthly finances.",
                    "trip",
                    true,
                  )}
                  <div className="tiles">
                    {d.trips.map((t) => {
                      const spent = d.transactions
                        .filter((x) => x.trip === t.id && x.type === "expense")
                        .reduce((a, x) => a + x.amount, 0);
                      return (
                        <div className="tile" key={t.id}>
                          <Plane size={24} />
                          <small>{t.destination}</small>
                          <h2>{t.name}</h2>
                          <strong className="red">
                            {usd(spent)} <small>/ {usd(t.budget)}</small>
                          </strong>
                          <div className="bar">
                            <div
                              style={{
                                width: `${Math.min(100, t.budget ? (spent / t.budget) * 100 : 0)}%`,
                              }}
                            />
                          </div>
                          <p>
                            {t.start} to {t.end}
                          </p>
                          <div>
                            <button
                              onClick={() =>
                                open("transaction", {
                                  type: "expense",
                                  trip: t.id,
                                  date: now(),
                                })
                              }
                            >
                              Add expense
                            </button>
                            <button onClick={() => open("trip", t)}>
                              Edit
                            </button>
                            <button onClick={() => remove("trips", t.id)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!d.trips.length &&
                    empty("Plan your next trip with a separate budget.")}
                </>
              )}
              {page === "reports" && (
                <>
                  {section(
                    "Reports & insights",
                    "A clear account of your monthly or yearly financial activity.",
                  )}
                  <p className="report-period">Period: {annual ? month.slice(0, 4) : month}</p>
                  <div className="toolbar">
                    <div className="month-switch">
                      <button type="button" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">
                        <ChevronLeft size={18} />
                      </button>
                      <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value || mid(now()))}
                        aria-label="Select month"
                      />
                      <button type="button" onClick={() => setMonth(shift(month, 1))} aria-label="Next month">
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    <button className="secondary" type="button" onClick={() => setMonth(mid(now()))}>
                      This month
                    </button>
                    <div className="segmented">
                      <button
                        className={!annual ? "selected" : ""}
                        onClick={() => setAnnual(false)}
                      >
                        Monthly
                      </button>
                      <button
                        className={annual ? "selected" : ""}
                        onClick={() => setAnnual(true)}
                      >
                        Yearly
                      </button>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => window.print()}
                    >
                      <Download size={16} /> Save as PDF
                    </button>
                  </div>
                  <div className="stats">
                    <div className="stat">
                      <span>Income</span>
                      <strong className="green">{usd(income)}</strong>
                    </div>
                    <div className="stat">
                      <span>Spending</span>
                      <strong className="red">{usd(spent)}</strong>
                    </div>
                    <div className="stat">
                      <span>Surplus</span>
                      <strong className={income >= spent ? "green" : "red"}>{usd(income - spent)}</strong>
                    </div>
                    <div className="stat">
                      <span>Saved toward goals</span>
                      <strong className={savedInPeriod < 0 ? "red" : "green"}>{usd(savedInPeriod)}</strong>
                    </div>
                  </div>
                  <section className="panel chart-panel">
                    <div className="panel-head">
                      <h2>Income and expenses over time</h2>
                      <span className="tag">{annual ? "Jan–Dec" : "Last 6 months"}</span>
                    </div>
                    <CashflowChart transactions={d.transactions} endMonth={annual ? `${month.slice(0, 4)}-12` : month} count={annual ? 12 : 6} format={usd} showBreakdown />
                  </section>
                  <div className="columns">
                    <section className="panel">
                      <h2>Spending by category</h2>
                      <CategoryDonut transactions={period} format={usd} />
                    </section>
                    <section className="panel">
                      <h2>Ways to save</h2>
                      {!annual && d.budgets
                        .filter((b) => catSpent(b.category) > b.amount)
                        .map((b) => (
                          <div className="insight" key={b.id}>
                            Your {b.category} spending exceeds its limit by{" "}
                            {usd(catSpent(b.category) - b.amount)}.
                          </div>
                        ))}
                      {annual && d.budgets.length > 0 && (
                        <div className="insight">Switch to Monthly to check spending against monthly category limits.</div>
                      )}
                      {d.schedules.some((s) => s.type === "expense") && (
                        <div className="insight">
                          Review{" "}
                          {usd(
                            d.schedules
                              .filter((s) => s.type === "expense")
                              .reduce((a, s) => a + s.amount, 0),
                          )}{" "}
                          in monthly recurring charges for possible savings.
                        </div>
                      )}
                      {income > 0 && (
                        <div className="insight">
                          Your recorded surplus is{" "}
                          {Math.round(((income - spent) / income) * 100)}% of
                          income.
                        </div>
                      )}
                      {!d.budgets.length &&
                        !income &&
                        !spent &&
                        empty("Insights appear as you record activity.")}
                    </section>
                  </div>
                  <div className="notice">
                    Reports include posted transactions only. Transfers and card
                    repayments are not expenses. Use your browser's Save as PDF
                    option.
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>
      {modal && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal("");
          }}
        >
          <div className="dialog">
            <div className="dialog-title">
              <h2>
                {f.editingSub === "true" ? "Edit subcategory icon" : `${f.id ? "Edit" : "Add"} ${modal}`}
              </h2>
              <button onClick={() => setModal("")}>
                <X size={20} />
              </button>
            </div>
            {error && <div className="error dialog-error" role="alert">{error}</div>}
            <div className="fields">
              {modal === "account" && (
                <>
                  {field("Account name", "name")}
                  {f.id ? (
                    <label className="field">
                      <span>Account type</span>
                      <input value={f.type === "card" ? "Credit card" : "Bank / cash"} readOnly />
                    </label>
                  ) : field("Account type", "type", "select", [
                    { value: "bank", label: "Bank / cash" },
                    { value: "card", label: "Credit card" },
                  ])}
                  {field(
                    "Opening balance or card debt ($)",
                    "amount",
                    "number",
                  )}
                  {f.type === "card" && (
                    <>
                      {field("Credit limit ($)", "limit", "number")}
                      {field("Statement amount due ($)", "statement", "number")}
                      {field("Due day (1–31)", "due", "number")}
                      {field("Pay from bank", "payFrom", "select", bankOptions)}
                    </>
                  )}
                  {f.type === "bank" && <label className="account-check">
                    <input type="checkbox" checked={f.isSavings === "true"}
                      onChange={(event) => setF({ ...f, isSavings: String(event.target.checked) })} />
                    <span><strong>Use as savings account</strong><small>Exclude this balance from safe to spend and use it for goal contributions.</small></span>
                  </label>}
                </>
              )}
              {modal === "transaction" && (
                <>
                  <div className="field">
                    <span>Type</span>
                    <div className="kind-switch" role="group" aria-label="Transaction type">
                      <button type="button" className={!showOtherTypes && (f.type || "expense") === "expense" ? "selected" : ""}
                        onClick={() => { setShowOtherTypes(false); setF({ ...f, type: "expense", account: "", to: "" }); }}>Expense</button>
                      <button type="button" className={!showOtherTypes && f.type === "income" ? "selected" : ""}
                        onClick={() => { setShowOtherTypes(false); setF({ ...f, type: "income", account: "", to: "" }); }}>Income</button>
                      <button type="button" className={showOtherTypes ? "selected" : ""}
                        onClick={() => { setShowOtherTypes(true); setF({ ...f, type: showOtherTypes ? f.type : "transfer", account: "", to: "" }); }}>More</button>
                    </div>
                  </div>
                  {showOtherTypes && field("Other type", "type", "select", [
                    { value: "transfer", label: "Transfer between accounts" },
                    { value: "payment", label: "Credit card repayment" },
                    { value: "adjustment", label: "Balance adjustment (+/−)" },
                  ])}
                  {field("Amount ($)", "amount", "number")}
                  {field("Date", "date", "date")}
                  {field(
                    f.type === "payment" ? "Pay from" : f.type === "transfer" ? "Move from" : f.type === "income" ? "Receive in" : f.type === "expense" ? "Charge to" : "Account",
                    "account",
                    "select",
                    withArchived(
                      ["payment", "transfer", "income"].includes(f.type) ? bankOptions : accountOptions,
                      originalTransaction?.account,
                    ),
                  )}
                  {["payment", "transfer"].includes(f.type) &&
                    field(
                      f.type === "payment" ? "Pay card" : "Move to",
                      "to",
                      "select",
                      withArchived(
                        f.type === "payment" ? cardOptions : bankOptions,
                        originalTransaction?.to,
                      ),
                    )}
                  {f.type === "transfer" && (d.goals.length > 0 || f.goal) && <>
                    {field("Savings goal (optional)", "goal", "select", [
                      ...d.goals.map((goal) => ({ value: goal.id, label: goal.name })),
                      ...(f.goal && !d.goals.some((goal) => goal.id === f.goal)
                        ? [{ value: f.goal, label: "Deleted goal (historical)" }] : []),
                    ])}
                    <small className="field-hint">Link a transfer between a spending account and a savings account. Transfers into savings add to the goal; withdrawals reduce it.</small>
                  </>}
                  {(!f.type || f.type === "expense") && (
                    <>
                      <label className="field">
                        <span>Group</span>
                        <select aria-label="Group" value={f.category || ""} onChange={(e) => setF({
                          ...f,
                          category: e.target.value,
                          sub: "",
                          newCategory: "",
                          newSub: "",
                          newCategoryIcon: "📁",
                          newSubIcon: "🏷️",
                        })}>
                          <option value="">Select…</option>
                          {groups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}
                          <option value="__new__">+ Create new group</option>
                        </select>
                      </label>
                      {f.category === "__new__" && (
                        <div className="inline-category-fields">
                          {field("New group name", "newCategory")}
                          {field("Group icon", "newCategoryIcon", "select", categoryIconOptions.map((icon) => ({ value: icon, label: icon })))}
                        </div>
                      )}
                      <label className="field">
                        <span>Subcategory</span>
                        <select aria-label="Subcategory" value={f.sub || ""} disabled={!f.category} onChange={(e) => setF({
                          ...f,
                          sub: e.target.value,
                          newSub: "",
                          newSubIcon: "🏷️",
                        })}>
                          <option value="">None</option>
                          {(d.categories[f.category] || []).map((sub) => (
                            <option key={sub} value={sub}>{d.subcategoryIcons[f.category]?.[sub] || "🏷️"} {sub}</option>
                          ))}
                          <option value="__new__">+ Create new subcategory</option>
                        </select>
                      </label>
                      {f.sub === "__new__" && (
                        <div className="inline-category-fields">
                          {field("New subcategory name", "newSub")}
                          {field("Subcategory icon", "newSubIcon", "select", subcategoryIconOptions.map((icon) => ({ value: icon, label: icon })))}
                        </div>
                      )}
                      {field(
                        "Trip (optional)",
                        "trip",
                        "select",
                        d.trips.map((x) => ({ value: x.id, label: x.name })),
                      )}
                    </>
                  )}
                  {field("Description", "note")}
                </>
              )}
              {modal === "schedule" && (
                <>
                  {field("Name", "name")}
                  {field("Type", "type", "select", [
                    { value: "income", label: "Income" },
                    { value: "expense", label: "Expense" },
                  ])}
                  {field("Monthly amount ($)", "amount", "number")}
                  {field("Day of month (1–31)", "day", "number")}
                  {field("Start date", "start", "date")}
                  {field("Bank or card", "account", "select", accountOptions)}
                  {f.type !== "income" && (
                    <>
                      {field("Group", "category", "select", groups)}
                      {field(
                        "Subgroup",
                        "sub",
                        "select",
                        (d.categories[f.category] || []).map((x) => ({
                          value: x,
                          label: `${d.subcategoryIcons[f.category]?.[x] || "🏷️"} ${x}`,
                        })),
                      )}
                    </>
                  )}
                </>
              )}
              {modal === "budget" && (
                <>
                  {field("Category", "category", "select", groups)}
                  {field("Monthly limit ($)", "amount", "number")}
                </>
              )}
              {modal === "goal" && (
                <>
                  {field("Goal name", "name")}
                  {field("Total target ($)", "amount", "number")}
                  {field("Monthly reserve ($)", "monthly", "number")}
                  {field("Already saved ($)", "starting", "number")}
                  <small className="field-hint">The monthly reserve reduces safe to spend until you record a contribution. Already saved counts toward the goal but not this month's contribution.</small>
                </>
              )}
              {modal === "trip" && (
                <>
                  {field("Trip name", "name")}
                  {field("Destination", "destination")}
                  {field("Start date", "start", "date")}
                  {field("End date", "end", "date")}
                  {field("Trip budget ($)", "budget", "number")}
                </>
              )}
              {modal === "category" && (
                <>
                  {f.editingSub === "true" ? (
                    <>
                      <p className="category-edit-context">{f.name} / {f.sub}</p>
                      {field("Subgroup icon", "subIcon", "select", subcategoryIconOptions.map((icon) => ({ value: icon, label: icon })))}
                    </>
                  ) : (
                    <>
                  <label className="field">
                    <span>Existing group or new group</span>
                    <select
                      value={f.name || f.category || ""}
                      onChange={(e) => {
                        const selected = e.target.value;
                        setF({
                          ...f,
                          name: selected,
                          category: selected,
                          icon:
                            d.categoryIcons?.[selected] ||
                            categoryIcons[selected] ||
                            "📁",
                        });
                      }}
                    >
                      <option value="">Create a new category…</option>
                      {groups.map((g) => (
                        <option key={g.value} value={g.value}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field("Group name", "name")}
                  <label className="field">
                    <span>Category icon</span>
                    <select
                      value={
                        f.icon ||
                        d.categoryIcons?.[f.name || f.category || ""] ||
                        categoryIcons[f.name || f.category || ""] ||
                        "📁"
                      }
                      onChange={(e) => setF({ ...f, icon: e.target.value })}
                    >
                      {categoryIconOptions.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field("Subgroup name", "sub")}
                  {f.sub && field("Subgroup icon", "subIcon", "select", subcategoryIconOptions.map((icon) => ({ value: icon, label: icon })))}
                    </>
                  )}
                </>
              )}
            </div>
            <div className="dialog-buttons">
              <button className="secondary" onClick={() => setModal("")}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={submit}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [rememberMe, setRememberMe] = useState(() => {
      if (typeof window === "undefined") return true;
      return window.localStorage.getItem("my-money-remember-session") === "true";
    }),
    [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in"),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!configured) {
      setChecking(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setChecking(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => subscription.unsubscribe();
  }, []);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (mode === "sign-up") {
      if (password !== confirmPassword) {
        setMessage("Passwords do not match.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
      } else if (data.user && !data.session) {
        setMessage("Account created. Check your email to confirm registration.");
      } else {
        setMessage("Account created successfully. You can sign in now.");
        setMode("sign-in");
      }
      setLoading(false);
      return;
    }

    setRememberSession(rememberMe);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setMessage(error.message);
    setLoading(false);
  }
  if (checking)
    return (
      <div className="auth-page">
        <div className="auth-card">Checking your session…</div>
      </div>
    );
  if (user) return <MoneyApp key={user.id} user={user} />;
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Wallet size={25} />
        </div>
        <h1>
          my<span>money</span>
        </h1>
        <p>Your personal finance workspace</p>
        {!configured ? (
          <div className="error">
            Supabase connection isn't configured yet. Set the GitHub Actions
            variables shown in README.
          </div>
        ) : (
          <form onSubmit={signIn}>
            <div className="auth-toggle">
              <button
                type="button"
                className={mode === "sign-in" ? "active" : ""}
                onClick={() => setMode("sign-in")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "sign-up" ? "active" : ""}
                onClick={() => setMode("sign-up")}
              >
                Sign up
              </button>
            </div>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                placeholder="Your password"
              />
            </label>
            {mode === "sign-up" && (
              <label>
                Confirm password
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                />
              </label>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => {
                  const next = e.target.checked;
                  setRememberMe(next);
                  setRememberSession(next);
                }}
              />
              Stay signed in
            </label>
            {message && <div className="error">{message}</div>}
            <button className="primary" type="submit" disabled={loading}>
              {loading
                ? mode === "sign-up"
                  ? "Creating account…"
                  : "Signing in…"
                : mode === "sign-up"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
        )}
        <small>Private personal wallet · Secure sign-in</small>
      </div>
    </div>
  );
}
