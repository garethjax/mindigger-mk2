-- Drop the legacy 8-argument `reviews_by_period` overload left behind by
-- migration 008.  Migration 015 added a 9-argument version that adds
-- `p_location_ids`, but without dropping the old one.  Postgres now has two
-- overloads that share the first 8 argument types and default values, which
-- makes any RPC call from PostgREST that does not pass `p_location_ids`
-- ambiguous ("function reviews_by_period(...) is not unique") and the chart
-- ends up empty whenever a single location is selected.
--
-- The 9-argument version is a strict superset (the new arg defaults to NULL),
-- so dropping the old one is safe.

DROP FUNCTION IF EXISTS public.reviews_by_period(
  uuid, uuid, date, date, text, integer[], text, uuid
);
