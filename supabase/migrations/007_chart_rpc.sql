-- ============================================================================
-- 007: RPC functions for dashboard chart aggregations
-- ============================================================================
-- reviews_by_period        → time series for ReviewChart (uPlot line/area)
-- reviews_by_rating_period → stacked area by sentiment for ReviewAreaChart
-- ============================================================================

-- ----------------------------------------------------------------------------
-- reviews_by_period
-- Returns one row per period bucket with count + avg rating.
-- p_location_id = NULL → aggregate across all locations for the business.
-- p_source      = NULL → all platforms.
-- p_ratings     = NULL → all ratings (1–5). Otherwise filters to given array.
-- p_granularity: 'day' | 'week' | 'month'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reviews_by_period(
  p_business_id UUID,
  p_location_id UUID     DEFAULT NULL,
  p_date_from   DATE     DEFAULT NULL,
  p_date_to     DATE     DEFAULT NULL,
  p_source      TEXT     DEFAULT NULL,
  p_ratings     INT[]    DEFAULT NULL,
  p_granularity TEXT     DEFAULT 'day'
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
  GROUP BY 1
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- reviews_by_rating_period
-- Returns one row per (period, rating) for stacked area chart.
-- Same filter parameters as reviews_by_period.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reviews_by_rating_period(
  p_business_id UUID,
  p_location_id UUID     DEFAULT NULL,
  p_date_from   DATE     DEFAULT NULL,
  p_date_to     DATE     DEFAULT NULL,
  p_source      TEXT     DEFAULT NULL,
  p_granularity TEXT     DEFAULT 'day'
)
RETURNS TABLE(period DATE, rating INT, count BIGINT) AS $$
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
    )::DATE              AS period,
    r.rating::INT        AS rating,
    count(*)::BIGINT     AS count
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
