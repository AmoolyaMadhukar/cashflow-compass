import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Asset,
  ExpectedItem,
  Page,
  RecurringStatus,
  Scenario,
  Settings,
  Transaction,
  Transfer,
} from "./types";
import { addDays, todayISO, uid } from "./lib/format";
import {
  buildBaselineForecast,
  buildRecommendations,
  buildSuggestions,
  buildWorkspaceForecast,
  cashToday,
  detectAnomalies,
  measureReliability,
  monthlySeries,
  proposeReconciliations,
  recognizeRecurring,
  roomForPurchase,
  runBacktest,
  savingsToday,
  settingsFor,
  subscriptionSummary,
} from "./integration/services";
import type { RecurrencePreferences, Suggestion } from "./integration/types";
import { replayDecisions } from "./integration/replay";
import type { DecisionReplay } from "./integration/types";
import {
  buildDemoWorkspace,
  emptyOwnWorkspace,
  loadPersisted,
  STORAGE_V2,
  type PersistedV2,
  type WorkspaceId,
  type WorkspaceState,
} from "./store/schema";
import { normalizeMerchant } from "./lib/categorize";

/** A single undoable action surfaced in the toast bar. */
interface UndoAction {
  label: string;
  run: () => void;
}

interface AppContextValue {
  today: string;
  workspaceId: WorkspaceId;
  workspace: WorkspaceState;
  workspaces: { id: WorkspaceId; label: string; exists: boolean; count: number }[];
  demoAvailable: boolean;
  onboarded: boolean;
  migrationNote: string | null;
  isDemo: boolean;
  /** Person 1 engine status, used to mark fixture-backed integration in the UI. */

  transactions: Transaction[];
  expected: ExpectedItem[];
  transfers: Transfer[];
  assets: Asset[];
  merchantMemory: Record<string, string>;
  scenarios: Scenario[];
  settings: Settings;
  reserve: number;
  horizon: 30 | 60 | 90;

  cashToday: number;
  savingsToday: number;
  recurring: ReturnType<typeof recognizeRecurring>;
  forecast: ReturnType<typeof buildWorkspaceForecast>;
  baseline: ReturnType<typeof buildWorkspaceForecast>;
  /** Rebuild the forecast over a longer horizon (used by the planner). */
  buildForecast: (horizonDays: number) => ReturnType<typeof buildWorkspaceForecast>;
  /** Alias kept for Person 2's planner mount. */
  baselineForecast: ReturnType<typeof buildWorkspaceForecast>;
  isDemoData: boolean;
  suggestions: Suggestion[];
  reconciliation: ReturnType<typeof proposeReconciliations>;
  reliability: ReturnType<typeof measureReliability>;
  replay: DecisionReplay[];
  backtest: ReturnType<typeof runBacktest>;
  room: { room: number; untilDate: string; perDay: number };
  anomalies: ReturnType<typeof detectAnomalies>;
  recommendations: ReturnType<typeof buildRecommendations>;
  subscriptions: ReturnType<typeof subscriptionSummary>;
  monthly: ReturnType<typeof monthlySeries>;

  toast: string | null;
  undo: UndoAction | null;
  notify: (message: string, undo?: UndoAction) => void;

  addTransaction: (tx: Omit<Transaction, "id" | "source">) => string;
  importTransactions: (
    rows: Omit<Transaction, "id" | "source">[],
    mode: "append" | "replace",
  ) => number;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  setCategory: (id: string, category: string) => void;

  addTransfer: (transfer: Omit<Transfer, "id" | "source">) => void;
  deleteTransfer: (id: string) => void;
  addExpected: (item: Omit<ExpectedItem, "id" | "source">) => void;
  deleteExpected: (id: string) => void;
  matchExpected: (expectedId: string, transactionId: string) => void;
  addAsset: (asset: Omit<Asset, "id">) => void;
  deleteAsset: (id: string) => void;

  addScenario: (scenario: Omit<Scenario, "id" | "active">) => string;
  updateScenario: (id: string, patch: Partial<Scenario>) => void;
  deleteScenario: (id: string) => void;
  setScenarioActive: (id: string, active: boolean) => void;

  setRecurringStatus: (key: string, status: RecurringStatus | null) => void;
  setRecurrencePrefs: (key: string, patch: Partial<RecurrencePreferences>) => void;
  decideSuggestion: (id: string, decision: string) => void;

  updateSettings: (patch: Partial<Settings>) => void;
  setOpening: (amount: number, date: string) => void;
  setReserve: (amount: number) => void;
  setHorizon: (horizon: 30 | 60 | 90) => void;

  beginFresh: () => void;
  openDemo: (options?: { force?: boolean }) => void;
  leaveDemo: () => void;
  switchWorkspace: (id: WorkspaceId) => void;
  completeOnboarding: () => void;
  dismissMigrationNote: () => void;
  clearOwnData: () => void;
  moveDemoRowsOut: () => void;
  markTourCompleted: () => void;

  page: Page;
  setPage: (page: Page) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  tour: TourState;
  startTour: () => void;
  stopTour: () => void;
  tourStep: number;
  setTourStep: (step: number) => void;
}

export interface TourState {
  active: boolean;
  step: number;
  /** Snapshot of the workspace id we must return to when the tour ends. */
  returnTo: WorkspaceId;
}

const AppContext = createContext<AppContextValue | null>(null);

const TOUR_STEPS = 5;
export const TOUR_TOTAL = TOUR_STEPS;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [persisted, setPersisted] = useState<PersistedV2>(() => loadPersisted());
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [helpOpen, setHelpOpen] = useState(false);
  const [tour, setTour] = useState<TourState>({ active: false, step: 0, returnTo: "own" });
  const tourReturn = useRef<WorkspaceId>("own");

  const today = todayISO();
  const activeId = persisted.active;
  const workspace = activeId === "demo" && persisted.demo ? persisted.demo : persisted.own;
  const isDemo = activeId === "demo" && Boolean(persisted.demo);

  /* ---------------------------------- init --------------------------------- */

  useEffect(() => {
    if (persisted.demo) return;
    // Demo data is built lazily on first "Explore demo" to keep storage small.
  }, [persisted.demo]);

  /* -------------------------------- save v2 -------------------------------- */

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_V2, JSON.stringify(persisted));
    } catch (error) {
      console.warn("Could not save to localStorage.", error);
      setToast("Could not save to this browser. Export a CSV to keep a copy.");
    }
  }, [persisted]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
      setUndo(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = useCallback((message: string, undoAction?: UndoAction) => {
    setToast(message);
    setUndo(undoAction ?? null);
  }, []);

  /* ------------------------------ workspace ops ---------------------------- */

  const updateWorkspace = useCallback(
    (updater: (ws: WorkspaceState) => WorkspaceState) => {
      setPersisted((prev) => {
        const targetId = prev.active === "demo" && prev.demo ? "demo" : "own";
        if (targetId === "demo" && prev.demo) {
          return { ...prev, demo: updater(prev.demo) };
        }
        return { ...prev, own: updater(prev.own) };
      });
    },
    [],
  );

  /* --------------------------------- ledger -------------------------------- */

  const addTransaction = useCallback(
    (tx: Omit<Transaction, "id" | "source">) => {
      const id = uid("tx");
      updateWorkspace((ws) => ({
        ...ws,
        transactions: [
          ...ws.transactions,
          { ...tx, id, source: "manual", createdAt: new Date().toISOString() },
        ],
      }));
      notify(
        `${tx.direction === "income" ? "Money in" : "Money out"} recorded: ${tx.description}.`,
        {
          label: "Undo",
          run: () => updateWorkspace((ws) => ({ ...ws, transactions: ws.transactions.filter((row) => row.id !== id) })),
        },
      );
      return id;
    },
    [notify, updateWorkspace],
  );

  const importTransactions = useCallback(
    (rows: Omit<Transaction, "id" | "source">[], mode: "append" | "replace") => {
      const stamped = rows.map((row, index) => ({
        ...row,
        id: `imp_${Date.now().toString(36)}_${index}`,
        source: "import" as const,
        createdAt: new Date().toISOString(),
      }));
      let previous: Transaction[] = [];
      updateWorkspace((ws) => {
        previous = ws.transactions;
        return {
          ...ws,
          transactions: mode === "replace" ? stamped : [...ws.transactions, ...stamped],
          merchantMemory: ws.merchantMemory,
        };
      });
      notify(
        `${stamped.length} transaction${stamped.length === 1 ? "" : "s"} imported. Forecast updated.`,
        {
          label: "Undo import",
          run: () => updateWorkspace((ws) => ({ ...ws, transactions: previous })),
        },
      );
      return stamped.length;
    },
    [notify, updateWorkspace],
  );

  const updateTransaction = useCallback(
    (id: string, patch: Partial<Transaction>) => {
      updateWorkspace((ws) => ({
        ...ws,
        transactions: ws.transactions.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx)),
      }));
    },
    [updateWorkspace],
  );

  const deleteTransaction = useCallback(
    (id: string) => {
      let removed: Transaction | undefined;
      updateWorkspace((ws) => {
        removed = ws.transactions.find((tx) => tx.id === id);
        return { ...ws, transactions: ws.transactions.filter((tx) => tx.id !== id) };
      });
      notify("Entry deleted. Forecast recalculated.", {
        label: "Undo",
        run: () => {
          if (!removed) return;
          const restore = removed;
          updateWorkspace((ws) => ({ ...ws, transactions: [...ws.transactions, restore] }));
        },
      });
    },
    [notify, updateWorkspace],
  );

  const setCategory = useCallback(
    (id: string, category: string) => {
      updateWorkspace((ws) => {
        const target = ws.transactions.find((tx) => tx.id === id);
        return {
          ...ws,
          transactions: ws.transactions.map((tx) => (tx.id === id ? { ...tx, category } : tx)),
          merchantMemory: target
            ? { ...ws.merchantMemory, [normalizeMerchant(target.description)]: category }
            : ws.merchantMemory,
        };
      });
      notify("Category saved — similar imports will use it.");
    },
    [notify, updateWorkspace],
  );

  /* ------------------------- transfers / expectations ---------------------- */

  const addTransfer = useCallback(
    (transfer: Omit<Transfer, "id" | "source">) => {
      updateWorkspace((ws) => ({
        ...ws,
        transfers: [
          ...ws.transfers,
          { ...transfer, id: uid("tr"), source: "manual" },
        ],
      }));
      notify(
        transfer.status === "planned"
          ? "Planned saving added to the forecast."
          : transfer.to === "savings"
            ? "Moved to savings. Your spendable cash is lower; savings are not spending."
            : "Moved back to cash from savings.",
      );
    },
    [notify, updateWorkspace],
  );

  const deleteTransfer = useCallback(
    (id: string) => {
      updateWorkspace((ws) => ({ ...ws, transfers: ws.transfers.filter((row) => row.id !== id) }));
    },
    [updateWorkspace],
  );

  const addExpected = useCallback(
    (item: Omit<ExpectedItem, "id" | "source">) => {
      updateWorkspace((ws) => ({
        ...ws,
        expected: [...ws.expected, { ...item, id: uid("exp"), source: "manual" }],
      }));
      notify(
        `${item.direction === "income" ? "Expected money in" : "Expected payment"}: ${item.label}. It is shown as provisional until recorded.`,
      );
    },
    [notify, updateWorkspace],
  );

  const deleteExpected = useCallback(
    (id: string) => {
      updateWorkspace((ws) => ({ ...ws, expected: ws.expected.filter((row) => row.id !== id) }));
    },
    [updateWorkspace],
  );

  const matchExpected = useCallback(
    (expectedId: string, transactionId: string) => {
      let linked: ExpectedItem | undefined;
      updateWorkspace((ws) => {
        linked = ws.expected.find((item) => item.id === expectedId);
        return {
          ...ws,
          transactions: ws.transactions.map((tx) =>
            tx.id === transactionId ? { ...tx, expectedId } : tx,
          ),
          expected: ws.expected.filter((item) => item.id !== expectedId),
        };
      });
      notify(
        linked
          ? `Matched “${linked.label}” to the recorded entry. Nothing was counted twice.`
          : "Matched to the recorded entry.",
        {
          label: "Undo",
          run: () =>
            updateWorkspace((ws) => ({
              ...ws,
              expected: linked ? [...ws.expected, linked] : ws.expected,
              transactions: ws.transactions.map((tx) =>
                tx.id === transactionId ? { ...tx, expectedId: undefined } : tx,
              ),
            })),
        },
      );
    },
    [notify, updateWorkspace],
  );

  const addAsset = useCallback(
    (asset: Omit<Asset, "id">) => {
      updateWorkspace((ws) => ({ ...ws, assets: [...ws.assets, { ...asset, id: uid("as") }] }));
      notify("Asset added. It is informational only and never counted as cash.");
    },
    [notify, updateWorkspace],
  );

  const deleteAsset = useCallback(
    (id: string) => {
      updateWorkspace((ws) => ({ ...ws, assets: ws.assets.filter((row) => row.id !== id) }));
    },
    [updateWorkspace],
  );

  /* -------------------------------- scenarios ------------------------------ */

  const addScenario = useCallback(
    (scenario: Omit<Scenario, "id" | "active">) => {
      const id = uid("sc");
      updateWorkspace((ws) => ({
        ...ws,
        scenarios: [...ws.scenarios, { ...scenario, id, active: false }],
      }));
      return id;
    },
    [updateWorkspace],
  );

  const updateScenario = useCallback(
    (id: string, patch: Partial<Scenario>) => {
      updateWorkspace((ws) => ({
        ...ws,
        scenarios: ws.scenarios.map((scenario) =>
          scenario.id === id ? { ...scenario, ...patch } : scenario,
        ),
      }));
    },
    [updateWorkspace],
  );

  const deleteScenario = useCallback(
    (id: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        scenarios: ws.scenarios.filter((scenario) => scenario.id !== id),
      }));
    },
    [updateWorkspace],
  );

  const setScenarioActive = useCallback(
    (id: string, active: boolean) => {
      updateWorkspace((ws) => ({
        ...ws,
        scenarios: ws.scenarios.map((scenario) =>
          scenario.id === id ? { ...scenario, active } : scenario,
        ),
      }));
    },
    [updateWorkspace],
  );

  /* ------------------------------ preferences ------------------------------ */

  const setRecurringStatus = useCallback(
    (key: string, status: RecurringStatus | null) => {
      updateWorkspace((ws) => {
        const overrides = { ...ws.overrides };
        if (status === null) delete overrides[key];
        else overrides[key] = status;
        return { ...ws, overrides };
      });
    },
    [updateWorkspace],
  );

  const setRecurrencePrefs = useCallback(
    (key: string, patch: Partial<RecurrencePreferences>) => {
      updateWorkspace((ws) => ({
        ...ws,
        recurrencePrefs: {
          ...ws.recurrencePrefs,
          [key]: { ...(ws.recurrencePrefs[key] ?? { priority: "essential" }), ...patch },
        },
      }));
    },
    [updateWorkspace],
  );

  const decideSuggestion = useCallback(
    (id: string, decision: string) => {
      updateWorkspace((ws) => ({
        ...ws,
        suggestionDecisions: { ...ws.suggestionDecisions, [id]: decision },
      }));
      notify(`Saved. We will remember “${decision}” for this suggestion.`, {
        label: "Undo",
        run: () =>
          updateWorkspace((ws) => {
            const next = { ...ws.suggestionDecisions };
            delete next[id];
            return { ...ws, suggestionDecisions: next };
          }),
      });
    },
    [notify, updateWorkspace],
  );

  /* -------------------------------- settings ------------------------------- */

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      updateWorkspace((ws) => ({
        ...ws,
        reserve: patch.safetyThreshold ?? ws.reserve,
        openingBalance: patch.openingBalance ?? ws.openingBalance,
        horizon: patch.horizon ?? ws.horizon,
      }));
    },
    [updateWorkspace],
  );

  const setOpening = useCallback(
    (amount: number, date: string) => {
      updateWorkspace((ws) => ({ ...ws, openingBalance: amount, openingDate: date }));
    },
    [updateWorkspace],
  );

  const setReserve = useCallback(
    (amount: number) => updateWorkspace((ws) => ({ ...ws, reserve: Math.max(0, amount) })),
    [updateWorkspace],
  );

  const setHorizon = useCallback(
    (horizon: 30 | 60 | 90) => updateWorkspace((ws) => ({ ...ws, horizon })),
    [updateWorkspace],
  );

  /* ------------------------------ workspaces ------------------------------- */

  const beginFresh = useCallback(() => {
    setPersisted((prev) => ({
      ...prev,
      active: "own",
      own: emptyOwnWorkspace(today),
      onboarded: true,
    }));
    setPage("overview");
  }, [today]);

  const openDemo = useCallback(
    (options?: { force?: boolean }) => {
      setPersisted((prev) => {
        const demo = prev.demo ?? buildDemoWorkspace(today);
        return { ...prev, demo, active: "demo", onboarded: true };
      });
      if (options?.force) setPage("overview");
    },
    [today],
  );

  const leaveDemo = useCallback(() => {
    setPersisted((prev) => ({ ...prev, active: "own" }));
    setPage("overview");
  }, []);

  const switchWorkspace = useCallback(
    (id: WorkspaceId) => {
      setPersisted((prev) => {
        if (id === "demo" && !prev.demo) {
          return { ...prev, demo: buildDemoWorkspace(today), active: "demo" };
        }
        return { ...prev, active: id };
      });
      setPage("overview");
    },
    [today],
  );

  const completeOnboarding = useCallback(() => {
    setPersisted((prev) => ({ ...prev, onboarded: true }));
  }, []);

  const dismissMigrationNote = useCallback(() => {
    setPersisted((prev) => ({ ...prev, migrationNote: null }));
  }, []);

  const clearOwnData = useCallback(() => {
    setPersisted((prev) => ({ ...prev, active: "own", own: emptyOwnWorkspace(today) }));
    notify("Your workspace was cleared. The demo workspace is untouched.");
  }, [notify, today]);

  /** Move known demo rows out of the user's own ledger, keeping everything else. */
  const moveDemoRowsOut = useCallback(() => {
    setPersisted((prev) => {
      const kept = prev.own.transactions.filter((tx) => tx.source !== "demo");
      return {
        ...prev,
        own: { ...prev.own, transactions: kept },
        migrationNote: null,
      };
    });
    notify("Sample rows moved out. Your own records were kept.");
  }, [notify]);

  const markTourCompleted = useCallback(() => {
    updateWorkspace((ws) => ({ ...ws, tourCompleted: true }));
  }, [updateWorkspace]);

  /* --------------------------------- tour ---------------------------------- */

  const startTour = useCallback(() => {
    tourReturn.current = isDemo ? "own" : activeId;
    openDemo({ force: true });
    setTour({ active: true, step: 0, returnTo: tourReturn.current });
    setPage("plan");
    setHelpOpen(false);
  }, [activeId, isDemo, openDemo]);

  const stopTour = useCallback(() => {
    const target = tour.active ? tour.returnTo : activeId;
    setTour({ active: false, step: 0, returnTo: target });
    setPersisted((prev) => ({ ...prev, active: target }));
    // The user just left the demo; put them back on the page they came from.
    setPage(isDemo ? "overview" : page);
  }, [activeId, isDemo, page, tour.active, tour.returnTo]);

  const setTourStep = useCallback(
    (step: number) => {
      if (step < 0 || step >= TOUR_STEPS) {
        stopTour();
        return;
      }
      setTour((prev) => ({ ...prev, step }));
      if (step >= 3) setPage("plan");
      else if (step === 0 || step === 1) setPage("plan");
      else if (step === 2) setPage("plan");
    },
    [stopTour],
  );

  /* ------------------------------- derived --------------------------------- */

  const settings = useMemo<Settings>(
    () => ({
      safetyThreshold: workspace.reserve,
      openingBalance: workspace.openingBalance,
      horizon: workspace.horizon,
      currency: "INR",
    }),
    [workspace.reserve, workspace.openingBalance, workspace.horizon],
  );

  const ledger = useMemo(
    () => ({
      transactions: workspace.transactions,
      transfers: workspace.transfers,
      expected: workspace.expected,
      openingBalance: workspace.openingBalance,
      openingDate: workspace.openingDate,
      reserve: workspace.reserve,
      horizon: workspace.horizon,
    }),
    [workspace],
  );

  const recurring = useMemo(
    () =>
      recognizeRecurring(
        workspace.transactions,
        workspace.overrides,
        workspace.recurrencePrefs,
        today,
      ),
    [workspace.transactions, workspace.overrides, workspace.recurrencePrefs, today],
  );

  const baseline = useMemo(
    () => buildBaselineForecast({ ledger, recurring, today }),
    [ledger, recurring, today],
  );

  const forecast = useMemo(
    () => buildWorkspaceForecast({ ledger, recurring, today, scenarios: workspace.scenarios }),
    [ledger, recurring, today, workspace.scenarios],
  );

  const backtest = useMemo(
    () => runBacktest(workspace.transactions, settingsFor(ledger), today),
    [workspace.transactions, ledger, today],
  );

  const confirmedKeys = useMemo(
    () => new Set(recurring.filter((item) => item.status === "confirmed").map((item) => item.key)),
    [recurring],
  );

  const anomalies = useMemo(
    () => detectAnomalies(workspace.transactions, today, { excludeRecurringKeys: confirmedKeys }),
    [workspace.transactions, today, confirmedKeys],
  );

  const recommendations = useMemo(
    () =>
      buildRecommendations({
        forecast,
        anomalies,
        settings,
      }),
    [forecast, anomalies, settings],
  );

  const replay = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof buildBaselineForecast> | null>();
    return replayDecisions(
      workspace.transactions,
      (cutoff: string) => {
        if (cache.has(cutoff)) return cache.get(cutoff) ?? null;
        const history = workspace.transactions.filter((tx) => tx.date <= cutoff);
        if (history.length < 12) {
          cache.set(cutoff, null);
          return null;
        }
        const built = buildBaselineForecast({
          ledger: { ...ledger, transactions: history, expected: [] },
          recurring: recognizeRecurring(history, workspace.overrides, workspace.recurrencePrefs, cutoff),
          today: cutoff,
          scenarios: [],
        });
        cache.set(cutoff, built);
        return built;
      },
      workspace.reserve,
    );
  }, [workspace.transactions, workspace.overrides, workspace.recurrencePrefs, workspace.reserve, ledger]);

  const reliability = useMemo(
    () => measureReliability(ledger, backtest, replay, today),
    [ledger, backtest, replay, today],
  );

  /** Build the forecast over an arbitrary horizon (the planner needs a long one). */
  const buildForecastOver = useCallback(
    (horizonDays: number) =>
      buildBaselineForecast({
        ledger: { ...ledger, horizon: horizonDays as typeof ledger.horizon },
        recurring,
        today,
        scenarios: [],
      }),
    [ledger, recurring, today],
  );

  const dismissed = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const [id, decision] of Object.entries(workspace.suggestionDecisions)) {
      if (decision === "dismiss" || decision === "not-a-bill") map[id] = true;
    }
    return map;
  }, [workspace.suggestionDecisions]);

  const suggestions = useMemo(
    () =>
      buildSuggestions({
        ledger,
        recurring,
        forecast,
        today,
        dismissed,
      }),
    [ledger, recurring, forecast, today, dismissed],
  );

  const reconciliation = useMemo(() => proposeReconciliations(ledger), [ledger]);

  const subscriptions = useMemo(() => subscriptionSummary(recurring), [recurring]);
  const monthly = useMemo(
    () => monthlySeries(workspace.transactions, today, 6, workspace.openingBalance),
    [workspace.transactions, today, workspace.openingBalance],
  );
  const room = useMemo(() => roomForPurchase(forecast, settings), [forecast, settings]);

  const cash = useMemo(() => cashToday(ledger, today), [ledger, today]);
  const savings = useMemo(() => savingsToday(ledger), [ledger]);

  const workspaces = useMemo(
    () => [
      {
        id: "own" as WorkspaceId,
        label: persisted.own.label,
        exists: true,
        count: persisted.own.transactions.length,
      },
      {
        id: "demo" as WorkspaceId,
        label: "Demo workspace",
        exists: Boolean(persisted.demo),
        count: persisted.demo?.transactions.length ?? 0,
      },
    ],
    [persisted.own.label, persisted.own.transactions.length, persisted.demo],
  );

  /* -------------------------------- context -------------------------------- */

  const value: AppContextValue = {
    today,
    workspaceId: activeId,
    workspace,
    workspaces,
    demoAvailable: Boolean(persisted.demo),
    onboarded: persisted.onboarded,
    migrationNote: persisted.migrationNote,
    isDemo,

    transactions: workspace.transactions,
    expected: workspace.expected,
    transfers: workspace.transfers,
    assets: workspace.assets,
    merchantMemory: workspace.merchantMemory,
    scenarios: workspace.scenarios,
    settings,
    reserve: workspace.reserve,
    horizon: workspace.horizon,

    baselineForecast: baseline,
    isDemoData: isDemo,
    cashToday: cash,
    savingsToday: savings,
    recurring,
    forecast,
    baseline,
    buildForecast: buildForecastOver,
    suggestions,
    reconciliation,
    reliability,
    replay,
    backtest,
    room,
    anomalies,
    recommendations,
    subscriptions,
    monthly,

    toast,
    undo,
    notify,

    addTransaction,
    importTransactions,
    updateTransaction,
    deleteTransaction,
    setCategory,

    addTransfer,
    deleteTransfer,
    addExpected,
    deleteExpected,
    matchExpected,
    addAsset,
    deleteAsset,

    addScenario,
    updateScenario,
    deleteScenario,
    setScenarioActive,

    setRecurringStatus,
    setRecurrencePrefs,
    decideSuggestion,

    updateSettings,
    setOpening,
    setReserve,
    setHorizon,

    beginFresh,
    openDemo,
    leaveDemo,
    switchWorkspace,
    completeOnboarding,
    dismissMigrationNote,
    clearOwnData,
    moveDemoRowsOut,
    markTourCompleted,

    page,
    setPage,
    helpOpen,
    setHelpOpen,
    tour,
    startTour,
    stopTour,
    tourStep: tour.step,
    setTourStep,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

/** Sensible default demo purchase used by the guided tour and empty states. */
export const TOUR_PURCHASE = { label: "New laptop", amount: 68000, inDays: 7 } as unknown as {
  label: string;
  amount: number;
  inDays: number;
};

export function defaultPurchaseDate(today: string): string {
  return addDays(today, TOUR_PURCHASE.inDays);
}
