import { useEffect, useState } from "react";
import type { Page, Transaction } from "./types";
import { useApp } from "./store";
import { OverviewPage } from "./pages/OverviewPage";
import { ActivityPage } from "./pages/ActivityPage";
import { UpcomingPage } from "./pages/UpcomingPage";
import { PlanPage } from "./pages/PlanPage";
import { InsightsPage } from "./pages/InsightsPage";
import { CsvImportModal } from "./components/CsvImportModal";
import { MoneyForm } from "./components/MoneyForm";
import type { FormAction } from "./components/MoneyForm";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { HelpCenter } from "./components/HelpCenter";
import { Onboarding } from "./components/Onboarding";
import { Icon } from "./components/Icon";
import { Badge } from "./components/ui";
import { money, shortDate } from "./lib/format";

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: "overview", label: "Overview", icon: "grid" },
  { page: "activity", label: "Activity", icon: "list" },
  { page: "upcoming", label: "Upcoming", icon: "repeat" },
  { page: "plan", label: "Plan a purchase", icon: "flask" },
  { page: "insights", label: "Insights", icon: "sparkles" },
];

export default function App() {
  const {
    page,
    setPage,
    workspace,
    workspaceId,
    isDemo,
    leaveDemo,
    switchWorkspace,
    onboarded,
    suggestions,
    reliability,
    cashToday,
    horizon,
    toast,
    undo,
    tour,
    setHelpOpen,
    helpOpen,
    transactions,
  } = useApp();

  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addAction, setAddAction] = useState<FormAction>("in");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [planPrefill, setPlanPrefill] = useState<{ amount?: number; date?: string } | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setNavOpen(false);
  }, [page]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "import") setImportOpen(true);
      if (detail === "add-income") openAdd("in");
      if (detail === "emi") openAdd("emi");
    };
    window.addEventListener("cfc:open-form", handler);
    return () => window.removeEventListener("cfc:open-form", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAdd = (action: FormAction) => {
    setEditing(null);
    setAddAction(action);
    setAddOpen(true);
  };

  const openEdit = (tx: Transaction) => {
    setEditing(tx);
    setAddOpen(true);
  };

  const openPlan = (prefill?: { amount?: number; date?: string }) => {
    setPlanPrefill(prefill ?? null);
    setPage("plan");
  };

  if (!onboarded) {
    return (
      <div className="app">
        <Onboarding onImport={() => setImportOpen(true)} />
        <CsvImportModal open={importOpen} onClose={() => setImportOpen(false)} />
        {toast && <Toast message={toast} undoLabel={undo?.label} onUndo={undo?.run} />}
      </div>
    );
  }

  return (
    <div className={`app ${tour.active ? "tour-active" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => setPage("overview")} aria-label="CashFlow Compass overview">
            <span className="brand-mark">
              <Icon name="compass" size={20} />
            </span>
            <span className="brand-text">
              <strong>CashFlow Compass</strong>
              <small>Local-first cash planning</small>
            </span>
          </button>

          <nav className="main-nav" aria-label="Main navigation">
            {NAV.map((item) => (
              <button
                key={item.page}
                className={`nav-btn ${page === item.page ? "active" : ""}`}
                onClick={() => setPage(item.page)}
                aria-current={page === item.page ? "page" : undefined}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
                {item.page === "activity" && suggestions.length > 0 && (
                  <span className="nav-count" aria-label={`${suggestions.length} need review`}>
                    {suggestions.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
            <button
              className={`workspace-chip ${isDemo ? "demo" : ""}`}
              onClick={() => setSettingsOpen(true)}
              aria-label={`Current workspace: ${workspace.label}. Change workspace`}
            >
              <span className={`status-dot ${isDemo ? "violet" : "good"}`} aria-hidden="true" />
              {isDemo ? "Demo workspace" : workspace.label}
            </button>

            <div className="add-group">
              <button className="btn btn-primary btn-sm add-main" onClick={() => openAdd("in")}>
                <Icon name="plus" size={15} /> Add
              </button>
              <button
                className="btn btn-primary btn-sm add-more"
                aria-haspopup="menu"
                aria-expanded={navOpen}
                aria-label="More add options"
                onClick={() => setNavOpen((value) => !value)}
              >
                <Icon name="chevron-down" size={14} />
              </button>
              {navOpen && (
                <div className="add-menu" role="menu">
                  <button role="menuitem" onClick={() => { openAdd("in"); setNavOpen(false); }}>
                    <Icon name="arrow-down" size={15} /> Money in
                  </button>
                  <button role="menuitem" onClick={() => { openAdd("out"); setNavOpen(false); }}>
                    <Icon name="arrow-up" size={15} /> Money out
                  </button>
                  <button role="menuitem" onClick={() => { openAdd("transfer"); setNavOpen(false); }}>
                    <Icon name="wallet" size={15} /> Move to savings
                  </button>
                  <button role="menuitem" onClick={() => { openAdd("emi"); setNavOpen(false); }}>
                    <Icon name="repeat" size={15} /> Loan EMI
                  </button>
                  <button role="menuitem" onClick={() => { openAdd("loan"); setNavOpen(false); }}>
                    <Icon name="arrow-down" size={15} /> Loan received
                  </button>
                  <hr />
                  <button role="menuitem" onClick={() => { setImportOpen(true); setNavOpen(false); }}>
                    <Icon name="upload" size={15} /> Import CSV
                  </button>
                  <button role="menuitem" onClick={() => { openAdd("asset"); setNavOpen(false); }}>
                    <Icon name="shield" size={15} /> Optional asset
                  </button>
                </div>
              )}
            </div>

            <button className="btn btn-secondary btn-sm help-btn" onClick={() => setHelpOpen(true)}>
              <Icon name="info" size={15} /> <span>Help</span>
            </button>
            <button className="icon-btn" aria-label="Open settings and data" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" size={18} />
            </button>
          </div>
        </div>

        <div className="context-bar">
          <span className="context-item">
            <Icon name="wallet" size={13} /> {money(cashToday)} spendable today
          </span>
          <span className="context-item">
            <Icon name="compass" size={13} /> Next {horizon} days
          </span>
          <span className="context-item">
            <Icon name="repeat" size={13} /> {transactions.length} recorded rows
          </span>
          <span className={`context-item reliability-inline ${reliability.status === "insufficient" ? "muted" : ""}`}>
            <Icon name="alert" size={13} />
            {reliability.status === "insufficient"
              ? "Insufficient history"
              : `Measured error ${money(reliability.meanDailyError ?? 0)}/day`}
          </span>
          {isDemo && (
            <button className="context-item context-action" onClick={leaveDemo}>
              Return to my workspace <Icon name="arrow-right" size={12} />
            </button>
          )}
          {!isDemo && (
            <button className="context-item context-action" onClick={() => switchWorkspace("demo")}>
              Open demo <Icon name="arrow-right" size={12} />
            </button>
          )}
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {NAV.map((item) => (
            <button
              key={item.page}
              className={`nav-btn ${page === item.page ? "active" : ""}`}
              onClick={() => setPage(item.page)}
              aria-current={page === item.page ? "page" : undefined}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label === "Plan a purchase" ? "Plan" : item.label}</span>
              {item.page === "activity" && suggestions.length > 0 && (
                <span className="nav-count">{suggestions.length}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main id="main">
        {page === "overview" && (
          <OverviewPage
            onPlan={openPlan}
            onImport={() => setImportOpen(true)}
            onAdd={() => openAdd("in")}
            onNavigate={setPage}
          />
        )}
        {page === "activity" && (
          <ActivityPage onAdd={() => openAdd("in")} onImport={() => setImportOpen(true)} onEdit={openEdit} />
        )}
        {page === "upcoming" && (
          <UpcomingPage onAdd={() => openAdd("emi")} onImport={() => setImportOpen(true)} />
        )}
        {page === "plan" && <PlanPage prefill={planPrefill} />}
        {page === "insights" && <InsightsPage onPlan={() => openPlan()} />}
      </main>

      <footer className="app-footer">
        <span>
          <strong>CashFlow Compass</strong> · {workspaceId === "demo" ? "Demo workspace" : "Your workspace"} · opening
          balance {money(workspace.openingBalance)} as of {shortDate(workspace.openingDate)}
        </span>
        <span>
          <Badge tone="neutral">On-device</Badge> No bank connection, no payments, no accounts.
        </span>
      </footer>

      <CsvImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <MoneyForm
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setEditing(null);
        }}
        initialAction={editing ? (editing.direction === "income" ? "in" : "out") : addAction}
        initialMode="recorded"
        editing={editing}
      />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpCenter />
      {!helpOpen && (
        <button className="help-fab" onClick={() => setHelpOpen(true)} aria-label="Open Help and How to use">
          <Icon name="info" size={18} />
          <span>How to use</span>
        </button>
      )}

      {toast && <Toast message={toast} undoLabel={undo?.label} onUndo={undo?.run} />}
    </div>
  );
}

function Toast({
  message,
  undoLabel,
  onUndo,
}: {
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <Icon name="check-circle" size={16} />
      <span>{message}</span>
      {onUndo && undoLabel && (
        <button className="toast-undo" onClick={onUndo}>
          {undoLabel}
        </button>
      )}
    </div>
  );
}