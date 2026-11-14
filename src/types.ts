export type Direction = "income" | "expense";
export type TxSource = "demo" | "import" | "manual";
export type Page = "overview" | "activity" | "upcoming" | "plan" | "insights";

/**
 * A ledger entry. `lib/*` only reads date/description/amount/direction/category,
 * so the remaining fields are additive integration metadata owned by the shell.
 */
export interface Transaction {
  id: string;
  date: string; // yyyy-mm-dd
  description: string;
  amount: number; // always positive; direction carries the sign
  direction: Direction;
  category: string;
  source: TxSource;
  /** Which internal account this landed in. Defaults to "cash". */
  account?: "cash" | "savings";
  /** Set when the row was created by reconciling an expected item. */
  expectedId?: string;
  priority?: "essential" | "flexible";
  note?: string;
  createdAt?: string;
}

/** Money moved between your own accounts. Never income or spending. */
export interface Transfer {
  id: string;
  date: string;
  amount: number;
  from: "cash" | "savings";
  to: "cash" | "savings";
  note?: string;
  /** recorded = already moved, planned = scheduled for a future date */
  status: "recorded" | "planned";
  source: TxSource;
}

/** Money the user expects but has not received / paid yet. */
export interface ExpectedItem {
  id: string;
  label: string;
  amount: number;
  direction: Direction;
  date: string;
  /** How sure the user is. "confirmed" items are treated as scheduled. */
  certainty: "confirmed" | "likely";
  kind: "invoice" | "recurring" | "emi" | "manual";
  category: string;
  /** recurring detection key this expectation belongs to, when applicable */
  recurringKey?: string;
  note?: string;
  source: TxSource;
}

/** Optional detail the app never requires. */
export interface Asset {
  id: string;
  label: string;
  value: number;
  note?: string;
}

/** Three-way label used everywhere a date or decision is judged. */
export type Coverage = "covered" | "reserve" | "shortfall";


export interface Scenario {
  id: string;
  name: string;
  amount: number;
  date: string;
  kind: "expense" | "repayment";
  active: boolean;
}

export interface Settings {
  safetyThreshold: number;
  openingBalance: number;
  horizon: 30 | 60 | 90;
  currency: "INR";
}

export type Frequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "half-yearly"
  | "yearly";

export type RecurringStatus = "confirmed" | "review" | "dismissed";

export interface RecurringItem {
  key: string;
  label: string;
  direction: Direction;
  category: string;
  frequency: Frequency;
  intervalDays: number;
  typicalAmount: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  confidence: number; // 0..1
  amountStability: number; // 0..1
  status: RecurringStatus;
  dates: string[];
  amounts: number[];
  detectionNote: string;
}

export interface UpcomingEvent {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: Direction;
  category: string;
  kind: "recurring" | "scenario" | "variable";
  recurringKey?: string;
  isEstimate?: boolean;
}

export interface ForecastPoint {
  date: string;
  balance: number;
  lower: number;
  upper: number;
}

export interface Breach {
  date: string;
  balance: number;
}

export interface Forecast {
  today: string;
  horizon: number;
  startingBalance: number;
  points: ForecastPoint[];
  events: UpcomingEvent[];
  minBalance: number;
  minDate: string;
  endBalance: number;
  breach: Breach | null;
  bandWidthEnd: number;
  confidence: "high" | "medium" | "low";
  historyDays: number;
  transactionCount: number;
  variableIncomePerDay: number;
  variableExpensePerDay: number;
  variableIncomeTotal: number;
  variableExpenseTotal: number;
  committedIncome: number;
  committedExpense: number;
  recurrenceCount: number;
  factors: ForecastFactor[];
  scenarioImpact: ScenarioImpact | null;
}

export interface ForecastFactor {
  label: string;
  detail: string;
  amount: number;
  direction: Direction | "neutral";
}

export interface ScenarioImpact {
  scenarioId: string;
  days: ForecastPoint[];
  minBalance: number;
  minDate: string;
  endBalance: number;
  breach: Breach | null;
  endDelta: number;
  minDelta: number;
}

export interface Anomaly {
  transaction: Transaction;
  median: number;
  ratio: number;
  samples: number;
  severity: "notable" | "strong";
  explanation: string;
}

export interface CategoryStat {
  category: string;
  total: number;
  count: number;
  share: number;
}

export interface Recommendation {
  id: string;
  tone: "alert" | "warn" | "info" | "good";
  title: string;
  body: string;
  facts: string[];
}

export interface MonthTotals {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  balance: number;
}

export interface BacktestResult {
  cutoff: string;
  horizon: number;
  predictedEnd: number;
  actualEnd: number;
  errorAmount: number;
  errorPercent: number;
  points: { date: string; predicted: number; actual: number }[];
  meanAbsDailyError: number;
}

export interface CsvParseResult {
  headers: string[];
  rows: ParsedRow[];
  errors: { row: number; message: string }[];
  mapping: Record<string, string | null>;
  positiveMeansExpense: boolean;
  hasTypeColumn: boolean;
  hasExplicitSigns: boolean;
  skipped: number;
}

export interface ParsedRow {
  index: number;
  raw: string[];
  date: string | null;
  description: string;
  amount: number | null;
  direction: Direction;
  category: string | null;
  error: string | null;
  warning: string | null;
  duplicate: boolean;
}
