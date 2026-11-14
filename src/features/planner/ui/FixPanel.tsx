import type { FixOption, IsoDate } from "../engine/types";
import type { FixSearchResult } from "../engine/fixes";
import { dayLabel, money } from "./format";
import { HelpTip } from "./atoms";

export interface FixPanelProps {
  fixes: FixSearchResult;
  purchaseDate: IsoDate;
  /** Currently applied hypothetical change, if any. */
  applied: string | null;
  onPreview: (fix: FixOption) => void;
  onApply: (fix: FixOption) => void;
  onUndo: () => void;
  onReset: () => void;
  canUndo: boolean;
}

function FixCard({
  fix,
  applied,
  onPreview,
  onApply,
  previewing,
}: {
  fix: FixOption;
  applied: string | null;
  onPreview: (fix: FixOption) => void;
  onApply: (fix: FixOption) => void;
  previewing: boolean;
}) {
  const isApplied = applied === fix.kind;
  return (
    <li className={`pp-fix${isApplied ? " applied" : ""}${previewing ? " previewing" : ""}`}>
      <div className="pp-fix-head">
        <strong>{fix.label}</strong>
        {fix.works ? (
          <span className="pp-pill pp-pill-ok">
            <span className="pp-pill-icon" aria-hidden="true">
              ✓
            </span>
            Workable
          </span>
        ) : (
          <span className="pp-pill pp-pill-bad">
            <span className="pp-pill-icon" aria-hidden="true">
              ✕
            </span>
            Still short
          </span>
        )}
      </div>
      <p className="pp-hint">{fix.detail}</p>
      {fix.secondShortage && (
        <p className="pp-warn-inline">
          <span aria-hidden="true">⚠</span> A second shortage remains on {dayLabel(fix.secondShortage.date)} (
          {money(fix.secondShortage.balance)}
          {fix.outsideTestedWindow ? ", outside the tested window" : ""}).
        </p>
      )}
      {fix.outsideTestedWindow && !fix.secondShortage && (
        <p className="pp-warn-inline">
          <span aria-hidden="true">⚠</span> A later shortfall falls outside the tested window — extend the
          forecast to confirm.
        </p>
      )}
      <div className="pp-fix-actions">
        <button type="button" className="pp-btn pp-btn-ghost pp-btn-sm" onClick={() => onPreview(fix)}>
          Preview
        </button>
        <button type="button" className="pp-btn pp-btn-primary pp-btn-sm" onClick={() => onApply(fix)}>
          {isApplied ? "Applied" : "Apply"}
        </button>
      </div>
    </li>
  );
}

export function FixPanel({
  fixes,
  purchaseDate,
  applied,
  onPreview,
  onApply,
  onUndo,
  onReset,
  canUndo,
}: FixPanelProps) {
  const options = [fixes.cheapestWorkingPrice, fixes.earliestWorkingDate, fixes.movableExpense].filter(
    (fix): fix is FixOption => fix !== null,
  );

  return (
    <section className="pp-card" aria-labelledby="pp-fix-title">
      <div className="pp-card-head">
        <div>
          <h2 id="pp-fix-title">4 · The smallest workable change</h2>
          <p className="pp-card-sub">
            Every fix keeps your selected receipt-delay assumption and is re-checked over the whole
            forecast, so a later shortage is never hidden.
          </p>
        </div>
        <div className="pp-row">
          <button type="button" className="pp-btn pp-btn-ghost pp-btn-sm" onClick={onUndo} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" className="pp-btn pp-btn-ghost pp-btn-sm" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>

      {fixes.baselineBreaches && (
        <p className="pp-warn-inline">
          <span aria-hidden="true">⚠</span> Your baseline already breaks the reserve on{" "}
          {fixes.baseline.firstBreach ? dayLabel(fixes.baseline.firstBreach.date) : "an earlier date"} (
          {money(fixes.baseline.firstBreach?.balance ?? fixes.baseline.lowestBalance)}). A fix for the purchase
          alone will not clear this.
        </p>
      )}

      {fixes.secondShortage && (
        <p className="pp-warn-inline">
          <span aria-hidden="true">⚠</span> Buying on {dayLabel(purchaseDate)} leaves a shortfall on{" "}
          {dayLabel(fixes.secondShortage.date)} ({money(fixes.secondShortage.balance)})
          {fixes.outsideTestedWindow ? " — outside the tested window, so confirm it with a longer follow-up." : "."}
        </p>
      )}

      {options.length === 0 ? (
        <div className="pp-empty">
          <p>
            No change works within your limits. {fixes.noDateWorks ? "No acceptable date works either." : ""}
          </p>
          <p className="pp-hint">
            Try a lower price, a later latest-acceptable date, or approve a flexibility window for a bill in
            your recurring list.
          </p>
        </div>
      ) : (
        <ul className="pp-fix-list">
          {options.map((fix) => (
            <FixCard
              key={fix.kind}
              fix={fix}
              applied={applied}
              onPreview={onPreview}
              onApply={onApply}
              previewing={applied === fix.kind}
            />
          ))}
        </ul>
      )}

      {applied && (
        <p className="pp-good-inline">
          <span aria-hidden="true">✓</span> A hypothetical change is applied to the figures above. Undo restores
          your original purchase. Nothing was saved to your transactions.
        </p>
      )}

      <p className="pp-hint">
        Reserve{" "}
        <HelpTip label="reserve">
          The cash floor you never want to go below. Every verdict asks whether the projected balance stays at
          or above this number.
        </HelpTip>{" "}
        comes from your app settings — change it there to see how the verdicts move.
      </p>
    </section>
  );
}
