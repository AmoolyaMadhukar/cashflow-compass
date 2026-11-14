import type {
  CandidateDate,
  IsoDate,
  PlannerData,
  PurchaseSchedule,
} from "./types";
import { addDays, daysBetween, eachDay } from "./dates";
import { evaluatePurchaseDate } from "./whatif";

/**
 * The purchase timing calendar.
 *
 * For every eligible purchase date between the earliest and the latest acceptable
 * date we simulate the purchase against the reserve for one selected receipt,
 * testing delays 0..maxDelay. Every candidate uses the *same* follow-up period, so
 * late dates are not flattered by a shorter window; when that period runs past the
 * shared forecast the date is marked "Insufficient forecast window" instead of
 * being silently graded.
 */

export interface CalendarOptions {
  /** First eligible purchase date (usually the plan's earliest date). */
  from: IsoDate;
  /** Last acceptable purchase date. */
  to: IsoDate;
  plan: PurchaseSchedule;
  maxDelayDays: number;
  followUpDays: number;
  receiptId: string | null;
  selectedDelayDays: number;
  /** Hard cap so the calendar never renders thousands of cells. */
  maxDays?: number;
}

export interface CalendarResult {
  candidates: CandidateDate[];
  testedDelays: number[];
  earliestWorkable: IsoDate | null;
  /** Last date whose follow-up period fits inside the shared forecast. */
  gradedThrough: IsoDate;
  insufficientWindowFrom: IsoDate | null;
  counts: Record<CandidateDate["verdict"], number>;
  scannedDays: number;
  truncated: boolean;
}

/**
 * Re-date a schedule for a candidate purchase date, keeping the same shape
 * (down payment, fees, instalment count and spacing) as the user's plan.
 */
export function scheduleForDate(
  base: PurchaseSchedule,
  purchaseDate: IsoDate,
  lastVisibleDate: IsoDate,
): PurchaseSchedule {
  if (base.rows.length === 0) return base;
  const originalFirst = base.rows[0].date;
  const shifted = base.rows.map((row) => ({
    ...row,
    date: addDays(purchaseDate, daysBetween(originalFirst, row.date)),
  }));
  return {
    ...base,
    rows: shifted,
    firstDueDate: shifted.length > 1 ? shifted[1].date : purchaseDate,
    outsideWindow: shifted.filter((row) => row.date > lastVisibleDate).length,
  };
}

export function buildCalendar(data: PlannerData, options: CalendarOptions): CalendarResult {
  const maxDays = options.maxDays ?? 92;
  const from = options.from < data.today ? data.today : options.from;
  const to = options.to < from ? from : options.to;
  const allDates = eachDay(from, to);
  const truncated = allDates.length > maxDays;
  const dates = truncated ? allDates.slice(0, maxDays) : allDates;
  const lastVisible = data.daily.length > 0 ? data.daily[data.daily.length - 1].date : data.forecastEnd;

  const testedDelays: number[] = [];
  for (let d = 0; d <= Math.max(0, Math.floor(options.maxDelayDays)); d += 1) testedDelays.push(d);

  const candidates: CandidateDate[] = [];
  const counts: CalendarResult["counts"] = {
    works: 0,
    timing: 0,
    "below-reserve": 0,
    "insufficient-window": 0,
  };

  for (const date of dates) {
    const schedule = scheduleForDate(options.plan, date, lastVisible);
    const result = evaluatePurchaseDate(data, schedule, date, {
      maxDelayDays: options.maxDelayDays,
      followUpDays: options.followUpDays,
      receiptId: options.receiptId,
      selectedDelayDays: options.selectedDelayDays,
    });
    const candidate: CandidateDate = {
      date,
      verdict: result.verdict,
      passes: result.passes,
      tested: result.tested,
      lowestBalance: result.lowestBalance,
      lowestDate: result.lowestDate,
      balanceAtSelectedDelay: result.balanceAtSelectedDelay,
      headroom: result.headroom,
    };
    candidates.push(candidate);
    counts[candidate.verdict] += 1;
  }

  const earliestWorkable =
    candidates.find((candidate) => candidate.verdict === "works")?.date ??
    candidates.find((candidate) => candidate.verdict === "timing")?.date ??
    null;

  const gradedThrough = addDays(data.forecastEnd, -options.followUpDays);
  const firstInsufficient = candidates.find(
    (candidate) => candidate.verdict === "insufficient-window",
  );

  return {
    candidates,
    testedDelays,
    earliestWorkable,
    gradedThrough,
    insufficientWindowFrom: firstInsufficient ? firstInsufficient.date : null,
    counts,
    scannedDays: dates.length,
    truncated,
  };
}
