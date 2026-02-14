import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

const BOTSTER_API_KEY = Deno.env.get("BOTSTER_API_KEY")!;
const API_BASE = "https://botster.io/api/v2";

const PLATFORM_ENDPOINTS: Record<string, string> = {
  google_maps: `${API_BASE}/bots/google-maps-reviews-scraper`,
  tripadvisor: `${API_BASE}/bots/tripadvisor-reviews-scraper`,
  booking: `${API_BASE}/bots/booking-review-scraper`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: only admin can trigger scraping
    await requireAdmin(req.headers.get("authorization"));

    const { location_id, platform } = await req.json();
    if (!location_id || !platform) {
      return new Response(
        JSON.stringify({ error: "location_id and platform are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const endpoint = PLATFORM_ENDPOINTS[platform];
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: `Unsupported platform: ${platform}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createAdminClient();

    // Load scraping config
    const { data: config, error: configErr } = await db
      .from("scraping_configs")
      .select("*")
      .eq("location_id", location_id)
      .eq("platform", platform)
      .single();

    if (configErr || !config) {
      return new Response(
        JSON.stringify({ error: "Scraping config not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Don't trigger if already running
    if (config.status === "elaborating" || config.status === "checking") {
      return new Response(
        JSON.stringify({ error: "Scraping already in progress", status: config.status }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Determine depth: initial (first time) vs recurring
    const isInitialScrape = !config.initial_scrape_done;
    const depth = isInitialScrape
      ? config.initial_depth
      : config.recurring_depth;

    // Build platform-specific payload
    const platformConfig = config.platform_config as Record<string, string>;
    let payload: Record<string, unknown>;

    if (platform === "google_maps") {
      payload = {
        input: [`place_id:${platformConfig.place_id}`],
        coordinates: { latitude: 1, longitude: 1, zoom: "15" },
        depth,
        sort: "newest",
        // First run must backfill historical reviews.
        new_items_only: !isInitialScrape,
      };
    } else if (platform === "tripadvisor") {
      payload = {
        input: [platformConfig.location_url],
        tripadvisor_language: "it",
        depth,
        // First run must backfill historical reviews.
        new_items_only: !isInitialScrape,
      };
    } else {
      // Booking — no depth parameter (fixed credits)
      payload = {
        input: [platformConfig.location_url],
        // First run must backfill historical reviews.
        new_items_only: !isInitialScrape,
      };
    }

    // Call Botster API to create job
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
      // Update config with error
      await db
        .from("scraping_configs")
        .update({
          status: "failed",
          last_error: `Botster API ${botRes.status}: ${errText}`,
          retry_count: config.retry_count + 1,
        })
        .eq("id", config.id);

      return new Response(
        JSON.stringify({ error: "Botster API error", details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const botData = await botRes.json();
    const jobId = botData.job?.id ?? botData.id;

    // Update scraping config with bot_id and status
    await db
      .from("scraping_configs")
      .update({
        bot_id: String(jobId),
        status: "elaborating",
        last_error: null,
        retry_count: 0,
      })
      .eq("id", config.id);

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        depth_used: depth,
        initial_scrape: isInitialScrape,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Admin access") ? 403 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
