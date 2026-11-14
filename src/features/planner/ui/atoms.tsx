import { useId, useState } from "react";
import type { ReactNode } from "react";
import type { DateVerdict } from "../engine/types";

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="pp-help">
      <button
        type="button"
        className="pp-help-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What does ${label} mean?`}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span className="pp-help-pop" role="tooltip" id={id}>
          {children}
        </span>
      )}
    </span>
  );
}

export const VERDICT_META: Record<
  DateVerdict,
  { label: string; short: string; icon: string; tone: string }
> = {
  works: {
    label: "Works across tested delays",
    short: "Works",
    icon: "✓",
    tone: "ok",
  },
  timing: {
    label: "Depends on payment timing",
    short: "Timing",
    icon: "~",
    tone: "warn",
  },
  "below-reserve": {
    label: "Below reserve even with on-time payment",
    short: "Below reserve",
    icon: "✕",
    tone: "bad",
  },
  "insufficient-window": {
    label: "Insufficient forecast window",
    short: "No window",
    icon: "?",
    tone: "unknown",
  },
};

export function VerdictPill({
  verdict,
  passes,
  tested,
  compact = false,
}: {
  verdict: DateVerdict;
  passes?: number;
  tested?: number;
  compact?: boolean;
}) {
  const meta = VERDICT_META[verdict];
  return (
    <span className={`pp-pill pp-pill-${meta.tone}`}>
      <span className="pp-pill-icon" aria-hidden="true">
        {meta.icon}
      </span>
      <span>{compact ? meta.short : meta.label}</span>
      {!compact && tested !== undefined && tested > 0 && verdict !== "insufficient-window" && (
        <span className="pp-pill-count">
          {passes}/{tested}
        </span>
      )}
    </span>
  );
}

export function SectionTitle({
  step,
  title,
  sub,
  aside,
}: {
  step: string;
  title: string;
  sub?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="pp-section-head">
      <div>
        <p className="pp-eyebrow">
          <span className="pp-step">{step}</span>
          {title}
        </p>
        {sub && <p className="pp-section-sub">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad";
  hint?: string;
}) {
  return (
    <div className={`pp-stat pp-stat-${tone}`}>
      <span className="pp-stat-label">{label}</span>
      <strong className="pp-stat-value pp-num">{value}</strong>
      {hint && <span className="pp-stat-hint">{hint}</span>}
    </div>
  );
}
