# REST API contracts

[OpenAPI 3.0 document](openapi.json) describes the implemented paths, request bodies, parameters, permission metadata and response envelopes. Regenerate it with `node scripts/generate-openapi.mjs` after changing routes; review the generated permission metadata because multiple middleware gates can mean AND rather than OR. Import this file into Swagger Editor or a compatible API client. The source is the implementation of record; routes from the master brief that are absent here remain unimplemented.

All API paths start `/api`. Successful JSON operations return `{ "data": ... }`, and products/sales lists also return `total`. Collection pagination uses `limit` (1–100, default 30) and `offset` (default 0); collection ordering is deterministic where configured. Products and customers support `q`, and sales support numeric-string `number`. Decimal monetary fields and autoincrementing invoice numbers are serialized as strings. Identifiers are UUIDs; barcode strings are case-sensitive.

## Authentication

`POST /auth/login` requires `{email,password}` and an Origin matching `APP_ORIGIN`. It sets an opaque HTTP-only cookie. `GET /auth/me` returns identity, current roles/permissions, discount limit and session CSRF token. Every subsequent mutating request needs both matching `Origin` and `X-CSRF-Token`. `POST /auth/refresh` rotates the session/CSRF token; `POST /auth/logout` invalidates it. Sessions expire after 8 hours. No cross-origin credentialed API access is enabled.

All endpoints except health/login require a valid session. Each module route enforces permissions; read-only `/auth/me` and `/store` are available to any authenticated staff member. Role editing additionally requires the OWNER role; protected owner roles cannot be changed. `GET /sales/:id` limits own-sales users to their own documents. Financial fields are removed from product, inventory and sales responses without the profit permission; purchase documents require explicit purchase permissions and expose their acquisition costs.

## Financial idempotency

Checkout, refunds/exchanges, purchase receiving, adjustments, supplier payments, expenses, cash movements and shift opening/closure require an `Idempotency-Key` of 16–100 word/hyphen characters. Reuse the same key with the same request after timeout. Different validated payload with the same key returns `IDEMPOTENCY_CONFLICT`. Save the key until the result is known. Never generate a new key simply because the network timed out.

Checkout example (with UUIDs substituted):

```json
{
  "shiftId": "register-shift-uuid",
  "items": [{ "variantId": "variant-uuid", "quantity": 2 }],
  "discount": "10.00",
  "payments": [{ "method": "CASH", "amount": "250.00" }],
  "notes": ""
}
```

The backend resolves current active variants, checks the cashier's own active shift, calculates authoritative prices/tax/discounts, validates tender and change, then posts all records atomically. Input unit prices/totals are not accepted as authority. Payments can be CASH, CARD, WALLET or BANK. A mixed tender is multiple entries. Overpayment can only come from cash, and change reduces the cash drawer increase. Card/wallet entries record externally completed payment; there is no gateway charge.

Returns require a sale UUID and original sale-item UUIDs, an open processing-user shift, reason, method and positive eligible quantities. The return window defaults to 14 days. Only sellable items restore stock. Refunds use original line paid amounts, tax and discounts. `reasonType` is CHANGE_MIND or MANUFACTURING_DEFECT; products snapshotted as DEFECT_ONLY reject change-of-mind returns. Partial return tax uses cumulative allocation so split refunds reconcile exactly to original tax.

`POST /api/sales/:id/exchanges/quote` and `/exchanges/net` take `{ returned, replacement }`. Replacement payments contain only the external positive difference; same/lower-value exchanges use an empty array and the return method for the negative difference. Internal EXCHANGE_CREDIT is server-generated, never an accepted external method. Net posting is atomic and idempotent, requires both `sales.create` and `sales.refund`, and is available in the Sales UI. `GET /api/exchanges/:id` recovers the exchange receipt. The older `/exchanges` endpoint remains compatible with full refund/replacement tender.

Checkout supports FIXED/PERCENT `discountType` at item and invoice level; combined discounts remain bounded by the actor limit. `POST /api/sales/quote` gives authoritative prices without posting stock. CARD payments optionally record `cardBrand`, `authorizationCode` and `cardLast4`; these describe externally completed payment. Store settings support INCLUSIVE/EXCLUSIVE tax mode, branch/tax/registration data, prefix and policy. New receipts freeze those fields, cashier/seller, tax and item information. Historical snapshots are migration-time reconstructions and preserve historical monetary totals.

## Operational policies

### Campaigns and branding

`GET/POST /api/promotions` and `PATCH /api/promotions/:id` require promotions.manage (OWNER/MANAGER default permission). Create/update takes name, PERCENT or BUY_X_GET_Y, productIds (empty means all products), startsAt/endsAt UTC ISO timestamps, active, percent, buyQuantity and getQuantity. Activation must be within the actor's discount limit; bundle authority uses get/(buy+get) as its maximum discount fraction. Deactivation remains allowed without that numeric limit. The list is capped at the latest 100 campaigns.

Quotes and checkout choose the active campaign with the highest monetary discount; ties use campaign ID. Offers do not stack. Buy-X-get-Y gives the lowest-priced eligible units free for each complete group, computed from line quantities without expanding units. The discount is allocated proportionally across eligible lines with exact cent reconciliation. Item discounts apply after automatic allocation, then the invoice discount. Cashier/manual approval limits apply to manual discount as a fraction of the amount remaining after the offer. Approval fingerprints include the selected campaign snapshot.

New receipt snapshots freeze campaign ID/name/amount/eligibility and return rule. For buy-X-get-Y, returning any participating line requires all remaining campaign quantities together, including net exchanges. Percentage offers allow partial refunds of original paid amounts. Changing/deactivating a campaign never recalculates an old sale/refund. POS and printed receipts disclose the bundle restriction; actual physical printer checks remain pending.

`GET /api/branding` exposes only the current logo URL and `GET /api/brand-assets/:id` returns immutable public raster bytes addressed by SHA-256. `POST /api/settings/logo` requires settings.manage and CSRF, accepting base64 PNG/JPEG/WebP up to 140000 decoded bytes (no SVG). The settings UI validates the local file and scales it to 512 px before upload. Assets are deduplicated in PostgreSQL and included in ordinary database backup. New receipts freeze the content-addressed URL, so later logo uploads cannot replace an old receipt's image. The original user-supplied A&Z image is bundled as /brand/az-logo.jpg and remains the fallback for initial/legacy branding.

### Exceptional discount approvals

`POST /api/discount-approvals` accepts `{ sale: checkout, reason }`, requires sales.create, an owned open shift, a discount exceeding the requester's current limit, CSRF and Idempotency-Key. The immutable request snapshot excludes actual tender and includes display-only SKU/name/options/current price. Requests expire 15 minutes after creation. Each requester can have at most 20 active pending requests.

`GET /api/discount-approvals` returns the latest 100 requests: own requests for cashiers, all requests for reviewers. `GET /api/discount-approvals/:id` enforces the same ownership/reviewer boundary. `POST /api/discount-approvals/:id/decision` requires sales.discount_approve and accepts APPROVED/REJECTED plus a note. The reviewer cannot decide their own request; an approval must be within the reviewer's current discount limit. OWNER and MANAGER receive the new permission through migration 7; numeric discount limits remain unchanged.

Checkout and quotes accept optional discountApprovalId. Above-limit discounts require an approved, unexpired, unused request matching requester, shift, customer, notes, line quantities/discounts/prices, invoice discount, tax mode/rate and totals. Current reviewer activation, permission and discount limit are rechecked. Payment composition can change without changing discount authority. Consumption and sale/stock/cash posting commit together; failed checkout leaves approval reusable. Concurrent different checkout keys can consume the approval only once; retrying the winning key still recovers the original sale. DISCOUNT_APPROVAL_USED audit records link approval/reviewer to sale. The POS clears its approval link when discount-relevant draft fields change and polls review status; completed checkout remains protected by the durable journal.

### Checkout recovery

`GET /api/checkout-attempts/:key` requires sales.create and returns UNKNOWN, CANCELLED, or COMPLETED with saleId. Keys are scoped to the authenticated actor and checkout operation. UNKNOWN does not authorize discarding an uncertain attempt: it may still be in transit. Retry the exact persisted body and Idempotency-Key, or use `POST /api/checkout-attempts/:key/cancel` (CSRF protected). Cancellation acquires the same transaction lock as checkout and either returns the committed sale ID or writes a logical tombstone. A delayed checkout after that tombstone fails CHECKOUT_CANCELLED. The existing idempotency journal stores the tombstone and audit event; no migration is required.

The browser stores a versioned workspace per user/origin: active cart, up to 50 suspended carts, exact pending request/key, and unacknowledged receipt ID. Storage and Web Locks must work before checkout is enabled. Network errors preserve the journal and freeze editing. Reload recovery checks status without resubmitting; the operator can retry the same request. Successful checkout replaces the draft/pending journal with a receipt ID before enabling a fresh cart. Drafts include mixed tender metadata and discounts; session tokens and variant costs are excluded. Prices and stock remain server-authoritative; quotes return current unit prices for display. Persistence is limited to the same device/browser/origin, does not survive clearing browser data, and does not reserve stock.

- Purchase orders start DRAFT, require approval, then allow partial receiving up to ordered quantity. Each receipt posts a separate immutable supplier invoice atomically. Existing receipts are backfilled by migration 4.
- Stock adjustments take signed integer deltas and a reason. Positive adjustments can supply `cost`; otherwise the existing location average remains. There is no negative-stock override.
- Physical counts capture a cutoff; approval rejects any movement at that location after cutoff. Count entry is absolute, nonnegative quantity.
- Cash expense requires the creating user's open `shiftId`. Bank/wallet/card expenses do not affect drawer cash. Supplier payments accept CASH (own open shift required), BANK, CARD or WALLET; noncash requests must not include a shift. Overpayment beyond the supplier's current account balance is rejected.
- Closed shifts retain expected, counted and difference values. Later checkout/refunds cannot use a closed shift.
- Product archive preserves transaction references. Historical price/cost snapshots remain in sale items.
- Report range is at most 366 days; Excel export is at most 10,000 invoices. Dates are ISO timestamps, and daily chart buckets use Africa/Cairo. Print-to-PDF is available through browser printing; an Arabic server PDF export is outstanding.

## Customer history and editing

New POS sales require a selected customer phone even for cash payments. The cashier searches by phone/name with server pagination (10 rows in the picker), selects an existing record or immediately adds a new phone with an optional name. Phone input and results align to the right with isolated LTR digits so country codes and grouped numbers stay in the correct order. Search/name drafts and the chosen customer survive suspended carts and reloads. Each new POS checkout sends `requireCustomer: true`; the server rejects that request without a customer ID. Old integration requests and exact pre-upgrade checkout journals without the flag retain their previous contract.

`GET /api/customers?q=...&offset=0&limit=10` returns `{data,total}`. It searches the entire database rather than only the first page. Phone search recognizes Arabic/Persian digits, domestic Egyptian zero prefixes, +20 and 0020 representations, formatting spaces and separators; any numeric substring is supported, including a middle fragment beginning with zero. Spaces are never required. Canonical identity checks use migration 12's expression index; substring search examines the canonical phone value. Existing phone display values and financial links are not rewritten or merged. POS users without customer-management permission receive only ID, name and phone; managers retain full contact data.

`POST /api/customers/resolve` requires both POS access and sales creation plus CSRF. Accepts only `{phone,name?}` and returns a minimal customer with `created: true`/201 for new phones or `created: false`/200 for an existing equivalent phone. It serializes by canonical phone key and reuses an existing customer on concurrent/repeated submissions without overwriting names. A blank/missing name is stored as an empty string and displayed as “بدون اسم”. Normal customer creation also accepts an optional name, but requires customer-management permission and rejects equivalent duplicate phone numbers. Canonical comparison is shared by create, edit, search and POS resolution. Existing canonical duplicates are preserved and the resolver chooses the oldest record deterministically.

`GET /api/customers/:id` requires customer management or POS access and returns minimal ID/name/phone for restoring the selected customer's display after reload.

`PATCH /api/customers/:id` requires `customers.manage` and CSRF protection. Send name, phone, nullable email, address and notes; phone remains unique. Successful edits append a `CUSTOMER_UPDATE` audit entry.

`GET /api/customers/:id/history?offset=0&limit=30` requires both `customers.manage` and a sales visibility permission. It returns the customer, `scope` (`ALL` or `OWN`), lifetime purchase count/purchases/returns/net spending, paginated purchases with immutable item descriptions and quantities, and paginated returns with their original receipt reference. Both lists use the same offset and limit and provide separate total counts. Summary and rows share one repeatable-read snapshot. Users without `sales.view_all` see only sales they created, including returns against those sales; costs and payment authorization details are excluded. Net spending subtracts the total returned merchandise value, including exchange credit, rather than cash refunds alone. The separate loyalty endpoints below provide the customer points account and ledger.

## Search debounce

All implemented free-text search inputs share a trailing 300 ms debounce: POS products/customer lookup, product list, sales receipt search, customer list, suppliers, barcode catalog, exchange replacements, promotion products and stock-document products. Inputs update immediately; requests wait until typing stops. Pending search results are hidden or disabled to prevent choosing stale matches, and pagination resets for a changed query. Barcode scan submission, explicit filters, payment calculations and checkout remain immediate.

## Loyalty

`GET /api/loyalty/settings` is available to POS/customer/settings users; `PATCH` requires settings management and CSRF. Fields: enabled (default false), spendPerPoint (default 100 EGP, at least 1), pointValue (default 1 EGP, positive, at most 100), expiryDays (1–3650, default 365), maxRedeemPercent (1–90, default 20), minimumRedeemPoints (1–1,000,000, default 1). Changes apply to future activity; lot expiry dates and printed sale points remain frozen. No historical awards are backfilled.

Checkout/quote accept optional integer `loyaltyPoints` (0–1,000,000). A customer is required for redemption. Points are a policy-controlled discount after promotions/manual discounts and before tax, included in invoice/item discount totals; they do not bypass the separate manual-discount authority check. Redemption must fit the configured percentage of the remaining merchandise amount and leave a positive amount when points are used. Earning uses floor(final net-before-tax / spendPerPoint), capped at 1,000,000 points per sale. Whole points are consumed from the earliest unexpired lots. Actual checkout revalidates under a customer lock and posts points, stock, cash and the sale atomically. The existing actor-scoped idempotency key covers all movements, including rollback on stock/tender failure. Existing pending journals without the new optional field remain compatible.

`GET /api/customers/:id/loyalty?offset=0` returns available points and return-related debt. Customer managers also receive 30 immutable entries per page and the total count; POS-only users receive no detailed ledger. Available balance excludes expired lots immediately; an EXPIRE ledger entry is materialized on the next account mutation. Returns reverse earned points cumulatively by returned paid value (and all remaining points on full return). If points were already spent, other available points are consumed before recording a nonnegative debt. Future awards/restorations settle debt before creating spendable balance; returns are not blocked. Redemption is blocked while debt is outstanding. Returned redeemed points retain the original source-lot expiry and are not reissued after that expiry. Disabling earning/redemption does not disable reversals of earlier sales. Return and net-exchange handlers share these transactional rules.

## Stock documents

`GET /api/inventory/documents?offset=0&type=TRANSFER` requires inventory view, returns 30 immutable documents and a total, and optionally filters TRANSFER, DAMAGE or ADJUSTMENT. Cost fields require profit-report permission. `POST` requires inventory adjustment permission, CSRF and an idempotency key. Supply type, sourceId, optional destinationId (only TRANSFER), reason and up to 200 distinct items `{variantId, quantity, cost?}`. Quantities are positive for transfers/damage; adjustment deltas are signed, nonzero, bounded to 100,000 in magnitude. A cost override is accepted only for positive adjustments. Transfers require distinct existing source/destination locations, post paired movements at source weighted-average cost, and recompute destination weighted average. Damage documents are final writeoffs/disposals, not quarantined or in-transit stock; damage cost is shown separately and deducted in profit reports. All rows post atomically, lock balances in deterministic order, reject insufficient stock and roll back the entire document on failure.

The existing `/api/inventory/adjustments` endpoint now creates a formal adjustment document and still returns `{reference}` for compatibility. Stock counts retain their own controlled count documents. Posted documents/items and the points ledger reject UPDATE/DELETE at database level and in production grants. Existing pre-upgrade movements are retained without inventing documents.

`POST /api/inventory/locations` requires inventory adjustment permission, accepts `{name,branchId}` for an existing branch, and audits creation. The inventory UI provides creation, filtering, details and direct posting of documents; multi-step shipment/receipt transfers and damaged-goods quarantine are separate future workflows.

## Operations completion (19 November 2026)

The following endpoints are implemented and require authenticated sessions and CSRF for writes. Existing financial documents remain unchanged by migration 14. Lists use 30-row pages; report exports are limited to 10,000 matching rows.

### Expenses

- `GET/POST /api/expense-categories`, `PATCH /api/expense-categories/:id {active}`. Creating/deactivating categories requires `expenses.approve`; names are retained on earlier expenses. Existing category names are migrated, and inactive categories cannot be used for new expenses.
- `POST /api/expenses` accepts the existing category/amount/method/description/shiftId fields plus optional `submitForApproval`. True creates PENDING without cash/profit effects. Without `expenses.approve`, requests are always PENDING. Authorized direct posting remains supported for compatibility; direct cash requires the caller's open shift. Pending cash requests select the actual paying reviewer's shift at approval, not at submission.
- `POST /api/expenses/:id/decision {approve,note,shiftId?}` requires `expenses.approve`, an idempotency key, a different reviewer and PENDING state. Approval posts cash exactly once to the reviewer's own open shift and recognizes expense on the approval date. Rejection never posts cash or operating cost. Approved/rejected expenses are immutable.
- `GET/POST /api/expenses/:id/attachments`, `GET /api/expense-attachments/:id`. Upload `{name,dataUrl}` using PDF/JPEG/PNG/WebP; raw limit 750,000 bytes, five attachments per expense. Downloads require expense visibility or ownership and are attachments with no-store/nosniff. Upload requires expense creation plus ownership or approval authority. No public file URL is exposed.

### Administration

- `GET/POST /api/administration/branches`: create `{name,locationName}`; PATCH `/:id {name,active}`. Requires `settings.manage`. Deactivation is blocked while the branch has open shifts.
- `POST /api/administration/registers {name,branchId,locationId}`, PATCH `/:id {name,locationId,active}`. A register's location must belong to its branch. Editing is blocked during open shifts; inactive registers/branches cannot open a new shift. Existing branches/registers are active by default.
- `GET /api/administration/sessions?offset=0` requires `users.manage`; returns session resource IDs, user names/emails and creation/expiry/current flags, never cookies or CSRF values. POST `/sessions/:id/revoke` or `/users/:id/revoke-sessions` ends one/all sessions and records audit events. A session resource ID is a 64-character hash, not a bearer token.
- `PATCH /api/administration/users/:id/role {roleId}` requires both role and user management. Own/protected owner assignments are blocked; nonowners cannot grant permissions they do not hold. Changing a user's role ends that user's sessions.

### Detailed reports

`GET /api/reports/detail/:kind?from=<ISO>&to=<ISO>&q=&offset=0&format=json|xlsx|pdf` supports daily, monthly, category, product, variant, cashier, payments, returns, discounts, purchases, suppliers, inventory, low-stock, movements, expenses, gross-profit, net-profit and shifts. Date ranges must be ordered and at most 366 elapsed days. UI calendar dates are resolved as Cairo day boundaries, including daylight-saving changes; stored UTC timestamps are converted to Cairo for day/month buckets.

Sales groups combine sales with return events in the selected period and use immutable sale/return prices, tax and costs. Payment groups show external sale receipts after cash change; return/refund flows are separate. Expense profit includes only APPROVED rows. Inventory and supplier balances are current snapshots, explicitly labeled; inventory valuation includes available, in-transit and quarantined assets as separate rows. Legacy sale lines without category snapshots are labeled unclassified; new lines freeze the category label. Purchase reports select receipt-backed invoices in the period and explicitly label all-time credits against each invoice.

Profit/purchase/supplier financial reports require profit authority (plus their underlying module permissions). Inventory costs/profit columns are omitted without that authority. Own-sales and own-shift restrictions apply to both JSON and exports. Aggregation, search, count and pagination run in one repeatable-read transaction. Excel preserves monetary numeric cells and RTL columns. PDFs embed the redistributable Amiri font and process bidirectional runs while retaining number order. Browser printing prints the displayed page; full-result exports use XLSX/PDF.

### Advanced inventory

- `GET/POST /api/inventory/shipments`: create `{sourceId,destinationId,reason,items:[{variantId,quantity}]}` under inventory adjustment authority. Sending deducts source quantities once at original weighted-average cost; goods remain valued in transit.
- `POST /api/inventory/shipments/:id/receive {items:[{itemId,quantity}]}` under receiving/adjustment authority. Positive partial receipts may not exceed outstanding quantities; retries with the same key do not duplicate receipt. Destination weighted-average cost updates using the frozen shipment cost. State is SHIPPED/PARTIAL/RECEIVED. Sending and receiving are separate real movements; no silent cancellation of shipped stock is supported. To return goods, receive and document the reverse shipment.
- `GET/POST /api/inventory/holds`: create `{locationId,variantId,quantity,reason}` to remove sellable stock into quarantine without recognizing a loss. Resolve with `POST /holds/:id/resolve {action:RELEASE|DISPOSE,quantity,reason}`. Release returns original cost to available stock; disposal creates one immutable DAMAGE document and recognizes its cost once. Holds are for stock already on hand; nonsellable customer returns retain their existing cost treatment and are not automatically booked as new quarantine assets.
- Stock-count creation supports `mode:CUTOFF|CONTINUOUS` (default CUTOFF). Continuous counts require no overlapping open count in the location. Save each actual line immediately when measured: the server locks the balance and stores its measurement baseline/recorded time. Approval applies actual-minus-measurement-baseline against the current balance, preserving all movements after measurement without relying on timestamp ordering. POST `/api/inventory/stock-counts/:id/cancel` closes an unused OPEN session without changing stock. CUTOFF retains its existing movement rejection. Negative available stock remains prohibited; this update does not enable a negative-stock override.

### Customer discounts

`PATCH /api/customers/:id/discount {percent}` requires settings management and accepts 0–100. It is an automatic policy discount after campaign/item discounts and before manual invoice discount/loyalty. It does not expand the cashier's manual discount limit. New receipt snapshots freeze its amount; earlier receipts/return values remain unchanged.

Shared carts have been retired. Their API routes return 404 and new checkout requests reject the retired binding field. Historical tables and rows remain unchanged; reservations no longer reduce sellable stock. A normal sale can take the final piece, leaving zero, but never a negative balance. Exact pre-upgrade pending checkout bodies remain readable for result checks and safe cancellation.

## Errors

The POS validates the checkout fields and refreshes the server quote before saving a new pending attempt. Invalid input remains editable. Unknown sale outcomes retain the original request body and idempotency key for result checks, exact retries or confirmed cancellation. Entry forms show invalid fields in the form, and shift-opening server errors stay in the open dialog. Report exports above 10,000 rows are blocked with a visible notice rather than downloading a partial file.

Errors use `{ "error": { "code": "...", "message": "...", "fields": {} } }` (fields only for validation). HTTP 400: malformed request/invalid monetary or date values. 401: missing/expired session. 403: permission or CSRF denial. 404: unknown record/endpoint. 409: uniqueness, stock, shift, return-policy or concurrent business conflict. 429: rate limited (rate-limit middleware may return text). 500: unexpected internal error; details appear only in server logs.

Business codes include `INSUFFICIENT_STOCK`, `SHIFT_CLOSED`, `SHIFT_EXISTS`, `SHIFT_OWNER`, `DISCOUNT_LIMIT`, `PAYMENT_INSUFFICIENT`, `INVALID_CHANGE`, `RETURN_QUANTITY`, `RETURN_PERIOD`, `PURCHASE_STATUS`, `RECEIVE_QUANTITY`, `COUNT_MOVED`, `OWNER_PROTECTED`, `PRIVILEGE_ESCALATION` and `IDEMPOTENCY_CONFLICT`. Prisma uniqueness/not-found conflicts may use P2002/P2025. Refresh the source record before retrying a genuine business conflict.
