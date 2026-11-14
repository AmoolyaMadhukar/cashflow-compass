import type {
  CustomLoanTerms,
  EmiTerms,
  IsoDate,
  PurchasePlan,
  PurchaseSchedule,
} from "./types";
import { addDays, addMonths, daysBetween, shortDate } from "./dates";

/**
 * Schedule functions for paying in full, EMI, or a user-defined loan.
 *
 * These are pure and shared by the purchase form, the timing calendar (which
 * needs only the cash that lands on the purchase date) and the ledger builder,
 * so a change to the loan maths can never diverge between views.
 */

/** Clamp an instalment date into a month that actually exists. */
function dueDateFrom(anchor: IsoDate, monthsAhead: number): IsoDate {
  return addMonths(anchor, monthsAhead);
}

export function emiInstalment(terms: EmiTerms, price: number): number {
  const financed = Math.max(0, price - terms.downPayment);
  if (financed <= 0 || terms.instalments <= 0) return 0;
  const monthlyRate = terms.monthlyRatePercent / 100;
  if (monthlyRate <= 0) return financed / terms.instalments;
  const factor = Math.pow(1 + monthlyRate, terms.instalments);
  return (financed * monthlyRate * factor) / (factor - 1);
}

export function loanInstalment(terms: CustomLoanTerms, price: number): number {
  const financed = Math.max(0, price - terms.downPayment);
  if (financed <= 0 || terms.instalments <= 0) return 0;
  const total = financed * (1 + terms.flatInterestPercent / 100);
  return total / terms.instalments;
}

/**
 * Convert the chosen payment method into dated cash outflows.
 * The first row always lands on the purchase date (down payment and/or fees and/or
 * the first instalment), which is what the calendar's affordability test uses.
 */
export function buildPurchaseSchedule(plan: PurchasePlan, lastVisibleDate: IsoDate): PurchaseSchedule {
  const rows: PurchaseSchedule["rows"] = [];
  const push = (date: IsoDate, amount: number, label: string) => {
    if (amount <= 0) return;
    rows.push({ index: rows.length + 1, date, amount: Math.round(amount), label });
  };

  if (plan.method === "full") {
    push(plan.earliestDate, plan.price, `${plan.item || "Purchase"} paid in full`);
    const outsideWindow = plan.earliestDate > lastVisibleDate ? 1 : 0;
    return {
      method: "full",
      rows,
      downPayment: 0,
      fees: 0,
      financed: 0,
      totalPaid: Math.round(plan.price),
      firstDueDate: plan.earliestDate,
      instalmentAmount: 0,
      instalments: 0,
      outsideWindow,
      headline: "One payment on the purchase date.",
    };
  }

  if (plan.method === "emi") {
    const terms = plan.emi ?? { downPayment: 0, processingFee: 0, monthlyRatePercent: 0, instalments: 1 };
    const per = emiInstalment(terms, plan.price);
    push(plan.earliestDate, terms.downPayment, "Down payment");
    push(plan.earliestDate, terms.processingFee, "Processing fee");
    push(plan.earliestDate, per, "EMI instalment 1");
    let firstDue: IsoDate | null = plan.earliestDate;
    for (let i = 2; i <= terms.instalments; i++) {
      const date = dueDateFrom(plan.earliestDate, i - 1);
      if (i === 2) firstDue = date;
      push(date, per, `EMI instalment ${i} of ${terms.instalments}`);
    }
    const totalPaid = rows.reduce((sum, row) => sum + row.amount, 0);
    const outsideWindow = rows.filter((row) => row.date > lastVisibleDate).length;
    return {
      method: "emi",
      rows,
      downPayment: Math.round(terms.downPayment),
      fees: Math.round(terms.processingFee),
      financed: Math.round(Math.max(0, plan.price - terms.downPayment)),
      totalPaid,
      firstDueDate: firstDue,
      instalmentAmount: Math.round(per),
      instalments: terms.instalments,
      outsideWindow,
      headline: `${terms.instalments} instalments of about ₹${Math.round(per).toLocaleString("en-IN")} after the initial payment.`,
    };
  }

  const terms = plan.customLoan ?? {
    downPayment: 0,
    processingFee: 0,
    instalments: 1,
    flatInterestPercent: 0,
  };
  const per = loanInstalment(terms, plan.price);
  push(plan.earliestDate, terms.downPayment, "Down payment");
  push(plan.earliestDate, terms.processingFee, "Processing fee");
  push(plan.earliestDate, per, "Loan instalment 1");
  let firstDue: IsoDate | null = plan.earliestDate;
  for (let i = 2; i <= terms.instalments; i++) {
    const date = dueDateFrom(plan.earliestDate, i - 1);
    if (i === 2) firstDue = date;
    push(date, per, `Loan instalment ${i} of ${terms.instalments}`);
  }
  const totalPaid = rows.reduce((sum, row) => sum + row.amount, 0);
  const outsideWindow = rows.filter((row) => row.date > lastVisibleDate).length;
  return {
    method: "custom-loan",
    rows,
    downPayment: Math.round(terms.downPayment),
    fees: Math.round(terms.processingFee),
    financed: Math.round(Math.max(0, plan.price - terms.downPayment)),
    totalPaid,
    firstDueDate: firstDue,
    instalmentAmount: Math.round(per),
    instalments: terms.instalments,
    outsideWindow,
    headline: `${terms.instalments} instalments of about ₹${Math.round(per).toLocaleString("en-IN")} with ${terms.flatInterestPercent}% flat interest.`,
  };
}

/** Same schedule, but dated at `purchaseDate` instead of the plan's earliest date. */
export function scheduleAt(plan: PurchasePlan, purchaseDate: IsoDate, lastVisibleDate: IsoDate): PurchaseSchedule {
  return buildPurchaseSchedule({ ...plan, earliestDate: purchaseDate }, lastVisibleDate);
}

/** Cash that leaves the account on the purchase date itself. */
export function outlayOnPurchaseDate(schedule: PurchaseSchedule): number {
  if (schedule.rows.length === 0) return 0;
  const date = schedule.rows[0].date;
  return schedule.rows.filter((row) => row.date === date).reduce((sum, row) => sum + row.amount, 0);
}

/** Short label for the schedule chip in the calendar header. */
export function scheduleSummary(schedule: PurchaseSchedule): string {
  if (schedule.method === "full") return "Paying in full";
  if (schedule.method === "emi") return `EMI · ${schedule.instalments} instalments`;
  return `Custom loan · ${schedule.instalments} instalments`;
}

export function scheduleHorizonDays(schedule: PurchaseSchedule): number {
  if (schedule.rows.length === 0) return 0;
  const first = schedule.rows[0].date;
  const last = schedule.rows[schedule.rows.length - 1].date;
  return daysBetween(first, last);
}

/** Convenience for the form's live preview copy. */
export function scheduleEndNote(schedule: PurchaseSchedule, lastVisibleDate: IsoDate): string {
  if (schedule.outsideWindow === 0) return "All commitments fall inside the forecast window.";
  const last = schedule.rows[schedule.rows.length - 1];
  return `${schedule.outsideWindow} commitment${schedule.outsideWindow === 1 ? "" : "s"} continue past ${shortDate(lastVisibleDate)} (last on ${shortDate(last.date)}), beyond the chart.`;
}

export function nextDueAfter(schedule: PurchaseSchedule, date: IsoDate): IsoDate | null {
  const row = schedule.rows.find((item) => item.date > date);
  return row ? row.date : null;
}

export { addDays };
