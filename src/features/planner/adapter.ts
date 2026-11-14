import type {
  DailyBalancePoint,
  FlexibilityWindow,
  IsoDate,
  PlannerData,
  PlannerEvent,
  PlannerProvenance,
} from "./engine/types";

export type { PlannerProvenance };

/**
 * The narrow adapter between the app that exists today and the planner's
 * contract (`PlannerData`).
 *
 * Person 3 mounts `<PurchasePlanner />` and passes this shape. It is the ONLY
 * place that knows about the current store; when Person 1's shared forecast
 * module lands, only `plannerDataFromApp` needs to change.
 *
 * Required props to hand over (see `../README.md`):
 *   { today, openingBalance, reserve, receipts, bills, daily, forecastEnd,
 *     baseline, variableNetPerDay, variableExpensePerDay, provenance }
 */

/** Loose structural view of today's `useApp()` value — avoids owning shared types. */
export interface AppForecastPoint {
  date: string;
  balance: number;
  lower: number;
  upper: number;
}

export interface AppForecastEvent {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: "income" | "expense";
  category: string;
  kind: "recurring" | "scenario" | "variable";
  recurringKey?: string;
  isEstimate?: boolean;
}

export interface AppForecastShape {
  today: string;
  horizon: number;
  startingBalance: number;
  points: AppForecastPoint[];
  events: AppForecastEvent[];
}

export interface AppDataShape {
  today: string;
  settings: { safetyThreshold: number; horizon: number };
  baselineForecast: AppForecastShape;
  transactions: { date: string; amount: number; direction: "income" | "expense"; category: string }[];
  isDemoData: boolean;
  flexibleBills?: { eventId: string; window: FlexibilityWindow }[];
}

/**
 * Today's app gives one forecast path. `daily` and `baseline` are the same path:
 * the planner overlays its own changes on top of it, and re-applies events itself
 * so a moved receipt is never double counted.
 */
export function plannerDataFromApp(app: AppDataShape): PlannerData {
  const points = [...app.baselineForecast.points].sort((a, b) => a.date.localeCompare(b.date));
  const daily: DailyBalancePoint[] = points.map((point) => ({
    date: point.date,
    balance: point.balance,
    lower: point.lower,
    upper: point.upper,
  }));
  const flexible = new Map((app.flexibleBills ?? []).map((item) => [item.eventId, item.window]));

  const toEvent = (event: AppForecastEvent): PlannerEvent => ({
    id: event.id,
    date: event.date,
    label: event.label,
    amount: event.amount,
    direction: event.direction,
    category: event.category,
    kind: event.kind,
    seriesKey: event.recurringKey,
    isEstimate: event.isEstimate,
    flexibility: flexible.get(event.id),
  });

  const events = app.baselineForecast.events.map(toEvent);
  const receipts = events.filter((event) => event.direction === "income");
  const bills = events.filter((event) => event.direction === "expense");

  const variableExpensePerDay = estimateVariablePerDay(app);
  const variableNetPerDay = estimateVariableNet(app);

  return {
    today: app.today,
    openingBalance: app.baselineForecast.startingBalance,
    reserve: app.settings.safetyThreshold,
    receipts,
    bills,
    daily,
    forecastEnd: daily.length > 0 ? daily[daily.length - 1].date : app.today,
    baseline: daily,
    variableNetPerDay,
    variableExpensePerDay,
    provenance: {
      source: app.isDemoData ? "development-fixture" : "user-data",
      note: app.isDemoData
        ? "Demo transactions bundled with the app — results are illustrative, not your money."
        : "Built from your recorded transactions and detected recurring items.",
    },
  };
}

/**
 * The forecaster smooths variable spending to a daily average. Recover that
 * average from the shared points so the planner's ledger reproduces the same path.
 */
function estimateVariableNet(app: AppDataShape): number {
  const points = app.baselineForecast.points;
  if (points.length < 2) return 0;
  const byDate = new Map<IsoDate, number>();
  for (const event of app.baselineForecast.events) {
    byDate.set(
      event.date,
      (byDate.get(event.date) ?? 0) + (event.direction === "income" ? event.amount : -event.amount),
    );
  }
  let sum = 0;
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].balance - points[i - 1].balance;
    const eventNet = byDate.get(points[i].date) ?? 0;
    sum += delta - eventNet;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function estimateVariablePerDay(app: AppDataShape): number {
  const start = app.baselineForecast.today;
  const [y, m, d] = start.split("-").map(Number);
  const anchor = new Date(y, m - 1, d);
  anchor.setDate(anchor.getDate() - 90);
  const from = anchor.toISOString().slice(0, 10);
  let total = 0;
  let days = 0;
  for (const tx of app.transactions) {
    if (tx.direction !== "expense" || tx.date < from || tx.date > start) continue;
    total += tx.amount;
  }
  days = 90;
  return days > 0 ? total / days : 0;
}

/** Empty state guard: the planner needs at least two forecast points to grade anything. */
export function hasUsableForecast(data: PlannerData): boolean {
  return data.daily.length > 2 && data.provenance.source === "user-data";
}

/* ----------------------------- development fixture ---------------------------- */

/**
 * Labelled fixture used only when no app forecast is supplied — for the acceptance
 * checks and for developing this feature in isolation. Never used for a real user.
 *
 * The numbers are deliberate so the demo has an honest failure to inspect:
 *   opening ₹60,000 · everyday spend ₹1,000/day
 *   rent ₹30,000 on day 3 · loan EMI ₹9,000 on day 6
 *   client receipt ₹20,000 on day 10
 * => the projected low is exactly ₹12,000 on day 9 (the day before the receipt),
 *    with a ₹5,000 reserve and a ₹10,000 purchase to test.
 */
export function buildDevelopmentFixture(today: IsoDate): PlannerData {
  const add = (days: number): string => {
    const [y, m, d] = today.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  };

  const receipts: PlannerEvent[] = [
    {
      id: "fx-receipt-client-1",
      date: add(10),
      label: "Nova Design Studio invoice",
      amount: 20000,
      direction: "income",
      category: "Freelance",
      kind: "recurring",
      seriesKey: "income:nova",
      isEstimate: true,
    },
  ];
  const bills: PlannerEvent[] = [];

  const monthly = (
    sink: PlannerEvent[],
    id: string,
    firstDay: number,
    label: string,
    amount: number,
    category: string,
    direction: "income" | "expense",
    seriesKey: string,
    months: number,
    flexibility?: FlexibilityWindow,
  ) => {
    for (let i = 0; i < months; i++) {
      const date = add(firstDay + i * 30);
      sink.push({
        id: `${id}-${i + 1}`,
        date,
        label,
        amount,
        direction,
        category,
        kind: "recurring",
        seriesKey,
        isEstimate: true,
        flexibility: i === 0 ? flexibility : undefined,
      });
    }
  };

  monthly(receipts, "fx-receipt-salary", 26, "Acme Technologies salary", 80000, "Salary", "income", "income:acme", 4);
  monthly(bills, "fx-bill-rent", 3, "House Rent - Koramangala", 30000, "Rent", "expense", "expense:house rent", 4, {
    earliest: add(2),
    latest: add(12),
  });
  monthly(bills, "fx-bill-emi", 6, "HDFC Personal Loan EMI", 9000, "Loan EMI", "expense", "expense:hdfc", 4);
  monthly(bills, "fx-bill-broadband", 14, "Airtel Fiber Broadband", 999, "Utilities", "expense", "expense:airtel", 4, {
    earliest: add(14),
    latest: add(24),
  });
  monthly(bills, "fx-bill-insurance", 24, "ICICI Lombard Insurance", 2180, "Insurance", "expense", "expense:icici", 2);

  const openingBalance = 60000;
  const variableNetPerDay = -1000; // ₹1,000/day of everyday spending, smoothed
  const variableExpensePerDay = 1000;
  const horizon = 120;

  const eventCash = new Map<string, number>();
  for (const event of [...receipts, ...bills]) {
    eventCash.set(
      event.date,
      (eventCash.get(event.date) ?? 0) + (event.direction === "income" ? event.amount : -event.amount),
    );
  }

  const daily: DailyBalancePoint[] = [
    { date: today, balance: openingBalance, lower: openingBalance, upper: openingBalance },
  ];
  let balance = openingBalance;
  for (let d = 1; d <= horizon; d++) {
    const date = add(d);
    balance += variableNetPerDay + (eventCash.get(date) ?? 0);
    daily.push({ date, balance, lower: balance - 2500, upper: balance + 2500 });
  }

  return {
    today,
    openingBalance,
    reserve: 5000,
    receipts: [...receipts].sort((a, b) => a.date.localeCompare(b.date)),
    bills: [...bills].sort((a, b) => a.date.localeCompare(b.date)),
    daily,
    forecastEnd: daily[daily.length - 1].date,
    baseline: daily,
    variableNetPerDay,
    variableExpensePerDay,
    provenance: {
      source: "development-fixture",
      note: "LABELLED DEVELOPMENT FIXTURE — synthetic numbers for building and checking this feature, not your money.",
    },
  };
}

/** Props Person 3 must pass to `<PurchasePlanner data={...} />` if they bypass the adapter. */
export const REQUIRED_PLANNER_PROPS = [
  "today",
  "openingBalance",
  "reserve",
  "receipts",
  "bills",
  "daily",
  "forecastEnd",
  "baseline",
  "variableNetPerDay",
  "variableExpensePerDay",
  "provenance",
] as const;
