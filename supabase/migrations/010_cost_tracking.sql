-- 010_cost_tracking.sql
-- Add cached_tokens + model to token_usage, create ai_pricing table

-- New columns on token_usage
ALTER TABLE token_usage ADD COLUMN cached_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE token_usage ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-4.1';

-- Recreate unique constraint to include model
ALTER TABLE token_usage DROP CONSTRAINT token_usage_business_id_provider_batch_type_date_key;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_biz_provider_model_type_date_key
  UNIQUE (business_id, provider, model, batch_type, date);

-- Pricing table per model/provider/mode
CREATE TABLE ai_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'direct',
  input_price NUMERIC(10,6) NOT NULL,         -- $/1M tokens
  cached_input_price NUMERIC(10,6) NOT NULL DEFAULT 0,
  output_price NUMERIC(10,6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, model, mode)
);

-- Seed GPT-4.1 pricing (batch = 50% off direct)
INSERT INTO ai_pricing (provider, model, mode, input_price, cached_input_price, output_price) VALUES
  ('openai', 'gpt-4.1', 'batch',  1.00, 0.25, 4.00),
  ('openai', 'gpt-4.1', 'direct', 2.00, 0.50, 8.00);

-- RLS
ALTER TABLE ai_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view pricing"
  ON ai_pricing FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin manage pricing"
  ON ai_pricing FOR ALL
  USING (is_admin());
