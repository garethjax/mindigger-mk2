import { Platform } from "../enums";

/**
 * Per-platform field name mappings.
 * Each key maps to an ordered list of possible field names in the raw Botster data.
 * The first match wins.
 */
type FieldMap = Record<string, string[]>;

const GOOGLE_MAPS_FIELDS: FieldMap = {
  title: ["title", "review_title"],
  rating: ["rating"],
  author_name: ["profile_name", "author_name", "name"],
  review_text: ["text", "review_text", "content"],
  review_date: ["time", "reviewed_at", "review_date", "date"],
  visit_date: ["time", "reviewed_at", "review_date", "date"],
  review_url: ["review_url", "url"],
};

const TRIPADVISOR_FIELDS: FieldMap = {
  title: ["title"],
  rating: ["rating"],
  author_name: ["author_name"],
  review_text: ["review_text", "text"],
  review_date: ["review_date", "date", "reviewed_at"],
  visit_date: ["visit_date", "review_date", "date"],
  review_url: ["url", "review_url"],
};

const BOOKING_FIELDS: FieldMap = {
  title: ["review_title", "title"],
  rating: ["review_score", "rating", "score"],
  author_name: ["guest_name", "author_name", "name"],
  review_text: ["review_text", "text"],
  review_date: ["review_date", "date", "reviewed_at"],
  visit_date: ["visit_date", "review_date", "date"],
  review_url: ["hotel_url", "review_url", "url"],
};

const FIELD_MAPS: Partial<Record<Platform, FieldMap>> = {
  [Platform.GOOGLE_MAPS]: GOOGLE_MAPS_FIELDS,
  [Platform.TRIPADVISOR]: TRIPADVISOR_FIELDS,
  [Platform.BOOKING]: BOOKING_FIELDS,
};

/**
 * Extract a field value from raw review data using platform-specific mappings.
 * Tries each possible field name in order, returns defaultValue if none found.
 */
export function getFieldValue(
  raw: Record<string, unknown>,
  platform: Platform,
  field: string,
  defaultValue: unknown = "",
): unknown {
  const map = FIELD_MAPS[platform];
  if (!map) return defaultValue;

  const candidates = map[field];
  if (!candidates) return defaultValue;

  for (const key of candidates) {
    const val = raw[key];
    if (val != null && val !== "") return val;
  }
  return defaultValue;
}
