import { useEffect, useMemo, useState } from "react";
import type {
  FixOption,
  IsoDate,
  PlannerData,
  PurchasePlan,
} from "./engine/types";
import { DEFAULT_CUSTOM_LOAN, DEFAULT_EMI } from "./engine/types";
import { addDays, daysBetween } from "./engine/dates";
import { buildPurchaseSchedule, outlayOnPurchaseDate, scheduleSummary } from "./engine/schedule";
import { buildCalendar, scheduleForDate } from "./engine/calendar";
import { buildScenario, evaluatePurchaseDate, explainDate, moveReceipt } from "./engine/whatif";
import { findFixes } from "./engine/fixes";
import { PurchaseForm } from "./ui/PurchaseForm";
import { PurchaseCalendar } from "./ui/PurchaseCalendar";
import { DateExplanation } from "./ui/DateExplanation";
import { FixPanel } from "./ui/FixPanel";
import { SavingsScenario } from "./ui/SavingsScenario";
import { HistoricalReplay } from "./ui/HistoricalReplay";
import { money } from "./ui/format";
import "./planner.css";

/**
 * PurchasePlanner — Person 2's feature entry point.
 *
 * Copy this file plus `engine/`, `ui/` and `planner.css` together; only
 * `engine/types.ts` (the shared contract) and this component's props are public.
 */

export interface PurchasePlannerProps {
  /** The active user's data, already mapped by the adapter. */
  data: PlannerData;
  /** Called when the user explicitly records a purchase (never for a what-if). */
  onRecordPurchase?: (purchase: {
    item: string;
    price: number;
    date: IsoDate;
    method: PurchasePlan["method"];
    totalPaid: number;
  }) => void;
  /** Optional adapter hook so the historical replay can see recorded history. */
  history?: {
    start: IsoDate | null;
    events: { date: IsoDate; amount: number; direction: "income" | "expense" }[];
  };
  /** Optional: the app's own toast, so the planner does not own notifications. */
  notify?: (message: string) => void;
  /** Prefill from the dashboard's "Check a purchase" action. */
  initialAmount?: number;
  initialDate?: IsoDate;
}

interface AppliedChange {
  kind: FixOption["kind"];
  label: string;
  previous: { price: number; earliestDate: IsoDate };
}

export function PurchasePlanner({
  data,
  onRecordPurchase,
  history,
  notify,
  initialAmount,
  initialDate,
}: PurchasePlannerProps) {
  const today = data.today;

  const [plan, setPlan] = useState<PurchasePlan>(() => ({
    item: "New laptop",
    price: initialAmount && initialAmount > 0 ? initialAmount : 10000,
    earliestDate: initialDate && initialDate > today ? initialDate : addDays(today, 1),
    latestDate: addDays(today, 20),
    priority: "planned",
    method: "full",
    emi: { ...DEFAULT_EMI },
    customLoan: { ...DEFAULT_CUSTOM_LOAN },
  }));

  const [range, setRange] = useState<{ from: IsoDate; to: IsoDate }>({
    from: addDays(today, 1),
    to: addDays(today, 20),
  });
  const [receiptId, setReceiptId] = useState<string | null>(data.receipts[0]?.id ?? null);
  const [maxDelayDays, setMaxDelayDays] = useState(7);
  const [selectedDelayDays, setSelectedDelayDays] = useState(0);
  const [followUpDays, setFollowUpDays] = useState(30);
  const [selectedDate, setSelectedDate] = useState<IsoDate | null>(null);
  const [applied, setApplied] = useState<AppliedChange | null>(null);
  const [previewKind, setPreviewKind] = useState<FixOption["kind"] | null>(null);
  const [recorded, setRecorded] = useState(0);

  // Keep the calendar range in step with the purchase form's own bounds.
  useEffect(() => {
    setRange({ from: plan.earliestDate, to: plan.latestDate });
  }, [plan.earliestDate, plan.latestDate]);

  // A receipt that disappears (e.g. after a data refresh) must not linger.
  useEffect(() => {
    if (receiptId && !data.receipts.some((receipt) => receipt.id === receiptId)) {
      setReceiptId(data.receipts[0]?.id ?? null);
    }
  }, [data.receipts, receiptId]);

  const lastVisible = data.daily.length > 0 ? data.daily[data.daily.length - 1].date : data.forecastEnd;

  const baseSchedule = useMemo(() => buildPurchaseSchedule(plan, lastVisible), [plan, lastVisible]);
  const outlayToday = outlayOnPurchaseDate(baseSchedule);

  const calendar = useMemo(
    () =>
      buildCalendar(data, {
        from: range.from,
        to: range.to,
        plan: baseSchedule,
        maxDelayDays,
        followUpDays,
        receiptId,
        selectedDelayDays,
      }),
    [data, range.from, range.to, baseSchedule, maxDelayDays, followUpDays, receiptId, selectedDelayDays],
  );

  // Default the inspected date to the earliest workable one.
  useEffect(() => {
    if (selectedDate && calendar.candidates.some((candidate) => candidate.date === selectedDate)) return;
    setSelectedDate(calendar.earliestWorkable ?? calendar.candidates[0]?.date ?? null);
  }, [calendar, selectedDate]);

  const inspectedDate = selectedDate ?? calendar.candidates[0]?.date ?? range.from;

  const evaluation = useMemo(() => {
    const schedule = scheduleForDate(baseSchedule, inspectedDate, lastVisible);
    return {
      schedule,
      result: evaluatePurchaseDate(data, schedule, inspectedDate, {
        maxDelayDays,
        followUpDays,
        receiptId,
        selectedDelayDays,
      }),
    };
  }, [data, baseSchedule, inspectedDate, lastVisible, maxDelayDays, followUpDays, receiptId, selectedDelayDays]);

  const explanation = useMemo(() => {
    const moved = receiptId && selectedDelayDays > 0 ? moveReceipt(data, receiptId, selectedDelayDays) : null;
    return explainDate(data, evaluation.schedule, inspectedDate, evaluation.result, moved);
  }, [data, evaluation, inspectedDate, receiptId, selectedDelayDays]);

  const ledger = useMemo(
    () =>
      buildLedgerForDisplay(
        data,
        evaluation.schedule,
        inspectedDate,
        followUpDays,
        receiptId,
        selectedDelayDays,
      ),
    [data, evaluation.schedule, inspectedDate, followUpDays, receiptId, selectedDelayDays],
  );

  const fixes = useMemo(
    () =>
      findFixes({
        data,
        plan: baseSchedule,
        purchaseDate: inspectedDate,
        followUpDays,
        maxDelayDays,
        receiptId,
        selectedDelayDays,
      }),
    [data, baseSchedule, inspectedDate, followUpDays, maxDelayDays, receiptId, selectedDelayDays],
  );

  /** Preview = show the numbers for a fix without changing the purchase. */
  const previewFix = (fix: FixOption) => {
    setPreviewKind(fix.kind);
    setSelectedDate(fix.purchaseDate);
    if (fix.kind === "reduce-price") {
      setPlan((current) => ({ ...current, price: fix.price }));
    } else if (fix.kind === "later-date") {
      setPlan((current) => ({
        ...current,
        earliestDate: fix.purchaseDate,
        latestDate: fix.purchaseDate > current.latestDate ? fix.purchaseDate : current.latestDate,
      }));
    }
  };

  const applyFix = (fix: FixOption) => {
    setApplied({ kind: fix.kind, label: fix.label, previous: { price: plan.price, earliestDate: plan.earliestDate } });
    if (fix.kind === "reduce-price") setPlan((current) => ({ ...current, price: fix.price }));
    if (fix.kind === "later-date") {
      setPlan((current) => ({
        ...current,
        earliestDate: fix.purchaseDate,
        latestDate: fix.purchaseDate > current.latestDate ? fix.purchaseDate : current.latestDate,
      }));
      setSelectedDate(fix.purchaseDate);
    }
    setPreviewKind(null);
    notify?.(`Applied: ${fix.label}. This is a hypothetical change until you record it.`);
  };

  const undo = () => {
    if (!applied) return;
    setPlan((current) => ({ ...current, price: applied.previous.price, earliestDate: applied.previous.earliestDate }));
    setApplied(null);
    notify?.("Reverted the hypothetical change.");
  };

  const reset = () => {
    setPlan({
      item: "New laptop",
      price: 10000,
      earliestDate: addDays(today, 1),
      latestDate: addDays(today, 20),
      priority: "planned",
      method: "full",
      emi: { ...DEFAULT_EMI },
      customLoan: { ...DEFAULT_CUSTOM_LOAN },
    });
    setApplied(null);
    setPreviewKind(null);
    setSelectedDate(null);
    setMaxDelayDays(7);
    setSelectedDelayDays(0);
    setFollowUpDays(30);
  };

  const gradedThrough = addDays(lastVisible, -followUpDays);
  const isFixture = data.provenance.source === "development-fixture";

  return (
    <div className="pp-root" id="purchase-planner" data-planner="purchase">
      <header className="pp-page-head">
        <div>
          <p className="pp-eyebrow">Purchase planner</p>
          <h1>Enter the purchase. See every date it works.</h1>
          <p className="pp-page-sub">
            Simulate a purchase against your reserve and one expected receipt, inspect why any date fails, then
            apply the smallest change that fixes it. Nothing here is recorded until you record it.
          </p>
        </div>
        <div className="pp-head-meta">
          <span className={`pp-badge${isFixture ? " pp-badge-warn" : ""}`}>
            {isFixture ? "Development fixture" : "Your data"}
          </span>
          <span className="pp-badge">Reserve {money(data.reserve)}</span>
          <span className="pp-badge">Balance today {money(data.openingBalance)}</span>
        </div>
      </header>

      {isFixture && (
        <p className="pp-warn-block">
          <span aria-hidden="true">⚠</span> {data.provenance.note}
        </p>
      )}

      {plan.earliestDate > plan.latestDate && (
        <p className="pp-warn-block">
          <span aria-hidden="true">⚠</span> The latest acceptable date is before the earliest purchase date, so
          only the earliest date is graded.
        </p>
      )}

      <div className="pp-layout">
        <div className="pp-col-side">
          <PurchaseForm
            today={today}
            forecastEnd={lastVisible}
            gradedThrough={gradedThrough}
            value={plan}
            onChange={(next) => {
              setPlan(next);
              setPreviewKind(null);
            }}
            onReset={reset}
            recordedCount={recorded}
          />
          <FixPanel
            fixes={fixes}
            purchaseDate={inspectedDate}
            applied={applied?.kind ?? previewKind}
            onPreview={previewFix}
            onApply={applyFix}
            onUndo={undo}
            onReset={reset}
            canUndo={applied !== null}
          />
        </div>

        <div className="pp-col-main">
          <PurchaseCalendar
            calendar={calendar}
            selected={selectedDate}
            onSelect={setSelectedDate}
            receipts={data.receipts}
            receiptId={receiptId}
            onReceiptChange={(id) => {
              setReceiptId(id);
              setSelectedDelayDays(0);
            }}
            maxDelayDays={maxDelayDays}
            onMaxDelayChange={(days) => {
              setMaxDelayDays(days);
              setSelectedDelayDays((current) => Math.min(current, days));
            }}
            selectedDelayDays={selectedDelayDays}
            onSelectedDelayChange={setSelectedDelayDays}
            followUpDays={followUpDays}
            onFollowUpChange={setFollowUpDays}
            options={range}
            onRangeChange={(next) => setRange({ from: next.from, to: next.to })}
            outlayToday={outlayToday}
            methodLabel={scheduleSummary(baseSchedule)}
          />

          <DateExplanation
            explanation={explanation}
            date={inspectedDate}
            ledger={ledger}
            reserve={data.reserve}
            purchaseDate={inspectedDate}
            schedule={evaluation.schedule}
            insufficient={evaluation.result.verdict === "insufficient-window"}
          />

          <div className="pp-record">
            <div>
              <h2>Record this purchase?</h2>
              <p className="pp-hint">
                An urgent item defaults to the earliest date but stays hypothetical until you record it.
                Recording only tells the app what you decided — it does not alter past transactions.
              </p>
            </div>
            <button
              type="button"
              className="pp-btn pp-btn-primary"
              onClick={() => {
                setRecorded((count) => count + 1);
                onRecordPurchase?.({
                  item: plan.item,
                  price: plan.price,
                  date: inspectedDate,
                  method: plan.method,
                  totalPaid: evaluation.schedule.totalPaid,
                });
                notify?.("Purchase recorded. It stays hypothetical in the forecast until you add it.");
              }}
            >
              Record purchase on {inspectedDate}
            </button>
          </div>

          <HistoricalReplay
            data={data}
            plan={plan}
            followUpDays={followUpDays}
            historyStart={history?.start ?? null}
            historyEvents={history?.events ?? []}
          />

          <SavingsScenario data={data} />
        </div>
      </div>

      <p className="pp-foot">
        Deterministic planning arithmetic on the forecast you already have. No probabilities are modelled, no
        interest is assumed unless you enter it, and nothing is advice.
        {daysBetween(today, lastVisible) > 0
          ? ` Forecast covers ${daysBetween(today, lastVisible)} days ahead.`
          : ""}
      </p>
    </div>
  );
}

/** The ledger shown next to the explanation: the inspected date under the selected delay. */
function buildLedgerForDisplay(
  data: PlannerData,
  schedule: ReturnType<typeof scheduleForDate>,
  purchaseDate: IsoDate,
  followUpDays: number,
  receiptId: string | null,
  selectedDelayDays: number,
) {
  const rows = schedule.rows
    .filter((row) => row.date >= purchaseDate)
    .map((row) => ({ date: row.date, amount: row.amount, label: row.label }));
  const moved = receiptId && selectedDelayDays > 0 ? moveReceipt(data, receiptId, selectedDelayDays) : null;
  const windowEnd = addDays(purchaseDate, followUpDays);
  const scenario = buildScenario({ data, purchaseRows: rows, movedReceipts: moved ? [moved] : [] });
  return {
    ...scenario.ledger,
    days: scenario.ledger.days.filter((day) => day.date >= purchaseDate && day.date <= windowEnd),
  };
}
