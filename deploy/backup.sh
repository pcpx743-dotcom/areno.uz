#!/bin/sh
# Daily PostgreSQL backup (PRD §12). Runs inside the `backup` container.
# Writes /backups/sport_erp-YYYYMMDD-HHMM.dump (custom format) and keeps BACKUP_KEEP_DAYS days.
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"

backup() {
  f="/backups/sport_erp-$(date +%Y%m%d-%H%M).dump"
  if pg_dump -Fc -f "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "$(date -Iseconds) backup ok: $f ($(du -h "$f" | cut -f1))"
  else
    rm -f "$f.tmp"
    echo "$(date -Iseconds) BACKUP FAILED" >&2
  fi
  find /backups -name 'sport_erp-*.dump' -mtime +"$KEEP" -delete
}

backup # once at start
while true; do
  # next run at ~02:30 server time
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) 02:30" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup
done
