-- 011_credit_balance.sql
-- Track OpenAI credit balance with a reference checkpoint

CREATE TABLE ai_credit_balance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_amount NUMERIC(10,2) NOT NULL,
  reference_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: $105.71 as of Feb 15, 2026
INSERT INTO ai_credit_balance (initial_amount, reference_date, notes)
VALUES (105.71, '2026-02-15', 'Saldo iniziale verificato su dashboard OpenAI');

-- RLS
ALTER TABLE ai_credit_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view balance"
  ON ai_credit_balance FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admin manage balance"
  ON ai_credit_balance FOR ALL
  USING (is_admin());
