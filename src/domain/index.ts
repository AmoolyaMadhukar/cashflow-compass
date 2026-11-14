/**
 * Public surface for CashFlow Compass financial logic (Person 1).
 *
 * Import from `src/domain` — never from the individual modules — so Person 2
 * (`src/features/planner/`) and Person 3 (store/screens) get a stable API.
 */

/* ---------------------------------------------------------------- contracts */
export type * from "./contracts";

/* -------------------------------------------------------------------- ledger */
export {
  DAY_MS,
  Z_80,
  addDays,
  addMonths,
  accountBalance,
  accountLegs,
  amountForAccount,
  assetSaleMovements,
  assetValueAt,
  advanceByFrequency,
  betweenDates,
  cashAccountIds,
  compareByDate,
  daysBetween,
  eachDay,
  emiCountInRange,
  emiInstalments,
  emiMovement,
  enforceCutoff,
  frequencyDays,
  isEarnedIncomeKinds,
  isISODate,
  isInternalMove,
  isTransferConserving,
  loanProceedsMovement,
  makeMovement,
  movementClass,
  movementView,
  payableAccounts,
  profileOpeningCash,
  seriesOccurrences,
  signedAmountOf,
  spendableAccountIds,
  spendableBalance,
  totalCashBalance,
  summarizeInvoice,
  windowRange,
} from "./ledger";

/* ----------------------------------------------------------------- recurring */
export {
  alignToDayOfMonth,
  applyMemory,
  detectRecurringSuggestions,
  merchantKeyOf,
  monthlyEquivalentAmount,
  normalizeDescription,
  rememberCorrection,
  seriesFromOverride,
  suggestCategoryFor,
} from "./recurring";

/* -------------------------------------------------------------- forecasting */
export {
  buildForecast,
  extraRoomForPurchase,
  extraRoomFromProjection,
} from "./forecast";
export type { ForecastInput } from "./forecast";

/* ----------------------------------------------------------- reconciliation */
export {
  confirmOccurrenceAsActual,
  describeMatch,
  dueExpected,
  linkActualToExpected,
  matchScore,
  reconcile,
} from "./reconciliation";
export type { ReconcileOptions } from "./reconciliation";

/* ----------------------------------------------------------------- spending */
export {
  daysInRange,
  periodSummary,
  resolveRange,
  variableSpendingBudget,
} from "./spending";
export type { PeriodSummary, RangePreset } from "./spending";

/* ---------------------------------------------------------------- anomalies */
export { actionsFor, detectUnusualChanges } from "./anomalies";
export type { AnomalyOptions } from "./anomalies";

/* ------------------------------------------------------------------ quality */
export {
  evaluateForecastQuality,
  forecastAsOf,
  holdoutAvailability,
} from "./quality";
export type { QualityInput } from "./quality";

/* ------------------------------------------------------------------ fixture */
export {
  buildDemoFixture,
  DEMO_EVALUATION_END,
  DEMO_EXPECTATIONS,
  DEMO_MERCHANT_MEMORY,
  DEMO_OPENING_BALANCE,
  DEMO_OPENING_DATE,
  DEMO_OVERRIDES,
  DEMO_REFERENCE_DATE,
  DEMO_RESERVE,
  demoAccounts,
  demoCommitments,
  demoInvoices,
  demoMovements,
  demoMonthlyDates,
  demoProfile,
  demoSeries,
} from "./fixture";
export type { DemoFixture } from "./fixture";

/* ------------------------------------------------------------- net worth */
export { netWorthAsOf } from "./networth";

/* --------------------------------------------------- legacy bridge (compat) */
export {
  buildLegacyForecast,
  contractsToLegacyRecurring,
  fromLegacyTransactions,
  legacyRecurringStatusToOverride,
  settingsToLegacyProfile,
} from "./legacy";
