import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { ingestRawReviews } from "../_shared/scraping-ingest.ts";

const BOTSTER_API_KEY = Deno.env.get("BOTSTER_API_KEY")!;
const API_BASE = "https://botster.io/api/v2";

// -- Main handler --

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createAdminClient();
  const results: { config_id: string; status: string; reviews_stored?: number }[] = [];

  try {
    // Find all configs currently being processed
    const { data: activeConfigs, error: queryErr } = await db
      .from("scraping_configs")
      .select("*, locations!inner(business_id)")
      .in("status", ["elaborating", "checking"]);

    if (queryErr) throw queryErr;
    if (!activeConfigs || activeConfigs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active scraping jobs", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    for (const config of activeConfigs) {
      try {
        // Check Botster job status
        const jobRes = await fetch(`${API_BASE}/jobs/${config.bot_id}`, {
          headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` },
        });

        if (!jobRes.ok) {
          await db
            .from("scraping_configs")
            .update({
              status: "failed",
              last_error: `Botster status check failed: ${jobRes.status}`,
              retry_count: config.retry_count + 1,
            })
            .eq("id", config.id);
          results.push({ config_id: config.id, status: "api_error" });
          continue;
        }

        const jobData = await jobRes.json();
        const jobState = jobData.job?.state ?? jobData.state;

        if (jobState === "running" || jobState === "queued") {
          results.push({ config_id: config.id, status: "still_running" });
          continue;
        }

        if (jobState === "failed" || jobState === "error") {
          await db
            .from("scraping_configs")
            .update({
              status: "failed",
              last_error: `Botster job failed: ${jobState}`,
              retry_count: config.retry_count + 1,
            })
            .eq("id", config.id);
          results.push({ config_id: config.id, status: "job_failed" });
          continue;
        }

        // Job completed — fetch results
        const runs = jobData.job?.runs ?? [];
        if (runs.length === 0) {
          await db
            .from("scraping_configs")
            .update({ status: "completed", last_scraped_at: new Date().toISOString() })
            .eq("id", config.id);
          results.push({ config_id: config.id, status: "completed_no_runs" });
          continue;
        }

        const lastRunId = runs[runs.length - 1].id;
        const runRes = await fetch(`${API_BASE}/runs/${lastRunId}`, {
          headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` },
        });

        if (!runRes.ok) {
          await db
            .from("scraping_configs")
            .update({
              status: "failed",
              last_error: `Failed to fetch run results: ${runRes.status}`,
            })
            .eq("id", config.id);
          results.push({ config_id: config.id, status: "results_fetch_error" });
          continue;
        }

        const rawResults: Record<string, unknown>[] = await runRes.json();
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

        // Update scraping config
        const updateData: Record<string, unknown> = {
          status: "completed",
          last_scraped_at: new Date().toISOString(),
          last_error: null,
        };

        // Mark initial scrape as done only if the run returned at least one raw item.
        // This keeps first-run backfill retryable when providers return empty datasets.
        if (!config.initial_scrape_done && ingest.parsed_count > 0) {
          updateData.initial_scrape_done = true;
        }

        await db
          .from("scraping_configs")
          .update(updateData)
          .eq("id", config.id);

        results.push({
          config_id: config.id,
          status: "completed",
          reviews_stored: ingest.inserted_count,
        });
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        await db
          .from("scraping_configs")
          .update({
            status: "failed",
            last_error: msg,
            retry_count: config.retry_count + 1,
          })
          .eq("id", config.id);
        results.push({ config_id: config.id, status: `error: ${msg}` });
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
