/**
 * Forecast quality: historical cutoffs at 7, 14 and 30 days.
 *
 * At every cutoff, patterns are learned from records dated <= cutoff only, the
 * forecast runs to the evaluation end, and the daily balance error in rupees is
 * compared with a naive baseline (historical-average daily net flow held flat).
 * Interval coverage is reported as numerator/denominator. No accuracy
 * percentage is ever invented.
 */
import type {
  BacktestCutoffResult,
  CashMovement,
  ForecastQuality,
  IntervalCoverage,
  ISODate,
  Invoice,
  OneTimeCommitment,
  RecurringOverride,
  RecurringSeries,
  UserProfile,
} from "./contracts";
import { addDays, betweenDates, daysBetween, enforceCutoff, spendableBalance } from "./ledger";
import { buildForecast } from "./forecast";
import { detectRecurringSuggestions, seriesFromOverride } from "./recurring";

export interface QualityInput {
  profile: UserProfile;
  movements: CashMovement[];
  series?: RecurringSeries[];
  invoices?: Invoice[];
  commitments?: OneTimeCommitment[];
  overrides?: RecurringOverride[];
  /** The "today" the app is showing. Cutoffs are measured back from here. */
  asOf: ISODate;
  cutoffs?: number[];
  /** Minimum observed history (days) required before a cutoff is evaluated. */
  minHistoryDays?: number;
  /** Intended coverage of the forecast interval (kept distinct from measured). */
  intendedCoverage?: number;
}

const DEFAULT_CUTOFFS = [7, 14, 30];

/**
 * Learn series from history only (records dated <= cutoff), so a holdout run
 * cannot see the future. User-confirmed series are kept when their start date
 * is on/before the cutoff.
 */
function seriesAsOf(
  input: QualityInput,
  cutoff: ISODate,
): RecurringSeries[] {
  const overrides = input.overrides ?? [];
  const engineSeries = (input.series ?? []).filter((item) => item.startDate <= cutoff && !item.paused);
  const { suggestions } = detectRecurringSuggestions(input.movements, { asOf: cutoff, overrides });
  const learned = overrides
    .filter((override) => override.status === "confirmed" || override.status === "paused")
    .filter((override) => (override.startDate ?? cutoff) <= cutoff)
    .map((override) => {
      const suggestion = suggestions.find((entry) => entry.merchantKey === override.key);
      if (!suggestion) return null;
      const series = seriesFromOverride(override, suggestion);
      return series.startDate <= cutoff ? series : null;
    })
    .filter((item): item is RecurringSeries => Boolean(item));
  const ids = new Set([...engineSeries, ...learned].map((item) => item.id));
  return [...engineSeries, ...learned].filter((item, index) => ids.has(item.id) && index === [...engineSeries, ...learned].findIndex((other) => other.id === item.id));
}

/** Actual spendable balance on a date, from real transactions only. */
function actualBalanceOn(
  profile: UserProfile,
  movements: CashMovement[],
  date: ISODate,
): number {
  const actual = movements.filter((movement) => movement.status === "actual" && movement.date <= date);
  if (profile.accounts.length === 0) {
    return (
      profile.openingBalance.amount +
      actual
        .filter((movement) => movement.date >= profile.openingBalance.date)
        .reduce((sum, movement) => sum + movement.signedAmount, 0)
    );
  }
  return spendableBalance(profile.accounts, actual, date);
}

/**
 * Naive baseline: assume every future day nets the same amount as the average
 * daily net flow observed up to the cutoff. This is the "historical-average
 * daily net-flow" comparison the brief asks for.
 */
function baselineDailyNet(movements: CashMovement[], cutoff: ISODate, historyStart: ISODate): number {
  const observed = movements.filter(
    (movement) => movement.status === "actual" && movement.date <= cutoff && movement.date >= historyStart,
  );
  const days = Math.max(1, daysBetween(historyStart, cutoff) + 1);
  return observed.reduce((sum, movement) => sum + movement.signedAmount, 0) / days;
}

export function evaluateForecastQuality(input: QualityInput): ForecastQuality {
  const {
    profile,
    movements,
    asOf,
    cutoffs = DEFAULT_CUTOFFS,
    minHistoryDays = 45,
    intendedCoverage = 0.8,
  } = input;

  const historyStart = movements.length
    ? movements.reduce<ISODate>((earliest, movement) => (movement.date < earliest ? movement.date : earliest), movements[0].date)
    : asOf;
  const totalHistoryDays = Math.max(0, daysBetween(historyStart, asOf));

  if (totalHistoryDays < minHistoryDays) {
    return {
      asOf,
      cutoffs: [],
      aggregate: { meanAbsoluteDailyError: null, baselineMeanAbsoluteDailyError: null, interval: null, evaluatedCutoffs: 0 },
      insufficientHistory: true,
      note: `Insufficient history: ${totalHistoryDays} days available, ${minHistoryDays} needed for a holdout evaluation. Nothing is estimated in its place.`,
    };
  }

  const results: BacktestCutoffResult[] = [];
  for (const horizon of cutoffs) {
    const cutoff = addDays(asOf, -horizon);
    const historyDays = daysBetween(historyStart, cutoff);
    if (historyDays < minHistoryDays) continue;

    const isolated = seriesAsOf(
      { ...input, movements: movements.filter((m) => m.status !== "actual" || m.date <= cutoff) },
      cutoff,
    );
    const forecast = buildForecast({
      profile,
      movements,
      series: isolated,
      invoices: (input.invoices ?? []).filter((invoice) => (invoice.issuedDate ?? invoice.expectedDate) <= cutoff),
      commitments: (input.commitments ?? []).filter((commitment) => commitment.date <= asOf),
      asOf: cutoff,
      evaluationEnd: asOf,
      incomeMode: "confirmed_income_only",
      includeVariable: true,
    });

    const errors: number[] = [];
    const baselineErrors: number[] = [];
    let covered = 0;
    let eligible = 0;
    const startBalance = actualBalanceOn(profile, movements, cutoff);
    const net = baselineDailyNet(movements, cutoff, historyStart);

    for (const day of forecast.days) {
      if (day.date <= cutoff) continue;
      const actual = actualBalanceOn(profile, movements, day.date);
      errors.push(Math.abs(day.balance - actual));
      const baselineBalance = startBalance + net * daysBetween(cutoff, day.date);
      baselineErrors.push(Math.abs(baselineBalance - actual));
      eligible += 1;
      if (actual >= day.lower && actual <= day.upper) covered += 1;
    }
    if (errors.length === 0) continue;

    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const lastDay = forecast.days[forecast.days.length - 1];
    const actualEnd = actualBalanceOn(profile, movements, asOf);
    const interval: IntervalCoverage = {
      numerator: covered,
      denominator: eligible,
      horizon,
      sampleSize: eligible,
      intendedCoverage,
      observedCoverage: eligible > 0 ? covered / eligible : null,
    };

    results.push({
      cutoff,
      evaluationEnd: asOf,
      observedThrough: cutoff,
      horizon,
      meanAbsoluteDailyError: Math.round(mean(errors)),
      meanAbsoluteDailyErrorBaseline: Math.round(mean(baselineErrors)),
      improvement: Math.round(mean(baselineErrors) - mean(errors)),
      endBalanceError: Math.round(lastDay.balance - actualEnd),
      endBalanceErrorBaseline: Math.round(startBalance + net * horizon - actualEnd),
      sampleSize: eligible,
      interval,
      isolated: true,
      note: `Forecast made on ${cutoff} using only records dated on or before that day, evaluated against ${eligible} observed days.`,
    });
  }

  if (results.length === 0) {
    return {
      asOf,
      cutoffs: [],
      aggregate: { meanAbsoluteDailyError: null, baselineMeanAbsoluteDailyError: null, interval: null, evaluatedCutoffs: 0 },
      insufficientHistory: true,
      note: `Insufficient history for the ${cutoffs.join("/")}-day holdouts. Import more history to enable them.`,
    };
  }

  const totalDays = results.reduce((sum, result) => sum + result.sampleSize, 0) || 1;
  const weighted = (pick: (result: BacktestCutoffResult) => number) =>
    Math.round(results.reduce((sum, result) => sum + pick(result) * result.sampleSize, 0) / totalDays);
  const covered = results.reduce((sum, result) => sum + result.interval.numerator, 0);
  const denominator = results.reduce((sum, result) => sum + result.interval.denominator, 0);
  const horizon = Math.max(...results.map((result) => result.horizon));

  return {
    asOf,
    cutoffs: results,
    aggregate: {
      meanAbsoluteDailyError: weighted((result) => result.meanAbsoluteDailyError),
      baselineMeanAbsoluteDailyError: weighted((result) => result.meanAbsoluteDailyErrorBaseline),
      interval: {
        numerator: covered,
        denominator,
        horizon,
        sampleSize: denominator,
        intendedCoverage,
        observedCoverage: denominator > 0 ? covered / denominator : null,
      },
      evaluatedCutoffs: results.length,
    },
    insufficientHistory: false,
    note: `Evaluated ${results.length} historical cutoff${results.length === 1 ? "" : "s"} (${results
      .map((result) => `${result.horizon}d`)
      .join(", ")}). Interval coverage counts days where reality landed inside the forecast band: ${covered} of ${denominator}. Intended coverage is ${Math.round(
      intendedCoverage * 100,
    )}%; measured coverage is reported separately and is not a promise.`,
  };
}

/**
 * Forecast as of a past cutoff — the hook Person 2 needs for decision replay.
 * Records after `cutoff` are dropped before anything is learned.
 */
export function forecastAsOf(
  input: Omit<QualityInput, "asOf" | "cutoffs"> & { cutoff: ISODate; evaluationEnd?: ISODate },
): import("./contracts").Forecast {
  const { cutoff, evaluationEnd, ...rest } = input;
  const history = rest.movements.filter((movement) => movement.status !== "actual" || movement.date <= cutoff);
  const series = seriesAsOf({ ...rest, asOf: cutoff, movements: history } as QualityInput, cutoff);
  return buildForecast({
    profile: rest.profile,
    movements: rest.movements,
    series,
    invoices: (rest.invoices ?? []).filter((invoice) => (invoice.issuedDate ?? invoice.expectedDate) <= cutoff),
    commitments: rest.commitments,
    asOf: cutoff,
    evaluationEnd: evaluationEnd ?? rest.profile.evaluationEnd,
    incomeMode: "confirmed_income_only",
  });
}

/** Places where a holdout is impossible — surfaced verbatim, never faked. */
export function holdoutAvailability(
  movements: CashMovement[],
  asOf: ISODate,
  cutoffs = DEFAULT_CUTOFFS,
): { horizon: number; cutoff: ISODate; available: boolean; historyDays: number; reason: string }[] {
  const actual = movements.filter((movement) => movement.status === "actual");
  const earliest = actual.reduce<ISODate | null>(
    (min, movement) => (!min || movement.date < min ? movement.date : min),
    null,
  );
  return cutoffs.map((horizon) => {
    const cutoff = addDays(asOf, -horizon);
    const historyDays = earliest ? daysBetween(earliest, cutoff) : 0;
    const available = historyDays >= 45;
    return {
      horizon,
      cutoff,
      available,
      historyDays,
      reason: available
        ? `${historyDays} days of history before ${cutoff}.`
        : `Insufficient history: only ${Math.max(0, historyDays)} days before ${cutoff}.`,
    };
  });
}

export { betweenDates as withinRange, enforceCutoff };
