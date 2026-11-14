/**
 * App services, powered by Person 1's engine.
 *
 * This is the single place the store gets its numbers from. Each function keeps
 * the signature the store already calls, so swapping the implementation never
 * touches the pages. Everything below delegates to `src/domain` (Person 1) via
 * `bridge.ts`; nothing here re-implements forecasting.
 */
import type {
  Anomaly,
  BacktestResult,
  Forecast,
  MonthTotals,
  Recommendation,
  RecurringItem,
  RecurringStatus,
  Scenario,
  Settings,
  Transaction,
} from "../types";
import {
  buildForecast,
  detectRecurringSuggestions,
  detectUnusualChanges,
  evaluateForecastQuality,
  extraRoomFromProjection,
  forecastAsOf,
  periodSummary,
  reconcile,
  suggestCategoryFor,
} from "../domain";
import type { CashMovement, FinancialSnapshot } from "../domain";
import {
  commitmentsFromExpected,
  forecastToView,
  invoicesFromExpected,
  movementsFromTransactions,
  movementsFromTransfers,
  daysBetweenISO,
  profileFrom,
  qualityNumbers,
  seriesFromRecurring,
} from "./bridge";
import type { LedgerInput } from "./bridge";
import type {
  DecisionReplay,
  Reliability,
  RecurrencePreferences,
  ReconciliationMatch,
  RecurringWithPrefs,
  Suggestion,
  WorkspaceLedger,
} from "./types";

/** Which engine implementation produced a number. Shown in Settings. */

export const ENGINE = {
  domain: "Person 1 engine (src/domain)",
  planner: "Person 2 planner (src/features/planner)",
  fixture: false,
} as const;

export function settingsFor(ledger: WorkspaceLedger): Settings {
  return {
    safetyThreshold: ledger.reserve,
    openingBalance: ledger.openingBalance,
    horizon: ledger.horizon,
    currency: "INR",
  };
}

/**
 * The store's ledger view and the bridge's working shape differ only in the
 * optional extras (assets, overrides, merchant memory), which the forecast path
 * does not need. Defaulting them here keeps the forecast call sites unchanged.
 */
function toLedgerInput(ledger: WorkspaceLedger): LedgerInput {
  return {
    ...ledger,
    assets: [],
    overrides: {},
    recurrencePrefs: {},
    merchantMemory: {},
  };
}

/** Build the engine input for one workspace. */
function engineInput(ledger: WorkspaceLedger, today: string, series: ReturnType<typeof seriesFromRecurring>) {
  const profile = profileFrom(toLedgerInput(ledger), today);
  return {
    profile,
    movements: [
      ...movementsFromTransactions(ledger.transactions),
      ...movementsFromTransfers(ledger.transfers),
    ],
    series,
    invoices: invoicesFromExpected(ledger.expected),
    commitments: commitmentsFromExpected(ledger.expected),
    asOf: today,
  };
}

/* -------------------------------------------------------------------------- */
/* Cash on hand                                                                */
/* -------------------------------------------------------------------------- */

/** Spendable cash today: recorded movements only, expected items excluded. */
export function cashToday(ledger: WorkspaceLedger, today = new Date().toISOString().slice(0, 10)): number {
  const movements = [
    ...movementsFromTransactions(ledger.transactions),
    ...movementsFromTransfers(ledger.transfers),
  ];
  let total = ledger.openingBalance;
  for (const movement of movements) {
    // Internal transfers have signedAmount 0 and leave the pool unchanged.
    total += movement.signedAmount;
  }
  void today;
  return Math.round(total);
}

/** Cash that has been moved into the savings pot and is not spendable. */
export function savingsToday(ledger: WorkspaceLedger): number {
  return ledger.transfers
    .filter((transfer) => transfer.status === "recorded" && transfer.to === "savings")
    .reduce((total, transfer) => total + transfer.amount, 0);
}

/* -------------------------------------------------------------------------- */
/* Recurring                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Person 1 detects series and proposals; the app stores a status map. The
 * engine's detection is authoritative, and the user's status is layered on top.
 */
export function recognizeRecurring(
  transactions: Transaction[],
  overrides: Record<string, RecurringStatus> = {},
  prefs: Record<string, RecurrencePreferences> = {},
  today: string = new Date().toISOString().slice(0, 10),
): RecurringWithPrefs[] {
  const movements = movementsFromTransactions(transactions);
  const result = detectRecurringSuggestions(movements, {
    asOf: today,
    // The app stores overrides as `direction:merchant`; the engine keys its
    // series by the bare merchant key, so strip the prefix when handing them over.
    overrides: Object.entries(overrides).map(([key, status]) => ({
      key: key.includes(":") ? key.slice(key.indexOf(":") + 1) : key,
      status: status === "dismissed" ? ("dismissed" as const) : ("confirmed" as const),
    })),
  });

  return result.proposals.map((proposal) => {
    const evidence = proposal.evidence;
    // Overrides are stored as `direction:merchant`, so try the bare key first and
    // then the direction-prefixed form. Without this a dismissed pattern came
    // back as "review" and could never be restored.
    const prefixed = `${proposal.direction}:${proposal.key}`;
    const status: RecurringStatus =
      overrides[proposal.key] ??
      overrides[prefixed] ??
      (proposal.status === "dismissed"
        ? "dismissed"
        : proposal.status === "confirmed" || evidence.confidence >= 0.75
          ? "confirmed"
          : "review");
    const dates = evidence.observedDates;

    return {
      key: proposal.key,
      label: proposal.label,
      direction: proposal.direction,
      category: proposal.category,
      frequency: evidence.frequency,
      intervalDays: evidence.intervalDays,
      typicalAmount: evidence.typicalAmount,
      firstDate: dates[0] ?? today,
      lastDate: dates[dates.length - 1] ?? today,
      nextDate: evidence.nextExpectedDate,
      occurrences: evidence.occurrences,
      confidence: evidence.confidence,
      amountStability: 1,
      status,
      dates: dates.slice(-6),
      amounts: evidence.observedAmounts.slice(-6),
      detectionNote: evidence.reason,
      priority: prefs[proposal.key]?.priority ?? "flexible",
      latestDate: prefs[proposal.key]?.latestDate,
    } satisfies RecurringWithPrefs;
  });
}

/* -------------------------------------------------------------------------- */
/* Forecast                                                                    */
/* -------------------------------------------------------------------------- */

export interface ForecastBuildInput {
  ledger: WorkspaceLedger;
  recurring: RecurringItem[];
  today: string;
  scenarios?: Scenario[];
}

/**
 * The projected path. Scenarios are applied as typed movements so a planned
 * purchase shows up in the path instead of being bolted on afterwards.
 */
export function buildWorkspaceForecast({
  ledger,
  recurring,
  today,
  scenarios = [],
}: ForecastBuildInput): Forecast {
  const series = seriesFromRecurring(recurring);
  const input = engineInput(ledger, today, series);

  const active = scenarios.filter((scenario) => scenario.active);
  const scenarioMovements: CashMovement[] = active.map((scenario) => ({
    id: `scenario-${scenario.id}`,
    date: scenario.date,
    label: scenario.name,
    amount: scenario.amount,
    sign: -1 as const,
    signedAmount: -scenario.amount,
    kind: "expense",
    status: "hypothetical" as const,
    accountId: "acct-cash",
    category: "Planned",
    origin: "manual" as const,
  }));

  const engine = buildForecast({
    ...input,
    movements: [...input.movements, ...scenarioMovements],
    includeHypothetical: true,
  });

  return forecastToView(engine, settingsFor(ledger), today);
}

/** The forecast with no hypothetical overlays: what is actually committed. */
export function buildBaselineForecast({ ledger, recurring, today }: ForecastBuildInput): Forecast {
  const input = engineInput(ledger, today, seriesFromRecurring(recurring));
  const engine = buildForecast(input);
  return forecastToView(engine, settingsFor(ledger), today);
}

/**
 * How much can be spent without crossing the reserve: the projected low point
 * minus the reserve, which is exactly what the engine's room function reduces to.
 */
export function roomForPurchase(forecast: Forecast, settings: Settings): {
  room: number;
  untilDate: string;
  perDay: number;
} {
  const room = extraRoomFromProjection(forecast.minBalance, settings.safetyThreshold);
  const days = Math.max(1, forecast.points.length);
  return {
    room,
    untilDate: forecast.minDate,
    perDay: Math.round(room / days),
  };
}

/* -------------------------------------------------------------------------- */
/* Reliability                                                                 */
/* -------------------------------------------------------------------------- */

export function measureReliability(
  ledger: WorkspaceLedger,
  _backtest: unknown,
  replay: DecisionReplay[],
  today: string,
): Reliability {
  const dated = [...ledger.transactions].sort((a, b) => a.date.localeCompare(b.date));
  const first = dated[0]?.date ?? null;
  const last = dated[dated.length - 1]?.date ?? null;

  const days = (from: string, to: string): number =>
    Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));

  const historyDays = first ? days(first, today) : 0;
  const coverageWindow = 90;
  const windowStart = new Date(Date.parse(today) - (coverageWindow - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  const activeDays = new Set(
    dated.filter((tx) => tx.date >= windowStart && tx.date <= today).map((tx) => tx.date),
  );

  const series = seriesFromRecurring(recognizeRecurring(ledger.transactions, {}, {}, today));
  const input = engineInput(ledger, today, series);

  let quality: unknown = null;
  try {
    quality = evaluateForecastQuality(input);
  } catch {
    quality = null;
  }
  const numbers = qualityNumbers(quality, historyDays);

  const replayMeasured = replay.length > 0;
  const within = replay.filter((entry) => entry.withinBand).length;
  const replayAccuracy = replayMeasured ? within / replay.length : null;

  // Honest threshold: the engine needs real history before it can be graded.
  const measured = numbers.meanDailyError !== null && dated.length >= 15;

  const confidence: Reliability["confidence"] = !measured
    ? "none"
    : ledger.horizon <= 30 && activeDays.size >= 20
      ? "high"
      : ledger.horizon <= 60
        ? "medium"
        : "low";

  return {
    status: measured ? "measured" : "insufficient",
    horizon: ledger.horizon,
    historyDays,
    historyFrom: first,
    historyTo: last,
    transactionCount: ledger.transactions.length,
    coverage: Math.round((activeDays.size / coverageWindow) * 100) / 100,
    coverageDays: activeDays.size,
    coverageWindow,
    meanDailyError: measured ? numbers.meanDailyError : null,
    endErrorPercent: null,
    sampleSize: dated.length,
    replaySampleSize: replay.length,
    replayAccuracy,
    confidence,
    method:
      "Person 1 holdout evaluation: history is split at past cutoffs, re-forecast, and scored against the days that followed.",
  };
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

export function proposeReconciliations(ledger: WorkspaceLedger): ReconciliationMatch[] {
  const claimed = new Set(
    ledger.transactions.map((tx) => tx.expectedId).filter((id): id is string => Boolean(id)),
  );
  const openExpected = ledger.expected.filter((item) => !claimed.has(item.id));

  const expectedMovements: CashMovement[] = [
    ...invoicesFromExpected(openExpected).map((invoice) => ({
      id: invoice.id,
      date: invoice.expectedDate,
      label: invoice.client,
      amount: invoice.expectedAmount,
      sign: 1 as const,
      signedAmount: invoice.expectedAmount,
      kind: "invoice" as const,
      status: "expected" as const,
      accountId: "acct-cash",
      category: invoice.category,
    })),
    ...commitmentsFromExpected(openExpected).map((commitment) => ({
      id: commitment.id,
      date: commitment.date,
      label: commitment.label,
      amount: commitment.amount,
      sign: -1 as const,
      signedAmount: -commitment.amount,
      kind: "expense" as const,
      status: "expected" as const,
      accountId: "acct-cash",
      category: commitment.category,
    })),
  ];

  const result = reconcile({
    expected: expectedMovements,
    actual: movementsFromTransactions(
      ledger.transactions.filter((tx) => !tx.expectedId),
    ),
    asOf: new Date().toISOString().slice(0, 10),
  });

  return [
    ...result.matched.map((match) => ({
      expectedId: match.expectedId,
      transactionId: match.actualId,
      confidence: 1,
      dayGap: 0,
      amountGap: 0,
      reason: match.reason,
    })),
    ...result.uncertain.map((match) => ({
      expectedId: match.expectedMovementId,
      transactionId: match.actualMovementId,
      confidence: match.score,
      dayGap: match.dayDelta,
      amountGap: match.amountDelta,
      reason: match.reason,
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* Small passthroughs used by Insights / Overview                              */
/* -------------------------------------------------------------------------- */

export function monthlySeries(
  transactions: Transaction[],
  today: string,
  months: number,
  openingBalance: number,
): MonthTotals[] {
  const anchor = new Date(`${today}T00:00:00`);
  const buckets: MonthTotals[] = [];
  for (let index = months - 1; index >= 0; index--) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
    buckets.push({
      key,
      label: date.toLocaleDateString("en-IN", { month: "short" }),
      income: 0,
      expense: 0,
      net: 0,
      balance: 0,
    });
  }

  const byMonth = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const dated = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  let running = openingBalance;
  for (const tx of dated) {
    const delta = tx.direction === "income" ? tx.amount : -tx.amount;
    running += delta;
    const bucket = byMonth.get(tx.date.slice(0, 7));
    if (!bucket) continue;
    if (tx.direction === "income") bucket.income += tx.amount;
    else bucket.expense += tx.amount;
    bucket.net = bucket.income - bucket.expense;
    bucket.balance = running;
  }

  // Carry the running balance forward so the closing column never reads zero.
  for (const bucket of buckets) {
    if (bucket.balance === 0) bucket.balance = running;
  }
  return buckets;
}

export function subscriptionSummary(recurring: RecurringItem[]): {
  count: number;
  monthly: number;
  items: RecurringItem[];
} {
  const items = recurring.filter(
    (item) => item.direction === "expense" && item.status !== "dismissed",
  );
  const multiplier: Record<string, number> = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    "half-yearly": 1 / 6,
    yearly: 1 / 12,
  };
  const monthly = items.reduce(
    (total, item) => total + item.typicalAmount * (multiplier[item.frequency] ?? 1),
    0,
  );
  return { count: items.length, monthly: Math.round(monthly), items };
}

/* -------------------------------------------------------------------------- */
/* Needs review                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The review queue, built from the engine's own proposals and its missing-payment
 * queue. Every card answers three questions in order: what was observed, why it
 * matters, and what to do next. Nothing here executes a payment.
 */
export function buildSuggestions({
  ledger,
  recurring,
  forecast,
  today,
  dismissed,
}: {
  ledger: WorkspaceLedger;
  recurring: RecurringItem[];
  forecast: Forecast;
  today: string;
  dismissed: Record<string, boolean>;
}): Suggestion[] {
  const items: Suggestion[] = [];
  const claimed = new Set(
    ledger.transactions.map((tx) => tx.expectedId).filter((id): id is string => Boolean(id)),
  );

  // 1. Detected patterns the user has not confirmed yet.
  for (const item of recurring) {
    if (item.status !== "review") continue;
    const id = `confirm-${item.key}`;
    if (dismissed[id] || dismissed[item.key]) continue;
    items.push({
      id,
      kind: item.direction === "expense" ? "missed-subscription" : "likely-receipt",
      tone: "info",
      title: `${item.label} looks ${item.frequency}`,
      observed: item.detectionNote,
      why:
        item.direction === "expense"
          ? "Unconfirmed patterns are left out of the forecast, so the projection is missing this bill."
          : "Unconfirmed receipts are left out of the projection, so the low point shown is more cautious than it needs to be.",
      next: "Confirm the schedule if this repeats, or dismiss it if it does not.",
      amount: item.typicalAmount,
      date: item.nextDate,
      facts: [
        `${item.occurrences} payments seen`,
        `${Math.round(item.confidence * 100)}% pattern match`,
        `Next expected ${item.nextDate}`,
      ],
      transactions: ledger.transactions
        .filter((tx) => tx.description.toLowerCase() === item.label.toLowerCase())
        .slice(-4),
      actions: ["confirm-schedule", "edit-date", "dismiss"],
      priority: 40,
      recurringKey: item.key,
    });
  }

  // 2. Expected money that has not arrived.
  for (const match of proposeReconciliations(ledger)) {
    const expected = ledger.expected.find((item) => item.id === match.expectedId);
    if (!expected || claimed.has(expected.id)) continue;
    const id = `match-${match.expectedId}`;
    if (dismissed[id]) continue;
    items.push({
      id,
      kind: "unmatched-receipt",
      tone: "warn",
      title: `${expected.label} matches a recorded row`,
      observed: match.reason,
      why: "Linking them stops the same money being counted twice — once as expected, once as recorded.",
      next: "Match the payment to close the loop.",
      amount: expected.amount,
      date: expected.date,
      facts: [`Expected ${expected.date}`, `${match.dayGap} day gap`, `Confidence ${Math.round(match.confidence * 100)}%`],
      transactions: ledger.transactions.filter((tx) => tx.id === match.transactionId),
      actions: ["match-payment", "dismiss"],
      priority: 55,
      expectedId: expected.id,
    });
  }

  // 3. Expected money that is already past its date.
  for (const expected of ledger.expected) {
    if (claimed.has(expected.id)) continue;
    if (expected.date >= today) continue;
    const id = `late-${expected.id}`;
    if (dismissed[id]) continue;
    const daysLate = daysBetweenISO(expected.date, today);
    items.push({
      id,
      kind: expected.direction === "income" ? "unmatched-receipt" : "confirm-emi",
      tone: daysLate > 7 ? "urgent" : "warn",
      title: `${expected.label} is ${daysLate} day${daysLate === 1 ? "" : "s"} late`,
      observed: `Expected on ${expected.date} and not yet matched to a recorded row.`,
      why:
        expected.direction === "income"
          ? "Until it arrives, the projection is relying on money that has not landed."
          : "An unpaid bill still has to be paid, so the forecast may be too optimistic.",
      next:
        expected.direction === "income"
          ? "Mark it received when the money lands, or move the date if the client has slipped."
          : "Confirm the schedule so the payment stays in the projection.",
      amount: expected.amount,
      date: expected.date,
      facts: [`${daysLate} days late`, `${expected.certainty} expectation`],
      transactions: [],
      actions: expected.direction === "income" ? ["mark-received", "edit-date", "dismiss"] : ["confirm-schedule", "edit-date", "dismiss"],
      priority: 90 - daysLate,
      expectedId: expected.id,
    });
  }

  // 4. Reserve pressure: the most time-sensitive fact of all.
  if (forecast.minBalance < 0) {
    const id = "reserve-shortfall";
    if (!dismissed[id]) {
      items.push({
        id,
        kind: "category-spike",
        tone: "urgent",
        title: "Cash is projected to go negative",
        observed: `The lowest projected balance is ${Math.round(forecast.minBalance).toLocaleString("en-IN")} on ${forecast.minDate}.`,
        why: "A negative balance means a bill cannot be paid on time from what you currently hold.",
        next: "Move a receipt earlier, push a flexible bill, or check a purchase date before committing.",
        amount: Math.abs(forecast.minBalance),
        date: forecast.minDate,
        facts: [`Low point ${forecast.minDate}`, `${forecast.points.length} days projected`],
        transactions: [],
        actions: ["try-different-date", "compare-dates"],
        priority: 100,
      });
    }
  }

  return items.sort((a, b) => b.priority - a.priority);
}

/* -------------------------------------------------------------------------- */
/* Anomalies, recommendations, replay                                          */
/* -------------------------------------------------------------------------- */

/** Unusual changes in either direction, mapped onto the app's anomaly view. */
export function detectAnomalies(
  transactions: Transaction[],
  today: string,
  options: { excludeRecurringKeys?: Set<string> } = {},
): Anomaly[] {
  void options;
  const changes = detectUnusualChanges(movementsFromTransactions(transactions), {
    asOf: today,
    periodDays: 30,
    minSamples: 2,
    minChange: 300,
  });

  return changes.map((change) => {
    const matching = [...transactions]
      .filter(
        (tx) =>
          (change.merchantKey && tx.id && true) &&
          (change.category ? tx.category === change.category : true) &&
          (change.direction === "income" ? tx.direction === "income" : tx.direction === "expense"),
      )
      .sort((a, b) => b.date.localeCompare(a.date));

    const transaction =
      matching.find((tx) => tx.date >= change.comparison.currentFrom && tx.date <= change.comparison.currentTo) ??
      matching[0] ??
      transactions[0];

    const ratio = change.typicalAmount > 0 ? change.actualAmount / change.typicalAmount : 1;

    return {
      transaction,
      median: Math.round(change.typicalAmount),
      ratio,
      samples: change.sampleSize,
      severity: Math.abs(ratio - 1) >= 0.5 ? "strong" : "notable",
      explanation: change.explanation,
    } satisfies Anomaly;
  });
}

/** Plain-language recommendations derived from the engine's own signals. */
export function buildRecommendations({
  forecast,
  anomalies,
  settings,
}: {
  forecast: Forecast;
  anomalies: Anomaly[];
  settings: Settings;
}): Recommendation[] {
  const items: Recommendation[] = [];

  if (forecast.minBalance < settings.safetyThreshold) {
    items.push({
      id: "reserve-pressure",
      tone: forecast.minBalance < 0 ? "alert" : "warn",
      title: "Your reserve is in the path",
      body: `The lowest projected balance is below your ${settings.safetyThreshold.toLocaleString("en-IN")} reserve. Holding back a little now keeps the buffer intact.`,
      facts: [`Low point ${Math.round(forecast.minBalance).toLocaleString("en-IN")}`, `On ${forecast.minDate}`],
    });
  }

  if (anomalies.length > 0) {
    const biggest = anomalies[0];
    items.push({
      id: "unusual-change",
      tone: "info",
      title: "One category moved unusually",
      body: biggest.explanation,
      facts: [`${biggest.samples} payments compared`, `${biggest.ratio.toFixed(1)}× typical`],
    });
  }

  if (items.length === 0) {
    items.push({
      id: "steady",
      tone: "good",
      title: "Nothing unusual in the numbers",
      body: "Your forecast stays above the reserve and no category moved sharply. Keep recording receipts to make the projection sharper.",
      facts: [`${forecast.points.length} days projected`],
    });
  }

  return items;
}

/**
 * Backtest through the engine's own cut-off forecast (`forecastAsOf`), so the
 * error is measured on a real re-forecast rather than a straight line.
 */
export function runBacktest(
  transactions: Transaction[],
  settings: Settings,
  today: string,
  horizon = 30,
): BacktestResult | null {
  const dated = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length < 15) return null;

  const anchor = dated[Math.max(0, Math.floor(dated.length * 0.75))].date;
  const cutoff = anchor < today ? anchor : addDaysISOStr(today, -horizon);
  const actual = dated.filter((tx) => tx.date > cutoff);

  const result = forecastAsOf({
    profile: {
      id: "backtest",
      accounts: [
        {
          id: "acct-cash",
          name: "Main account",
          kind: "bank",
          openingBalance: 0,
          openingDate: dated[0].date,
          availableForBills: true,
          includeInSpendable: true,
        },
      ],
      openingBalance: { amount: 0, date: dated[0].date },
      reserveAmount: settings.safetyThreshold,
      reserveDays: 0,
      incomeFloor: 0,
      currency: "INR",
      evaluationEnd: today,
      assets: [],
      loans: [],
    },
    movements: movementsFromTransactions(dated),
    asOf: cutoff,
  } as never) as unknown as { days?: { date: string; balance: number }[]; points?: { date: string; balance: number }[] };

  const predicted = result.days ?? result.points ?? [];
  if (predicted.length === 0) return null;

  const byDate = new Map(predicted.map((point) => [point.date, point.balance]));
  const points: { date: string; predicted: number; actual: number }[] = [];
  let running = 0;
  for (const tx of actual) {
    running += tx.direction === "income" ? tx.amount : -tx.amount;
    const forecastValue = byDate.get(tx.date);
    if (forecastValue !== undefined) {
      points.push({ date: tx.date, predicted: forecastValue, actual: forecastValue - running });
    }
  }
  if (points.length === 0) {
    const last = predicted[predicted.length - 1];
    const net = actual.reduce((total, tx) => total + (tx.direction === "income" ? tx.amount : -tx.amount), 0);
    points.push({ date: last.date, predicted: last.balance, actual: last.balance - net });
  }

  const lastPoint = points[points.length - 1];
  const errorAmount = Math.abs(lastPoint.predicted - lastPoint.actual);
  const dailyErrors = points.map((point) => Math.abs(point.predicted - point.actual));

  return {
    cutoff,
    horizon: points.length,
    predictedEnd: Math.round(lastPoint.predicted),
    actualEnd: Math.round(lastPoint.actual),
    errorAmount: Math.round(errorAmount),
    errorPercent: lastPoint.actual !== 0 ? (errorAmount / Math.abs(lastPoint.actual)) * 100 : 0,
    points,
    meanAbsDailyError: Math.round(dailyErrors.reduce((a, b) => a + b, 0) / Math.max(1, dailyErrors.length)),
  } as BacktestResult;
}

function addDaysISOStr(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

export function suggestCategory(description: string): string | null {
  const suggestion = suggestCategoryFor(description, { labelByMerchant: {}, categoryByMerchant: {}, corrections: [] } as never);
  return (suggestion as { category?: string } | null)?.category ?? null;
}

export { suggestCategoryFor, periodSummary, buildForecast };
export type { FinancialSnapshot };
