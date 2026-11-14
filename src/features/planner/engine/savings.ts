import type { IsoDate, PlannerData } from "./types";
import { addDays, daysBetween } from "./dates";

/**
 * Savings scenario: how much can be set aside while still keeping enough
 * spendable cash for bills?
 *
 * Two pots are compared:
 *  - accessible: withdrawable the same day, so it merely lowers the projected
 *    balance but can be pulled back if a bill lands early
 *  - locked:     unavailable until `releaseDate`, so the whole period must be
 *    covered by the remaining spendable cash (shared transfer/account rule)
 *
 * No positive return is ever assumed. A user-entered return is labelled and is
 * always reported next to the zero-return case.
 */

export interface SavingsScenarioInput {
  data: PlannerData;
  amount: number;
  pot: "accessible" | "locked";
  releaseDate?: IsoDate;
  /** User-entered annual return in percent — labelled, never assumed. */
  assumedReturnPercent?: number;
}

export interface SavingsProjection {
  /** Balance after the transfer, including the pot if it has been released. */
  lowestBalance: number;
  lowestDate: IsoDate;
  /** Spendable balance before the release date (locked pot excluded). */
  lowestSpendable: number;
  lowestSpendableDate: IsoDate;
  firstBreach: { date: IsoDate; balance: number } | null;
  finalBalance: number;
  returnAmount: number;
}

export interface SavingsScenarioResult {
  amount: number;
  pot: "accessible" | "locked";
  releaseDate: IsoDate | null;
  /** Largest amount that can be set aside and still cover every bill while below the reserve never happens. */
  maxSafeAmount: number;
  zeroReturn: SavingsProjection;
  withReturn: SavingsProjection | null;
  breachesReserve: boolean;
  firstBreach: { date: IsoDate; balance: number } | null;
  note: string;
}

function project(
  data: PlannerData,
  amount: number,
  pot: "accessible" | "locked",
  releaseDate: IsoDate | null,
  returnPercent: number,
): SavingsProjection {
  const points = data.baseline.length > 0 ? data.baseline : data.daily;
  const start = data.today;
  const release = pot === "locked" ? (releaseDate ?? addDays(start, 3650)) : start;
  const annualised =
    returnPercent > 0 && pot === "locked"
      ? amount * (returnPercent / 100) * (Math.max(0, daysBetween(start, release)) / 365)
      : 0;
  const potValueAtRelease = amount + annualised;

  let lowestBalance = Number.POSITIVE_INFINITY;
  let lowestDate = start;
  let lowestSpendable = Number.POSITIVE_INFINITY;
  let lowestSpendableDate = start;
  let firstBreach: SavingsProjection["firstBreach"] = null;

  for (const point of points) {
    const released = point.date >= release;
    // Locked money is unavailable until the release date, then returns.
    const available = released ? potValueAtRelease : pot === "accessible" ? amount : 0;
    const total = point.balance - amount + available;
    const spendableNow = released ? point.balance : point.balance - amount;

    if (total < lowestBalance) {
      lowestBalance = total;
      lowestDate = point.date;
    }
    if (spendableNow < lowestSpendable) {
      lowestSpendable = spendableNow;
      lowestSpendableDate = point.date;
    }
    if (!firstBreach && total < data.reserve) firstBreach = { date: point.date, balance: total };
  }

  const finalPoint = points[points.length - 1];
  const finalReleased = finalPoint ? finalPoint.date >= release : true;
  const finalBalance =
    (finalPoint?.balance ?? data.openingBalance) -
    amount +
    (finalReleased ? potValueAtRelease : 0);

  return {
    lowestBalance: Number.isFinite(lowestBalance) ? lowestBalance : data.openingBalance,
    lowestDate,
    lowestSpendable: Number.isFinite(lowestSpendable) ? lowestSpendable : data.openingBalance,
    lowestSpendableDate,
    firstBreach,
    finalBalance,
    returnAmount: annualised,
  };
}

export function runSavingsScenario(input: SavingsScenarioInput): SavingsScenarioResult {
  const { data, amount, pot } = input;
  const releaseDate = pot === "locked" ? (input.releaseDate ?? addDays(data.today, 90)) : null;
  const zero = project(data, amount, pot, releaseDate, 0);
  const withReturn =
    input.assumedReturnPercent && input.assumedReturnPercent > 0
      ? project(data, amount, pot, releaseDate, input.assumedReturnPercent)
      : null;

  // Largest amount that keeps the reserve intact for the whole forecast.
  let low = 0;
  let high = Math.max(0, data.openingBalance);
  for (let i = 0; i < 24 && high - low > 500; i++) {
    const mid = Math.floor((low + high) / 2 / 500) * 500;
    const test = project(data, mid, pot, releaseDate, 0);
    if (test.firstBreach === null) low = mid;
    else high = mid;
  }

  return {
    amount,
    pot,
    releaseDate,
    maxSafeAmount: low,
    zeroReturn: zero,
    withReturn,
    breachesReserve: zero.firstBreach !== null,
    firstBreach: zero.firstBreach,
    note:
      pot === "locked"
        ? `Locked until ${releaseDate}: the money cannot be spent during that period, so bills must be covered by the remaining spendable cash.`
        : "Accessible pot: withdrawable the same day, so it is spendable again if a bill lands early.",
  };
}
