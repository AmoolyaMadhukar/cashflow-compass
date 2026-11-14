import { useEffect, useState } from "react";
import { useApp } from "../../store";
import { PurchasePlanner } from "./PurchasePlanner";
import { buildDevelopmentFixture, plannerDataFromApp } from "./adapter";
import type { PlannerData } from "./engine/types";

/**
 * Additive mount points (Person 2).
 *
 * The integration agreement says Person 3 owns App.tsx and store.tsx. So this
 * feature exposes its own entry component plus these two thin helpers, which
 * Person 3 imports instead of touching this folder again:
 *
 *   <PurchasePlannerPage />            // full page, wired to the live store
 *   <PurchasePlanner data={data} />    // the raw component (already mounted here)
 *
 * No files outside src/features/planner/ are modified.
 */

/** Convert the live store into the planner contract. Production uses the user's own data. */
export function usePlannerDataFromStore(): PlannerData {
  const { today, settings, baselineForecast, transactions, isDemoData } = useApp();
  return plannerDataFromApp({
    today,
    settings: { safetyThreshold: settings.safetyThreshold, horizon: settings.horizon },
    baselineForecast,
    transactions,
    isDemoData,
  });
}

/** Full page that Person 3 can mount in place of the old What-if page. */
export function PurchasePlannerPage() {
  const data = usePlannerDataFromStore();
  const { transactions, today, notify } = useApp();

  const history = buildHistorySlice(transactions, today);

  return (
    <div className="page">
      <PurchasePlanner data={data} history={history} notify={notify} />
    </div>
  );
}

function buildHistorySlice(
  transactions: { date: string; amount: number; direction: "income" | "expense" }[],
  today: string,
) {
  const recorded = transactions.filter((tx) => tx.date <= today);
  if (recorded.length === 0) return { start: null, events: [] };
  const sorted = [...recorded].sort((a, b) => a.date.localeCompare(b.date));
  return {
    start: sorted[0].date,
    events: sorted.map((tx) => ({ date: tx.date, amount: tx.amount, direction: tx.direction })),
  };
}

/**
 * Standalone route for local development of this feature when the store is not
 * available (e.g. someone opens the planner without an AppProvider).
 * Guarded so it is never used for a real user.
 */
export function PurchasePlannerFixturePage({ today }: { today: string }) {
  const [data, setData] = useState<PlannerData | null>(null);
  useEffect(() => {
    setData(buildDevelopmentFixture(today));
  }, [today]);
  if (!data) return null;
  return (
    <div className="page">
      <PurchasePlanner data={data} />
    </div>
  );
}
