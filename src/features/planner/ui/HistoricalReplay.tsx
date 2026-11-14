import { useMemo } from "react";
import type { PlannerData, PurchasePlan } from "../engine/types";
import { runHistoricalReplay, realisedFromEvents } from "../engine/replay";
import { addDays } from "../engine/dates";
import { dayLabel, money } from "./format";
import { HelpTip } from "./atoms";

/**
 * "Would this decision have worked?"
 *
 * Known-then forecast vs the simple rule, both scored against realised balances
 * that the forecast never saw. When history is thin we say so instead of
 * producing a number.
 */
export function HistoricalReplay({
  data,
  plan,
  followUpDays,
  historyStart,
  historyEvents,
}: {
  data: PlannerData;
  plan: PurchasePlan;
  followUpDays: number;
  /** First date of recorded (held-out) history the adapter can supply. */
  historyStart: string | null;
  /** Realised dated movements from history. */
  historyEvents: { date: string; amount: number; direction: "income" | "expense" }[];
}) {
  const summary = useMemo(() => {
    if (!historyStart) return null;
    const realised = realisedFromEvents(historyEvents, historyStart, data.today);
    return runHistoricalReplay({
      today: data.today,
      price: plan.price,
      reserve: data.reserve,
      followUpDays,
      realised,
      provenance: data.provenance.source === "development-fixture" ? "synthetic-demo" : "user-data",
    });
  }, [data, plan.price, followUpDays, historyStart, historyEvents]);

  const replayErrorCount = summary
    ? summary.forecast.breached - summary.rule.breached
    : 0;

  return (
    <section className="pp-card" aria-labelledby="pp-replay-title">
      <div className="pp-card-head">
        <div>
          <h2 id="pp-replay-title">
            Would this decision have worked?
            <HelpTip label="historical replay">
              Each past cutoff is graded using only what was knowable on that date. The realised path
              afterwards is held out and used only to score the decision.
            </HelpTip>
          </h2>
          <p className="pp-card-sub">
            Same reserve ({money(data.reserve)}), same purchase ({money(plan.price)}) and same{" "}
            {followUpDays}-day follow-up on both methods.
          </p>
        </div>
        {summary && summary.provenance === "synthetic-demo" && (
          <span className="pp-badge pp-badge-warn">Synthetic demo results</span>
        )}
      </div>

      {!summary || summary.empty ? (
        <div className="pp-empty">
          <p>Not enough history to replay this decision yet.</p>
          <p className="pp-hint">
            The replay needs at least 45 days of recorded transactions plus a {followUpDays}-day follow-up after
            each cutoff. Import more history to enable it.
          </p>
        </div>
      ) : (
        <>
          <p className="pp-hint">
            {summary.evaluated} cutoff{summary.evaluated === 1 ? "" : "s"} evaluated
            {summary.provenance === "synthetic-demo"
              ? " — these cutoffs come from the labelled demo data, so treat the numbers as illustrative."
              : " — from your own recorded transactions."}
          </p>

          <div className="pp-replay-grid">
            <div className="pp-replay-col">
              <h3>Knowable-then forecast</h3>
              <dl>
                <div>
                  <dt>Purchases recommended</dt>
                  <dd className="pp-num">{summary.forecast.buys}</dd>
                </div>
                <div>
                  <dt>Of those, breached the reserve</dt>
                  <dd className="pp-num pp-bad">{summary.forecast.breached}</dd>
                </div>
                <div>
                  <dt>Of those, held up</dt>
                  <dd className="pp-num pp-ok">{summary.forecast.held}</dd>
                </div>
                <div>
                  <dt>Deferred that would have worked</dt>
                  <dd className="pp-num">{summary.forecast.deferredThatWorked}</dd>
                </div>
              </dl>
            </div>
            <div className="pp-replay-col">
              <h3>Simple rule: balance − price &gt; reserve</h3>
              <dl>
                <div>
                  <dt>Purchases recommended</dt>
                  <dd className="pp-num">{summary.rule.buys}</dd>
                </div>
                <div>
                  <dt>Of those, breached the reserve</dt>
                  <dd className="pp-num pp-bad">{summary.rule.breached}</dd>
                </div>
                <div>
                  <dt>Of those, held up</dt>
                  <dd className="pp-num pp-ok">{summary.rule.held}</dd>
                </div>
                <div>
                  <dt>Deferred that would have worked</dt>
                  <dd className="pp-num">{summary.rule.deferredThatWorked}</dd>
                </div>
              </dl>
            </div>
          </div>

          <p className={replayErrorCount < 0 ? "pp-good-inline" : "pp-hint"}>
            {replayErrorCount === 0
              ? "Both methods made the same number of purchases that later breached the reserve on this history."
              : replayErrorCount < 0
                ? `The knowable-then forecast caught ${Math.abs(replayErrorCount)} more risky purchase${Math.abs(replayErrorCount) === 1 ? "" : "s"} than the simple rule on this history.`
                : `The knowable-then forecast missed ${replayErrorCount} more risky purchase${replayErrorCount === 1 ? "" : "s"} than the simple rule on this history.`}
          </p>

          <details className="pp-details">
            <summary>Show the {summary.cases.length} evaluated cutoffs</summary>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th scope="col">Cutoff</th>
                    <th scope="col">Balance then</th>
                    <th scope="col">Rule would buy</th>
                    <th scope="col">Forecast would buy</th>
                    <th scope="col">Realised low</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.cases.map((item) => (
                    <tr key={item.cutoff}>
                      <td>{dayLabel(item.cutoff)}</td>
                      <td className="pp-num">{money(item.observedBalance)}</td>
                      <td>
                        {item.ruleWouldBuy ? "Yes" : "No"}
                        {item.ruleOutcome === "breached" && <span className="pp-bad"> · breached</span>}
                      </td>
                      <td>
                        {item.forecastWouldBuy ? "Yes" : "No"}
                        {item.forecastOutcome === "breached" && <span className="pp-bad"> · breached</span>}
                      </td>
                      <td className="pp-num">{item.realisedLow === null ? "—" : money(item.realisedLow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/** Helper for adapters that only hold a bounded history window. */
export function replayHistoryStart(today: string, days = 180): string {
  return addDays(today, -days);
}
