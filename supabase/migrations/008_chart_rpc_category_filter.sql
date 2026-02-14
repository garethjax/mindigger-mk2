-- ============================================================================
-- 008: Add p_category_id filter to reviews_by_period RPC
-- ============================================================================
-- Categories are linked to reviews via the M2M table review_categories.
-- When p_category_id is set, only reviews tagged with that category are counted.
--
-- IMPORTANT: The old 7-param overload must be dropped first, otherwise
-- PostgreSQL keeps both and PostgREST cannot resolve the ambiguity.
-- ============================================================================

DROP FUNCTION IF EXISTS reviews_by_period(UUID, UUID, DATE, DATE, TEXT, INT[], TEXT);

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
RETURNS TABLE(period DATE, count BIGINT, avg_rating NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc(
      CASE p_granularity
        WHEN 'week'  THEN 'week'
        WHEN 'month' THEN 'month'
        ELSE 'day'
      END,
      r.review_date
    )::DATE                         AS period,
    count(*)::BIGINT                AS count,
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
