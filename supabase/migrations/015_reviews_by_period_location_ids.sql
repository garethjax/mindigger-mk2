-- Add p_location_ids (uuid[]) parameter to reviews_by_period so the chart can
-- be scoped to a specific set of locations (e.g. only competitor locations or
-- only the main business location) without requiring a single location filter.
-- When p_location_ids is provided and p_location_id is NULL, the query filters
-- r.location_id = ANY(p_location_ids).  Both parameters are optional; if
-- neither is set the function returns all business reviews (previous behaviour).

CREATE OR REPLACE FUNCTION public.reviews_by_period(
  p_business_id  uuid,
  p_location_id  uuid       DEFAULT NULL,
  p_date_from    date       DEFAULT NULL,
  p_date_to      date       DEFAULT NULL,
  p_source       text       DEFAULT NULL,
  p_ratings      integer[]  DEFAULT NULL,
  p_granularity  text       DEFAULT 'day',
  p_category_id  uuid       DEFAULT NULL,
  p_location_ids uuid[]     DEFAULT NULL
)
RETURNS TABLE(period date, count bigint, avg_rating numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
    AND (p_location_id  IS NULL OR r.location_id = p_location_id)
    AND (p_location_ids IS NULL OR r.location_id = ANY(p_location_ids))
    AND (p_date_from    IS NULL OR r.review_date >= p_date_from)
    AND (p_date_to      IS NULL OR r.review_date <= p_date_to)
    AND (p_source       IS NULL OR r.source::TEXT = p_source)
    AND (p_ratings      IS NULL OR r.rating = ANY(p_ratings))
    AND (p_category_id  IS NULL OR EXISTS (
      SELECT 1 FROM review_categories rc
      WHERE rc.review_id = r.id AND rc.category_id = p_category_id
    ))
  GROUP BY 1
  ORDER BY 1;
END;
$$;
