-- ============================================================================
-- 014: Security baseline hardening for MVP deploy
-- ============================================================================
-- Covers:
-- 1) search_path hardening on SECURITY DEFINER helpers
-- 2) prevent privilege escalation via profiles self-update
-- 3) enforce tenant ownership checks in chart RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Harden SECURITY DEFINER helper functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION user_business_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT business_id
  FROM profiles
  WHERE id = auth.uid() AND business_id IS NOT NULL;
$$;

-- ----------------------------------------------------------------------------
-- 2) Protect sensitive profile fields from non-admin updates
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_role user_role;
BEGIN
  -- service_role / system contexts are allowed
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role
    INTO requester_role
  FROM profiles
  WHERE id = auth.uid();

  -- admins can update all fields
  IF requester_role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- non-admin users cannot update other profiles
  IF NEW.id <> auth.uid() THEN
    RAISE EXCEPTION 'cannot update other profiles';
  END IF;

  -- non-admin users can only edit non-privileged profile attributes
  IF NEW.role <> OLD.role
     OR NEW.account_enabled <> OLD.account_enabled
     OR NEW.account_locked <> OLD.account_locked
     OR NEW.active_subscription <> OLD.active_subscription
     OR NEW.free_trial_consumed <> OLD.free_trial_consumed
     OR COALESCE(NEW.business_id, '00000000-0000-0000-0000-000000000000'::uuid)
        <> COALESCE(OLD.business_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'forbidden profile field update';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_fields ON profiles;
CREATE TRIGGER trg_protect_profile_sensitive_fields
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION protect_profile_sensitive_fields();

-- ----------------------------------------------------------------------------
-- 3) Guard chart RPCs against cross-tenant reads
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reviews_by_period(
  p_business_id UUID,
  p_location_id UUID     DEFAULT NULL,
  p_date_from   DATE     DEFAULT NULL,
  p_date_to     DATE     DEFAULT NULL,
  p_source      TEXT     DEFAULT NULL,
  p_ratings     INT[]    DEFAULT NULL,
  p_granularity TEXT     DEFAULT 'day',
  p_category_id UUID     DEFAULT NULL
)
RETURNS TABLE(period DATE, count BIGINT, avg_rating NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (is_admin() OR p_business_id IN (SELECT user_business_ids())) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc(
      CASE p_granularity
        WHEN 'week'  THEN 'week'
        WHEN 'month' THEN 'month'
        ELSE 'day'
      END,
      r.review_date
    )::DATE                          AS period,
    count(*)::BIGINT                 AS count,
    round(avg(r.rating)::NUMERIC, 2) AS avg_rating
  FROM reviews r
  WHERE r.business_id = p_business_id
    AND r.status = 'completed'
    AND r.review_date IS NOT NULL
    AND (p_location_id IS NULL OR r.location_id = p_location_id)
    AND (p_date_from   IS NULL OR r.review_date >= p_date_from)
    AND (p_date_to     IS NULL OR r.review_date <= p_date_to)
    AND (p_source      IS NULL OR r.source::TEXT = p_source)
    AND (p_ratings     IS NULL OR r.rating = ANY(p_ratings))
    AND (p_category_id IS NULL OR EXISTS (
      SELECT 1 FROM review_categories rc
      WHERE rc.review_id = r.id AND rc.category_id = p_category_id
    ))
  GROUP BY 1
  ORDER BY 1;
END;
$$;

CREATE OR REPLACE FUNCTION reviews_by_rating_period(
  p_business_id UUID,
  p_location_id UUID     DEFAULT NULL,
  p_date_from   DATE     DEFAULT NULL,
  p_date_to     DATE     DEFAULT NULL,
  p_source      TEXT     DEFAULT NULL,
  p_granularity TEXT     DEFAULT 'day'
)
RETURNS TABLE(period DATE, rating INT, count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (is_admin() OR p_business_id IN (SELECT user_business_ids())) THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc(
      CASE p_granularity
        WHEN 'week'  THEN 'week'
        WHEN 'month' THEN 'month'
        ELSE 'day'
      END,
      r.review_date
    )::DATE          AS period,
    r.rating::INT    AS rating,
    count(*)::BIGINT AS count
  FROM reviews r
  WHERE r.business_id = p_business_id
    AND r.status = 'completed'
    AND r.review_date IS NOT NULL
    AND r.rating IS NOT NULL
    AND (p_location_id IS NULL OR r.location_id = p_location_id)
    AND (p_date_from   IS NULL OR r.review_date >= p_date_from)
    AND (p_date_to     IS NULL OR r.review_date <= p_date_to)
    AND (p_source      IS NULL OR r.source::TEXT = p_source)
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION reviews_by_period(UUID, UUID, DATE, DATE, TEXT, INT[], TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reviews_by_rating_period(UUID, UUID, DATE, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reviews_by_period(UUID, UUID, DATE, DATE, TEXT, INT[], TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reviews_by_period(UUID, UUID, DATE, DATE, TEXT, INT[], TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reviews_by_rating_period(UUID, UUID, DATE, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reviews_by_rating_period(UUID, UUID, DATE, DATE, TEXT, TEXT) TO service_role;
