/**
 * Persisted workspace shape (v2) + migration from the v1 prototype.
 *
 * v2 keeps the user's own workspace and the demo workspace completely separate:
 * exploring the demo can never overwrite real records, and leaving the demo
 * restores exactly what you had. A refresh reopens whichever workspace you were in.
 */
import type {
  Asset,
  ExpectedItem,
  RecurringStatus,
  Scenario,
  Transaction,
  Transfer,
} from "../types";
import type { RecurrencePreferences } from "../integration/types";
import { buildDemoScenarios, buildDemoTransactions } from "../lib/demo";
import { addDays, todayISO } from "../lib/format";

export const STORAGE_V1 = "cashflow-compass:v1";
export const STORAGE_V2 = "cashflow-compass:v2";

export type WorkspaceId = "own" | "demo";

export interface WorkspaceState {
  id: WorkspaceId;
  /** Shown in the header so the current workspace is never ambiguous. */
  label: string;
  createdAt: string;
  openingBalance: number;
  openingDate: string;
  reserve: number;
  horizon: 30 | 60 | 90;
  transactions: Transaction[];
  transfers: Transfer[];
  expected: ExpectedItem[];
  assets: Asset[];
  scenarios: Scenario[];
  overrides: Record<string, RecurringStatus>;
  recurrencePrefs: Record<string, RecurrencePreferences>;
  merchantMemory: Record<string, string>;
  /** suggestion id -> what the user chose */
  suggestionDecisions: Record<string, string>;
  tourCompleted: boolean;
}

export interface PersistedV2 {
  version: 2;
  active: WorkspaceId;
  own: WorkspaceState;
  demo: WorkspaceState | null;
  /** Set when migration found rows it could not classify. */
  migrationNote: string | null;
  /** True once the first-run chooser has been answered. */
  onboarded: boolean;
}

function emptyWorkspace(id: WorkspaceId, label: string, today = todayISO()): WorkspaceState {
  return {
    id,
    label,
    createdAt: new Date().toISOString(),
    openingBalance: 0,
    openingDate: today,
    reserve: 0,
    horizon: 30,
    transactions: [],
    transfers: [],
    expected: [],
    assets: [],
    scenarios: [],
    overrides: {},
    recurrencePrefs: {},
    merchantMemory: {},
    suggestionDecisions: {},
    tourCompleted: false,
  };
}

export function emptyOwnWorkspace(today = todayISO()): WorkspaceState {
  return emptyWorkspace("own", "My workspace", today);
}

/**
 * The demo dataset, built from the shipped generator so amounts and dates match
 * the prototype screenshots. It lives in its own workspace slot.
 */
export function buildDemoWorkspace(today = todayISO()): WorkspaceState {
  const transactions = buildDemoTransactions(today).map((tx) => ({ ...tx, source: "demo" as const }));
  return {
    ...emptyWorkspace("demo", "Demo workspace", today),
    openingBalance: 95000,
    openingDate: today,
    reserve: 150000,
    horizon: 30,
    transactions,
    // Expected inflows the planner can defer. Without these the "if a client pays
    // late" stress test has nothing to move and the demo cannot show its effect.
    expected: buildDemoExpected(today),
    scenarios: buildDemoScenarios(),
    recurrencePrefs: {},
    overrides: {},
    merchantMemory: {},
    suggestionDecisions: {},
  };
}

/** Outstanding invoices in the demo, so a late payment can be simulated. */
export function buildDemoExpected(today = todayISO()): ExpectedItem[] {
  return [
    {
      id: "demo-exp-1",
      label: "Northwind invoice #241",
      amount: 62000,
      direction: "income",
      date: addDays(today, 6),
      certainty: "likely",
      kind: "invoice",
      category: "Freelance",
      source: "demo",
      note: "Net-30 invoice, the client has not paid yet.",
    },
    {
      id: "demo-exp-2",
      label: "Lumen Studio retainer",
      amount: 34000,
      direction: "income",
      date: addDays(today, 12),
      certainty: "confirmed",
      kind: "invoice",
      category: "Freelance",
      source: "demo",
      note: "Standing monthly retainer, usually on time.",
    },
  ];
}

interface LegacySession {
  version?: number;
  transactions?: Transaction[];
  scenarios?: Scenario[];
  settings?: {
    safetyThreshold?: number;
    openingBalance?: number;
    horizon?: 30 | 60 | 90;
  };
  overrides?: Record<string, RecurringStatus>;
  merchantMemory?: Record<string, string>;
  seededAt?: string | null;
}

export interface MigrationResult {
  data: PersistedV2;
  /** Human-readable summary shown once after upgrading. */
  note: string | null;
  /** How the existing rows were classified. */
  classification: "none" | "demo-only" | "mixed" | "own-only";
}

/** Classify existing rows so cleanup is only offered when it is clearly safe. */
export function classifyLegacy(transactions: Transaction[]): MigrationResult["classification"] {
  if (transactions.length === 0) return "none";
  const demo = transactions.filter((tx) => tx.source === "demo").length;
  if (demo === transactions.length) return "demo-only";
  if (demo > 0) return "mixed";
  return "own-only";
}

/**
 * Read v1 (or an older v2 draft) without data loss. Never deletes the v1 key:
 * it stays as a rollback copy until the user explicitly clears data.
 */
export function loadPersisted(today = todayISO()): PersistedV2 {
  const fresh: PersistedV2 = {
    version: 2,
    active: "own",
    own: emptyOwnWorkspace(today),
    demo: null,
    migrationNote: null,
    onboarded: false,
  };

  let rawV2: string | null = null;
  let rawV1: string | null = null;
  try {
    rawV2 = localStorage.getItem(STORAGE_V2);
    rawV1 = localStorage.getItem(STORAGE_V1);
  } catch {
    return fresh;
  }

  if (rawV2) {
    try {
      const parsed = JSON.parse(rawV2) as Partial<PersistedV2>;
      if (parsed && parsed.version === 2 && parsed.own) {
        return normalizeV2(parsed, today);
      }
    } catch (error) {
      console.warn("Saved v2 data could not be read; checking v1.", error);
    }
  }

  if (rawV1) {
    try {
      const legacy = JSON.parse(rawV1) as LegacySession;
      if (Array.isArray(legacy.transactions)) {
        return migrateV1(legacy, today).data;
      }
    } catch (error) {
      console.warn("Saved v1 data could not be read.", error);
    }
  }

  return fresh;
}

function normalizeV2(parsed: Partial<PersistedV2>, today: string): PersistedV2 {
  const own = { ...emptyOwnWorkspace(today), ...parsed.own } as WorkspaceState;
  const demo = parsed.demo ? ({ ...buildDemoWorkspace(today), ...parsed.demo } as WorkspaceState) : null;
  return {
    version: 2,
    active: parsed.active === "demo" && demo ? "demo" : "own",
    own: {
      ...own,
      id: "own",
      label: own.label || "My workspace",
      transactions: (own.transactions ?? []).filter(Boolean),
      transfers: own.transfers ?? [],
      expected: own.expected ?? [],
      assets: own.assets ?? [],
      scenarios: own.scenarios ?? [],
      overrides: own.overrides ?? {},
      recurrencePrefs: own.recurrencePrefs ?? {},
      merchantMemory: own.merchantMemory ?? {},
      suggestionDecisions: own.suggestionDecisions ?? {},
    },
    demo,
    migrationNote: parsed.migrationNote ?? null,
    onboarded: Boolean(parsed.onboarded),
  };
}

/**
 * v1 → v2. Keeps every saved record. Known demo rows (source === "demo") are
 * moved into the demo workspace when the dataset is purely demo data, and kept
 * in place (with a note) when the dataset is mixed.
 */
export function migrateV1(legacy: LegacySession, today = todayISO()): MigrationResult {
  const transactions = (legacy.transactions ?? []).filter(Boolean);
  const classification = classifyLegacy(transactions);
  const settings = legacy.settings ?? {};
  const own = emptyOwnWorkspace(today);
  own.openingBalance = settings.openingBalance ?? 0;
  own.reserve = settings.safetyThreshold ?? 0;
  own.horizon = settings.horizon ?? 30;
  own.overrides = legacy.overrides ?? {};
  own.merchantMemory = legacy.merchantMemory ?? {};
  own.scenarios = Array.isArray(legacy.scenarios) ? legacy.scenarios : [];

  let demo: WorkspaceState | null = null;
  let note: string | null = null;

  if (classification === "demo-only") {
    demo = { ...buildDemoWorkspace(today), transactions };
    note =
      "Your saved prototype data was only the sample dataset, so it now lives in the Demo workspace. Your own workspace starts empty.";
  } else {
    own.transactions = transactions;
    if (classification === "mixed") {
      const demoRows = transactions.filter((tx) => tx.source === "demo").length;
      note = `Everything you saved was kept. ${demoRows} of ${transactions.length} rows look like sample data — open Settings to move them out later.`;
    } else if (classification === "own-only") {
      note = `${transactions.length} saved transaction${transactions.length === 1 ? "" : "s"} were kept.`;
    }
  }

  return {
    data: {
      version: 2,
      active: "own",
      own,
      demo,
      migrationNote: note,
      onboarded: classification !== "none",
    },
    note,
    classification,
  };
}
