/**
 * Purchase planner domain contracts (Person 2).
 *
 * Everything here is expressed in the shared vocabulary agreed with Person 1/3:
 *   - local ISO calendar dates ("yyyy-mm-dd")
 *   - INR amounts
 *   - dated daily balances with lower/upper estimates
 *   - identifiable receipt and bill events
 *   - a user reserve
 *   - allowed flexibility windows
 *
 * The planner never reads the store directly; `../adapter` maps whatever the app
 * owns today into `PlannerData`.
 */

export type IsoDate = string;

/** A dated cash movement the planner is allowed to reason about. */
export interface PlannerEvent {
  /** Stable id — used to count an occurrence exactly once. */
  id: string;
  date: IsoDate;
  label: string;
  amount: number;
  direction: "income" | "expense";
  category: string;
  kind: "recurring" | "scenario" | "variable" | "other";
  /** Present for detected recurring series; lets us re-date one occurrence only. */
  seriesKey?: string;
  isEstimate?: boolean;
  /** User-approved window in which this expense may be moved (Person 3 owns the rule UI). */
  flexibility?: FlexibilityWindow;
}

export interface FlexibilityWindow {
  /** Earliest date the user is willing to pay this expense. */
  earliest: IsoDate;
  /** Latest date the user is willing to pay this expense. */
  latest: IsoDate;
}

/** One entry of the shared daily forecast series. */
export interface DailyBalancePoint {
  date: IsoDate;
  balance: number;
  lower: number;
  upper: number;
}

/** The shared financial slice the planner consumes. */
export interface PlannerData {
  /** "today" for the active user — planner candidates start here. */
  today: IsoDate;
  /** Current cash the user can spend (projected balance on `today`). */
  openingBalance: number;
  /** User's chosen cash reserve that must not be crossed. */
  reserve: number;
  /** Expected receipts (income) the user may choose from. */
  receipts: PlannerEvent[];
  /** Bills / expenses that drive the forecast path. */
  bills: PlannerEvent[];
  /**
   * Shared daily forecast covering at least `today + forecastHorizonDays`.
   * Balances are net of the events above; the planner re-applies events itself so
   * that moving one receipt is exact.
   */
  daily: DailyBalancePoint[];
  /** Last date covered by the shared forecast. */
  forecastEnd: IsoDate;
  /**
   * Baseline (no-planner-action) daily balances, used for the "does the baseline
   * already break the reserve?" check and for before/after messaging.
   */
  baseline: DailyBalancePoint[];
  /** Average variable net cash movement per day (income minus expense). */
  variableNetPerDay: number;
  /** Average variable spend per day — used to say "everyday spending" honestly. */
  variableExpensePerDay: number;
  /** Where the numbers came from, so the UI can label fixtures. */
  provenance: PlannerProvenance;
}

export interface PlannerProvenance {
  source: "user-data" | "development-fixture";
  /** Human readable note shown in the UI. */
  note: string;
}

/* ------------------------------ purchase form ------------------------------ */

export type PaymentMethod = "full" | "emi" | "custom-loan";
export type Priority = "urgent" | "planned" | "flexible";

export interface EmiTerms {
  /** Upfront payment made on the purchase date. */
  downPayment: number;
  /** Processing fee charged on the purchase date. */
  processingFee: number;
  /** Optional flat monthly interest rate in percent of the financed amount. */
  monthlyRatePercent: number;
  instalments: number;
}

export interface CustomLoanTerms {
  downPayment: number;
  processingFee: number;
  instalments: number;
  /** Simple flat interest in percent of the financed amount, charged once. */
  flatInterestPercent: number;
}

export interface PurchasePlan {
  item: string;
  price: number;
  earliestDate: IsoDate;
  latestDate: IsoDate;
  priority: Priority;
  method: PaymentMethod;
  emi?: EmiTerms;
  customLoan?: CustomLoanTerms;
}

export const DEFAULT_EMI: EmiTerms = {
  downPayment: 0,
  processingFee: 0,
  monthlyRatePercent: 2,
  instalments: 6,
};

export const DEFAULT_CUSTOM_LOAN: CustomLoanTerms = {
  downPayment: 0,
  processingFee: 0,
  instalments: 4,
  flatInterestPercent: 5,
};

/* --------------------------------- results --------------------------------- */

export type DateVerdict = "works" | "timing" | "below-reserve" | "insufficient-window";

export interface CandidateDate {
  date: IsoDate;
  verdict: DateVerdict;
  /** Delays (days) that still left the reserve intact → "passes X of Y". */
  passes: number;
  tested: number;
  /** Balance floor across all tested delays (worst case). */
  lowestBalance: number;
  lowestDate: IsoDate;
  /** Balance floor with the currently selected assumption applied. */
  balanceAtSelectedDelay: number;
  /** Cash still available above the reserve in the worst tested case. */
  headroom: number;
}

export interface LedgerDay {
  date: IsoDate;
  /** Opening balance scheduled for this date before the hypothetical purchase. */
  base: number;
  /** After the purchase (or its instalment). */
  plan: number;
  /** Projected balance exactly as the shared forecast has it (no planner change). */
  check: number;
}

export interface Ledger {
  days: LedgerDay[];
  start: IsoDate;
  end: IsoDate;
}

export interface MovedReceipt {
  event: PlannerEvent;
  originalDate: IsoDate;
  revisedDate: IsoDate;
  delayDays: number;
  /** True when the revised date is outside the visible period. */
  outOfWindow: boolean;
}

export type TriggerKind = "purchase" | "bill" | "everyday" | "receipt" | "baseline";

export interface Explanation {
  outcome: DateVerdict;
  passes: number;
  tested: number;
  testedDelays: number[];
  lowestBalance: number;
  lowestDate: IsoDate;
  firstBreach: { date: IsoDate; balance: number; shortfall: number } | null;
  firstNegative: { date: IsoDate; balance: number } | null;
  trigger: {
    kind: TriggerKind;
    label: string;
    date: IsoDate | null;
    /** Figures that support the label. */
    evidence: string;
  };
  movements: {
    date: IsoDate;
    label: string;
    amount: number;
    direction: "income" | "expense";
    note: string;
  }[];
  /** Human sentences in plain language. */
  sentences: string[];
  insufficientWindow: boolean;
}

export interface FixOption {
  kind: "reduce-price" | "later-date" | "move-expense";
  label: string;
  detail: string;
  /** Purchase price for this fix. */
  price: number;
  /** Purchase date for this fix. */
  purchaseDate: IsoDate;
  /** Optional moved expense the fix depends on. */
  movedExpense?: { event: PlannerEvent; from: IsoDate; to: IsoDate; amount: number };
  works: boolean;
  residualShortfall: number | null;
  secondShortage: { date: IsoDate; balance: number } | null;
  outsideTestedWindow: boolean;
}

export interface PurchaseScheduleRow {
  index: number;
  date: IsoDate;
  amount: number;
  label: string;
}

export interface PurchaseSchedule {
  method: PaymentMethod;
  rows: PurchaseScheduleRow[];
  downPayment: number;
  fees: number;
  financed: number;
  totalPaid: number;
  firstDueDate: IsoDate | null;
  instalmentAmount: number;
  instalments: number;
  /** Rows that fall after the last date the planner can see. */
  outsideWindow: number;
  headline: string;
}

export interface BaselineGate {
  breaches: boolean;
  firstBreach: { date: IsoDate; balance: number } | null;
  lowestBalance: number;
  lowestDate: IsoDate;
}
