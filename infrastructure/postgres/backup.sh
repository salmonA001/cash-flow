#!/usr/bin/env bash
# Usage: infrastructure/postgres/backup.sh [backup-dir]
# Creates a compressed, timestamped custom-format dump and keeps the newest 14.
set -euo pipefail
cd "$(dirname "$0")/../.."
DIR="${1:-backups/postgres}"
mkdir -p "$DIR"
FILE="$DIR/cfe-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$FILE"
test -s "$FILE"
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t "$DIR"/cfe-*.dump | tail -n +15 | xargs -r rm --
