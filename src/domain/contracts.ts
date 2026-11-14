/**
 * CashFlow Compass — shared financial contracts.
 *
 * OWNER: Person 1 (financial data + calculations).
 * CONSUMERS: Person 2 (`src/features/planner/`), Person 3 (app shell, store, screens).
 *
 * Everything here is plain data + pure functions. No React, no `window`,
 * no `localStorage`, no `Date.now()` — callers pass `asOf` / `today` so a
 * forecast can be replayed as of any past cutoff.
 *
 * Conventions (agreed with the team):
 * - Local calendar dates are `YYYY-MM-DD` strings; never `Date` objects at the boundary.
 * - Currency is INR throughout, stored as a number of rupees (round at the edge, not here).
 * - Signed cash movement appears exactly ONCE. `movement.signedAmount` is the
 *   single source of direction: income > 0, expense < 0, transfers negative on
 *   the source account and positive on the destination account.
 * - The opening balance is dated (`openingBalance { amount, date }`).
 * - `asOf` is the forecast cutoff: every dated movement is either "observed"
 *   (date <= asOf AND status actual) or "future" (date > asOf). Observations
 *   dated after `asOf` are never used to learn patterns (holdout isolation).
 */

export type ISODate = string;

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export type AccountKind = "bank" | "cash" | "wallet" | "credit_card" | "savings_pot" | "loan";

/** Liquid accounts hold *spendable cash*. Credit cards are liabilities: spending on
 *  them does not reduce cash, repaying them does. Savings pots are cash but are
 *  excluded from "spendable" by default (`includeInSpendable: false`). */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Balance at `openingDate`, signed (a credit-card balance is a liability, so negative). */
  openingBalance: number;
  openingDate: ISODate;
  /** Can bills be paid from this account? Person 3 owns the toggle UI. */
  availableForBills: boolean;
  /** Counts toward the projected "spendable" balance used for the reserve floor. */
  includeInSpendable: boolean;
  closed?: boolean;
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* Cash movements — one sign, many kinds of event                              */
/* -------------------------------------------------------------------------- */

export type Direction = "income" | "expense";

/**
 * What the movement actually is. This is deliberately wider than
 * `Direction`, because "money left the account" is not the same question as
 * "money was earned or spent":
 * - `transfer`      internal move between two of the user's accounts; never
 *                   earned income and never an expense. Total cash unchanged.
 * - `savings_pot`   money moved into/out of a savings pot (a transfer in cash
 *                   terms, but reported separately for the "pay yourself" view).
 * - `loan_proceeds` cash in from borrowing: increases cash AND liability. NOT income.
 * - `loan_repayment` principal repaid: decreases cash AND liability. NOT an expense.
 * - `emi`           interest + principal instalment (an expense), optionally
 *                   paired with a repayment component.
 * - `refund`        money back for a past expense (positive cash, negative spending).
 * - `invoice`       client/business income.
 */
export type MovementKind =
  | "income"
  | "expense"
  | "refund"
  | "transfer"
  | "savings_pot"
  | "loan_proceeds"
  | "loan_repayment"
  | "emi"
  | "asset_sale"
  | "invoice";

/** Only `actual` movements are money that really moved. */
export type MovementStatus = "actual" | "expected" | "hypothetical";

/** The movement types the UI groups figures into. */
export type MovementCategoryClass =
  | "earned_income"
  | "spending"
  | "transfer"
  | "borrowing"
  | "debt_service"
  | "refund"
  | "asset_sale";

/** A recurring plan an observation/forecast entry belongs to. */
export interface RecurringSeriesRef {
  seriesId: string;
  occurrenceDate: ISODate;
}

export interface CashMovement {
  /** Stable id. Person 2/3 may render and key on this directly. */
  id: string;
  date: ISODate;
  label: string;
  /** Positive magnitude. The direction lives in `signedAmount`. */
  amount: number;
  /** -1 for cash out, +1 for cash in. Receives +1 / source -1 on transfers. */
  sign: -1 | 1;
  /** `sign * amount`. Use this for every balance computation. */
  signedAmount: number;
  kind: MovementKind;
  status: MovementStatus;
  /** The account the cash lands in / leaves from. For transfers this is the destination. */
  accountId: string;
  /** Set only for internal moves (`transfer`, `savings_pot`). */
  toAccountId?: string;
  category: string;
  /** Normalized merchant/payer key, set by the analysis step. */
  merchantKey?: string;
  /** If this is an actual movement satisfying a scheduled occurrence. */
  recurring?: RecurringSeriesRef;
  /** Present only while `status === "expected"`: the invoice/schedule it came from. */
  source?: ExpectedSourceRef;
  note?: string;
  /** Provenance for the UI: manual entry vs statement import. */
  origin?: "manual" | "import" | "fixture" | "derived";
}

export interface ExpectedSourceRef {
  type: "invoice" | "recurring" | "commitment" | "emi" | "loan" | "asset_sale";
  refId: string;
}

/* -------------------------------------------------------------------------- */
/* Accounts available for bills                                                */
/* -------------------------------------------------------------------------- */

/** Cash a transfer is allowed to draw from, in priority order. */
export interface PayableAccounts {
  accountIds: string[];
  /** The ordered list actually used, already filtered to open payable accounts. */
  activeAccountIds: string[];
  excludedAccountIds: string[];
}

/* -------------------------------------------------------------------------- */
/* Scheduled money — bills, income streams, commitments, loans                 */
/* -------------------------------------------------------------------------- */

export type Frequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "half-yearly"
  | "yearly";

/** How sure we are *when* the money lands. Income timing is the uncertain half. */
export type TimingUncertainty = "none" | "low" | "medium" | "high";

/** Priority is about *paying attention*, never about whether a date is fixed. */
export type ExpensePriority = "essential" | "important" | "discretionary";

/**
 * How the date behaves. Kept strictly separate from `priority`:
 * - `fixed`           must be paid on this date
 * - `window`          may be paid anywhere in [windowStart, windowEnd]
 * - `flexible`        can move anywhere inside the forecast window
 * - `income_expected` landing date is an estimate; may be late
 */
export type DateFlexibility = "fixed" | "window" | "flexible" | "income_expected";

/** A dated, repeating obligation or income stream. */
export interface RecurringSeries {
  id: string;
  label: string;
  kind: MovementKind;
  direction: Direction;
  category: string;
  /** Account cash flows through. Transfers use `accountId` (from) + `toAccountId`. */
  accountId: string;
  toAccountId?: string;
  amount: number;
  frequency: Frequency;
  /** Optional override of the auto interval, in days. */
  intervalDays?: number;
  /** First occurrence (anchor); all other occurrences are derived from it. */
  startDate: ISODate;
  /** Inclusive last date an occurrence may fall on. Undefined = open-ended. */
  endDate?: ISODate;
  nextDueDate: ISODate;
  priority?: ExpensePriority;
  dateFlexibility?: DateFlexibility;
  /** Inclusive window in which a `window` bill may be paid. */
  windowStart?: ISODate;
  windowEnd?: ISODate;
  timingUncertainty?: TimingUncertainty;
  /** User pauses the series without deleting it. */
  paused?: boolean;
  /** Evidence that produced this series (dates/amounts observed). */
  evidence?: RecurringEvidence;
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* Proposal / review workflow (confirm · edit · dismiss · pause · end)         */
/* -------------------------------------------------------------------------- */

export type ProposalKind = "expense" | "income" | "invoice" | "emi" | "loan" | "other";
export type ProposalStatus = "proposed" | "confirmed" | "dismissed" | "paused" | "ended";

/** Persistable user decision about a detected series. */
export interface RecurringOverride {
  /** `merchantKey` (detection key) — stable across re-imports. */
  key: string;
  status: ProposalStatus;
  frequency?: Frequency;
  /** Approximate day-of-month the user wants it to land on. */
  dayOfMonth?: number;
  startDate?: ISODate;
  endDate?: ISODate;
  amount?: number;
  category?: string;
  priority?: ExpensePriority;
  dateFlexibility?: DateFlexibility;
  timingUncertainty?: TimingUncertainty;
  windowStart?: ISODate;
  windowEnd?: ISODate;
  /** ISO timestamp of the decision, for auditability. */
  decidedAt?: string;
}

/** Machine-readable evidence behind a proposal. */
export interface RecurringEvidence {
  observedDates: ISODate[];
  observedAmounts: number[];
  typicalAmount: number;
  frequency: Frequency;
  intervalDays: number;
  nextExpectedDate: ISODate;
  occurrences: number;
  /** 0..1 */
  confidence: number;
  /** Plain-language reason the UI can show verbatim. */
  reason: string;
}

/** A "add next month's EMI?" suggestion for the review queue. */
export interface RecurringProposal {
  id: string;
  key: string;
  label: string;
  merchantKey: string;
  kind: ProposalKind;
  direction: Direction;
  category: string;
  accountId: string;
  amount: number;
  frequency: Frequency;
  /** Suggested approximate date: the occurrence after the last observed one. */
  suggestedDate: ISODate;
  /** Full persisted override (status `proposed`), ready to EDIT then CONFIRM. */
  draft: RecurringOverride;
  evidence: RecurringEvidence;
  status: ProposalStatus;
}

/* -------------------------------------------------------------------------- */
/* Expected income (invoices) and one-time commitments                        */
/* -------------------------------------------------------------------------- */

export interface Invoice {
  id: string;
  client: string;
  expectedAmount: number;
  /** Day the client is expected to pay. */
  expectedDate: ISODate;
  /** Day the client said (or the invoice asks) it would be paid. */
  dueDate?: ISODate;
  accountId: string;
  category: string;
  issuedDate?: ISODate;
  status: "open" | "received" | "cancelled";
  /**
   * The user/client has confirmed this income is coming. This is INDEPENDENT of
   * `timingUncertainty`: a confirmed invoice can still land late. Only confirmed
   * income is modelled in `confirmed_income_only` mode.
   */
  confirmed?: boolean;
  /** Links to the actual movement once reconciled. */
  receivedMovementId?: string;
  /** Late receipts are review suggestions, per the brief. */
  timingUncertainty?: TimingUncertainty;
  priority?: ExpensePriority;
  note?: string;
}

export interface OneTimeCommitment {
  id: string;
  label: string;
  amount: number;
  date: ISODate;
  /** Optional end of a window in which it can be paid. */
  windowEnd?: ISODate;
  accountId: string;
  category: string;
  direction: Direction;
  priority?: ExpensePriority;
  dateFlexibility?: DateFlexibility;
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* Loans, EMI schedules, assets                                               */
/* -------------------------------------------------------------------------- */

export interface EmiSchedule {
  id: string;
  /** How many payments are planned in total. */
  totalInstalments: number;
  /** The dates the instalments fall on (generated from the loan's rule). */
  instalmentDates: ISODate[];
  /** Instalment size. */
  amount: number;
  /** Portion that reduces principal (the rest is interest). */
  principalPerInstalment?: number;
}

export interface Loan {
  id: string;
  lender: string;
  accountId: string;
  principal: number;
  /** Outstanding principal at `asOf` (seeded). */
  outstanding: number;
  annualRatePct?: number;
  emiSchedule?: EmiSchedule;
  status: "active" | "closed";
}

export interface LoanTransaction {
  transactionId: string;
  loanId: string;
  date: ISODate;
  proceeds: number; // cash in at disbursement
  principalPaid: number;
  interestPaid: number; // expense, not liability reduction
  emiInstalmentNumber?: number;
}

/** Optional assets for estimated net worth. Not cash. */
export interface Asset {
  id: string;
  name: string;
  kind: "property" | "vehicle" | "gold" | "equity" | "other";
  estimatedValue: number;
  valuedOn: ISODate;
  /** Optional planned sale. Enters the forecast ONLY on `saleOn`. */
  sale?: {
    plannedDate: ISODate;
    expectedProceeds: number;
    accountId: string;
    /** Fraction of proceeds kept aside (0..1) as a savings pot. */
    reserveShare?: number;
  };
}

/* -------------------------------------------------------------------------- */
/* User profile / assumptions                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `confirmed_income_only`: only actual income plus confirmed invoices count.
 * `include_estimated_irregular_income`: also model irregular/estimated income
 * (invoices at medium/high timing uncertainty, fee-floor irregulars).
 */
export type IncomeMode = "confirmed_income_only" | "include_estimated_irregular_income";

export interface UserProfile {
  id: string;
  accounts: Account[];
  openingBalance: { amount: number; date: ISODate };
  /** Reserve the user does not want to spend below. */
  reserveAmount: number;
  /** How many days of everyday spending to keep as a buffer. */
  reserveDays: number;
  /** The monthly income the user wants to protect (for variable-income smoothing). */
  incomeFloor: number;
  currency: "INR";
  /** Last day of the evaluation window (inclusive). */
  evaluationEnd: ISODate;
  /** Optional assets — contribute to net worth only. */
  assets: Asset[];
  loans: Loan[];
}

/** Cached normalizations + corrections. Persistable by Person 3. */
export interface MerchantMemory {
  /** merchantKey -> category, from user corrections. */
  categoryByMerchant: Record<string, string>;
  /** merchantKey -> display label. */
  labelByMerchant: Record<string, string>;
  /** merchantKey -> correction/decision history. */
  corrections: MerchantCorrection[];
}

export interface MerchantCorrection {
  at: string;
  merchantKey: string;
  category?: string;
  label?: string;
  reason?: string;
}

/** Persistable, versioned blob of everything Person 1 reads and Person 3 stores. */
export interface FinancialSnapshot {
  version: 1;
  transactions: CashMovement[];
  series: RecurringSeries[];
  overrides: RecurringOverride[];
  merchantMemory: MerchantMemory;
  invoices: Invoice[];
  commitments: OneTimeCommitment[];
  profile: UserProfile;
}

/* -------------------------------------------------------------------------- */
/* Analysis: normalization, categories, series detection, suggestions          */
/* -------------------------------------------------------------------------- */

export interface NormalizedDescription {
  raw: string;
  /** Lowercase merchant-ish token used for grouping, e.g. "zomato order". */
  merchantKey: string;
  /** Merchant display name, e.g. "Zomato". */
  merchant: string;
  /** Noise tokens removed (upi, pos, ref, digits, ids, reference numbers). */
  removed: string[];
}

export interface CategorySuggestion {
  category: string;
  /** `memory` (user correction) outranks `rule` outranks `default`. */
  source: "memory" | "rule" | "default";
  merchantKey: string;
  confidence: number;
}

export interface ScheduleSuggestion {
  id: string;
  merchantKey: string;
  label: string;
  direction: Direction;
  kind: MovementKind;
  category: string;
  accountId: string;
  typicalAmount: number;
  frequency: Frequency;
  intervalDays: number;
  nextExpectedDate: ISODate;
  observedDates: ISODate[];
  observedAmounts: number[];
  occurrences: number;
  confidence: number;
  /** "You paid ₹3,200 to this lender on the 18th in three consecutive months. Add next month’s EMI?" */
  reason: string;
  /** Replaceable-friendly action hint for the review UI. */
  action: "confirm" | "review";
  /** Pending items (a confirmed occurrence with no matching actual) create this. */
  missingOccurrences?: ISODate[];
}

export interface PaymentSuggestion {
  id: string;
  label: string;
  amount: number;
  date: ISODate;
  kind: MovementKind;
  direction: Direction;
  category: string;
  accountId: string;
  reason: string;
}

export interface RecurringDetectionResult {
  suggestions: ScheduleSuggestion[];
  proposals: RecurringProposal[];
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                             */
/* -------------------------------------------------------------------------- */

export type MatchConfidence = "exact" | "strong" | "uncertain" | "none";

export interface MatchCandidate {
  expectedMovementId: string;
  actualMovementId: string;
  /** Difference in rupees between expected and actual amount. */
  amountDelta: number;
  /** |date delta| in days. */
  dayDelta: number;
  score: number;
  confidence: MatchConfidence;
  /** Human-readable reason, e.g. "One day late, ₹50 less than expected". */
  reason: string;
}

export interface ReconciliationResult {
  /** Confirmed links: expectedOccurrenceId -> actualMovementId. */
  matched: { expectedId: string; actualId: string; reason: string }[];
  /** Same pair, amounts differ within tolerance: ask the user. */
  uncertain: MatchCandidate[];
  /** Confirmed expected occurrences still missing after their date: review queue. */
  missing: {
    expectedId: string;
    label: string;
    direction: Direction;
    amount: number;
    expectedDate: ISODate;
    daysLate: number;
    reason: string;
  }[];
  /** Actual movements that no expectation claimed (surplus cash). */
  unmatchedActualIds: string[];
  /** Net amount that would be double-counted if the caller added both. */
  preventedDoubleCount: number;
}

/* -------------------------------------------------------------------------- */
/* Forecast                                                                   */
/* -------------------------------------------------------------------------- */

export interface ForecastRange {
  start: ISODate;
  /** Inclusive. */
  end: ISODate;
}

export interface ForecastMovementView extends CashMovement {
  /** Report bucket, so the UI never has to reclassify. */
  class: MovementCategoryClass;
  /** True when this is an internal transfer (both legs cancel in totals). */
  internal: boolean;
}

export interface ForecastDay {
  date: ISODate;
  /** Projected total spendable balance at end of day. */
  balance: number;
  /** Reserve floor applied on this day. */
  reserveFloor: number;
  /** `balance - reserveFloor`. Negative or zero = nothing extra can be spent. */
  spendable: number;
  lower: number;
  upper: number;
  /** Net of the variable budget modelled for this day. */
  variableNet: number;
  movements: ForecastMovementView[];
  /** True when the date is <= asOf: numbers are observed, not projected. */
  observed: boolean;
}

export type LimitBasis =
  | "reserve_amount"
  | "reserve_days"
  | "income_floor"
  | "max_of_reserve_and_income_floor";

export interface CashTotals {
  openingBalance: number;
  closingBalance: number;
  cashIn: number;
  cashOut: number;
  /** cashIn - cashOut */
  netCashFlow: number;
  /** Earned income only (excluding refunds, transfers, borrowing, asset sales). */
  earnedIncome: number;
  /** Spending only (excluding transfers, debt principal, savings moves). */
  spending: number;
  /** Net borrowing (proceeds - principal repaid). Negative = paying down debt. */
  netBorrowing: number;
  /** Internal transfers (should net to zero across the total cash view). */
  internalTransfers: number;
  refunds: number;
  debtService: number;
  assetSales: number;
}

export interface ForecastBreakdownItem {
  label: string;
  detail: string;
  amount: number;
  /** Signed for totals. */
  signedAmount: number;
  class: MovementCategoryClass;
  priority?: ExpensePriority;
}

export interface ForecastBreakdown {
  openingBalance: number;
  items: ForecastBreakdownItem[];
  closingBalance: number;
  /** Human-checkable arithmetic line, e.g. "12000 opening + 90000 in - 95000 out = 7000". */
  arithmeticNote: string;
}

export interface Forecast {
  asOf: ISODate;
  range: ForecastRange;
  openingBalance: number;
  closingBalance: number;
  days: ForecastDay[];
  points: ForecastDay[];
  totals: CashTotals;
  /** Lowest spendable balance in range and the day it occurs. */
  lowestSpendable: { date: ISODate; balance: number; spendable: number };
  /** First day the reserve floor is breached (spendable < 0). */
  firstReserveBreach: ISODate | null;
  /** First day total cash goes negative. */
  firstNegativeBalance: ISODate | null;
  /** Confirmed income only vs include estimated irregular income. */
  incomeMode: IncomeMode;
  limitBasis: LimitBasis;
  reserveFloor: { amount: number; basis: LimitBasis; detail: string };
  /** Everyday variable-spending budget, separate from purchase room. */
  variableBudget: { remaining: number; perDay: number; spentToDate: number };
  /** Movements used to build the forecast, actual + expected + hypothetical. */
  movements: ForecastMovementView[];
  breakdown: ForecastBreakdown;
  /** Observed data used, and the boundary between observed and future. */
  observedThrough: ISODate;
  evidence: ForecastEvidence;
  /** Populated when `asOf` is before available history — see quality.ts. */
  warnings: string[];
}

export interface ForecastEvidence {
  observedMovementCount: number;
  expectedMovementCount: number;
  hypotheticalMovementCount: number;
  /** Series used, and which were ignored (outside range / paused / ended). */
  seriesUsed: string[];
  seriesIgnored: string[];
  invoicesIncluded: string[];
  invoicesExcluded: string[];
  /** Where the variable rate came from. */
  variableRateWindow?: { start: ISODate; end: ISODate; days: number; sampleSize: number };
  /** True when the caller passed observations newer than `asOf` and we dropped them. */
  holdoutEnforced: boolean;
}

/* -------------------------------------------------------------------------- */
/* Purchase room (Person 2's calendar consumes this)                          */
/* -------------------------------------------------------------------------- */

export interface PurchaseRoom {
  purchaseDate: ISODate;
  /** The money a purchase may use and still keep the reserve intact. */
  extraRoom: number;
  /** max(0, minimum projected spendable balance from D..evaluationEnd - reserve). */
  minimumSpendableFromDate: number;
  minimumSpendableDate: ISODate;
  reserve: number;
  evaluationEnd: ISODate;
  explanation: string;
  breakdown: ForecastBreakdownItem[];
}

/* -------------------------------------------------------------------------- */
/* Moon-shots: unusual changes in either direction                            */
/* -------------------------------------------------------------------------- */

export type ChangeType =
  | "spending_high"
  | "spending_low"
  | "subscription_changed"
  | "receipt_late"
  | "bill_missing";

export type ChangeAction =
  | "review_once"
  | "change_next_date"
  | "update_future_amounts"
  | "confirm_or_clear";

export interface UnusualChange {
  id: string;
  type: ChangeType;
  direction: Direction;
  category?: string;
  merchantKey?: string;
  /** Periods compared. */
  comparison: { currentFrom: ISODate; currentTo: ISODate; previousFrom: ISODate; previousTo: ISODate };
  typicalAmount: number;
  actualAmount: number;
  sampleSize: number;
  /** Rupee change, signed. */
  changeAmount: number;
  explanation: string;
  /** Actions the UI may offer. Nothing is applied without confirmation. */
  actions: ChangeAction[];
  /** The series this would change, if any. Requires user confirmation. */
  requiresConfirmation: boolean;
  seriesId?: string;
}

/* -------------------------------------------------------------------------- */
/* Forecast quality / backtest                                                */
/* -------------------------------------------------------------------------- */

export interface IntervalCoverage {
  numerator: number;
  denominator: number;
  horizon: number;
  sampleSize: number;
  /** What the interval is designed to cover, e.g. 0.8. Never measured coverage. */
  intendedCoverage: number | null;
  observedCoverage: number | null;
}

export interface BacktestCutoffResult {
  cutoff: ISODate;
  evaluationEnd: ISODate;
  observedThrough: ISODate;
  horizon: number;
  /** Means the pointwise error in rupees against reality. */
  meanAbsoluteDailyError: number;
  meanAbsoluteDailyErrorBaseline: number;
  /** Positive = our forecast beat the naive baseline. */
  improvement: number;
  endBalanceError: number;
  endBalanceErrorBaseline: number;
  sampleSize: number;
  interval: IntervalCoverage;
  /** True when patterns were learned only from records dated <= cutoff. */
  isolated: boolean;
  note: string;
}

export interface ForecastQuality {
  asOf: ISODate;
  cutoffs: BacktestCutoffResult[];
  aggregate: {
    meanAbsoluteDailyError: number | null;
    baselineMeanAbsoluteDailyError: number | null;
    interval: IntervalCoverage | null;
    evaluatedCutoffs: number;
  };
  insufficientHistory: boolean;
  note: string;
}

/* -------------------------------------------------------------------------- */
/* Net worth                                                                  */
/* -------------------------------------------------------------------------- */

export interface NetWorth {
  asOf: ISODate;
  cash: number;
  assets: number;
  liabilities: number;
  netWorth: number;
  breakdown: { label: string; amount: number; kind: "cash" | "asset" | "liability" }[];
}
