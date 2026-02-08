-- Seed data for local development
-- Run with: supabase db reset

-- Admin user (admin@mindigger.it / admin123)
-- GoTrue requires all token/change string columns to be non-null (empty string, not NULL)
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'admin@mindigger.it',
  crypt('admin123', gen_salt('bf')),
  now(), now(), now(),
  '', '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Admin"}',
  false, false
);

-- Set admin role in profile (trigger creates the profile row automatically)
UPDATE profiles SET role = 'admin' WHERE id = (
  SELECT id FROM auth.users WHERE email = 'admin@mindigger.it'
);

-- Azienda Digital Matrix (admin company)
INSERT INTO businesses (id, name, type, ragione_sociale, email, referente_nome)
VALUES (
  gen_random_uuid(),
  'Digital Matrix',
  'agency',
  'Digital Matrix S.r.l.',
  'info@digitalmatrix.it',
  'Admin'
);

-- Assign admin user to Digital Matrix
UPDATE profiles SET business_id = (
  SELECT id FROM businesses WHERE name = 'Digital Matrix'
) WHERE id = (
  SELECT id FROM auth.users WHERE email = 'admin@mindigger.it'
);

-- Business Sectors
INSERT INTO business_sectors (id, name, platforms) VALUES
  (gen_random_uuid(), 'Hospitality', ARRAY['google_maps', 'tripadvisor', 'booking']::platform[]),
  (gen_random_uuid(), 'Ristorazione', ARRAY['google_maps', 'tripadvisor']::platform[]),
  (gen_random_uuid(), 'Servizi', ARRAY['google_maps', 'trustpilot']::platform[]);
