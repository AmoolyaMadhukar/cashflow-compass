# CashFlow Compass — merged build

Three people's work, in one app. Branch `feature/app-experience`, commit `dcce6bd`.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

To check it the way I did:

```bash
npm run build
npx vite preview --port 4200
npm run verify:journeys http://localhost:4200   # needs Chrome installed
```

## What came from where

| Area | Source | Files |
| --- | --- | --- |
| Cash-flow engine | Person 1 | `src/domain/` — ledger, forecast, recurring, reconciliation, spending, anomalies, quality, net-worth |
| Purchase planner | Person 2 | `src/features/planner/` — planner engine + UI, mounted on the Plan page |
| App, navigation, forms, dashboard, help | Person 3 | `src/App.tsx`, `src/pages/`, `src/components/`, `src/styles.css` |
| The join | New | `src/integration/` — `bridge.ts`, `services.ts`, `replay.ts`, `types.ts` |

The app stores rows in its own shape. `src/integration/bridge.ts` translates them into
Person 1's `FinancialSnapshot`, calls the engine, and converts the `Forecast` back into
what the pages render. `src/integration/services.ts` is the one place the store calls
into the engine.

## Bugs found while merging

These were real, and each one is covered by a check in `scripts/journey-check.mjs`.

1. **App crashed on boot.** `roomForPurchase` handed a fake object to
   `extraRoomForPurchase`, which read a `range` it did not have. It now derives the
   room directly from the projected low point.
2. **Planner could not grade a single date.** It needs a forecast long enough to test
   payment delays, but was given the dashboard's 30 days, so all 20 dates read
   "Insufficient forecast window". `PlanPage` now builds its own 120-day forecast.
3. **A dismissed bill could never be restored.** Overrides were saved as
   `direction:merchant` but read back by bare merchant key. Both forms now match.
4. **One malformed row blanked the entire app.** A missing description or date threw
   inside the engine. `normalizeDescription` and `parseISO` now degrade instead of
   throwing, and the bridge drops rows with unusable dates.

## Verified

- `npx tsc --noEmit` — clean.
- `npm run build` — green, 407 kB JS / 122 kB gzipped, 87 kB CSS.
- `npm run verify:journeys` — **33/33** in headless Chrome, twice, and once more from
  a fresh `git clone` + `npm install`.
- The suite drives real user journeys: onboarding and persistence, CSV import with
  totals and duplicate detection, recurring detection and dismissal, expected-vs-recorded
  matching, the purchase decision with a delayed receipt, applying a fix, the guided
  tour, the keyboard-operable balance chart, Insights accuracy, and a 390 px phone layout
  with no horizontal scrolling.

## Not verified

- Firefox and Safari — only Chrome was available here.
- Screen-reader output. Labels, roles and focus are in place, but no assistive
  technology was driven.
- Real touch devices; the phone check uses Chrome's device emulation at 390 px.
- Contrast ratios were set by hand, not measured.

## Known limitations

- The planner's fix panel only offers a repair when one exists. When the baseline
  itself already breaks the reserve it explains that instead — that is deliberate.
- Data lives in `localStorage` under `cashflow-compass:v2`; the old
  `cashflow-compass:v1` key is kept as a rollback copy until you delete it.
- No bank connection, no payments, no accounts, no external services.
