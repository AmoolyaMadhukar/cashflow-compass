/**
 * Local ISO date helpers for the planner.
 *
 * The planner ships its own copies (rather than importing `src/lib/format.ts`)
 * so the feature stays portable across Person 1/3's branch changes. Same
 * semantics: parse "yyyy-mm-dd" as a *local* date so no timezone drift occurs.
 */

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toISO(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86400000);
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function eachDay(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  for (let guard = 0; guard < 1000 && cursor <= end; guard++) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function mediumDate(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function weekdayShort(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-IN", { weekday: "short" });
}

export function monthLabel(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export function daysLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
