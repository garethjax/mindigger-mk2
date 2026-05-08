#!/usr/bin/env bash
# Push-to-cloud: snapshot full overwrite from local Supabase to cloud.
#
# WHEN TO USE
#   When you want the cloud project to become an exact copy of the current
#   local DB (data-only). Schema is assumed to be aligned via migrations.
#
# WHAT IT DOES
#   1. Dump local: data-only, all of public.* + auth.users (passwords included).
#   2. On cloud: TRUNCATE all public tables + auth.users CASCADE.
#   3. Restore the dump on cloud.
#   Idempotent: re-running brings the cloud back in sync with local.
#
# PREREQS
#   - Local Supabase running (default: postgres://postgres:postgres@127.0.0.1:54322/postgres)
#   - Cloud project linked (env CLOUD_DB_URL or CLOUD_DB_PASSWORD set)
#   - pg_dump + psql installed
#
# USAGE
#   CLOUD_DB_PASSWORD='...' ./scripts/push-to-cloud.sh
#   (or set CLOUD_DB_URL directly to override the default pooler URL)

set -euo pipefail

LOCAL_DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
CLOUD_PROJECT_REF="${CLOUD_PROJECT_REF:-lqzxshhpfuyxfeciyngv}"
CLOUD_REGION="${CLOUD_REGION:-eu-west-1}"

if [[ -z "${CLOUD_DB_URL:-}" ]]; then
  # Auto-load password from PIANO/SUPABASE.md (gitignored) if not already set
  if [[ -z "${CLOUD_DB_PASSWORD:-}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    SECRETS_FILE="$SCRIPT_DIR/../PIANO/SUPABASE.md"
    if [[ -f "$SECRETS_FILE" ]]; then
      CLOUD_DB_PASSWORD=$(awk -F': *' '/^pw:/ {print $2; exit}' "$SECRETS_FILE")
    fi
  fi
  if [[ -z "${CLOUD_DB_PASSWORD:-}" ]]; then
    echo "ERROR: cloud DB password not found." >&2
    echo "  Either set CLOUD_DB_PASSWORD env var, or put 'pw: <password>'" >&2
    echo "  in PIANO/SUPABASE.md (file is gitignored)." >&2
    exit 1
  fi
  # URL-encode the password to handle special chars
  ENC_PW=$(python3 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=''))" "$CLOUD_DB_PASSWORD")
  CLOUD_DB_URL="postgresql://postgres.${CLOUD_PROJECT_REF}:${ENC_PW}@aws-0-${CLOUD_REGION}.pooler.supabase.com:6543/postgres"
fi

DUMP_FILE="${TMPDIR:-/tmp}/push-to-cloud-$$.sql"
trap 'rm -f "$DUMP_FILE"' EXIT

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[push]${NC} $1"; }
warn() { echo -e "${YELLOW}[push]${NC} $1"; }
err()  { echo -e "${RED}[push]${NC} $1"; }

# --- 1. Sanity checks ---
log "Checking local DB..."
if ! psql "$LOCAL_DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  err "Cannot connect to local DB at $LOCAL_DB_URL"; exit 1
fi
log "Checking cloud DB..."
if ! psql "$CLOUD_DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  err "Cannot connect to cloud DB"; exit 1
fi

# --- 2. Discover public tables (excluding system / migration tables) ---
log "Discovering public tables..."
TABLES=$(psql "$LOCAL_DB_URL" -tAc "
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT LIKE 'pg_%'
    AND tablename NOT IN ('schema_migrations','supabase_migrations')
  ORDER BY tablename;
")
COUNT=$(echo "$TABLES" | grep -c . || true)
log "Found $COUNT public tables to sync."

# --- 3. Dump local data ---
log "Dumping local data..."
TABLE_ARGS=""
for t in $TABLES; do TABLE_ARGS="$TABLE_ARGS -t public.${t}"; done
TABLE_ARGS="$TABLE_ARGS -t auth.users"

DB_CONTAINER="${DB_CONTAINER:-supabase_db_supabase}"
docker exec -i "$DB_CONTAINER" pg_dump \
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres" \
  --data-only \
  --no-owner --no-privileges \
  $TABLE_ARGS \
  > "$DUMP_FILE"

DUMP_SIZE=$(wc -c < "$DUMP_FILE" | tr -d ' ')
log "Dump written: $DUMP_FILE ($DUMP_SIZE bytes)"

# --- 4. Truncate on cloud ---
log "Truncating cloud tables..."
TRUNCATE_LIST=$(echo "$TABLES" | awk 'NF{printf "public.%s, ", $0}' | sed 's/, $//')
psql "$CLOUD_DB_URL" -v ON_ERROR_STOP=1 <<SQL
SET session_replication_role = 'replica';
TRUNCATE TABLE $TRUNCATE_LIST CASCADE;
TRUNCATE TABLE auth.users CASCADE;
SET session_replication_role = 'origin';
SQL
log "Truncate done."

# --- 5. Restore on cloud ---
log "Restoring data on cloud..."
# Wrap dump with session_replication_role = replica to bypass triggers/FK checks
# without needing to ALTER TABLE (which requires ownership of auth.users)
WRAPPED_DUMP="${DUMP_FILE}.wrapped"
{
  echo "BEGIN;"
  echo "SET session_replication_role = 'replica';"
  cat "$DUMP_FILE"
  echo "SET session_replication_role = 'origin';"
  echo "COMMIT;"
} > "$WRAPPED_DUMP"

docker exec -i "$DB_CONTAINER" psql "$CLOUD_DB_URL" -v ON_ERROR_STOP=1 \
  < "$WRAPPED_DUMP" > /tmp/push-to-cloud-restore.log 2>&1 \
  || { err "Restore failed — see /tmp/push-to-cloud-restore.log"; tail -30 /tmp/push-to-cloud-restore.log; rm -f "$WRAPPED_DUMP"; exit 1; }
rm -f "$WRAPPED_DUMP"

# --- 6. Verify ---
log "Verifying counts..."
for tbl in reviews businesses locations topics ai_batches; do
  LOCAL_N=$(psql "$LOCAL_DB_URL" -tAc "SELECT count(*) FROM public.$tbl")
  CLOUD_N=$(psql "$CLOUD_DB_URL" -tAc "SELECT count(*) FROM public.$tbl")
  if [[ "$LOCAL_N" == "$CLOUD_N" ]]; then
    log "  $tbl: $LOCAL_N (match)"
  else
    warn "  $tbl: local=$LOCAL_N cloud=$CLOUD_N (mismatch!)"
  fi
done
LOCAL_USERS=$(psql "$LOCAL_DB_URL" -tAc "SELECT count(*) FROM auth.users")
CLOUD_USERS=$(psql "$CLOUD_DB_URL" -tAc "SELECT count(*) FROM auth.users")
[[ "$LOCAL_USERS" == "$CLOUD_USERS" ]] \
  && log "  auth.users: $LOCAL_USERS (match)" \
  || warn "  auth.users: local=$LOCAL_USERS cloud=$CLOUD_USERS"

log "Done. Cloud is now in sync with local."
