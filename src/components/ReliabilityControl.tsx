import { useState } from "react";
import { useApp } from "../store";
import { money, percent, shortDate } from "../lib/format";
import { Icon } from "./Icon";

/**
 * Compact global control. Collapsed it is one status word; expanded it shows the
 * measured numbers from Person 1's engine and Person 2's replay.
 */
export function ReliabilityControl({ inline = false }: { inline?: boolean }) {
  const { reliability, isDemo, replay } = useApp();
  const [open, setOpen] = useState(false);

  const tone =
    reliability.status === "insufficient"
      ? "neutral"
      : reliability.confidence === "high"
        ? "good"
        : reliability.confidence === "medium"
          ? "warn"
          : "bad";

  const label =
    reliability.status === "insufficient"
      ? "Insufficient history"
      : reliability.confidence === "high"
        ? "Reliable forecast"
        : reliability.confidence === "medium"
          ? "Fair forecast"
          : "Uncertain forecast";

  return (
    <div className={`reliability ${inline ? "inline" : ""}`}>
      <button
        className={`reliability-toggle tone-${tone}`}
        aria-expanded={open}
        aria-controls="reliability-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`status-dot ${tone === "bad" ? "bad" : tone === "warn" ? "warn" : tone === "good" ? "good" : "neutral"}`} aria-hidden="true" />
        <span className="reliability-label">Forecast reliability</span>
        <strong>{label}</strong>
        <Icon name="chevron-down" size={14} className={open ? "rotated" : ""} />
      </button>

      {open && (
        <div className="reliability-panel" id="reliability-panel" role="region" aria-label="Forecast reliability details">
          <dl>
            <div>
              <dt>Intended range</dt>
              <dd>Next {reliability.horizon} days from today</dd>
            </div>
            <div>
              <dt>History used</dt>
              <dd>
                {reliability.historyDays > 0
                  ? `${reliability.historyDays} days · ${reliability.transactionCount} transactions`
                  : "No transactions yet"}
              </dd>
            </div>
            <div>
              <dt>Days with activity (last {reliability.coverageWindow})</dt>
              <dd>
                {reliability.status === "insufficient"
                  ? "Insufficient history"
                  : `${percent(reliability.coverage * 100, 0)} · ${reliability.coverageDays} of ${reliability.coverageWindow} days`}
              </dd>
            </div>
            <div>
              <dt>Average daily error</dt>
              <dd>
                {reliability.meanDailyError === null
                  ? "Insufficient history"
                  : `${money(reliability.meanDailyError)} per day`}
              </dd>
            </div>
            <div>
              <dt>30-day backtest error</dt>
              <dd>
                {reliability.endErrorPercent === null
                  ? "Insufficient history"
                  : `${percent(reliability.endErrorPercent, 1)} at the end of the window`}
              </dd>
            </div>
            <div>
              <dt>Past purchase decisions replayed</dt>
              <dd>
                {reliability.replaySampleSize === 0
                  ? "None yet"
                  : `${reliability.replaySampleSize} · ${percent((reliability.replayAccuracy ?? 0) * 100, 0)} landed inside the estimate range`}
              </dd>
            </div>
            <div>
              <dt>Sample size</dt>
              <dd>{reliability.sampleSize} recorded transactions</dd>
            </div>
          </dl>
          <p className="reliability-method">{reliability.method}</p>
          <p className="reliability-note">
            <Icon name="alert" size={13} /> Forecasts are estimates. Actual amounts and payment dates may differ,
            and your balance can fall outside the displayed range.
          </p>
          {replay.length > 0 && (
            <div className="reliability-replay">
              <span className="subtle small">Most recent replay</span>
              <ul>
                {replay.slice(0, 2).map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {entry.label} · {shortDate(entry.date)}
                    </span>
                    <span className={entry.withinBand ? "positive" : "negative"}>
                      {entry.withinBand ? "Inside range" : "Outside range"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isDemo && <p className="footnote">You are looking at the demo workspace, so these numbers are about the sample data.</p>}
        </div>
      )}
    </div>
  );
}

export function UncertaintyNote() {
  return (
    <p className="uncertainty-note">
      <Icon name="alert" size={13} />
      Forecasts are estimates. Actual amounts and payment dates may differ, and your balance can fall outside the
      displayed range.
    </p>
  );
}
