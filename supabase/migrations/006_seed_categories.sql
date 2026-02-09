-- ============================================================================
-- 006: Seed Business Sectors + Categories (from legacy dump)
-- ============================================================================
-- Legacy source: dashboard_admin_businesssector + category_category
-- Sectors: 6 (with platform arrays derived from legacy bots bitfield)
-- Categories: 61 (preserving original UUIDs for migration compatibility)
-- ============================================================================

-- Remove any dev-seed sectors (seed.sql used to insert 3 placeholder sectors).
-- CASCADE deletes dependent categories rows but NOT locations (FK is NOT CASCADE).
-- If locations reference old sector IDs, this migration must run BEFORE location data exists.
DELETE FROM categories;
DELETE FROM business_sectors;

-- ----------------------------------------------------------------------------
-- Business Sectors
-- Legacy bots bitfield: 1=google_maps, 2=tripadvisor, 4=booking
-- ----------------------------------------------------------------------------
INSERT INTO business_sectors (id, name, platforms) VALUES
  -- id=1 Food & beverage  bots=3 (1+2)
  ('00000000-0000-0000-0000-000000000001', 'Food & Beverage',   ARRAY['google_maps','tripadvisor']::platform[]),
  -- id=2 Hospitality       bots=7 (1+2+4)
  ('00000000-0000-0000-0000-000000000002', 'Hospitality',       ARRAY['google_maps','tripadvisor','booking']::platform[]),
  -- id=3 Healthy and care  bots=1
  ('00000000-0000-0000-0000-000000000003', 'Healthy and Care',  ARRAY['google_maps']::platform[]),
  -- id=4 Retail            bots=1
  ('00000000-0000-0000-0000-000000000004', 'Retail',            ARRAY['google_maps']::platform[]),
  -- id=5 Dealer            bots=1
  ('00000000-0000-0000-0000-000000000005', 'Dealer',            ARRAY['google_maps']::platform[]),
  -- id=6 Pharmacy          bots=1
  ('00000000-0000-0000-0000-000000000006', 'Pharmacy',          ARRAY['google_maps']::platform[]);

-- ----------------------------------------------------------------------------
-- Categories (preserving legacy UUIDs)
-- ----------------------------------------------------------------------------

-- Food & Beverage (sector 1)
INSERT INTO categories (id, name, business_sector_id) VALUES
  ('c45011c1-ddc5-47a6-930f-5a4ab422945f', 'Cibo',             '00000000-0000-0000-0000-000000000001'),
  ('41ad4c79-9623-42f3-8e6f-425459ea3440', 'Locale',           '00000000-0000-0000-0000-000000000001'),
  ('eca5157b-c3c4-4302-a67b-e375f6f19fc1', 'Generale',         '00000000-0000-0000-0000-000000000001'),
  ('65387506-507a-42f5-8c95-0b3a823739e2', 'Percezione',       '00000000-0000-0000-0000-000000000001'),
  ('04459101-ba58-4de1-97ce-48fba291e334', 'Personale',         '00000000-0000-0000-0000-000000000001'),
  ('04546af6-0eaa-44e9-8c42-c626c800cb4e', 'Prezzo',           '00000000-0000-0000-0000-000000000001'),
  ('2a4aaf41-cf5f-4067-938b-6bdc8c92dda8', 'Servizio',         '00000000-0000-0000-0000-000000000001'),
  ('87ade4a9-25ef-4a7c-886b-1245a354b7fe', 'Vino',             '00000000-0000-0000-0000-000000000001'),
  ('30031be2-12f1-4244-98aa-37357f2b092f', 'Problemi',         '00000000-0000-0000-0000-000000000001'),
  ('8c1b6ed1-664e-4216-9b4d-3c5b7f647f50', 'Altro',            '00000000-0000-0000-0000-000000000001'),
  ('a107fadf-c63e-48b6-93a2-c6c4dd6c23bc', 'Senza Commenti',   '00000000-0000-0000-0000-000000000001');

-- Hospitality (sector 2)
INSERT INTO categories (id, name, business_sector_id) VALUES
  ('98689d0e-495d-4f5a-904d-6a5f3cc73e85', 'Camere',                     '00000000-0000-0000-0000-000000000002'),
  ('cbb96594-18c4-4666-a13f-7a3e71c173e9', 'Pulizia',                    '00000000-0000-0000-0000-000000000002'),
  ('0956128c-c0c0-4eca-9209-b5d412ec1e85', 'Ristorazione e Colazione',   '00000000-0000-0000-0000-000000000002'),
  ('e3850cc4-d90f-464b-af55-c32668c2b608', 'Servizio e Personale',       '00000000-0000-0000-0000-000000000002'),
  ('81703935-51fb-4d35-b599-8918df4ce7f8', 'Prezzo e Valore',            '00000000-0000-0000-0000-000000000002'),
  ('683a508c-9193-43f9-8288-6a3c23711422', 'Posizione e Accessibilità',  '00000000-0000-0000-0000-000000000002'),
  ('2df66604-6b94-4296-9381-18e0da9f7397', 'Struttura e Ambiente',       '00000000-0000-0000-0000-000000000002'),
  ('13e89575-3b07-4233-9456-8f7c498263e8', 'Servizi e Attrezzature',     '00000000-0000-0000-0000-000000000002'),
  ('d2784c95-1615-4c1e-84b0-18c07fcc31ce', 'Problemi',                   '00000000-0000-0000-0000-000000000002'),
  ('c00e2ed0-06e5-4248-ae05-3930f219586b', 'Altro',                      '00000000-0000-0000-0000-000000000002'),
  ('548d4138-5bb8-4b63-8702-498a628f65e1', 'Senza Commenti',             '00000000-0000-0000-0000-000000000002');

-- Healthy and Care (sector 3)
INSERT INTO categories (id, name, business_sector_id) VALUES
  ('8667c084-f410-4b23-b13a-45b3ef4eca53', 'Professionalità',          '00000000-0000-0000-0000-000000000003'),
  ('bb8f1156-7d9d-4ef8-8620-fffba60c6ea2', 'Accoglienza',              '00000000-0000-0000-0000-000000000003'),
  ('6b2a534a-5692-4bfc-9ebd-35466e7cb972', 'Organizzazione',           '00000000-0000-0000-0000-000000000003'),
  ('e13ccbe9-ce6b-4041-90b5-19978ed76e0c', 'Struttura',                '00000000-0000-0000-0000-000000000003'),
  ('1f93ea61-b677-455c-ba09-86b0a8813284', 'Qualità delle Cure',       '00000000-0000-0000-0000-000000000003'),
  ('33d1a505-b571-4a24-991e-aeb99a02f75b', 'Costo e Trasparenza',      '00000000-0000-0000-0000-000000000003'),
  ('2450b7af-8a21-4ab6-8036-0799b47271b5', 'Consigli',                 '00000000-0000-0000-0000-000000000003'),
  ('5d3da93d-e538-403e-bd02-e0bc80680cce', 'Problemi',                 '00000000-0000-0000-0000-000000000003'),
  ('1e67c5d3-b6cf-489d-a318-5ef31e6485c1', 'Altro',                    '00000000-0000-0000-0000-000000000003'),
  ('ef685732-9907-4ccb-a639-0a8eec8ca73a', 'Senza Commenti',           '00000000-0000-0000-0000-000000000003');

-- Retail (sector 4)
INSERT INTO categories (id, name, business_sector_id) VALUES
  ('dc3c8282-1955-488c-9c25-2e022be4d5f7', 'Personale e Servizio Clienti', '00000000-0000-0000-0000-000000000004'),
  ('1dc0a66c-1468-4019-be07-09dadaf1a392', 'Prodotti e Assortimento',      '00000000-0000-0000-0000-000000000004'),
  ('74c8b470-a1b0-4390-8c16-c1e6878dcf8b', 'Organizzazione',              '00000000-0000-0000-0000-000000000004'),
  ('a8bfae95-7da1-4e3d-8b0b-6c59803f410c', 'Atmosfera Negozio',           '00000000-0000-0000-0000-000000000004'),
  ('ea359ac4-9082-416b-be06-65aae0b7d948', 'Prezzi e Promozioni',         '00000000-0000-0000-0000-000000000004'),
  ('f64c2517-4aac-46f0-97fa-f3af9721922d', 'Esperienza e Soddisfazione',  '00000000-0000-0000-0000-000000000004'),
  ('94ff240f-89ce-4b31-8f7e-7f756dc4ca7c', 'Problemi',                    '00000000-0000-0000-0000-000000000004'),
  ('de53117a-6ca9-4a30-ae75-377421fa76a5', 'Altro',                       '00000000-0000-0000-0000-000000000004'),
  ('8fd7812d-13ea-4162-8621-1bba3518df26', 'Senza Commenti',              '00000000-0000-0000-0000-000000000004');

-- Dealer (sector 5)
INSERT INTO categories (id, name, business_sector_id) VALUES
  ('eb8e4ffa-5d9a-4973-8e5e-f716205631d8', 'Professionalità',           '00000000-0000-0000-0000-000000000005'),
  ('ae2ee907-2191-49d0-bb9f-395a5fd3873d', 'Servizio Clienti',          '00000000-0000-0000-0000-000000000005'),
  ('f1b5e620-f82f-44b9-a308-c981a54f4aa5', 'Prodotti e Veicoli',        '00000000-0000-0000-0000-000000000005'),
  ('9b87a8e2-cc72-44a9-a7c8-6a3bebd3272f', 'Condizioni Economiche',     '00000000-0000-0000-0000-000000000005'),
  ('6a03f50b-1d98-487a-9556-270a5b5249a4', 'Processo Compravendita',    '00000000-0000-0000-0000-000000000005'),
  ('a32bd8a1-8c20-4192-9995-8620320f9ac1', 'Organizzazione',            '00000000-0000-0000-0000-000000000005'),
  ('1532c1b4-4f45-4bce-981b-c41f725561a3', 'Esperienza Complessiva',    '00000000-0000-0000-0000-000000000005'),
  ('8cd86783-8648-44dd-9c57-07c7e312b97a', 'Problemi',                  '00000000-0000-0000-0000-000000000005'),
  ('c852bd47-c148-4db3-8750-8e3339af3b91', 'Altro',                     '00000000-0000-0000-0000-000000000005'),
  ('74806af8-d627-4e36-94b2-7b96d52eff45', 'Senza Commenti',            '00000000-0000-0000-0000-000000000005');

-- Pharmacy (sector 6)
INSERT INTO categories (id, name, business_sector_id) VALUES
  ('81e44b4d-2c42-4fb7-9f2d-2535f3fd6a5f', 'Professionalità',  '00000000-0000-0000-0000-000000000006'),
  ('d0c5edb2-56ce-4934-b5aa-e4b2fae3e146', 'Assortimento',     '00000000-0000-0000-0000-000000000006'),
  ('ce67e8e9-f9de-429b-9f91-3e00c48d355c', 'Tempistiche',      '00000000-0000-0000-0000-000000000006'),
  ('88899f67-ad46-4b06-9220-a6382f1815a5', 'Cortesia',         '00000000-0000-0000-0000-000000000006'),
  ('a75e701c-ca9e-434d-b83d-09a52feebd43', 'Competenza',       '00000000-0000-0000-0000-000000000006'),
  ('7025a2d6-e9ee-417c-a6ff-6acddf9305b4', 'Orari',            '00000000-0000-0000-0000-000000000006'),
  ('0928a716-a868-42ae-ad6e-90f43c6b8fe1', 'Problemi',         '00000000-0000-0000-0000-000000000006'),
  ('0e671543-3b5f-4dc0-95de-e6245672a5f3', 'Scortesia',        '00000000-0000-0000-0000-000000000006'),
  ('d84e0378-5df6-43ef-91cc-9c92c63dc4b9', 'Generico',         '00000000-0000-0000-0000-000000000006'),
  ('96e1b132-80af-4edb-8801-03349a3d2f4d', 'Altro',            '00000000-0000-0000-0000-000000000006');
