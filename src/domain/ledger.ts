/**
 * Money representation and cash-flow arithmetic.
 *
 * Pure functions only. Signed cash appears exactly once, in
 * `CashMovement.signedAmount` = `sign * amount`.
 */
import type {
  Account,
  Asset,
  CashMovement,
  Direction,
  EmiSchedule,
  ExpectedSourceRef,
  ForecastMovementView,
  Frequency,
  ISODate,
  Invoice,
  Loan,
  LoanTransaction,
  MovementCategoryClass,
  MovementKind,
  RecurringSeries,
  UserProfile,
} from "./contracts";
import { addDays, addMonths, daysBetween, parseISO, toISO } from "../lib/format";

export const DAY_MS = 86_400_000;
export const Z_80 = 1.2816; // ~80% two-sided band for a normal error term

/* ---------------------------------- dates --------------------------------- */

export { addDays, addMonths, daysBetween, parseISO, toISO };

export function isISODate(value: unknown): value is ISODate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function betweenDates(date: ISODate, start: ISODate, end: ISODate): boolean {
  return date >= start && date <= end;
}

export function compareByDate<T extends { date: ISODate }>(a: T, b: T): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  if (end < start) return out;
  let cursor = start;
  // Hard stop keeps a bad input from looping forever.
  for (let i = 0; i <= 3660 && cursor <= end; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Advance a date by one whole frequency period. */
export function advanceByFrequency(date: ISODate, frequency: Frequency): ISODate {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "half-yearly":
      return addMonths(date, 6);
    case "yearly":
      return addMonths(date, 12);
  }
}

export function frequencyDays(frequency: Frequency): number {
  switch (frequency) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30.44;
    case "quarterly":
      return 91.31;
    case "half-yearly":
      return 182.62;
    case "yearly":
      return 365.25;
  }
}

/** Every occurrence of a series that falls inside [start, end], inclusive. */
export function seriesOccurrences(
  series: RecurringSeries,
  start: ISODate,
  end: ISODate,
): ISODate[] {
  if (series.paused) return [];
  const from = series.endDate && series.endDate < start ? series.endDate : start;
  const hardEnd = series.endDate && series.endDate < end ? series.endDate : end;
  if (hardEnd < from) return [];
  let cursor = series.startDate;
  const dates: ISODate[] = [];
  // Walk forward from the anchor (occurrences are derived, never stored).
  for (let i = 0; i < 600; i++) {
    if (cursor > hardEnd) break;
    if (cursor >= from) dates.push(cursor);
    const next = series.intervalDays
      ? addDays(cursor, series.intervalDays)
      : advanceByFrequency(cursor, series.frequency);
    if (next <= cursor) break;
    cursor = next;
  }
  return dates;
}

/**
 * Where a bill scheduled inside a payment window may actually be paid, and how
 * late it might arrive. Used by the forecast (window bills) and the review queue.
 */
export function windowRange(series: RecurringSeries): { start: ISODate; end: ISODate } {
  const start = series.windowStart ?? series.startDate;
  const end = series.windowEnd ?? start;
  return start <= end ? { start, end } : { start: end, end: start };
}

/* --------------------------------------------------------------- movements */

export const MOVEMENT_CLASS: Record<MovementKind, MovementCategoryClass> = {
  income: "earned_income",
  invoice: "earned_income",
  expense: "spending",
  emi: "spending",
  refund: "refund",
  transfer: "transfer",
  savings_pot: "transfer",
  loan_proceeds: "borrowing",
  loan_repayment: "debt_service",
  asset_sale: "asset_sale",
};

export function movementClass(movement: CashMovement): MovementCategoryClass {
  return MOVEMENT_CLASS[movement.kind] ?? "spending";
}

export function isInternalMove(movement: CashMovement): boolean {
  return movement.kind === "transfer" || movement.kind === "savings_pot";
}

/** Earned income: money the user actually earned. Borrowing and refunds are not income. */
export function isEarnedIncomeKinds(kind: MovementKind): boolean {
  return movementClass({ kind } as CashMovement) === "earned_income";
}

export function signedAmountOf(amount: number, direction: Direction): number {
  return direction === "income" ? Math.abs(amount) : -Math.abs(amount);
}

export interface MovementDraft {
  id: string;
  date: ISODate;
  label: string;
  amount: number;
  kind: MovementKind;
  /** Required for non-transfers. */
  direction?: Direction;
  accountId: string;
  toAccountId?: string;
  category?: string;
  status?: CashMovement["status"];
  merchantKey?: string;
  recurring?: { seriesId: string; occurrenceDate: ISODate };
  source?: ExpectedSourceRef;
  note?: string;
  origin?: CashMovement["origin"];
}

/**
 * Build a signed movement. `sign` is the ONLY place direction is encoded —
 * every balance function just adds `signedAmount`.
 */
export function makeMovement(draft: MovementDraft): CashMovement {
  const amount = Math.round(Math.abs(draft.amount));
  const internal = draft.kind === "transfer" || draft.kind === "savings_pot";
  let sign: -1 | 1;
  if (internal) {
    // Transfers are recorded as ONE net movement (from -> to). It carries no
    // sign of its own; `internalTransferLegs` expands it into both legs.
    sign = draft.direction === "income" ? 1 : -1;
  } else {
    sign = draft.direction === "income" ? 1 : -1;
  }
  return {
    id: draft.id,
    date: draft.date,
    label: draft.label,
    amount,
    sign,
    signedAmount: internal ? 0 : sign * amount,
    kind: draft.kind,
    status: draft.status ?? "actual",
    accountId: draft.accountId,
    toAccountId: draft.toAccountId,
    category: draft.category ?? "Other",
    merchantKey: draft.merchantKey,
    recurring: draft.recurring,
    source: draft.source,
    note: draft.note,
    origin: draft.origin ?? "manual",
  };
}

/** Total cash is unchanged by an internal move; this documents that invariant. */
export function isTransferConserving(movement: CashMovement): boolean {
  return isInternalMove(movement) ? movement.signedAmount === 0 : true;
}

/**
 * Expand internal moves into two signed account legs. The net over BOTH legs is
 * always zero, so total cash is conserved by construction.
 */
export interface AccountLeg {
  movementId: string;
  accountId: string;
  /** Negative on the source, positive on the destination. */
  signedAmount: number;
  date: ISODate;
}

export function accountLegs(movement: CashMovement): AccountLeg[] {
  if (!isInternalMove(movement)) {
    return [
      { movementId: movement.id, accountId: movement.accountId, signedAmount: movement.signedAmount, date: movement.date },
    ];
  }
  const from = movement.accountId;
  const to = movement.toAccountId ?? movement.accountId;
  if (!to || to === from) {
    // Malformed transfer: no cash leaves the total pool.
    return [];
  }
  return [
    { movementId: movement.id, accountId: from, signedAmount: -movement.amount, date: movement.date },
    { movementId: movement.id, accountId: to, signedAmount: movement.amount, date: movement.date },
  ];
}

/** Signed movement into/out of a specific account. */
export function amountForAccount(movement: CashMovement, accountId: string): number {
  const legs = accountLegs(movement).filter((leg) => leg.accountId === accountId);
  return legs.reduce((sum, leg) => sum + leg.signedAmount, 0);
}

/* ----------------------------------------------------------------- accounts */

export function cashAccountIds(accounts: Account[]): string[] {
  return accounts
    .filter(
      (account) =>
        !account.closed &&
        account.kind !== "credit_card" &&
        account.kind !== "loan" &&
        account.kind !== "savings_pot",
    )
    .map((account) => account.id);
}

/**
 * Accounts that can pay bills, in the order the user set. Savings pots are
 * excluded unless the user explicitly marks them `availableForBills`.
 */
export function payableAccounts(accounts: Account[]): { accountIds: string[]; activeAccountIds: string[]; excludedAccountIds: string[] } {
  const usable = accounts.filter((account) => !account.closed && account.kind !== "credit_card" && account.kind !== "loan");
  const active = usable.filter((account) => account.availableForBills);
  return {
    accountIds: usable.map((account) => account.id),
    activeAccountIds: active.map((account) => account.id),
    excludedAccountIds: usable.filter((account) => !account.availableForBills).map((account) => account.id),
  };
}

/**
 * Cash that counts for the reserve floor. Spendable = liquid accounts in use.
 * Savings pots count only when the user says they can be drawn on.
 */
export function spendableAccountIds(accounts: Account[], includeSavingsPots = false): string[] {
  return accounts
    .filter((account) => {
      if (account.closed) return false;
      if (account.kind === "credit_card" || account.kind === "loan") return false;
      if (account.kind === "savings_pot") return includeSavingsPots && account.includeInSpendable;
      return account.includeInSpendable;
    })
    .map((account) => account.id);
}

/** Account balance at `date`, from dated opening balances plus movements. */
export function accountBalance(
  account: Account,
  movements: CashMovement[],
  date: ISODate,
): number {
  let balance = account.openingDate <= date ? account.openingBalance : 0;
  for (const movement of movements) {
    if (movement.date > date) continue;
    if (isInternalMove(movement)) {
      for (const leg of accountLegs(movement)) {
        if (leg.accountId === account.id) balance += leg.signedAmount;
      }
    } else if (movement.accountId === account.id) {
      balance += movement.signedAmount;
    }
  }
  return balance;
}

/** Spendable cash across the chosen accounts at `date`. */
export function spendableBalance(
  accounts: Account[],
  movements: CashMovement[],
  date: ISODate,
  includeSavingsPots = false,
): number {
  const ids = new Set(spendableAccountIds(accounts, includeSavingsPots));
  return accounts
    .filter((account) => ids.has(account.id))
    .reduce((sum, account) => sum + accountBalance(account, movements, date), 0);
}

/**
 * TOTAL cash the user owns: every open cash-like account (bank, cash, wallet,
 * savings pots) regardless of the spendable flag. This is the quantity an
 * internal transfer must leave unchanged — credit cards and loans are
 * liabilities, not cash.
 */
export function totalCashBalance(
  accounts: Account[],
  movements: CashMovement[],
  date: ISODate,
): number {
  return accounts
    .filter((account) => !account.closed && account.kind !== "credit_card" && account.kind !== "loan")
    .reduce((sum, account) => sum + accountBalance(account, movements, date), 0);
}

/* ---------------------------------------------------------------- EMI / loan */

/** Expand an EMI schedule into dated instalments (and their count). */
export function emiInstalments(schedule: EmiSchedule): { date: ISODate; amount: number }[] {
  return schedule.instalmentDates
    .slice(0, schedule.totalInstalments)
    .map((date) => ({ date, amount: schedule.amount }));
}

/** Instalments of `schedule` falling inside [start, end]. */
export function emiCountInRange(schedule: EmiSchedule, start: ISODate, end: ISODate): number {
  return emiInstalments(schedule).filter((instalment) => betweenDates(instalment.date, start, end)).length;
}

/** Cash from a loan disbursement: increases cash, is not income. */
export function loanProceedsMovement(
  loan: Loan,
  transaction: LoanTransaction,
  accountId: string,
): CashMovement {
  return makeMovement({
    id: `loan-proceeds-${transaction.transactionId}`,
    date: transaction.date,
    label: `${loan.lender} loan disbursement`,
    amount: transaction.proceeds,
    kind: "loan_proceeds",
    accountId: loan.accountId || accountId,
    category: "Loan",
    origin: "derived",
  });
}

/** An EMI instalment: expense for the interest, liability down for the principal. */
export function emiMovement(
  loan: Loan,
  date: ISODate,
  amount: number,
  principal: number,
  id: string,
): CashMovement {
  return makeMovement({
    id,
    date,
    label: `${loan.lender} EMI`,
    amount,
    kind: "emi",
    direction: "expense",
    accountId: loan.accountId,
    category: "Loan EMI",
    note: principal > 0 ? `Principal ${Math.round(principal)} of ${Math.round(amount)}` : undefined,
    origin: "derived",
  });
}

/** Sum of interest portions of EMIs inside the range (a real expense). */
export function emiInterestInRange(
  loan: Loan,
  movements: CashMovement[],
): number {
  return movements
    .filter((movement) => movement.kind === "emi" && movement.label.startsWith(loan.lender))
    .reduce((sum, movement) => sum + interestPartOf(movement), 0);
}

function interestPartOf(movement: CashMovement): number {
  const match = /Principal\s+(\d+)\s+of\s+(\d+)/.exec(movement.note ?? "");
  if (!match) return movement.amount;
  return movement.amount - Number(match[1]);
}

/* ------------------------------------------------------------------ assets */

/**
 * Optional assets only ever enter the forecast on their planned sale date, and
 * only when the caller includes hypothetical movements.
 */
export function assetSaleMovements(assets: Asset[]): CashMovement[] {
  const out: CashMovement[] = [];
  for (const asset of assets) {
    if (!asset.sale) continue;
    out.push(
      makeMovement({
        id: `asset-sale-${asset.id}`,
        date: asset.sale.plannedDate,
        label: `${asset.name} sale`,
        amount: asset.sale.expectedProceeds,
        kind: "asset_sale",
        accountId: asset.sale.accountId,
        category: "Asset sale",
        status: "hypothetical",
        origin: "derived",
      }),
    );
  }
  return out;
}

export function assetValueAt(assets: Asset[], date: ISODate): number {
  return assets
    .filter((asset) => asset.valuedOn <= date && (!asset.sale || asset.sale.plannedDate > date))
    .reduce((sum, asset) => sum + asset.estimatedValue, 0);
}

/* ------------------------------------------------------- views for the UI */

export function movementView(movement: CashMovement): ForecastMovementView {
  return {
    ...movement,
    class: movementClass(movement),
    internal: isInternalMove(movement),
  };
}

export function summarizeInvoice(invoice: Invoice): string {
  return `${invoice.client} · ${invoice.expectedDate}`;
}

/* ---------------------------------------------------- forecast-only helpers */

/** Movements usable at `asOf`: observations dated after the cutoff are dropped. */
export function enforceCutoff(movements: CashMovement[], asOf: ISODate): {
  usable: CashMovement[];
  dropped: CashMovement[];
} {
  const usable: CashMovement[] = [];
  const dropped: CashMovement[] = [];
  for (const movement of movements) {
    if (movement.status === "actual" && movement.date > asOf) dropped.push(movement);
    else usable.push(movement);
  }
  return { usable, dropped };
}

/** Profile-level opening cash on the profile's opening date. */
export function profileOpeningCash(profile: UserProfile): number {
  if (profile.accounts.length === 0) return profile.openingBalance.amount;
  const ids = new Set(spendableAccountIds(profile.accounts));
  return profile.accounts
    .filter((account) => ids.has(account.id) && account.openingDate <= profile.openingBalance.date)
    .reduce((sum, account) => sum + account.openingBalance, 0);
}
