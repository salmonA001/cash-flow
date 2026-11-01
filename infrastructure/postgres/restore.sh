#!/usr/bin/env bash
# Usage: infrastructure/postgres/restore.sh backups/postgres/cfe-YYYYMMDDTHHMMSSZ.dump
# Stops app services, restores into the database (dropping existing objects), restarts.
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${1:?Usage: restore.sh <dump-file>}"
test -s "$FILE" || { echo "Backup file not found or empty: $FILE" >&2; exit 1; }
read -r -p "This REPLACES all data in the database with $FILE. Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
docker compose stop api worker web
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$FILE"
docker compose up -d api worker web
echo "Restore complete."
