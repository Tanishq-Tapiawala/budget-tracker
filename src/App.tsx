"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  LayoutDashboard,
  Landmark,
  CreditCard,
  Repeat,
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
type Item = { id: string; [key: string]: any };
type Data = {
  accounts: Item[];
  transactions: Item[];
  schedules: Item[];
  budgets: Item[];
  trips: Item[];
  goals: Item[];
  categories: Record<string, string[]>;
  categoryIcons: Record<string, string>;
};
const blank: Data = {
  accounts: [],
  transactions: [],
  schedules: [],
  budgets: [],
  trips: [],
  goals: [],
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
  { id: "accounts", label: "Bank accounts", icon: Landmark },
  { id: "cards", label: "Credit cards", icon: CreditCard },
  { id: "schedules", label: "Recurring", icon: Repeat },
  { id: "transactions", label: "Transactions", icon: Receipt },
  { id: "budgets", label: "Budgets", icon: ChartPie },
  { id: "trips", label: "Trips", icon: Plane },
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
const dateFor = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  return (
    m +
    "-" +
    String(
      Math.min(Math.max(1, d), new Date(Date.UTC(y, mo, 0)).getUTCDate()),
    ).padStart(2, "0")
  );
};
const id = () => crypto.randomUUID();
function balances(d: Data) {
  const b: Record<string, number> = {};
  d.accounts.forEach((a) => (b[a.id] = a.opening || 0));
  d.transactions.forEach((t) => {
    if (!(t.account in b)) return;
    if (t.type === "income" || t.type === "adjustment")
      b[t.account] += t.amount;
    else if (t.type === "expense")
      b[t.account] +=
        d.accounts.find((a) => a.id === t.account)?.type === "card"
          ? t.amount
          : -t.amount;
    else if (t.type === "transfer" || t.type === "payment") {
      b[t.account] -= t.amount;
      if (t.to in b) b[t.to] += t.type === "payment" ? -t.amount : t.amount;
    }
  });
  return b;
}
function postDue(d: Data) {
  let dirty = false;
  const transactions = [...d.transactions],
    known = new Set(transactions.map((t) => t.source));
  for (const s of d.schedules) {
    let m = mid(s.start || now()),
      end = mid(now()),
      guard = 0;
    while (m <= end && guard++ < 120) {
      const due = dateFor(m, s.day);
      const source = `${s.id}:${m}`;
      if (due >= s.start && due <= now() && !known.has(source)) {
        transactions.push({
          id: id(),
          date: due,
          type: s.type,
          amount: s.amount,
          account: s.account,
          category: s.category,
          sub: s.sub,
          note: s.name,
          source,
        });
        known.add(source);
        dirty = true;
      }
      m = shift(m, 1);
    }
  }
  return dirty ? { ...d, transactions } : d;
}
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
    [page, setPage] = useState("dashboard"),
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
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("user_ledgers")
          .select("payload,revision")
          .eq("owner_id", user.id)
          .maybeSingle();
        if (error) throw error;
        setD(data?.payload ? { ...blank, ...data.payload, categoryIcons: { ...blank.categoryIcons, ...(data.payload.categoryIcons || {}) } } : blank);
        setRev(data?.revision ?? 0);
        setReady(true);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [user.id]);
  async function save(next: Data) {
    setBusy(true);
    setError("");
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
      if (!result.data)
        throw Error(
          "Another device changed your data. Please refresh before editing.",
        );
      setD(next);
      setRev(result.data.revision);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!ready) return;
    const next = postDue(d);
    if (next !== d) void save(next);
  }, [ready]);
  const bal = useMemo(() => balances(d), [d]);
  const name = (key: string) =>
    d.accounts.find((a) => a.id === key)?.name || "Unknown";
  const bank = d.accounts.filter((a) => a.type === "bank"),
    cards = d.accounts.filter((a) => a.type === "card");
  const bankTotal = bank.reduce((a, x) => a + (bal[x.id] || 0), 0),
    debt = cards.reduce((a, x) => a + Math.max(0, bal[x.id] || 0), 0);
  const period = d.transactions.filter((t) =>
    annual ? t.date.startsWith(month.slice(0, 4)) : mid(t.date) === month,
  );
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
  const obligations = d.schedules
    .filter(
      (s) =>
        s.type === "expense" &&
        d.accounts.find((a) => a.id === s.account)?.type === "bank" &&
        dateFor(month, s.day) >= now(),
    )
    .reduce((a, s) => a + s.amount, 0);
  const safe =
    bankTotal - debt - obligations - d.goals.reduce((a, g) => a + g.monthly, 0);
  function open(type: string, entry: Item | Record<string, any> = {}) {
    setModal(type);
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
    if (!f.name && ["account", "schedule", "trip", "goal"].includes(modal)) {
      setError("Name is required");
      return;
    }
    let next = { ...d };
    if (modal === "account") {
      base.opening = v;
      base.limit = amount(f.limit);
      base.statement = amount(f.statement);
      next.accounts = [...d.accounts.filter((x) => x.id !== key), base];
    }
    if (modal === "transaction") {
      if (!f.account || !v) {
        setError("Choose an account and nonzero amount");
        return;
      }
      base.amount = v;
      base.date = f.date || now();
      base.type = f.type || "expense";
      next.transactions = [...d.transactions.filter((x) => x.id !== key), base];
    }
    if (modal === "schedule") {
      base.amount = v;
      base.day = Math.max(1, Math.min(31, Number(f.day) || 1));
      base.start = f.start || now();
      base.type = f.type || "expense";
      next.schedules = [...d.schedules.filter((x) => x.id !== key), base];
    }
    if (modal === "budget") {
      base.amount = v;
      next.budgets = [...d.budgets.filter((x) => x.id !== key), base];
    }
    if (modal === "goal") {
      base.amount = v;
      base.monthly = amount(f.monthly);
      next.goals = [...d.goals.filter((x) => x.id !== key), base];
    }
    if (modal === "trip") {
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
      next.categories = {
        ...d.categories,
        [group]: [
          ...new Set([...(d.categories[group] || []), ...(sub ? [sub] : [])]),
        ],
      };
      next.categoryIcons = {
        ...d.categoryIcons,
        [group]: icon,
      };
    }
    if (await save(next)) setModal("");
  }
  async function remove(type: keyof Data, key: string) {
    if (!confirm("Delete this item? Historical transactions will remain."))
      return;
    const arr = d[type];
    if (Array.isArray(arr))
      await save({ ...d, [type]: arr.filter((x) => x.id !== key) });
  }
  async function removeCategorySubgroup(group: string, sub: string) {
    const nextSubs = (d.categories[group] || []).filter((item) => item !== sub);
    const nextCategories = { ...d.categories, [group]: nextSubs };
    if (!nextSubs.length) {
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
            value={f[key] || ""}
            onChange={(e) => setF({ ...f, [key]: e.target.value })}
          />
        )}
      </label>
    );
  }
  const groups = Object.keys(d.categories).map((x) => ({ value: x, label: x })),
    accountOptions = d.accounts.map((x) => ({ value: x.id, label: x.name })),
    bankOptions = bank.map((x) => ({ value: x.id, label: x.name })),
    cardOptions = cards.map((x) => ({ value: x.id, label: x.name }));
  function row(
    title: string,
    description: string,
    value: string,
    edit: () => void,
    del?: () => void,
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
        <b>{value}</b>
        <button className="row-action" onClick={edit} aria-label="Edit">
          ✎
        </button>
        {del && (
          <button className="row-action red" onClick={del} aria-label="Delete">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    );
  }
  function section(title: string, sub: string, add?: string) {
    return (
      <div className="section-heading">
        <div>
          <h1>{title}</h1>
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
                    ? { type: page === "cards" ? "card" : "bank" }
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
  const empty = (text: string) => (
    <div className="empty">
      <Wallet size={27} />
      <p>{text}</p>
    </div>
  );
  const recent = [...d.transactions].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
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
          <div className="top-status">
            {busy ? "Saving…" : ready ? "Saved securely" : "Loading…"}
            <span className="avatar">M</span>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {!ready ? (
            empty("Loading your private finances…")
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
                      <Plus size={16} /> Transaction
                    </button>
                  </div>
                  <div className="stats">
                    {[
                      ["Bank balances", bankTotal, `${bank.length} accounts`],
                      ["Credit card debt", debt, `${cards.length} cards`],
                      [
                        "Recorded income",
                        income,
                        annual ? "This year" : "This month",
                      ],
                      ["Recorded expenses", spent, "Excludes repayments"],
                    ].map(([title, value, sub]) => (
                      <div className="stat" key={title}>
                        <span>{title}</span>
                        <strong>{usd(value as number)}</strong>
                        <small>{sub}</small>
                      </div>
                    ))}
                  </div>
                  <div className="columns">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Cash flow</h2>
                        <span className="tag">
                          {annual ? "Yearly" : "Monthly"}
                        </span>
                      </div>
                      <div className="cash-lines">
                        <div>
                          Income <b className="green">{usd(income)}</b>
                        </div>
                        <div>
                          Expenses <b>{usd(spent)}</b>
                        </div>
                        <div className="cash-surplus">
                          Net surplus{" "}
                          <b className={income >= spent ? "green" : "red"}>
                            {usd(income - spent)}
                          </b>
                        </div>
                      </div>
                      <h3>Category spending</h3>
                      {groups
                        .filter((g) => catSpent(g.value) > 0)
                        .sort((a, b) => catSpent(b.value) - catSpent(a.value))
                        .slice(0, 5)
                        .map((g) => (
                          <div className="progress" key={g.value}>
                            <div>
                              <span>{g.label}</span>
                              <b>{usd(catSpent(g.value))}</b>
                            </div>
                            <div className="bar">
                              <div
                                style={{
                                  width: `${spent ? (catSpent(g.value) / spent) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      {!spent &&
                        empty("Add transactions to see where your money goes.")}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Planning ahead</h2>
                        <Lightbulb size={20} />
                      </div>
                      <div className="safe">
                        <span>Estimated safe to spend</span>
                        <strong className={safe < 0 ? "red" : "green"}>
                          {usd(safe)}
                        </strong>
                        <small>
                          Cash less card debt, upcoming bank-paid bills and
                          monthly savings reserves.
                        </small>
                      </div>
                      <h3>Upcoming monthly commitments</h3>
                      {d.schedules
                        .filter((s) => s.type === "expense")
                        .slice(0, 5)
                        .map((s) => (
                          <div className="due" key={s.id}>
                            <div className="due-day">{s.day}</div>
                            <div>
                              <b>{s.name}</b>
                              <small>{name(s.account)}</small>
                            </div>
                            <strong>{usd(s.amount)}</strong>
                          </div>
                        ))}
                      {!d.schedules.length &&
                        empty("Set recurring bills to forecast commitments.")}
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
                          t.note || t.category || t.type,
                          `${t.date} · ${name(t.account)}`,
                          usd(t.amount),
                          () => open("transaction", t),
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
                  {section(
                    "Bank accounts",
                    "Track checking, savings and cash without bank integrations.",
                    "account",
                  )}
                  <div className="tiles">
                    {bank.map((a) => (
                      <div className="tile" key={a.id}>
                        <Landmark size={24} />
                        <small>BANK ACCOUNT</small>
                        <h2>{a.name}</h2>
                        <strong>{usd(bal[a.id])}</strong>
                        <p>Opening: {usd(a.opening)}</p>
                        <div>
                          <button
                            onClick={() =>
                              open("account", { ...a, amount: a.opening })
                            }
                          >
                            Edit
                          </button>
                          <button onClick={() => remove("accounts", a.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!bank.length &&
                    empty("Add a checking or savings account to get started.")}
                  <div className="notice">
                    Reconcile with an adjustment transaction when your real
                    balance differs.
                  </div>
                </>
              )}
              {page === "cards" && (
                <>
                  {section(
                    "Credit cards",
                    "Track purchases, amounts due and repayment accounts.",
                    "account",
                  )}
                  <div className="tiles">
                    {cards.map((a) => (
                      <div className="tile card-tile" key={a.id}>
                        <CreditCard size={24} />
                        <small>CREDIT CARD</small>
                        <h2>{a.name}</h2>
                        <strong>{usd(bal[a.id])}</strong>
                        <p>
                          Statement due: {usd(a.statement || 0)} · Day{" "}
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
                          <button onClick={() => remove("accounts", a.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!cards.length && empty("Add your first credit card.")}
                </>
              )}
              {page === "schedules" && (
                <>
                  {section(
                    "Recurring income & bills",
                    "Automatic monthly posting when you open the website.",
                    "schedule",
                  )}
                  <section className="panel">
                    {d.schedules.map((s) => (
                      <div key={s.id}>
                        {row(
                          s.name,
                          `${s.type} · Day ${s.day} · ${name(s.account)}`,
                          usd(s.amount),
                          () => open("schedule", s),
                          () => remove("schedules", s.id),
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
                              t.trip,
                            ]),
                          ],
                          "my-money-transactions.csv",
                        )
                      }
                    >
                      <Download size={16} /> Export CSV
                    </button>
                  </div>
                  <section className="panel">
                    {period
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((t) => (
                        <div key={t.id}>
                          {row(
                            t.note || t.sub || t.category || t.type,
                            `${t.date} · ${t.type} · ${name(t.account)}`,
                            usd(t.amount),
                            () => open("transaction", t),
                            () => remove("transactions", t.id),
                          )}
                        </div>
                      ))}
                    {!period.length && empty("No transactions in this period.")}
                  </section>
                </>
              )}
              {page === "budgets" && (
                <>
                  {section(
                    "Category budgets",
                    "Monthly spending limits and savings reserves.",
                    "budget",
                  )}
                  <section className="panel">
                    {d.budgets.map((b) => (
                      <div className="budget-row" key={b.id}>
                        <div className="budget-top">
                          <b>{b.category}</b>
                          <span>
                            {usd(catSpent(b.category))} / {usd(b.amount)}{" "}
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
                  <div className="section-heading second">
                    <div>
                      <h1>Savings targets</h1>
                      <p>Monthly amounts reserved from safe-to-spend.</p>
                    </div>
                    <button className="secondary" onClick={() => open("goal")}>
                      + Add goal
                    </button>
                  </div>
                  <section className="panel">
                    {d.goals.map((g) => (
                      <div key={g.id}>
                        {row(
                          g.name,
                          `Target ${usd(g.amount)}`,
                          `${usd(g.monthly)} / month`,
                          () => open("goal", g),
                          () => remove("goals", g.id),
                        )}
                      </div>
                    ))}
                    {!d.goals.length && empty("Create a savings goal.")}
                  </section>
                  <div className="section-heading second">
                    <div>
                      <h1>Groups & subgroups</h1>
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
                              <span className="category-dot" aria-hidden="true" />
                              {sub}
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
                </>
              )}
              {page === "trips" && (
                <>
                  {section(
                    "Trips",
                    "Trip expenses are also counted in your monthly finances.",
                    "trip",
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
                          <strong>
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
                      <strong>{usd(income)}</strong>
                    </div>
                    <div className="stat">
                      <span>Spending</span>
                      <strong>{usd(spent)}</strong>
                    </div>
                    <div className="stat">
                      <span>Surplus</span>
                      <strong>{usd(income - spent)}</strong>
                    </div>
                  </div>
                  <div className="columns">
                    <section className="panel">
                      <h2>Spending by category</h2>
                      {groups
                        .filter((g) => catSpent(g.value) > 0)
                        .sort((a, b) => catSpent(b.value) - catSpent(a.value))
                        .map((g) => (
                          <div className="progress" key={g.value}>
                            <div>
                              <span>{g.label}</span>
                              <b>{usd(catSpent(g.value))}</b>
                            </div>
                            <div className="bar">
                              <div
                                style={{
                                  width: `${spent ? (catSpent(g.value) / spent) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      {!spent && empty("No expenses in this period.")}
                    </section>
                    <section className="panel">
                      <h2>Ways to save</h2>
                      {d.budgets
                        .filter((b) => catSpent(b.category) > b.amount)
                        .map((b) => (
                          <div className="insight" key={b.id}>
                            Your {b.category} spending exceeds its limit by{" "}
                            {usd(catSpent(b.category) - b.amount)}.
                          </div>
                        ))}
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
                {f.id ? "Edit" : "Add"} {modal}
              </h2>
              <button onClick={() => setModal("")}>
                <X size={20} />
              </button>
            </div>
            <div className="fields">
              {modal === "account" && (
                <>
                  {field("Account name", "name")}
                  {field("Account type", "type", "select", [
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
                </>
              )}
              {modal === "transaction" && (
                <>
                  {field("Type", "type", "select", [
                    { value: "expense", label: "Expense" },
                    { value: "income", label: "Income" },
                    { value: "transfer", label: "Transfer" },
                    { value: "payment", label: "Credit card repayment" },
                    { value: "adjustment", label: "Balance adjustment (+/−)" },
                  ])}
                  {field("Amount ($)", "amount", "number")}
                  {field("Date", "date", "date")}
                  {field(
                    "Account",
                    "account",
                    "select",
                    f.type === "payment" ? bankOptions : accountOptions,
                  )}
                  {["payment", "transfer"].includes(f.type) &&
                    field(
                      "Destination",
                      "to",
                      "select",
                      f.type === "payment" ? cardOptions : bankOptions,
                    )}
                  {(!f.type || f.type === "expense") && (
                    <>
                      {field("Group", "category", "select", groups)}
                      {field(
                        "Subgroup",
                        "sub",
                        "select",
                        (d.categories[f.category] || []).map((x) => ({
                          value: x,
                          label: x,
                        })),
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
                          label: x,
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
        <small>Shared household wallet · Secure sign-in</small>
      </div>
    </div>
  );
}
