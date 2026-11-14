/**
 * Reconciliation: link an actual transaction to the expected occurrence it
 * satisfies, so importing a statement or recording a payment never counts the
 * same event twice. Missing income becomes a review item; it is never treated
 * as received cash.
 */
import type {
  CashMovement,
  Direction,
  ISODate,
  MatchCandidate,
  ReconciliationResult,
} from "./contracts";
import { betweenDates, daysBetween, makeMovement, movementView } from "./ledger";
import { money } from "../lib/format";

export interface ReconcileOptions {
  /** Expected occurrences: status `expected`, carrying `recurring` or `source`. */
  expected: CashMovement[];
  /** Actual movements, any date. */
  actual: CashMovement[];
  asOf: ISODate;
  /** Amount difference (rupees) still treated as an exact match. */
  amountTolerance?: number;
  /** Amount difference (rupees) that still allows an "uncertain" suggestion. */
  uncertainAmountTolerance?: number;
  /** Day gap still treated as exact. */
  dayTolerance?: number;
  /** Day gap that still allows an "uncertain" suggestion. */
  uncertainDayTolerance?: number;
  /** Movements that already carry a `recurring` link are pre-matched. */
  existingLinks?: { expectedId: string; actualId: string }[];
}

function expectedDirection(movement: CashMovement): Direction {
  return movement.signedAmount >= 0 ? "income" : "expense";
}

/** Human readable match reason, e.g. "Paid 2 days late, ₹120 less than planned". */
export function describeMatch(amountDelta: number, dayDelta: number): string {
  const parts: string[] = [];
  if (dayDelta === 0) parts.push("exactly on the expected date");
  else if (dayDelta > 0) parts.push(`${dayDelta} day${dayDelta === 1 ? "" : "s"} late`);
  else parts.push(`${Math.abs(dayDelta)} day${Math.abs(dayDelta) === 1 ? "" : "s"} early`);
  if (Math.round(amountDelta) === 0) parts.push("same amount");
  else if (amountDelta > 0) parts.push(`${money(amountDelta)} more than expected`);
  else parts.push(`${money(Math.abs(amountDelta))} less than expected`);
  return `Matches ${parts.join(", ")}.`;
}

/**
 * Score one expected/actual pair. Lower is better; `score` combines rupees of
 * amount mismatch with a per-day penalty so a ₹10 shift three days out ranks
 * better than a ₹2,000 shift on the right day.
 */
export function matchScore(expected: CashMovement, actual: CashMovement): { score: number; amountDelta: number; dayDelta: number } {
  const amountDelta = actual.amount - expected.amount;
  const dayDelta = daysBetween(expected.date, actual.date);
  const score = Math.abs(amountDelta) + Math.abs(dayDelta) * Math.max(50, expected.amount * 0.02);
  return { score, amountDelta, dayDelta };
}

export function reconcile({
  expected,
  actual,
  asOf,
  amountTolerance = 25,
  uncertainAmountTolerance = 500,
  dayTolerance = 1,
  uncertainDayTolerance = 12,
  existingLinks = [],
}: ReconcileOptions): ReconciliationResult {
  const claimed = new Set<string>(existingLinks.map((link) => link.actualId));
  const matched: ReconciliationResult["matched"] = existingLinks.map((link) => ({
    expectedId: link.expectedId,
    actualId: link.actualId,
    reason: "Already linked by an explicit movement reference.",
  }));
  const matchedExpected = new Set(existingLinks.map((link) => link.expectedId));
  const uncertain: MatchCandidate[] = [];
  const unmatchedActualIds: string[] = [];
  let preventedDoubleCount = 0;

  // Only actual money movement dated on/before asOf can satisfy an occurrence.
  const actualPool = actual
    .filter((movement) => movement.status === "actual" && movement.date <= asOf)
    .filter((movement) => movement.kind !== "transfer" && movement.kind !== "savings_pot")
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const pairs: { expected: CashMovement; actual: CashMovement; score: number; amountDelta: number; dayDelta: number }[] = [];
  for (const exp of expected) {
    if (matchedExpected.has(exp.id)) continue;
    for (const act of actualPool) {
      if (claimed.has(act.id)) continue;
      if (expectedDirection(exp) !== (act.signedAmount >= 0 ? "income" : "expense")) continue;
      const { score, amountDelta, dayDelta } = matchScore(exp, act);
      if (Math.abs(dayDelta) > uncertainDayTolerance) continue;
      if (Math.abs(amountDelta) > Math.max(uncertainAmountTolerance, exp.amount * 0.35)) continue;
      pairs.push({ expected: exp, actual: act, score, amountDelta, dayDelta });
    }
  }
  pairs.sort((a, b) => a.score - b.score);

  for (const pair of pairs) {
    if (matchedExpected.has(pair.expected.id) || claimed.has(pair.actual.id)) continue;
    const exact = Math.abs(pair.amountDelta) <= amountTolerance && Math.abs(pair.dayDelta) <= dayTolerance;
    const strong =
      Math.abs(pair.amountDelta) <= Math.max(amountTolerance, pair.expected.amount * 0.01) &&
      Math.abs(pair.dayDelta) <= 3;
    if (exact || strong) {
      claimed.add(pair.actual.id);
      matchedExpected.add(pair.expected.id);
      preventedDoubleCount += pair.actual.amount;
      matched.push({
        expectedId: pair.expected.id,
        actualId: pair.actual.id,
        reason: describeMatch(pair.amountDelta, pair.dayDelta),
      });
    } else {
      uncertain.push({
        expectedMovementId: pair.expected.id,
        actualMovementId: pair.actual.id,
        amountDelta: pair.amountDelta,
        dayDelta: pair.dayDelta,
        score: Math.round(pair.score),
        confidence: "uncertain",
        reason: describeMatch(pair.amountDelta, pair.dayDelta),
      });
    }
  }

  for (const act of actualPool) if (!claimed.has(act.id)) unmatchedActualIds.push(act.id);

  // Missing: expected, still unclaimed, and its date has passed.
  const missing: ReconciliationResult["missing"] = [];
  for (const exp of expected) {
    if (matchedExpected.has(exp.id)) continue;
    if (exp.date > asOf) continue;
    const late = daysBetween(exp.date, asOf);
    missing.push({
      expectedId: exp.id,
      label: exp.label,
      direction: expectedDirection(exp),
      amount: exp.amount,
      expectedDate: exp.date,
      daysLate: late,
      reason:
        expectedDirection(exp) === "income"
          ? `${exp.label} of ${money(exp.amount)} was expected on ${exp.date} and has not arrived. It is NOT counted as received cash — confirm, reschedule or dismiss it.`
          : `${exp.label} of ${money(exp.amount)} was due on ${exp.date} with no matching payment found. It stays in the review queue.`,
    });
  }

  return {
    matched,
    // Keep the queue short and useful: best candidate per actual movement.
    uncertain: dedupeUncertain(uncertain),
    missing: missing.sort((a, b) => b.daysLate - a.daysLate),
    unmatchedActualIds,
    preventedDoubleCount: Math.round(preventedDoubleCount),
  };
}

function dedupeUncertain(candidates: MatchCandidate[]): MatchCandidate[] {
  const bestForActual = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    const existing = bestForActual.get(candidate.actualMovementId);
    if (!existing || candidate.score < existing.score) bestForActual.set(candidate.actualMovementId, candidate);
  }
  return [...bestForActual.values()].sort((a, b) => a.score - b.score);
}

/**
 * Apply a confirmed link: the actual movement carries the recurring reference,
 * and the expected copy is dropped from the forecast (which is how the same
 * event stops counting twice).
 */
export function linkActualToExpected(expectedMovement: CashMovement, actualMovement: CashMovement): CashMovement {
  if (!expectedMovement.recurring) {
    return { ...actualMovement, source: expectedMovement.source ?? actualMovement.source };
  }
  return {
    ...actualMovement,
    recurring: { ...expectedMovement.recurring },
    source: expectedMovement.source ?? actualMovement.source,
    status: "actual",
  };
}

/**
 * Turn a confirmed expected occurrence into a real, dated actual movement —
 * used when the user records "I paid this EMI today" without importing a whole
 * statement. Sign is taken from the expectation; it is recorded once.
 */
export function confirmOccurrenceAsActual(expectedMovement: CashMovement, paidOn?: ISODate, paidAmount?: number): CashMovement {
  return makeMovement({
    id: `pay-${expectedMovement.id}`,
    date: paidOn ?? expectedMovement.date,
    label: expectedMovement.label,
    amount: paidAmount ?? expectedMovement.amount,
    kind: expectedMovement.kind,
    direction: expectedMovement.signedAmount >= 0 ? "income" : "expense",
    accountId: expectedMovement.accountId,
    category: expectedMovement.category,
    status: "actual",
    recurring: expectedMovement.recurring,
    source: expectedMovement.source,
    note: "Confirmed by the user from a scheduled occurrence.",
    origin: "manual",
  });
}

/** Filter helper for the review UI: expected items that are due inside a window. */
export function dueExpected(expected: CashMovement[], from: ISODate, to: ISODate): CashMovement[] {
  return expected.filter((movement) => movement.status === "expected" && betweenDates(movement.date, from, to)).map(movementView);
}

/** Exposed for Person 3's store to reuse the same date math. */
export { daysBetween as daysApart };
