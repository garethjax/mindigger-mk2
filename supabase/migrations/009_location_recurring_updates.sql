-- Add recurring_updates flag to locations
-- When true, the weekly cron job (scraping-scheduled) will include this location.
-- Default false: only locations explicitly enabled get recurring scraping.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS recurring_updates BOOLEAN NOT NULL DEFAULT FALSE;

-- Update RLS: the column inherits existing location policies (no changes needed).
