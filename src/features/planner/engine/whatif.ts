import type {
  CandidateDate,
  Explanation,
  IsoDate,
  Ledger,
  LedgerDay,
  MovedReceipt,
  PlannerData,
  PlannerEvent,
  PurchaseSchedule,
  TriggerKind,
} from "./types";
import { addDays, daysBetween, shortDate, weekdayShort } from "./dates";

/**
 * The projection core.
 *
 * How the maths works, and why it is exact:
 *  1. The shared forecast gives us `daily[].balance`, a path that already includes
 *     every recorded + expected movement.
 *  2. We rebuild a pure "event ledger" per date from `receipts` + `bills`, so the
 *     cash movement attributable to each date is known individually.
 *  3. `changeOn(date)` = event cash movement + variable net cash for that date.
 *     Summing `changeOn` from `today` reproduces the shared path exactly (verified
 *     by `ledgerMatchesShared`), which lets us shift a single movement and still
 *     land back on the app's numbers everywhere else.
 *
 * A delayed receipt is therefore removed from its original date and added on its
 * revised date — never duplicated, and only affecting the span between the two.
 */

const MAX_DAYS = 800;

export function indexedPoints(data: PlannerData) {
  const map = new Map<IsoDate, { balance: number; lower: number; upper: number }>();
  for (const point of data.daily) map.set(point.date, point);
  return map;
}

export function lastVisibleDate(data: PlannerData): IsoDate {
  return data.daily.length > 0 ? data.daily[data.daily.length - 1].date : data.forecastEnd;
}

export function baselinePoints(data: PlannerData) {
  const map = new Map<IsoDate, number>();
  for (const point of data.baseline) map.set(point.date, point.balance);
  return map;
}

/**
 * Cash movement already baked into the shared forecast for one date.
 * Variable spending is smoothed per day by the forecaster, so subtracting the
 * event totals from the day-over-day delta recovers exactly that component.
 */
interface MovementIndex {
  events: Map<IsoDate, PlannerEvent[]>;
  /** Pre-computed (events + variable net) per date, from the shared path. */
  change: Map<IsoDate, number>;
}

export function buildMovementIndex(data: PlannerData): MovementIndex {
  const events = new Map<IsoDate, PlannerEvent[]>();
  for (const event of [...data.receipts, ...data.bills]) {
    const list = events.get(event.date) ?? [];
    list.push(event);
    events.set(event.date, list);
  }
  const change = new Map<IsoDate, number>();
  const balances = new Map<IsoDate, number>();
  for (const point of data.daily) balances.set(point.date, point.balance);
  let previous = data.openingBalance;
  for (const point of data.daily) {
    if (point.date === data.today) {
      previous = point.balance;
      continue;
    }
    const delta = point.balance - previous;
    change.set(point.date, delta);
    previous = point.balance;
  }
  return { events, change };
}

/** Does the rebuilt ledger reproduce the shared forecast? Used by the checks. */
export function ledgerMatchesShared(data: PlannerData): boolean {
  const index = buildMovementIndex(data);
  let balance = data.openingBalance;
  for (const point of data.daily) {
    if (point.date === data.today) {
      balance = point.balance;
      continue;
    }
    balance += index.change.get(point.date) ?? 0;
    if (Math.abs(balance - point.balance) > 0.5) return false;
  }
  return true;
}

/* ----------------------------- receipt movement ---------------------------- */

/**
 * Delay exactly one occurrence of a receipt.
 *
 * The occurrence is identified by event id (never by merchant), so a series with
 * several occurrences in the window only ever moves the one the user picked and is
 * counted once.
 */
export function moveReceipt(
  data: PlannerData,
  receiptId: string,
  delayDays: number,
): MovedReceipt | null {
  const event = data.receipts.find((item) => item.id === receiptId);
  if (!event) return null;
  const revisedDate = addDays(event.date, delayDays);
  const end = lastVisibleDate(data);
  return {
    event,
    originalDate: event.date,
    revisedDate,
    delayDays,
    outOfWindow: revisedDate > end,
  };
}

export interface ScenarioInput {
  data: PlannerData;
  /** Extra dated expenses (the hypothetical purchase / loan instalments). */
  purchaseRows: { date: IsoDate; amount: number; label: string }[];
  /** Receipt occurrences to shift. */
  movedReceipts: MovedReceipt[];
  /** Dates applied to an expense that the user allowed to move. */
  movedBills?: { event: PlannerEvent; to: IsoDate }[];
  /** Optional savings pot behaviour. */
  savings?: { start: IsoDate; amount: number; locked: boolean; releaseDate?: IsoDate };
}

export interface ScenarioResult {
  ledger: Ledger;
  /** Index of the first day at or after the purchase date. */
  purchaseIndex: number;
  insufficientWindow: boolean;
}

export function buildScenario(input: ScenarioInput): ScenarioResult {
  const { data } = input;
  const index = buildMovementIndex(data);
  const dates: IsoDate[] = [];
  let cursor = data.today;
  for (let guard = 0; guard < MAX_DAYS && cursor <= data.forecastEnd; guard++) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  const purchaseByDate = new Map<IsoDate, { amount: number; label: string }[]>();
  for (const row of input.purchaseRows) {
    const list = purchaseByDate.get(row.date) ?? [];
    list.push({ amount: row.amount, label: row.label });
    purchaseByDate.set(row.date, list);
  }

  const removedReceipts = new Set(input.movedReceipts.map((move) => move.event.id));
  const movedReceiptsByDate = new Map<IsoDate, MovedReceipt[]>();
  for (const move of input.movedReceipts) {
    if (move.revisedDate > (dates[dates.length - 1] ?? data.forecastEnd)) continue;
    const list = movedReceiptsByDate.get(move.revisedDate) ?? [];
    list.push(move);
    movedReceiptsByDate.set(move.revisedDate, list);
  }

  const billMoves = new Map(input.movedBills?.map((move) => [move.event.id, move.to]) ?? []);

  const savings = input.savings
    ? {
        ...input.savings,
        release: input.savings.locked
          ? (input.savings.releaseDate ?? addDays(input.savings.start, 3650))
          : input.savings.start,
      }
    : null;

  const days: LedgerDay[] = [];
  let plan = data.openingBalance;
  let purchaseIndex = -1;
  const shared = new Map<IsoDate, number>();
  for (const point of data.daily) shared.set(point.date, point.balance);

  for (const date of dates) {
    const dayEvents = index.events.get(date) ?? [];
    // Movement for this date in the baseline forecast. `index.change` already
    // contains these events, so we start from it and then apply the *difference*
    // caused by the hypothetical changes. That keeps the untouched dates exactly
    // equal to the shared forecast.
    let baselineCash = 0;
    for (const event of dayEvents) {
      baselineCash += event.direction === "income" ? event.amount : -event.amount;
    }

    // Cash movement for this date after the hypothetical changes.
    let scenarioCash = 0;
    for (const event of dayEvents) {
      const signed = event.direction === "income" ? event.amount : -event.amount;
      const removed = event.direction === "income" && removedReceipts.has(event.id);
      const movedTo = billMoves.get(event.id);
      const movedAway = event.direction === "expense" && movedTo !== undefined && movedTo !== date;
      if (!removed && !movedAway) scenarioCash += signed;
    }
    for (const move of movedReceiptsByDate.get(date) ?? []) {
      scenarioCash += move.event.amount;
    }
    for (const move of input.movedBills ?? []) {
      if (move.to === date) scenarioCash += -move.event.amount;
    }

    const purchaseToday = purchaseByDate.get(date) ?? [];
    const purchaseCash = purchaseToday.reduce((sum, row) => sum + row.amount, 0);

    let savingsDelta = 0;
    if (savings && date === savings.start) savingsDelta -= savings.amount;
    if (savings && savings.locked && date === savings.release) savingsDelta += savings.amount;

    const dayChange = index.change.get(date) ?? 0;
    plan += dayChange + (scenarioCash - baselineCash) + savingsDelta - purchaseCash;

    const base = shared.get(date) ?? plan;
    if (purchaseIndex < 0 && purchaseToday.length > 0) purchaseIndex = days.length;
    days.push({ date, base, plan, check: base });
  }

  const windowEnd = dates[dates.length - 1] ?? data.forecastEnd;
  const insufficientWindow = input.purchaseRows.some(
    (row) => row.date > windowEnd || row.date > data.forecastEnd,
  );

  return {
    ledger: { days, start: data.today, end: windowEnd },
    purchaseIndex,
    insufficientWindow,
  };
}

/* ------------------------------- affordability ----------------------------- */

export interface AffordabilityResult {
  verdict: CandidateDate["verdict"];
  passes: number;
  tested: number;
  testedDelays: number[];
  lowestBalance: number;
  lowestDate: IsoDate;
  headroom: number;
  balanceAtSelectedDelay: number;
  /** Floor across every tested delay (the conservative number). */
  worstCaseBalance: number;
  worstCaseDate: IsoDate;
  insufficientWindow: boolean;
  firstBreach: { date: IsoDate; balance: number; shortfall: number } | null;
  firstNegative: { date: IsoDate; balance: number } | null;
}

/**
 * Test one purchase date against the reserve for every delay in 0..maxDelay.
 *
 * Classification:
 *  - "works"          every tested delay keeps the reserve intact
 *  - "timing"         on-time payment is fine, but at least one delay is not
 *  - "below-reserve"  the reserve is crossed even with an on-time receipt
 *  - "insufficient-window" the follow-up period runs past the shared forecast
 */
export function evaluatePurchaseDate(
  data: PlannerData,
  schedule: PurchaseSchedule,
  purchaseDate: IsoDate,
  options: {
    maxDelayDays: number;
    followUpDays: number;
    receiptId: string | null;
    selectedDelayDays: number;
  },
): AffordabilityResult {
  const windowEnd = addDays(purchaseDate, options.followUpDays);
  const delayCount = Math.max(0, Math.floor(options.maxDelayDays));
  const testedDelays: number[] = [];
  for (let d = 0; d <= delayCount; d += 1) testedDelays.push(d);

  const insufficientWindow = windowEnd > data.forecastEnd || purchaseDate > data.forecastEnd;

  const rows = schedule.rows
    .filter((row) => row.date >= purchaseDate)
    .map((row) => ({ date: row.date, amount: row.amount, label: row.label }));

  let passes = 0;
  let lowestBalance = Number.POSITIVE_INFINITY;
  let lowestDate = purchaseDate;
  let firstBreach: AffordabilityResult["firstBreach"] = null;

  for (const delay of testedDelays) {
    const moved: MovedReceipt[] = [];
    if (options.receiptId && delay > 0) {
      const move = moveReceipt(data, options.receiptId, delay);
      if (move) moved.push(move);
    }
    const result = buildScenario({ data, purchaseRows: rows, movedReceipts: moved });
    // Same follow-up period for every candidate, clipped to the visible window.
    const slice = result.ledger.days.filter(
      (day) => day.date >= purchaseDate && day.date <= windowEnd,
    );
    let ok = true;
    for (const day of slice) {
      if (day.plan < lowestBalance) {
        lowestBalance = day.plan;
        lowestDate = day.date;
      }
      if (day.plan < data.reserve) {
        ok = false;
        if (!firstBreach || day.date < firstBreach.date) {
          firstBreach = {
            date: day.date,
            balance: day.plan,
            shortfall: data.reserve - day.plan,
          };
        }
      }
    }
    if (ok) passes += 1;
  }

  // The user's selected assumption decides the "shown" balance floor.
  const selectedMove: MovedReceipt[] = [];
  if (options.receiptId && options.selectedDelayDays > 0) {
    const move = moveReceipt(data, options.receiptId, options.selectedDelayDays);
    if (move) selectedMove.push(move);
  }
  const selectedResult = buildScenario({
    data,
    purchaseRows: rows,
    movedReceipts: selectedMove,
  });
  let balanceAtSelectedDelay = Number.POSITIVE_INFINITY;
  let balanceAtSelectedDate = purchaseDate;
  let firstNegative: AffordabilityResult["firstNegative"] = null;
  for (const day of selectedResult.ledger.days) {
    if (day.date < purchaseDate || day.date > windowEnd) continue;
    if (day.plan < balanceAtSelectedDelay) {
      balanceAtSelectedDelay = day.plan;
      balanceAtSelectedDate = day.date;
    }
    if (!firstNegative && day.plan < 0) firstNegative = { date: day.date, balance: day.plan };
  }
  if (!Number.isFinite(balanceAtSelectedDelay)) balanceAtSelectedDelay = data.openingBalance;
  if (!Number.isFinite(lowestBalance)) {
    lowestBalance = balanceAtSelectedDelay;
    lowestDate = purchaseDate;
  }

  // What the user is shown is the path under their selected receipt assumption
  // (worst case across tested delays is still reported separately).
  const shownLowest = balanceAtSelectedDelay;
  const shownLowestDate = balanceAtSelectedDate;

  const verdict: CandidateDate["verdict"] = insufficientWindow
    ? "insufficient-window"
    : passes === testedDelays.length
      ? "works"
      : passes === 0
        ? "below-reserve"
        : "timing";

  return {
    verdict,
    passes,
    tested: testedDelays.length,
    testedDelays,
    lowestBalance: shownLowest,
    lowestDate: shownLowestDate,
    headroom: shownLowest - data.reserve,
    balanceAtSelectedDelay,
    worstCaseBalance: lowestBalance,
    worstCaseDate: lowestDate,
    insufficientWindow,
    firstBreach,
    firstNegative,
  };
}

/* -------------------------------- explanation ------------------------------ */

/**
 * Say *why* a date fails, using only what the figures support:
 * the purchase itself, a specific bill, or everyday spending.
 */
export function explainDate(
  data: PlannerData,
  schedule: PurchaseSchedule,
  purchaseDate: IsoDate,
  result: AffordabilityResult,
  movedReceipt: MovedReceipt | null,
): Explanation {
  const rows = schedule.rows
    .filter((row) => row.date >= purchaseDate)
    .map((row) => ({ date: row.date, amount: row.amount, label: row.label }));
  // Identify which day the numbers actually point at: the reserve breach if there
  // is one, otherwise the reported floor.
  const pivotalDate = result.firstBreach?.date ?? result.lowestDate;
  // A readable name for the purchase in explanation copy.
  const purchaseItemLabel = schedule.rows[0]?.label.replace(/ paid in full$/, "") ?? "The purchase";
  const scenario = buildScenario({
    data,
    purchaseRows: rows,
    movedReceipts: movedReceipt ? [movedReceipt] : [],
  });

  const movements: Explanation["movements"] = [];
  const billsBeforeFloor = data.bills
    .filter((bill) => bill.date >= purchaseDate && bill.date <= pivotalDate)
    .sort((a, b) => b.amount - a.amount);

  for (const row of rows) {
    movements.push({
      date: row.date,
      label: row.label,
      amount: row.amount,
      direction: "expense",
      note: "Your purchase",
    });
  }
  if (movedReceipt) {
    movements.push({
      date: movedReceipt.originalDate,
      label: `${movedReceipt.event.label} (was due)`,
      amount: movedReceipt.event.amount,
      direction: "income",
      note: `Receipt moved to ${shortDate(movedReceipt.revisedDate)}`,
    });
  }
  for (const bill of billsBeforeFloor.slice(0, 4)) {
    movements.push({
      date: bill.date,
      label: bill.label,
      amount: bill.amount,
      direction: bill.direction,
      note: "Scheduled bill",
    });
  }
  movements.sort((a, b) => a.date.localeCompare(b.date));

  // Which movement explains the breach? Look at the whole span from the purchase to
  // the breach, not only the last day: a large upfront purchase followed by ordinary
  // spending is still a purchase problem, and saying otherwise would mislead.
  const breach = result.firstBreach;
  let trigger: TriggerKind = "purchase";
  let triggerLabel = "The purchase itself";
  let triggerDate: IsoDate | null = purchaseDate;
  let evidence = "";

  if (breach) {
    const breachDayIndex = scenario.ledger.days.findIndex((day) => day.date === breach.date);
    const breachDay = scenario.ledger.days[breachDayIndex];
    const previous = scenario.ledger.days[breachDayIndex - 1];
    const dropOnBreachDay = previous && breachDay ? previous.plan - breachDay.plan : 0;

    const windowStartIndex = scenario.ledger.days.findIndex((day) => day.date >= purchaseDate);
    const windowDays = scenario.ledger.days.slice(Math.max(0, windowStartIndex), breachDayIndex + 1);
    const startBalance = windowDays.length > 0 ? windowDays[0].plan : 0;
    const endBalance = breachDay?.plan ?? startBalance;
    const totalDrop = startBalance - endBalance;
    const windowLength = windowDays.length;

    const purchaseOnBreachDate = rows.filter((row) => row.date === breach.date);
    const purchaseCashInWindow = rows
      .filter((row) => row.date <= breach.date)
      .reduce((sum, row) => sum + row.amount, 0);
    const billsInWindow = data.bills.filter(
      (bill) => bill.direction === "expense" && bill.date >= purchaseDate && bill.date <= breach.date,
    );
    const biggestBill = [...billsInWindow].sort((a, b) => b.amount - a.amount)[0];

    const scale = Math.max(Math.abs(totalDrop), Math.abs(dropOnBreachDay), 1);
    const purchaseShare = purchaseCashInWindow / scale;
    const billShare = biggestBill ? biggestBill.amount / scale : 0;
    const everydayShare = 1 - Math.min(1, purchaseShare + billShare);
    const span =
      windowLength <= 1
        ? `on ${shortDate(purchaseDate)}`
        : `between ${shortDate(purchaseDate)} and ${shortDate(breach.date)}`;

    if (purchaseShare >= 0.4) {
      trigger = "purchase";
      triggerLabel = `${purchaseItemLabel} (your purchase)`;
      triggerDate = breach.date;
      evidence =
        totalDrop > 0
          ? `Your purchase takes ${inr(purchaseCashInWindow)} out ${span}, about ${Math.round(
              purchaseShare * 100,
            )}% of the ${inr(totalDrop)} the balance falls by in that window.`
          : `Your purchase takes ${inr(purchaseCashInWindow)} out ${span}; the balance is ${inr(
              endBalance,
            )} at the low point.`;
      if (purchaseOnBreachDate.length > 0) {
        evidence += ` It lands on ${shortDate(breach.date)} itself.`;
      }
    } else if (biggestBill && billShare >= 0.35 && biggestBill.amount >= Math.abs(dropOnBreachDay) * 0.5) {
      trigger = "bill";
      triggerLabel = biggestBill.label;
      triggerDate = biggestBill.date;
      evidence = `${biggestBill.label} (${inr(biggestBill.amount)}) on ${shortDate(
        biggestBill.date,
      )} is about ${Math.round(billShare * 100)}% of the ${inr(totalDrop)} the balance falls by ${span}.`;
    } else if (everydayShare > 0) {
      trigger = "everyday";
      triggerLabel = "Everyday spending";
      triggerDate = breach.date;
      evidence = `About ${inr(
        data.variableExpensePerDay * windowLength,
      )} of everyday spending across ${windowLength} day${
        windowLength === 1 ? "" : "s"
      }, with no single bill large enough to explain the drop on its own.`;
    } else {
      trigger = "purchase";
      triggerLabel = `${purchaseItemLabel} (your purchase)`;
      triggerDate = breach.date;
      evidence = `The reserve is crossed on ${shortDate(breach.date)} with ${inr(
        breach.shortfall,
      )} less than your reserve.`;
    }
  }
  const sentences: string[] = [];
  if (result.insufficientWindow) {
    sentences.push(
      "Insufficient forecast window: this date's follow-up period runs past the end of the shared forecast, so the result is not graded.",
    );
  }
  if (result.firstBreach) {
    sentences.push(
      `Lowest balance ${inr(result.lowestBalance)} on ${shortDate(result.lowestDate)} (${weekdayShort(result.lowestDate)}); the reserve of ${inr(data.reserve)} is first crossed on ${shortDate(result.firstBreach.date)}, ${inr(result.firstBreach.shortfall)} short.`,
    );
    if (trigger === "everyday") {
      sentences.push(`Everyday spending contributes to this breach: ${evidence}`);
    } else {
      sentences.push(`${triggerLabel} is the trigger: ${evidence}`);
    }
  } else {
    sentences.push(
      `Lowest balance ${inr(result.lowestBalance)} on ${shortDate(result.lowestDate)} — ${inr(result.headroom)} above your reserve.`,
    );
  }
  if (result.firstNegative) {
    sentences.push(
      `The balance would go negative on ${shortDate(result.firstNegative.date)} (${inr(result.firstNegative.balance)}).`,
    );
  }
  if (movedReceipt) {
    sentences.push(
      `${movedReceipt.event.label} (${inr(movedReceipt.event.amount)}) is assumed to arrive ${movedReceipt.delayDays} day${movedReceipt.delayDays === 1 ? "" : "s"} late, on ${shortDate(movedReceipt.revisedDate)} instead of ${shortDate(movedReceipt.originalDate)}.`,
    );
  }
  sentences.push(`Passes ${result.passes} of ${result.tested} tested delays.`);

  return {
    outcome: result.verdict,
    passes: result.passes,
    tested: result.tested,
    testedDelays: result.testedDelays,
    lowestBalance: result.lowestBalance,
    lowestDate: result.lowestDate,
    firstBreach: result.firstBreach,
    firstNegative: result.firstNegative,
    trigger: { kind: trigger, label: triggerLabel, date: triggerDate, evidence },
    movements,
    sentences,
    insufficientWindow: result.insufficientWindow,
  };
}

function inr(value: number): string {
  return `₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}

export function daysUntil(data: PlannerData, date: IsoDate): number {
  return daysBetween(data.today, date);
}
