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
if supabase status &>/dev/null 2>&1; then
  log "Supabase already running."
else
  supabase start
  log "Supabase started."
fi

# Show Supabase URLs
echo ""
supabase status | head -20
echo ""

# --- 3. Install deps if needed ---
if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  log "Installing dependencies..."
  cd "$WEB_DIR" && pnpm install
fi

# --- 4. Start Astro dev server ---
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
