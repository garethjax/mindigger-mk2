import { sanitizeString } from "./review-parser";

/**
 * Fields used for MD5 dedup hash, matching the legacy Python implementation.
 * JSON.stringify with sorted keys ensures deterministic output.
 *
 * Legacy Python used: hashlib.md5(json.dumps(review_dict, sort_keys=True).encode())
 * We replicate the exact same dict structure and sorting.
 */
interface HashInput {
  author_name: string;
  business_id: string;
  location_id: string;
  rating: number;
  review_date: string | null;
  review_text: string;
  review_url: string;
  source: string;
  title: string;
}

/**
 * Compute MD5 hex digest for a review, matching the legacy Python implementation.
 * Uses crypto.subtle (available in Edge Functions and modern runtimes).
 *
 * IMPORTANT: The legacy system stored source as integer bitfield (1=Google, 2=TripAdvisor, 4=Booking).
 * New system uses string enum ("google_maps", "tripadvisor", "booking").
 * Since we're not migrating old hashes, new reviews will use string source values.
 */
export async function computeReviewHash(params: {
  title: string;
  rating: number;
  author_name: string;
  review_text: string;
  review_date: string | null;
  review_url: string;
  business_id: string;
  location_id: string;
  source: string;
}): Promise<string> {
  // Cap author_name at 50 chars (matches legacy)
  const authorCapped = sanitizeString(params.author_name).slice(0, 50);

  // Build hash input with keys that will be sorted by JSON.stringify
  const hashInput: HashInput = {
    author_name: authorCapped,
    business_id: params.business_id,
    location_id: params.location_id,
    rating: params.rating,
    review_date: params.review_date,
    review_text: sanitizeString(params.review_text),
    review_url: sanitizeString(params.review_url),
    source: params.source,
    title: sanitizeString(params.title),
  };

  // JSON with sorted keys — keys in HashInput are already alphabetical,
  // but we use replacer to be explicit
  const sortedKeys = Object.keys(hashInput).sort();
  const jsonStr = JSON.stringify(hashInput, sortedKeys);

  // MD5 via crypto.subtle (returns hex string)
  const encoded = new TextEncoder().encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest("MD5", encoded);
  const hashArray = new Uint8Array(hashBuffer);

  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Batch-compute hashes for multiple reviews.
 */
export async function computeReviewHashes(
  reviews: Parameters<typeof computeReviewHash>[0][],
): Promise<string[]> {
  return Promise.all(reviews.map(computeReviewHash));
}
