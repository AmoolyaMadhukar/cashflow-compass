import { useMemo, useState } from "react";
import type { Transaction } from "../types";
import { useApp } from "../store";
import { ALL_CATEGORIES } from "../lib/categorize";
import { downloadText, transactionsToCsv } from "../lib/csv";
import { daysBetween, money, shortDate, todayISO } from "../lib/format";
import { Badge, EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";
import { ReviewQueue } from "../components/ReviewQueue";
import { ContextHelp } from "../components/ContextHelp";

type Filter = "all" | "income" | "expense";

const PAGE = 12;

export function ActivityPage({
  onAdd,
  onImport,
  onEdit,
}: {
  onAdd: () => void;
  onImport: () => void;
  onEdit: (tx: Transaction) => void;
}) {
  const {
    today,
    transactions,
    expected,
    transfers,
    suggestions,
    reconciliation,
    matchExpected,
    setCategory,
    deleteTransaction,
    deleteExpected,
    deleteTransfer,
    cashToday,
    notify,
    workspace,
  } = useApp();

  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategoryFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showExpected, setShowExpected] = useState(true);
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return transactions
      .filter((tx) => filter === "all" || tx.direction === filter)
      .filter((tx) => category === "all" || tx.category === category)
      .filter((tx) => !search || tx.description.toLowerCase().includes(search))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, filter, category, query]);

  const totals = rows.reduce(
    (acc, tx) => {
      if (tx.direction === "income") acc.income += tx.amount;
      else acc.expense += tx.amount;
      return acc;
    },
    { income: 0, expense: 0 },
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, pageCount);
  const visible = rows.slice((safePage - 1) * PAGE, safePage * PAGE);

  if (transactions.length === 0 && expected.length === 0 && transfers.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Activity</p>
            <h1>Your ledger is empty.</h1>
            <p className="page-sub">Record what happened and what you expect. Both are needed for an honest forecast.</p>
          </div>
        </header>
        <div className="card">
          <EmptyState
            icon="list"
            title="No money recorded yet"
            body="Start with money you have already received, or import a statement. Expected money is added separately and always labelled as an estimate."
            action={
              <div className="button-row">
                <button className="btn btn-primary" onClick={onAdd}>
                  <Icon name="plus" size={16} /> Record money in
                </button>
                <button className="btn btn-secondary" onClick={onImport}>
                  <Icon name="upload" size={16} /> Import a CSV
                </button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Activity · {workspace.label}</p>
          <h1>What has actually happened.</h1>
          <p className="page-sub">
            {transactions.length} recorded entries · {money(cashToday)} spendable today
          </p>
        </div>
        <div className="button-row">
          <button className="btn btn-secondary btn-sm" onClick={() => downloadText("cashflow-activity.csv", transactionsToCsv(transactions))}>
            <Icon name="download" size={14} /> Export
          </button>
          <button className="btn btn-primary btn-sm" onClick={onAdd}>
            <Icon name="plus" size={15} /> Add
          </button>
        </div>
      </header>

      {reconciliation.length > 0 && (
        <section className="card reconcile-card" aria-labelledby="reconcile-title">
          <div className="card-head">
            <div>
              <h2 id="reconcile-title">Match expected money to recorded rows</h2>
              <p className="card-sub">
                Linking avoids counting the same receipt twice. A linked row is never proposed again.
              </p>
            </div>
            <Badge tone="info">{reconciliation.length} possible</Badge>
          </div>
          <ul className="reconcile-list">
            {reconciliation.slice(0, 4).map((match) => {
              const expectedItem = expected.find((item) => item.id === match.expectedId);
              const recorded = transactions.find((tx) => tx.id === match.transactionId);
              if (!expectedItem || !recorded) return null;
              return (
                <li key={`${match.expectedId}-${match.transactionId}`}>
                  <div className="reconcile-pair">
                    <div>
                      <span className="kpi-label">Expected</span>
                      <strong>{expectedItem.label}</strong>
                      <span className="subtle small">
                        {shortDate(expectedItem.date)} · {money(expectedItem.amount)}
                      </span>
                    </div>
                    <Icon name="arrow-right" size={16} />
                    <div>
                      <span className="kpi-label">Recorded</span>
                      <strong>{recorded.description}</strong>
                      <span className="subtle small">
                        {shortDate(recorded.date)} · {money(recorded.amount)}
                      </span>
                    </div>
                  </div>
                  <p className="reconcile-reason subtle small">{match.reason}</p>
                  <div className="button-row">
                    <button className="btn btn-primary btn-sm" onClick={() => matchExpected(match.expectedId, match.transactionId)}>
                      <Icon name="check" size={14} /> Match
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => deleteExpected(match.expectedId)}>
                      Not this one
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <div className="title-row">
              <h2>Needs review</h2>
              <Badge tone={suggestions.length > 0 ? "warn" : "good"}>{suggestions.length}</Badge>
            </div>
            <p className="card-sub">Each suggestion shows what was observed, why it matters and what to do next.</p>
          </div>
        </div>
        <ReviewQueue />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Recorded ledger</h2>
            <p className="card-sub">
              Money in {money(totals.income)} · money out {money(totals.expense)} · net{" "}
              <span className={totals.income - totals.expense >= 0 ? "positive" : "negative"}>
                {money(totals.income - totals.expense)}
              </span>
            </p>
          </div>
          <div className="filter-row">
            <input
              type="search"
              value={query}
              placeholder="Search description"
              aria-label="Search recorded entries"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <select
              value={category}
              aria-label="Filter by category"
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All categories</option>
              {ALL_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <div className="segmented segmented-sm" role="group" aria-label="Filter by direction">
              {(["all", "income", "expense"] as Filter[]).map((option) => (
                <button
                  key={option}
                  className={filter === option ? "active" : ""}
                  aria-pressed={filter === option}
                  onClick={() => {
                    setFilter(option);
                    setPage(1);
                  }}
                >
                  {option === "all" ? "All" : option === "income" ? "In" : "Out"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="subtle small">No entries match these filters.</p>
        ) : (
          <ul className="ledger-list">
            {visible.map((tx) => {
              const linked = transactions.find((row) => row.id === tx.id)?.expectedId;
              return (
                <li key={tx.id}>
                  <span className={`event-dot ${tx.direction}`}>
                    <Icon name={tx.direction === "income" ? "arrow-down" : "arrow-up"} size={12} />
                  </span>
                  <button className="ledger-main" onClick={() => onEdit(tx)}>
                    <span className="ledger-desc">
                      {tx.description}
                      {tx.source === "demo" && <span className="source-tag">demo</span>}
                      {linked && <Badge tone="good">Matched</Badge>}
                    </span>
                    <span className="ledger-meta">
                      {shortDate(tx.date)} · {tx.category} · {tx.source}
                    </span>
                  </button>
                  <select
                    className="ledger-category"
                    aria-label={`Category for ${tx.description}`}
                    value={tx.category}
                    onChange={(event) => setCategory(tx.id, event.target.value)}
                  >
                    {ALL_CATEGORIES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <span className={`ledger-amount num ${tx.direction}`}>
                    {tx.direction === "income" ? "+" : "−"}
                    {money(tx.amount)}
                  </span>
                  <button
                    className="icon-btn sm danger"
                    aria-label={`Delete ${tx.description}`}
                    onClick={() => {
                      if (window.confirm(`Delete “${tx.description}”? You can undo this.`)) deleteTransaction(tx.id);
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="pager">
          <button className="btn btn-ghost btn-sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            Previous
          </button>
          <span className="subtle small">
            Page {safePage} of {pageCount}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="title-row">
              <h2>Expected money</h2>
              <Badge tone="warn" dot>
                Provisional
              </Badge>
            </div>
            <p className="card-sub">
              Not counted as cash. These shape the forecast until you record them.{" "}
              <ContextHelp topic="coverage-status" />
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowExpected((value) => !value)}>
            {showExpected ? "Hide" : "Show"}
          </button>
        </div>
        {showExpected && (
          <>
            {expected.length === 0 ? (
              <p className="subtle small">
                No expected money yet. Add a client invoice, a confirmed EMI or a salary you are waiting for.
              </p>
            ) : (
              <ul className="ledger-list">
                {expected.map((item) => (
                  <li key={item.id}>
                    <span className={`event-dot ${item.direction}`}>
                      <Icon name={item.direction === "income" ? "arrow-down" : "arrow-up"} size={12} />
                    </span>
                    <div className="ledger-main">
                      <span className="ledger-desc">
                        {item.label}
                        <Badge tone={item.certainty === "confirmed" ? "info" : "warn"}>
                          {item.certainty === "confirmed" ? "Scheduled" : "Likely"}
                        </Badge>
                      </span>
                      <span className="ledger-meta">
                        {shortDate(item.date)} · {daysBetween(today, item.date)} days · {item.category}
                      </span>
                    </div>
                    <span className={`ledger-amount num ${item.direction}`}>
                      {item.direction === "income" ? "+" : "−"}
                      {money(item.amount)}
                    </span>
                    <button
                      className="icon-btn sm danger"
                      aria-label={`Remove expected ${item.label}`}
                      onClick={() => {
                        deleteExpected(item.id);
                        notify("Expected item removed from the forecast.");
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {transfers.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Transfers</h2>
              <p className="card-sub">Moving your own money is never income or spending.</p>
            </div>
          </div>
          <ul className="ledger-list">
            {transfers
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((transfer) => (
                <li key={transfer.id}>
                  <span className="event-dot neutral">
                    <Icon name="repeat" size={12} />
                  </span>
                  <div className="ledger-main">
                    <span className="ledger-desc">
                      {transfer.from === "cash" ? "Cash → Savings" : "Savings → Cash"}
                      {transfer.status === "planned" && <Badge tone="warn">Planned</Badge>}
                    </span>
                    <span className="ledger-meta">
                      {shortDate(transfer.date)}
                      {transfer.note ? ` · ${transfer.note}` : ""}
                    </span>
                  </div>
                  <span className="ledger-amount num">{money(transfer.amount)}</span>
                  <button
                    className="icon-btn sm danger"
                    aria-label="Delete transfer"
                    onClick={() => deleteTransfer(transfer.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <p className="disclaimer">
        <Icon name="info" size={14} /> Recorded rows are facts you entered. Expected rows and suggestions are
        estimates from your own history. Today is {shortDate(todayISO())}.
      </p>
    </div>
  );
}