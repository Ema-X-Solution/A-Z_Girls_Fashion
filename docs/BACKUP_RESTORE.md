# Backups and restore

`infrastructure/scripts/backup.sh` runs `pg_dump -Fc`, checks for a nonempty dump, creates SHA-256 metadata, then copies both files to a mandatory off-VPS rclone destination. It exits on copy failure. Dumps contain customer and business data: restrict access and configure encryption/retention in the offsite provider. Rclone credentials belong in restricted host configuration, not Git.

Schedule the script with an external scheduler under a restricted deployment account. Export `BACKUP_REMOTE` from secure host configuration (the script does not source `.env` as shell code). For example a destination is `encrypted-remote:az-fashion/backups`. Log and alert on every nonzero exit. Define retention according to the business's recovery objectives. No automatic delete/retention job is provided.

## Restore rehearsal

Restore into a **new, empty database** in an isolated PostgreSQL instance; never overwrite a live database casually.

```sh
sha256sum -c backups/az-TIMESTAMP.dump.sha256
# Use a protected PostgreSQL service file / .pgpass, not passwords in arguments.
createdb --host=RESTORE_HOST --username=RESTORE_ADMIN az_restore_check
pg_restore --host=RESTORE_HOST --username=RESTORE_ADMIN --dbname=az_restore_check \
  --no-owner --no-privileges --exit-on-error backups/az-TIMESTAMP.dump
psql --host=RESTORE_HOST --username=RESTORE_ADMIN --dbname=az_restore_check
```

Run these integrity queries and expect zero rows for each mismatch check:

```sql
SELECT b."variantId", b."locationId", b.quantity, COALESCE(SUM(m.quantity),0) AS ledger
FROM "StockBalance" b LEFT JOIN "StockMovement" m
ON m."variantId"=b."variantId" AND m."locationId"=b."locationId"
GROUP BY b."variantId",b."locationId",b.quantity
HAVING b.quantity <> COALESCE(SUM(m.quantity),0);

SELECT id FROM "SaleItem" WHERE returned > quantity OR refunded > total;

SELECT s.id FROM "CashShift" s LEFT JOIN "CashMovement" m ON m."shiftId"=s.id
WHERE s."closedAt" IS NOT NULL
GROUP BY s.id
HAVING s."expectedCash" <> s."openingCash"+COALESCE(SUM(m.amount),0)
OR s.difference <> s."countedCash"-s."expectedCash";

SELECT s.id FROM "Sale" s JOIN "SaleItem" i ON i."saleId"=s.id
GROUP BY s.id HAVING s.total <> SUM(i.total);
```

Also compare source and restored document counts/totals at the same backup cutoff, inspect foreign keys/indexes/triggers, and log in with the API pointed at the isolated restore. Reapply reviewed runtime grants for that instance. Only after these checks and an approved recovery plan should production traffic switch. A restore may recover active session records; revoke all sessions as a controlled administrative recovery step before reopening the recovered environment.

An opt-in real dump/restore rehearsal is included in the integration suite. Set `PG_BIN` to a directory containing `pg_dump` and `pg_restore` matching PostgreSQL 18, then run `npm test`. Without that setting, the rehearsal is explicitly skipped. It was not run in this environment because the embedded package does not include these client tools. Production Docker-volume/offsite-provider recovery remains a deployment acceptance task. Record the date, backup identifier, duration and reconciliation results of each rehearsal.
