import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalOrAdmin } from "../_shared/supabase.ts";

const BOTSTER_API_KEY = Deno.env.get("BOTSTER_API_KEY")!;
const API_BASE = "https://botster.io/api/v2";
const DAYS_THRESHOLD = 14;
const REQUEST_DELAY = 1000;
const BATCH_DELAY = 3000;
const BATCH_SIZE = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cleanup old Botster jobs to avoid daily storage charges.
 * Called weekly by pg_cron (Sunday 03:00).
 *
 * Archives completed/failed jobs older than 14 days.
 * Rate-limited: batches of 10, 1s between requests, 3s between batches.
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

  const cutoffMs = Date.now() - DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
  let archived = 0;
  let errors = 0;
  let totalScanned = 0;

  try {
    await requireInternalOrAdmin(
      req.headers.get("authorization"),
      req.headers.get("x-internal-secret"),
    );

    // Paginate through all Botster jobs
    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `${API_BASE}/jobs?page=${page}&per=${perPage}`,
        { headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` } },
      );

      if (!res.ok) {
        throw new Error(`Failed to list jobs: ${res.status}`);
      }

      const data = await res.json();
      const jobs = data.jobs ?? [];
      totalScanned += jobs.length;

      // Filter: completed/failed + older than threshold
      const toArchive = jobs.filter((job: Record<string, unknown>) => {
        const finished = job.finished === true;
        const state = job.state as string;
        if (!finished && state !== "completed" && state !== "failed") return false;

        const createdAt = job.created_at as number;
        // Botster uses Unix seconds; handle both seconds and milliseconds
        const createdMs = createdAt < 1e12 ? createdAt * 1000 : createdAt;
        return createdMs < cutoffMs;
      });

      // Archive in batches with rate limiting
      for (let i = 0; i < toArchive.length; i += BATCH_SIZE) {
        const batch = toArchive.slice(i, i + BATCH_SIZE);

        for (const job of batch) {
          try {
            const archRes = await fetch(
              `${API_BASE}/jobs/${job.id}/archive`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${BOTSTER_API_KEY}` },
              },
            );
            if (archRes.ok) {
              archived++;
            } else {
              errors++;
            }
          } catch {
            errors++;
          }
          await sleep(REQUEST_DELAY);
        }

        // Pause between batches
        if (i + BATCH_SIZE < toArchive.length) {
          await sleep(BATCH_DELAY);
        }
      }

      // Check if there are more pages
      if (jobs.length < perPage) {
        hasMore = false;
      } else {
        page++;
        await sleep(REQUEST_DELAY);
      }
    }

    return new Response(
      JSON.stringify({
        scanned: totalScanned,
        archived,
        errors,
        threshold_days: DAYS_THRESHOLD,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const status = /authorization|token|access required|forbidden|unauthorized/i.test(message) ? 403 : 500;
    return new Response(
      JSON.stringify({
        error: message,
        archived,
        errors,
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
