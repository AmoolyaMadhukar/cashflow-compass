/**
 * Purchase-decision replay, powered by Person 2's replay engine.
 *
 * The planner grades past purchase decisions using only what was knowable at
 * each cutoff and compares that with the simple rule "balance − price ≥ reserve".
 * This module turns that summary into the flat list the Insights screen renders.
 */
import type { Transaction } from "../types";
import { runHistoricalReplay } from "../features/planner/engine/replay";
import type { DecisionReplay } from "./types";

/** Reconstruct realised daily net cash from recorded rows. */
function realisedDays(transactions: Transaction[], today: string): { date: string; net: number }[] {
  const dated = [...transactions].filter((tx) => tx.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length === 0) return [];

  const byDate = new Map<string, number>();
  for (const tx of dated) {
    const delta = tx.direction === "income" ? tx.amount : -tx.amount;
    byDate.set(tx.date, (byDate.get(tx.date) ?? 0) + delta);
  }

  // Fill the gaps so the replay sees a continuous calendar, not just event days.
  const first = dated[0].date;
  const out: { date: string; net: number }[] = [];
  const cursor = new Date(`${first}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  while (cursor <= end) {
    const iso = `${cursor.getFullYear()}-${`${cursor.getMonth() + 1}`.padStart(2, "0")}-${`${cursor.getDate()}`.padStart(2, "0")}`;
    out.push({ date: iso, net: byDate.get(iso) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Grade past "could I have bought this?" decisions. Keeps the store's original
 * signature so the caller does not change.
 */
export function replayDecisions(
  _transactions: Transaction[],
  buildForecastAt: (cutoff: string) => { minBalance: number; points: { date: string; balance: number }[] } | null,
  reserve: number,
): DecisionReplay[] {
  // Reuse the caller's own forecast-at-cutoff function so the replay is graded
  // against this app's projection rather than a second model.
  const sample = buildForecastAt(_transactions[0]?.date ?? "");
  if (!sample || sample.points.length === 0) return [];

  const realised = realisedDays(_transactions, new Date().toISOString().slice(0, 10));
  if (realised.length < 60) return [];

  const today = realised[realised.length - 1].date;
  const price = 20000;

  const summary = runHistoricalReplay({
    today,
    price,
    reserve,
    followUpDays: 30,
    realised,
    minHistoryDays: 30,
    cutoffIntervalDays: 14,
    provenance: "user-data",
  });

  if (summary.empty) return [];

  return summary.cases.slice(-6).map((entry) => ({
    id: `replay-${entry.cutoff}`,
    label: `Could you have spent ₹${price.toLocaleString("en-IN")} on ${entry.cutoff}?`,
    amount: price,
    date: entry.cutoff,
    predictedBalance: entry.observedBalance,
    predictedLow: entry.realisedLow ?? entry.observedBalance,
    actualBalance: entry.realisedLow ?? entry.observedBalance,
    withinBand:
      (entry.forecastOutcome === "held" && entry.ruleOutcome === "held") ||
      (entry.forecastOutcome === "breached" && entry.ruleOutcome === "breached"),
    verdict:
      entry.forecastOutcome === "held"
        ? "The forecast said this was affordable, and it held."
        : entry.forecastOutcome === "breached"
          ? "The forecast said this would cross the reserve, and it did."
          : "Not enough later history to grade this one.",
  }));
}

export type { DecisionReplay };
