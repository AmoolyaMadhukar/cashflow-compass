/**
 * The app's view contract.
 *
 * These are the shapes the screens render. They are deliberately stable and
 * small; `src/domain` (Person 1) is the richer model that computes them, and
 * `src/integration/bridge.ts` translates between the two. Keeping the view
 * contract separate is what lets the engine be swapped without touching pages.
 */
import type {
  Direction,
  ExpectedItem,
  Forecast,
  RecurringItem,
  RecurringStatus,
  Scenario,
  Settings,
  Transaction,
  Transfer,
} from "../types";

export type {
  Direction,
  ExpectedItem,
  Forecast,
  RecurringItem,
  RecurringStatus,
  Scenario,
  Settings,
  Transaction,
  Transfer,
};

/** Everything the engine needs to answer a money question for one workspace. */
export interface WorkspaceLedger {
  /** Cash-basis ledger. Expected items are NOT in here. */
  transactions: Transaction[];
  transfers: Transfer[];
  expected: ExpectedItem[];
  /** Dated cash already on hand before the first recorded row. */
  openingBalance: number;
  openingDate: string;
  /** User-chosen minimum reserve. */
  reserve: number;
  horizon: 30 | 60 | 90;
}

/** A point-in-time answer to "can I make this purchase?". */
export interface PurchaseDecision {
  amount: number;
  date: string;
  /** Cash available right now, after everything recorded to date. */
  spendableNow: number;
  /** Room for a purchase as computed by the shared forecast. */
  roomNow: number;
  projectedBalanceOnDate: number;
  lowestBalance: number;
  lowestDate: string;
  coverage: "covered" | "reserve" | "shortfall";
  /** Plain-language explanation with the figures behind it. */
  explanation: string[];
  /** What the same purchase would do on each candidate date. */
  alternatives: PurchaseAlternative[];
}

export interface PurchaseAlternative {
  date: string;
  projectedBalanceOnDate: number;
  lowestBalance: number;
  lowestDate: string;
  coverage: "covered" | "reserve" | "shortfall";
  delta: number;
}

/** One suggestion in the "Needs review" queue. */
export interface Suggestion {
  id: string;
  kind:
    | "confirm-emi"
    | "likely-receipt"
    | "missed-subscription"
    | "category-spike"
    | "due-date-change"
    | "unmatched-receipt";
  tone: "urgent" | "warn" | "info";
  title: string;
  /** What the engine observed. */
  observed: string;
  /** Why it matters for the next decision. */
  why: string;
  /** The concrete next step the user can take. */
  next: string;
  amount: number | null;
  date: string | null;
  facts: string[];
  transactions: Transaction[];
  actions: SuggestionAction[];
  /** Higher sorts first. Time-sensitive items beat cosmetic ones. */
  priority: number;
  recurringKey?: string;
  expectedId?: string;
}

export type SuggestionAction =
  | "confirm-schedule"
  | "edit-date"
  | "mark-received"
  | "match-payment"
  | "one-off"
  | "dismiss"
  | "try-different-date"
  | "compare-dates"
  | "set-aside";

/** Measured forecast reliability, shown behind a compact global control. */
export interface Reliability {
  status: "insufficient" | "measured";
  horizon: number;
  /** Days of recorded history, and the date range they span. */
  historyDays: number;
  historyFrom: string | null;
  historyTo: string | null;
  transactionCount: number;
  /** Share of the last 90 days that has any transaction, 0..1. */
  coverage: number;
  /** Number of days in the coverage window that had activity. */
  coverageDays: number;
  coverageWindow: number;
  meanDailyError: number | null;
  endErrorPercent: number | null;
  sampleSize: number;
  /** Purchase decisions replayed successfully from history (Person 2). */
  replaySampleSize: number;
  replayAccuracy: number | null;
  confidence: "high" | "medium" | "low" | "none";
  method: string;
}

/** Historical replay of an earlier purchase decision. */
export interface DecisionReplay {
  id: string;
  label: string;
  amount: number;
  date: string;
  /** What the forecast said at the time. */
  predictedBalance: number;
  predictedLow: number;
  /** What actually happened. */
  actualBalance: number;
  withinBand: boolean;
  verdict: string;
}

/** Recurring item plus the user's structured preferences. */
export interface RecurrencePreferences {
  priority: "essential" | "flexible";
  nextDue?: string;
  latestDate?: string;
  typicalAmount?: number;
}

export interface RecurringWithPrefs extends RecurringItem {
  priority: "essential" | "flexible";
  latestDate?: string;
}

/** Reconciliation proposal: an expected item and a recorded row that match. */
export interface ReconciliationMatch {
  expectedId: string;
  transactionId: string;
  confidence: number;
  dayGap: number;
  amountGap: number;
  reason: string;
}
