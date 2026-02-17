import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireInternalOrAdmin } from "../_shared/supabase.ts";

const BOTSTER_API_KEY = Deno.env.get("BOTSTER_API_KEY")!;
const API_BASE = "https://botster.io/api/v2";

const PLATFORM_ENDPOINTS: Record<string, string> = {
  google_maps: `${API_BASE}/bots/google-maps-reviews-scraper`,
  tripadvisor: `${API_BASE}/bots/tripadvisor-reviews-scraper`,
  booking: `${API_BASE}/bots/booking-review-scraper`,
};

/**
 * Scheduled scraping — called by pg_cron.
 *
 * Dual schedule:
 *   - Weekly (Monday 00:00): Google Maps + TripAdvisor with frequency='weekly'
 *   - Monthly (1st 00:00): Booking with frequency='monthly'
 *
 * Only triggers for locations owned by active users.
 * Only triggers configs that have completed initial scrape.
 * Uses recurring_depth.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
    });
  }
  const triggered: string[] = [];
  const errors: string[] = [];

  try {
    await requireInternalOrAdmin(
      req.headers.get("authorization"),
      req.headers.get("x-internal-secret"),
    );

    const db = createAdminClient();
    // Determine which frequency to process based on request body or day of month
    const body = await req.json().catch(() => ({}));
    const frequency = body.frequency as string | undefined;

    // Default: detect from current date
    // Day 1 of month → monthly, otherwise weekly
    const now = new Date();
    const resolvedFrequency = frequency ?? (now.getUTCDate() === 1 ? "monthly" : "weekly");

    // Get eligible configs:
    // - initial_scrape_done = true (recurring only)
    // - status is idle or completed (not already running)
    // - matching frequency
    // - location has recurring_updates enabled
    const { data: configs, error: queryErr } = await db
      .from("scraping_configs")
      .select(`
        id, location_id, platform, platform_config,
        recurring_depth, frequency, bot_id,
        locations!inner(business_id, recurring_updates)
      `)
      .eq("initial_scrape_done", true)
      .in("status", ["idle", "completed"])
      .eq("frequency", resolvedFrequency)
      .eq("locations.recurring_updates", true);

    if (queryErr) throw queryErr;
    if (!configs || configs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No configs to trigger", frequency: resolvedFrequency }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const activeConfigs = configs;

    for (const config of activeConfigs) {
      try {
        const platform = config.platform as string;
        const endpoint = PLATFORM_ENDPOINTS[platform];
        if (!endpoint) continue;

        const platformConfig = config.platform_config as Record<string, string>;
        let payload: Record<string, unknown>;

        if (platform === "google_maps") {
          payload = {
            input: [`place_id:${platformConfig.place_id}`],
            coordinates: { latitude: 1, longitude: 1, zoom: "15" },
            depth: config.recurring_depth,
            sort: "newest",
            new_items_only: true,
          };
        } else if (platform === "tripadvisor") {
          payload = {
            input: [platformConfig.location_url],
            tripadvisor_language: "it",
            depth: config.recurring_depth,
            new_items_only: true,
          };
        } else {
          payload = {
            input: [platformConfig.location_url],
            new_items_only: true,
          };
        }

        const botRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${BOTSTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!botRes.ok) {
          const errText = await botRes.text();
          errors.push(`${config.id}: Botster ${botRes.status} - ${errText}`);
          await db
            .from("scraping_configs")
            .update({ status: "failed", last_error: errText })
            .eq("id", config.id);
          continue;
        }

        const botData = await botRes.json();
        const jobId = botData.job?.id ?? botData.id;

        await db
          .from("scraping_configs")
          .update({
            bot_id: String(jobId),
            status: "elaborating",
            last_error: null,
            retry_count: 0,
          })
          .eq("id", config.id);

        triggered.push(config.id);
      } catch (innerErr) {
        errors.push(
          `${config.id}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
        );
      }
    }

    // Reset report_sent flags for all locations of triggered configs
    if (triggered.length > 0) {
      const locationIds = activeConfigs
        .filter((c) => triggered.includes(c.id))
        .map((c) => c.location_id);

      if (locationIds.length > 0) {
        await db
          .from("locations")
          .update({ report_sent: false })
          .in("id", locationIds);
      }
    }

    return new Response(
      JSON.stringify({
        frequency: resolvedFrequency,
        triggered: triggered.length,
        errors: errors.length,
        details: { triggered, errors },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = /authorization|token|access required|forbidden|unauthorized/i.test(message) ? 403 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
