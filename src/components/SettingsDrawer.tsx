import { useState } from "react";
import { useApp } from "../store";
import { money, shortDate, todayISO } from "../lib/format";
import { downloadText, transactionsToCsv } from "../lib/csv";
import { Drawer, Field, Segmented } from "./ui";
import { Icon } from "./Icon";
import { ContextHelp } from "./ContextHelp";

const RESERVE_PRESETS = [0, 50000, 100000, 150000, 250000];

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    settings,
    workspace,
    transactions,
    transfers,
    expected,
    assets,
    isDemo,
    cashToday,
    savingsToday,
    setReserve,
    setOpening,
    setHorizon,
    clearOwnData,
    notify,
    moveDemoRowsOut,
    beginFresh,
    workspaces,
    switchWorkspace,
  } = useApp();
  const [armed, setArmed] = useState(false);
  const [opening, setOpeningInput] = useState(String(workspace.openingBalance));
  const [openingDate, setOpeningDate] = useState(workspace.openingDate || todayISO());

  const demoRows = transactions.filter((tx) => tx.source === "demo").length;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Settings and data"
      subtitle={`${workspace.label} · ${transactions.length} recorded entries`}
    >
      <div className="drawer-section">
        <h3>
          Minimum reserve <ContextHelp topic="reserve" />
        </h3>
        <p className="subtle small">
          The line you do not want to cross. Every status compares the projected balance with it. Example: rent plus
          one EMI.
        </p>
        <Field label="Reserve amount (₹)" htmlFor="setting-reserve">
          <input
            id="setting-reserve"
            type="number"
            min={0}
            step={1000}
            value={settings.safetyThreshold}
            onChange={(event) => setReserve(Number(event.target.value) || 0)}
          />
        </Field>
        <div className="preset-row">
          {RESERVE_PRESETS.map((preset) => (
            <button
              key={preset}
              className={`chip-btn ${settings.safetyThreshold === preset ? "active" : ""}`}
              onClick={() => setReserve(preset)}
            >
              {preset === 0 ? "None" : money(preset)}
            </button>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h3>
          Opening balance <ContextHelp topic="spendable-today" />
        </h3>
        <Field
          label="Cash before your first recorded entry (₹)"
          hint="Money you already had. Imported rows usually start from zero unless your statement includes a balance."
          htmlFor="setting-opening"
        >
          <input
            id="setting-opening"
            type="number"
            step={1000}
            value={opening}
            onChange={(event) => setOpeningInput(event.target.value)}
          />
        </Field>
        <Field label="As of date" htmlFor="setting-opening-date">
          <input
            id="setting-opening-date"
            type="date"
            max={todayISO()}
            value={openingDate}
            onChange={(event) => setOpeningDate(event.target.value)}
          />
        </Field>
        <button
          className="btn btn-secondary btn-block"
          onClick={() => {
            setOpening(Math.round(Number(opening) || 0), openingDate);
            notify("Opening balance saved. Forecast recalculated.");
          }}
        >
          Save opening balance
        </button>
      </div>

      <div className="drawer-section">
        <h3>Forecast period</h3>
        <Field label="How far ahead?" hint="Applies to the balance chart, statuses and purchase checks.">
          <Segmented
            label="Forecast horizon"
            options={[
              { value: 30, label: "30 days" },
              { value: 60, label: "60 days" },
              { value: 90, label: "90 days" },
            ]}
            value={settings.horizon}
            onChange={(value) => setHorizon(value as 30 | 60 | 90)}
          />
        </Field>
      </div>

      <div className="drawer-section">
        <h3>Workspaces</h3>
        <ul className="workspace-list">
          {workspaces.map((entry) => (
            <li key={entry.id} className={entry.id === workspace.id ? "active" : ""}>
              <div>
                <strong>{entry.label}</strong>
                <span className="subtle small">
                  {entry.count} recorded entries{entry.exists ? "" : " · not created yet"}
                </span>
              </div>
              {entry.id === workspace.id ? (
                <span className="badge badge-good">Current</span>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => switchWorkspace(entry.id)}>
                  Switch
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="footnote">
          The demo workspace is a separate slot. Opening it never changes your own records, and leaving it restores
          them exactly.
        </p>
      </div>

      <div className="drawer-section">
        <h3>Your data</h3>
        <div className="data-summary">
          <div>
            <span className="num">{money(cashToday)}</span>
            <span className="subtle small">cash</span>
          </div>
          <div>
            <span className="num">{money(savingsToday)}</span>
            <span className="subtle small">savings</span>
          </div>
          <div>
            <span className="num">{transfers.length}</span>
            <span className="subtle small">transfers</span>
          </div>
          <div>
            <span className="num">{expected.length}</span>
            <span className="subtle small">expected</span>
          </div>
          <div>
            <span className="num">{assets.length}</span>
            <span className="subtle small">assets</span>
          </div>
        </div>
        <button
          className="btn btn-secondary btn-block"
          onClick={() =>
            downloadText(
              `cashflow-compass-${workspace.id}-${todayISO()}.csv`,
              transactionsToCsv(transactions),
            )
          }
          disabled={transactions.length === 0}
        >
          <Icon name="download" size={15} /> Export as CSV
        </button>
        {demoRows > 0 && !isDemo && (
          <button className="btn btn-secondary btn-block" onClick={moveDemoRowsOut}>
            <Icon name="sparkles" size={15} /> Move {demoRows} sample rows out
          </button>
        )}
        {isDemo ? (
          <button className="btn btn-secondary btn-block" onClick={beginFresh}>
            <Icon name="plus" size={15} /> Start my own workspace
          </button>
        ) : (
          <button
            className={`btn btn-block ${armed ? "btn-danger" : "btn-ghost"}`}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                notify("Click again to delete everything in this workspace.");
                window.setTimeout(() => setArmed(false), 5000);
                return;
              }
              clearOwnData();
              setArmed(false);
              onClose();
            }}
          >
            <Icon name="trash" size={15} /> {armed ? "Click again to confirm delete" : "Delete all local data"}
          </button>
        )}
        <p className="footnote">
          Data lives in this browser’s localStorage under <code>cashflow-compass:v2</code>. Your old
          <code> cashflow-compass:v1</code> entry is kept as a rollback copy until you delete it yourself.
        </p>
      </div>

      <div className="drawer-section about-block">
        <h3>What runs this</h3>
        <p className="subtle small">
          The forecast, recurring detection, reliability and reconciliation all run on the shared domain engine in
          <code> src/domain</code>. The purchase planner is <code>src/features/planner</code>. This screen only
          translates your saved rows into that engine's input and back again.
        </p>
      </div>

      <div className="drawer-section about-block">
        <h3>About</h3>
        <p className="subtle small">
          Opening balance as of {shortDate(workspace.openingDate)}. Local-first prototype: no bank connection, no
          payments, no accounts, no external services.
        </p>
        <p className="footnote">Forecasts are estimates. Not financial advice.</p>
      </div>
    </Drawer>
  );
}