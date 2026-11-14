import { useMemo } from "react";
import { PurchasePlanner } from "../features/planner/PurchasePlanner";
import { plannerDataFromApp } from "../features/planner/adapter";
import { useApp } from "../store";

/**
 * Host page for Person 2's `<PurchasePlanner />`. The planner owns everything
 * inside the frame below; this page only passes the dashboard's prefill values
 * and gives the user a way out to adjust underlying bills.
 */
export function PlanPage({ prefill }: { prefill: { amount?: number; date?: string } | null }) {
  const { transactions, workspace, today, settings, isDemoData, cashToday, buildForecast } =
    useApp();

  // Person 2's planner grades each candidate date across tested payment delays,
  // so it needs a much longer forecast than the 30-day dashboard view. Without
  // this every date reads "Insufficient forecast window".
  const planHorizon = Math.max(120, settings.horizon);
  const planForecast = useMemo(
    () => buildForecast(planHorizon),
    [buildForecast, planHorizon],
  );

  // Person 2's planner takes the app's forecast through its own adapter.
  const data = plannerDataFromApp({
    today,
    settings: { safetyThreshold: settings.safetyThreshold, horizon: planHorizon },
    baselineForecast: {
      today,
      horizon: planHorizon,
      startingBalance: cashToday,
      points: planForecast.points,
      events: planForecast.events,
    },
    transactions,
    isDemoData,
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Plan a purchase · {workspace.label}</p>
          <h1>Pick a day you can afford.</h1>
          <p className="page-sub">
            {transactions.length > 0
              ? "Enter an amount, test a late client payment, then read the calendar day by day."
              : "You can test a purchase before recording anything — the demo workspace shows the full experience."}
          </p>
        </div>
      </header>

      <PurchasePlanner
        data={data}
        initialAmount={prefill?.amount}
        initialDate={prefill?.date}
      />
    </div>
  );
}