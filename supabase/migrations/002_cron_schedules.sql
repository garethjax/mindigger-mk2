-- =============================================================
-- Migration 002: pg_cron schedules for scraping pipeline
-- =============================================================
-- Schedules:
--   1. Poll active Botster jobs (every minute)
--   2. Weekly scraping: Google Maps + TripAdvisor (Monday 00:00 UTC)
--   3. Monthly scraping: Booking (1st of month 00:00 UTC)
--   4. Botster job cleanup (Sunday 03:00 UTC)
--
-- Edge Functions are invoked via pg_net (http extension).
-- The SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are used to
-- call the Edge Functions as authenticated admin.
-- =============================================================

-- Enable pg_net for HTTP calls from within PostgreSQL
create extension if not exists pg_net with schema extensions;

-- Helper: get the base URL for Edge Functions
-- In local dev: http://supabase_kong_supabase:8000
-- In production: set via vault or config
create or replace function get_functions_url()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('app.settings.functions_url', true),
    'http://supabase_kong_supabase:8000'
  ) || '/functions/v1/';
$$;

-- -------------------------------------------------------
-- 1. Poll active scraping jobs — every minute
-- -------------------------------------------------------
select cron.schedule(
  'poll-scraping-jobs',
  '* * * * *',
  $$
  select net.http_post(
    url := get_functions_url() || 'scraping-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- -------------------------------------------------------
-- 2. Weekly scraping — Monday 00:00 UTC
--    Triggers Google Maps + TripAdvisor (frequency='weekly')
-- -------------------------------------------------------
select cron.schedule(
  'weekly-scraping',
  '0 0 * * 1',
  $$
  select net.http_post(
    url := get_functions_url() || 'scraping-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"frequency": "weekly"}'::jsonb
  );
  $$
);

-- -------------------------------------------------------
-- 3. Monthly scraping — 1st of month 00:00 UTC
--    Triggers Booking (frequency='monthly')
-- -------------------------------------------------------
select cron.schedule(
  'monthly-scraping',
  '0 0 1 * *',
  $$
  select net.http_post(
    url := get_functions_url() || 'scraping-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"frequency": "monthly"}'::jsonb
  );
  $$
);

-- -------------------------------------------------------
-- 4. Botster job cleanup — Sunday 03:00 UTC
-- -------------------------------------------------------
select cron.schedule(
  'botster-cleanup',
  '0 3 * * 0',
  $$
  select net.http_post(
    url := get_functions_url() || 'scraping-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
