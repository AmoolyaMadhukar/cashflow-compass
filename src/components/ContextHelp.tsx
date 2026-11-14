import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export interface HelpTopic {
  title: string;
  body: ReactNode;
}

const TOPICS: Record<string, HelpTopic> = {
  reserve: {
    title: "Reserve",
    body: (
      <>
        <p>
          Your reserve is a minimum balance you do not want to spend. It is not a fee and it is not held by anyone:
          it is a line you choose.
        </p>
        <p>
          Every status in the app compares the projected balance with this line. Above it is{" "}
          <strong>Covered</strong>, between zero and the line is <strong>Uses reserve</strong>, and below zero is{" "}
          <strong>Insufficient cash</strong>.
        </p>
      </>
    ),
  },
  "net-cash-flow": {
    title: "Net cash flow",
    body: (
      <p>
        Money in minus money out over the chosen period. Transfers between your own accounts are excluded, because
        moving money to savings is not spending and not income.
      </p>
    ),
  },
  "spending-room": {
    title: "Room for a purchase",
    body: (
      <>
        <p>
          Cash today, plus confirmed receipts before your next expected income, minus scheduled bills before then,
          minus your reserve. In short: what you could spend and still respect the line you set.
        </p>
        <p>It is a limit, not a target. Everyday spending is not subtracted from this figure.</p>
      </>
    ),
  },
  uncertainty: {
    title: "Uncertainty range",
    body: (
      <>
        <p>
          The shaded band comes from how much your daily balance has actually varied, plus a margin on detected
          bills. It is an 80% range: roughly four out of five outcomes should fall inside it, not all of them.
        </p>
        <p>The band widens the further out you look, because more can change.</p>
      </>
    ),
  },
  "historical-error": {
    title: "Historical error",
    body: (
      <>
        <p>
          The app hides the last 30 days, forecasts them from earlier history, and then compares the prediction with
          what really happened. Average daily error is the mean gap in rupees per day; the 30-day error is the gap at
          the end of that window.
        </p>
        <p>
          With fewer than 15 recorded transactions there is not enough history to measure, so it says
          “Insufficient history” instead of guessing.
        </p>
      </>
    ),
  },
  "spendable-today": {
    title: "Spendable today",
    body: (
      <p>
        Your opening balance plus every recorded money-in and money-out up to today, minus anything already moved to
        savings. Pending or expected money is deliberately excluded — it has not arrived.
      </p>
    ),
  },
  "coverage-status": {
    title: "Covered, uses reserve, insufficient cash",
    body: (
      <>
        <p>
          <strong>Covered</strong>: the projected balance stays at or above your reserve every day in the window.
        </p>
        <p>
          <strong>Uses reserve</strong>: it drops below the reserve but not below zero.
        </p>
        <p>
          <strong>Insufficient cash</strong>: it goes below zero, meaning the forecast cannot pay what is scheduled.
        </p>
      </>
    ),
  },
};

export function ContextHelp({ topic, label = "How is this calculated?" }: { topic: keyof typeof TOPICS | string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement | null>(null);
  const entry = TOPICS[topic];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!entry) return null;

  return (
    <span className="context-help" ref={ref}>
      <button
        type="button"
        className="help-dot"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${entry.title}`}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="info" size={13} />
      </button>
      {open && (
        <div className="help-pop" id={id} role="dialog" aria-label={entry.title}>
          <h4>{entry.title}</h4>
          {entry.body}
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </span>
  );
}