#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
: "${BACKUP_REMOTE:?Set an rclone remote path outside this VPS}"
mkdir -p backups
backup_file="backups/az-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_dump -U az_admin -d az_fashion -Fc > "$backup_file"
test -s "$backup_file"
sha256sum "$backup_file" > "$backup_file.sha256"
rclone copy "$backup_file" "$BACKUP_REMOTE"
rclone copy "$backup_file.sha256" "$BACKUP_REMOTE"
printf 'Backup created and copied offsite: %s\n' "$backup_file"
