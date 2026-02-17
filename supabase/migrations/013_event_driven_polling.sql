-- =============================================================
-- Migration 013: event-driven polling for MVP deploy
-- =============================================================
-- Goal:
-- - keep recurring schedules always active
-- - invoke poll functions only when there is real work to process
--
-- This reduces idle Edge Function invocations on small workloads while
-- preserving the current queue model.
-- =============================================================

-- -------------------------------------------------------
-- Replace polling jobs with conditional invocations
-- -------------------------------------------------------
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname in (
      'poll-scraping-jobs',
      'analysis-submit',
      'analysis-poll',
      'swot-poll'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

-- -------------------------------------------------------
-- 1. Poll active scraping jobs - every minute, only if active
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
  )
  where exists (
    select 1
    from scraping_configs sc
    where sc.status in ('elaborating', 'checking')
  );
  $$
);

-- -------------------------------------------------------
-- 2. Submit pending reviews - every minute, only if pending/stale
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
  )
  where exists (
    select 1
    from reviews r
    where r.status = 'pending'
       or (r.status = 'analyzing' and r.batched_at < now() - interval '24 hours')
  );
  $$
);

-- -------------------------------------------------------
-- 3. Poll review batches - every minute, only if in progress
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
  )
  where exists (
    select 1
    from ai_batches b
    where b.batch_type = 'reviews'
      and b.status = 'in_progress'
  );
  $$
);

-- -------------------------------------------------------
-- 4. Poll SWOT batches - every minute, only if in progress
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
  )
  where exists (
    select 1
    from ai_batches b
    where b.batch_type = 'swot'
      and b.status = 'in_progress'
  );
  $$
);
