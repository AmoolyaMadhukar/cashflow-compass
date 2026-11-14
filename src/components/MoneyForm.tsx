import { useEffect, useMemo, useState } from "react";
import type { Direction, Transaction } from "../types";
import { useApp } from "../store";
import { categoriesFor, suggestCategory } from "../lib/categorize";
import { addDays, money, shortDate, todayISO } from "../lib/format";
import { Field, Modal, Segmented } from "./ui";
import { Icon } from "./Icon";
import { ContextHelp } from "./ContextHelp";

export type FormMode = "recorded" | "expected" | "simulate";
export type FormAction = "in" | "out" | "transfer" | "emi" | "loan" | "asset";

const ACTION_LABEL: Record<FormAction, string> = {
  in: "Money in",
  out: "Money out",
  transfer: "Move to savings",
  emi: "Loan EMI",
  loan: "Loan received",
  asset: "Asset (optional)",
};

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

/**
 * One form for every entry. Only the fields relevant to the chosen action are
 * rendered, and the three modes are separated in plain words:
 *   recorded  → already happened, feeds today's balance
 *   expected  → future money, provisional until recorded
 *   simulate  → hypothetical only, never saved as a ledger row
 */
export function MoneyForm({
  open,
  onClose,
  initialAction = "in",
  initialMode = "recorded",
  initialAmount,
  initialLabel,
  editing = null,
  presetExpectedAmount,
}: {
  open: boolean;
  onClose: () => void;
  initialAction?: FormAction;
  initialMode?: FormMode;
  initialAmount?: number;
  initialLabel?: string;
  editing?: Transaction | null;
  presetExpectedAmount?: number;
}) {
  const {
    today,
    addTransaction,
    updateTransaction,
    addTransfer,
    addExpected,
    addAsset,
    addScenario,
    notify,
    merchantMemory,
    expected,
    recurring,
    setPage,
    cashToday,
    reserve,
  } = useApp();

  const [action, setAction] = useState<FormAction>(initialAction);
  const [mode, setMode] = useState<FormMode>(initialMode);
  const [direction, setDirection] = useState<Direction>(initialAction === "out" ? "expense" : "income");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Salary");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // recurring expense extras
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]["value"]>("monthly");
  const [priority, setPriority] = useState<"essential" | "flexible">("essential");
  const [latestDate, setLatestDate] = useState("");

  // loan / emi extras
  const [lender, setLender] = useState("");
  const [monthsRemaining, setMonthsRemaining] = useState("");

  // transfer
  const [fromAccount, setFromAccount] = useState<"cash" | "savings">("cash");

  useEffect(() => {
    if (!open) return;
    setAction(initialAction);
    setMode(initialMode);
    setDirection(initialAction === "out" || initialAction === "emi" ? "expense" : "income");
    setAmount(initialAmount ? String(initialAmount) : presetExpectedAmount ? String(presetExpectedAmount) : "");
    setDescription(initialLabel ?? "");
    setDate(today);
    setCategory(initialAction === "out" ? "Groceries" : "Salary");
    setCategoryTouched(false);
    setNote("");
    setError(null);
    setShowAdvanced(false);
    setLatestDate("");
    setFrequency("monthly");
    setPriority("essential");
    setLender("");
    setMonthsRemaining("");
    setFromAccount("cash");
  }, [open, initialAction, initialMode, initialAmount, initialLabel, presetExpectedAmount, today]);

  useEffect(() => {
    if (!editing) return;
    setMode("recorded");
    setDirection(editing.direction);
    setAction(editing.direction === "income" ? "in" : "out");
    setAmount(String(editing.amount));
    setDate(editing.date);
    setDescription(editing.description);
    setCategory(editing.category);
    setNote(editing.note ?? "");
    setCategoryTouched(true);
  }, [editing]);

  const numericAmount = Number(amount);
  const transferAvailable = fromAccount === "cash" ? cashToday : 0;

  const matchingExpected = useMemo(
    () =>
      expected
        .filter((item) => item.direction === direction)
        .filter((item) => item.label.toLowerCase() === description.trim().toLowerCase())
        .sort((a, b) => a.date.localeCompare(b.date))[0],
    [expected, direction, description],
  );

  const matchingRecurring = useMemo(
    () =>
      recurring
        .filter((item) => item.direction === direction)
        .filter((item) => item.label.toLowerCase() === description.trim().toLowerCase())[0],
    [recurring, direction, description],
  );

  const updateDescription = (value: string) => {
    setDescription(value);
    if (!categoryTouched && value.trim().length > 2) {
      setCategory(suggestCategory(value, direction, merchantMemory));
    }
  };

  const switchDirection = (next: Direction) => {
    setDirection(next);
    const options = categoriesFor(next) as readonly string[];
    setCategory(options.includes(category) ? category : next === "income" ? "Salary" : "Other");
    if (!categoryTouched && description.trim().length > 2) {
      setCategory(suggestCategory(description, next, merchantMemory));
    }
  };

  const chooseAction = (next: FormAction) => {
    setAction(next);
    setError(null);
    if (next === "in") {
      setMode("recorded");
      switchDirection("income");
      setCategory("Salary");
    } else if (next === "out") {
      setMode("recorded");
      switchDirection("expense");
    } else if (next === "emi" || next === "loan") {
      setMode(next === "emi" ? "expected" : "recorded");
      switchDirection(next === "emi" ? "expense" : "income");
      setCategory(next === "emi" ? "Loan EMI" : "Loan");
    } else if (next === "transfer") {
      setMode("recorded");
    }
  };

  const validate = (): string | null => {
    if (action === "asset") {
      if (!description.trim()) return "Name the asset, for example “Two-wheeler”.";
      if (!Number.isFinite(numericAmount) || numericAmount < 0) return "Enter the current value, or zero.";
      return null;
    }
    if (!date) return "Choose a date.";
    if (mode !== "simulate" && date > today && mode === "recorded") {
      return "That date is in the future. Record it when it happens, or switch to Expected in future.";
    }
    if (action === "transfer") {
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) return "Enter an amount greater than zero.";
      if (fromAccount === "cash" && mode === "recorded" && numericAmount > transferAvailable) {
        return `You have ${money(transferAvailable)} in cash today. Choose a smaller amount.`;
      }
      return null;
    }
    if (!description.trim() || description.trim().length < 2) {
      return "Add a short description, such as the payee or the purpose.";
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return "Enter an amount greater than zero.";
    if (mode === "expected" && date < today) return "Expected money should have a future or today's date.";
    if (latestDate && latestDate < date) return "The latest permitted date cannot be before the expected date.";
    return null;
  };

  const submit = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const rounded = Math.max(0, Math.round(numericAmount));

    if (action === "asset") {
      addAsset({ label: description.trim(), value: rounded, note: note.trim() || undefined });
      onClose();
      return;
    }

    if (action === "transfer") {
      addTransfer({
        date,
        amount: rounded,
        from: fromAccount,
        to: fromAccount === "cash" ? "savings" : "cash",
        note: note.trim() || undefined,
        status: mode === "recorded" ? "recorded" : "planned",
      });
      onClose();
      return;
    }

    if (mode === "simulate") {
      addScenario({
        name: description.trim(),
        amount: rounded,
        date,
        kind: action === "loan" ? "expense" : "expense",
      });
      notify("Saved as a scenario. Compare it in Plan a purchase.");
      setPage("plan");
      onClose();
      return;
    }

    if (mode === "expected") {
      addExpected({
        label: description.trim(),
        amount: rounded,
        direction,
        date,
        certainty: action === "emi" || action === "loan" ? "confirmed" : "likely",
        kind: action === "emi" ? "emi" : action === "loan" ? "invoice" : "manual",
        category: action === "emi" ? "Loan EMI" : action === "loan" ? "Loan" : category,
        recurringKey: matchingRecurring?.key,
        note: note.trim() || undefined,
      });
      onClose();
      return;
    }

    if (editing) {
      updateTransaction(editing.id, {
        date,
        description: description.trim(),
        amount: rounded,
        direction,
        category,
        note: note.trim() || undefined,
      });
      notify("Entry updated. Forecast recalculated.");
      onClose();
      return;
    }

    addTransaction({
      date,
      description: description.trim(),
      amount: rounded,
      direction,
      category,
      note: note.trim() || undefined,
      priority: action === "emi" ? priority : undefined,
    });
    onClose();
  };

  const title = editing ? "Edit entry" : ACTION_LABEL[action];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={
        editing
          ? "Changing this row recalculates today's balance and every forecast."
          : "Recorded money is fact. Expected money is a forecast input. Simulating changes nothing."
      }
      footer={
        <>
          <span className="footer-note subtle small">
            {mode === "recorded"
              ? `Cash today: ${money(cashToday)}`
              : mode === "expected"
                ? "Shown as provisional until you record it"
                : "Hypothetical — no ledger row is created"}
          </span>
          <div className="spacer" />
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {mode === "simulate"
              ? "Save scenario"
              : action === "transfer"
                ? mode === "expected"
                  ? "Schedule transfer"
                  : "Transfer now"
                : mode === "expected"
                  ? "Add expected money"
                  : editing
                    ? "Save changes"
                    : "Record it"}
          </button>
        </>
      }
    >
      {!editing && (
        <>
          <div className="action-tabs" role="tablist" aria-label="What are you entering?">
            {(["in", "out", "transfer"] as FormAction[]).map((option) => (
              <button
                key={option}
                role="tab"
                aria-selected={action === option}
                className={action === option ? "active" : ""}
                onClick={() => chooseAction(option)}
              >
                <Icon name={option === "in" ? "arrow-down" : option === "out" ? "arrow-up" : "wallet"} size={15} />
                {ACTION_LABEL[option]}
              </button>
            ))}
          </div>
          <div className="more-actions">
            <span className="subtle small">More:</span>
            {(["emi", "loan", "asset"] as FormAction[]).map((option) => (
              <button
                key={option}
                className={`chip-btn ${action === option ? "active" : ""}`}
                onClick={() => chooseAction(option)}
              >
                {ACTION_LABEL[option]}
              </button>
            ))}
          </div>

          {action !== "asset" && action !== "transfer" && (
            <div className="mode-block">
              <span className="field-label">
                When does it happen?
                <ContextHelp topic="spendable-today" label="What is the difference? " />
              </span>
              <Segmented
                label="Entry mode"
                value={mode}
                onChange={(value) => setMode(value as FormMode)}
                options={[
                  { value: "recorded", label: "Recorded today/past" },
                  { value: "expected", label: "Expected in future" },
                  { value: "simulate", label: "Simulate only" },
                ]}
              />
              <p className="mode-hint">
                {mode === "recorded"
                  ? "The money has already moved. It changes your balance right away."
                  : mode === "expected"
                    ? "The money has not moved yet. It shapes the forecast and stays labelled as an estimate."
                    : "Nothing is saved to your ledger. It becomes a scenario you can compare."}
              </p>
            </div>
          )}

          {action === "transfer" && (
            <div className="mode-block">
              <span className="field-label">Transfer type</span>
              <Segmented
                label="Transfer timing"
                value={mode === "expected" ? "expected" : "recorded"}
                onChange={(value) => setMode(value as FormMode)}
                options={[
                  { value: "recorded", label: "Move now / already moved" },
                  { value: "expected", label: "Schedule for later" },
                ]}
              />
            </div>
          )}
        </>
      )}

      <div className="form-grid">
        {action === "asset" ? (
          <>
            <div className="form-span-2">
              <Field label="Asset name" htmlFor="form-desc">
                <input
                  id="form-desc"
                  type="text"
                  value={description}
                  placeholder="e.g. Two-wheeler, fixed deposit"
                  onChange={(event) => setDescription(event.target.value)}
                  autoFocus
                />
              </Field>
            </div>
            <Field label="Current value (₹)" htmlFor="form-amount">
              <input
                id="form-amount"
                type="number"
                min={0}
                value={amount}
                placeholder="0"
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Note (optional)" htmlFor="form-note">
              <input id="form-note" type="text" value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </>
        ) : action === "transfer" ? (
          <>
            <Field label="Direction">
              <Segmented
                label="Transfer direction"
                value={fromAccount}
                onChange={(value) => setFromAccount(value as "cash" | "savings")}
                options={[
                  { value: "cash", label: "Cash → Savings" },
                  { value: "savings", label: "Savings → Cash" },
                ]}
              />
            </Field>
            <Field label="Date" htmlFor="form-date">
              <input
                id="form-date"
                type="date"
                value={date}
                min={mode === "recorded" ? undefined : today}
                max={mode === "recorded" ? today : addDays(today, 180)}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Field label="Amount (₹)" htmlFor="form-amount" hint={fromAccount === "cash" ? `Cash available: ${money(cashToday)}` : undefined}>
              <input
                id="form-amount"
                type="number"
                min={0}
                step={500}
                value={amount}
                placeholder="0"
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Note (optional)" htmlFor="form-note">
              <input id="form-note" type="text" value={note} placeholder="e.g. Emergency fund" onChange={(event) => setNote(event.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <div className="form-span-2">
              <Field
                label={action === "in" ? "Who paid you?" : action === "emi" ? "Lender and EMI name" : "What was it for?"}
                hint={
                  matchingExpected || matchingRecurring
                    ? "We found a matching expected item — you can link it after saving."
                    : "Type a few characters and we will suggest a category."
                }
                htmlFor="form-desc"
              >
                <input
                  id="form-desc"
                  type="text"
                  value={description}
                  placeholder={action === "in" ? "e.g. Acme retainer" : "e.g. HDFC personal loan EMI"}
                  onChange={(event) => updateDescription(event.target.value)}
                  autoFocus
                />
              </Field>
            </div>
            <Field label="Amount (₹)" htmlFor="form-amount">
              <input
                id="form-amount"
                type="number"
                min={1}
                step={1}
                value={amount}
                placeholder="0"
                inputMode="numeric"
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Date" htmlFor="form-date" hint={mode === "expected" ? "When you expect it" : undefined}>
              <input
                id="form-date"
                type="date"
                value={date}
                min={mode === "expected" ? today : addDays(today, -3650)}
                max={mode === "recorded" ? today : addDays(today, 180)}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            {action !== "emi" && action !== "loan" && (
              <Field label="Category" htmlFor="form-category">
                <select
                  id="form-category"
                  value={category}
                  onChange={(event) => {
                    setCategoryTouched(true);
                    setCategory(event.target.value);
                  }}
                >
                  {categoriesFor(direction).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Note (optional)" htmlFor="form-note">
              <input id="form-note" type="text" value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </>
        )}
      </div>

      {mode === "expected" && (action === "out" || action === "emi") && (
        <div className="advanced-block">
          <button
            className="advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((value) => !value)}
          >
            <Icon name="chevron-down" size={14} className={showAdvanced ? "rotated" : ""} />
            Schedule and priority (optional)
          </button>
          {showAdvanced && (
            <div className="form-grid">
              <Field label="How often?" htmlFor="form-frequency">
                <select
                  id="form-frequency"
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as typeof frequency)}
                >
                  {FREQUENCIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <Segmented
                  label="Expense priority"
                  value={priority}
                  onChange={(value) => setPriority(value as "essential" | "flexible")}
                  options={[
                    { value: "essential", label: "Essential" },
                    { value: "flexible", label: "Flexible" },
                  ]}
                />
              </Field>
              <div className="form-span-2">
                <Field
                  label="Latest permitted date"
                  hint="Used when suggesting a different date for this bill."
                  htmlFor="form-latest"
                >
                  <input
                    id="form-latest"
                    type="date"
                    min={date}
                    value={latestDate}
                    onChange={(event) => setLatestDate(event.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      )}

      {action === "emi" && (
        <div className="advanced-block">
          <button
            className="advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((value) => !value)}
          >
            <Icon name="chevron-down" size={14} className={showAdvanced ? "rotated" : ""} />
            Loan details (optional)
          </button>
          {showAdvanced && (
            <div className="form-grid">
              <Field label="Lender" htmlFor="form-lender">
                <input id="form-lender" type="text" value={lender} onChange={(event) => setLender(event.target.value)} />
              </Field>
              <Field label="EMIs remaining" htmlFor="form-months">
                <input
                  id="form-months"
                  type="number"
                  min={1}
                  value={monthsRemaining}
                  onChange={(event) => setMonthsRemaining(event.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {amount && Number(amount) > 0 && (
        <p className="preview-amount">
          {action === "transfer" ? (
            <>
              Move <strong>{money(Number(amount))}</strong> from {fromAccount} to {fromAccount === "cash" ? "savings" : "cash"} on{" "}
              {date || "—"}.
            </>
          ) : (
            <>
              {mode === "expected" ? "Expected" : mode === "simulate" ? "Simulated" : "Recorded"}{" "}
              {direction === "income" ? "money in" : "money out"} of <strong>{money(Number(amount))}</strong> on{" "}
              {date ? shortDate(date) : "—"}.
            </>
          )}
        </p>
      )}

      {error && (
        <div className="inline-error" role="alert">
          <Icon name="alert" size={15} /> {error}
        </div>
      )}

      <p className="form-safety subtle small">
        <Icon name="shield" size={12} /> This records a note about your money. It cannot move funds, and it stays on
        this device. Reserve: {money(reserve)}.
      </p>
    </Modal>
  );
}

/** Convenience for pages that deep-link into a specific form. */
export function useFormRequest() {
  const [request, setRequest] = useState<{ action: FormAction; mode: FormMode } | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const map: Record<string, { action: FormAction; mode: FormMode }> = {
        "add-income": { action: "in", mode: "recorded" },
        emi: { action: "emi", mode: "expected" },
        import: { action: "in", mode: "recorded" },
      };
      if (map[detail]) setRequest(map[detail]);
    };
    window.addEventListener("cfc:open-form", handler);
    return () => window.removeEventListener("cfc:open-form", handler);
  }, []);
  return { request, clear: () => setRequest(null) };
}

export const TODAY = todayISO();
