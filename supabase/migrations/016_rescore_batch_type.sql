-- Add 'rescore' to the batch_type enum so ai_batches can track rescore jobs
-- separately from normal review analysis and swot batches.
ALTER TYPE batch_type ADD VALUE IF NOT EXISTS 'rescore';
