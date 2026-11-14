# Purchase Planner — Person 2 deliverable

The interactive purchase planner and the evaluation of purchase decisions, implemented as a
self-contained feature under `src/features/planner/`.

Nothing outside this folder was modified: `App.tsx`, `store.tsx`, `styles.css` and the shared
domain contracts are untouched, so the feature merges cleanly into Person 3's integration.

---

## 1. What Person 3 needs to do

One line in `App.tsx`:

```tsx
import { PurchasePlannerPage } from "./features/planner/mount";

// replace the old What-if page
{page === "planner" && <PurchasePlannerPage />}
```

`PurchasePlannerPage` reads the live store itself (via `usePlannerDataFromStore()` →
`plannerDataFromApp()`), so no props are needed. When Person 1's shared forecast module lands,
only `plannerDataFromApp` in `adapter.ts` changes.

### The component and its props

```tsx
import { PurchasePlanner } from "./features/planner/PurchasePlanner";
```

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `data` | `PlannerData` | yes | The active user's financial slice. Map it with `plannerDataFromApp`. |
| `onRecordPurchase` | `(purchase) => void` | no | Fired **only** when the user clicks *Record purchase*. Never fired for a what-if. |
| `history` | `{ start, events }` | no | Recorded transactions, so the historical replay can run. Without it the replay shows its genuine empty state. |
| `notify` | `(message) => void` | no | The app's own toast. The planner does not own notifications. |

### Required `PlannerData` props

```ts
today                // local ISO date — planner candidates start here
openingBalance       // projected balance on `today` (INR)
reserve              // user's cash reserve (INR)
receipts             // PlannerEvent[] — expected income occurrences
bills                // PlannerEvent[] — expenses driving the path (may carry `flexibility`)
daily                // { date, balance, lower, upper }[] — shared daily forecast
forecastEnd          // last date covered by the forecast
baseline             // baseline daily balances (same as `daily` when nothing is overlaid)
variableNetPerDay    // average variable net cash flow per day
variableExpensePerDay// average everyday spend per day (used for honest wording)
provenance           // { source: "user-data" | "development-fixture", note }
```

`PlannerEvent` additionally supports `seriesKey` (to re-date one occurrence of a series) and
`flexibility: { earliest, latest }` (to offer the "move an expense" fix).

### Production vs fixture

- **Production always uses the active user's data.** `plannerDataFromApp` reads
  `baselineForecast`, `settings.safetyThreshold` and `today` from the store.
- The **development fixture** in `adapter.ts` (`buildDevelopmentFixture`) is labelled in the
  data (`provenance.source === "development-fixture"`), in the UI (a yellow
  "Development fixture" badge plus a "not your money" banner), and in the checks. It is only
  reachable through `PurchasePlannerFixturePage`, which the app never mounts.

---

## 2. How the maths works

The single most important guarantee: **the planner reproduces the app's forecast exactly.**
`ledgerMatchesShared()` asserts this in the checks.

1. The shared forecast gives `daily[].balance`, a path that already includes every recorded and
   expected movement.
2. `buildMovementIndex` derives the per-date cash change baked into that path.
3. A hypothetical change is applied as a **difference**, never as a re-addition:
   `plan(t) = plan(t−1) + sharedChange(t) + (scenarioCash(t) − baselineCash(t))`.
   Untouched dates therefore stay identical to the shared forecast.

### Moving a receipt

`moveReceipt(data, receiptId, delayDays)` moves **one occurrence**, keyed by event id:

- the receipt is removed from `originalDate` and added on `revisedDate`;
- the difference is applied only for dates in `[originalDate, revisedDate)`;
- money is unavailable during that span, and if `revisedDate` falls past the visible period
  the cash stays unavailable (never double-counted);
- recorded history before `today` is never in the ledger at all.

Verified: delaying the ₹20,000 receipt 7 days changes exactly 7 dates
(15 → 21 Jan), drops the balance by exactly ₹20,000 inside the span, and the balance on
22 Jan matches the baseline to the rupee.

### Verdicts

For each eligible purchase date the planner tests delays `0..maxDelay`:

| Verdict | Meaning |
| --- | --- |
| `works` | every tested delay keeps the balance at or above the reserve |
| `timing` | on-time is fine, at least one delay is not |
| `below-reserve` | the reserve is crossed even with an on-time payment |
| `insufficient-window` | the fixed follow-up period runs past the shared forecast — **not graded** |

Every candidate uses the **same follow-up period**, so late dates cannot be flattered by a
shorter window. Colour is always paired with an icon and a text label.

### Explanation, honestly

`explainDate` names the purchase, a specific bill, or everyday spending as the trigger *only
when the figures support it*: it measures the purchase and the largest bill as a share of the
actual drop between the purchase date and the breach date. Scenario counts are reported as
"Passes X of Y tested delays". **No probability is displayed anywhere**, because the app has no
separately validated probability model.

### Fixes

`findFixes` returns the largest affordable reduced price (binary search on a ₹100 grid), the
earliest workable date for the full amount, and optionally a movable expense inside the
user-approved `flexibility` window. Each candidate fix is:

- tested with the **same receipt-delay assumption** the user is viewing;
- re-checked over the **whole forecast**, so a second shortage is reported
  (`secondShortage` / `outsideTestedWindow`) instead of hidden;
- accompanied by `baselineBreaches` and `noDateWorks` flags.

### Savings and replay

- `runSavingsScenario` compares an accessible pot with a pot locked until a date; locked money
  is withheld from spendable cash until release. Zero return is always shown; a user-entered
  return is labelled and reported next to it.
- `runHistoricalReplay` grades each cutoff using **only what was knowable then** and scores it
  against held-out realised balances, comparing against the simple rule
  "balance − price > reserve". Reports purchases recommended that later breached, those that
  held, deferred ones that would have worked, and the number of cutoffs evaluated. It labels
  synthetic results and shows a genuine empty state when history is too short. It never
  asserts an advantage the counts do not show.

---

## 3. Acceptance checks

```
npm run check:planner      # 57 engine checks, all passing
npm run check:planner:ui   # 29 browser checks (headless Chrome), all passing
npm run demo:planner       # prints the exact fixture numbers quoted below
```

`npm run build` (typecheck + bundle) passes.

| Spec check | Where |
| --- | --- |
| ₹12,000 projected low / ₹5,000 reserve / ₹10,000 purchase | §1 of `scripts/planner-checks.ts` |
| ₹20,000 receipt delayed 7 days affects the correct dates, counted once | §2 |
| Calendar classification and `passes X of 8` | §3 |
| Each date explains itself, no probability | §4 |
| Smallest workable change (price / date / movable bill) | §5 |
| Baseline shortage, deadline too soon, EMI outside view, incomplete follow-up | §6 |
| Savings scenario | §7 |
| Historical replay + empty state | §8 |
| Fixture parity and labelling | §9 |

### Actual fixture results

```
FIXTURE
  today                2026-01-05        opening balance ₹60,000
  reserve               ₹5,000
  projected low          ₹12,000 on 2026-01-14 (day 9, the day before the receipt)
  forecast end          2026-05-05

CALENDAR (price ₹10,000, 14 Jan – 3 Feb, 8 tested delays, 30-day follow-up)
  earliest workable      2026-01-31
  14 Jan .. 30 Jan       below-reserve, passes 0/8   (floor ₹2,000 with an on-time receipt)
  31 Jan .. 03 Feb       works,         passes 8/8   (floor ₹10,642)

EXPLANATION for 14 Jan
  lowest balance         ₹2,000 on 14 Jan
  first reserve breach   ₹2,000 on 14 Jan (₹3,000 short)
  first negative         none
  trigger                New laptop (your purchase) — takes ₹10,000 out on 14 Jan
  scenario count         passes 0 of 8 tested delays

FIXES
  baseline               does not breach (floor ₹12,000) — the shortage is caused by the purchase
  reduced price          ₹6,900 keeps the reserve intact
  earliest full price    2026-01-31
  second shortage        ₹2,000 on 14 Jan

RECEIPT DELAY (₹20,000 delayed 7 days)
  15 Jan → 22 Jan, 7 dates affected, balance drops exactly ₹20,000 inside the span,
  and regained on 22 Jan (₹23,001 = baseline)

INSUFFICIENT WINDOW from 2026-04-25 (graded through 2026-04-05)
```

---

## 4. Judge demo — exact clicks

The default screen is already the demo case: **₹10,000 laptop**, reserve ₹5,000, one expected
₹20,000 receipt, 8 tested delays, 30-day follow-up.

1. **Enter the purchase.** The form is pre-filled with "New laptop · ₹10,000", earliest
   14 Jan, latest 3 Feb. Change the price or either date and the calendar updates instantly.
2. **See the earliest workable date.** At the bottom of the calendar card: *"Earliest workable
   date: 31 Jan"*. Every date 14–30 Jan shows a red ✕ "Below reserve even with on-time payment".
3. **Change the delay.** Drag *Maximum tested delay* to 7 (it already is) and watch the
   `n/8` counter on each cell. Move *Assume this delay for the shown numbers* to 7 to see the
   numbers under a late receipt.
4. **Click 14 Jan** in the calendar (or press Enter on it). The explanation panel reports
   lowest balance ₹2,000, the first reserve breach on 14 Jan (₹3,000 short), no negative
   balance, the purchase named as the trigger with its share of the drop, and
   "Passes 0 of 8 tested delays".
5. **Delay the client payment.** In *Expected receipt* keep "Nova Design Studio invoice ·
   ₹20,000 · 15 Jan", set *Assume this delay* to 7. The explanation now adds that the receipt
   is assumed to arrive on 22 Jan, and the balance trace shows the dip.
6. **Apply the smallest change.** In *The smallest workable change*, click **Apply** on
   "Reduce the price to about ₹6,900" — the panel marks it as a hypothetical change and the
   calendar turns green. Click **Undo** to restore ₹10,000.
7. **Alternatively move the date.** Click **Preview** on "Buy the full amount on 2026-01-31" —
   the inspection jumps to 31 Jan and every date from there works.
8. **Show the honesty case.** Switch *How will you pay?* to **EMI**, then set *Instalments* to
   24. The payment shape shows down payment, fees, financed amount, instalments and total paid,
   plus "… commitments continue past 5 May (last on …), beyond the chart", and the calendar
   marks dates whose follow-up no longer fits as "Insufficient forecast window".
9. **Phone view.** Narrow the window below 720px: the grid becomes a compact list with the
   same dates, each showing a text + icon verdict and the balance.
10. **Keyboard.** Tab to a date cell and use arrow keys to walk the calendar; the inspection
    pane follows the selection.

Two later sections (historical replay and savings) sit below the fold and are the "second
screen" for judges: the replay reports cutoffs evaluated and labels synthetic results, and the
savings panel always shows a zero-return case next to any assumed return.

---

## 5. File map

```
src/features/planner/
  PurchasePlanner.tsx      entry component + props + state wiring
  mount.tsx                PurchasePlannerPage (store adapter) + fixture page
  adapter.ts               PlannerData mapping + labelled development fixture
  planner.css              all styles scoped under .pp-root
  engine/
    types.ts               the shared contract (the only public surface)
    dates.ts               local ISO date helpers
    schedule.ts            full / EMI / custom-loan schedules
    whatif.ts              ledger, receipt movement, verdicts, explanations
    calendar.ts            per-date simulation across tested delays
    fixes.ts               reduced price, earlier date, movable expense
    savings.ts             accessible vs locked pots
    replay.ts              historical replay + simple rule comparison
  ui/                      form, calendar, explanation, fixes, savings, replay
scripts/
  planner-checks.ts        57 engine checks
  ui-drive.mjs             29 browser checks (headless Chrome via playwright-core)
  demo-numbers.ts          prints the fixture numbers quoted above
```

## 6. Known limits

- The planner is deterministic arithmetic on the supplied forecast; it does not model interest
  saved, tax, or a probability of a receipt arriving.
- `daily` and `baseline` are the same path today because the store exposes one forecast. The
  contract keeps them separate so Person 1 can supply a distinct baseline later.
- `variableExpensePerDay` is estimated from the last 90 days of expenses in the adapter; the
  forecaster smooths variable spending per day, and the ledger reproduces that smoothing
  exactly.
- Git was not available on this machine, so the work is not on a `feature/purchase-planner`
  branch. Create the branch and commit `src/features/planner/`, `scripts/` and the four
  `package.json` script entries as-is.
