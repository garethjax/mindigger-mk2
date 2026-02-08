-- ============================================================================
-- Mind Digger 2.0 - Initial Schema Migration
-- ============================================================================
-- Migrated from Django legacy (mindigger.core)
-- All UUIDs, no integer PKs. Enums as PostgreSQL types.
-- RLS enabled on all tables. service_role bypasses RLS for Edge Functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ----------------------------------------------------------------------------
-- 1. Custom Types (Enums)
-- ----------------------------------------------------------------------------

-- Legacy Bot enum was bitfield (1=Google, 2=TripAdvisor, 4=Booking)
CREATE TYPE platform AS ENUM ('google_maps', 'tripadvisor', 'booking', 'trustpilot');

CREATE TYPE user_role AS ENUM ('admin', 'business');

-- Legacy ElaborationStatus: PENDING=0, ELABORATING=1, COMPLETED=2
CREATE TYPE review_status AS ENUM ('pending', 'analyzing', 'completed', 'failed');

-- Legacy BotStatus: PENDING=0, ELABORATING=1, COMPLETED=2, CHECKING=3, FAILED=4
CREATE TYPE scraping_status AS ENUM ('idle', 'elaborating', 'checking', 'completed', 'failed');

CREATE TYPE scraping_frequency AS ENUM ('weekly', 'monthly');

-- Legacy BatchStatus: VALIDATING=0, FAILED=1, IN_PROGRESS=2, FINALIZING=3,
-- COMPLETED=4, EXPIRED=5, CANCELLING=6, CANCELLED=7
CREATE TYPE batch_status AS ENUM (
  'validating', 'failed', 'in_progress', 'finalizing',
  'completed', 'expired', 'cancelling', 'cancelled'
);

CREATE TYPE batch_type AS ENUM ('reviews', 'swot');

CREATE TYPE ai_mode AS ENUM ('batch', 'direct');

-- Legacy Period enum: 3,6,12,24,36,48,60 months
CREATE TYPE swot_period AS ENUM ('3', '6', '12', '24', '36', '48', '60');

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

-- profiles: extends auth.users
-- Legacy: authentication_customuser (UUID PK, roles M2M, subscription flags)
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'business',
  full_name   TEXT,
  avatar_url  TEXT,
  account_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  account_locked    BOOLEAN NOT NULL DEFAULT FALSE,
  active_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  free_trial_consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- business_sectors
-- Legacy: dashboard_admin_businesssector (int PK, bots bitfield)
CREATE TABLE business_sectors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  platforms   platform[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- categories
-- Legacy: category_category (UUID PK as 'uid', FK to sector)
CREATE TABLE categories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  business_sector_id  UUID NOT NULL REFERENCES business_sectors(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- businesses
-- Legacy: business_business (int PK + UUID 'uid', FK to user)
CREATE TABLE businesses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT DEFAULT 'organization',
  logo_url    TEXT,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- locations
-- Legacy: business_location (int PK + UUID 'uid', FK to business + sector)
CREATE TABLE locations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  business_sector_id  UUID NOT NULL REFERENCES business_sectors(id) ON DELETE CASCADE,
  is_competitor       BOOLEAN NOT NULL DEFAULT FALSE,
  report_sent         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- scraping_configs
-- Legacy: 3 separate tables (GoogleMapsLocation, TripAdvisorLocation, BookingLocation)
-- Unified into one table with platform enum + JSONB for platform-specific data
-- Added: dual depth (initial/recurring), frequency, retry fields (from Codex review)
CREATE TABLE scraping_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id           UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  platform              platform NOT NULL,
  -- Platform-specific config:
  --   google_maps: { place_id: string }
  --   tripadvisor: { location_url: string }
  --   booking: { location_url: string }
  platform_config       JSONB NOT NULL DEFAULT '{}',
  -- Dual depth optimization (initial vs recurring)
  initial_depth         INT NOT NULL DEFAULT 1000,
  recurring_depth       INT NOT NULL DEFAULT 100,
  frequency             scraping_frequency NOT NULL DEFAULT 'weekly',
  initial_scrape_done   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Job tracking
  status                scraping_status NOT NULL DEFAULT 'idle',
  bot_id                TEXT,
  -- Robustness fields (from Codex review)
  retry_count           INT NOT NULL DEFAULT 0,
  last_error            TEXT,
  next_poll_at          TIMESTAMPTZ,
  last_scraped_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One config per location per platform
  UNIQUE (location_id, platform)
);

-- reviews
-- Legacy: reviews_review (int PK + UUID 'uid', source bitfield, hash binary)
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source        platform NOT NULL,
  title         TEXT,
  text          TEXT,
  url           TEXT,
  rating        SMALLINT,
  author        TEXT,
  review_date   DATE,
  -- MD5 hex string (was BinaryField(16) in Django)
  review_hash   TEXT UNIQUE,
  raw_data      JSONB,
  ai_result     JSONB,
  status        review_status NOT NULL DEFAULT 'pending',
  batched_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- review_categories (M2M junction)
-- Legacy: reviews_review_categories
CREATE TABLE review_categories (
  review_id     UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, category_id)
);

-- topics
-- Legacy: topics_topic (UUID PK as 'uid')
CREATE TABLE topics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  business_sector_id  UUID REFERENCES business_sectors(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- topic_scores
-- Legacy: topics_topicscore (UUID PK, FK to review+topic+business+location)
-- Keeps denormalized FKs for query performance (as in legacy)
CREATE TABLE topic_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id     UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  topic_id      UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  score         SMALLINT CHECK (score >= 1 AND score <= 5),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  location_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ai_batches
-- Legacy: reviews_batch (int PK, batch_id char, status/type int enums)
CREATE TABLE ai_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_batch_id   TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'openai',
  batch_type          batch_type NOT NULL DEFAULT 'reviews',
  status              batch_status NOT NULL DEFAULT 'in_progress',
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- swot_analyses
-- Legacy: reviews_swot (int PK + UUID 'uid', period enum, statistics + results JSONB)
CREATE TABLE swot_analyses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period        swot_period NOT NULL,
  statistics    JSONB,
  results       JSONB,
  status        review_status NOT NULL DEFAULT 'pending',
  batched_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ai_configs (new - admin-managed AI provider configuration)
CREATE TABLE ai_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,
  mode        ai_mode NOT NULL DEFAULT 'batch',
  model       TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- token_usage
-- Legacy: reviews_token (int PK, FK business, date, prompt/completion/total tokens)
CREATE TABLE token_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'openai',
  batch_type        batch_type NOT NULL DEFAULT 'reviews',
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens      INT NOT NULL DEFAULT 0,
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One record per business/provider/type/day
  UNIQUE (business_id, provider, batch_type, date)
);

-- ----------------------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX idx_reviews_location       ON reviews(location_id);
CREATE INDEX idx_reviews_business       ON reviews(business_id);
CREATE INDEX idx_reviews_status         ON reviews(status);
CREATE INDEX idx_reviews_hash           ON reviews(review_hash);
CREATE INDEX idx_reviews_source_date    ON reviews(source, review_date);
CREATE INDEX idx_reviews_created        ON reviews(created_at);

CREATE INDEX idx_locations_business     ON locations(business_id);
CREATE INDEX idx_locations_sector       ON locations(business_sector_id);

CREATE INDEX idx_scraping_status        ON scraping_configs(status);
CREATE INDEX idx_scraping_location      ON scraping_configs(location_id);
CREATE INDEX idx_scraping_next_poll     ON scraping_configs(next_poll_at) WHERE status = 'elaborating';

CREATE INDEX idx_topic_scores_review    ON topic_scores(review_id);
CREATE INDEX idx_topic_scores_topic     ON topic_scores(topic_id);
CREATE INDEX idx_topic_scores_location  ON topic_scores(location_id);

CREATE INDEX idx_ai_batches_status      ON ai_batches(status);
CREATE INDEX idx_swot_location          ON swot_analyses(location_id);
CREATE INDEX idx_token_usage_date       ON token_usage(business_id, date);

CREATE INDEX idx_categories_sector      ON categories(business_sector_id);
CREATE INDEX idx_businesses_user        ON businesses(user_id);

-- ----------------------------------------------------------------------------
-- 4. Triggers
-- ----------------------------------------------------------------------------

-- Auto-create profile on auth.users INSERT
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'business',
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scraping_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON swot_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE swot_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- profiles: users see own, admin sees all
CREATE POLICY "Users view own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- business_sectors: read-only for all authenticated, admin can write
CREATE POLICY "Authenticated read sectors"
  ON business_sectors FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin manage sectors"
  ON business_sectors FOR ALL
  USING (is_admin());

-- categories: read-only for all authenticated, admin can write
CREATE POLICY "Authenticated read categories"
  ON categories FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin manage categories"
  ON categories FOR ALL
  USING (is_admin());

-- businesses: users see own, admin sees all
CREATE POLICY "Users view own businesses"
  ON businesses FOR SELECT
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "Admin manage businesses"
  ON businesses FOR ALL
  USING (is_admin());

-- locations: users see own (via business), admin sees all
CREATE POLICY "Users view own locations"
  ON locations FOR SELECT
  USING (
    business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
    OR is_admin()
  );

CREATE POLICY "Admin manage locations"
  ON locations FOR ALL
  USING (is_admin());

-- scraping_configs: users see own, admin manages
CREATE POLICY "Users view own scraping configs"
  ON scraping_configs FOR SELECT
  USING (
    location_id IN (
      SELECT l.id FROM locations l
      JOIN businesses b ON l.business_id = b.id
      WHERE b.user_id = auth.uid()
    )
    OR is_admin()
  );

CREATE POLICY "Admin manage scraping configs"
  ON scraping_configs FOR ALL
  USING (is_admin());

-- reviews: users see own (via business), admin sees all
CREATE POLICY "Users view own reviews"
  ON reviews FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()) OR is_admin());

CREATE POLICY "Admin manage reviews"
  ON reviews FOR ALL
  USING (is_admin());

-- review_categories: follows review access
CREATE POLICY "Users view own review categories"
  ON review_categories FOR SELECT
  USING (
    review_id IN (
      SELECT id FROM reviews
      WHERE business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())
    )
    OR is_admin()
  );

CREATE POLICY "Admin manage review categories"
  ON review_categories FOR ALL
  USING (is_admin());

-- topics: readable by all authenticated
CREATE POLICY "Authenticated read topics"
  ON topics FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin manage topics"
  ON topics FOR ALL
  USING (is_admin());

-- topic_scores: users see own
CREATE POLICY "Users view own topic scores"
  ON topic_scores FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()) OR is_admin());

CREATE POLICY "Admin manage topic scores"
  ON topic_scores FOR ALL
  USING (is_admin());

-- ai_batches: admin only
CREATE POLICY "Admin manage batches"
  ON ai_batches FOR ALL
  USING (is_admin());

-- swot_analyses: users see own
CREATE POLICY "Users view own SWOT"
  ON swot_analyses FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()) OR is_admin());

CREATE POLICY "Users create own SWOT"
  ON swot_analyses FOR INSERT
  WITH CHECK (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

CREATE POLICY "Admin manage SWOT"
  ON swot_analyses FOR ALL
  USING (is_admin());

-- ai_configs: admin only
CREATE POLICY "Admin manage AI configs"
  ON ai_configs FOR ALL
  USING (is_admin());

CREATE POLICY "Authenticated read active AI config"
  ON ai_configs FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

-- token_usage: users see own, admin sees all
CREATE POLICY "Users view own token usage"
  ON token_usage FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()) OR is_admin());

CREATE POLICY "Admin manage token usage"
  ON token_usage FOR ALL
  USING (is_admin());

-- ----------------------------------------------------------------------------
-- 6. Seed: default AI config
-- ----------------------------------------------------------------------------
INSERT INTO ai_configs (provider, mode, model, config, is_active) VALUES
  ('openai', 'batch', 'gpt-4.1', '{"temperature": 0.1, "top_p": 1, "frequency_penalty": 0, "presence_penalty": 0}', TRUE);
