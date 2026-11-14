import { useState } from "react";
import { useApp } from "../store";
import { daysBetween, money, shortDate } from "../lib/format";
import type { Suggestion, SuggestionAction } from "../integration/types";
import { Badge } from "./ui";
import { Icon } from "./Icon";

const ACTION_LABEL: Record<SuggestionAction, string> = {
  "confirm-schedule": "Confirm schedule",
  "edit-date": "Edit date",
  "mark-received": "Mark received",
  "match-payment": "Match payment",
  "one-off": "One-off",
  dismiss: "Dismiss",
  "try-different-date": "Try a different date",
  "compare-dates": "Compare purchase dates",
  "set-aside": "Set money aside",
};

const ACTION_ICON: Record<SuggestionAction, string> = {
  "confirm-schedule": "check",
  "edit-date": "edit",
  "mark-received": "arrow-down",
  "match-payment": "repeat",
  "one-off": "plus",
  dismiss: "x",
  "try-different-date": "calendar",
  "compare-dates": "flask",
  "set-aside": "wallet",
};

export function ReviewQueue({ compact = false }: { compact?: boolean }) {
  const {
    suggestions,
    today,
    recurring,
    expected,
    setRecurringStatus,
    setRecurrencePrefs,
    decideSuggestion,
    addTransaction,
    addExpected,
    matchExpected,
    notify,
    setPage,
    workspace,
  } = useApp();
  const [expanded, setExpanded] = useState<string | null>(suggestions[0]?.id ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState("");

  const visible = compact ? suggestions.slice(0, 3) : suggestions;

  const run = (suggestion: Suggestion, action: SuggestionAction) => {
    switch (action) {
      case "confirm-schedule": {
        if (suggestion.recurringKey) {
          setRecurringStatus(suggestion.recurringKey, "confirmed");
          decideSuggestion(suggestion.id, "confirmed");
          notify(`Confirmed. “${suggestion.title}” is now in your forecast.`);
        }
        break;
      }
      case "edit-date": {
        setEditing(suggestion.id);
        setDraftDate(suggestion.date ?? today);
        break;
      }
      case "mark-received": {
        if (suggestion.recurringKey) {
          const item = recurring.find((entry) => entry.key === suggestion.recurringKey);
          if (item) {
            addTransaction({
              date: today,
              description: item.label,
              amount: item.typicalAmount,
              direction: item.direction,
              category: item.category,
            });
            decideSuggestion(suggestion.id, "received");
          }
        } else if (suggestion.expectedId) {
          const item = expected.find((entry) => entry.id === suggestion.expectedId);
          if (item) {
            addTransaction({
              date: today,
              description: item.label,
              amount: item.amount,
              direction: item.direction,
              category: item.category,
            });
          }
        }
        break;
      }
      case "match-payment": {
        const project = workspace.transactions.find((tx) => tx.id === suggestion.expectedId);
        const candidate = workspace.expected[0];
        if (project && candidate) matchExpected(candidate.id, project.id);
        setPage("activity");
        break;
      }
      case "one-off": {
        if (suggestion.recurringKey) {
          setRecurringStatus(suggestion.recurringKey, "dismissed");
          decideSuggestion(suggestion.id, "one-off");
          notify("Marked as a one-off. It stays in your history but is not forecast again.");
        }
        break;
      }
      case "dismiss": {
        decideSuggestion(suggestion.id, "dismiss");
        break;
      }
      case "try-different-date":
      case "compare-dates": {
        setPage("plan");
        break;
      }
      case "set-aside": {
        addExpected({
          label: "Set aside for reserve",
          amount: suggestion.amount ?? 0,
          direction: "expense",
          date: today,
          certainty: "likely",
          kind: "manual",
          category: "Savings",
        });
        break;
      }
      default:
        break;
    }
  };

  const saveDate = (suggestion: Suggestion) => {
    if (!suggestion.recurringKey || !draftDate) return;
    const item = recurring.find((entry) => entry.key === suggestion.recurringKey);
    if (!item) return;
    const shift = daysBetween(item.nextDate, draftDate);
    const extra = expected.find((entry) => entry.recurringKey === suggestion.recurringKey);
    if (extra) {
      notify("Open Upcoming to move the linked expected payment.");
    } else {
      addExpected({
        label: item.label,
        amount: item.typicalAmount,
        direction: item.direction,
        date: draftDate,
        certainty: "confirmed",
        kind: "recurring",
        category: item.category,
        recurringKey: item.key,
      });
    }
    setRecurrencePrefs(item.key, { nextDue: draftDate });
    setRecurringStatus(item.key, "confirmed");
    decideSuggestion(suggestion.id, `moved ${shift} days`);
    notify(`Date changed to ${shortDate(draftDate)}. The forecast now uses that date.`);
    setEditing(null);
  };

  if (visible.length === 0) {
    return (
      <div className="card review-empty">
        <Icon name="check-circle" size={20} />
        <div>
          <h3>Nothing needs your attention</h3>
          <p className="subtle small">
            Suggestions appear when your history points at a bill, a receipt or an unusual charge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`review-queue ${compact ? "compact" : ""}`}>
      <ul>
        {visible.map((suggestion) => {
          const open = expanded === suggestion.id;
          const dueSoon =
            suggestion.date !== null && daysBetween(today, suggestion.date) <= 1 && suggestion.date >= today;
          return (
            <li key={suggestion.id} className={`review-item tone-${suggestion.tone} ${open ? "open" : ""}`}>
              <button
                className="review-summary"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : suggestion.id)}
              >
                <span className={`review-icon ${suggestion.tone}`}>
                  <Icon
                    name={
                      suggestion.tone === "urgent"
                        ? "alert"
                        : suggestion.tone === "warn"
                          ? "info"
                          : "sparkles"
                    }
                    size={16}
                  />
                </span>
                <span className="review-title">
                  <span className="review-title-line">
                    {suggestion.title}
                    {dueSoon && <Badge tone="expense" dot>Due {shortDate(suggestion.date as string)}</Badge>}
                  </span>
                  <span className="review-observed">{suggestion.observed}</span>
                </span>
                {suggestion.amount !== null && (
                  <span className="review-amount num">{money(suggestion.amount)}</span>
                )}
                <Icon name="chevron-down" size={16} className={open ? "rotated" : ""} />
              </button>

              {open && (
                <div className="review-body">
                  <div className="review-block">
                    <h4><Icon name="info" size={13} /> Why it matters</h4>
                    <p>{suggestion.why}</p>
                  </div>
                  <div className="review-block">
                    <h4><Icon name="arrow-right" size={13} /> What you can do</h4>
                    <p>{suggestion.next}</p>
                  </div>
                  <ul className="facts">
                    {suggestion.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                  {suggestion.transactions.length > 0 && (
                    <div className="review-tx">
                      <span className="subtle small">Supporting transactions</span>
                      <ul>
                        {suggestion.transactions.map((tx) => (
                          <li key={tx.id}>
                            <span>{shortDate(tx.date)}</span>
                            <span>{tx.description}</span>
                            <span className={`num ${tx.direction}`}>
                              {tx.direction === "income" ? "+" : "−"}
                              {money(tx.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {editing === suggestion.id ? (
                    <div className="review-edit">
                      <label htmlFor={`date-${suggestion.id}`}>New expected date</label>
                      <input
                        id={`date-${suggestion.id}`}
                        type="date"
                        value={draftDate}
                        min={addDaysIso(today, -30)}
                        max={addDaysIso(today, 120)}
                        onChange={(event) => setDraftDate(event.target.value)}
                      />
                      <button className="btn btn-primary btn-sm" onClick={() => saveDate(suggestion)}>
                        Save date
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="review-actions">
                      {(suggestion.actions.length > 0 ? suggestion.actions : ["dismiss"] as SuggestionAction[]).map(
                        (action) => {
                          if (action === "try-different-date" && suggestion.kind === "category-spike") return null;
                          return (
                            <button
                              key={action}
                              className={`btn btn-sm ${
                                action === "confirm-schedule" ? "btn-primary" : "btn-secondary"
                              } ${action === "dismiss" ? "btn-ghost" : ""}`}
                              onClick={() => run(suggestion, action)}
                            >
                              <Icon name={ACTION_ICON[action]} size={14} />
                              {ACTION_LABEL[action]}
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                  <p className="review-safety">
                    <Icon name="shield" size={12} /> Suggestions never move money or confirm a payment on their
                    own. Nothing leaves this device.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {compact && suggestions.length > visible.length && (
        <button className="link-btn" onClick={() => setPage("activity")}>
          {suggestions.length - visible.length} more in Activity <Icon name="arrow-right" size={13} />
        </button>
      )}
    </div>
  );
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function ReviewQueueCount() {
  const { suggestions } = useApp();
  return <>{suggestions.length}</>;
}
