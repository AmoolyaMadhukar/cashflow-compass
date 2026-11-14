import type {
  BaselineGate,
  FixOption,
  IsoDate,
  MovedReceipt,
  PlannerData,
  PlannerEvent,
  PurchaseSchedule,
} from "./types";
import { addDays, daysBetween } from "./dates";
import { buildScenario, evaluatePurchaseDate, moveReceipt } from "./whatif";
import { scheduleForDate } from "./calendar";

/**
 * "Find the smallest workable change."
 *
 * Every fix is tested with the *same* receipt-delay assumption the user is
 * currently looking at, and every fix is re-checked over the whole forecast so a
 * second, later shortage is never hidden by a first-date success.
 */

export interface FixSearchInput {
  data: PlannerData;
  plan: PurchaseSchedule;
  purchaseDate: IsoDate;
  followUpDays: number;
  maxDelayDays: number;
  receiptId: string | null;
  selectedDelayDays: number;
}

export interface FixSearchResult {
  baseline: BaselineGate;
  /** True when the plain baseline forecast (no purchase) already breaks the reserve. */
  baselineBreaches: boolean;
  cheapestWorkingPrice: FixOption | null;
  earliestWorkingDate: FixOption | null;
  movableExpense: FixOption | null;
  /** True when no candidate date in the acceptable range works at all. */
  noDateWorks: boolean;
  secondShortage: { date: IsoDate; balance: number } | null;
  /** Later shortfall that sits past the tested follow-up window. */
  outsideTestedWindow: boolean;
}

export function baselineGate(data: PlannerData): BaselineGate {
  let lowestBalance = Number.POSITIVE_INFINITY;
  let lowestDate = data.today;
  let firstBreach: BaselineGate["firstBreach"] = null;
  for (const point of data.baseline) {
    if (point.balance < lowestBalance) {
      lowestBalance = point.balance;
      lowestDate = point.date;
    }
    if (!firstBreach && point.balance < data.reserve) {
      firstBreach = { date: point.date, balance: point.balance };
    }
  }
  if (!Number.isFinite(lowestBalance)) lowestBalance = data.openingBalance;
  return { breaches: firstBreach !== null, firstBreach, lowestBalance, lowestDate };
}

/** Balance floor of a scenario over the whole forecast, not just the follow-up window. */
function wholeForecastFloor(
  data: PlannerData,
  rows: { date: string; amount: number; label: string }[],
  movedReceipt: ReturnType<typeof moveReceipt>[],
): { lowest: number; date: IsoDate } {
  const scenario = buildScenario({
    data,
    purchaseRows: rows,
    movedReceipts: movedReceipt.filter((move): move is MovedReceipt => move !== null),
  });
  let lowest = Number.POSITIVE_INFINITY;
  let date = data.today;
  for (const day of scenario.ledger.days) {
    if (day.plan < lowest) {
      lowest = day.plan;
      date = day.date;
    }
  }
  return { lowest: Number.isFinite(lowest) ? lowest : data.openingBalance, date };
}

function movedFor(data: PlannerData, receiptId: string | null, delay: number): MovedReceipt[] {
  if (!receiptId || delay <= 0) return [];
  const moved = moveReceipt(data, receiptId, delay);
  return moved ? [moved] : [];
}

function rowsFor(
  plan: PurchaseSchedule,
  purchaseDate: IsoDate,
  priceFactor: number,
): { date: string; amount: number; label: string }[] {
  return plan.rows
    .filter((row) => row.date >= purchaseDate)
    .map((row) => ({
      date: row.date,
      amount: Math.round(row.amount * priceFactor),
      label: row.label,
    }));
}

export function findFixes(input: FixSearchInput): FixSearchResult {
  const { data, plan, purchaseDate } = input;
  const gate = baselineGate(data);
  const moved = movedFor(data, input.receiptId, input.selectedDelayDays);
  const baseRows = rowsFor(plan, purchaseDate, 1);
  const floor = wholeForecastFloor(data, baseRows, moved);
  const secondShortage = floor.lowest < data.reserve ? { date: floor.date, balance: floor.lowest } : null;
  const outsideTestedWindow = floor.date > addDays(purchaseDate, input.followUpDays);

  /* ---- 1. largest affordable reduced price (binary search on a rupee grid) ---- */
  let cheapest: FixOption | null = null;
  const firstRow = baseRows[0];
  if (firstRow) {
    let low = 0;
    let high = firstRow.amount;
    let best = -1;
    for (let iter = 0; iter < 24 && high - low > 100; iter++) {
      const mid = Math.floor((low + high) / 2 / 100) * 100;
      const factor = firstRow.amount > 0 ? mid / firstRow.amount : 0;
      const testRows = rowsFor(plan, purchaseDate, factor);
      const testFloor = wholeForecastFloor(data, testRows, moved);
      if (testFloor.lowest >= data.reserve) {
        best = mid;
        low = mid + 100;
      } else {
        high = mid;
      }
    }
    if (best >= 0) {
      const factor = firstRow.amount > 0 ? best / firstRow.amount : 0;
      const testFloor = wholeForecastFloor(data, rowsFor(plan, purchaseDate, factor), moved);
      cheapest = {
        kind: "reduce-price",
        label: `Reduce the price to about ₹${best.toLocaleString("en-IN")}`,
        detail:
          best >= plan.rows.reduce((sum, row) => sum + row.amount, 0)
            ? "No reduction is needed at this date with the current assumptions."
            : `Largest amount that keeps the reserve intact on ${purchaseDate} with the same payment plan and the same ${input.selectedDelayDays}-day receipt delay.`,
        price: best,
        purchaseDate,
        works: testFloor.lowest >= data.reserve,
        residualShortfall: null,
        secondShortage:
          testFloor.lowest < data.reserve ? { date: testFloor.date, balance: testFloor.lowest } : null,
        outsideTestedWindow: testFloor.date > addDays(purchaseDate, input.followUpDays),
      };
    }
  }

  /* ---- 2. earliest workable date for the full amount ---- */
  let earliest: FixOption | null = null;
  const searchStart = purchaseDate > data.today ? purchaseDate : data.today;
  const scanEnd = addDays(searchStart, Math.max(60, input.followUpDays));
  for (let offset = 0; offset <= daysBetween(searchStart, scanEnd); offset += 1) {
    const date = addDays(searchStart, offset);
    if (date > data.forecastEnd) break;
    const schedule = scheduleForDate(plan, date, data.forecastEnd);
    const evaluation = evaluatePurchaseDate(data, schedule, date, {
      maxDelayDays: input.maxDelayDays,
      followUpDays: input.followUpDays,
      receiptId: input.receiptId,
      selectedDelayDays: input.selectedDelayDays,
    });
    if (evaluation.verdict === "works") {
      const rows = rowsFor(plan, date, 1);
      const testFloor = wholeForecastFloor(data, rows, movedFor(data, input.receiptId, input.selectedDelayDays));
      earliest = {
        kind: "later-date",
        label: `Buy the full amount on ${date}`,
        detail: `First date where the purchase passes all ${evaluation.tested} tested receipt delays with the same follow-up period.`,
        price: plan.rows.reduce((sum, row) => sum + row.amount, 0),
        purchaseDate: date,
        works: testFloor.lowest >= data.reserve,
        residualShortfall: null,
        secondShortage:
          testFloor.lowest < data.reserve ? { date: testFloor.date, balance: testFloor.lowest } : null,
        outsideTestedWindow: testFloor.date > addDays(date, input.followUpDays),
      };
      break;
    }
  }

  /* ---- 3. movable expense inside the user's approved window ---- */
  let movable: FixOption | null = null;
  const windows = data.bills.filter(
    (bill) => bill.flexibility !== undefined && bill.date >= data.today,
  );
  let bestMove: { event: PlannerEvent; to: IsoDate } | null = null;
  for (const bill of windows) {
    const window = bill.flexibility!;
    const earliest = window.earliest > data.today ? window.earliest : data.today;
    const latest = window.latest > data.forecastEnd ? data.forecastEnd : window.latest;
    for (let offset = 0; offset <= daysBetween(earliest, latest); offset += 1) {
      const to = addDays(earliest, offset);
      if (to === bill.date) continue;
      // Moving a bill earlier frees cash at the purchase date; moving it later
      // frees cash until the purchase date only. Both are legal inside the window.
      const scenario = buildScenario({
        data,
        purchaseRows: baseRows,
        movedReceipts: moved,
        movedBills: [{ event: bill, to }],
      });
      let lowest = Number.POSITIVE_INFINITY;
      for (const day of scenario.ledger.days) lowest = Math.min(lowest, day.plan);
      if (lowest >= data.reserve) {
        const shift = Math.abs(daysBetween(bill.date, to));
        if (
          !bestMove ||
          shift < Math.abs(daysBetween(bestMove.event.date, bestMove.to))
        ) {
          bestMove = { event: bill, to };
        }
        break;
      }
    }
  }
  if (bestMove) {
    const scenario = buildScenario({
      data,
      purchaseRows: baseRows,
      movedReceipts: moved,
      movedBills: [{ event: bestMove.event, to: bestMove.to }],
    });
    let lowest = Number.POSITIVE_INFINITY;
    let lowestDate: IsoDate = purchaseDate;
    for (const day of scenario.ledger.days) {
      if (day.plan < lowest) {
        lowest = day.plan;
        lowestDate = day.date;
      }
    }
    movable = {
      kind: "move-expense",
      label: `Move ${bestMove.event.label} to ${bestMove.to}`,
      detail: `Inside the window ${bestMove.event.flexibility!.earliest} → ${bestMove.event.flexibility!.latest} that you approved for this bill.`,
      price: plan.rows.reduce((sum, row) => sum + row.amount, 0),
      purchaseDate,
      movedExpense: {
        event: bestMove.event,
        from: bestMove.event.date,
        to: bestMove.to,
        amount: bestMove.event.amount,
      },
      works: lowest >= data.reserve,
      residualShortfall: lowest < data.reserve ? data.reserve - lowest : null,
      secondShortage: lowest < data.reserve ? { date: lowestDate, balance: lowest } : null,
      outsideTestedWindow: lowestDate > addDays(purchaseDate, input.followUpDays),
    };
  }

  return {
    baseline: gate,
    baselineBreaches: gate.breaches,
    cheapestWorkingPrice: cheapest,
    earliestWorkingDate: earliest,
    movableExpense: movable,
    noDateWorks: earliest === null,
    secondShortage,
    outsideTestedWindow,
  };
}
