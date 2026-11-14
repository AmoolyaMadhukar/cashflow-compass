import type { IsoDate } from "./types";
import { addDays, daysBetween } from "./dates";

/**
 * "Would this decision have worked?"
 *
 * Method (identical reserve, price and follow-up horizon on both sides):
 *  - Cutoffs are past dates for which we hold *held-out actuals*: the realised
 *    balance path after the cutoff is never shown to the recommender.
 *  - At each cutoff the planner builds a forecast using only transactions dated
 *    on or before it (knowable-then data) and asks: does buying on the cutoff and
 *    holding the follow-up horizon stay above the reserve?
 *  - The scorer then walks the realised path from the actual balance at the
 *    cutoff, applies the same hypothetical purchase, and checks the same horizon.
 *  - The simple baseline rule is "buy when today's balance minus price is above
 *    the reserve".
 *
 * The engine is deliberately generic over a `ReplayPoint` input so it can be unit
 * checked with synthetic data and fed real user history by the adapter. It never
 * invents an advantage: counts are reported as-is, including the cases where the
 * rule and the forecast disagree.
 */

export interface ReplayDay {
  date: IsoDate;
  /** Dated cash movements on this day (already signed: income +, expense -). */
  net: number;
}

export interface ReplayInput {
  today: IsoDate;
  price: number;
  reserve: number;
  followUpDays: number;
  /** Realised net movements, oldest first, covering history and the follow-up. */
  realised: ReplayDay[];
  /** First cutoff that has at least `minHistoryDays` of data before it. */
  minHistoryDays?: number;
  /** Space cutoffs out so the cases are not all the same week. */
  cutoffIntervalDays?: number;
  /** Where the label "synthetic demo results" comes from. */
  provenance: "user-data" | "synthetic-demo";
}

export interface ReplayCase {
  cutoff: IsoDate;
  observedBalance: number;
  /** Balance "knowable then": realised balance at the cutoff (no look-ahead). */
  ruleWouldBuy: boolean;
  ruleOutcome: "held" | "breached" | "unknown";
  forecastWouldBuy: boolean;
  forecastOutcome: "held" | "breached" | "unknown";
  realisedLow: number | null;
  realisedLowDate: IsoDate | null;
}

export interface ReplaySummary {
  evaluated: number;
  rule: { buys: number; breached: number; held: number; deferredThatWorked: number };
  forecast: { buys: number; breached: number; held: number; deferredThatWorked: number };
  cases: ReplayCase[];
  provenance: "user-data" | "synthetic-demo";
  /** True when there is not enough history to say anything at all. */
  empty: boolean;
  horizonDays: number;
  price: number;
  reserve: number;
}

/**
 * A deliberately simple "knowable-then" recommender: average realised daily net of
 * the last `minHistoryDays` days, projected forward, compared with the reserve.
 * It is *not* a probability model, so no probability is ever reported.
 */
function forecastVerdict(
  realised: ReplayDay[],
  cutoffIndex: number,
  window: number,
  price: number,
  reserve: number,
  horizon: number,
): { wouldBuy: boolean; outcome: "held" | "breached" | "unknown" } {
  const start = Math.max(0, cutoffIndex - window);
  const history = realised.slice(start, cutoffIndex + 1);
  if (history.length < window) return { wouldBuy: false, outcome: "unknown" };
  const balance = history.reduce((sum, day) => sum + day.net, 0);
  const average = balance / history.length;
  let projected = balance - price;
  let worst = projected;
  for (let d = 1; d <= horizon; d++) {
    projected += average;
    worst = Math.min(worst, projected);
  }
  return { wouldBuy: worst >= reserve, outcome: worst >= reserve ? "held" : "breached" };
}

export function runHistoricalReplay(input: ReplayInput): ReplaySummary {
  const minHistory = input.minHistoryDays ?? 45;
  const interval = input.cutoffIntervalDays ?? 7;
  const horizon = input.followUpDays;

  // Running realisation of balances without look-ahead.
  const running: number[] = [];
  let balance = 0;
  for (const day of input.realised) {
    balance += day.net;
    running.push(balance);
  }

  const cases: ReplayCase[] = [];
  for (let index = minHistory; index + horizon < input.realised.length; index += interval) {
    const cutoff = input.realised[index].date;
    const observed = running[index];
    const ruleWouldBuy = observed - input.price >= input.reserve;

    let realisedLow = Number.POSITIVE_INFINITY;
    let realisedLowDate: IsoDate | null = null;
    for (let d = 0; d <= horizon; d++) {
      const value = running[index + d] - input.price;
      if (value < realisedLow) {
        realisedLow = value;
        realisedLowDate = input.realised[index + d].date;
      }
    }
    const realisedOk = Number.isFinite(realisedLow) && realisedLow >= input.reserve;

    const forecast = forecastVerdict(
      input.realised,
      index,
      minHistory,
      input.price,
      input.reserve,
      horizon,
    );

    cases.push({
      cutoff,
      observedBalance: observed,
      ruleWouldBuy,
      ruleOutcome: ruleWouldBuy ? (realisedOk ? "held" : "breached") : "unknown",
      forecastWouldBuy: forecast.wouldBuy,
      forecastOutcome: forecast.wouldBuy ? (realisedOk ? "held" : "breached") : "unknown",
      realisedLow: Number.isFinite(realisedLow) ? realisedLow : null,
      realisedLowDate,
    });
  }

  const empty = cases.length === 0;
  const summarise = (side: "rule" | "forecast") => {
    const buys = cases.filter((item) =>
      side === "rule" ? item.ruleWouldBuy : item.forecastWouldBuy,
    );
    const breached = buys.filter((item) =>
      (side === "rule" ? item.ruleOutcome : item.forecastOutcome) === "breached",
    ).length;
    // Cases where the recommender deferred but buying would in fact have worked.
    const deferredThatWorked = cases.filter((item) => {
      const bought = side === "rule" ? item.ruleWouldBuy : item.forecastWouldBuy;
      if (bought) return false;
      if (item.realisedLow === null) return false;
      return item.realisedLow >= input.reserve;
    }).length;
    return { buys: buys.length, breached, held: buys.length - breached, deferredThatWorked };
  };

  return {
    evaluated: cases.length,
    rule: summarise("rule"),
    forecast: summarise("forecast"),
    cases,
    provenance: input.provenance,
    empty,
    horizonDays: horizon,
    price: input.price,
    reserve: input.reserve,
  };
}

/** Convenience: build ReplayDay[] from dated events over a window. */
export function realisedFromEvents(
  events: { date: IsoDate; amount: number; direction: "income" | "expense" }[],
  from: IsoDate,
  to: IsoDate,
): ReplayDay[] {
  const byDate = new Map<IsoDate, number>();
  for (const event of events) {
    if (event.date < from || event.date > to) continue;
    byDate.set(event.date, (byDate.get(event.date) ?? 0) + (event.direction === "income" ? event.amount : -event.amount));
  }
  const days: ReplayDay[] = [];
  let cursor = from;
  for (let guard = 0; guard < 1500 && cursor <= to; guard++) {
    days.push({ date: cursor, net: byDate.get(cursor) ?? 0 });
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function cutoffCountLabel(summary: ReplaySummary): string {
  if (summary.empty) return "No eligible cutoff yet";
  return `${summary.evaluated} cutoff${summary.evaluated === 1 ? "" : "s"} evaluated`;
}

export function followUpSpanLabel(input: ReplayInput): string {
  return `${input.followUpDays}-day follow-up`;
}

export function daysAvailable(days: ReplayDay[]): number {
  if (days.length < 2) return 0;
  return daysBetween(days[0].date, days[days.length - 1].date);
}
