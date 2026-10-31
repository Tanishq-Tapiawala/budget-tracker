import { useState } from "react";
import type { Item } from "./ledger";
import { categoryTotals, monthlyFlow } from "./ledger";

const formatMonth = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
const formatMonthLong = (month: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
const colors = ["#d94e53", "#ed8062", "#e8b35b", "#8b75c8", "#5596bb", "#a1aeb6"];

export function CashflowChart({
  transactions,
  endMonth,
  count,
  format,
  showBreakdown = false,
}: {
  transactions: Item[];
  endMonth: string;
  count: number;
  format: (amount: number) => string;
  showBreakdown?: boolean;
}) {
  const [selectedMonth, setSelectedMonth] = useState(endMonth);
  const points = monthlyFlow(transactions, endMonth, count);
  const selected = points.find((point) => point.month === selectedMonth) || points[points.length - 1];
  const highest = Math.max(1, ...points.flatMap((point) => [point.income, point.expense]));
  const totalIncome = points.reduce((sum, point) => sum + point.income, 0);
  const totalExpense = points.reduce((sum, point) => sum + point.expense, 0);
  return (
    <div className="chart-frame">
      <div className="chart-summary">
        <span className="green">● Income {format(totalIncome)}</span>
        <span className="red">● Expenses {format(totalExpense)}</span>
      </div>
      <div className="chart-scroll">
        <div
          className="flow-chart"
          style={{ minWidth: count > 6 ? 640 : 0 }}
          role="group"
          aria-label="Income and expenses by month"
        >
          {points.map((point) => (
            <button type="button" className={`flow-month ${selected.month === point.month ? "selected" : ""}`}
              key={point.month} aria-pressed={selected.month === point.month}
              aria-label={`${formatMonthLong(point.month)}: income ${format(point.income)}, expenses ${format(point.expense)}`}
              onClick={() => setSelectedMonth(point.month)}>
              <div className="flow-bars">
                <div
                  className="flow-bar income-bar"
                  style={{ height: `${Math.max(point.income > 0 ? 2 : 0, (point.income / highest) * 100)}%` }}
                  title={`${point.month} income: ${format(point.income)}`}
                />
                <div
                  className="flow-bar expense-bar"
                  style={{ height: `${Math.max(point.expense > 0 ? 2 : 0, (point.expense / highest) * 100)}%` }}
                  title={`${point.month} expenses: ${format(point.expense)}`}
                />
              </div>
              <span>{formatMonth(point.month)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flow-selected" aria-live="polite">
        <strong>{formatMonthLong(selected.month)}</strong>
        <span className="green">Income {format(selected.income)}</span>
        <span className="red">Expenses {format(selected.expense)}</span>
      </div>
      {showBreakdown && <div className="chart-breakdown">
        <h3>Monthly amounts</h3>
        <div className="chart-table-scroll"><table>
          <thead><tr><th>Month</th><th>Income</th><th>Expenses</th></tr></thead>
          <tbody>{points.map((point) => <tr key={point.month}>
            <th scope="row">{formatMonthLong(point.month)}</th>
            <td className="green">{format(point.income)}</td>
            <td className="red">{format(point.expense)}</td>
          </tr>)}</tbody>
        </table></div>
      </div>}
    </div>
  );
}

export function CategoryDonut({
  transactions,
  format,
}: {
  transactions: Item[];
  format: (amount: number) => string;
}) {
  const rows = categoryTotals(transactions);
  const visible = rows.length > 6
    ? [...rows.slice(0, 5), { category: "Other categories", amount: rows.slice(5).reduce((sum, row) => sum + row.amount, 0) }]
    : rows;
  const total = visible.reduce((sum, row) => sum + row.amount, 0);
  const circumference = 2 * Math.PI * 54;
  let offset = 0;
  return (
    <div className="donut-layout">
      <svg className="donut-chart" viewBox="0 0 160 160" role="img" aria-label={total ? `Spending by category: ${visible.map((row) => `${row.category} ${format(row.amount)}`).join(", ")}` : "No expenses in this period"}>
        <circle cx="80" cy="80" r="54" fill="none" stroke="#edf1ef" strokeWidth="24" />
        {visible.map((row, index) => {
          const length = total ? (row.amount / total) * circumference : 0;
          const segment = (
            <circle
              key={row.category}
              cx="80"
              cy="80"
              r="54"
              fill="none"
              stroke={colors[index]}
              strokeWidth="24"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += length;
          return segment;
        })}
        <text x="80" y="76" textAnchor="middle" className="donut-label">Spent</text>
        <text x="80" y="96" textAnchor="middle" className="donut-total">{format(total)}</text>
      </svg>
      <div className="donut-legend">
        {visible.length ? visible.map((row, index) => (
          <div className="donut-legend-row" key={row.category}>
            <span className="legend-dot" style={{ backgroundColor: colors[index] }} />
            <span>{row.category}</span>
            <strong>{format(row.amount)}</strong>
          </div>
        )) : <p>No expenses in this period.</p>}
      </div>
    </div>
  );
}
