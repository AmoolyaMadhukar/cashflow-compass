/**
 * Period figures and spending limits for week / month / year / custom ranges,
 * built on the daily forecast path.
 */
import type { CashTotals, Forecast, ForecastRange, ISODate, PurchaseRoom } from "./contracts";
import { addDays, daysBetween, movementClass } from "./ledger";
import { extraRoomForPurchase } from "./forecast";

export type RangePreset = "week" | "month" | "year" | "custom";

export interface PeriodSummary {
  range: ForecastRange;
  preset: RangePreset;
  openingBalance: number;
  closingBalance: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  earnedIncome: number;
  spending: number;
  netBorrowing: number;
  internalTransfers: number;
  lowestSpendable: { date: ISODate; balance: number; spendable: number };
  firstReserveBreach: ISODate | null;
  firstNegativeBalance: ISODate | null;
  days: number;
  /** Items already scheduled in the range, before any variable spending. */
  scheduledOut: number;
  scheduledIn: number;
  /** Everyday variable-spending budget for the range. */
  variableBudget: number;
  /** Room for one extra purchase on `purchaseDate` (see extraRoomForPurchase). */
  purchaseRoom: PurchaseRoom | null;
  /** What the numbers are made of, ready to render. */
  breakdown: { label: string; amount: number; signedAmount: number }[];
}

/** Week = the 7 days from `asOf` (not ISO-week aligned) so it always starts "today". */
export function resolveRange(
  preset: RangePreset,
  asOf: ISODate,
  custom?: ForecastRange,
): ForecastRange {
  switch (preset) {
    case "week":
      return { start: asOf, end: addDays(asOf, 6) };
    case "month":
      return { start: asOf, end: addDays(asOf, 29) };
    case "year":
      return { start: asOf, end: addDays(asOf, 364) };
    case "custom":
      return custom ?? { start: asOf, end: addDays(asOf, 29) };
  }
}

function sumMovements(forecast: Forecast, range: ForecastRange): CashTotals {
  const totals: CashTotals = {
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
  const movements = forecast.movements.filter(
    (movement) => movement.date >= range.start && movement.date <= range.end,
  );
  for (const movement of movements) {
    const cls = movementClass(movement);
    if (cls === "transfer") {
      // Internal moves never change total cash; report them so the UI can say so.
      totals.internalTransfers += movement.amount;
      continue;
    }
    if (movement.signedAmount > 0) totals.cashIn += movement.amount;
    else if (movement.signedAmount < 0) totals.cashOut += movement.amount;
    if (cls === "earned_income") totals.earnedIncome += movement.amount;
    if (cls === "spending") totals.spending += movement.amount;
    if (cls === "borrowing") totals.netBorrowing += movement.amount;
    if (cls === "debt_service") {
      totals.debtService += movement.amount;
      totals.netBorrowing -= movement.amount;
    }
    if (cls === "refund") totals.refunds += movement.amount;
    if (cls === "asset_sale") totals.assetSales += movement.amount;
  }
  totals.netCashFlow = totals.cashIn - totals.cashOut;
  return totals;
}

export function periodSummary(
  forecast: Forecast,
  preset: RangePreset,
  custom?: ForecastRange,
  purchaseDate?: ISODate,
): PeriodSummary {
  const range = resolveRange(preset, forecast.asOf, custom);
  const totals = sumMovements(forecast, range);
  const days = forecast.days.filter((day) => day.date >= range.start && day.date <= range.end);
  const opening = days.length ? days[0].balance : forecast.openingBalance;
  const closing = days.length ? days[days.length - 1].balance : forecast.openingBalance;

  let lowest = days.length ? days[0] : forecast.days[0];
  for (const day of days) if (day.spendable < lowest.spendable) lowest = day;

  let firstReserveBreach: ISODate | null = null;
  let firstNegativeBalance: ISODate | null = null;
  for (const day of days) {
    if (!firstReserveBreach && day.spendable < 0) firstReserveBreach = day.date;
    if (!firstNegativeBalance && day.balance < 0) firstNegativeBalance = day.date;
  }

  const scheduledOut = days
    .flatMap((day) => day.movements)
    .filter((movement) => movement.status === "expected" && movement.signedAmount < 0)
    .reduce((sum, movement) => sum + movement.amount, 0);
  const scheduledIn = days
    .flatMap((day) => day.movements)
    .filter((movement) => movement.status === "expected" && movement.signedAmount > 0)
    .reduce((sum, movement) => sum + movement.amount, 0);
  const variableBudget = days.reduce((sum, day) => sum + Math.abs(day.variableNet), 0);

  const room = purchaseDate
    ? extraRoomForPurchase(forecast, purchaseDate, { evaluationEnd: range.end })
    : null;

  return {
    range,
    preset,
    ...totals,
    openingBalance: Math.round(opening),
    closingBalance: Math.round(closing),
    lowestSpendable: { date: lowest.date, balance: Math.round(lowest.balance), spendable: Math.round(lowest.spendable) },
    firstReserveBreach,
    firstNegativeBalance,
    days: days.length,
    scheduledOut: Math.round(scheduledOut),
    scheduledIn: Math.round(scheduledIn),
    variableBudget: Math.round(variableBudget),
    purchaseRoom: room,
    breakdown: [
      { label: "Earned income", amount: Math.round(totals.earnedIncome), signedAmount: Math.round(totals.earnedIncome) },
      { label: "Spending", amount: Math.round(totals.spending), signedAmount: -Math.round(totals.spending) },
      { label: "Net borrowing", amount: Math.round(Math.abs(totals.netBorrowing)), signedAmount: Math.round(totals.netBorrowing) },
      { label: "Refunds", amount: Math.round(totals.refunds), signedAmount: Math.round(totals.refunds) },
      { label: "Asset sales", amount: Math.round(totals.assetSales), signedAmount: Math.round(totals.assetSales) },
      // Informational: internal transfers net to zero and never change total cash.
      { label: "Internal transfers (no cash effect)", amount: Math.round(totals.internalTransfers), signedAmount: 0 },
    ].filter((item) => item.amount !== 0),
  };
}

/**
 * Variable-spending budget kept separate from purchase room:
 * what can be spent on everyday items and still keep the reserve.
 */
export function variableSpendingBudget(forecast: Forecast, untilDate?: ISODate): { total: number; perDay: number; days: number; note: string } {
  const end = untilDate ?? forecast.range.end;
  const days = forecast.days.filter((day) => day.date >= forecast.asOf && day.date <= end);
  if (days.length === 0) return { total: 0, perDay: 0, days: 0, note: "No forecast days in range." };
  // Spendable headroom above the reserve across the range, ignoring the variable
  // estimate itself (it is the thing being budgeted).
  const dailyOps = forecast.variableBudget.perDay;
  let minimum = days[0].balance;
  for (const day of days) minimum = Math.min(minimum, day.balance + dailyOps * forecast.days.indexOf(day));
  const headroom = Math.max(0, minimum - forecast.reserveFloor.amount);
  return {
    total: Math.round(headroom),
    perDay: Math.round(headroom / days.length),
    days: days.length,
    note: `Scheduled bills are accounted for first; ${Math.round(headroom)} is left for everyday spending over ${days.length} days without going under your reserve.`,
  };
}

export function daysInRange(range: ForecastRange): number {
  return daysBetween(range.start, range.end) + 1;
}
