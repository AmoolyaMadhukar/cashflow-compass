import { useEffect } from "react";
import { useApp, TOUR_TOTAL } from "../store";
import type { Page } from "../types";
import { money, shortDate } from "../lib/format";
import { Drawer } from "./ui";
import { Icon } from "./Icon";

type Task = {
  id: string;
  title: string;
  body: string;
  cta: string;
  page: Page;
  action?: "add-income" | "import" | "recurring" | "plan" | "insights" | "emi";
};

const TASKS: Task[] = [
  {
    id: "income",
    title: "Add my first income",
    body: "Record money you already received, or note a client invoice you expect. Received money counts today; expected money only shapes the forecast.",
    cta: "Open Money in",
    page: "activity",
    action: "add-income",
  },
  {
    id: "import",
    title: "Import a statement",
    body: "Bring a bank or UPI CSV. You will see totals, the date range and duplicates before anything is saved, and you can replace or append.",
    cta: "Open CSV import",
    page: "activity",
    action: "import",
  },
  {
    id: "recurring",
    title: "Confirm a recurring payment",
    body: "Rent, subscriptions and EMIs are detected from repeats. Confirming one adds it to every forecast; dismissing it keeps it out.",
    cta: "Review recurring",
    page: "upcoming",
    action: "recurring",
  },
  {
    id: "emi",
    title: "Record an EMI",
    body: "Add a loan EMI as an expected payment with its next due date, then confirm it once so each cycle is projected.",
    cta: "Add an EMI",
    page: "activity",
    action: "emi",
  },
  {
    id: "purchase",
    title: "Find a purchase date",
    body: "Enter the amount, then read the calendar: each day shows what buying then would do to your lowest balance.",
    cta: "Open the planner",
    page: "plan",
    action: "plan",
  },
  {
    id: "forecast",
    title: "Understand this forecast",
    body: "The line is your projected balance, the band is the 80% range, and the dashed line is your reserve. Click any day for the receipts and bills behind it.",
    cta: "Open Insights",
    page: "insights",
    action: "insights",
  },
];

const TOUR_COPY = [
  {
    title: "Choose a purchase",
    body: "The planner is open in an isolated demo workspace. Amount ₹68,000 and a date are pre-filled — that is the laptop. Nothing here touches your own workspace.",
  },
  {
    title: "Delay a client receipt",
    body: "Use the “If a client pays late” control and choose 1 late. Watch the verdict and the low point change: the same purchase now reaches deeper.",
  },
  {
    title: "Click a calendar date",
    body: "Pick a day in the purchase timing calendar. Green is covered, amber uses your reserve, red is insufficient cash. The detail line explains the day you chose.",
  },
  {
    title: "Inspect the affected bill",
    body: "Open Overview and click the lowest point on the balance chart, or open Upcoming. You will see the starting cash, expected receipts and the bills behind that dip.",
  },
  {
    title: "Apply a fix",
    body: "Back in the planner, choose a suggested fix — a different date, an earlier receipt, or setting money aside — and the chart updates. Exit to return to your own workspace.",
  },
];

export function HelpCenter() {
  const {
    helpOpen,
    setHelpOpen,
    setPage,
    startTour,
    tour,
    tourStep,
    setTourStep,
    stopTour,
    isDemo,
    openDemo,
    leaveDemo,
    workspaceId,
    cashToday,
    forecast,
    reserve,
    expected,
  } = useApp();

  return (
    <>
      <Drawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="How to use CashFlow Compass"
        subtitle="Two minutes gets you to your first decision."
      >
        <section className="help-section">
          <h3>Two-minute guided demo</h3>
          <p className="subtle small">
            A real, clickable walkthrough in a separate demo workspace. Leaving the demo restores your own data
            exactly as it was.
          </p>
          <ol className="tour-steps">
            {TOUR_COPY.map((step, index) => (
              <li key={step.title} className={tour.active && tourStep === index ? "active" : ""}>
                <span className="tour-index">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button className="btn btn-primary" onClick={startTour}>
              <Icon name="compass" size={16} /> {tour.active ? "Restart the tour" : "Start the tour"}
            </button>
            {isDemo ? (
              <button className="btn btn-secondary" onClick={leaveDemo}>
                Leave the demo workspace
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => openDemo({ force: true })}>
                Just explore the demo
              </button>
            )}
          </div>
        </section>

        <section className="help-section">
          <h3>Task-based help</h3>
          <ul className="help-tasks">
            {TASKS.map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.body}</p>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setPage(task.page);
                    setHelpOpen(false);
                    if (task.action) {
                      window.setTimeout(() => {
                        window.dispatchEvent(new CustomEvent("cfc:open-form", { detail: task.action }));
                      }, 60);
                    }
                  }}
                >
                  {task.cta} <Icon name="arrow-right" size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="help-section">
          <h3>What the numbers mean</h3>
          <dl className="help-glossary">
            <div>
              <dt>Spendable today</dt>
              <dd>Cash you can use right now: everything recorded, minus money already moved to savings.</dd>
            </div>
            <div>
              <dt>Reserve</dt>
              <dd>A minimum balance you set for yourself. Statuses compare the forecast with this line.</dd>
            </div>
            <div>
              <dt>Confirmed vs expected</dt>
              <dd>Confirmed rows already happened. Expected rows are future and are labelled as estimates.</dd>
            </div>
            <div>
              <dt>Forecast reliability</dt>
              <dd>Measured error from your own history, not a promise about the future.</dd>
            </div>
          </dl>
        </section>

        <section className="help-section about-block">
          <h3>Keyboard and privacy</h3>
          <p className="subtle small">
            Every control is reachable by Tab with a visible focus ring. On the balance chart, focus the plot and use
            the arrow keys to walk day by day, then press Enter to open a day. All data stays in this browser —
            nothing is uploaded and no payments can be moved.
          </p>
        </section>
      </Drawer>

      {tour.active && (
        <TourOverlay
          step={tourStep}
          total={TOUR_TOTAL}
          onNext={() => setTourStep(Math.min(TOUR_TOTAL, tourStep + 1))}
          onBack={() => setTourStep(Math.max(0, tourStep - 1))}
          onSkip={() => setTourStep(TOUR_TOTAL)}
          onExit={stopTour}
          context={{
            workspaceId,
            cash: cashToday,
            low: forecast.minBalance,
            lowDate: forecast.minDate,
            reserve,
            receipt: [...expected.filter((item) => item.direction === "income")].sort((a, b) => b.amount - a.amount)[0],
          }}
        />
      )}
    </>
  );
}

function TourOverlay({
  step,
  total,
  onNext,
  onBack,
  onSkip,
  onExit,
  context,
}: {
  step: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onExit: () => void;
  context: {
    workspaceId: string;
    cash: number;
    low: number;
    lowDate: string;
    reserve: number;
    receipt?: { label: string; amount: number; date: string };
  };
}) {
  const copy = TOUR_COPY[Math.min(step, TOUR_COPY.length - 1)];
  const isLast = step >= total - 1;

  // Scroll the real control into view so the step points at something real.
  useEffect(() => {
    const target =
      step === 0 || step === 1
        ? document.getElementById("purchase-planner")
        : step === 2
          ? document.getElementById("purchase-calendar")
          : step === 3
            ? document.getElementById("overview-chart")
            : document.getElementById("planner-fixes");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [step]);

  return (
    <div className="tour-overlay" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className="tour-card">
        <div className="tour-head">
          <span className="tour-badge">
            <Icon name="compass" size={13} /> Demo workspace · guided
          </span>
          <span className="tour-progress">
            Step {Math.min(step + 1, total)} of {total}
          </span>
          <button className="icon-btn" onClick={onExit} aria-label="Exit the tour">
            <Icon name="x" size={16} />
          </button>
        </div>
        <h3 id="tour-title">{copy.title}</h3>
        <p>{copy.body}</p>
        <ul className="tour-figures">
          <li>
            <span>Spendable today</span>
            <strong className="num">{money(context.cash)}</strong>
          </li>
          <li>
            <span>Lowest projected</span>
            <strong className="num">
              {money(context.low)} <span className="subtle small">on {shortDate(context.lowDate)}</span>
            </strong>
          </li>
          <li>
            <span>Reserve</span>
            <strong className="num">{money(context.reserve)}</strong>
          </li>
          {context.receipt && (
            <li>
              <span>Largest expected receipt</span>
              <strong className="num">
                {money(context.receipt.amount)}{" "}
                <span className="subtle small">on {shortDate(context.receipt.date)}</span>
              </strong>
            </li>
          )}
        </ul>
        <div className="tour-actions">
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            Exit
          </button>
          <div className="spacer" />
          <button className="btn btn-secondary btn-sm" onClick={onSkip}>
            Skip
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onBack} disabled={step === 0}>
            Back
          </button>
          <button className="btn btn-primary btn-sm" onClick={onNext}>
            {isLast ? "Finish and exit" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}