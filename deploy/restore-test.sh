#!/bin/sh
# Restore test (PRD §12): restores the newest backup into a throwaway database and
# compares row counts of key tables with the live database. Run on the server:
#   docker compose --env-file .env.production exec backup sh /restore-test.sh
# (mount it like backup.sh, or copy it into the container first)
set -eu
LATEST=$(ls -1t /backups/sport_erp-*.dump | head -1)
[ -n "$LATEST" ] || { echo "no backups found"; exit 1; }
TEST_DB=restore_test_$(date +%s)
echo "Restoring $LATEST into $TEST_DB …"
createdb "$TEST_DB"
trap 'dropdb --if-exists "$TEST_DB"' EXIT
pg_restore --no-owner -d "$TEST_DB" "$LATEST"

fail=0
for t in clubs athletes subscriptions charges payments attendance audit_logs; do
  live=$(psql -tAc "select count(*) from $t")
  restored=$(psql -d "$TEST_DB" -tAc "select count(*) from $t")
  echo "$t: live=$live restored=$restored"
  # restored may be lower only by rows written after the backup
  [ "$restored" -le "$live" ] && [ "$restored" -gt 0 -o "$live" -eq 0 ] || fail=1
done
[ "$fail" -eq 0 ] && echo "RESTORE TEST OK" || { echo "RESTORE TEST FAILED"; exit 1; }
