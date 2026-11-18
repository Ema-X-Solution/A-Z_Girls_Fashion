# Architecture and decisions

## Components

- `apps/web`: React 19, Vite, Tailwind 4 and shadcn-style Button/Radix Dialog primitives. Query caching uses TanStack Query; session and cart state use Zustand. Login validation uses React Hook Form/Zod. Operational forms use browser validation plus authoritative server Zod validation. Charts use Recharts and barcode labels use Code 128 via JsBarcode.
- `apps/api/src/app.ts`: REST transport, request validation, authentication and permission gates. `operations.ts`: transactional retail services. `db.ts`: Prisma transaction/retry helpers and audit writes. `reports.ts`: consistent-snapshot financial reporting. `money.ts`: exact decimal arithmetic and largest-remainder allocation.
- `packages/shared`: permission catalog, initial permission matrix and checkout schemas. Built before applications, consumed by workspace dependencies.
- `apps/api/prisma`: normalized transaction/balance tables and four ordered migrations. SQL constraints, partial active-shift indexes, append-only ledger triggers and additional user-reference foreign keys supplement Prisma's schema.
- `infrastructure`: isolated PostgreSQL, API, migration and grants jobs, Nginx/frontend and TLS override. Runtime application database role cannot administer schema or mutate posted ledgers.

## Transaction boundaries

Checkout, returns, receiving, adjustments, cash movements, expense recording, and shift transitions commit accounting, stock and audit together. Serializable transactions retry serialization failures/deadlocks, including PostgreSQL codes from raw locking queries. Stock rows use `FOR UPDATE`; balance constraints also prohibit negative quantities. Rows are visited in deterministic order where multiple lines are involved. Database uniqueness guards register and cashier shift exclusivity.

POST financial operations require an `Idempotency-Key`. Keys are scoped to actor and operation and bound to the validated request hash. An advisory transaction lock serializes concurrent identical submissions. The result is persisted within the business transaction, supporting recovery after a successful commit followed by network timeout. Keys are retained indefinitely in this initial implementation; no unsafe automatic expiry is configured. Browser retries preserve the key for identical requests after ambiguous failures while the page remains open. Reload after an uncertain result requires checking the sales/operation history before re-entry; durable offline checkout is not implemented.

## Money and inventory costing

All authoritative money calculations use Prisma Decimal, PostgreSQL NUMERIC and string API inputs. Prices/payments are 2 decimals and weighted average cost is 4 decimals. Invoice discounts and tax allocate cents by largest remainder. Browser POS figures are provisional cent-based display estimates, revalidated by the API.

Receiving updates the weighted average for the variant **at its stock location**. Sales retain that average as the cost snapshot. Sellable returns restore stock using the original cost snapshot and recompute its weighted average with existing stock. Damaged returns refund revenue without restoring saleable stock or reversing COGS; this leaves the damaged-item loss in gross profit. The model does not yet have a separate damaged-stock location or write-off account.

Reports use transaction dates for sales/returns and recognition dates for expenses. Net sales excludes tax. Return tax is reversed proportionally from original line snapshots. COGS reverses only sellable returns. Purchases are inventory acquisitions and do not appear as operating expenses. Summary queries use Repeatable Read. Totals are currently capped to a 366-day range; large-volume report query aggregation needs further performance work.

Each purchase receipt now creates a separate immutable SupplierInvoice in the same transaction. The fourth migration backfills invoices and exact-cent receipt line totals from existing receiving records. Account balance is opening balance + invoices − payments − purchase-return credits. The statement computes a running balance across these immutable documents and supports pagination. Payments are account-level, not allocated to individual invoices; matching external supplier tax invoices across multiple receipts remains future work.

Cash supplier payments require the processing user's open shift and post a negative drawer movement atomically. Noncash payments never affect drawer cash. Supplier returns reference eligible original receipt lines, enforce remaining received quantity and current available stock, and post stock deductions and supplier credits together. Original receipt line totals bound credits, including cent-rounding remainders. Inventory is removed at its current weighted-average cost; the difference between inventory cost removed and supplier credit is reported separately as purchase-return valuation variance and deducted from net profit. Purchases/payments are not operating expenses. Serializable transactions, supplier row locks and operation-scoped idempotency protect these operations under concurrency.

Barcode selection and supplier account screens live in dedicated frontend feature folders. Barcode batches contain at most 500 labels and use current server-validated variant data without financial cost fields. New internal barcodes are 12-digit numeric Code 128 values starting with 20, enabling compact Code Set C printing. Existing supplier/internal barcodes are preserved. Print markup is portaled directly under body, with isolated print CSS, exact thermal page dimensions or an A4 grid. Preparing/printing labels never modifies inventory. Preparing a batch creates an audit event; actual printer completion is not asserted.

## Authorization

Permission catalog and initial role matrix live in `packages/shared/src/index.ts`; actual role membership/permissions live in PostgreSQL and are read on every authenticated request. OWNER gets all permissions; MANAGER excludes users, roles, global settings, audit and profit; CASHIER gets own sales, POS, quantity visibility and own shift transitions. Cost visibility follows `reports.profit` for product, inventory and sales responses. Purchasing permissions grant purchase-document cost access. Owner roles/accounts cannot be disabled or changed via general endpoints. Non-owner user administrators cannot grant permissions or discount limits exceeding their own.

Sessions are opaque random tokens, hashed in PostgreSQL. Cookies are HTTP-only, SameSite Strict and Secure in production, with 8-hour expiry. CSRF combines exact Origin checking and a session-bound token; login checks Origin. Refresh rotates cookie and CSRF token. No authentication token is persisted in browser storage. Passwords use Argon2id, and login has IP throttling plus account lockout. Password reset is an authenticated administrator action and revokes sessions; self-service email reset is outstanding.

## Stock counts

Counts snapshot balances at a transaction cutoff. Staff enter absolute physical quantities. Approval refuses any count if stock movements have occurred at that location since cutoff. Recount after halting movement is required. This deliberately supports a controlled paused-location count; continuous-trading count reconciliation is not implemented.

## Deliberate implementation limits

Customer loyalty uses an advisory lock per customer within the existing serializable sale/refund transaction. Immutable entries record earnings, redemption, expiry and reversals; expiring lots track available points and per-sale redemption allocations support cumulative partial-return restoration. Returns never fail solely because awarded points were spent: available lots are consumed before recording debt, and future grants repay debt. The customer balance excludes expiry immediately, while expiry entries are materialized during the next mutation. Settings default to disabled and affect future activity; posted receipt point values and lot expiry remain frozen.

Stock documents lock all affected variant/location balances in a deterministic order, post both transfer legs atomically at source cost, and reuse the existing append-only stock ledger. Documents/items are immutable and duplicate submissions reuse the idempotency result. Damage is an immediate writeoff with separate period cost in profit reports. Quarantine and staged shipment/receipt transfers remain future workflows.

Campaign pricing lives in promotion-pricing.ts and is invoked by the authoritative quote/checkout service. Time/scope eligibility is read inside the transaction. Exactly one campaign is selected by highest discount and stable ID tie-break, then its discount is allocated proportionally in cents before manual line/invoice discounts. Approval limits use only the manual discount against the post-offer base; fingerprints include the complete selected campaign snapshot. Bundle return checks use the frozen eligible variant IDs on the sale, independently of the current campaign table.

Branding uses the original user-supplied bundled JPEG and optional immutable SHA-256-addressed BrandAsset rows. Public routes expose logo bytes/current URL only; settings updates require the existing settings permission and CSRF checks. Asset bytes are deduplicated using insert-on-conflict, and application grants revoke asset update/delete. Receipt snapshots reference immutable asset URLs, and print actions wait for logo decoding. The database backup therefore covers uploaded logos without an additional filesystem upload volume.

Variants use flexible string option maps (stored as JSON) rather than separate option/value entity tables. Internal barcodes are random unique Code 128 values protected by database uniqueness, with replacement history in audit. Active/suspended carts persist per user in the same browser and origin; they do not reserve stock or synchronize across devices. There is no offline sale or automatic external payment integration. Frontend POS, receipts, barcode and supplier features have dedicated modules; remaining page components are still in `App.tsx`.

Database foreign keys in the third SQL migration must be retained in future migrations even though some actor-reference scalar fields lack Prisma relation objects. Use migration diffs/review carefully; never regenerate from an empty schema against a deployed database.

## Receipt and net-exchange modules

POS, payment editor, net-exchange dialog and ReceiptView now live in frontend feature modules. Backend sale-pricing, sale-checkout, sale-returns and exchanges modules keep authoritative Decimal calculations and transaction locks. Receipt snapshots preserve merchant, seller, item and tax settings; changing current settings cannot rewrite a historical receipt. Legacy snapshots are reconstructed during migration, with original amounts retained and unknown historic tax rates explicitly flagged.

VAT supports included and additional modes. Refund tax is recorded per return item using cumulative rounded allocation, avoiding split-return cent drift. Net exchanges apply server-only internal credit and post only the external collection/refund to the drawer. Migration immutability triggers protect financial documents while allowing bounded return counters and sale status transitions.
