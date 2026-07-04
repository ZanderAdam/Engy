#!/usr/bin/env bash
# Seed the dev DB with permanent + fleeting memory rows copied from prod, so the
# Memory tab has realistic content for screenshots. Rows reference on-disk files
# under docs/memory/** that already exist. DB-only: no files written, no commits,
# the dev server is NEVER run against prod.
#
# Usage (run from the repo root, or anywhere — paths are resolved from REPO):
#   seed-dev-memories.sh [workspace_id]      # default workspace_id=1 (engy)
#
# Safe to re-run only on a fresh dev DB (it inserts; it does not upsert). If the
# dev DB already has rows for the workspace, clear them first or skip.
set -euo pipefail

REPO="${ENGY_REPO:-/Users/aleks/dev/engy}"
PROD_DB="${PROD_DB:-$HOME/.engy/engy.db}"
DEV_DB="${DEV_DB:-$REPO/web/.dev-engy/engy.db}"
WS_ID="${1:-1}"

[ -f "$PROD_DB" ] || { echo "prod DB not found: $PROD_DB" >&2; exit 1; }
[ -f "$DEV_DB" ]  || { echo "dev DB not found: $DEV_DB (start 'pnpm dev' once to create it)" >&2; exit 1; }

existing=$(sqlite3 "$DEV_DB" "select count(*) from permanent_memories where workspace_id=$WS_ID;")
if [ "$existing" -gt 0 ]; then
  echo "dev DB already has $existing permanent memories for workspace $WS_ID — refusing to duplicate." >&2
  echo "Clear them first if you want a re-seed:  sqlite3 \"$DEV_DB\" \"delete from permanent_memories where workspace_id=$WS_ID; delete from fleeting_memories where workspace_id=$WS_ID;\"" >&2
  exit 1
fi

# Column lists must match between prod and dev (they do, as of this writing). If a
# migration diverges them, switch INSERT...SELECT * to an explicit column list.
sqlite3 "$DEV_DB" <<SQL
ATTACH DATABASE '$PROD_DB' AS prod;
INSERT INTO permanent_memories SELECT * FROM prod.permanent_memories WHERE workspace_id=$WS_ID;
INSERT INTO fleeting_memories  SELECT * FROM prod.fleeting_memories  WHERE workspace_id=$WS_ID;
DETACH DATABASE prod;
SQL

sqlite3 "$DEV_DB" "select 'permanent', count(*) from permanent_memories where workspace_id=$WS_ID
                   union all
                   select 'fleeting', count(*) from fleeting_memories where workspace_id=$WS_ID;"
echo "seeded workspace $WS_ID from $PROD_DB -> $DEV_DB"
