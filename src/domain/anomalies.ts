/**
 * Unusual changes in either direction, using only evidence that existed by the
 * analysis date. Nothing here changes a schedule: `actions` are offers, and
 * anything that would alter a recurring amount is flagged
 * `requiresConfirmation: true`.
 */
import type {
  CashMovement,
  ChangeAction,
  Direction,
  ISODate,
  RecurringSeries,
  UnusualChange,
} from "./contracts";
import { addDays, daysBetween, seriesOccurrences } from "./ledger";
import { daysLabel, money, median } from "../lib/format";

export interface AnomalyOptions {
  /** Analysis date. Nothing after this date is used. */
  asOf: ISODate;
  /** Length of each comparison period, in days. */
  periodDays?: number;
  /** Minimum transactions before a comparison is reported. */
  minSamples?: number;
  /** Minimum rupee change before a change is worth showing. */
  minChange?: number;
  series?: RecurringSeries[];
}

function windowPair(asOf: ISODate, periodDays: number) {
  return {
    currentFrom: addDays(asOf, -(periodDays - 1)),
    currentTo: asOf,
    previousFrom: addDays(asOf, -(periodDays * 2 - 1)),
    previousTo: addDays(asOf, -periodDays),
  };
}

function inWindow(movement: CashMovement, from: ISODate, to: ISODate): boolean {
  return movement.date >= from && movement.date <= to;
}

/**
 * Compare like-for-like periods per category and per merchant.
 * Returns high AND low spending, subscription changes, late receipts and
 * missing bills.
 */
export function detectUnusualChanges(
  movements: CashMovement[],
  options: AnomalyOptions,
): UnusualChange[] {
  const { asOf, periodDays = 30, minSamples = 3, minChange = 400, series = [] } = options;
  const usable = movements.filter((movement) => movement.status === "actual" && movement.date <= asOf);
  const windows = windowPair(asOf, periodDays);
  const changes: UnusualChange[] = [];

  const groups = new Map<string, { direction: Direction; category: string; merchantKey: string; current: CashMovement[]; previous: CashMovement[] }>();
  for (const movement of usable) {
    if (movement.kind === "transfer" || movement.kind === "savings_pot" || movement.signedAmount === 0) continue;
    const direction: Direction = movement.signedAmount > 0 ? "income" : "expense";
    const merchantKey = movement.merchantKey ?? "";
    const category = movement.category || "Other";
    const key = `${direction}|${merchantKey || category}`;
    const entry =
      groups.get(key) ?? { direction, category, merchantKey, current: [], previous: [] };
    if (inWindow(movement, windows.currentFrom, windows.currentTo)) entry.current.push(movement);
    else if (inWindow(movement, windows.previousFrom, windows.previousTo)) entry.previous.push(movement);
    groups.set(key, entry);
  }

  for (const [key, group] of groups) {
    if (group.current.length < minSamples) continue;
    const current = group.current.reduce((sum, movement) => sum + Math.abs(movement.signedAmount), 0);
    const previous = group.previous.reduce((sum, movement) => sum + Math.abs(movement.signedAmount), 0);
    const change = current - previous;
    if (Math.abs(change) < minChange) continue;
    // Require the change to be material, not noise on a small base.
    const relative = previous > 0 ? change / previous : 1;
    if (previous > 0 && Math.abs(relative) < 0.25) continue;

    const typical = median(group.previous.map((movement) => Math.abs(movement.signedAmount)));
    const high = change > 0;
    const label = group.merchantKey || group.category.toLowerCase();
    changes.push({
      id: `change-${key.replace(/[^a-z0-9]/gi, "-")}-${asOf}`,
      type: group.direction === "expense" ? (high ? "spending_high" : "spending_low") : high ? "spending_high" : "spending_low",
      direction: group.direction,
      category: group.category,
      merchantKey: group.merchantKey || undefined,
      comparison: windows,
      typicalAmount: Math.round(typical),
      actualAmount: Math.round(current),
      sampleSize: group.current.length,
      changeAmount: Math.round(change),
      explanation: high
        ? `${group.direction === "expense" ? "Spending" : "Income"} for ${label} is ${money(current)} in the last ${periodDays} days, ${money(
            change,
          )} more than ${money(previous)} in the ${periodDays} days before that (${group.current.length} vs ${group.previous.length} transactions).`
        : `${group.direction === "expense" ? "Spending" : "Income"} for ${label} is ${money(current)} in the last ${periodDays} days, ${money(
            Math.abs(change),
          )} less than ${money(previous)} in the ${periodDays} days before that (${group.current.length} vs ${group.previous.length} transactions).`,
      actions: group.direction === "expense" ? ["review_once"] : ["review_once", "confirm_or_clear"],
      requiresConfirmation: false,
    });
  }

  /* --------------------- changed subscriptions / bills --------------------- */
  for (const item of series) {
    const occurrences = seriesOccurrences(item, windows.previousFrom, windows.currentTo);
    const before = occurrences.filter((date) => date < windows.currentFrom);
    const after = occurrences.filter((date) => date >= windows.currentFrom);
    const amountsFor = (dates: ISODate[]) =>
      dates
        .map((date) =>
          usable.find(
            (movement) =>
              movement.recurring?.seriesId === item.id && movement.recurring?.occurrenceDate === date,
          ),
        )
        .filter((movement): movement is CashMovement => Boolean(movement))
        .map((movement) => movement.amount);
    const priorAmounts = amountsFor(before);
    const currentAmounts = amountsFor(after);
    if (priorAmounts.length === 0 || currentAmounts.length === 0) continue;
    const priorTypical = median(priorAmounts);
    const currentTypical = median(currentAmounts);
    const change = currentTypical - priorTypical;
    if (Math.abs(change) < Math.max(50, priorTypical * 0.08)) continue;
    changes.push({
      id: `series-change-${item.id}-${asOf}`,
      type: "subscription_changed",
      direction: item.direction,
      category: item.category,
      merchantKey: item.evidence?.reason ? undefined : undefined,
      comparison: windows,
      typicalAmount: Math.round(priorTypical),
      actualAmount: Math.round(currentTypical),
      sampleSize: priorAmounts.length + currentAmounts.length,
      changeAmount: Math.round(change),
      explanation: `${item.label} went from ${money(priorTypical)} to ${money(
        currentTypical,
      )}. If the new amount is permanent, your future forecast should use it.`,
      actions: ["update_future_amounts", "change_next_date", "review_once"],
      requiresConfirmation: true,
      seriesId: item.id,
    });
  }

  /* ------------------------- late receipts / missing ---------------------- */
  for (const item of series) {
    if (item.direction !== "income") continue;
    const dueBefore = seriesOccurrences(item, addDays(asOf, -periodDays * 2), addDays(asOf, -1));
    for (const due of dueBefore) {
      const satisfied = usable.find(
        (movement) => movement.recurring?.seriesId === item.id && movement.recurring?.occurrenceDate === due,
      );
      if (satisfied) {
        const late = daysBetween(due, satisfied.date);
        if (late >= 2) {
          changes.push({
            id: `late-${item.id}-${due}`,
            type: "receipt_late",
            direction: "income",
            category: item.category,
            comparison: windows,
            typicalAmount: item.amount,
            actualAmount: satisfied.amount,
            sampleSize: 1,
            changeAmount: 0,
            explanation: `${item.label} was expected on ${due} and arrived ${daysLabel(late)} (${satisfied.date}). If this is normal, your income timing uncertainty is higher than assumed.`,
            actions: ["change_next_date", "review_once"],
            requiresConfirmation: true,
            seriesId: item.id,
          });
        }
        continue;
      }
      // Was it paid at all? Only claim "missing" well after the due date.
      if (daysBetween(due, asOf) >= 3) {
        changes.push({
          id: `missing-${item.id}-${due}`,
          type: "bill_missing",
          direction: item.direction,
          category: item.category,
          comparison: windows,
          typicalAmount: item.amount,
          actualAmount: 0,
          sampleSize: 1,
          changeAmount: -item.amount,
          explanation: `No matching payment for ${item.label} (${money(
            item.amount,
          )}) was found for ${due}, though it was due ${daysLabel(daysBetween(due, asOf))}. Nothing has been changed automatically.`,
          actions: ["review_once", "change_next_date"],
          requiresConfirmation: true,
          seriesId: item.id,
        });
      }
    }
  }

  // Biggest absolute change first; keep income problems visible too.
  const priority: Record<UnusualChange["type"], number> = {
    bill_missing: 0,
    receipt_late: 1,
    subscription_changed: 2,
    spending_high: 3,
    spending_low: 4,
  };
  return changes.sort(
    (a, b) => priority[a.type] - priority[b.type] || Math.abs(b.changeAmount) - Math.abs(a.changeAmount),
  );
}

/** Actions a UI may offer for one change, with a confirmation requirement. */
export function actionsFor(change: UnusualChange): { action: ChangeAction; requiresConfirmation: boolean; label: string }[] {
  const labels: Record<ChangeAction, string> = {
    review_once: "Mark as reviewed (this time only)",
    change_next_date: "Change the next date",
    update_future_amounts: "Update future amounts",
    confirm_or_clear: "Confirm or clear the item",
  };
  return change.actions.map((action) => ({
    action,
    requiresConfirmation: action !== "review_once",
    label: labels[action],
  }));
}
