import { useMemo, useState } from "react";
import { useApp } from "../store";
import {
  addDays,
  daysBetween,
  daysLabel,
  longDate,
  mediumDate,
  money,
  shortDate,
} from "../lib/format";
import { ForecastChart } from "../components/Charts";
import { Badge, EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";
import { BalanceSummary, LowPointDetail, StatusPill, coverageOf } from "../components/BalanceSummary";
import { ReviewQueue } from "../components/ReviewQueue";
import { ReliabilityControl, UncertaintyNote } from "../components/ReliabilityControl";
import { ContextHelp } from "../components/ContextHelp";
import type { Page } from "../types";

export function OverviewPage({
  onPlan,
  onImport,
  onAdd,
  onNavigate,
}: {
  onPlan: (prefill?: { amount?: number; date?: string }) => void;
  onImport: () => void;
  onAdd: () => void;
  onNavigate: (page: Page) => void;
}) {
  const {
    today,
    workspace,
    transactions,
    expected,
    transfers,
    forecast,
    baseline,
    reserve,
    cashToday,
    savingsToday,
    room,
    suggestions,
    reliability,
    horizon,
    recurring,
    isDemo,
    leaveDemo,
  } = useApp();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const low = useMemo(
    () =>
      forecast.points.reduce(
        (worst, point) => (point.balance < worst.balance ? point : worst),
        forecast.points[0],
      ),
    [forecast.points],
  );
  const coverage = coverageOf(low.balance, reserve);

  const markers = useMemo(() => {
    const list: { date: string; label: string; kind: "income" | "expense" | "low" }[] = [];
    const seen = new Set<string>();
    for (const event of forecast.events) {
      const key = `${event.date}-${event.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        date: event.date,
        label: `${event.label} (${event.direction === "income" ? "in" : "out"})`,
        kind: event.direction,
      });
      if (list.length >= 10) break;
    }
    return list;
  }, [forecast.events]);

  const nextEvents = forecast.events
    .filter((event) => event.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const isEmpty = transactions.length === 0 && expected.length === 0;

  if (isEmpty) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Overview · {mediumDate(today)}</p>
            <h1>{workspace.label} is ready.</h1>
            <p className="page-sub">
              Nothing is recorded yet. One next action is all it takes to see your first forecast.
            </p>
          </div>
          <Badge tone={isDemo ? "violet" : "info"} dot>
            {isDemo ? "Demo workspace" : "Your workspace"}
          </Badge>
        </header>

        <div className="card empty-hero">
          <EmptyState
            icon="arrow-down"
            title="Start with money you already have, or money you have received"
            body="Record a client payment, salary or transfer from another account, then add the bills you know are coming. Expected money keeps the forecast honest — it is never counted as cash until you record it."
            action={
              <div className="button-row">
                <button className="btn btn-primary" onClick={onAdd}>
                  <Icon name="plus" size={16} /> Record money in
                </button>
                <button className="btn btn-secondary" onClick={onImport}>
                  <Icon name="upload" size={16} /> Import a CSV
                </button>
                <button className="btn btn-ghost" onClick={() => onPlan()}>
                  <Icon name="flask" size={16} /> Check a purchase first
                </button>
              </div>
            }
          />
          <div className="empty-features">
            <div>
              <Icon name="wallet" size={18} />
              <h4>Opening balance: {money(workspace.openingBalance)}</h4>
              <p>From {shortDate(workspace.openingDate)}. Change it in Settings at any time.</p>
            </div>
            <div>
              <Icon name="shield" size={18} />
              <h4>Reserve: {reserve > 0 ? money(reserve) : "not set"}</h4>
              <p>The line you do not want to cross. Every status compares the forecast with it.</p>
            </div>
            <div>
              <Icon name="compass" size={18} />
              <h4>Nothing to forecast yet</h4>
              <p>Once you add money in and out, the next 30 days appear here with dates and amounts.</p>
            </div>
          </div>
        </div>
        <ReliabilityControl />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head overview-head">
        <div>
          <p className="eyebrow">
            Overview · {mediumDate(today)} · {isDemo ? "Demo workspace" : workspace.label}
          </p>
          <h1>Can I buy it?</h1>
          <p className="page-sub">
            Next {horizon} days · {transactions.length} recorded rows · {expected.length} expected
            {transfers.length > 0 ? ` · ${transfers.length} transfers` : ""}
          </p>
        </div>
        <div className="head-actions">
          <ReliabilityControl inline />
          <button className="btn btn-primary" onClick={() => onPlan()}>
            <Icon name="flask" size={16} /> Check a purchase
          </button>
        </div>
      </header>

      {isDemo && (
        <div className="demo-banner">
          <div className="demo-banner-text">
            <Badge tone="violet" dot>
              Demo workspace
            </Badge>
            <span>
              Fictional household, {transactions.length} sample rows. Your own records are untouched.
            </span>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={leaveDemo}>
              <Icon name="arrow-right" size={14} className="flip" /> Back to my workspace
            </button>
          </div>
        </div>
      )}

      <section className="decision-strip" aria-label="Today's position">
        <article className="card headline-card">
          <div className="headline-top">
            <span className="kpi-label">
              Spendable today <ContextHelp topic="spendable-today" />
            </span>
            <span className="kpi-icon">
              <Icon name="wallet" size={17} />
            </span>
          </div>
          <p className="headline-value num">{money(cashToday)}</p>
          <p className="kpi-foot">
            {savingsToday > 0 ? `${money(savingsToday)} set aside in savings (not included)` : "No savings set aside yet"}
          </p>
        </article>

        <article className={`card headline-card low-card ${coverage}`}>
          <div className="headline-top">
            <span className="kpi-label">
              Next projected low <ContextHelp topic="coverage-status" />
            </span>
            <StatusPill coverage={coverage} small />
          </div>
          <p className="headline-value num">{money(low.balance)}</p>
          <p className="kpi-foot">
            {longDate(low.date)} · {daysLabel(daysBetween(today, low.date))}
            {reserve > 0
              ? low.balance >= reserve
                ? ` · ${money(low.balance - reserve)} above reserve`
                : ` · ${money(reserve - low.balance)} below reserve`
              : " · no reserve set"}
          </p>
        </article>

        <article className="card headline-card">
          <div className="headline-top">
            <span className="kpi-label">
              Room for a purchase <ContextHelp topic="spending-room" />
            </span>
            <span className="kpi-icon">
              <Icon name="flask" size={17} />
            </span>
          </div>
          <p className="headline-value num">{money(room.room)}</p>
          <p className="kpi-foot">
            Above your reserve until {shortDate(room.untilDate)} · ≈{money(room.perDay)}/day
          </p>
        </article>
      </section>

      <section className="card chart-card" id="overview-chart">
        <div className="card-head">
          <div>
            <div className="title-row">
              <h2>Balance, actual and projected</h2>
              <Badge tone="info" dot>
                {reliability.status === "measured" ? `${horizon}-day estimate` : "Sparse history"}
              </Badge>
            </div>
            <p className="card-sub">
              Solid line: projection with your saved scenarios · dashed: without them · band: 80% range
            </p>
          </div>
          <div className="card-head-actions">
            <UncertaintyNote />
          </div>
        </div>

        <ForecastChart
          points={forecast.points}
          compare={forecast.points === baseline.points ? null : baseline.points}
          threshold={reserve}
          compareLabel="Baseline (no scenario)"
          markers={markers}
          selectedDate={selectedDate ?? low.date}
          onSelectDate={(date) => setSelectedDate(date)}
          ariaLabel={`Projected cash balance for the next ${horizon} days with an 80% estimate range and a reserve line at ${money(reserve)}`}
        />

        {selectedDate ? (
          <LowPointDetail
            forecast={forecast}
            date={selectedDate}
            reserve={reserve}
            today={today}
            onClose={() => setSelectedDate(null)}
            onPlan={() => onPlan({ date: selectedDate })}
          />
        ) : (
          <BalanceSummary
            forecast={forecast}
            reserve={reserve}
            today={today}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
          />
        )}
        <p className="chart-note">
          Click the chart, or use the day list, to see the starting cash, expected receipts, scheduled bills and
          everyday spending behind any dip.
        </p>
      </section>

      <section className="overview-split">
        <article className="card needs-review">
          <div className="card-head">
            <div>
              <div className="title-row">
                <h2>Needs review</h2>
                {suggestions.length > 0 && <Badge tone="warn">{suggestions.length}</Badge>}
              </div>
              <p className="card-sub">
                Learned from your own history · most time-sensitive first
              </p>
            </div>
            <button className="link-btn" onClick={() => onNavigate("activity")}>
              All <Icon name="arrow-right" size={13} />
            </button>
          </div>
          <ReviewQueue compact />
        </article>

        <article className="card upcoming-card">
          <div className="card-head">
            <div>
              <h2>Next money moves</h2>
              <p className="card-sub">Bills, EMIs and expected receipts</p>
            </div>
            <button className="link-btn" onClick={() => onNavigate("upcoming")}>
              Open Upcoming <Icon name="arrow-right" size={13} />
            </button>
          </div>
          {nextEvents.length === 0 ? (
            <p className="subtle small">
              Nothing scheduled in the next {horizon} days. Confirm recurring payments in Upcoming to see them here.
            </p>
          ) : (
            <ul className="upcoming-list">
              {nextEvents.map((event) => (
                <li key={event.id}>
                  <span className={`event-dot ${event.direction}`}>
                    <Icon name={event.direction === "income" ? "arrow-down" : "arrow-up"} size={12} />
                  </span>
                  <div className="event-main">
                    <span className="event-label">{event.label}</span>
                    <span className="event-meta">
                      {shortDate(event.date)} · {daysLabel(daysBetween(today, event.date))}
                      {event.isEstimate ? " · estimate" : ""}
                    </span>
                  </div>
                  <span className={`event-amount num ${event.direction}`}>
                    {event.direction === "income" ? "+" : "−"}
                    {money(event.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="buffer-row">
            <span className="subtle small">
              {recurring.filter((item) => item.status === "confirmed").length} confirmed recurring ·{" "}
              {recurring.filter((item) => item.status === "review").length} awaiting review
            </span>
            <button className="link-btn" onClick={() => onNavigate("upcoming")}>
              Review
            </button>
          </div>
        </article>
      </section>

      <section className="card next-steps">
        <div className="card-head">
          <div>
            <h2>What else is worth checking</h2>
            <p className="card-sub">Dated {longDate(today)}</p>
          </div>
        </div>
        <div className="next-grid">
          <button className="next-card" onClick={() => onPlan({ amount: 25000, date: addDays(today, 14) })}>
            <Icon name="flask" size={18} />
            <strong>Compare two purchase dates</strong>
            <span>See how moving a purchase changes your lowest balance.</span>
          </button>
          <button className="next-card" onClick={() => onNavigate("insights")}>
            <Icon name="sparkles" size={18} />
            <strong>Check forecast reliability</strong>
            <span>
              {reliability.status === "measured"
                ? `${money(reliability.meanDailyError ?? 0)} average daily error over ${reliability.sampleSize} rows`
                : "Insufficient history for a measured error"}
            </span>
          </button>
          <button className="next-card" onClick={() => onNavigate("upcoming")}>
            <Icon name="repeat" size={18} />
            <strong>Confirm a recurring payment</strong>
            <span>{recurring.filter((item) => item.status === "review").length} detected patterns need a decision.</span>
          </button>
        </div>
      </section>
    </div>
  );
}
