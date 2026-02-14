#!/usr/bin/env bash
# Mind Digger MK2 — Dev Environment Startup
# Usage: ./dev.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[dev]${NC} $1"; }
err()  { echo -e "${RED}[dev]${NC} $1"; }

cleanup() {
  log "Shutting down..."
  # Kill astro dev server if running
  if [[ -n "${ASTRO_PID:-}" ]]; then
    kill "$ASTRO_PID" 2>/dev/null || true
    wait "$ASTRO_PID" 2>/dev/null || true
  fi
  log "Done."
}
trap cleanup EXIT INT TERM

# --- 1. Check prerequisites ---
for cmd in docker supabase pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    err "$cmd not found. Install it first."
    exit 1
  fi
done

if ! docker info &>/dev/null; then
  err "Docker daemon is not running. Start Docker Desktop first."
  exit 1
fi

# --- 2. Start Supabase ---
log "Starting Supabase..."
cd "$ROOT_DIR"

_recover_supabase() {
  warn "Supabase in inconsistent state. Stopping (preserving data) and restarting..."
  # ┌─────────────────────────────────────────────────────────────────┐
  # │  WARNING — DO NOT ADD --no-backup TO THIS COMMAND              │
  # │                                                                │
  # │  `supabase stop --no-backup` DESTROYS all Docker volumes,      │
  # │  which means the entire local database is wiped: reviews,      │
  # │  users, locations, SWOT analyses — everything.                 │
  # │                                                                │
  # │  This function is called after a computer restart when         │
  # │  containers are in an inconsistent state. A plain              │
  # │  `supabase stop` cleans up stale containers while keeping     │
  # │  the data volumes intact, so `supabase start` can bring       │
  # │  back the database with all data preserved.                    │
  # │                                                                │
  # │  We learned this the hard way: 15k+ reviews lost.             │
  # └─────────────────────────────────────────────────────────────────┘
  supabase stop 2>/dev/null || true
  supabase start || { err "Failed to start Supabase."; exit 1; }
}

_status_ok() {
  local out
  out=$(supabase status 2>&1) || return 1
  ! echo "$out" | grep -q "container is not running"
}

if _status_ok; then
  log "Supabase already running."
else
  if ! supabase start; then
    _recover_supabase
  fi
  log "Supabase started."
fi

# Show Supabase URLs
echo ""
supabase status || true
echo ""

# --- 3. Post-start database health checks ---
log "Running post-start health checks..."

SB_SERVICE_ROLE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

# 3a. Set pg_cron service role key (not persisted across restarts)
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -q -c \
  "ALTER DATABASE postgres SET app.settings.service_role_key = '$SB_SERVICE_ROLE_KEY';" 2>/dev/null \
  && log "pg_cron service_role_key set." \
  || warn "Could not set service_role_key (cron jobs may fail)."

# 3b. Ensure ai_configs has exactly one active record
AI_COUNT=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -tAq -c \
  "SELECT count(*) FROM ai_configs WHERE is_active = true;" 2>/dev/null || echo "0")

if [[ "$AI_COUNT" -eq 0 ]]; then
  warn "ai_configs empty — inserting default OpenAI batch config..."
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -q -c \
    "INSERT INTO ai_configs (provider, mode, model, config, is_active) VALUES
       ('openai', 'batch', 'gpt-4.1', '{\"temperature\": 0.1, \"top_p\": 1}', TRUE);" 2>/dev/null \
    && log "ai_configs seeded." \
    || warn "Could not seed ai_configs."
elif [[ "$AI_COUNT" -gt 1 ]]; then
  warn "ai_configs has $AI_COUNT active records (expected 1). Check for duplicates."
else
  log "ai_configs OK (1 active record)."
fi

# 3c. Check OPENAI_API_KEY is available for edge functions
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  if [[ -f "$ROOT_DIR/supabase/.env" ]] && grep -q "OPENAI_API_KEY" "$ROOT_DIR/supabase/.env"; then
    warn "OPENAI_API_KEY not exported in shell but found in supabase/.env."
    warn "Edge functions will use it, but 'supabase start' must be re-run if .env changed."
  else
    warn "OPENAI_API_KEY not set. AI features (SWOT, analysis) will not work."
    warn "Set it with: export OPENAI_API_KEY='sk-...' and restart Supabase."
  fi
else
  log "OPENAI_API_KEY is set."
fi

# --- 4. Install deps if needed ---
if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  log "Installing dependencies..."
  cd "$WEB_DIR" && pnpm install
fi

# --- 5. Start Astro dev server ---
log "Starting Astro dev server on http://localhost:4321 ..."
cd "$WEB_DIR"
pnpm run dev --host 0.0.0.0 &
ASTRO_PID=$!

echo ""
log "=========================================="
log "  Mind Digger MK2 — Dev Ready"
log "=========================================="
log "  Astro:    http://localhost:4321"
log "  Supabase: http://127.0.0.1:54321"
log "  Studio:   http://127.0.0.1:54323"
log "  Admin:    admin@mindigger.it / admin123"
log "=========================================="
echo ""
log "Press Ctrl+C to stop."

wait "$ASTRO_PID"
