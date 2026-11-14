import { useMemo } from "react";
import type { Forecast, ForecastPoint } from "../types";
import { daysBetween, daysLabel, longDate, money, shortDate } from "../lib/format";
import { Icon } from "./Icon";
import { Badge } from "./ui";

export type Coverage = "covered" | "reserve" | "shortfall";

export function coverageOf(balance: number, reserve: number): Coverage {
  if (balance < 0) return "shortfall";
  if (balance < reserve) return "reserve";
  return "covered";
}

export const COVERAGE_TEXT: Record<Coverage, string> = {
  covered: "Covered",
  reserve: "Uses reserve",
  shortfall: "Insufficient cash",
};

export function StatusPill({ coverage, small = false }: { coverage: Coverage; small?: boolean }) {
  return (
    <span className={`status-pill ${coverage} ${small ? "sm" : ""}`}>
      <Icon
        name={coverage === "covered" ? "check-circle" : "alert"}
        size={small ? 12 : 14}
      />
      {COVERAGE_TEXT[coverage]}
    </span>
  );
}

/**
 * The text version of the balance chart: a summary sentence plus the days that
 * matter. Screen readers get the same story the chart tells.
 */
export function BalanceSummary({
  forecast,
  reserve,
  today,
  selectedDate,
  onSelect,
  limit = 6,
}: {
  forecast: Forecast;
  reserve: number;
  today: string;
  selectedDate: string | null;
  onSelect: (date: string) => void;
  limit?: number;
}) {
  const rows = useMemo(() => {
    const byDate = new Map<string, ForecastPoint>(forecast.points.map((point) => [point.date, point]));
    const eventDates = Array.from(new Set(forecast.events.map((event) => event.date)))
      .filter((date) => byDate.has(date) && date >= today)
      .sort();
    const picks: string[] = [];
    const push = (date: string | null | undefined) => {
      if (!date || !byDate.has(date) || picks.includes(date)) return;
      picks.push(date);
    };
    push(forecast.breach?.date);
    push(forecast.minDate);
    for (const date of eventDates) {
      push(date);
      if (picks.length >= limit + 2) break;
    }
    const last = forecast.points[forecast.points.length - 1];
    push(last?.date);
    return picks
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit)
      .map((date) => {
        const point = byDate.get(date) as ForecastPoint;
        const events = forecast.events.filter((event) => event.date === date);
        const inflow = events
          .filter((event) => event.direction === "income")
          .reduce((sum, event) => sum + event.amount, 0);
        const outflow = events
          .filter((event) => event.direction === "expense")
          .reduce((sum, event) => sum + event.amount, 0);
        return { date, point, events, inflow, outflow, coverage: coverageOf(point.balance, reserve) };
      });
  }, [forecast, reserve, today, limit]);

  const worst = forecast.points.reduce(
    (low, point) => (point.balance < low.balance ? point : low),
    forecast.points[0],
  );

  return (
    <div className="balance-summary">
      <p className="summary-sentence">
        Starting at <strong className="num">{money(forecast.startingBalance)}</strong> today, the projected
        balance falls to its lowest of <strong className="num">{money(worst.balance)}</strong> on{" "}
        <strong>{longDate(worst.date)}</strong> ({(worst.balance >= reserve) ? `${money(worst.balance - reserve)} above your reserve` : `${money(reserve - worst.balance)} into or below zero and your reserve`}), then
        ends at <strong className="num">{money(forecast.endBalance)}</strong> on{" "}
        {shortDate(forecast.points[forecast.points.length - 1]?.date ?? today)}. The shaded band is an 80%
        estimate range based on your own history.
      </p>

      <ul className="event-summary" aria-label="Forecast days and their status">
        {rows.map((row) => (
          <li key={row.date}>
            <button
              className={`event-row ${row.date === selectedDate ? "selected" : ""}`}
              onClick={() => onSelect(row.date)}
              aria-pressed={row.date === selectedDate}
            >
              <span className="event-row-date">
                {shortDate(row.date)}
                <span className="subtle small"> · {daysLabel(daysBetween(today, row.date))}</span>
              </span>
              <StatusPill coverage={row.coverage} small />
              <span className="event-row-balance num">{money(row.point.balance)}</span>
              <span className="event-row-note subtle small">
                {row.events.length === 0
                  ? "Everyday spending only"
                  : row.events
                      .slice(0, 2)
                      .map((event) => `${event.label} ${event.direction === "income" ? "in" : "out"}`)
                      .join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Expanded explanation of the day a low point lands on. */
export function LowPointDetail({
  forecast,
  date,
  reserve,
  today,
  onClose,
  onPlan,
}: {
  forecast: Forecast;
  date: string;
  reserve: number;
  today: string;
  onClose: () => void;
  onPlan: () => void;
}) {
  const point = forecast.points.find((row) => row.date === date) ?? forecast.points[0];
  const events = forecast.events.filter((event) => event.date === date);
  const receipts = events.filter((event) => event.direction === "income");
  const bills = events.filter((event) => event.direction === "expense");
  const coverage = coverageOf(point.balance, reserve);
  const everyDaySpend =
    forecast.variableExpensePerDay * Math.max(1, daysBetween(forecast.today, date));

  return (
    <div className="low-detail" role="region" aria-label={`Details for ${longDate(date)}`}>
      <div className="low-detail-head">
        <div>
          <h3>{longDate(date)}</h3>
          <p className="subtle small">
            {daysLabel(daysBetween(today, date))} · projected {money(point.balance)} · range{" "}
            {money(point.lower)} – {money(point.upper)}
          </p>
        </div>
        <div className="row-actions">
          <StatusPill coverage={coverage} />
          <button className="icon-btn" onClick={onClose} aria-label="Close day details">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
      <dl className="low-breakdown">
        <div>
          <dt>Starting cash that day</dt>
          <dd className="num">{money(point.balance + bills.reduce((s, e) => s + e.amount, 0) - receipts.reduce((s, e) => s + e.amount, 0))}</dd>
        </div>
        <div>
          <dt>Expected receipts</dt>
          <dd className="num income">+{money(receipts.reduce((sum, event) => sum + event.amount, 0))}</dd>
        </div>
        <div>
          <dt>Scheduled bills</dt>
          <dd className="num expense">−{money(bills.reduce((sum, event) => sum + event.amount, 0))}</dd>
        </div>
        <div>
          <dt>Everyday spending since today</dt>
          <dd className="num">≈{money(everyDaySpend)}</dd>
        </div>
      </dl>
      <ul className="low-events">
        {receipts.map((event) => (
          <li key={event.id}>
            <Icon name="arrow-down" size={13} />
            <span>{event.label}</span>
            <span className="num income">+{money(event.amount)}</span>
            {event.isEstimate && <Badge tone="warn">Estimate</Badge>}
          </li>
        ))}
        {bills.map((event) => (
          <li key={event.id}>
            <Icon name="arrow-up" size={13} />
            <span>{event.label}</span>
            <span className="num expense">−{money(event.amount)}</span>
            {event.isEstimate && <Badge tone="warn">Estimate</Badge>}
          </li>
        ))}
        {events.length === 0 && <li className="subtle small">No scheduled money moves on this day.</li>}
      </ul>
      <button className="btn btn-secondary btn-sm" onClick={onPlan}>
        <Icon name="flask" size={14} /> Plan a purchase around this date
      </button>
    </div>
  );
}
