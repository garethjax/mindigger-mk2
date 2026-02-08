-- =============================================================
-- Migration 003: pg_cron schedules for AI analysis pipeline
-- =============================================================
-- Schedules:
--   1. Submit pending reviews for analysis (every minute)
--   2. Poll review analysis batches (every minute)
--   3. Poll SWOT analysis batches (every minute)
--
-- SWOT submit is triggered on-demand (user/admin), not by cron.
-- =============================================================

-- -------------------------------------------------------
-- 1. Submit pending reviews — every minute
-- -------------------------------------------------------
select cron.schedule(
  'analysis-submit',
  '* * * * *',
  $$
  select net.http_post(
    url := get_functions_url() || 'analysis-submit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- -------------------------------------------------------
-- 2. Poll review analysis batches — every minute
-- -------------------------------------------------------
select cron.schedule(
  'analysis-poll',
  '* * * * *',
  $$
  select net.http_post(
    url := get_functions_url() || 'analysis-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- -------------------------------------------------------
-- 3. Poll SWOT analysis batches — every minute
-- -------------------------------------------------------
select cron.schedule(
  'swot-poll',
  '* * * * *',
  $$
  select net.http_post(
    url := get_functions_url() || 'swot-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
