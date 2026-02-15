-- 012_sector_prompt_template.sql
-- Add optional sector metadata + per-sector prompt override

ALTER TABLE business_sectors
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS prompt_template TEXT;
