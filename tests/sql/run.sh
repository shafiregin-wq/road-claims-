#!/usr/bin/env bash
# Tests supabase/schema.sql on a throwaway local PostgreSQL server.
# Needs PostgreSQL 15+ binaries (initdb, pg_ctl, psql). Run from the repository root:  bash tests/sql/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -p 54329 -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL=("${RUN_AS[@]}" env PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -h "$DIR" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/tests/sql/supabase-stub.sql" 2>&1 | grep -v -e wal_level -e "HINT:" || true
"${PSQL[@]}" -f "$ROOT/supabase/schema.sql"
"${PSQL[@]}" -f "$ROOT/supabase/schema.sql"   # running it twice must work (updates)
"${RUN_AS[@]}" "$PGBIN/psql" -h "$DIR" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/sql/test-schema.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
exit "${PIPESTATUS[0]}"
