import { useEffect, useMemo, useRef } from "react";
import type { CandidateDate, IsoDate, PlannerEvent } from "../engine/types";
import type { CalendarResult, CalendarOptions } from "../engine/calendar";
import { VERDICT_META, HelpTip, VerdictPill } from "./atoms";
import { dayLabel, money, weekdayLabel } from "./format";

export interface PurchaseCalendarProps {
  calendar: CalendarResult;
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
  /** Receipt occurrences the user can choose between. */
  receipts: PlannerEvent[];
  receiptId: string | null;
  onReceiptChange: (id: string | null) => void;
  maxDelayDays: number;
  onMaxDelayChange: (days: number) => void;
  selectedDelayDays: number;
  onSelectedDelayChange: (days: number) => void;
  followUpDays: number;
  onFollowUpChange: (days: number) => void;
  options: Pick<CalendarOptions, "from" | "to">;
  onRangeChange: (range: { from: IsoDate; to: IsoDate }) => void;
  /** Purchase outlay used only for copy. */
  outlayToday: number;
  methodLabel: string;
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayIndex(iso: IsoDate): number {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return (day + 6) % 7;
}

export function PurchaseCalendar({
  calendar,
  selected,
  onSelect,
  receipts,
  receiptId,
  onReceiptChange,
  maxDelayDays,
  onMaxDelayChange,
  selectedDelayDays,
  onSelectedDelayChange,
  followUpDays,
  onFollowUpChange,
  options,
  onRangeChange,
  outlayToday,
  methodLabel,
}: PurchaseCalendarProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation: arrows move between candidate dates, Enter/Space selects.
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.dataset.date) return;
      const list = calendar.candidates;
      const index = list.findIndex((candidate) => candidate.date === target.dataset.date);
      if (index < 0) return;
      let next = index;
      if (event.key === "ArrowRight") next = Math.min(list.length - 1, index + 1);
      else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
      else if (event.key === "ArrowDown") next = Math.min(list.length - 1, index + 7);
      else if (event.key === "ArrowUp") next = Math.max(0, index - 7);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      else return;
      event.preventDefault();
      const nextCandidate = list[next];
      const node = container.querySelector<HTMLButtonElement>(
        `[data-date="${nextCandidate.date}"]`,
      );
      node?.focus();
      onSelect(nextCandidate.date);
    };
    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [calendar.candidates, onSelect]);

  const leading = useMemo(() => {
    const first = calendar.candidates[0];
    return first ? mondayIndex(first.date) : 0;
  }, [calendar.candidates]);

  const counts = calendar.counts;
  const selectedCandidate = calendar.candidates.find((candidate) => candidate.date === selected) ?? null;

  return (
    <section className="pp-card" aria-labelledby="pp-cal-title">
      <div className="pp-card-head">
        <div>
          <h2 id="pp-cal-title">2 · When can you buy it?</h2>
          <p className="pp-card-sub">
            Every eligible purchase date is simulated against your reserve for each tested payment delay.
          </p>
        </div>
        <span className="pp-badge">{calendar.scannedDays} dates graded</span>
      </div>

      <div className="pp-controls">
        <label className="pp-field">
          <span>
            Expected receipt
            <HelpTip label="expected receipt">
              Pick one receipt the purchase depends on. Only that occurrence moves — never a whole series.
            </HelpTip>
          </span>
          <select value={receiptId ?? ""} onChange={(event) => onReceiptChange(event.target.value || null)}>
            <option value="">No receipt assumed</option>
            {receipts.map((receipt) => (
              <option key={receipt.id} value={receipt.id}>
                {receipt.label} · {money(receipt.amount)} · {dayLabel(receipt.date)}
              </option>
            ))}
          </select>
        </label>

        <label className="pp-field">
          <span>
            Maximum tested delay
            <HelpTip label="tested delay">
              How late the receipt might arrive. The planner tries every day from 0 to this number and asks
              whether you still stay above your reserve.
            </HelpTip>
          </span>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={maxDelayDays}
            onChange={(event) => onMaxDelayChange(Number(event.target.value))}
            disabled={!receiptId}
          />
          <em className="pp-field-note">{receiptId ? `${maxDelayDays} days tested` : "choose a receipt first"}</em>
        </label>

        <label className="pp-field">
          <span>Assume this delay for the shown numbers</span>
          <input
            type="range"
            min={0}
            max={Math.max(maxDelayDays, 0)}
            step={1}
            value={Math.min(selectedDelayDays, maxDelayDays)}
            onChange={(event) => onSelectedDelayChange(Number(event.target.value))}
            disabled={!receiptId}
          />
          <em className="pp-field-note">
            {receiptId ? `${selectedDelayDays} day${selectedDelayDays === 1 ? "" : "s"} late` : "—"}
          </em>
        </label>

        <label className="pp-field">
          <span>Follow-up period</span>
          <select value={followUpDays} onChange={(event) => onFollowUpChange(Number(event.target.value))}>
            <option value={14}>14 days</option>
            <option value={21}>21 days</option>
            <option value={30}>30 days</option>
            <option value={45}>45 days</option>
          </select>
        </label>

        <label className="pp-field">
          <span>Earliest acceptable</span>
          <input
            type="date"
            value={options.from}
            onChange={(event) => onRangeChange({ ...options, from: event.target.value })}
          />
        </label>
        <label className="pp-field">
          <span>Latest acceptable</span>
          <input
            type="date"
            value={options.to}
            onChange={(event) => onRangeChange({ ...options, to: event.target.value })}
          />
        </label>
      </div>

      <div className="pp-legend">
        {(Object.keys(VERDICT_META) as (keyof typeof VERDICT_META)[]).map((key) => (
          <span key={key} className={`pp-legend-item pp-pill-${VERDICT_META[key].tone}`}>
            <span className="pp-pill-icon" aria-hidden="true">
              {VERDICT_META[key].icon}
            </span>
            {VERDICT_META[key].label}
            <span className="pp-legend-count">{counts[key as keyof typeof counts]}</span>
          </span>
        ))}
      </div>

      {calendar.insufficientWindowFrom && (
        <p className="pp-warn-inline">
          <span aria-hidden="true">⚠</span> Insufficient forecast window: {calendar.scannedDays > 0 ? "dates from" : "dates from"}{" "}
          {calendar.insufficientWindowFrom} cannot be graded because a {followUpDays}-day follow-up runs past the
          forecast. Extend the forecast or shorten the follow-up.
        </p>
      )}

      <div ref={gridRef} className="pp-cal" role="grid" aria-label="Eligible purchase dates">
        <div className="pp-cal-weekdays" aria-hidden="true">
          {WEEKDAY_ORDER.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="pp-cal-days">
          {Array.from({ length: leading }).map((_, index) => (
            <span key={`pad-${index}`} className="pp-cal-pad" aria-hidden="true" />
          ))}
          {calendar.candidates.map((candidate, index) => (
            <button
              key={candidate.date}
              type="button"
              data-date={candidate.date}
              role="gridcell"
              tabIndex={
                selected
                  ? candidate.date === selected
                    ? 0
                    : -1
                  : index === 0
                    ? 0
                    : -1
              }
              aria-selected={candidate.date === selected}
              aria-label={`${dayLabel(candidate.date)} ${weekdayLabel(candidate.date)}: ${VERDICT_META[candidate.verdict].label}, passes ${candidate.passes} of ${candidate.tested} tested delays`}
              className={`pp-cell pp-cell-${VERDICT_META[candidate.verdict].tone}${candidate.date === selected ? " selected" : ""}`}
              onClick={() => onSelect(candidate.date)}
            >
              <span className="pp-cell-icon" aria-hidden="true">
                {VERDICT_META[candidate.verdict].icon}
              </span>
              <span className="pp-cell-day pp-num">{Number(candidate.date.slice(8, 10))}</span>
              <span className="pp-cell-meta">
                {candidate.verdict === "insufficient-window" ? "no window" : `${candidate.passes}/${candidate.tested}`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="pp-list" aria-label="Eligible purchase dates as a list">
        {calendar.candidates.map((candidate) => (
          <button
            key={`list-${candidate.date}`}
            type="button"
            className={`pp-list-row${candidate.date === selected ? " selected" : ""}`}
            aria-pressed={candidate.date === selected}
            onClick={() => onSelect(candidate.date)}
          >
            <span className="pp-list-date">
              <strong>{dayLabel(candidate.date)}</strong>
              <span className="pp-muted">{weekdayLabel(candidate.date)}</span>
            </span>
            <VerdictPill verdict={candidate.verdict} passes={candidate.passes} tested={candidate.tested} compact />
            <span className="pp-list-balance pp-num">{money(candidate.balanceAtSelectedDelay)}</span>
          </button>
        ))}
      </div>

      <div className="pp-cal-foot">
        <p className="pp-hint">
          {methodLabel} · {money(outlayToday)} leaves your account on the purchase date.
          {calendar.truncated ? " The range was trimmed to 92 dates." : ""}
        </p>
        {selectedCandidate && (
          <p className="pp-hint">
            Selected {dayLabel(selectedCandidate.date)} — passes {selectedCandidate.passes} of{" "}
            {selectedCandidate.tested} tested delays.
          </p>
        )}
        {calendar.earliestWorkable ? (
          <p className="pp-good-inline">
            <span aria-hidden="true">✓</span> Earliest workable date: {dayLabel(calendar.earliestWorkable)}
          </p>
        ) : (
          <p className="pp-warn-inline">
            <span aria-hidden="true">✕</span> No date in this range works with the current assumptions.
          </p>
        )}
      </div>
    </section>
  );
}

export function describeCandidate(candidate: CandidateDate): string {
  return `${candidate.date}: ${VERDICT_META[candidate.verdict].label}`;
}
