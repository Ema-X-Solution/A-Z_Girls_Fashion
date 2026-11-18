# Ubuntu VPS deployment

The configurations are prepared but have not been executed with Docker in the development environment. Complete the production acceptance checks before handling real money.

## Host preparation

1. Install current Docker Engine and Compose plugin 2.24.4+ (`!override` syntax is used by the production ports override).
2. Configure DNS for the store domain, firewall with only SSH (restricted to administrative IPs), TCP 80 and TCP 443 allowed. PostgreSQL 5432 and API 3001 must remain unpublished.
3. Obtain a TLS certificate using your organization's ACME client. Place `fullchain.pem` and `privkey.pem` in a restricted directory, e.g. `/etc/az-fashion/tls`. Configure renewal to reload Nginx after updating certificate files. The Compose stack does not issue certificates automatically.
4. Clone the repository, create `.env` with mode 600, and set independently generated high-entropy `POSTGRES_PASSWORD` and `APP_DB_PASSWORD`. Hexadecimal secrets avoid URL escaping issues. Set `APP_ORIGIN=https://your-real-domain`, `NODE_ENV=production`, and `TLS_DIRECTORY=/etc/az-fashion/tls`.

## Build and initialize

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose up -d postgres
docker compose run --rm migrate
docker compose run --rm grants
# Temporarily set INITIAL_OWNER_EMAIL and INITIAL_OWNER_PASSWORD in protected .env.
docker compose --profile setup run --rm initialize
# Immediately remove initialization credentials from .env.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api web
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The default Compose file is HTTP for development at `http://localhost:8080`, with NODE_ENV development so local cookies are usable. Always use the production override for HTTPS and Secure cookies. The production override replaces 8080 with 80/443. The API waits for migrations and grants. Database and API have health checks, service restart policies and bounded JSON logs. The frontend is served by Nginx. PostgreSQL data is stored in a named volume. Do not run `docker compose down -v` on an established store.

The database initialization script creates `az_app`. Migration jobs use a separate administrator login. `grants.sql` gives the runtime application CRUD, sequence access and schema usage, removes migration metadata access, and removes ledger update/delete privileges. Review minimum table grants further before deployment to environments with tighter compliance requirements. Protect the host and Compose access: database administrator credentials are available to deployment operators.

## Updates

Take and verify an offsite backup first. Review migration SQL and compatibility with the running release. Run `bash infrastructure/scripts/deploy.sh`. Use an agreed maintenance window for schema changes and cashier shift activity. A source rollback alone is not a database rollback; restore a backup into a separate instance and plan reconciliation if rollback is required.

## Acceptance gate

- Run all tests and build in CI with a supported browser and UTF-8 PostgreSQL.
- Start the actual Docker stack; verify least-privilege startup, migrations and all health checks.
- Verify HTTPS, Secure/HTTP-only cookies, no database/API public ports, rate limiting and origin checks.
- Run staff, receiving, sale, return, exchange and reconciliation acceptance scenarios.
- Check Arabic glyphs, receipt widths, margins and barcode readability on the real thermal printer and scanner.
- Verify backups by restoring to an isolated database and reconciling ledger balances.
- Configure monitoring, disk alerts, backup failure alerts and security patch ownership.
- Finish the missing business modules listed in IMPLEMENTATION_PROGRESS.md before representing the complete specification as delivered.
