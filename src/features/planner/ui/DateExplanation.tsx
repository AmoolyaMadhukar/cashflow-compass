import type { Explanation, IsoDate, Ledger, PurchaseSchedule } from "../engine/types";
import { HelpTip, VerdictPill } from "./atoms";
import { dayLabel, money } from "./format";

export function DateExplanation({
  explanation,
  date,
  ledger,
  reserve,
  purchaseDate,
  schedule,
  insufficient,
}: {
  explanation: Explanation;
  date: IsoDate;
  ledger: Ledger;
  reserve: number;
  purchaseDate: IsoDate;
  schedule: PurchaseSchedule;
  insufficient: boolean;
}) {
  const triggerTone =
    explanation.trigger.kind === "everyday"
      ? "warn"
      : explanation.trigger.kind === "bill"
        ? "bad"
        : "neutral";

  return (
    <section className="pp-card" aria-labelledby="pp-explain-title">
      <div className="pp-card-head">
        <div>
          <h2 id="pp-explain-title">3 · Why {dayLabel(date)} behaves this way</h2>
          <p className="pp-card-sub">
            Deterministic figures from your own forecast — no probability is modelled here.
          </p>
        </div>
        <VerdictPill verdict={explanation.outcome} passes={explanation.passes} tested={explanation.tested} />
      </div>

      {insufficient && (
        <p className="pp-warn-inline">
          <span aria-hidden="true">⚠</span> Insufficient forecast window — this date's follow-up period runs
          past the end of the forecast, so it is not graded and no reserve verdict is claimed.
        </p>
      )}

      <div className="pp-stat-grid">
        <div className="pp-stat">
          <span className="pp-stat-label">
            Lowest balance
            <HelpTip label="lowest balance">
              The smallest projected balance between the purchase date and the end of the follow-up period,
              under the receipt-delay assumption you selected.
            </HelpTip>
          </span>
          <strong className={`pp-stat-value pp-num ${explanation.lowestBalance < reserve ? "pp-bad" : "pp-ok"}`}>
            {money(explanation.lowestBalance)}
          </strong>
          <span className="pp-stat-hint">on {dayLabel(explanation.lowestDate)}</span>
        </div>

        <div className="pp-stat">
          <span className="pp-stat-label">First reserve breach</span>
          {explanation.firstBreach ? (
            <>
              <strong className="pp-stat-value pp-num pp-bad">{money(explanation.firstBreach.balance)}</strong>
              <span className="pp-stat-hint">
                {dayLabel(explanation.firstBreach.date)} · {money(explanation.firstBreach.shortfall)} short
              </span>
            </>
          ) : (
            <>
              <strong className="pp-stat-value pp-num pp-ok">None</strong>
              <span className="pp-stat-hint">reserve of {money(reserve)} holds</span>
            </>
          )}
        </div>

        <div className="pp-stat">
          <span className="pp-stat-label">First negative balance</span>
          {explanation.firstNegative ? (
            <>
              <strong className="pp-stat-value pp-num pp-bad">{money(explanation.firstNegative.balance)}</strong>
              <span className="pp-stat-hint">on {dayLabel(explanation.firstNegative.date)}</span>
            </>
          ) : (
            <>
              <strong className="pp-stat-value pp-num pp-ok">None</strong>
              <span className="pp-stat-hint">stays above zero</span>
            </>
          )}
        </div>

        <div className="pp-stat">
          <span className="pp-stat-label">Scenario count</span>
          <strong className="pp-stat-value pp-num">
            {explanation.passes} of {explanation.tested}
          </strong>
          <span className="pp-stat-hint">tested delays pass</span>
        </div>
      </div>

      <div className={`pp-trigger pp-trigger-${triggerTone}`}>
        <h3>What drives this</h3>
        <p>
          <strong>{explanation.trigger.label}</strong>
          {explanation.trigger.date ? ` on ${dayLabel(explanation.trigger.date)}` : ""}
        </p>
        <p className="pp-hint">{explanation.trigger.evidence}</p>
      </div>

      <div className="pp-movements">
        <h3>Cash movements in this window</h3>
        {explanation.movements.length === 0 ? (
          <p className="pp-hint">No scheduled movements between the purchase and the floor.</p>
        ) : (
          <ul>
            {explanation.movements.map((movement, index) => (
              <li key={`${movement.date}-${movement.label}-${index}`}>
                <span className="pp-movement-date">{dayLabel(movement.date)}</span>
                <span className="pp-movement-label">
                  {movement.label}
                  <span className="pp-muted"> · {movement.note}</span>
                </span>
                <span className={`pp-num ${movement.direction === "income" ? "pp-ok" : "pp-bad"}`}>
                  {movement.direction === "income" ? "+" : "−"}
                  {money(movement.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <BalanceTrace
        ledger={ledger}
        reserve={reserve}
        purchaseDate={purchaseDate}
        firstBreach={explanation.firstBreach?.date ?? null}
      />

      <div className="pp-sentences">
        {explanation.sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>

      <p className="pp-hint">
        Payment shape: {schedule.rows.length} dated outflow{schedule.rows.length === 1 ? "" : "s"}, first on{" "}
        {dayLabel(schedule.rows[0]?.date ?? purchaseDate)}.
      </p>
    </section>
  );
}

/** A small balance trace: baseline vs the hypothetical purchase. */
export function BalanceTrace({
  ledger,
  reserve,
  purchaseDate,
  firstBreach,
}: {
  ledger: Ledger;
  reserve: number;
  purchaseDate: IsoDate;
  firstBreach: IsoDate | null;
}) {
  const days = ledger.days;
  if (days.length < 2) return null;
  const width = 100;
  const height = 34;
  const values = days.flatMap((day) => [day.base, day.plan, reserve]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (index: number) => (index / (days.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / span) * height;
  const path = (pick: (day: (typeof days)[number]) => number) =>
    days.map((day, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(pick(day)).toFixed(2)}`).join(" ");
  const purchaseIndex = days.findIndex((day) => day.date >= purchaseDate);
  const breachIndex = firstBreach ? days.findIndex((day) => day.date === firstBreach) : -1;

  return (
    <div className="pp-trace" role="img" aria-label="Projected balance with and without this purchase">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="pp-trace-reserve" x1={0} x2={width} y1={y(reserve)} y2={y(reserve)} />
        <path className="pp-trace-base" d={path((day) => day.base)} />
        <path className="pp-trace-plan" d={path((day) => day.plan)} />
        {purchaseIndex >= 0 && (
          <line
            className="pp-trace-purchase"
            x1={x(purchaseIndex)}
            x2={x(purchaseIndex)}
            y1={0}
            y2={height}
          />
        )}
        {breachIndex >= 0 && <circle className="pp-trace-breach" cx={x(breachIndex)} cy={y(days[breachIndex].plan)} r={1.6} />}
      </svg>
      <div className="pp-trace-legend">
        <span className="pp-legend-line pp-legend-base" /> Without this purchase
        <span className="pp-legend-line pp-legend-plan" /> With this purchase
        <span className="pp-legend-line pp-legend-reserve" /> Your reserve
      </div>
    </div>
  );
}
