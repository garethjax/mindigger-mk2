import { Platform } from "../enums";
import { getFieldValue } from "./field-mappings";

export interface ParsedReview {
  title: string;
  rating: number;
  author_name: string;
  review_text: string;
  review_date: string | null;
  review_url: string;
  raw_data: Record<string, unknown>;
}

/**
 * Remove null characters from strings (Botster sometimes includes \x00).
 */
export function sanitizeString(value: unknown): string {
  if (value == null) return "";
  const str = typeof value === "string" ? value : String(value);
  return str.replace(/\0/g, "");
}

/**
 * Parse a date string into YYYY-MM-DD format.
 * Tries multiple formats commonly found in Botster output.
 */
export function parseDate(
  raw: string | null | undefined,
  bookingFormat = false,
): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // ISO-ish: "2024-11-15T10:30:00Z", "2024-11-15 10:30:00 +0000"
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Booking format: "15-11-2024" (DD-MM-YYYY)
  if (bookingFormat) {
    const dmyMatch = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  // English month name: "November 15, 2024"
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const monthMatch = str.match(
    /^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i,
  );
  if (monthMatch) {
    const mm = months[monthMatch[1].toLowerCase()];
    if (mm) {
      const dd = monthMatch[2].padStart(2, "0");
      return `${monthMatch[3]}-${mm}-${dd}`;
    }
  }

  // Unix timestamp (seconds)
  const num = Number(str);
  if (!isNaN(num) && num > 1e9 && num < 1e11) {
    const d = new Date(num * 1000);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Convert Booking's 0-10 rating scale to 0-5.
 */
function alignRating0to5(rating: number): number {
  if (rating <= 1) return Math.floor(rating);
  return Math.floor(rating / 2);
}

/**
 * Parse raw Botster results into standardized ParsedReview objects.
 */
export function parseResults(
  rawResults: Record<string, unknown>[],
  platform: Platform,
): ParsedReview[] {
  const parsed: ParsedReview[] = [];

  for (const raw of rawResults) {
    if (!raw || Object.keys(raw).length === 0) continue;

    let title = sanitizeString(getFieldValue(raw, platform, "title", ""));
    let rating = Number(getFieldValue(raw, platform, "rating", 1)) || 1;
    let authorName = sanitizeString(
      getFieldValue(raw, platform, "author_name", ""),
    );
    let reviewText = sanitizeString(
      getFieldValue(raw, platform, "review_text", ""),
    );
    const reviewDateRaw = String(
      getFieldValue(raw, platform, "review_date", "") ?? "",
    );
    let reviewUrl = sanitizeString(
      getFieldValue(raw, platform, "review_url", ""),
    );

    // Booking: combine positive + negative feedback
    if (platform === Platform.BOOKING) {
      const positives = sanitizeString(raw.review_positives);
      const negatives = sanitizeString(raw.review_negatives);

      if (positives || negatives) {
        if (positives && negatives) {
          reviewText = `${positives} ${negatives}`;
        } else {
          reviewText = positives || negatives;
        }
      }

      rating = alignRating0to5(rating);
    }

    // Ensure rating >= 1
    if (rating < 1) rating = 1;

    const reviewDate = parseDate(
      reviewDateRaw,
      platform === Platform.BOOKING,
    );

    // Sanitize raw_data (remove null chars from string values)
    const sanitizedRaw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      sanitizedRaw[k] = typeof v === "string" ? sanitizeString(v) : v;
    }

    parsed.push({
      title,
      rating,
      author_name: authorName,
      review_text: reviewText,
      review_date: reviewDate,
      review_url: reviewUrl,
      raw_data: sanitizedRaw,
    });
  }

  return parsed;
}
