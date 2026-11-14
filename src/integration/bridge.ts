/**
 * Integration bridge: Person 1's engine behind the app's existing view shapes.
 *
 * The screens were built against a small, stable view contract (`Forecast`,
 * `Reliability`, `Suggestion`, ...). Person 1's engine is richer: signed
 * `CashMovement`s, a dated opening balance, accounts, invoices, commitments and
 * `asOf` cutoffs. Rather than rewrite five pages, this module translates:
 *
 *   WorkspaceState (legacy rows) -> FinancialSnapshot (Person 1)
 *                                -> buildForecast / reconcile / quality
 *                                -> the view shapes the pages already render
 *
 * Every figure the UI shows after this file is computed by Person 1's engine.
 */
import type {
  Asset,
  ExpectedItem,
  Forecast,
  ForecastFactor,
  RecurringItem,
  Settings,
  Transaction,
  Transfer,
  UpcomingEvent,
} from "../types";
import type {
  CashMovement,
  FinancialSnapshot,
  Forecast as EngineForecast,
  Invoice,
  MovementKind,
  OneTimeCommitment,
  RecurringOverride,
  RecurringSeries,
  UserProfile,
} from "../domain";

const CASH_ACCOUNT = "acct-cash";
const SAVINGS_ACCOUNT = "acct-savings";

export interface LedgerInput {
  openingBalance: number;
  openingDate: string;
  reserve: number;
  horizon: 30 | 60 | 90;
  transactions: Transaction[];
  expected: ExpectedItem[];
  transfers: Transfer[];
  assets: Asset[];
  overrides: Record<string, string>;
  recurrencePrefs: Record<string, { nextDue?: string }>;
  merchantMemory: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function daysBetweenISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const left = new Date(ay, am - 1, ad).getTime();
  const right = new Date(by, bm - 1, bd).getTime();
  return Math.round((right - left) / 86400000);
}

/* -------------------------------------------------------------------------- */
/* Legacy rows -> engine model                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `kind` decides the totals bucket, so an EMI reports as debt service rather
 * than everyday spending and a refund never inflates earned income.
 */
function movementKind(direction: "income" | "expense", category: string): MovementKind {
  if (direction === "income") {
    if (/refund/i.test(category)) return "refund";
    if (/invoice|freelance|client|retainer/i.test(category)) return "invoice";
    return "income";
  }
  if (/emi/i.test(category)) return "emi";
  if (/loan/i.test(category)) return "loan_repayment";
  return "expense";
}

/** Never hand the engine an undefined or empty label. */
function safeLabel(description: string | undefined, category?: string): string {
  const trimmed = (description ?? "").trim();
  if (trimmed) return trimmed;
  const fallback = (category ?? "").trim();
  return fallback || "Unlabelled movement";
}

export function movementsFromTransactions(transactions: Transaction[]): CashMovement[] {
  return transactions
    .filter((tx) => typeof tx.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(tx.date))
    .map((tx) => {
    const sign: -1 | 1 = tx.direction === "income" ? 1 : -1;
    return {
      id: tx.id,
      date: tx.date,
      // The engine lowercases every label when matching merchants, so a row with
      // no description would crash the whole forecast. Fall back to the category
      // rather than dropping the movement, which would change the balance.
      label: safeLabel(tx.description, tx.category),
      amount: tx.amount,
      sign,
      signedAmount: sign * tx.amount,
      kind: movementKind(tx.direction, tx.category),
      status: "actual" as const,
      accountId: tx.account === "savings" ? SAVINGS_ACCOUNT : CASH_ACCOUNT,
      category: tx.category,
      note: tx.note,
      origin: tx.source === "demo" ? ("fixture" as const) : ("manual" as const),
    };
  });
}
/**
 * A transfer is ONE movement with `signedAmount: 0` (the total pool is
 * unchanged), which is Person 1's documented convention. `accountLegs()` still
 * moves the per-account balances.
 */
export function movementsFromTransfers(transfers: Transfer[]): CashMovement[] {
  return transfers
    .filter((transfer) => transfer.status === "recorded")
    .map((transfer) => ({
      id: transfer.id,
      date: transfer.date,
      label: transfer.note?.trim() || "Move to savings",
      amount: transfer.amount,
      sign: 1 as const,
      signedAmount: 0,
      kind: "transfer" as const,
      status: "actual" as const,
      accountId: transfer.from === "cash" ? CASH_ACCOUNT : SAVINGS_ACCOUNT,
      toAccountId: transfer.to === "cash" ? CASH_ACCOUNT : SAVINGS_ACCOUNT,
      category: "Savings",
      origin: "manual" as const,
    }));
}

export function invoicesFromExpected(expected: ExpectedItem[]): Invoice[] {
  return expected
    .filter((item) => item.direction === "income")
    .map((item) => ({
      id: item.id,
      client: item.label,
      expectedAmount: item.amount,
      expectedDate: item.date,
      dueDate: item.date,
      accountId: CASH_ACCOUNT,
      category: item.category,
      issuedDate: item.date,
      status: "open" as const,
    }));
}

export function commitmentsFromExpected(expected: ExpectedItem[]): OneTimeCommitment[] {
  return expected
    .filter((item) => item.direction === "expense")
    .map((item) => ({
      id: item.id,
      label: item.label,
      amount: item.amount,
      date: item.date,
      accountId: CASH_ACCOUNT,
      category: item.category,
      direction: "expense" as const,
      priority: "important" as const,
      dateFlexibility: "fixed" as const,
    }));
}

function assetsFrom(assets: Asset[], today: string): UserProfile["assets"] {
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.label,
    kind: "other" as const,
    estimatedValue: asset.value,
    valuedOn: today,
  }));
}

export function profileFrom(ledger: LedgerInput, today: string): UserProfile {
  return {
    id: "workspace",
    accounts: [
      {
        id: CASH_ACCOUNT,
        name: "Main account",
        kind: "bank",
        openingBalance: ledger.openingBalance,
        openingDate: ledger.openingDate,
        availableForBills: true,
        includeInSpendable: true,
      },
      {
        id: SAVINGS_ACCOUNT,
        name: "Savings",
        kind: "savings_pot",
        openingBalance: 0,
        openingDate: ledger.openingDate,
        availableForBills: false,
        includeInSpendable: false,
      },
    ],
    // The dated opening balance is preserved: it is what makes history replayable.
    openingBalance: { amount: ledger.openingBalance, date: ledger.openingDate },
    reserveAmount: ledger.reserve,
    reserveDays: 0,
    incomeFloor: 0,
    currency: "INR",
    evaluationEnd: addDaysISO(today, ledger.horizon),
    assets: assetsFrom(ledger.assets, today),
    loans: [],
  };
}

export function overridesFrom(
  ledger: LedgerInput,
  series: RecurringSeries[],
): RecurringOverride[] {
  const byKey = new Map(series.map((item) => [item.id.replace(/^series-/, ''), item]));
  return Object.entries(ledger.overrides).map(([key, status]) => ({
    key,
    status: status === "dismissed" ? ("dismissed" as const) : ("confirmed" as const),
    nextDueDate: ledger.recurrencePrefs[key]?.nextDue ?? byKey.get(key)?.nextDueDate,
  }));
}

export function snapshotFrom(
  ledger: LedgerInput,
  today: string,
  series: RecurringSeries[] = [],
): FinancialSnapshot {
  return {
    version: 1,
    transactions: [
      ...movementsFromTransactions(ledger.transactions),
      ...movementsFromTransfers(ledger.transfers),
    ],
    series,
    overrides: overridesFrom(ledger, series),
    merchantMemory: {
      categoryByMerchant: ledger.merchantMemory ?? {},
      labelByMerchant: {},
      corrections: [],
    },
    invoices: invoicesFromExpected(ledger.expected),
    commitments: commitmentsFromExpected(ledger.expected),
    profile: profileFrom(ledger, today),
  };
}

/**
 * Adapt the app's already-reviewed recurring items into engine series, so the
 * engine reuses the user's own corrections instead of re-detecting.
 */
export function seriesFromRecurring(items: RecurringItem[]): RecurringSeries[] {
  return items
    .filter((item) => item.status !== "dismissed")
    .map((item) => ({
      id: `series-${item.key}`,
      label: item.label,
      kind: item.direction === "income" ? ("income" as const) : ("expense" as const),
      direction: item.direction,
      category: item.category,
      accountId: CASH_ACCOUNT,
      amount: item.typicalAmount,
      frequency: item.frequency,
      startDate: item.firstDate,
      nextDueDate: item.nextDate,
    }));
}

/* -------------------------------------------------------------------------- */
/* Engine forecast -> app view                                                 */
/* -------------------------------------------------------------------------- */

export function forecastToView(
  engine: EngineForecast,
  settings: Settings,
  today: string,
): Forecast {
  const points = engine.days.map((day) => ({
    date: day.date,
    balance: day.balance,
    lower: day.lower,
    upper: day.upper,
  }));

  const events: UpcomingEvent[] = engine.days.flatMap((day) =>
    day.movements
      .filter((movement) => !movement.internal && movement.signedAmount !== 0)
      .map((movement) => ({
        id: `${movement.id}-${day.date}`,
        date: day.date,
        label: movement.label,
        amount: movement.amount,
        direction: (movement.signedAmount >= 0 ? "income" : "expense") as "income" | "expense",
        category: movement.category ?? "Other",
        kind: "recurring" as const,
        isEstimate: movement.status !== "actual",
      })),
  );

  const lowest = points.reduce(
    (best, point) => (point.balance < best.balance ? point : best),
    points[0] ?? { date: today, balance: 0, lower: 0, upper: 0 },
  );
  const last = points[points.length - 1];

  const earned = sumFor(events, "income");
  const spent = sumFor(events, "expense");
  const bandWidthEnd = last ? last.upper - last.lower : 0;

  const factors: ForecastFactor[] = [
    {
      label: "Money in",
      detail: "Receipts the engine expects inside this horizon.",
      amount: earned,
      direction: "income",
    },
    {
      label: "Money out",
      detail: "Bills and everyday spending modelled by the engine.",
      amount: spent,
      direction: "expense",
    },
    {
      label: "Everyday spending",
      detail: "Averaged from your recent history, not a fixed bill.",
      amount: Math.round(engine.variableBudget.perDay * Math.max(1, points.length)),
      direction: "expense",
    },
  ];

  const breachPoint = points.find((point) => point.balance < engine.reserveFloor.amount);

  return {
    today,
    horizon: settings.horizon,
    startingBalance: engine.openingBalance,
    points,
    events,
    minBalance: lowest.balance,
    minDate: lowest.date,
    endBalance: engine.closingBalance,
    breach: breachPoint ? { date: breachPoint.date, balance: breachPoint.balance } : null,
    bandWidthEnd,
    confidence: bandWidthEnd > engine.openingBalance * 0.25 ? "low" : bandWidthEnd > engine.openingBalance * 0.12 ? "medium" : "high",
    historyDays: engine.evidence.observedMovementCount,
    transactionCount: engine.evidence.observedMovementCount,
    variableIncomePerDay: 0,
    variableExpensePerDay: engine.variableBudget.perDay,
    variableIncomeTotal: sumFor(events.filter((event) => event.kind === "variable"), "income"),
    variableExpenseTotal: engine.variableBudget.spentToDate,
    committedIncome: earned,
    committedExpense: spent,
    recurrenceCount: events.filter((event) => event.kind === "recurring").length,
    factors,
    scenarioImpact: null,
  };
}

function sumFor(events: UpcomingEvent[], direction: "income" | "expense"): number {
  return events
    .filter((event) => event.direction === direction)
    .reduce((total, event) => total + event.amount, 0);
}

/* -------------------------------------------------------------------------- */
/* Reliability from the engine's own holdouts                                  */
/* -------------------------------------------------------------------------- */

export interface QualityNumbers {
  meanDailyError: number | null;
  coverage: number | null;
  cutoffs: number;
  sampleDays: number;
}

/** Pull measured numbers out of Person 1's `evaluateForecastQuality`. */
export function qualityNumbers(quality: unknown, sampleDays: number): QualityNumbers {
  const record = (quality ?? {}) as Record<string, unknown>;
  const cutoffs = Array.isArray(record.cutoffs) ? (record.cutoffs as Record<string, unknown>[]) : [];

  const errors: number[] = [];
  for (const cutoff of cutoffs) {
    for (const key of ["meanAbsError", "meanDailyError", "error", "mae"]) {
      const value = cutoff[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        errors.push(value);
        break;
      }
    }
  }

  const raw = record.intervalCoverage;
  let coverage: number | null = null;
  if (typeof raw === "number") coverage = raw;
  else if (raw && typeof raw === "object" && typeof (raw as { ratio?: number }).ratio === "number") {
    coverage = (raw as { ratio: number }).ratio;
  }

  return {
    meanDailyError: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
    coverage,
    cutoffs: cutoffs.length,
    sampleDays,
  };
}
