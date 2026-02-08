-- Add billing/registry fields to businesses (aziende)
ALTER TABLE businesses
  ADD COLUMN ragione_sociale TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN referente_nome TEXT;
