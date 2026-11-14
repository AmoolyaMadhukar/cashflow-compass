import { useMemo } from "react";
import { useApp } from "../store";
import { addDays, daysBetween, money, percent, shortDate } from "../lib/format";
import { AccuracyChart, DonutChart, MonthlyBars } from "../components/Charts";
import { categoryColor } from "../lib/categorize";
import { Badge, EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";
import { ContextHelp } from "../components/ContextHelp";
import { ReliabilityControl, UncertaintyNote } from "../components/ReliabilityControl";
import { monthlyEquivalent } from "../lib/recurring";

export function InsightsPage({ onPlan }: { onPlan: () => void }) {
  const {
    today,
    transactions,
    recurring,
    forecast,
    baseline,
    backtest,
    replay,
    reliability,
    recommendations,
    anomalies,
    monthly,
    subscriptions,
    expected,
    settings,
    horizon,
  } = useApp();

  const categories = useMemo(
    () => categoryBreakdownRows(transactions, addDays(today, -29), today),
    [transactions, today],
  );

  if (transactions.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <p className="eyebrow">Insights</p>
            <h1>Nothing to measure yet.</h1>
            <p className="page-sub">
              Accuracy needs history. Add or import at least 15 transactions to measure how wrong the forecast
              usually is.
            </p>
          </div>
        </header>
        <div className="card">
          <EmptyState
            icon="sparkles"
            title="No measurements available"
            body="This page reports measured error, not a confidence score invented by the app. With too little history it will say “Insufficient history” rather than guess."
          />
        </div>
        <ReliabilityControl />
      </div>
    );
  }

  const confirmedBills = recurring
    .filter((item) => item.status === "confirmed" && item.direction === "expense")
    .sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a));
  const monthlyBills = confirmedBills.reduce((sum, item) => sum + monthlyEquivalent(item), 0);
  const withinReplay = replay.filter((entry) => entry.withinBand).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>How wrong is this forecast, really?</h1>
          <p className="page-sub">
            Every number here is measured from your own rows. Nothing is a generic benchmark.
          </p>
        </div>
        <ReliabilityControl inline />
      </header>

      <section className="accuracy-grid">
        <article className="card accuracy-card">
          <div className="card-head">
            <div>
              <h2>
                Forecast accuracy <ContextHelp topic="historical-error" />
              </h2>
              <p className="card-sub">{reliability.method}</p>
            </div>
            <Badge
              tone={
                reliability.status === "insufficient"
                  ? "neutral"
                  : reliability.confidence === "high"
                    ? "good"
                    : reliability.confidence === "medium"
                      ? "warn"
                      : "expense"
              }
              dot
            >
              {reliability.status === "insufficient" ? "Insufficient history" : `${reliability.confidence} confidence`}
            </Badge>
          </div>

          {backtest ? (
            <>
              <dl className="accuracy-stats">
                <div>
                  <dt>Average daily error</dt>
                  <dd className="num">{money(reliability.meanDailyError ?? 0)}</dd>
                  <span className="subtle small">mean gap per day across {backtest.horizon} held-out days</span>
                </div>
                <div>
                  <dt>End-of-window error</dt>
                  <dd className="num">{percent(backtest.errorPercent, 1)}</dd>
                  <span className="subtle small">
                    predicted {money(backtest.predictedEnd)} vs actual {money(backtest.actualEnd)}
                  </span>
                </div>
                <div>
                  <dt>Sample size</dt>
                  <dd className="num">{reliability.sampleSize}</dd>
                  <span className="subtle small">
                    transactions · {reliability.historyDays} days of history
                  </span>
                </div>
                <div>
                  <dt>Days with activity</dt>
                  <dd className="num">{percent(reliability.coverage * 100, 0)}</dd>
                  <span className="subtle small">
                    {reliability.coverageDays} of the last {reliability.coverageWindow} days
                  </span>
                </div>
              </dl>
              <AccuracyChart result={backtest} />
              <p className="chart-note">
                The line is what the app predicted on {shortDate(backtest.cutoff)}; the markers are what the ledger
                actually shows. The gap is the error — not a bug, an honest measurement.
              </p>
            </>
          ) : (
            <div className="sparse-state">
              <Icon name="info" size={20} />
              <div>
                <h3>Insufficient history</h3>
                <p>
                  The backtest needs at least 15 recorded transactions before it can hold out 30 days. You have{" "}
                  {transactions.length}. Import an older statement to unlock measured accuracy.
                </p>
                <p className="subtle small">
                  Until then every forecast is labelled as uncertain, and the reliability control says so plainly.
                </p>
              </div>
            </div>
          )}
        </article>

        <article className="card replay-card">
          <div className="card-head">
            <div>
              <h2>Purchase decisions replayed</h2>
              <p className="card-sub">
                Each earlier purchase, forecast again from the history that existed then
              </p>
            </div>
            <Badge tone={replay.length > 0 ? "info" : "neutral"}>
              {replay.length > 0 ? `${withinReplay}/${replay.length} inside range` : "None yet"}
            </Badge>
          </div>
          {replay.length === 0 ? (
            <p className="subtle small">
              No purchases of {money(2000)} or more with enough history behind them. Record a large expense and
              return here.
            </p>
          ) : (
            <ul className="replay-list">
              {replay.map((entry) => (
                <li key={entry.id}>
                  <div className="replay-main">
                    <strong>{entry.label}</strong>
                    <span className="subtle small">
                      {shortDate(entry.date)} · {money(entry.amount)}
                    </span>
                  </div>
                  <div className="replay-numbers">
                    <span>
                      Predicted <span className="num">{money(entry.predictedBalance)}</span>
                    </span>
                    <span>
                      Actual <span className="num">{money(entry.actualBalance)}</span>
                    </span>
                  </div>
                  <Badge tone={entry.withinBand ? "good" : "warn"}>
                    {entry.withinBand ? "Inside range" : "Outside range"}
                  </Badge>
                  <p className="replay-verdict subtle small">{entry.verdict}</p>
                </li>
              ))}
            </ul>
          )}
          <UncertaintyNote />
        </article>
      </section>

      <section className="insights-split">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Recommendations</h2>
              <p className="card-sub">Each one shows the facts behind it</p>
            </div>
            <span className="subtle small">{recommendations.length} from your data</span>
          </div>
          {recommendations.length === 0 ? (
            <p className="subtle small">No recommendations right now — nothing in your history stands out.</p>
          ) : (
            <div className="rec-list">
              {recommendations.map((rec) => (
                <div className={`rec rec-${rec.tone}`} key={rec.id}>
                  <div className="rec-icon">
                    <Icon
                      name={rec.tone === "good" ? "check-circle" : rec.tone === "info" ? "info" : "alert"}
                      size={17}
                    />
                  </div>
                  <div className="rec-body">
                    <div className="rec-heading">
                      <h3>{rec.title}</h3>
                      <Badge
                        tone={
                          rec.tone === "alert"
                            ? "expense"
                            : rec.tone === "warn"
                              ? "warn"
                              : rec.tone === "good"
                                ? "good"
                                : "info"
                        }
                      >
                        {rec.tone === "alert" ? "Act soon" : rec.tone === "warn" ? "Watch" : rec.tone === "good" ? "On track" : "Insight"}
                      </Badge>
                    </div>
                    <p>{rec.body}</p>
                    <div className="facts-block">
                      <span className="facts-title">Why this appears</span>
                      <ul className="facts">
                        {rec.facts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <div className="side-stack">
          <article className="card">
            <div className="card-head">
              <div>
                <h2>Unusual spending</h2>
                <p className="card-sub">Compared with your own category history</p>
              </div>
              <Badge tone="neutral">Not fraud detection</Badge>
            </div>
            {anomalies.length === 0 ? (
              <div className="calm-state">
                <Icon name="check-circle" size={18} />
                <div>
                  <h3>Nothing unusual</h3>
                  <p className="small">No recent transaction is far outside its usual range.</p>
                </div>
              </div>
            ) : (
              <ul className="anomaly-list">
                {anomalies.slice(0, 4).map((anomaly) => (
                  <li key={anomaly.transaction.id}>
                    <div>
                      <strong>{anomaly.transaction.description}</strong>
                      <span className="subtle small">
                        {shortDate(anomaly.transaction.date)} · {anomaly.transaction.category}
                      </span>
                    </div>
                    <span className="num">{money(anomaly.transaction.amount)}</span>
                    <Badge tone={anomaly.severity === "strong" ? "expense" : "warn"}>
                      {anomaly.ratio.toFixed(1)}× typical
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="card">
            <div className="card-head">
              <div>
                <h2>Committed bills</h2>
                <p className="card-sub">Confirmed recurring, normalised monthly</p>
              </div>
              <span className="kpi-icon">
                <Icon name="repeat" size={17} />
              </span>
            </div>
            <p className="subscription-total num">
              {money(monthlyBills)}
              <span className="subtle">/month</span>
            </p>
            <p className="subtle small">
              {confirmedBills.length} confirmed · {money(subscriptions.monthly * 12)} a year
            </p>
            <ul className="mini-sub-list">
              {confirmedBills.slice(0, 4).map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <span className="num">{money(monthlyEquivalent(item))}/mo</span>
                </li>
              ))}
            </ul>
            <button className="link-btn" onClick={onPlan}>
              Check a purchase against these <Icon name="arrow-right" size={13} />
            </button>
          </article>
        </div>
      </section>

      <section className="insights-split">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Where the money goes</h2>
              <p className="card-sub">Last 30 days · {money(categories.total)} spent</p>
            </div>
          </div>
          {categories.rows.length === 0 ? (
            <p className="subtle small">No expenses in the last 30 days.</p>
          ) : (
            <div className="money-map-body">
              <DonutChart
                data={categories.rows.map((entry) => ({
                  label: entry.category,
                  value: entry.total,
                  color: categoryColor(entry.category),
                }))}
                total={categories.total}
                centerLabel="spent"
              />
              <ul className="category-legend">
                {categories.rows.slice(0, 6).map((entry) => (
                  <li key={entry.category}>
                    <span className="legend-swatch" style={{ background: categoryColor(entry.category) }} />
                    <span className="legend-name">{entry.category}</span>
                    <span className="legend-value num">{money(entry.total)}</span>
                    <span className="legend-share num">{percent(entry.share, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <article className="card">
          <div className="card-head">
            <div>
              <h2>Six months of cash flow</h2>
              <p className="card-sub">Income against expenses</p>
            </div>
          </div>
          <MonthlyBars months={monthly} />
          <div className="bar-legend">
            <span><i className="legend-swatch income" /> Income</span>
            <span><i className="legend-swatch expense" /> Expenses</span>
          </div>
        </article>
      </section>

      <section className="card forecast-explainer">
        <div className="card-head">
          <div>
            <h2>What is in this forecast</h2>
            <p className="card-sub">
              Next {horizon} days · starting {money(forecast.startingBalance)} · reserve {money(settings.safetyThreshold)}
            </p>
          </div>
          <Badge tone="info" dot>
            Plain-language breakdown
          </Badge>
        </div>
        <div className="explainer-grid">
          <div>
            <h3>Confirmed facts</h3>
            <ul>
              <li>{transactions.length} recorded money movements</li>
              <li>{recurring.filter((item) => item.status === "confirmed").length} confirmed recurring schedules</li>
              <li>
                Opening balance {money(settings.openingBalance)} on{" "}
                {shortDate(forecast.today)}
              </li>
            </ul>
          </div>
          <div>
            <h3>Provisional estimates</h3>
            <ul>
              <li>{expected.length} expected one-off payments</li>
              <li>Everyday spending ≈ {money(forecast.variableExpensePerDay)}/day from your history</li>
              <li>
                ±{money(forecast.bandWidthEnd)} range at {shortDate(addDays(today, horizon))}
              </li>
            </ul>
          </div>
          <div>
            <h3>Hypothetical scenarios</h3>
            <ul>
              <li>Saved purchases are excluded from the baseline line</li>
              <li>
                Baseline low {money(baseline.minBalance)} vs scenario low {money(forecast.minBalance)} on{" "}
                {shortDate(forecast.minDate)}
              </li>
              <li>{daysBetween(today, forecast.minDate)} days from today</li>
            </ul>
          </div>
        </div>
        <UncertaintyNote />
      </section>
    </div>
  );
}

function categoryBreakdownRows(
  transactions: { amount: number; direction: string; category: string; date: string }[],
  from: string,
  to: string,
) {
  const map = new Map<string, { category: string; total: number; count: number }>();
  let total = 0;
  for (const tx of transactions) {
    if (tx.direction !== "expense") continue;
    if (tx.date < from || tx.date > to) continue;
    const entry = map.get(tx.category) ?? { category: tx.category, total: 0, count: 0 };
    entry.total += tx.amount;
    entry.count += 1;
    total += tx.amount;
    map.set(tx.category, entry);
  }
  const rows = Array.from(map.values())
    .map((entry) => ({ ...entry, share: total > 0 ? (entry.total / total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
  return { rows, total };
}