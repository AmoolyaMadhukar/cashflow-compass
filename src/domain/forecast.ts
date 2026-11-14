/**
 * Daily cash-flow forecast.
 *
 * Builds expected occurrences from dated schedules (never from raw history
 * counts), removes scheduled items before estimating variable spending, and
 * returns a daily path with lower/upper estimates, dated movements with stable
 * ids, and the totals a screen can render directly.
 */
import type {
  CashMovement,
  CashTotals,
  Direction,
  ForecastBreakdownItem,
  ForecastDay,
  ForecastEvidence,
  ForecastMovementView,
  ForecastRange,
  IncomeMode,
  ISODate,
  Invoice,
  LimitBasis,
  MovementKind,
  OneTimeCommitment,
  PurchaseRoom,
  RecurringSeries,
  UserProfile,
} from "./contracts";
import {
  Z_80,
  addDays,
  assetSaleMovements,
  betweenDates,
  daysBetween,
  eachDay,
  enforceCutoff,
  isInternalMove,
  makeMovement,
  movementView,
  seriesOccurrences,
  spendableBalance,
  spendableAccountIds,
  summarizeInvoice,
} from "./ledger";

export interface ForecastInput {
  profile: UserProfile;
  movements: CashMovement[];
  series?: RecurringSeries[];
  invoices?: Invoice[];
  commitments?: OneTimeCommitment[];
  /** Forecast cutoff: observations after this date are dropped (holdout isolation). */
  asOf: ISODate;
  /** Inclusive evaluation end. Defaults to profile.evaluationEnd. */
  evaluationEnd?: ISODate;
  incomeMode?: IncomeMode;
  /** Mark unconfirmed scheduled items as expected rather than skipping them. */
  includeExpected?: boolean;
  /** Include hypothetical movements (asset sales) on their chosen date. */
  includeHypothetical?: boolean;
  /** Include variable (everyday) spending estimate. */
  includeVariable?: boolean;
  /** Override the reserve basis. */
  limitBasis?: LimitBasis;
}

interface VariableRate {
  perDay: number;
  dayStd: number;
  window?: { start: ISODate; end: ISODate; days: number; sampleSize: number };
}

/* ------------------------------------------------------------------ setup */

function recurringKeysFor(series: RecurringSeries[]): Set<string> {
  return new Set(series.map((item) => item.id));
}

/** Expected occurrences of confirmed schedules inside [start, end]. */
function expectedSeriesMovements(
  series: RecurringSeries[],
  start: ISODate,
  end: ISODate,
): CashMovement[] {
  const out: CashMovement[] = [];
  for (const item of series) {
    if (item.paused) continue;
    const dates = seriesOccurrences(item, start, end);
    for (const date of dates) {
      const isInternal = item.kind === "transfer" || item.kind === "savings_pot";
      out.push(
        makeMovement({
          id: `exp-${item.id}-${date}`,
          date,
          label: item.label,
          amount: item.amount,
          kind: item.kind,
          direction: item.direction,
          accountId: item.accountId,
          toAccountId: item.toAccountId,
          category: item.category,
          status: "expected",
          source: { type: item.kind === "emi" ? "emi" : "recurring", refId: item.id },
          recurring: { seriesId: item.id, occurrenceDate: date },
          note: isInternal ? "Internal transfer — total cash unchanged" : undefined,
          origin: "derived",
        }),
      );
    }
  }
  return out;
}

function expectedInvoiceMovements(
  invoices: Invoice[],
  start: ISODate,
  end: ISODate,
  incomeMode: IncomeMode,
): { movements: CashMovement[]; included: string[]; excluded: string[] } {
  const movements: CashMovement[] = [];
  const included: string[] = [];
  const excluded: string[] = [];
  for (const invoice of invoices) {
    if (invoice.status !== "open") continue;

    // Confirmation is what decides inclusion in confirmed-only mode. Timing
    // uncertainty only widens the estimate band; it never removes known income.
    if (!invoice.confirmed && incomeMode === "confirmed_income_only") {
      excluded.push(`${invoice.id}: not confirmed yet, confirmed-income-only mode`);
      continue;
    }

    if (!betweenDates(invoice.expectedDate, start, end)) {
      // A past-due unpaid invoice is surfaced, never dropped and never cash.
      if (invoice.expectedDate < start) {
        excluded.push(
          `${invoice.id}: past due since ${invoice.expectedDate} — unpaid, not counted as received cash (review required)`,
        );
        continue;
      }
      // Due exactly ON the cutoff: still emit an expected occurrence so
      // reconciliation can link it (it changes nothing in the daily path).
      if (invoice.expectedDate !== start) {
        excluded.push(`${invoice.id}: expected ${invoice.expectedDate} outside window`);
        continue;
      }
    }

    included.push(invoice.id);
    movements.push(
      makeMovement({
        id: `inv-${invoice.id}-${invoice.expectedDate}`,
        date: invoice.expectedDate,
        label: `${invoice.client} invoice`,
        amount: invoice.expectedAmount,
        kind: "invoice",
        direction: "income",
        accountId: invoice.accountId,
        category: invoice.category || "Freelance",
        status: "expected",
        source: { type: "invoice", refId: invoice.id },
        note: summarizeInvoice(invoice),
        origin: "derived",
      }),
    );
  }
  return { movements, included, excluded };
}

function commitmentMovements(
  commitments: OneTimeCommitment[],
  start: ISODate,
  end: ISODate,
): CashMovement[] {
  return commitments
    .filter((commitment) => betweenDates(commitment.date, start, end))
    .map((commitment) =>
      makeMovement({
        id: `commit-${commitment.id}-${commitment.date}`,
        date: commitment.date,
        label: commitment.label,
        amount: commitment.amount,
        kind: commitment.direction === "income" ? "income" : "expense",
        direction: commitment.direction,
        accountId: commitment.accountId,
        category: commitment.category,
        status: "expected",
        source: { type: "commitment", refId: commitment.id },
        origin: "derived",
      }),
    );
}

/**
 * Variable (everyday) spending rate, learned from non-scheduled history only.
 * Scheduled items are removed first, so a rent payment is not "averaged" into
 * everyday spending.
 */
function variableRate(
  history: CashMovement[],
  scheduledIds: Set<string>,
  asOf: ISODate,
  lookbackDays = 90,
): VariableRate {
  const windowStart = addDays(asOf, -lookbackDays);
  const sample = history.filter(
    (movement) =>
      movement.status === "actual" &&
      movement.date <= asOf &&
      movement.date >= windowStart &&
      movement.kind !== "transfer" &&
      movement.kind !== "savings_pot" &&
      movement.kind !== "loan_proceeds" &&
      movement.kind !== "loan_repayment" &&
      !(movement.recurring && scheduledIds.has(movement.recurring.seriesId)),
  );
  const days = Math.max(1, daysBetween(windowStart, asOf) + 1);
  const expense = sample.filter((movement) => movement.signedAmount < 0).reduce((sum, m) => sum + Math.abs(m.signedAmount), 0);
  const perDay = expense / days;

  const daily = new Map<ISODate, number>();
  for (const movement of sample) {
    if (movement.signedAmount >= 0) continue;
    daily.set(movement.date, (daily.get(movement.date) ?? 0) + Math.abs(movement.signedAmount));
  }
  const values = eachDay(windowStart, asOf).map((date) => daily.get(date) ?? 0);
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const variance = values.length > 1 ? values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  return {
    perDay,
    dayStd: Math.sqrt(variance),
    window: { start: windowStart, end: asOf, days, sampleSize: sample.length },
  };
}

function reserveFloorFor(
  profile: UserProfile,
  variablePerDay: number,
  basis: LimitBasis,
): { amount: number; basis: LimitBasis; detail: string } {
  const reserveDays = Math.max(0, profile.reserveDays) * variablePerDay;
  const floor = Math.max(0, profile.incomeFloor);
  switch (basis) {
    case "reserve_amount":
      return { amount: profile.reserveAmount, basis, detail: `Your stated reserve (${Math.round(profile.reserveAmount)}).` };
    case "reserve_days":
      return {
        amount: reserveDays,
        basis,
        detail: `${profile.reserveDays} days of everyday spending at ${Math.round(variablePerDay)}/day.`,
      };
    case "income_floor":
      return { amount: floor, basis, detail: `Your protected monthly income floor (${Math.round(floor)}).` };
    case "max_of_reserve_and_income_floor":
    default: {
      const amount = Math.max(profile.reserveAmount, floor);
      return {
        amount,
        basis: "max_of_reserve_and_income_floor",
        detail: `The larger of your reserve (${Math.round(profile.reserveAmount)}) and income floor (${Math.round(floor)}).`,
      };
    }
  }
}

/* -------------------------------------------------------------- forecast */

const EMPTY_TOTALS: CashTotals = {
  openingBalance: 0,
  closingBalance: 0,
  cashIn: 0,
  cashOut: 0,
  netCashFlow: 0,
  earnedIncome: 0,
  spending: 0,
  netBorrowing: 0,
  internalTransfers: 0,
  refunds: 0,
  debtService: 0,
  assetSales: 0,
};

export function buildForecast(input: ForecastInput): import("./contracts").Forecast {
  const {
    profile,
    asOf,
    incomeMode = "confirmed_income_only",
    includeExpected = true,
    includeHypothetical = false,
    includeVariable = true,
    limitBasis = "max_of_reserve_and_income_floor",
  } = input;

  const series = input.series ?? [];
  const invoices = input.invoices ?? [];
  const commitments = input.commitments ?? [];
  const warnings: string[] = [];

  // 1. Cutoff: only observations dated <= asOf may inform anything.
  const { usable, dropped } = enforceCutoff(input.movements, asOf);
  const actual = usable.filter((movement) => movement.status === "actual" && movement.signedAmount !== 0 || movement.status === "actual");

  const evaluationEnd = input.evaluationEnd ?? profile.evaluationEnd;
  const rangeStart = asOf;
  const range: ForecastRange = { start: rangeStart, end: evaluationEnd };
  if (evaluationEnd < asOf) warnings.push("Evaluation end is before the forecast cutoff; the range is empty.");

  // 2. Variable spending is learned AFTER removing scheduled items.
  const scheduledIds = recurringKeysFor(series);
  const variable = variableRate(actual, scheduledIds, asOf);
  const variablePerDay = includeVariable ? variable.perDay : 0;

  // 3. Expected schedule. Confirmed occurrences already observed are replaced by
  //    the actual movement that satisfied them — never counted twice.
  const observedKeys = new Set(
    actual
      .filter((movement) => movement.recurring)
      .map((movement) => `${movement.recurring!.seriesId}@${movement.recurring!.occurrenceDate}`),
  );
  const expectedSeries = includeExpected
    ? expectedSeriesMovements(series, rangeStart, evaluationEnd).filter(
        (movement) =>
          !(movement.recurring && observedKeys.has(`${movement.recurring.seriesId}@${movement.recurring.occurrenceDate}`)),
      )
    : [];
  for (const movement of expectedSeries) {
    const item = series.find((entry) => entry.id === movement.recurring?.seriesId);
    if (item?.timingUncertainty === "high" && incomeMode === "confirmed_income_only" && item.direction === "income") {
      expectedSeries.splice(expectedSeries.indexOf(movement), 1);
    }
  }

  const invoicePlan = expectedInvoiceMovements(invoices, rangeStart, evaluationEnd, incomeMode);
  for (const entry of invoicePlan.excluded) {
    if (entry.includes("past due")) {
      warnings.push(`Unpaid invoice ${entry.split(":")[0]} is past due. It is excluded from projected cash until you confirm or reschedule it.`);
    }
  }
  const expectedCommitments = commitmentMovements(commitments, rangeStart, evaluationEnd);
  const hypothetical = includeHypothetical ? assetSaleMovements(profile.assets) : [];

  // 4. Opening balance = dated opening + observed movements + today's transfers.
  const openingCash = computeOpeningCash(profile, actual, asOf, rangeStart);

  // 5. Daily path.
  const futureMovements: ForecastMovementView[] = [
    ...expectedSeries,
    ...invoicePlan.movements,
    ...expectedCommitments,
    ...hypothetical,
  ].map(movementView);

  const byDate = new Map<ISODate, ForecastMovementView[]>();
  for (const movement of futureMovements) {
    const list = byDate.get(movement.date) ?? [];
    list.push(movement);
    byDate.set(movement.date, list);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const floor = reserveFloorFor(profile, variablePerDay, limitBasis);
  const days: ForecastDay[] = [];
  let balance = openingCash;
  let variance = 0;

  days.push({
    date: rangeStart,
    balance,
    reserveFloor: floor.amount,
    spendable: balance - floor.amount,
    lower: balance,
    upper: balance,
    variableNet: 0,
    // Occurrences dated exactly on the cutoff stay attached to day 0 so the
    // reconciliation queue can see them (they are expected, never observed).
    movements: byDate.get(rangeStart) ?? [],
    observed: true,
  });

  for (const date of eachDay(addDays(rangeStart, 1), evaluationEnd)) {
    const todays = byDate.get(date) ?? [];
    let net = 0;
    for (const movement of todays) {
      net += movement.signedAmount;
      if (movement.status === "expected") {
        const uncertainty = movement.class === "earned_income" ? 0.18 : 0.08;
        variance += (movement.amount * uncertainty) ** 2;
      }
    }
    const variableNet = includeVariable ? -variablePerDay : 0;
    variance += variable.dayStd ** 2;
    balance += net + variableNet;
    const band = Z_80 * Math.sqrt(variance);
    days.push({
      date,
      balance,
      reserveFloor: floor.amount,
      spendable: balance - floor.amount,
      lower: balance - band,
      upper: balance + band,
      variableNet,
      movements: todays,
      observed: date <= asOf,
    });
  }

  // 6. Headline figures.
  const closingBalance = days.length ? days[days.length - 1].balance : openingCash;
  const totals = totalsFor(actual, days);
  totals.openingBalance = openingCash;
  totals.closingBalance = closingBalance;

  let lowest = { date: rangeStart, balance, spendable: balance - floor.amount };
  let firstReserveBreach: ISODate | null = null;
  let firstNegativeBalance: ISODate | null = null;
  for (const day of days) {
    if (day.spendable < lowest.spendable) lowest = { date: day.date, balance: day.balance, spendable: day.spendable };
    if (!firstReserveBreach && day.spendable < 0) firstReserveBreach = day.date;
    if (!firstNegativeBalance && day.balance < 0) firstNegativeBalance = day.date;
  }

  const spentToDate = actual
    .filter((movement) => movement.date <= asOf && movement.signedAmount < 0 && !isInternalMove(movement))
    .reduce((sum, movement) => sum + Math.abs(movement.signedAmount), 0);
  const variableBudgetTotal = includeVariable ? variable.perDay * Math.max(0, daysBetween(rangeStart, evaluationEnd) + 1) : 0;

  const evidence: ForecastEvidence = {
    observedMovementCount: actual.length,
    expectedMovementCount: futureMovements.filter((m) => m.status === "expected").length,
    hypotheticalMovementCount: futureMovements.filter((m) => m.status === "hypothetical").length,
    seriesUsed: series.filter((item) => !item.paused).map((item) => item.id),
    seriesIgnored: series.filter((item) => item.paused).map((item) => item.id),
    invoicesIncluded: invoicePlan.included,
    invoicesExcluded: invoicePlan.excluded,
    variableRateWindow: includeVariable ? variable.window : undefined,
    holdoutEnforced: dropped.length > 0,
  };
  if (dropped.length > 0) {
    warnings.push(
      `${dropped.length} movement${dropped.length === 1 ? "" : "s"} dated after ${asOf} were excluded — patterns are learned only from records up to the cutoff.`,
    );
  }
  if (variable.window && variable.window.days < 30) {
    warnings.push(`Only ${variable.window.days} days of history for everyday spending; that rate is a rough estimate.`);
  }

  const forecast: import("./contracts").Forecast = {
    asOf,
    range,
    openingBalance: openingCash,
    closingBalance,
    days,
    points: days,
    totals,
    lowestSpendable: lowest,
    firstReserveBreach,
    firstNegativeBalance,
    incomeMode,
    limitBasis: floor.basis,
    reserveFloor: floor,
    variableBudget: {
      remaining: includeVariable ? Math.max(0, variableBudgetTotal - spentToDate) : 0,
      perDay: variablePerDay,
      spentToDate,
    },
    movements: [...actual.filter((m) => m.date <= asOf).map(movementView), ...futureMovements],
    breakdown: buildBreakdown(openingCash, days, totals),
    observedThrough: asOf,
    evidence,
    warnings,
  };
  return forecast;
}

function computeOpeningCash(
  profile: UserProfile,
  actual: CashMovement[],
  asOf: ISODate,
  start: ISODate,
): number {
  // Cash the profile is responsible for: its own accounts if any, otherwise the
  // dated opening balance alone.
  if (profile.accounts.length === 0) {
    return (
      profile.openingBalance.amount +
      actual
        .filter((movement) => movement.date <= asOf && movement.date >= profile.openingBalance.date)
        .reduce((sum, movement) => sum + movement.signedAmount, 0)
    );
  }
  const base = spendableBalance(profile.accounts, actual, addDays(start, -1));
  const todayTransfers = actual
    .filter((movement) => movement.date === start && isInternalMove(movement))
    .reduce((sum, movement) => sum + movement.signedAmount, 0);
  // Spendable ignores savings pots; include cash arriving from a pot today.
  return base + todayTransfers + cashIntoSpendableToday(profile, actual, start);
}

function cashIntoSpendableToday(profile: UserProfile, actual: CashMovement[], date: ISODate): number {
  const ids = new Set(spendableAccountIds(profile.accounts));
  let sum = 0;
  for (const movement of actual) {
    if (movement.date !== date || !isInternalMove(movement)) continue;
    const to = movement.toAccountId;
    if (to && ids.has(to)) sum += movement.amount;
    if (ids.has(movement.accountId) && !to) sum -= movement.amount;
  }
  return sum;
}

/* ----------------------------------------------------------------- totals */

function totalsFor(actual: CashMovement[], days: ForecastDay[]): CashTotals {
  const totals: CashTotals = { ...EMPTY_TOTALS };
  const future = days.flatMap((day) => day.movements);
  for (const movement of future) {
    if (movement.class === "transfer") {
      totals.internalTransfers += 0;
      continue;
    }
    if (movement.signedAmount > 0) totals.cashIn += movement.amount;
    else if (movement.signedAmount < 0) totals.cashOut += movement.amount;
    switch (movement.class) {
      case "earned_income":
        totals.earnedIncome += movement.amount;
        break;
      case "spending":
        totals.spending += movement.amount;
        break;
      case "borrowing":
        totals.netBorrowing += movement.amount;
        break;
      case "debt_service":
        totals.debtService += movement.amount;
        totals.netBorrowing -= movement.amount;
        break;
      case "refund":
        totals.refunds += movement.amount;
        break;
      case "asset_sale":
        totals.assetSales += movement.amount;
        break;
      default:
        break;
    }
  }
  void actual;
  totals.netCashFlow = totals.cashIn - totals.cashOut;
  return totals;
}

function buildBreakdown(
  openingBalance: number,
  days: ForecastDay[],
  totals: CashTotals,
): import("./contracts").ForecastBreakdown {
  const items: ForecastBreakdownItem[] = [];
  const push = (label: string, detail: string, amount: number, signedAmount: number, cls: ForecastBreakdownItem["class"]) => {
    if (Math.round(Math.abs(amount)) === 0) return;
    items.push({ label, detail, amount: Math.round(Math.abs(amount)), signedAmount: Math.round(signedAmount), class: cls });
  };

  const scheduledOut = days
    .flatMap((day) => day.movements)
    .filter((movement) => movement.status === "expected" && movement.class === "spending")
    .reduce((sum, movement) => sum + movement.amount, 0);
  const scheduledIn = days
    .flatMap((day) => day.movements)
    .filter((movement) => movement.status === "expected" && movement.class === "earned_income")
    .reduce((sum, movement) => sum + movement.amount, 0);
  const variableTotal = days.reduce((sum, day) => sum + Math.abs(day.variableNet), 0);

  push("Expected bills", "Scheduled and confirmed payments in the window.", scheduledOut, -scheduledOut, "spending");
  push("Expected income", "Confirmed salary/invoices and confirmed recurring income.", scheduledIn, scheduledIn, "earned_income");
  push("Everyday spending", "Variable spending carried forward from your own history.", variableTotal, -variableTotal, "spending");
  push("Borrowing", "Loan proceeds and repayments.", Math.abs(totals.netBorrowing), totals.netBorrowing, "borrowing");
  push("Other cash in", "Refunds and asset sales.", totals.refunds + totals.assetSales, totals.refunds + totals.assetSales, "refund");

  const closing = days.length ? days[days.length - 1].balance : openingBalance;
  const arithmeticNote = `${Math.round(openingBalance)} opening + ${Math.round(totals.cashIn)} in − ${Math.round(
    totals.cashOut,
  )} out = ${Math.round(closing)}`;
  return { openingBalance: Math.round(openingBalance), items, closingBalance: Math.round(closing), arithmeticNote };
}

/* --------------------------------------------------------- purchase room */

/**
 * Extra room for a purchase on date D:
 *   max(0, min(projected spendable balance from D to the evaluation end) − reserve)
 * `reserve` is 0 here because the forecast's spendable figure already subtracts
 * the reserve floor; callers that pass a reserve explicitly get it applied again
 * ONLY when they also pass `spendableIncludesReserve: false`.
 */
export function extraRoomForPurchase(
  forecast: import("./contracts").Forecast,
  purchaseDate: ISODate,
  options: { evaluationEnd?: ISODate; reserve?: number; spendableIncludesReserve?: boolean } = {},
): PurchaseRoom {
  const end = options.evaluationEnd ?? forecast.range.end;
  const includesReserve = options.spendableIncludesReserve ?? true;
  const reserve = includesReserve ? 0 : options.reserve ?? forecast.reserveFloor.amount;
  const from = purchaseDate < forecast.asOf ? forecast.asOf : purchaseDate;
  const slice = forecast.days.filter((day) => day.date >= from && day.date <= end);
  if (slice.length === 0) {
    return {
      purchaseDate,
      extraRoom: 0,
      minimumSpendableFromDate: 0,
      minimumSpendableDate: from,
      reserve: forecast.reserveFloor.amount,
      evaluationEnd: end,
      explanation: "The purchase date is outside the forecast window, so no room can be computed.",
      breakdown: [],
    };
  }
  let min = slice[0];
  for (const day of slice) if (day.spendable < min.spendable) min = day;
  const minimumSpendableFromDate = min.spendable;
  const extraRoom = Math.max(0, minimumSpendableFromDate - reserve);
  const breakdown: ForecastBreakdownItem[] = [
    { label: "Lowest projected spendable balance", detail: `on ${min.date}, from ${from} to ${end}`, amount: Math.round(minimumSpendableFromDate), signedAmount: Math.round(minimumSpendableFromDate), class: "spending" },
    { label: "Reserve kept untouched", detail: forecast.reserveFloor.detail, amount: Math.round(forecast.reserveFloor.amount + reserve), signedAmount: -Math.round(forecast.reserveFloor.amount + reserve), class: "spending" },
  ];
  return {
    purchaseDate,
    extraRoom: Math.round(extraRoom),
    minimumSpendableFromDate: Math.round(minimumSpendableFromDate),
    minimumSpendableDate: min.date,
    reserve: Math.round(forecast.reserveFloor.amount + reserve),
    evaluationEnd: end,
    explanation:
      extraRoom > 0
        ? `Spending ${Math.round(extraRoom)} on ${purchaseDate} keeps your reserve intact — the lowest projected spendable balance after that date is ${Math.round(
            minimumSpendableFromDate,
          )} on ${min.date}, before the reserve of ${Math.round(forecast.reserveFloor.amount + reserve)}.`
        : `There is no room on ${purchaseDate}: the lowest projected spendable balance from that date is ${Math.round(
            minimumSpendableFromDate,
          )}, which your reserve already covers.`,
    breakdown,
  };
}

/**
 * Convenience wrapper used by the acceptance checks and Person 2:
 * room = max(0, projected low − reserve) where the low is already net of bills.
 */
export function extraRoomFromProjection(
  projectedLow: number,
  reserve: number,
  _options: { purchaseDate?: ISODate; evaluationEnd?: ISODate; minimumDate?: ISODate } = {},
): number {
  return Math.round(Math.max(0, projectedLow - reserve));
}

/* ------------------------------------------------------------- re-exported */

export type { ForecastInput as DomainForecastInput, ForecastMovementView, Direction, MovementKind };
