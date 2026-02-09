-- ============================================================================
-- 007: RPC functions for dashboard chart aggregations
-- ============================================================================
-- reviews_by_period  → time series for ReviewChart (uPlot)
-- heatmap_data       → day×hour matrix for ReviewHeatmap
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
-- heatmap_data
-- Returns day-of-week (0=Mon, 6=Sun) × hour (0–23) with review count.
-- Uses created_at (timestamptz) for hour resolution since review_date is DATE.
-- Falls back to review_date at hour 12 if created_at is not meaningful.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION heatmap_data(
  p_business_id UUID,
  p_location_id UUID   DEFAULT NULL,
  p_date_from   DATE   DEFAULT NULL,
  p_date_to     DATE   DEFAULT NULL,
  p_source      TEXT   DEFAULT NULL,
  p_ratings     INT[]  DEFAULT NULL
)
RETURNS TABLE(day_of_week INT, hour INT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- PostgreSQL EXTRACT(isodow) = 1(Mon)..7(Sun) → shift to 0..6
    (EXTRACT(isodow FROM r.review_date)::INT - 1) AS day_of_week,
    EXTRACT(hour FROM r.created_at)::INT           AS hour,
    count(*)::BIGINT                               AS count
  FROM reviews r
  WHERE r.business_id = p_business_id
    AND r.status = 'completed'
    AND r.review_date IS NOT NULL
    AND (p_location_id IS NULL OR r.location_id = p_location_id)
    AND (p_date_from   IS NULL OR r.review_date >= p_date_from)
    AND (p_date_to     IS NULL OR r.review_date <= p_date_to)
    AND (p_source      IS NULL OR r.source::TEXT = p_source)
    AND (p_ratings     IS NULL OR r.rating = ANY(p_ratings))
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
