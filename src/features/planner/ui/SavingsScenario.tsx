import { useMemo, useState } from "react";
import type { IsoDate, PlannerData } from "../engine/types";
import { runSavingsScenario } from "../engine/savings";
import { addDays } from "../engine/dates";
import { dayLabel, money } from "./format";
import { HelpTip } from "./atoms";

export function SavingsScenario({ data }: { data: PlannerData }) {
  const [amount, setAmount] = useState(Math.round(Math.max(5000, data.reserve)));
  const [pot, setPot] = useState<"accessible" | "locked">("locked");
  const [releaseDate, setReleaseDate] = useState<IsoDate>(addDays(data.today, 60));
  const [useReturn, setUseReturn] = useState(false);
  const [returnPercent, setReturnPercent] = useState(6);

  const result = useMemo(
    () =>
      runSavingsScenario({
        data,
        amount,
        pot,
        releaseDate,
        assumedReturnPercent: useReturn ? returnPercent : 0,
      }),
    [data, amount, pot, releaseDate, useReturn, returnPercent],
  );

  return (
    <section className="pp-card" aria-labelledby="pp-savings-title">
      <div className="pp-card-head">
        <div>
          <h2 id="pp-savings-title">Savings scenario</h2>
          <p className="pp-card-sub">
            How much can you set aside and still cover every expected bill? Use this after the purchase
            calendar and replay.
          </p>
        </div>
      </div>

      <div className="pp-controls">
        <label className="pp-field">
          <span>Amount to set aside (₹)</span>
          <input
            type="number"
            min={0}
            step={1000}
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))}
          />
        </label>
        <fieldset className="pp-fieldset">
          <legend>Type of pot</legend>
          <div className="pp-seg">
            <button
              type="button"
              className={pot === "accessible" ? "active" : ""}
              aria-pressed={pot === "accessible"}
              onClick={() => setPot("accessible")}
            >
              Accessible
            </button>
            <button
              type="button"
              className={pot === "locked" ? "active" : ""}
              aria-pressed={pot === "locked"}
              onClick={() => setPot("locked")}
            >
              Locked
            </button>
          </div>
        </fieldset>
        {pot === "locked" && (
          <label className="pp-field">
            <span>Locked until</span>
            <input
              type="date"
              value={releaseDate}
              min={data.today}
              max={data.forecastEnd}
              onChange={(event) => setReleaseDate(event.target.value)}
            />
          </label>
        )}
        <label className="pp-field">
          <span>
            Assumed return (optional)
            <HelpTip label="assumed return">
              A user-entered guess, not a forecast. The planner always shows a zero-return case alongside it.
            </HelpTip>
          </span>
          <span className="pp-inline-toggle">
            <input
              type="checkbox"
              checked={useReturn}
              onChange={(event) => setUseReturn(event.target.checked)}
              aria-label="Include an assumed return"
            />
            <input
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={returnPercent}
              disabled={!useReturn}
              onChange={(event) => setReturnPercent(Number(event.target.value))}
            />
            <em className="pp-field-note">% per year (assumed)</em>
          </span>
        </label>
      </div>

      <div className="pp-stat-grid">
        <div className="pp-stat">
          <span className="pp-stat-label">Largest safe amount</span>
          <strong className="pp-stat-value pp-num pp-ok">{money(result.maxSafeAmount)}</strong>
          <span className="pp-stat-hint">keeps every bill covered</span>
        </div>
        <div className="pp-stat">
          <span className="pp-stat-label">Zero-return, lowest balance</span>
          <strong className={`pp-stat-value pp-num ${result.zeroReturn.firstBreach ? "pp-bad" : "pp-ok"}`}>
            {money(result.zeroReturn.lowestBalance)}
          </strong>
          <span className="pp-stat-hint">on {dayLabel(result.zeroReturn.lowestDate)}</span>
        </div>
        {result.withReturn && (
          <div className="pp-stat">
            <span className="pp-stat-label">With {returnPercent}% assumed return</span>
            <strong className="pp-stat-value pp-num">{money(result.withReturn.finalBalance)}</strong>
            <span className="pp-stat-hint">{money(result.withReturn.returnAmount)} assumed gain, labelled</span>
          </div>
        )}
        {pot === "locked" && (
          <div className="pp-stat">
            <span className="pp-stat-label">Spendable before release</span>
            <strong className={`pp-stat-value pp-num ${result.zeroReturn.lowestSpendable < data.reserve ? "pp-bad" : "pp-ok"}`}>
              {money(result.zeroReturn.lowestSpendable)}
            </strong>
            <span className="pp-stat-hint">on {dayLabel(result.zeroReturn.lowestSpendableDate)}</span>
          </div>
        )}
      </div>

      <p className={result.breachesReserve ? "pp-warn-inline" : "pp-good-inline"}>
        <span aria-hidden="true">{result.breachesReserve ? "⚠" : "✓"}</span>{" "}
        {result.breachesReserve && result.firstBreach
          ? `Setting aside ${money(amount)} crosses your reserve on ${dayLabel(result.firstBreach.date)} (${money(result.firstBreach.balance)}).`
          : `Setting aside ${money(amount)} keeps your reserve intact through the forecast.`}
      </p>
      <p className="pp-hint">{result.note}</p>
      <p className="pp-hint">
        The locked pot is withheld from your spendable cash until the release date, then returned. No return is
        assumed unless you enter one.
      </p>
    </section>
  );
}
