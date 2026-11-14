import { useMemo, useState } from "react";
import type { RecurringStatus } from "../types";
import { useApp } from "../store";
import { categoryColor } from "../lib/categorize";
import { daysBetween, daysLabel, mediumDate, money, shortDate } from "../lib/format";
import { FREQUENCY_LABEL } from "../lib/recurring";
import { AmountBars } from "../components/Charts";
import { Badge, ConfidenceMeter, EmptyState, Segmented } from "../components/ui";
import { Icon } from "../components/Icon";
import { ContextHelp } from "../components/ContextHelp";
import { StatusPill, coverageOf } from "../components/BalanceSummary";
import { UncertaintyNote } from "../components/ReliabilityControl";

type Tab = "all" | "confirmed" | "review" | "dismissed";

export function UpcomingPage({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  const {
    today,
    recurring,
    forecast,
    reserve,
    expected,
    transfers,
    setRecurringStatus,
    setRecurrencePrefs,
    notify,
  } = useApp();

  const [tab, setTab] = useState<Tab>("review");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState("");

  const counts = useMemo(
    () => ({
      all: recurring.length,
      confirmed: recurring.filter((item) => item.status === "confirmed").length,
      review: recurring.filter((item) => item.status === "review").length,
      dismissed: recurring.filter((item) => item.status === "dismissed").length,
    }),
    [recurring],
  );

  const visible = recurring
    .filter((item) => tab === "all" || item.status === tab)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));

  const timeline = useMemo(
    () =>
      [...forecast.events]
        .filter((event) => event.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 14),
    [forecast.events, today],
  );

  const nextBill = timeline.find((event) => event.direction === "expense");

  const update = (key: string, status: RecurringStatus | null, label: string) => {
    setRecurringStatus(key, status);
    notify(
      status === "confirmed"
        ? `“${label}” confirmed. It is now in every forecast.`
        : status === "dismissed"
          ? `“${label}” removed from the forecast.`
          : `“${label}” reset to automatic detection.`,
    );
  };

  if (recurring.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Upcoming</p>
            <h1>No repeating patterns yet.</h1>
            <p className="page-sub">
              Bills and income are recognised from repeats: same payee, similar amount, regular timing.
            </p>
          </div>
        </header>
        <div className="card">
          <EmptyState
            icon="repeat"
            title="Not enough history to detect patterns"
            body="Import at least three cycles of a bill — three months of rent, or three weekly grocery orders. You can also add an expected payment by hand."
            action={
              <div className="button-row">
                <button className="btn btn-primary" onClick={onImport}>
                  <Icon name="upload" size={16} /> Import transactions
                </button>
                <button className="btn btn-secondary" onClick={onAdd}>
                  <Icon name="plus" size={16} /> Add expected payment
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
          <p className="eyebrow">Upcoming</p>
          <h1>What is already scheduled.</h1>
          <p className="page-sub">
            Confirmed items are facts you have accepted. “Review” items are patterns the engine found but has not
            used in your forecast.
          </p>
        </div>
        <div className="button-row">
          <button className="btn btn-secondary btn-sm" onClick={onAdd}>
            <Icon name="plus" size={15} /> Add expected
          </button>
        </div>
      </header>

      <section className="schedule-strip">
        <article className="card mini-stat">
          <span className="kpi-label">Next bill</span>
          <span className="mini-stat-value num">
            {nextBill ? money(nextBill.amount) : "—"}
          </span>
          <span className="subtle small">
            {nextBill ? `${nextBill.label} · ${shortDate(nextBill.date)}` : "Nothing scheduled"}
          </span>
        </article>
        <article className="card mini-stat">
          <span className="kpi-label">
            Low point <ContextHelp topic="coverage-status" />
          </span>
          <span className="mini-stat-value num">{money(forecast.minBalance)}</span>
          <span className="subtle small">
            {shortDate(forecast.minDate)} ·{" "}
            <StatusPill coverage={coverageOf(forecast.minBalance, reserve)} small />
          </span>
        </article>
        <article className="card mini-stat">
          <span className="kpi-label">Confirmed recurring</span>
          <span className="mini-stat-value num">{counts.confirmed}</span>
          <span className="subtle small">{counts.review} waiting for review</span>
        </article>
        <article className="card mini-stat">
          <span className="kpi-label">Expected one-offs</span>
          <span className="mini-stat-value num">{expected.length}</span>
          <span className="subtle small">
            {transfers.filter((t) => t.status === "planned").length} planned transfers
          </span>
        </article>
      </section>

      <div className="tabs" role="tablist" aria-label="Recurring status">
        {(["review", "confirmed", "all", "dismissed"] as Tab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            className={tab === option ? "active" : ""}
            onClick={() => setTab(option)}
          >
            {option === "all" ? "All" : option.charAt(0).toUpperCase() + option.slice(1)}
            <span className="tab-count">{counts[option]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="check-circle"
            title={tab === "review" ? "Nothing waiting for review" : "Nothing in this view"}
            body={
              tab === "review"
                ? "Every detected pattern has been confirmed or dismissed. New patterns appear after an import."
                : "Switch tabs to see other detected patterns."
            }
          />
        </div>
      ) : (
        <div className="recurring-grid">
          {visible.map((item) => (
            <article className={`recurring-card card ${item.direction}`} key={item.key}>
              <div className="recurring-head">
                <div className="recurring-title">
                  <span className="recurring-mark" style={{ background: categoryColor(item.category) }} />
                  <div>
                    <h3 id={`rec-${item.key}`}>{item.label}</h3>
                    <div className="recurring-tags">
                      <Badge tone={item.direction === "income" ? "income" : "expense"}>
                        {item.direction === "income" ? "Income" : "Expense"}
                      </Badge>
                      <Badge tone={item.priority === "essential" ? "neutral" : "info"}>{item.priority}</Badge>
                      <span className="subtle small">{item.category}</span>
                    </div>
                  </div>
                </div>
                <Badge
                  tone={item.status === "confirmed" ? "good" : item.status === "review" ? "warn" : "neutral"}
                  dot
                >
                  {item.status}
                </Badge>
              </div>

              <div className="recurring-amount-row">
                <div>
                  <span className="kpi-label">Typical amount</span>
                  <p className="recurring-amount num">{money(item.typicalAmount)}</p>
                </div>
                <div>
                  <span className="kpi-label">Frequency</span>
                  <p className="recurring-frequency">{FREQUENCY_LABEL[item.frequency]}</p>
                  <span className="subtle small">every ~{Math.round(item.intervalDays)} days</span>
                </div>
                <div>
                  <span className="kpi-label">Next expected</span>
                  <p className="recurring-next">{shortDate(item.nextDate)}</p>
                  <span className="subtle small">{daysLabel(daysBetween(today, item.nextDate))}</span>
                </div>
              </div>

              <div className="recurring-bars">
                <AmountBars values={item.amounts} color={item.direction === "income" ? "#34d399" : "#818cf8"} />
                <span className="subtle small">Last {item.amounts.length} amounts</span>
              </div>

              <ConfidenceMeter
                value={item.confidence}
                label={`${Math.round(item.confidence * 100)}% pattern match`}
              />

              <p className="detection-note">
                <Icon name={item.status === "review" ? "alert" : "info"} size={14} />
                {item.detectionNote} {item.occurrences} occurrences since {mediumDate(item.firstDate)}.
              </p>

              <div className="recurring-prefs">
                <label className="inline-field">
                  <span className="subtle small">Priority</span>
                  <Segmented
                    size="sm"
                    label={`Priority for ${item.label}`}
                    value={item.priority}
                    onChange={(value) => setRecurrencePrefs(item.key, { priority: value as "essential" | "flexible" })}
                    options={[
                      { value: "essential", label: "Essential" },
                      { value: "flexible", label: "Flexible" },
                    ]}
                  />
                </label>
                <label className="inline-field">
                  <span className="subtle small">Latest date</span>
                  <input
                    type="date"
                    value={item.latestDate ?? ""}
                    aria-label={`Latest permitted date for ${item.label}`}
                    onChange={(event) => setRecurrencePrefs(item.key, { latestDate: event.target.value })}
                  />
                </label>
              </div>

              {editing === item.key ? (
                <div className="recurring-date-edit">
                  <label htmlFor={`date-${item.key}`} className="subtle small">
                    Next due date
                  </label>
                  <input
                    id={`date-${item.key}`}
                    type="date"
                    value={draftDate}
                    onChange={(event) => setDraftDate(event.target.value)}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (!draftDate) return;
                      setRecurrencePrefs(item.key, { nextDue: draftDate });
                      setRecurringStatus(item.key, "confirmed");
                      notify(`Next date for “${item.label}” set to ${shortDate(draftDate)}.`);
                      setEditing(null);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="recurring-actions">
                  {item.status !== "confirmed" && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => update(item.key, "confirmed", item.label)}
                    >
                      <Icon name="check" size={14} /> Confirm schedule
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEditing(item.key);
                      setDraftDate(item.nextDate);
                    }}
                  >
                    <Icon name="edit" size={14} /> Edit date
                  </button>
                  {item.status === "dismissed" ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => update(item.key, null, item.label)}>
                      Restore
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => update(item.key, "dismissed", item.label)}
                    >
                      Not a bill
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Payment timeline</h2>
            <p className="card-sub">Confirmed recurring, expected money and planned transfers in order</p>
          </div>
          <UncertaintyNote />
        </div>
        {timeline.length === 0 ? (
          <p className="subtle small">Nothing scheduled in the forecast window.</p>
        ) : (
          <ol className="timeline">
            {timeline.map((event) => (
              <li key={event.id}>
                <span className="timeline-date">{shortDate(event.date)}</span>
                <span className={`event-dot ${event.direction}`}>
                  <Icon name={event.direction === "income" ? "arrow-down" : "arrow-up"} size={12} />
                </span>
                <span className="timeline-label">
                  {event.label}
                  {event.isEstimate && <Badge tone="warn">Estimate</Badge>}
                </span>
                <span className={`num ${event.direction}`}>
                  {event.direction === "income" ? "+" : "−"}
                  {money(event.amount)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {expected.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Expected one-offs</h2>
              <p className="card-sub">Money you are waiting on, or bills you know are coming once</p>
            </div>
          </div>
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
                    {shortDate(item.date)} · {item.category}
                    {item.note ? ` · ${item.note}` : ""}
                  </span>
                </div>
                <span className={`ledger-amount num ${item.direction}`}>
                  {item.direction === "income" ? "+" : "−"}
                  {money(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="disclaimer">
        <Icon name="info" size={14} /> Review items are excluded from the forecast until you confirm them. Confirming
        a pattern does not pay anything — it only makes the projection more realistic.
      </p>
    </div>
  );
}