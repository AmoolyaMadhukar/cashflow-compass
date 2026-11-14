import { useMemo, useState } from "react";
import type {
  IsoDate,
  PaymentMethod,
  Priority,
  PurchasePlan,
  PurchaseSchedule,
} from "../engine/types";
import { DEFAULT_CUSTOM_LOAN, DEFAULT_EMI } from "../engine/types";
import { buildPurchaseSchedule, scheduleEndNote } from "../engine/schedule";
import { addDays } from "../engine/dates";
import { money } from "./format";
import { HelpTip } from "./atoms";

const PRIORITIES: { value: Priority; label: string; hint: string }[] = [
  { value: "urgent", label: "Urgent", hint: "Needed as soon as possible — defaults to the earliest date." },
  { value: "planned", label: "Planned", hint: "Some flexibility but a preferred window." },
  { value: "flexible", label: "Flexible", hint: "Can wait if the money works better later." },
];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "full", label: "Pay in full" },
  { value: "emi", label: "EMI" },
  { value: "custom-loan", label: "Custom loan" },
];

export interface PurchaseFormProps {
  today: IsoDate;
  /** Latest date the forecast can grade. */
  forecastEnd: IsoDate;
  /** Last date that still has a full follow-up period, for the warning copy. */
  gradedThrough: IsoDate;
  value: PurchasePlan;
  onChange: (plan: PurchasePlan) => void;
  onReset: () => void;
  /** Recorded purchases (explicitly saved by the user). */
  recordedCount: number;
}

export function PurchaseForm({
  today,
  forecastEnd,
  gradedThrough,
  value,
  onChange,
  onReset,
  recordedCount,
}: PurchaseFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [note, setNote] = useState("");

  const schedule: PurchaseSchedule = useMemo(
    () => buildPurchaseSchedule(value, forecastEnd),
    [value, forecastEnd],
  );

  const patch = (next: Partial<PurchasePlan>) => onChange({ ...value, ...next });

  const validate = () => {
    if (value.item.trim().length < 2) return "Give the item a short name, e.g. “New laptop”.";
    if (!Number.isFinite(value.price) || value.price <= 0) return "Enter a price above zero.";
    if (!value.earliestDate) return "Choose the earliest purchase date.";
    if (!value.latestDate) return "Choose the latest acceptable date.";
    if (value.latestDate < value.earliestDate) return "The latest acceptable date must be on or after the earliest date.";
    if (value.earliestDate < today) return "The earliest purchase date cannot be in the past.";
    return null;
  };

  const validationError = validate();

  return (
    <section className="pp-card" aria-labelledby="pp-form-title">
      <div className="pp-card-head">
        <div>
          <h2 id="pp-form-title">1 · The purchase</h2>
          <p className="pp-card-sub">
            Hypothetical until you record it — nothing here changes your transactions.
          </p>
        </div>
        <button type="button" className="pp-btn pp-btn-ghost pp-btn-sm" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="pp-form">
        <label className="pp-field pp-span-2">
          <span>What are you buying?</span>
          <input
            type="text"
            value={value.item}
            placeholder="e.g. New laptop"
            onChange={(event) => patch({ item: event.target.value })}
          />
        </label>

        <label className="pp-field">
          <span>Price (₹)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={500}
            value={value.price || ""}
            onChange={(event) => patch({ price: Number(event.target.value) })}
          />
        </label>

        <label className="pp-field">
          <span>
            Earliest purchase date
            {value.priority === "urgent" && <em className="pp-field-note"> urgent → today</em>}
          </span>
          <input
            type="date"
            value={value.earliestDate}
            min={today}
            max={forecastEnd}
            onChange={(event) => patch({ earliestDate: event.target.value })}
          />
        </label>

        <label className="pp-field">
          <span>Latest acceptable date</span>
          <input
            type="date"
            value={value.latestDate}
            min={value.earliestDate || today}
            max={forecastEnd}
            onChange={(event) => patch({ latestDate: event.target.value })}
          />
        </label>

        <fieldset className="pp-fieldset pp-span-2">
          <legend>Priority</legend>
          <div className="pp-seg">
            {PRIORITIES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={value.priority === option.value ? "active" : ""}
                aria-pressed={value.priority === option.value}
                title={option.hint}
                onClick={() =>
                  patch({
                    priority: option.value,
                    // Urgent items default to the earliest possible date, but stay hypothetical.
                    earliestDate:
                      option.value === "urgent" && value.earliestDate > today ? today : value.earliestDate,
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="pp-hint">{PRIORITIES.find((option) => option.value === value.priority)?.hint}</p>
        </fieldset>

        <fieldset className="pp-fieldset pp-span-2">
          <legend>How will you pay?</legend>
          <div className="pp-seg">
            {METHODS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={value.method === option.value ? "active" : ""}
                aria-pressed={value.method === option.value}
                onClick={() =>
                  patch({
                    method: option.value,
                    emi: value.emi ?? DEFAULT_EMI,
                    customLoan: value.customLoan ?? DEFAULT_CUSTOM_LOAN,
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {value.method === "emi" && value.emi && (
          <div className="pp-subgrid pp-span-2">
            <label className="pp-field">
              <span>Down payment (₹)</span>
              <input
                type="number"
                min={0}
                step={500}
                value={value.emi.downPayment || ""}
                onChange={(event) => patch({ emi: { ...value.emi!, downPayment: Number(event.target.value) } })}
              />
            </label>
            <label className="pp-field">
              <span>Processing fee (₹)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={value.emi.processingFee || ""}
                onChange={(event) => patch({ emi: { ...value.emi!, processingFee: Number(event.target.value) } })}
              />
            </label>
            <label className="pp-field">
              <span>Instalments</span>
              <input
                type="number"
                min={1}
                max={36}
                value={value.emi.instalments}
                onChange={(event) =>
                  patch({ emi: { ...value.emi!, instalments: Math.max(1, Number(event.target.value)) } })
                }
              />
            </label>
            <label className="pp-field">
              <span>Monthly rate (%)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={value.emi.monthlyRatePercent}
                onChange={(event) =>
                  patch({ emi: { ...value.emi!, monthlyRatePercent: Number(event.target.value) } })
                }
              />
            </label>
          </div>
        )}

        {value.method === "custom-loan" && value.customLoan && (
          <div className="pp-subgrid pp-span-2">
            <label className="pp-field">
              <span>Down payment (₹)</span>
              <input
                type="number"
                min={0}
                step={500}
                value={value.customLoan.downPayment || ""}
                onChange={(event) =>
                  patch({ customLoan: { ...value.customLoan!, downPayment: Number(event.target.value) } })
                }
              />
            </label>
            <label className="pp-field">
              <span>Fee (₹)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={value.customLoan.processingFee || ""}
                onChange={(event) =>
                  patch({ customLoan: { ...value.customLoan!, processingFee: Number(event.target.value) } })
                }
              />
            </label>
            <label className="pp-field">
              <span>Instalments</span>
              <input
                type="number"
                min={1}
                max={36}
                value={value.customLoan.instalments}
                onChange={(event) =>
                  patch({ customLoan: { ...value.customLoan!, instalments: Math.max(1, Number(event.target.value)) } })
                }
              />
            </label>
            <label className="pp-field">
              <span>Flat interest (%)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={value.customLoan.flatInterestPercent}
                onChange={(event) =>
                  patch({ customLoan: { ...value.customLoan!, flatInterestPercent: Number(event.target.value) } })
                }
              />
            </label>
          </div>
        )}

        <button
          type="button"
          className="pp-disclosure pp-span-2"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? "▾" : "▸"} Optional fields
        </button>

        {advancedOpen && (
          <div className="pp-subgrid pp-span-2">
            <label className="pp-field pp-span-2">
              <span>Note for this purchase (optional)</span>
              <input
                type="text"
                placeholder="e.g. before the trip on 12 Mar"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                aria-describedby="pp-optional-note"
              />
            </label>
            <p className="pp-hint pp-span-2" id="pp-optional-note">
              Only stored with the recorded purchase — it does not change any projection.
            </p>
          </div>
        )}

        {validationError && (
          <p className="pp-error pp-span-2" role="alert">
            {validationError}
          </p>
        )}
      </div>

      {schedule.rows.length > 0 && (
        <div className="pp-schedule">
          <div className="pp-schedule-head">
            <h3>
              Payment shape
              <HelpTip label="payment shape">
                The exact dated outflows this plan creates. The planner uses only the cash leaving on the
                purchase date to decide which dates are eligible.
              </HelpTip>
            </h3>
            <span className="pp-schedule-total pp-num">Total paid {money(schedule.totalPaid)}</span>
          </div>
          <dl className="pp-schedule-grid">
            <div>
              <dt>Upfront</dt>
              <dd className="pp-num">{money(schedule.rows[0].amount)}</dd>
            </div>
            {value.method !== "full" && (
              <>
                <div>
                  <dt>Down payment</dt>
                  <dd className="pp-num">{money(schedule.downPayment)}</dd>
                </div>
                <div>
                  <dt>Fees</dt>
                  <dd className="pp-num">{money(schedule.fees)}</dd>
                </div>
                <div>
                  <dt>Financed</dt>
                  <dd className="pp-num">{money(schedule.financed)}</dd>
                </div>
                <div>
                  <dt>Instalments</dt>
                  <dd className="pp-num">
                    {schedule.instalments} × {money(schedule.instalmentAmount)}
                  </dd>
                </div>
              </>
            )}
          </dl>
          <p className="pp-hint">{scheduleEndNote(schedule, forecastEnd)}</p>
          {schedule.outsideWindow > 0 && (
            <p className="pp-warn-inline">
              <span aria-hidden="true">⚠</span> {schedule.outsideWindow} commitment
              {schedule.outsideWindow === 1 ? "" : "s"} extend past the chart, so the forecast cannot grade
              them.
            </p>
          )}
        </div>
      )}

      <div className="pp-form-foot">
        <p className="pp-hint">
          {recordedCount === 0
            ? "No purchases recorded yet — everything below is a what-if."
            : `${recordedCount} purchase${recordedCount === 1 ? "" : "s"} recorded on this device.`}
        </p>
        {value.earliestDate > gradedThrough && (
          <p className="pp-warn-inline">
            <span aria-hidden="true">⚠</span> Dates after {gradedThrough} do not have a full follow-up
            window in the current forecast. Extend the forecast to grade them.
          </p>
        )}
        <button type="button" className="pp-btn pp-btn-ghost pp-btn-sm" onClick={() => patch({ latestDate: addDays(value.earliestDate, 20) })}>
          Allow a 20-day window
        </button>
      </div>
    </section>
  );
}
