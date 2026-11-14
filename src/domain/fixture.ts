/**
 * Repeatable fictional demo fixture.
 *
 * Fully deterministic: no randomness, no `Date.now()`. Every date is derived
 * from `referenceDate`, so the same fixture year is reproducible.
 *
 * The scenario (all INR, all invented):
 *   Freelancer "Asha Rao", Bengaluru. Reference date 2026-06-15.
 *   Bank account B1 opened 2026-02-01 with ₹60,000.
 *   Monthly: salary retainer ₹45,000 (1st), rent ₹18,000 (5th),
 *   bike-loan EMI ₹3,200 (18th), broadband ₹999 (14th),
 *   credit-card bill ₹4,000 (22nd).
 *   Invoices: ₹40,000 expected 2026-06-20 (confirmed), ₹22,000 expected
 *   2026-06-10 (paid late on 2026-06-12 -> reconciliation case).
 *   Variable spending: small vouchers, estimated from history.
 *   Reserve: ₹50,000. Evaluation end: 2026-07-15.
 */
import type {
  Account,
  Asset,
  CashMovement,
  Invoice,
  ISODate,
  MerchantMemory,
  OneTimeCommitment,
  RecurringOverride,
  RecurringSeries,
  UserProfile,
} from "./contracts";
import { addMonths, makeMovement } from "./ledger";

export const DEMO_REFERENCE_DATE: ISODate = "2026-06-15";
export const DEMO_OPENING_DATE: ISODate = "2026-02-01";
export const DEMO_OPENING_BALANCE = 60_000;
export const DEMO_EVALUATION_END: ISODate = "2026-07-15";
export const DEMO_RESERVE = 50_000;

/* ------------------------------------------------------------------ accounts */

export function demoAccounts(): Account[] {
  return [
    {
      id: "B1",
      name: "HDFC Bank salary account",
      kind: "bank",
      openingBalance: DEMO_OPENING_BALANCE,
      openingDate: DEMO_OPENING_DATE,
      availableForBills: true,
      includeInSpendable: true,
    },
    {
      id: "P1",
      name: "Savings pot",
      kind: "savings_pot",
      openingBalance: 0,
      openingDate: DEMO_OPENING_DATE,
      availableForBills: false,
      includeInSpendable: false,
      note: "Emergency pot — moving money here is not spending.",
    },
    {
      id: "C1",
      name: "Credit card (bike loan auto-debit)",
      kind: "credit_card",
      openingBalance: 0,
      openingDate: DEMO_OPENING_DATE,
      availableForBills: false,
      includeInSpendable: false,
    },
  ];
}

export function demoProfile(): UserProfile {
  const assets: Asset[] = [
    {
      id: "A1",
      name: "Activa 6G",
      kind: "vehicle",
      estimatedValue: 65_000,
      valuedOn: DEMO_OPENING_DATE,
    },
  ];
  return {
    id: "demo-asof-asha",
    accounts: demoAccounts(),
    openingBalance: { amount: DEMO_OPENING_BALANCE, date: DEMO_OPENING_DATE },
    reserveAmount: DEMO_RESERVE,
    reserveDays: 30,
    incomeFloor: 40_000,
    currency: "INR",
    evaluationEnd: DEMO_EVALUATION_END,
    assets,
    loans: [
      {
        id: "L1",
        lender: "Bajaj Two-Wheeler Loan",
        accountId: "B1",
        principal: 96_000,
        outstanding: 96_000 - 3_200 * 4,
        annualRatePct: 11.5,
        emiSchedule: {
          id: "L1-emi",
          totalInstalments: 30,
          amount: 3_200,
          principalPerInstalment: 2_900,
          instalmentDates: demoMonthlyDates("2026-03-18", 6),
        },
        status: "active",
      },
    ],
  };
}

/* ---------------------------------------------------------------- schedules */

/** n monthly dates starting at `start`, keeping the same day-of-month. */
export function demoMonthlyDates(start: ISODate, count: number): ISODate[] {
  return Array.from({ length: count }, (_, index) => addMonths(start, index));
}

export function demoSeries(): RecurringSeries[] {
  return [
    {
      id: "S-salary",
      label: "Retainer invoice — Meridian Films",
      kind: "income",
      direction: "income",
      category: "Freelance",
      accountId: "B1",
      amount: 45_000,
      frequency: "monthly",
      startDate: "2026-02-01",
      nextDueDate: "2026-07-01",
      timingUncertainty: "low",
      dateFlexibility: "income_expected",
    },
    {
      id: "S-rent",
      label: "House rent — Indiranagar",
      kind: "expense",
      direction: "expense",
      category: "Rent",
      accountId: "B1",
      amount: 18_000,
      frequency: "monthly",
      startDate: "2026-02-05",
      nextDueDate: "2026-07-05",
      priority: "essential",
      dateFlexibility: "fixed",
    },
    {
      id: "S-emi",
      label: "Bajaj Two-Wheeler Loan EMI",
      kind: "emi",
      direction: "expense",
      category: "Loan EMI",
      accountId: "B1",
      amount: 3_200,
      frequency: "monthly",
      startDate: "2026-02-18",
      nextDueDate: "2026-07-18",
      priority: "important",
      dateFlexibility: "fixed",
    },
    {
      id: "S-broadband",
      label: "Airtel Fiber Broadband",
      kind: "expense",
      direction: "expense",
      category: "Utilities",
      accountId: "B1",
      amount: 999,
      frequency: "monthly",
      startDate: "2026-02-14",
      nextDueDate: "2026-07-14",
      priority: "important",
      dateFlexibility: "window",
      windowStart: "2026-07-14",
      windowEnd: "2026-07-18",
    },
    {
      id: "S-card",
      label: "Credit card bill",
      kind: "expense",
      direction: "expense",
      category: "Other",
      accountId: "B1",
      amount: 4_000,
      frequency: "monthly",
      startDate: "2026-02-22",
      nextDueDate: "2026-07-22",
      priority: "important",
      dateFlexibility: "fixed",
    },
    {
      id: "S-pot",
      label: "Transfer to savings pot",
      kind: "savings_pot",
      direction: "expense",
      category: "Savings",
      accountId: "B1",
      toAccountId: "P1",
      amount: 5_000,
      frequency: "monthly",
      startDate: "2026-02-25",
      nextDueDate: "2026-07-25",
    },
  ];
}

export function demoInvoices(): Invoice[] {
  return [
    {
      id: "INV-1001",
      client: "Kite Analytics",
      expectedAmount: 40_000,
      expectedDate: "2026-06-20",
      dueDate: "2026-06-22",
      accountId: "B1",
      category: "Freelance",
      issuedDate: "2026-06-01",
      status: "open",
      confirmed: true,
      timingUncertainty: "low",
      priority: "essential",
      note: "Confirmed by the client on 2026-06-04.",
    },
    {
      id: "INV-1002",
      client: "Nova Design Studio",
      expectedAmount: 22_000,
      expectedDate: "2026-06-10",
      dueDate: "2026-06-10",
      accountId: "B1",
      category: "Freelance",
      issuedDate: "2026-05-25",
      status: "open",
      confirmed: true,
      timingUncertainty: "medium",
      note: "Client confirmed the amount; paid late on the 12th (reconciliation case).",
    },
    {
      id: "INV-1003",
      client: "Bluebird Foods",
      expectedAmount: 18_000,
      expectedDate: "2026-06-30",
      accountId: "B1",
      category: "Freelance",
      issuedDate: "2026-06-10",
      status: "open",
      confirmed: false,
      timingUncertainty: "high",
      note: "Irregular client: only counted in 'include estimated irregular income' mode.",
    },
    {
      id: "INV-1004",
      client: "Harbour Texts",
      expectedAmount: 15_000,
      expectedDate: "2026-06-08",
      dueDate: "2026-06-08",
      accountId: "B1",
      category: "Freelance",
      issuedDate: "2026-05-20",
      status: "open",
      confirmed: true,
      timingUncertainty: "medium",
      note: "Past due and unpaid — must surface as a review item, never as cash.",
    },
  ];
}

export function demoCommitments(): OneTimeCommitment[] {
  return [
    {
      id: "CM-bike-service",
      label: "Bike service + insurance",
      amount: 4_500,
      date: "2026-06-28",
      accountId: "B1",
      category: "Transport",
      direction: "expense",
      priority: "discretionary",
      dateFlexibility: "window",
    },
  ];
}

/* ------------------------------------------------------- observed movements */

interface ObservedSpec {
  date: ISODate;
  label: string;
  amount: number;
  direction: "income" | "expense";
  kind: CashMovement["kind"];
  category: string;
  accountId?: string;
  toAccountId?: string;
  merchantKey?: string;
  recurring?: { seriesId: string; occurrenceDate: ISODate };
}

function observed(): ObservedSpec[] {
  const rows: ObservedSpec[] = [];
  const add = (spec: ObservedSpec) => rows.push(spec);

  // Monthly rhythm Feb..Jun, plus the July 1st retainer arriving on time.
  const months: ISODate[] = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  months.forEach((prefix) => {
    add({
      date: `${prefix}-01`,
      label: "Retainer invoice — Meridian Films",
      amount: 45_000,
      direction: "income",
      kind: "income",
      category: "Freelance",
      merchantKey: "meridian films",
      recurring: { seriesId: "S-salary", occurrenceDate: `${prefix}-01` },
    });
    add({
      date: `${prefix}-05`,
      label: "House rent — Indiranagar",
      amount: 18_000,
      direction: "expense",
      kind: "expense",
      category: "Rent",
      merchantKey: "house rent",
      recurring: { seriesId: "S-rent", occurrenceDate: `${prefix}-05` },
    });
    add({
      date: `${prefix}-14`,
      label: "Airtel Fiber Broadband",
      amount: 999,
      direction: "expense",
      kind: "expense",
      category: "Utilities",
      merchantKey: "airtel fiber",
      recurring: { seriesId: "S-broadband", occurrenceDate: `${prefix}-14` },
    });
    add({
      date: `${prefix}-18`,
      label: "Bajaj Two-Wheeler Loan EMI",
      amount: 3_200,
      direction: "expense",
      kind: "emi",
      category: "Loan EMI",
      merchantKey: "bajaj two wheeler",
      recurring: { seriesId: "S-emi", occurrenceDate: `${prefix}-18` },
    });
    add({
      date: `${prefix}-22`,
      label: "Credit card bill",
      amount: 4_000,
      direction: "expense",
      kind: "expense",
      category: "Other",
      merchantKey: "credit card",
      recurring: { seriesId: "S-card", occurrenceDate: `${prefix}-22` },
    });
    add({
      date: `${prefix}-25`,
      label: "Transfer to savings pot",
      amount: 5_000,
      direction: "expense",
      kind: "savings_pot",
      category: "Savings",
      accountId: "B1",
      toAccountId: "P1",
      merchantKey: "savings pot",
      recurring: { seriesId: "S-pot", occurrenceDate: `${prefix}-25` },
    });
  });

  // Small variable spending (deliberately irregular: groceries and chai).
  const variable: { date: ISODate; label: string; amount: number; category: string }[] = [
    { date: "2026-05-03", label: "BigBasket Order", amount: 1_240, category: "Groceries" },
    { date: "2026-05-09", label: "Third Wave Coffee", amount: 380, category: "Dining" },
    { date: "2026-05-16", label: "Uber Ride", amount: 210, category: "Transport" },
    { date: "2026-05-21", label: "BigBasket Order", amount: 1_060, category: "Groceries" },
    { date: "2026-05-29", label: "Zomato Order", amount: 540, category: "Dining" },
    { date: "2026-06-02", label: "BigBasket Order", amount: 1_180, category: "Groceries" },
    { date: "2026-06-08", label: "Third Wave Coffee", amount: 420, category: "Dining" },
    { date: "2026-06-11", label: "Uber Ride", amount: 260, category: "Transport" },
    { date: "2026-06-14", label: "BigBasket Order", amount: 980, category: "Groceries" },
  ];
  for (const row of variable) {
    add({
      date: row.date,
      label: row.label,
      amount: row.amount,
      direction: "expense",
      kind: "expense",
      category: row.category,
      merchantKey: row.label.toLowerCase().split(" ").slice(0, 2).join(" "),
    });
  }

  // Late invoice: expected 2026-06-10 (INV-1002), actually received 2026-06-12,
  // linked to the invoice so it is never counted twice.
  add({
    date: "2026-06-12",
    label: "Nova Design Studio invoice",
    amount: 22_000,
    direction: "income",
    kind: "income",
    category: "Freelance",
    merchantKey: "nova design",
  });

  // Loan proceeds: cash in, not income.
  add({
    date: "2026-03-02",
    label: "Bajaj Two-Wheeler Loan disbursement",
    amount: 96_000,
    direction: "income",
    kind: "loan_proceeds",
    category: "Loan",
    merchantKey: "bajaj disbursement",
  });

  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function demoMovements(): CashMovement[] {
  return observed().map((spec, index) =>
    makeMovement({
      id: `demo-tx-${String(index + 1).padStart(3, "0")}`,
      date: spec.date,
      label: spec.label,
      amount: spec.amount,
      kind: spec.kind,
      direction: spec.direction,
      accountId: spec.accountId ?? "B1",
      toAccountId: spec.toAccountId,
      category: spec.category,
      status: "actual",
      merchantKey: spec.merchantKey,
      recurring: spec.recurring,
      origin: "fixture",
    }),
  );
}

export const DEMO_MERCHANT_MEMORY: MerchantMemory = {
  categoryByMerchant: { "bigbasket order": "Groceries" },
  labelByMerchant: {},
  corrections: [],
};

export const DEMO_OVERRIDES: RecurringOverride[] = [
  { key: "expense:bajaj two wheeler", status: "confirmed", amount: 3_200, dayOfMonth: 18, priority: "important", dateFlexibility: "fixed" },
  { key: "expense:house rent", status: "confirmed", amount: 18_000, dayOfMonth: 5, priority: "essential", dateFlexibility: "fixed" },
];

export interface DemoFixture {
  referenceDate: ISODate;
  openingDate: ISODate;
  openingBalance: number;
  evaluationEnd: ISODate;
  reserve: number;
  profile: UserProfile;
  movements: CashMovement[];
  series: RecurringSeries[];
  invoices: Invoice[];
  commitments: OneTimeCommitment[];
  overrides: RecurringOverride[];
  merchantMemory: MerchantMemory;
  /** Hand-checkable expectations. Any drift is a bug. */
  expectations: typeof DEMO_EXPECTATIONS;
}

export function buildDemoFixture(): DemoFixture {
  return {
    referenceDate: DEMO_REFERENCE_DATE,
    openingDate: DEMO_OPENING_DATE,
    openingBalance: DEMO_OPENING_BALANCE,
    evaluationEnd: DEMO_EVALUATION_END,
    reserve: DEMO_RESERVE,
    profile: demoProfile(),
    movements: demoMovements(),
    series: demoSeries(),
    invoices: demoInvoices(),
    commitments: demoCommitments(),
    overrides: DEMO_OVERRIDES,
    merchantMemory: DEMO_MERCHANT_MEMORY,
    expectations: DEMO_EXPECTATIONS,
  };
}

/**
 * Hand-checkable case (worked out on paper, in rupees):
 *
 * Observed through 2026-06-15 (all actual movements on/before that date):
 *   60,000 opening (2026-02-01)
 *   + 45,000 retainer × 5 (Feb..Jun 1st)            = +225,000
 *   + 96,000 loan proceeds (2026-03-02)             = +96,000
 *   + 22,000 Nova Design invoice (2026-06-12)       = +22,000
 *   − 18,000 rent × 5 (Feb..Jun 5th)                = −90,000
 *   − 3,200 EMI × 5 (Feb..Jun 18th; Jun 18 is after the 15th) -> 4 × 3,200 = −12,800
 *   − 999 broadband × 5 (Feb..Jun 14th)             = −4,995
 *   − 4,000 card bill × 4 (Feb..May 22nd; Jun 22 after the 15th) = −16,000
 *   − 5,000 pot transfer × 4 (Feb..May 25th; Jun 25 after the 15th) = −20,000
 *   − variable Apr..Jun vouchers: 1,240+380+210+1,060+540+1,180+420+260+980 = −6,270
 *   = 60,000 + 343,000 − 150,065 = 252,935
 *
 * (The pot transfer and the card bill are internal/debt moves for the *cash*
 * total: the pot transfer leaves B1 but lands in P1, so spendable cash falls by
 * 20,000 while total cash is unchanged.)
 *
 * Expected from 2026-06-15 to 2026-07-15 (confirmed income only):
 *   + 45,000 retainer (2026-07-01)
 *   + 40,000 Kite Analytics invoice (2026-06-20, confirmed)
 *   − 18,000 rent (2026-07-05)
 *   − 3,200 EMI (2026-07-18 is outside the window; 2026-06-18 is inside) → −3,200 on 2026-06-18
 *   − 999 broadband (2026-07-14)
 *   − 4,000 card bill (2026-06-22)
 *   − 5,000 pot transfer × 2 (06-25, 07-25 outside) → −5,000 on 2026-06-25
 *   − 4,500 bike service (2026-06-28)
 *   Bluebird Foods (18,000, high uncertainty) is EXCLUDED in confirmed mode.
 *   The Nova (22,000) invoice is still "open" in the fixture but already paid
 *   through a linked actual movement, so reconciliation must not count it again.
 */
export const DEMO_EXPECTATIONS = {
  openingSpendable: 252_935,
  confirmedIncomeInWindow: 45_000 + 40_000,
  confirmedOutflowInWindow: 3_200 + 1_000 - 1 + 18_000 + 999 + 4_000 + 5_000 + 4_500,
  /** EMI counted exactly once in the window. */
  emiCountInWindow: 1,
  /** Nothing double-counted: the Nova invoice appears once, as an actual. */
  novaInvoiceActualCount: 1,
  /** Pot transfer: B1 down, P1 up, total cash unchanged. */
  potTransferAmount: 5_000,
  /** Room on 2026-06-20 shown in checks.ts once the forecast runs. */
  purchaseRoomDate: "2026-06-20" satisfies ISODate,
} as const;
