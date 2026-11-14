/**
 * Description normalization, category suggestions (with remembered
 * corrections) and recurring-payment detection that produces review
 * proposals rather than silent schedule changes.
 */
import type {
  CashMovement,
  CategorySuggestion,
  Direction,
  Frequency,
  ISODate,
  MerchantMemory,
  NormalizedDescription,
  RecurringDetectionResult,
  RecurringEvidence,
  RecurringOverride,
  RecurringProposal,
  ScheduleSuggestion,
} from "./contracts";
import { addDays, advanceByFrequency, daysBetween, frequencyDays } from "./ledger";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  normalizeMerchant,
  suggestCategory,
} from "../lib/categorize";
import { clamp, daysLabel, median, money, parseISO, stdDev, toISO } from "../lib/format";

/* --------------------------------------------------------- normalization */

const NOISE_TOKENS =
  /\b(upi|neft|imps|rtgs|pos|ref|refno|txn|transaction|payment|paid|paidto|to|from|via|order|online|pvt|ltd|limited|the|and|of|for|ac|a\/c|no|id|autopay|auto|debit|credit|bill|charges?|bank|transfer|inward|outward|mob|ib|ach|nach|trf|dr|cr)\b/g;

const ID_PATTERNS = [
  /\b\d{8,}\b/g, // long reference numbers
  /\b[a-z]{2,}\d{4,}\b/g, // REF1234 style ids
  /\b\d{4,}[a-z]{2,}\b/g,
];

/**
 * Turn a raw statement narration into a stable merchant key.
 * "UPI/PAIDTO/ZOMATO LTD/REF 4455123" -> merchantKey "zomato", removed tokens listed.
 */
export function normalizeDescription(raw: string): NormalizedDescription {
  const removed: string[] = [];
  const safeRaw = typeof raw === "string" ? raw : "";
  const lower = safeRaw.toLowerCase();
  const scrub = (input: string, pattern: RegExp) => {
    let value = input;
    const matches = value.match(pattern);
    if (matches) {
      for (const match of matches) {
        const token = match.trim();
        if (token && !removed.includes(token)) removed.push(token);
      }
      value = value.replace(pattern, " ");
    }
    return value;
  };

  let working = lower;
  for (const pattern of ID_PATTERNS) working = scrub(working, pattern);
  working = working.replace(/[^a-z\s]/g, " ");
  working = scrub(working, NOISE_TOKENS);

  const words = working.split(/\s+/).filter(Boolean);
  const merchantKey = words.slice(0, 2).join(" ") || lower.replace(/[^a-z]/g, "").slice(0, 12);
  const merchant = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return { raw: safeRaw, merchantKey, merchant: merchant || safeRaw.trim(), removed };
}

/** Learnable merchant key that keeps the existing `normalizeMerchant` behaviour for compat. */
export function merchantKeyOf(description: string): string {
  return normalizeMerchant(description);
}

/* ------------------------------------------------------------ categories */

/** Remembered corrections beat rules; corrections are scoped to direction. */
export function suggestCategoryFor(
  description: string,
  direction: Direction,
  memory: MerchantMemory = { categoryByMerchant: {}, labelByMerchant: {}, corrections: [] },
): CategorySuggestion {
  const merchantKey = merchantKeyOf(description);
  const remembered = memory.categoryByMerchant[merchantKey];
  const allowed: readonly string[] = direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (remembered && allowed.includes(remembered)) {
    return { category: remembered, source: "memory", merchantKey, confidence: 0.99 };
  }
  const ruled = suggestCategory(description, direction, memory.categoryByMerchant);
  const isRule = ruled !== (direction === "income" ? "Other Income" : "Other");
  return {
    category: ruled,
    source: isRule ? "rule" : "default",
    merchantKey,
    confidence: isRule ? 0.7 : 0.25,
  };
}

/** Record a user correction so later imports reuse it. Returns a new memory object. */
export function rememberCorrection(
  memory: MerchantMemory,
  description: string,
  correction: { category?: string; label?: string; at?: string },
): MerchantMemory {
  const merchantKey = merchantKeyOf(description);
  const next: MerchantMemory = {
    categoryByMerchant: { ...memory.categoryByMerchant },
    labelByMerchant: { ...memory.labelByMerchant },
    corrections: [...(memory.corrections ?? [])],
  };
  if (correction.category) next.categoryByMerchant[merchantKey] = correction.category;
  if (correction.label) next.labelByMerchant[merchantKey] = correction.label;
  next.corrections.push({
    at: correction.at ?? new Date().toISOString(),
    merchantKey,
    category: correction.category,
    label: correction.label,
  });
  return next;
}

/** Apply remembered corrections to a batch (e.g. fresh CSV import rows). */
export function applyMemory(
  movements: CashMovement[],
  memory: MerchantMemory,
): CashMovement[] {
  if (!memory || Object.keys(memory.categoryByMerchant).length === 0) return movements;
  return movements.map((movement) => {
    const key = movement.merchantKey ?? merchantKeyOf(movement.label);
    const remembered = memory.categoryByMerchant[key];
    const label = memory.labelByMerchant[key];
    return {
      ...movement,
      merchantKey: key,
      category: remembered ?? movement.category,
      label: label ?? movement.label,
    };
  });
}

/* ------------------------------------------------------------- detection */

interface DetectorOptions {
  /** Observations after this date are ignored (holdout isolation). */
  asOf: ISODate;
  /** How far back to look. */
  lookbackDays?: number;
  /** Minimum occurrences needed before a pattern is proposed. */
  minOccurrences?: number;
  overrides?: RecurringOverride[];
  /** Expected dates that already have no matching actual (for "missing" flags). */
  scheduledOccurrences?: { seriesId: string; occurrenceDate: ISODate }[];
}

function frequencyForInterval(intervalDays: number): Frequency | null {
  if (intervalDays >= 5 && intervalDays <= 9) return "weekly";
  if (intervalDays >= 12 && intervalDays <= 17) return "biweekly";
  if (intervalDays >= 25 && intervalDays <= 36) return "monthly";
  if (intervalDays >= 80 && intervalDays <= 103) return "quarterly";
  if (intervalDays >= 165 && intervalDays <= 202) return "half-yearly";
  if (intervalDays >= 340 && intervalDays <= 392) return "yearly";
  return null;
}

function toleranceFor(intervalDays: number): number {
  if (intervalDays <= 9) return 2;
  if (intervalDays <= 17) return 3;
  if (intervalDays <= 36) return 5;
  if (intervalDays <= 103) return 12;
  return 30;
}

const ORDINAL = (day: number): string => {
  const last = day % 10;
  const teen = day % 100;
  if (last === 1 && teen !== 11) return "1st";
  if (last === 2 && teen !== 12) return "2nd";
  if (last === 3 && teen !== 13) return "3rd";
  return `${day}th`;
};

const FREQ_WORD: Record<Frequency, string> = {
  weekly: "week",
  biweekly: "two weeks",
  monthly: "month",
  quarterly: "quarter",
  "half-yearly": "six months",
  yearly: "year",
};

function buildReason(
  direction: Direction,
  merchant: string,
  typicalAmount: number,
  dates: ISODate[],
  frequency: Frequency,
  nextDate: ISODate,
): string {
  const days = dates.map((date) => parseISO(date).getDate());
  const day = median(days);
  const subject = direction === "income" ? "received" : "paid";
  const payer = direction === "income" ? `from ${merchant}` : `to ${merchant}`;
  const dayLabel = `${ORDINAL(Math.round(day))}`;
  const count = dates.length;
  return `You ${subject} ${money(typicalAmount)} ${payer} on the ${dayLabel} in ${count} consecutive ${
    FREQ_WORD[frequency]
  }${frequency === "monthly" ? "s" : "s"}. Add next ${
    FREQ_WORD[frequency]
  }’s payment? Next expected ${nextDate} (${daysLabel(daysBetween(dates[dates.length - 1], nextDate))} after the last one).`;
}

/**
 * Detect repeated outgoing and incoming payments.
 *
 * This NEVER changes a schedule on its own: it returns suggestions and
 * proposals for the user to confirm, edit, dismiss, pause or end.
 */
export function detectRecurringSuggestions(
  movements: CashMovement[],
  options: DetectorOptions,
): RecurringDetectionResult {
  const { lookbackDays = 400, minOccurrences = 3, overrides = [] } = options;
  // A missing or malformed cutoff must not take the whole app down: fall back to
  // the latest movement date, then to today.
  const latestDate = movements.reduce<string>(
    (latest, movement) => (movement.date > latest ? movement.date : latest),
    "",
  );
  const asOf =
    typeof options.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.asOf)
      ? options.asOf
      : latestDate || toISO(new Date());
  const overrideByKey = new Map(overrides.map((override) => [override.key, override]));
  const windowStart = addDays(asOf, -lookbackDays);

  const actual = movements.filter(
    (movement) =>
      movement.status === "actual" &&
      movement.date <= asOf &&
      movement.date >= windowStart &&
      movement.kind !== "transfer" &&
      movement.kind !== "savings_pot" &&
      movement.kind !== "loan_proceeds" &&
      movement.amount > 0,
  );

  const groups = new Map<string, CashMovement[]>();
  for (const movement of actual) {
    const direction: Direction = movement.sign > 0 ? "income" : "expense";
    const key = `${direction}:${movement.merchantKey ?? merchantKeyOf(movement.label)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(movement);
    else groups.set(key, [movement]);
  }

  const suggestions: ScheduleSuggestion[] = [];
  const proposals: RecurringProposal[] = [];

  for (const [key, raw] of groups) {
    if (raw.length < minOccurrences) continue;
    const sorted = [...raw].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const dates = sorted.map((movement) => movement.date);
    const amounts = sorted.map((movement) => movement.amount);
    const gaps = dates.slice(1).map((date, index) => daysBetween(dates[index], date)).filter((gap) => gap > 0);
    if (gaps.length === 0) continue;

    const interval = median(gaps);
    const frequency = frequencyForInterval(interval);
    if (!frequency) continue;
    const tolerance = toleranceFor(interval);
    const regularShare =
      gaps.filter((gap) => Math.abs(gap - interval) <= tolerance).length / gaps.length;
    if (regularShare < 0.6) continue;

    const typicalAmount = Math.round(median(amounts));
    const mean = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
    const cv = mean > 0 ? stdDev(amounts) / mean : 0;
    // Amounts must be stable enough to be a plan, not everyday spending.
    // Weekly groceries vary; EMIs, rent and salaries do not.
    const stableEnough = cv <= 0.25 || frequency === "monthly";
    if (!stableEnough) continue;

    const lastDate = dates[dates.length - 1];
    const nextExpectedDate = advanceByFrequency(lastDate, frequency);
    const direction = sorted[0].sign > 0 ? "income" : "expense";
    const confidence = clamp(
      0.35 + 0.3 * regularShare + 0.25 * clamp(1 - cv, 0, 1) + 0.1 * clamp((sorted.length - 2) / 4, 0, 1),
      0,
      0.99,
    );
    const label = sorted[sorted.length - 1].label;
    const merchant = normalizeDescription(label).merchant;
    const evidence: RecurringEvidence = {
      observedDates: dates.slice(-6),
      observedAmounts: amounts.slice(-6),
      typicalAmount,
      frequency,
      intervalDays: interval,
      nextExpectedDate,
      occurrences: sorted.length,
      confidence,
      reason: buildReason(direction, merchant, typicalAmount, dates.slice(-6), frequency, nextExpectedDate),
    };

    const override = overrideByKey.get(key);
    if (override?.status === "dismissed" || override?.status === "ended") continue;

    const suggestion: ScheduleSuggestion = {
      id: `sug-${key.replace(/[^a-z0-9]/gi, "-")}`,
      merchantKey: key,
      label,
      direction,
      kind: direction === "income" ? "income" : sorted[0].kind,
      category: sorted[sorted.length - 1].category,
      accountId: sorted[sorted.length - 1].accountId,
      typicalAmount,
      frequency: override?.frequency ?? frequency,
      intervalDays: interval,
      nextExpectedDate,
      observedDates: dates,
      observedAmounts: amounts,
      occurrences: sorted.length,
      confidence,
      reason: evidence.reason,
      action: override?.status === "confirmed" ? "confirm" : "review",
    };
    suggestions.push(suggestion);

    if (override?.status === "confirmed" || override?.status === "paused") continue;

    const dayOfMonth = override?.dayOfMonth ?? parseISO(nextExpectedDate).getDate();
    proposals.push({
      id: `prop-${key.replace(/[^a-z0-9]/gi, "-")}`,
      key,
      label: override?.category ?? label,
      merchantKey: key,
      kind: direction === "income" ? "invoice" : "expense",
      direction,
      category: override?.category ?? suggestion.category,
      accountId: suggestion.accountId,
      amount: override?.amount ?? typicalAmount,
      frequency: suggestion.frequency,
      suggestedDate: nextExpectedDate,
      draft: {
        key,
        status: "proposed",
        frequency: suggestion.frequency,
        dayOfMonth,
        startDate: override?.startDate ?? nextExpectedDate,
        endDate: override?.endDate,
        amount: override?.amount ?? typicalAmount,
        category: override?.category ?? suggestion.category,
        priority: override?.priority ?? (direction === "income" ? undefined : "important"),
        dateFlexibility: override?.dateFlexibility ?? (direction === "income" ? "income_expected" : "fixed"),
        timingUncertainty: override?.timingUncertainty ?? (direction === "income" ? "medium" : "low"),
      },
      evidence,
      status: "proposed",
    });
  }

  proposals.sort((a, b) => a.suggestedDate.localeCompare(b.suggestedDate));
  suggestions.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  return { suggestions, proposals };
}

/**
 * Turn a confirmed override into a concrete recurring series. Frequency,
 * approximate date, start/end, timing uncertainty and priority are all
 * captured here — and priority stays independent of date flexibility.
 */
export function seriesFromOverride(
  override: RecurringOverride,
  suggestion: ScheduleSuggestion,
  id = `series-${override.key.replace(/[^a-z0-9]/gi, "-")}`,
): import("./contracts").RecurringSeries {
  const frequency = override.frequency ?? suggestion.frequency;
  const start = override.startDate ?? suggestion.nextExpectedDate;
  const day = override.dayOfMonth ?? parseISO(start).getDate();
  const anchor = alignToDayOfMonth(start, day);
  return {
    id,
    label: suggestion.label,
    kind: suggestion.direction === "income" ? "income" : suggestion.kind === "emi" ? "emi" : "expense",
    direction: suggestion.direction,
    category: override.category ?? suggestion.category,
    accountId: suggestion.accountId,
    amount: override.amount ?? suggestion.typicalAmount,
    frequency,
    startDate: anchor,
    endDate: override.endDate,
    nextDueDate: anchor,
    priority: override.priority ?? (suggestion.direction === "expense" ? "important" : undefined),
    dateFlexibility: override.dateFlexibility ?? (suggestion.direction === "income" ? "income_expected" : "fixed"),
    timingUncertainty: override.timingUncertainty ?? "low",
    windowStart: override.windowStart,
    windowEnd: override.windowEnd,
    paused: override.status === "paused",
    evidence: suggestion,
    // Minimal evidence record so a merged series can always explain itself.
    // (ScheduleSuggestion already carries observed dates/amounts/typical/cadence.)
  };
}

/** Move a date to the requested day-of-month (clamped to short months). */
export function alignToDayOfMonth(date: ISODate, dayOfMonth: number): ISODate {
  const parsed = parseISO(date);
  const lastDay = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0).getDate();
  parsed.setDate(Math.min(dayOfMonth, lastDay));
  return `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, "0")}-${`${parsed.getDate()}`.padStart(2, "0")}`;
}

/** Monthly equivalent, for "≈ ₹x/month" copy. */
export function monthlyEquivalentAmount(amount: number, frequency: Frequency): number {
  return amount * (30.44 / frequencyDays(frequency));
}
