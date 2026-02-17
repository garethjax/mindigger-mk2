# Digital Matrix Monorepo — Project Notes

## general behaviour

whenever a major feature is a planned, propose a branch

## Stack

- **Frontend**: Astro SSR + Preact islands + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Edge Functions + GoTrue Auth)
- **Charts**: uPlot (rendering via Canvas API draw hooks — see below)
- **AI**: OpenAI API (batch + direct modes)
- **Runtime**: Bun (scripts), Deno (edge functions), Node/pnpm (web app)

## Critical Known Issues

### 1. Supabase Edge Functions: ES256 JWT Rejection (Feb 2026)

**Bug**: The Supabase API gateway rejects valid user JWTs when calling edge
functions. The auth service signs tokens with ES256 (asymmetric keys), but the
gateway only verifies HS256 (legacy symmetric secret). This means any
`supabase.functions.invoke()` from the browser fails with `{"msg":"Invalid JWT"}`.

**Upstream issue**: https://github.com/supabase/supabase/issues/41691

**Workaround applied**: In `supabase/config.toml`, each edge function that users
call has `verify_jwt = false`:

```toml
[functions.swot-submit]
verify_jwt = false
```

The functions still validate auth internally via `createAdminClient()` / `getUser()`.
If you add new edge functions callable by authenticated users, you MUST add the
same `verify_jwt = false` entry or users will get "Invalid JWT".

### 2. pg_cron: `app.settings.service_role_key` Not Persisted Across Restarts

**Bug**: All pg_cron jobs use `current_setting('app.settings.service_role_key')`
to authenticate HTTP calls to edge functions. This setting is empty after a
`supabase stop && supabase start` because it's not part of the migration.

**Workaround**: After every Supabase restart, run:

```sql
-- Must be run as supabase_admin (superuser)
ALTER DATABASE postgres SET app.settings.service_role_key =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
```

Without this, cron jobs (swot-poll, analysis-poll, scraping-poll, etc.) silently
fail because the gateway returns "Invalid JWT" for the empty Bearer token.

### 3. uPlot: Standard Series Rendering Broken

**Bug**: uPlot's built-in series rendering (paths, fills, bars, bands) produces
zero visible pixels in this environment. Only the `hooks.draw` callback with
direct Canvas API (`ctx.fillRect`, `ctx.stroke`, `ctx.arc`, etc.) works.

**Workaround applied**: Both `ReviewChart.tsx` and `ReviewDistributionChart.tsx`
use `hooks.draw` to render manually. Explicit Y scale max is also required
(`y: { min: 0, max: computedMax }`) because auto-range is broken too.

If you add new charts, do NOT use uPlot's standard series config for rendering.
Use the draw hook pattern from the existing chart components.

### 4. Supabase PostgREST: `max_rows` Default

The default `max_rows = 1000` in `supabase/config.toml` silently truncates query
results. It has been raised to `50000`. If you see data counts capped at round
numbers, check this setting.

### 5. OPENAI_API_KEY for Edge Functions

The key is passed via `[edge_runtime.secrets]` in `config.toml` using
`env(OPENAI_API_KEY)`. The actual key lives in `supabase/.env` (gitignored).
You must `export OPENAI_API_KEY=...` in your shell before running `supabase start`.

### 6. ai_configs Seed Data

The `ai_configs` table must have exactly one active record for edge functions to
work. The seed is in migration `001_initial_schema.sql` line 518, but it can be
lost after `supabase db reset`. Verify with:

```sql
SELECT count(*) FROM ai_configs WHERE is_active = true;
-- Must return exactly 1
```

## Dev Startup

```bash
export OPENAI_API_KEY="sk-proj-..."
supabase start
# After start, set the cron service key:
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres \
  -c "ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJhbGci...';"
# Then start the web app:
cd apps/web && pnpm dev
```

## Scripts

- `bun run scripts/migrate.ts` — Import legacy Django data (uses Bun-only APIs, NOT tsx)
- `SUPABASE_SERVICE_ROLE_KEY="sb_secret_..." bun run scripts/migrate.ts`
