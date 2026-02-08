-- ============================================================================
-- 004: Business-Users Taxonomy Refactor
-- ============================================================================
-- Old model: businesses.user_id → auth.users (1 owner per business)
-- New model: profiles.business_id → businesses (N users per business)
--
-- This enables multiple users per business (company-level billing).
-- ============================================================================

-- 1. Add business_id to profiles
ALTER TABLE profiles
  ADD COLUMN business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;

-- 2. Migrate existing data
UPDATE profiles p
SET business_id = b.id
FROM businesses b
WHERE b.user_id = p.id;

-- 3. Create index
CREATE INDEX idx_profiles_business ON profiles(business_id);

-- 4. Drop ALL old policies that depend on businesses.user_id (BEFORE dropping the column)
DROP POLICY IF EXISTS "Users view own businesses" ON businesses;
DROP POLICY IF EXISTS "Users view own locations" ON locations;
DROP POLICY IF EXISTS "Users view own scraping configs" ON scraping_configs;
DROP POLICY IF EXISTS "Users view own reviews" ON reviews;
DROP POLICY IF EXISTS "Users view own review categories" ON review_categories;
DROP POLICY IF EXISTS "Users view own topic scores" ON topic_scores;
DROP POLICY IF EXISTS "Users view own SWOT" ON swot_analyses;
DROP POLICY IF EXISTS "Users create own SWOT" ON swot_analyses;
DROP POLICY IF EXISTS "Users view own token usage" ON token_usage;

-- 5. Drop old column + index
DROP INDEX IF EXISTS idx_businesses_user;
ALTER TABLE businesses DROP COLUMN user_id;

-- 6. Helper function: get current user's business IDs
CREATE OR REPLACE FUNCTION user_business_ids()
RETURNS SETOF UUID AS $$
  SELECT business_id FROM profiles
  WHERE id = auth.uid() AND business_id IS NOT NULL
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 7. Recreate policies with new model

-- businesses
CREATE POLICY "Users view own businesses"
  ON businesses FOR SELECT
  USING (id IN (SELECT user_business_ids()) OR is_admin());

-- locations
CREATE POLICY "Users view own locations"
  ON locations FOR SELECT
  USING (
    business_id IN (SELECT user_business_ids())
    OR is_admin()
  );

-- scraping_configs
CREATE POLICY "Users view own scraping configs"
  ON scraping_configs FOR SELECT
  USING (
    location_id IN (
      SELECT l.id FROM locations l
      WHERE l.business_id IN (SELECT user_business_ids())
    )
    OR is_admin()
  );

-- reviews
CREATE POLICY "Users view own reviews"
  ON reviews FOR SELECT
  USING (business_id IN (SELECT user_business_ids()) OR is_admin());

-- review_categories
CREATE POLICY "Users view own review categories"
  ON review_categories FOR SELECT
  USING (
    review_id IN (
      SELECT id FROM reviews
      WHERE business_id IN (SELECT user_business_ids())
    )
    OR is_admin()
  );

-- topic_scores
CREATE POLICY "Users view own topic scores"
  ON topic_scores FOR SELECT
  USING (business_id IN (SELECT user_business_ids()) OR is_admin());

-- swot_analyses
CREATE POLICY "Users view own SWOT"
  ON swot_analyses FOR SELECT
  USING (business_id IN (SELECT user_business_ids()) OR is_admin());

CREATE POLICY "Users create own SWOT"
  ON swot_analyses FOR INSERT
  WITH CHECK (business_id IN (SELECT user_business_ids()));

-- token_usage
CREATE POLICY "Users view own token usage"
  ON token_usage FOR SELECT
  USING (business_id IN (SELECT user_business_ids()) OR is_admin());
