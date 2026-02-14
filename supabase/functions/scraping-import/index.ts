import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";
import { ingestRawReviews } from "../_shared/scraping-ingest.ts";

const BOTSTER_API_KEY = Deno.env.get("BOTSTER_API_KEY") || "";
const API_BASE = "https://botster.io/api/v2";

type ImportBody = {
  config_id?: string;
  location_id?: string;
  platform?: string;
  job_id?: string;
  raw_reviews?: unknown;
  trigger_analysis?: boolean;
};

function extractRawReviews(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.filter((r) => !!r && typeof r === "object") as Record<string, unknown>[];
  }

  if (typeof raw === "string") {
    try {
      return extractRawReviews(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return extractRawReviews(obj.data);
    if (Array.isArray(obj.results)) return extractRawReviews(obj.results);
    if (Array.isArray(obj.items)) return extractRawReviews(obj.items);
  }

  return [];
}

async function fetchJobResults(jobId: string): Promise<Record<string, unknown>[]> {
  if (!BOTSTER_API_KEY) {
    throw new Error("Missing BOTSTER_API_KEY");
  }

  const jobRes = await fetch(`${API_BASE}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` },
  });
  if (!jobRes.ok) {
    throw new Error(`Botster job lookup failed: ${jobRes.status}`);
  }

  const jobData = await jobRes.json();
  const runs = jobData.job?.runs ?? [];
  if (!Array.isArray(runs) || runs.length === 0) {
    return [];
  }

  const lastRunId = runs[runs.length - 1]?.id;
  if (!lastRunId) return [];

  const runRes = await fetch(`${API_BASE}/runs/${lastRunId}`, {
    headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` },
  });
  if (!runRes.ok) {
    throw new Error(`Botster run download failed: ${runRes.status}`);
  }

  const data = await runRes.json();
  return extractRawReviews(data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req.headers.get("authorization"));

    const body = (await req.json().catch(() => ({}))) as ImportBody;
    const db = createAdminClient();

    let configQuery = db
      .from("scraping_configs")
      .select("id, location_id, platform, status, bot_id, initial_scrape_done, locations!inner(business_id)");

    if (body.config_id) {
      configQuery = configQuery.eq("id", body.config_id);
    } else {
      if (!body.location_id || !body.platform) {
        return new Response(
          JSON.stringify({ error: "Provide config_id OR location_id + platform" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      configQuery = configQuery.eq("location_id", body.location_id).eq("platform", body.platform);
    }

    const { data: config, error: configErr } = await configQuery.single();
    if (configErr || !config) {
      return new Response(
        JSON.stringify({ error: "Scraping config not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let rawResults: Record<string, unknown>[] = [];
    if (body.raw_reviews != null) {
      rawResults = extractRawReviews(body.raw_reviews);
    } else if (body.job_id) {
      rawResults = await fetchJobResults(body.job_id);
    } else if (config.bot_id) {
      rawResults = await fetchJobResults(String(config.bot_id));
    } else {
      return new Response(
        JSON.stringify({ error: "Provide raw_reviews, job_id, or ensure config has bot_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ingest = await ingestRawReviews(
      db,
      config as {
        id: string;
        location_id: string;
        platform: string;
        locations: { business_id: string };
      },
      rawResults,
    );

    const updateData: Record<string, unknown> = {
      status: "completed",
      last_scraped_at: new Date().toISOString(),
      last_error: null,
    };

    if (body.job_id) {
      updateData.bot_id = body.job_id;
    }

    if (!config.initial_scrape_done && ingest.parsed_count > 0) {
      updateData.initial_scrape_done = true;
    }

    await db
      .from("scraping_configs")
      .update(updateData)
      .eq("id", config.id);

    let analysisTriggered = false;
    let analysisResult: unknown = null;
    let analysisError: string | null = null;

    if (body.trigger_analysis !== false) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const analysisRes = await fetch(`${supabaseUrl}/functions/v1/analysis-submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
        body: JSON.stringify({ reason: "scraping-import" }),
      });

      analysisTriggered = analysisRes.ok;
      const payload = await analysisRes.json().catch(() => null);
      if (analysisRes.ok) {
        analysisResult = payload;
      } else {
        analysisError = payload?.error ?? `analysis-submit failed: ${analysisRes.status}`;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        config_id: config.id,
        platform: config.platform,
        location_id: config.location_id,
        parsed_reviews: ingest.parsed_count,
        inserted_reviews: ingest.inserted_count,
        analysis_triggered: analysisTriggered,
        analysis_result: analysisResult,
        analysis_error: analysisError,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = message.includes("Admin access") || message.includes("token") ? 403 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
