# A&Z Girls Fashion

Arabic-first retail management monorepo: React/TypeScript/Vite, Express, PostgreSQL and Prisma. Black/gold RTL workspace, session authentication, database RBAC, stock ledger and transactional POS.

**Status: working core implementation, not yet production accepted.** See [implementation progress](docs/IMPLEMENTATION_PROGRESS.md) for implemented scope, verification and missing requirements. No production or sample passwords are included. No mock data powers application screens.

## Local setup

Requirements: Node.js 22.12+, npm, PostgreSQL 17+ with a UTF-8 database. Windows users may need `npm.cmd` instead of `npm` under restricted PowerShell execution policies.

```sh
npm ci
cp .env.example .env
# Edit DATABASE_URL, APP_ORIGIN and initialization credentials in .env.
npm run db:generate
```

Prisma commands read the root `.env`. Create the database first, then:

```sh
npm run db:migrate
npm run build -w @az/shared
npm run db:init
# Remove INITIAL_OWNER_PASSWORD and INITIAL_OWNER_EMAIL from .env.
npm run dev
```

Open `http://localhost:5173`. The API runs on port 3001 behind Vite's `/api` proxy. Use this exact origin in `APP_ORIGIN`; cookie mutations deliberately reject other origins. Initialization is advisory-locked and refuses to run when any user exists.

The initialization creates OWNER, MANAGER and CASHIER roles, a branch, stock location, register, four categories and store defaults. Create staff, products, suppliers and purchase orders in the interface. Approve and receive an order before selling its stock. Cashiers must open a shift before checkout. Recording card/wallet payment confirms an external payment; it does not charge a card.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` builds the applications, starts an isolated real PostgreSQL instance on an available loopback port, applies migrations and initializes a random-credential owner. Integration tests run Supertest against the actual API. The production-build browser workflow uses installed Microsoft Edge by default (`BROWSER_CHANNEL=chromium` uses Playwright Chromium after installation). API and browser preview use available loopback ports. The suite does not connect to the database in your `.env`. Test clusters are retained under ignored `.test-data/` for diagnosis; they contain test data only and stop after the suite. Screenshots are written under ignored `test-results/`. The dump/restore test runs only when `PG_BIN` points to a directory with `pg_dump` and `pg_restore` compatible with the isolated PostgreSQL 18 server; otherwise it is explicitly skipped.

## Deployment

Use the [Ubuntu deployment guide](docs/DEPLOYMENT.md), [backup/restore guide](docs/BACKUP_RESTORE.md), [architecture](docs/ARCHITECTURE.md) and [API contracts](docs/API.md). PostgreSQL and API ports are not published by Compose. Hosted Sites deployment is not configured: this project follows the requested Express/PostgreSQL/VPS architecture.

The supplied A&Z logo is bundled, with a transparent derivative for invoice printing and optional uploaded store branding. Browser printing needs manual validation on the store's actual thermal printer and label stock.

Customer history includes purchase/return totals and a loyalty ledger. Configure the initially disabled points program in store settings, then select a customer and redemption points in POS. The inventory document tab posts direct warehouse transfers, formal adjustments and damaged-stock writeoffs; writeoff cost appears separately in profit reports. See API.md and IMPLEMENTATION_PROGRESS.md for implemented rules and remaining scope.

Barcode label printing and supplier accounts are described in [BARCODES_AND_SUPPLIERS.md](docs/BARCODES_AND_SUPPLIERS.md). Use `/products/barcodes` for individual/bulk labels and `/suppliers` for running balances, receipt-backed invoices, cash/noncash payments and purchase-return credits.

## Self-contained local launch

After `npm run build`, run `node scripts/run-local.mjs`. This starts a persistent development database under ignored `.local/`, initializes the owner once, and writes local access details to `.local/access.txt`. The chosen web port is reused on subsequent launches. This launcher explicitly enables `localhost` and `127.0.0.1` as equivalent origins on that same port in development only. Production continues to require the exact configured origin; all authenticated mutations still require the session CSRF token.
