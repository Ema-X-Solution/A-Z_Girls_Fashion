# FIFO costing and quarterly closing, local implementation

Base: Ema-X-Solution/A-Z_Girls_Fashion, commit 01851ecabc49cb3e068d65492754d6bec9bef721.

Nothing was pushed, uploaded to GitHub, merged, deployed, or run against production. No production database or credentials were copied. Receipt, invoice, privacy and policy templates were not changed. The VAT setting was not changed for the new scenarios: the initial local store setting is 14% inclusive, so a 171 EGP item has 150 EGP revenue before VAT.

## What changed

- Each stock receipt/positive adjustment creates its own cost batch.
- FIFO consumes the oldest acquired cost layers. Transfers, shipping and quarantine release preserve their original cost and acquisition age.
- Sale lines retain an exact total cost in addition to the four-decimal display unit cost. Reports use the exact total rather than multiplying a rounded blended cost.
- Returns use the original consumed layers, including partial returns across layers. Unsellable returns do not put stock back or reverse COGS, matching the existing accounting behavior.
- A migration creates one opening batch per existing positive location/variant balance at that balance's current average cost. Historical sale costs are left alone. Old in-transit and quarantined stock with no FIFO history falls back to its original stored cost.
- A separate Finance and Reports menu page at `/quarterly-closing` has quarter selection, profit figures, partner percentages, a batch table and owner-only final closing.
- Partners are a new explicit setting. Names must be unique and shares total 100%. Cent allocation sums exactly, including losses. All example partners are TEST placeholders.
- Closing saves a frozen financial snapshot and partner shares. Later partner changes do not rewrite it. Closing is final, with no reopen UI.
- A database guard blocks new backdated financial entries and edits/deletions inside closed periods. Later returns from old sales are posted in the new open period and do not rewrite the original closed snapshot.
- Future quarters and quarters with pending expenses cannot close. Dates use Cairo quarter boundaries, including seasonal offset changes.

## Manual reconciliation

### Requested 900 EGP example

10 units at cost 100 and 10 at cost 110. Selling price is 150 before tax, represented as 171 at the unchanged 14% inclusive setting.

- First 10: revenue 1,500, cost 1,000, profit 500.
- Second 10: revenue 1,500, cost 1,100, profit 400.
- Total: revenue 3,000, COGS 2,100, profit 900.

### July-September closing

- Above sales: revenue 3,000, COGS 2,100.
- Additional sale of 5 units: 3 at cost 100 and 2 at cost 110. Revenue 750, exact cost 520.
- Return 4 sellable units: revenue reduction 600, cost reversal 410.
- Return 1 unsellable unit: revenue reduction 150, no stock/cost reversal.
- Net revenue: 3,000. COGS: 2,100 + 520 - 410 = 2,210.
- Approved expenses: 90. Rejected expenses: excluded.
- Net profit: 3,000 - 2,210 - 90 = 700.
- TEST partner split 60% / 40%: 420 / 280.
- A later November return of one old unit uses its original 100 cost and does not change the 700 closed profit.

## Verification

Build, type checks and lint pass. Across all 38 test files: 254 passed and one pre-existing skipped test, executed in two bounded batches. The 14 new checks include a populated legacy-database migration and repeat application, old invoice dates, changed current price/name, multiple batches and partial returns, failed overselling rollback, direct closed-period edits, close through the actual browser, late returns, permission checks, pending expenses, negative profit cent rounding, partial shipping, quarantine disposal/release, adjustments and concurrent last-piece sales. Actual desktop browser screenshots were inspected visually.

Run from the repository root:

```
npm ci
npm run db:generate
npm run build
npm run typecheck
npm run lint
BROWSER_CHANNEL=chrome npx vitest run tests/fifo-quarter.test.ts
```

The new integration suite creates disposable local PostgreSQL databases. Its historical fixture dates use controlled backdating only inside those disposable databases while the new closed-period guard remains active. It temporarily disables existing immutable-date triggers for fixture setup, then re-enables them. This is not a production editing feature.

## Before any future deployment

Deployment needs separate owner approval. Take and verify a backup, reconcile stock balances, choose an operational cutover time, and test migration on a restored copy first. FIFO starts from the opening balances and cannot recover unknown historical batch prices. Actual partner names/percentages must be entered by the owner before closing a real period.

The new batch display is capped at 200 rows and needs pagination for large history. Stock operations and closing share a database lock for correctness; load-test the throughput if multiple busy tills will run concurrently. Closing freezes the quarterly screen/snapshot; ordinary detailed reports continue to show live underlying ledgers. No reopen or historical profit redistribution was added. Existing four-decimal per-unit shipment/quarantine display summaries can have tiny rounding differences from exact cost layers; the sale COGS and close calculations use exact recorded totals.

## Local navigation revision

Quarterly closing was moved out of Reports to its own Finance and Reports menu entry. Browser checks verify menu navigation, absence from Reports, owner access, and cashier denial. The 14 FIFO tests and 12 existing POS/dashboard browser tests were rerun and passed; build, typecheck and lint passed.

## Local sales-VAT comparison revision

The separate closing page shows net sales VAT and two comparison figures: base net profit + net sales VAT, and base net profit - net sales VAT. These are arithmetic display alternatives, not income-tax calculations. Base profit is already exclusive of sales VAT. Partner shares still use base net profit. Saved invoice/return VAT is used, not a newly assumed rate or today's store setting. Existing frozen snapshots derive these display values from their saved figures without altering the snapshot.

Example: 14% inclusive sales, 171 gross = 150 net + 21 VAT per unit. Invoice VAT 525 minus return VAT 105 = quarter VAT 420. Base profit 700 gives 1,120 and 280. The 15 FIFO/closing tests, including actual browser assertions, pass. Build, typecheck and lint pass. The meaning remains for owner confirmation; nothing has been pushed or deployed.
