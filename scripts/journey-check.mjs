/**
 * Headless journey check for the merged app.
 *
 * Drives a real Chrome over the DevTools protocol: no test framework, no new
 * dependencies. Each journey asserts on what a user would actually see.
 *
 *   node scripts/journey-check.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4173";
const CHROME =
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "cfc-chrome-"));

const results = [];
const log = (...args) => console.log(...args);

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 20000);
    });
  }
  once(method) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method === method) {
          this.listeners = this.listeners.filter((entry) => entry !== listener);
          resolve(message.params);
        }
      };
      this.listeners.push(listener);
    });
  }
  async evaluate(expression) {
    const outcome = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (outcome.exceptionDetails) {
      throw new Error(
        `eval failed: ${outcome.exceptionDetails.text} ${outcome.exceptionDetails.exception?.description ?? ""}`,
      );
    }
    return outcome.result.value;
  }
  async waitFor(expression, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
      } catch {
        /* page might be mid-navigation */
      }
      await sleep(90);
    }
    return null;
  }
  async click(selector) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({block:'center'});
      el.click();
      return true;
    })()`);
    return ok;
  }
  async clickText(selector, text) {
    const ok = await this.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const el = els.find((node) => (node.textContent || '').includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.scrollIntoView({block:'center'});
      el.click();
      return true;
    })()`);
    return ok;
  }
  async type(selector, value) {
    return this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }
  async text() {
    return this.evaluate("document.body.innerText");
  }
  async key(key, code, keyCode) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
  async reload() {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.reload", { ignoreCache: true });
    await loaded;
    await sleep(400);
  }
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1440,1000",
    "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const version = await getJson("/json/version");
      if (version.webSocketDebuggerUrl) {
        const list = await getJson("/json/list");
        target = list.find((entry) => entry.type === "page");
        if (target) break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  if (!target) throw new Error("Chrome did not start");

  const { WebSocket } = globalThis;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const cdp = new Cdp(ws);

  const consoleErrors = [];
  cdp.listeners.push((message) => {
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(message.params.exceptionDetails.text + " " + (message.params.exceptionDetails.exception?.description ?? ""));
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: BASE });
  await cdp.waitFor("document.body.innerText.includes('CashFlow Compass')", 12000);

  /* ---------------- Journey 1: fresh workspace, income, savings, refresh ---------------- */
  const onboardShown = await cdp.waitFor("!!document.querySelector('.choice-grid')");
  record("First visit shows Start fresh / Import a CSV / Explore demo", Boolean(onboardShown));

  await cdp.clickText(".choice-card", "Start fresh");
  await cdp.waitFor("!!document.querySelector('#onb-opening')");
  await cdp.type("#onb-opening", "45000");
  await cdp.type("#onb-reserve", "20000");
  await cdp.clickText(".btn-primary", "Create my workspace");
  await cdp.waitFor("document.body.innerText.includes('is ready')");

  // record income
  await cdp.clickText(".btn", "Record money in");
  await cdp.waitFor("!!document.querySelector('#form-amount')");
  await cdp.type("#form-desc", "Acme retainer");
  await cdp.type("#form-amount", "60000");
  await cdp.clickText(".modal-foot .btn-primary", "Record it");
  await cdp.waitFor("!document.querySelector('.modal')");
  await sleep(300);

  // transfer to savings
  await cdp.click(".add-more");
  await cdp.waitFor("!!document.querySelector('.add-menu')");
  await cdp.clickText(".add-menu button", "Move to savings");
  await cdp.waitFor("!!document.querySelector('#form-amount')");
  await cdp.type("#form-amount", "20000");
  await cdp.clickText(".modal-foot .btn-primary", "Transfer now");
  await cdp.waitFor("!document.querySelector('.modal')");
  await sleep(300);

  const beforeReload = await cdp.evaluate(`(() => {
    const txt = document.body.innerText;
    const match = txt.match(/Spendable today[\\s\\S]{0,80}₹[\\d,]+/);
    return { spendable: match ? match[0].replace(/\\s+/g, ' ') : null, txt: txt.slice(0, 0) };
  })()`);

  const savedShape = await cdp.evaluate(`(() => {
    const raw = localStorage.getItem('cashflow-compass:v2');
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      version: data.version,
      active: data.active,
      own: data.own.transactions.length,
      transfers: data.own.transfers.length,
      opening: data.own.openingBalance,
      reserve: data.own.reserve,
    };
  })()`);
  record(
    "Recording income + savings transfer persists under cashflow-compass:v2",
    Boolean(
      savedShape &&
        savedShape.version === 2 &&
        savedShape.active === "own" &&
        savedShape.own === 1 &&
        savedShape.transfers === 1 &&
        savedShape.opening === 45000 &&
        savedShape.reserve === 20000,
    ),
    JSON.stringify(savedShape),
  );

  const cashCheck = await cdp.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('.headline-card'));
    const find = (label) => {
      const card = cards.find((c) => (c.textContent || '').includes(label));
      const value = card?.querySelector('.headline-value')?.textContent ?? '';
      return value;
    };
    return { spendable: find('Spendable today'), low: find('Next projected low') };
  })()`);
  record(
    "Spendable today = 45,000 opening + 60,000 in (savings shown separately)",
    cashCheck.spendable.replace(/[^\d]/g, "") === "105000",
    JSON.stringify(cashCheck),
  );
  const savingsNote = await cdp.evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('.headline-card'))[0];
    return card ? card.textContent : '';
  })()`);
  record(
    "Money moved to savings is held out of spendable and stated plainly",
    /20,000 set aside in savings/.test(savingsNote),
    savingsNote.slice(0, 90),
  );

  await cdp.reload();
  await cdp.waitFor("!!document.querySelector('.headline-card')");
  const afterReload = await cdp.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('.headline-card'));
    const card = cards.find((c) => (c.textContent || '').includes('Spendable today'));
    return {
      value: card?.querySelector('.headline-value')?.textContent ?? '',
      rows: document.body.innerText.includes('1 recorded rows') || document.body.innerText.includes('2 recorded rows'),
      stillOwn: JSON.parse(localStorage.getItem('cashflow-compass:v2')).active,
    };
  })()`);
  record(
    "After refresh the same workspace reopens with the same balance",
    afterReload.value.replace(/[^\d]/g, "") === "105000" && afterReload.stillOwn === "own",
    JSON.stringify(afterReload),
  );

  /* ---------------- Journey 2: CSV import, review recurring + EMI, match ---------------- */
  await cdp.click(".add-more");
  await cdp.waitFor("!!document.querySelector('.add-menu')");
  await cdp.clickText(".add-menu button", "Import CSV");
  await cdp.waitFor("!!document.querySelector('.dropzone')");

  const csv = buildCsv();
  writeFileSync('/tmp/cfc-test.csv', csv);
  await cdp.evaluate(`(() => {
    const dropzone = document.querySelector('.dropzone');
    const input = dropzone.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(csv)}], 'statement.csv', { type: 'text/csv' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await cdp.waitFor("!!document.querySelector('.import-preview')", 8000);

  const summary = await cdp.waitFor(`(() => {
    const sum = document.querySelector('.import-summary');
    return sum ? sum.innerText.replace(/\\s+/g, ' ') : null;
  })()`);
  record(
    "CSV preview shows inflow/outflow totals, date range and duplicates",
    Boolean(
      summary &&
        /MONEY IN|Money in/i.test(summary) &&
        /MONEY OUT|Money out/i.test(summary) &&
        /DATE RANGE|Date range/i.test(summary) &&
        /DUPLICATES|Duplicates/i.test(summary),
    ),
    summary,
  );
  const blockingError = await cdp.evaluate(
    "document.querySelector('.notice-error')?.innerText.replace(/\s+/g,' ') ?? ''",
  );
  if (blockingError) record("CSV parsed without blocking errors", false, blockingError);
  const importDisabled = await cdp.evaluate(
    "!!document.querySelector('.modal-foot .btn-primary')?.disabled",
  );
  record("Import button is enabled for a valid file", !importDisabled, blockingError);
  record("CSV preview offers append or replace", Boolean(await cdp.waitFor("!!document.querySelector('.import-mode')")));

  const modeNow = await cdp.evaluate(
    "Array.from(document.querySelectorAll('.import-mode button')).map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '[on]' : '')).join(',')",
  );
  log("IMPORT-MODE:", modeNow);
  const importClicked = await cdp.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll(".modal-foot button"))
      .find((b) => b.textContent.trim().indexOf("Import ") === 0 && b.textContent.trim() !== "Import CSV" && !b.disabled);
    if (!btn) return String(Array.from(document.querySelectorAll(".modal-foot button")).map((b) => b.textContent.trim()));
    btn.click();
    return "clicked";
  })()`);
  const modalClosed = await cdp.waitFor("!document.querySelector('.modal')", 8000);
  record("Import commits when the button says Import N transactions", importClicked === "clicked" && Boolean(modalClosed), String(importClicked));
  await sleep(600);

  const storageDump = await cdp.evaluate(`(() => {
    const raw = localStorage.getItem('cashflow-compass:v2');
    if (!raw) return { keys: Object.keys(localStorage), raw: null };
    const data = JSON.parse(raw);
    return {
      active: data.active,
      own: data.own.transactions.length,
      demo: data.demo ? data.demo.transactions.length : null,
      keys: Object.keys(localStorage),
    };
  })()`);
  log("IMPORT-DUMP:", JSON.stringify(storageDump));
  const uiRows = await cdp.evaluate(`(() => {
    const m = document.body.innerText.match(/(\d+) recorded rows/);
    return m ? m[1] : null;
  })()`);
  log("UI-ROWS:", uiRows);
  const importedCount = storageDump.own > 1 ? storageDump.own : 0;
  record("CSV rows are appended to the recorded ledger", importedCount > 1, `${importedCount} rows`);

  // Upcoming: confirm a recurring receipt and an EMI
  await cdp.clickText(".nav-btn", "Upcoming");
  await cdp.waitFor("!!document.querySelector('.schedule-strip')", 8000);
  await cdp.clickText(".tab, .chip, [role=tab]", "Confirmed");
  await cdp.waitFor("!!document.querySelector('article.recurring-card h3')", 8000);
  const recurringLabels = await cdp.evaluate(
    "Array.from(document.querySelectorAll('article.recurring-card h3')).map((h) => h.textContent)",
  );
  record(
    "Recurring detection finds the salary receipt and the EMI",
    recurringLabels.some((label) => /salary|acme/i.test(label)) && recurringLabels.some((label) => /emi/i.test(label)),
    JSON.stringify(recurringLabels.slice(0, 8)),
  );

  const emiCard = await cdp.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('article.recurring-card'));
    const emi = cards.find((c) => /emi/i.test(c.querySelector('h3')?.textContent || ''));
    if (!emi) return null;
    return {
      label: emi.querySelector('h3').textContent,
      buttons: Array.from(emi.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
      showsNext: /Next expected/.test(emi.innerText || ''),
      textContentHasTypical: /Typical amount/.test(emi.textContent || ''),
      nextEl: (() => { const n = emi.querySelector('.recurring-next'); if (!n) return null; const r = n.getBoundingClientRect(); return { text: n.textContent, w: Math.round(r.width), h: Math.round(r.height) }; })(),
      cardH: Math.round(emi.getBoundingClientRect().height),
    };
  })()`);
  record(
    "Confirmed EMI shows its next date and offers a date change",
    Boolean(emiCard && emiCard.nextEl && emiCard.nextEl.text && emiCard.buttons.some((b) => /Edit date/i.test(b))),
    JSON.stringify(emiCard),
  );

  // Dismissing a pattern must be remembered, and restoring it must clear the choice.
  await cdp.clickText(".tab, .chip, [role=tab]", "Confirmed");
  await cdp.waitFor("!!document.querySelector('article.recurring-card')", 8000);
  const dismissTarget = await cdp.evaluate(`(() => {
    const card = Array.from(document.querySelectorAll('article.recurring-card'))[0];
    const btn = card && Array.from(card.querySelectorAll('button')).find((b) => /Not a bill/i.test(b.textContent || ''));
    if (!btn) return null;
    btn.click();
    return card.querySelector('h3').textContent;
  })()`);
  await sleep(500);
  const dismissedStored = await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    const entries = Object.entries(raw.own.overrides || {});
    return entries.filter(([, v]) => v === 'dismissed').map(([k]) => k);
  })()`);
  record(
    "Marking a pattern as not-a-bill is remembered for that merchant",
    Boolean(dismissTarget) && dismissedStored.length > 0,
    JSON.stringify({ dismissTarget, dismissedStored }),
  );

  await cdp.evaluate(`(() => {
    const tab = Array.from(document.querySelectorAll('[role=tab]'))
      .find((t) => /^Dismissed/.test((t.textContent || '').trim()));
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await sleep(600);
  const restoreClicked = await cdp.evaluate(`(() => {
    // The dismissed pattern is whichever card carries a Restore button.
    const card = Array.from(document.querySelectorAll('article.recurring-card'))
      .find((c) => Array.from(c.querySelectorAll('button')).some((b) => /Restore/i.test(b.textContent || '')));
    const btn = card && Array.from(card.querySelectorAll('button')).find((b) => /Restore/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(500);
  const afterRestore = await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    return Object.keys(raw.own.overrides || {});
  })()`);
  record(
    "Restoring a dismissed pattern clears the override",
    restoreClicked && afterRestore.length === 0,
    JSON.stringify({ restoreClicked, afterRestore }),
  );


  // An expected invoice that the ledger already contains a matching row for.
  await cdp.clickText(".nav-btn", "Activity");
  await cdp.waitFor("!!document.querySelector('.ledger-list')", 8000);
  const expectedSetup = await cdp.evaluate(`(() => {
    const first = Array.from(document.querySelectorAll('.ledger-list li'))
      .map((li) => li.innerText.replace(/\s+/g, ' ').trim())
      .find((txt) => /Freelance|Client|Retainer/i.test(txt));
    return first ?? '';
  })()`);
  await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    // An expected invoice from 3 days ago that the imported ledger already contains.
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const txDate = new Date(today.getTime() - 2 * 86400000);
    const expDate = new Date(today.getTime() - 3 * 86400000);
    const amount = 19250;
    raw.own.transactions.push({
      id: 'tx_match_' + Date.now(), date: iso(txDate), description: 'Client Project Payment',
      amount, direction: 'income', category: 'Freelance', source: 'csv',
    });
    raw.own.expected = [{
      id: 'exp_match_1', label: 'Client Project Payment', amount, direction: 'income',
      date: iso(expDate), certainty: 'likely', kind: 'invoice', category: 'Freelance', source: 'manual'
    }];
    localStorage.setItem('cashflow-compass:v2', JSON.stringify(raw));
  })()`);
  await cdp.reload();
  await cdp.waitFor("!!document.querySelector('.context-bar')", 8000);
  await cdp.clickText(".nav-btn", "Activity");
  await cdp.waitFor("!!document.querySelector('.ledger-list')", 8000);
  await cdp.waitFor("!!document.querySelector('.reconcile-card')", 8000);

  // Activity + reconciliation
  const reconcilePresent = await cdp.waitFor("!!document.querySelector('.reconcile-list li')", 4000);
  let matched = false;
  if (reconcilePresent) {
    const before = await cdp.evaluate("document.querySelectorAll('.ledger-list li').length");
    await cdp.clickText(".reconcile-list .btn-primary", "Match");
    await sleep(500);
    const twice = await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('.ledger-list li'));
      const counts = {};
      rows.forEach((r) => {
        const key = (r.innerText || '').replace(/\\s+/g, ' ').trim();
        counts[key] = (counts[key] || 0) + 1;
      });
      const dup = Object.values(counts).some((c) => c > 1);
      return { rows: rows.length, dup, before: ${before} };
    })()`);
    matched = !twice.dup;
    record("Matching an expected item to a recorded row does not duplicate it", matched, JSON.stringify(twice));
  } else {
    record("Reconciliation proposals exist for imported expected money", false, "no proposals offered");
  }

  /* ---------------- Journey 3: guided demo, laptop, delayed receipt, calendar, fix, exit ---------------- */
  await cdp.clickText(".nav-btn", "Overview");
  await cdp.waitFor("!!document.querySelector('.headline-card')", 6000);
  const ownBeforeTour = await cdp.evaluate(
    "String(JSON.parse(localStorage.getItem('cashflow-compass:v2')).own.transactions.length)",
  );
  const cashBeforeTour = await cdp.waitFor(`(() => {
    const card = Array.from(document.querySelectorAll('.headline-card'))[0];
    const raw = card ? (card.querySelector('.headline-value') || {}).textContent || '' : '';
    const digits = raw.split('').filter((ch) => ch >= '0' && ch <= '9').join('');
    return digits || null;
  })()`, 6000);
  record("Baseline spendable captured before the tour", Boolean(cashBeforeTour), cashBeforeTour);
  await cdp.click(".help-fab");
  await cdp.waitFor("!!document.querySelector('.tour-steps')");
  await cdp.clickText(".btn-primary", "Start the tour");
  await cdp.waitFor("!!document.querySelector('.tour-card')", 8000);
  const tourStepOne = await cdp.evaluate("document.querySelector('.tour-card').innerText.replace(/\\s+/g,' ')");
  const demoActive = await cdp.evaluate("JSON.parse(localStorage.getItem('cashflow-compass:v2')).active");
  record(
    "Guided tour runs inside the isolated demo workspace",
    demoActive === "demo" && tourStepOne.includes("Step 1 of 5"),
    JSON.stringify({ demoActive, step: tourStepOne.slice(0, 60) }),
  );

  const plannerOpen = await cdp.waitFor("!!document.querySelector('#purchase-planner')");
  record("Tour opens the real purchase planner", Boolean(plannerOpen));

  const demoExpectedNow = await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    const ws = raw.active === 'demo' ? raw.demo : raw.own;
    return (ws.expected || []).filter((e) => e.direction === 'income').length;
  })()`);
  record("Demo workspace contains expected receipts the planner can defer", demoExpectedNow > 0, String(demoExpectedNow));
  const verdictBefore = await cdp.evaluate(`(() => ({
    stats: Array.from(document.querySelectorAll('#purchase-planner .pp-stat')).map((d) => d.textContent),
    shortfall: document.querySelectorAll('.pp-cell-negative, .pp-cell-shortfall').length,
    text: (document.querySelector('#purchase-planner')?.textContent || '').replace(/\s+/g, ' ').slice(0, 200),
  }))()`);
  const nextOne = await cdp.clickText(".tour-card .btn", "Next");
  await sleep(400);
  const stepTwo = await cdp.evaluate("document.querySelector('.tour-card')?.innerText.replace(/\s+/g,' ').slice(0,50) ?? ''");
  record("Tour Next advances the step", Boolean(nextOne) && /Step 2 of 5/.test(stepTwo), stepTwo);
  // Person 2's planner exposes the receipt-delay assumption as range sliders.
  const delaySetup = await cdp.evaluate(`(() => {
    const sliders = Array.from(document.querySelectorAll('#purchase-planner input[type=range]'));
    if (!sliders.length) return { found: 0 };
    return { found: sliders.length, values: sliders.map((s) => s.value) };
  })()`);
  const delayMoved = await cdp.evaluate(`(() => {
    const sliders = Array.from(document.querySelectorAll('#purchase-planner input[type=range]'));
    if (sliders.length < 2) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const max = sliders[0];
    setter.call(max, String(Math.min(30, Math.max(14, Number(max.max) || 30))));
    max.dispatchEvent(new Event('input', { bubbles: true }));
    max.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  const delayMoved2 = await cdp.evaluate(`(() => {
    const sliders = Array.from(document.querySelectorAll('#purchase-planner input[type=range]'));
    if (sliders.length < 2) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const sel = sliders[1];
    setter.call(sel, String(Number(sel.max) || 7));
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const verdictAfter = await cdp.evaluate(`(() => ({
    stats: Array.from(document.querySelectorAll('#purchase-planner .pp-stat')).map((d) => d.textContent.replace(/\s+/g, ' ')),
    shortfall: document.querySelectorAll('.pp-cell-negative, .pp-cell-shortfall').length,
    text: document.querySelector('#purchase-planner')?.textContent.replace(/\s+/g, ' ').slice(0, 400) ?? '',
  }))()`);
  const demoIncome = await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    const ws = raw.active === 'demo' ? raw.demo : raw.own;
    return (ws.expected || []).filter((e) => e.direction === 'income').length;
  })()`);
  record(
    "Delaying a client receipt re-runs the decision (figures or shortfall days move)",
    Boolean(delayMoved) && Boolean(delayMoved2) &&
      (verdictBefore.text !== verdictAfter.text ||
        verdictBefore.shortfall !== verdictAfter.shortfall ||
        JSON.stringify(verdictBefore.stats) !== JSON.stringify(verdictAfter.stats)),
    JSON.stringify({ demoExpectedIncome: demoIncome, sliders: delaySetup, before: verdictBefore.text.slice(0,80), after: verdictAfter.text.slice(0,80) }),
  );

  await cdp.clickText(".tour-card .btn", "Next");
  await sleep(400);
  const cellClicked = await cdp.evaluate(`(() => {
    const cells = Array.from(document.querySelectorAll('.pp-cell[data-date]'));
    if (!cells.length) return false;
    cells[Math.min(3, cells.length - 1)].click();
    return true;
  })()`);
  await sleep(300);
  const detail = await cdp.evaluate(
    "document.querySelector('#purchase-planner')?.textContent.replace(/\\s+/g,' ').slice(0, 600) ?? ''",
  );
  record(
    "Clicking a calendar date explains that day",
    Boolean(cellClicked) && /lowe|leaves|afford|re erve|reserve|shortfall|cover|pass/i.test(detail),
    detail.slice(0, 100),
  );

  await cdp.clickText(".tour-card .btn", "Next");
  await sleep(300);
  // The fix panel only offers a repair when one exists. When the baseline itself
  // already breaks the reserve there is nothing to apply, so accept a clear
  // explanation instead of inventing a fix.
  const fixState = await cdp.evaluate(`(() => {
    const root = document.querySelector('#purchase-planner');
    const text = (root?.textContent || '').replace(/\s+/g, ' ');
    const btn = Array.from(root?.querySelectorAll('button') || [])
      .filter((b) => /^Apply$|Apply fix/.test((b.textContent || '').trim()) && !b.disabled)[0];
    return { hasApply: Boolean(btn), text: text.slice(0, 1200) };
  })()`);
  let applied = false;
  if (fixState.hasApply) {
    applied = await cdp.evaluate(`(() => {
      const root = document.querySelector('#purchase-planner');
      const btn = Array.from(root?.querySelectorAll('button') || [])
        .filter((b) => /^Apply$|Apply fix/.test((b.textContent || '').trim()) && !b.disabled)[0];
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(400);
  }
  const fixExplained = /already breaks the re|already break|no fix|not possible|Add cash|reduce|short/i.test(
    fixState.text,
  );
  record(
    "A suggested fix can be applied or is honestly explained",
    Boolean(applied) || Boolean(fixExplained),
    JSON.stringify({ applied, hasApply: fixState.hasApply, explained: fixExplained }),
  );

  await cdp.clickText(".tour-card .btn", "Next");
  await sleep(400);
  await cdp.clickText(".tour-card .btn", "Next");
  await sleep(400);
  const lastStep = await cdp.evaluate("document.querySelector('.tour-card')?.innerText.replace(/\s+/g,' ').slice(0,40) ?? ''");
  record("Tour reaches the final step with a finish action", /Step 5 of 5/.test(lastStep), lastStep);
  await cdp.clickText(".tour-card .btn", "Finish and exit");
  await sleep(700);
  const backHome = await cdp.evaluate(`(() => ({
    active: JSON.parse(localStorage.getItem('cashflow-compass:v2')).active,
    page: document.querySelector('.overview-head') ? 'overview' : 'other',
    spendable: Array.from(document.querySelectorAll('.headline-card')).find(c => (c.textContent||'').includes('Spendable today'))?.querySelector('.headline-value')?.textContent ?? '',
  }))()`);
  record(
    "Exiting the tour restores the user's own workspace unchanged",
    backHome.active === "own" &&
      backHome.page === "overview" &&
      backHome.spendable.replace(/[^\d]/g, "") === cashBeforeTour,
    JSON.stringify({ ...backHome, expectedCash: cashBeforeTour, ownRows: ownBeforeTour }),
  );

  /* ---------------- Journey 4: insights accuracy, samples, sparse behaviour ---------------- */
  await cdp.clickText(".nav-btn", "Overview");
  await cdp.waitFor("!!document.querySelector('.chart-keyboard-layer')", 6000);
  const keyboard = await cdp.evaluate(`(() => {
    const layer = document.querySelector('.chart-keyboard-layer');
    if (!layer) return { found: false };
    layer.focus();
    return {
      found: true,
      active: document.activeElement === layer,
      role: layer.getAttribute('role'),
      label: layer.getAttribute('aria-label'),
      valuetext: layer.getAttribute('aria-valuetext'),
    };
  })()`);
  let moved = null;
  if (keyboard.found) {
    await cdp.key("ArrowRight", "ArrowRight", 39);
    await sleep(150);
    await cdp.key("ArrowRight", "ArrowRight", 39);
    await sleep(200);
    moved = await cdp.evaluate("document.querySelector('.chart-keyboard-layer').getAttribute('aria-valuetext')");
  }
  const openedByKeyboard = await cdp.evaluate(`(() => {
    const before = document.querySelectorAll('.low-detail').length;
    return { before };
  })()`);
  if (keyboard.found) {
    await cdp.evaluate("document.querySelector('.chart-keyboard-layer').focus()");
    await cdp.key("Enter", "Enter", 13);
    await sleep(400);
  }
  const dayDetail = await cdp.evaluate(
    "document.querySelector('.low-detail')?.innerText.replace(/\s+/g,' ').slice(0,70) ?? ''",
  );
  record(
    "Balance chart is keyboard operable (focusable slider, arrow keys move the day)",
    Boolean(keyboard.found && keyboard.active && keyboard.role === "slider" && moved && moved !== keyboard.valuetext),
    JSON.stringify({ active: keyboard.active, role: keyboard.role, from: keyboard.valuetext, to: moved }),
  );
  record(
    "Arrow keys + Enter on the chart reveal that day's cash detail",
    Boolean(dayDetail),
    JSON.stringify({ dayDetail, wasOpen: openedByKeyboard.before }),
  );

  await cdp.clickText(".nav-btn", "Insights");
  await cdp.waitFor("document.body.innerText.includes('Forecast accuracy')", 8000);
  const insights = await cdp.evaluate(`(() => {
    const txt = document.body.innerText;
    const stats = Array.from(document.querySelectorAll('.accuracy-stats div')).map((d) => d.innerText.replace(/\\s+/g,' '));
    return {
      stats,
      measured: /AVERAGE DAILY ERROR|Average daily error/i.test(txt),
      insufficient: /Insufficient history/i.test(txt),
      samples: /SAMPLE SIZE|Sample size/i.test(stats.join(' ')),
    };
  })()`);
  record(
    "Insights shows accuracy stats with sample size (or honest insufficient history)",
    Boolean((insights.measured && insights.samples) || insights.insufficient),
    JSON.stringify(insights.stats.slice(0, 3)),
  );

  await cdp.evaluate("document.querySelector('.reliability-toggle')?.click()");
  await cdp.waitFor("!!document.querySelector('.reliability-panel')");
  const panel = await cdp.evaluate("document.querySelector('.reliability-panel').innerText.replace(/\\s+/g,' ')");
  record(
    "Reliability panel exposes range, coverage, error and the estimate disclaimer",
    /Intended range/.test(panel) && /Days with activity/.test(panel) && /Forecasts are estimates/.test(panel),
    panel.slice(0, 90),
  );

  // Sparse-history behaviour: start a fresh empty workspace in a second demo slot
  const sparse = await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    raw.own = { ...raw.own, transactions: raw.own.transactions.slice(0, 3) };
    localStorage.setItem('cashflow-compass:v2', JSON.stringify(raw));
    return true;
  })()`);
  await cdp.reload();
  await cdp.waitFor("!!document.querySelector('.context-bar')", 8000);
  await cdp.clickText(".nav-btn", "Insights");
  await cdp.waitFor("document.body.innerText.includes('Forecast accuracy')", 8000);
  const sparseText = await cdp.evaluate("document.body.innerText");
  record(
    "Sparse history shows 'Insufficient history' instead of invented accuracy",
    sparse && sparseText.includes("Insufficient history"),
  );

  // restore full ledger
  await cdp.evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('cashflow-compass:v2'));
    raw.own.transactions = ${JSON.stringify([])};
    localStorage.setItem('cashflow-compass:v2', JSON.stringify(raw));
  })()`);

  /* ---------------- Journey 5: phone-sized purchase decision + keyboard ---------------- */
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.reload();
  await cdp.waitFor("!!document.querySelector('.context-bar')", 8000);
  await cdp.clickText(".mobile-nav .nav-btn", "Plan");
  await cdp.waitFor("!!document.querySelector('#purchase-planner')", 8000);
  const mobile = await cdp.evaluate(`(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const cells = document.querySelectorAll('.pp-cell[data-date]').length;
    const rect = document.querySelector('#purchase-planner')?.getBoundingClientRect();
    return { overflow, cells, width: rect?.width ?? 0, viewport: window.innerWidth };
  })()`);
  record(
    "Purchase decision works on a 390px screen without horizontal scrolling",
    mobile.cells > 0 && mobile.overflow === 0,
    JSON.stringify(mobile),
  );

  const verdictOnMobile = await cdp.evaluate(
    "document.querySelector('#purchase-planner')?.textContent.replace(/\s+/g,' ').slice(0, 4000) ?? ''",
  );
  record(
    "Verdict is readable on mobile",
    /Works acro|Works across|Depends on payment|Below re|Below reserve|In ufficient|Insufficient/i.test(
      verdictOnMobile,
    ),
    verdictOnMobile.slice(0, 80),
  );

  /* ---------------- console errors ---------------- */
  record("No uncaught runtime errors during the journeys", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  await cdp.send("Emulation.clearDeviceMetricsOverride");
  ws.close();
  chrome.kill();

  const passed = results.filter((r) => r.ok).length;
  log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) {
    log("Failures:");
    for (const result of results.filter((r) => !r.ok)) log(` - ${result.name}: ${result.detail ?? ""}`);
    process.exitCode = 1;
  }
}

function buildCsv() {
  const today = new Date();
  const rows = ["date,description,amount,type,category"];
  for (let month = 5; month >= 0; month--) {
    const anchor = new Date(today.getFullYear(), today.getMonth() - month, 1);
    const iso = (day) => {
      const d = new Date(anchor.getFullYear(), anchor.getMonth(), day);
      if (d > today) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const add = (day, description, amount, type, category) => {
      const date = iso(day);
      if (date) rows.push(`${date},${description},${amount},${type},${category}`);
    };
    add(3, "Acme Studio Retainer", 55000, "income", "Freelance");
    add(4, "HDFC Car Loan EMI", 12400, "expense", "Loan EMI");
    add(6, "House Rent Koramangala", 28000, "expense", "Rent");
    add(9, "Netflix Subscription", 649, "expense", "Subscriptions");
    add(12, "BigBasket Groceries", 3200 + month * 40, "expense", "Groceries");
    add(15, "Uber Rides", 820, "expense", "Transport");
    add(18, "Adobe Creative Cloud", 1675, "expense", "Subscriptions");
    add(21, "Client Project Payment", 18000 + month * 250, "income", "Freelance");
    add(24, "BESCOM Electricity", 1900 + month * 60, "expense", "Utilities");
  }
  return rows.join("\n");
}

main().catch((error) => {
  console.error("Journey check crashed:", error);
  process.exitCode = 1;
}).finally(() => {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});