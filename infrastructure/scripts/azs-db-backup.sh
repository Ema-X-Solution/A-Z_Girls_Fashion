#!/usr/bin/env bash
set -euo pipefail

readonly BACKUP_DIR="/var/backups/azs"
readonly BUCKET="r2:azs-backup-server"
readonly DATE="$(date -u +%Y-%m-%d)"
readonly FILE="${BACKUP_DIR}/az_fashion_${DATE}.dump"
readonly LOG_TAG="azs-db-backup"

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

set -a
source /etc/az-fashion/app.env
set +a

DATABASE_URL_BASE="${DATABASE_URL%%\?*}"
rm -f "$FILE"
pg_dump --format=custom --file="$FILE" "$DATABASE_URL_BASE"
test -s "$FILE"

# Retention cleanup happens only after the upload succeeds.
rclone copy "$FILE" "$BUCKET" --no-traverse
find "$BACKUP_DIR" -type f -name 'az_fashion_*.dump' -mtime +14 -delete
rclone delete "$BUCKET" --min-age 30d --include 'az_fashion_*.dump'

printf '%s backup succeeded: %s\n' "$(date -u --iso-8601=seconds)" "$FILE" >> /var/log/azs-backup.log
