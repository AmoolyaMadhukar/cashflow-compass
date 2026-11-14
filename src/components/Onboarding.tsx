import { useState } from "react";
import { useApp } from "../store";
import { money, shortDate } from "../lib/format";
import { Icon } from "./Icon";
import { Field } from "./ui";

/**
 * First-run chooser. Three equal choices, and only then the dated opening balance
 * and optional reserve — with short examples rather than jargon.
 */
export function Onboarding({ onImport }: { onImport: () => void }) {
  const { beginFresh, openDemo, completeOnboarding, setOpening, setReserve, migrationNote, dismissMigrationNote } =
    useApp();
  const [step, setStep] = useState<"choose" | "opening">("choose");
  const [opening, setOpeningInput] = useState("");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [reserve, setReserveValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const finishFresh = () => {
    const amount = Number(opening || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter the cash you had on that date, or leave it at zero.");
      return;
    }
    if (!openingDate) {
      setError("Choose the date your opening balance refers to.");
      return;
    }
    beginFresh();
    setOpening(Math.round(amount), openingDate);
    setReserve(Math.round(Number(reserve || 0)));
    completeOnboarding();
  };

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <header className="onboarding-head">
          <span className="brand-mark">
            <Icon name="compass" size={24} />
          </span>
          <div>
            <h1>CashFlow Compass</h1>
            <p>Can I buy this, cover my bills, and keep my reserve — even if a client pays late?</p>
          </div>
        </header>

        {migrationNote && (
          <div className="notice notice-info">
            <Icon name="info" size={16} />
            <div>
              <strong>Your earlier data was kept.</strong>
              <p>{migrationNote}</p>
              <button className="btn btn-ghost btn-sm" onClick={dismissMigrationNote}>
                Got it
              </button>
            </div>
          </div>
        )}

        {step === "choose" ? (
          <>
            <div className="choice-grid">
              <button
                className="choice-card"
                onClick={() => setStep("opening")}
              >
                <span className="choice-icon"><Icon name="plus" size={20} /></span>
                <h2>Start fresh</h2>
                <p>An empty workspace. You add your own money in and out, or import a statement.</p>
                <span className="choice-cta">Choose <Icon name="arrow-right" size={14} /></span>
              </button>
              <button
                className="choice-card"
                onClick={() => {
                  completeOnboarding();
                  onImport();
                }}
              >
                <span className="choice-icon"><Icon name="upload" size={20} /></span>
                <h2>Import a CSV</h2>
                <p>Bring a bank or UPI export. You review totals and duplicates before anything is saved.</p>
                <span className="choice-cta">Choose <Icon name="arrow-right" size={14} /></span>
              </button>
              <button
                className="choice-card demo"
                onClick={() => {
                  completeOnboarding();
                  openDemo({ force: true });
                }}
              >
                <span className="choice-icon"><Icon name="sparkles" size={20} /></span>
                <h2>Explore demo</h2>
                <p>A fictional freelance household with 25 months of history. Clearly labelled, and it never mixes with your data.</p>
                <span className="choice-cta">Choose <Icon name="arrow-right" size={14} /></span>
              </button>
            </div>
            <p className="onboarding-note subtle small">
              <Icon name="shield" size={12} /> Everything stays in this browser. No bank connection, no account, no
              payments.
            </p>
          </>
        ) : (
          <div className="opening-step">
            <h2>What is in your account today?</h2>
            <p className="subtle small">
              This is the cash you can actually spend — not your salary, not your savings. If you are not sure, zero
              is fine and you can change it later.
            </p>
            <div className="form-grid">
              <Field label="Opening balance (₹)" hint="Example: the amount in your current account this morning." htmlFor="onb-opening">
                <input
                  id="onb-opening"
                  type="number"
                  min={0}
                  step={500}
                  value={opening}
                  placeholder="e.g. 45000"
                  onChange={(event) => setOpeningInput(event.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="As of" hint="The balance on this date." htmlFor="onb-date">
                <input
                  id="onb-date"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={openingDate}
                  onChange={(event) => setOpeningDate(event.target.value)}
                />
              </Field>
              <div className="form-span-2">
                <Field
                  label="Minimum reserve (optional)"
                  hint="Example: ₹1,50,000 kept aside for rent and EMIs. Forecasts flag any day you would go below it."
                  htmlFor="onb-reserve"
                >
                  <input
                    id="onb-reserve"
                    type="number"
                    min={0}
                    step={5000}
                    value={reserve}
                    placeholder="e.g. 150000"
                    onChange={(event) => setReserveValue(event.target.value)}
                  />
                </Field>
              </div>
            </div>
            {opening && Number(opening) > 0 && (
              <p className="preview-amount">
                Starting cash <strong>{money(Number(opening))}</strong> as of {shortDate(openingDate)}
                {reserve && Number(reserve) > 0 ? ` · reserve ${money(Number(reserve))}` : " · no reserve set"}.
              </p>
            )}
            {error && <div className="inline-error" role="alert">{error}</div>}
            <div className="button-row">
              <button className="btn btn-ghost" onClick={() => setStep("choose")}>
                Back
              </button>
              <button className="btn btn-primary" onClick={finishFresh}>
                Create my workspace <Icon name="arrow-right" size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}