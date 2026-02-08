-- Seed data for local development
-- Run with: supabase db reset

-- Business Sectors
INSERT INTO business_sectors (id, name, platforms) VALUES
  (gen_random_uuid(), 'Hospitality', ARRAY['google_maps', 'tripadvisor', 'booking']::platform[]),
  (gen_random_uuid(), 'Ristorazione', ARRAY['google_maps', 'tripadvisor']::platform[]),
  (gen_random_uuid(), 'Servizi', ARRAY['google_maps', 'trustpilot']::platform[]);
