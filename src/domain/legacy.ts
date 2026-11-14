/**
 * Legacy bridge.
 *
 * The uploaded app (Person 3's store + screens) still uses the older
 * `src/types.ts` shapes (`Transaction`, `RecurringItem`, `Forecast`). These
 * adapters let both models coexist during the merge:
 *
 * - `fromLegacyTransactions` maps `Transaction[]` into dated `CashMovement`s
 *   (direction carried by the sign exactly once).
 * - `buildLegacyForecast` runs the new forecast engine and projects it back
 *   into the legacy `Forecast` shape the dashboard/planner already render.
 */
import type {
  Forecast as LegacyForecast,
  RecurringItem,
  RecurringStatus,
  Settings,
  Transaction,
} from "../types";
import type {
  CashMovement,
  Forecast,
  ISODate,
  RecurringOverride,
  UserProfile,
} from "./contracts";
import { addDays, makeMovement, movementView } from "./ledger";
import { buildForecast } from "./forecast";
import { merchantKeyOf, seriesFromOverride } from "./recurring";

/** Map legacy transactions into signed movements on one dated opening account. */
export function fromLegacyTransactions(
  transactions: Transaction[],
  _settings: Settings,
  today: ISODate,
  accountId = "legacy-main",
): CashMovement[] {
  return transactions.map((transaction) =>
    makeMovement({
      id: transaction.id,
      date: transaction.date,
      label: transaction.description,
      amount: transaction.amount,
      kind:
        transaction.direction === "income"
          ? transaction.category === "Refund"
            ? "refund"
            : "income"
          : "expense",
      direction: transaction.direction,
      accountId,
      category: transaction.category,
      status: "actual",
      merchantKey: merchantKeyOf(transaction.description),
      origin: transaction.source === "import" ? "import" : transaction.source === "demo" ? "fixture" : "manual",
    }),
  ).filter((movement) => movement.date <= today);
}

/** Legacy settings -> a profile the new engine understands. */
export function settingsToLegacyProfile(
  settings: Settings,
  today: ISODate,
  evaluationEnd = addDays(today, settings.horizon),
): UserProfile {
  return {
    id: "legacy-profile",
    accounts: [
      {
        id: "legacy-main",
        name: "Main account",
        kind: "bank",
        openingBalance: settings.openingBalance,
        openingDate: "1970-01-01",
        availableForBills: true,
        includeInSpendable: true,
      },
    ],
    openingBalance: { amount: settings.openingBalance, date: "1970-01-01" },
    reserveAmount: settings.safetyThreshold,
    reserveDays: 30,
    incomeFloor: settings.safetyThreshold,
    currency: "INR",
    evaluationEnd,
    assets: [],
    loans: [],
  };
}

/** Existing `RecurringItem`s (already user-reviewed) -> persistable overrides. */
export function contractsToLegacyRecurring(items: RecurringItem[]): RecurringOverride[] {
  const mapStatus = (status: RecurringStatus): RecurringOverride["status"] =>
    status === "confirmed" ? "confirmed" : status === "dismissed" ? "dismissed" : "proposed";
  return items.map((item) => ({
    key: item.key,
    status: mapStatus(item.status),
    frequency: item.frequency,
    amount: item.typicalAmount,
    category: item.category,
    startDate: item.nextDate,
    dayOfMonth: Number(item.nextDate.slice(8, 10)),
  }));
}

export function legacyRecurringStatusToOverride(
  key: string,
  status: RecurringStatus,
  extra: Partial<RecurringOverride> = {},
): RecurringOverride {
  const mapped: RecurringOverride["status"] =
    status === "confirmed" ? "confirmed" : status === "dismissed" ? "dismissed" : "proposed";
  return { key, status: mapped, ...extra };
}

/**
 * Run the new engine and present the result in the legacy `Forecast` shape,
 * so Person 3's screens keep rendering while they migrate.
 */
export function buildLegacyForecast(
  transactions: Transaction[],
  recurring: RecurringItem[],
  settings: Settings,
  today: ISODate,
  horizon = settings.horizon,
): LegacyForecast {
  const movements = fromLegacyTransactions(transactions, settings, today);
  const profile = settingsToLegacyProfile(settings, today, addDays(today, horizon));
  const overrides = contractsToLegacyRecurring(recurring);
  const series = recurring
    .filter((item) => item.status === "confirmed")
    .map((item) => {
      const override = overrides.find((entry) => entry.key === item.key)!;
      return seriesFromOverride(override, {
        id: `sug-${item.key}`,
        merchantKey: item.key,
        label: item.label,
        direction: item.direction,
        kind: item.direction === "income" ? "income" : "expense",
        category: item.category,
        accountId: "legacy-main",
        typicalAmount: item.typicalAmount,
        frequency: item.frequency,
        intervalDays: item.intervalDays,
        nextExpectedDate: item.nextDate,
        observedDates: item.dates,
        observedAmounts: item.amounts,
        occurrences: item.occurrences,
        confidence: item.confidence,
        reason: item.detectionNote,
        action: "confirm",
      }, `series-${item.key}`);
    });

  const forecast = buildForecast({
    profile,
    movements,
    series,
    asOf: today,
    evaluationEnd: profile.evaluationEnd,
    incomeMode: "confirmed_income_only",
  });

  return toLegacyForecast(forecast, transactions, settings);
}

function toLegacyForecast(
  forecast: Forecast,
  transactions: Transaction[],
  settings: Settings,
): LegacyForecast {
  const points = forecast.days.map((day) => ({
    date: day.date,
    balance: day.balance,
    lower: day.lower,
    upper: day.upper,
  }));

  const events = forecast.days
    .flatMap((day) => day.movements)
    .filter((movement) => movement.status === "expected" && !movement.internal)
    .map((movement) => ({
      id: movement.id,
      date: movement.date,
      label: movement.label,
      amount: movement.amount,
      direction: (movement.signedAmount >= 0 ? "income" : "expense") as "income" | "expense",
      category: movement.category,
      kind: "recurring" as const,
      recurringKey: movement.recurring?.seriesId,
      isEstimate: true,
    }));

  const last = forecast.days[forecast.days.length - 1];
  const breachDay = forecast.days.find((day) => day.balance < settings.safetyThreshold);

  const factors = [
    {
      label: "Scheduled bills",
      detail: `${forecast.evidence.expectedMovementCount} scheduled movements in the window.`,
      amount: Math.round(forecast.totals.spending),
      direction: "expense" as const,
    },
    {
      label: "Earned income",
      detail: "Confirmed income only.",
      amount: Math.round(forecast.totals.earnedIncome),
      direction: "income" as const,
    },
    {
      label: "Everyday spending",
      detail: `About ${Math.round(forecast.variableBudget.perDay)} per day from your own history.`,
      amount: Math.round(forecast.variableBudget.perDay * forecast.days.length),
      direction: "expense" as const,
    },
  ];

  return {
    today: forecast.asOf,
    horizon: forecast.days.length - 1,
    startingBalance: forecast.openingBalance,
    points,
    events,
    minBalance: forecast.lowestSpendable.balance,
    minDate: forecast.lowestSpendable.date,
    endBalance: forecast.closingBalance,
    breach: breachDay ? { date: breachDay.date, balance: breachDay.balance } : null,
    bandWidthEnd: last ? last.upper - last.balance : 0,
    confidence: forecast.days.length > 30 ? "high" : "medium",
    historyDays: transactions.length ? Math.max(0, dayspan(transactions, forecast.asOf)) : 0,
    transactionCount: transactions.length,
    variableIncomePerDay: 0,
    variableExpensePerDay: forecast.variableBudget.perDay,
    variableIncomeTotal: 0,
    variableExpenseTotal: forecast.variableBudget.perDay * forecast.days.length,
    committedIncome: Math.round(forecast.totals.earnedIncome),
    committedExpense: Math.round(forecast.totals.spending),
    recurrenceCount: forecast.evidence.seriesUsed.length,
    factors,
    scenarioImpact: null,
  };
}

function dayspan(transactions: Transaction[], today: ISODate): number {
  const earliest = transactions.reduce<string | null>(
    (min, transaction) => (!min || transaction.date < min ? transaction.date : min),
    null,
  );
  if (!earliest) return 0;
  const ms = new Date(today).getTime() - new Date(earliest).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export { movementView };
export type { ForecastMovementView } from "./contracts";
