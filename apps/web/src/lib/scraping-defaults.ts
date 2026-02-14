/**
 * Default scraping depths per platform.
 * initial_depth: first scrape (all historical reviews)
 * recurring_depth: subsequent weekly/monthly scrapes (only new reviews)
 *
 * Botster depth constraints:
 * - TripAdvisor: only accepts 30, 60, 100, 150, 500, 1000
 * - Google Maps: accepts any number (tested up to 2000)
 * - Booking: no depth parameter (credit-based)
 */
export const PLATFORM_DEFAULTS: Record<
  string,
  { initial_depth: number; recurring_depth: number; frequency: string }
> = {
  google_maps: { initial_depth: 2000, recurring_depth: 100, frequency: "weekly" },
  tripadvisor: { initial_depth: 1000, recurring_depth: 30, frequency: "weekly" },
  booking: { initial_depth: 250, recurring_depth: 1000, frequency: "monthly" },
  trustpilot: { initial_depth: 1000, recurring_depth: 50, frequency: "weekly" },
};
