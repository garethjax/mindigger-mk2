import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const BOTSTER_API_KEY = Deno.env.get("BOTSTER_API_KEY")!;
const API_BASE = "https://botster.io/api/v2";

// -- Field mappings (inlined to avoid cross-package Deno import issues) --

type FieldMap = Record<string, string[]>;

const FIELD_MAPS: Record<string, FieldMap> = {
  google_maps: {
    title: ["title", "review_title"],
    rating: ["rating"],
    author_name: ["profile_name", "author_name", "name"],
    review_text: ["text", "review_text", "content"],
    review_date: ["time", "reviewed_at", "review_date", "date"],
    review_url: ["review_url", "url"],
  },
  tripadvisor: {
    title: ["title"],
    rating: ["rating"],
    author_name: ["author_name"],
    review_text: ["review_text", "text"],
    review_date: ["review_date", "date", "reviewed_at"],
    review_url: ["url", "review_url"],
  },
  booking: {
    title: ["review_title", "title"],
    rating: ["review_score", "rating", "score"],
    author_name: ["guest_name", "author_name", "name"],
    review_text: ["review_text", "text"],
    review_date: ["review_date", "date", "reviewed_at"],
    review_url: ["hotel_url", "review_url", "url"],
  },
};

function getField(
  raw: Record<string, unknown>,
  platform: string,
  field: string,
  fallback: unknown = "",
): unknown {
  const candidates = FIELD_MAPS[platform]?.[field];
  if (!candidates) return fallback;
  for (const key of candidates) {
    const val = raw[key];
    if (val != null && val !== "") return val;
  }
  return fallback;
}

function sanitize(value: unknown): string {
  if (value == null) return "";
  return (typeof value === "string" ? value : String(value)).replace(/\0/g, "");
}

function parseDate(raw: string | null, bookingFmt = false): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  if (bookingFmt) {
    const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }

  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const mMatch = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (mMatch) {
    const mm = months[mMatch[1].toLowerCase()];
    if (mm) return `${mMatch[3]}-${mm}-${mMatch[2].padStart(2, "0")}`;
  }

  const num = Number(s);
  if (!isNaN(num) && num > 1e9 && num < 1e11) {
    return new Date(num * 1000).toISOString().slice(0, 10);
  }

  return null;
}

function alignRating(rating: number): number {
  if (rating <= 1) return Math.floor(rating);
  return Math.floor(rating / 2);
}

async function md5hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
        const platform = config.platform as string;
        const businessId = (config.locations as { business_id: string }).business_id;
        const isBooking = platform === "booking";

        // Parse raw results
        const parsed: {
          title: string;
          rating: number;
          author: string;
          text: string;
          review_date: string | null;
          url: string;
          raw_data: Record<string, unknown>;
          hash: string;
        }[] = [];

        for (const raw of rawResults) {
          if (!raw || Object.keys(raw).length === 0) continue;

          const title = sanitize(getField(raw, platform, "title", ""));
          let rating = Number(getField(raw, platform, "rating", 1)) || 1;
          const author = sanitize(getField(raw, platform, "author_name", "")).slice(0, 50);
          let text = sanitize(getField(raw, platform, "review_text", ""));
          const dateRaw = String(getField(raw, platform, "review_date", "") ?? "");
          const url = sanitize(getField(raw, platform, "review_url", "")).slice(0, 255);

          // Booking: combine positive/negative, convert rating
          if (isBooking) {
            const pos = sanitize(raw.review_positives);
            const neg = sanitize(raw.review_negatives);
            if (pos || neg) {
              text = pos && neg ? `${pos} ${neg}` : pos || neg;
            }
            rating = alignRating(rating);
          }

          if (rating < 1) rating = 1;
          const reviewDate = parseDate(dateRaw, isBooking);

          // Sanitize raw_data
          const sanitizedRaw: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(raw)) {
            sanitizedRaw[k] = typeof v === "string" ? sanitize(v) : v;
          }

          // Compute MD5 hash (sorted keys, matching legacy structure)
          const hashInput = JSON.stringify(
            {
              author_name: author,
              business_id: businessId,
              location_id: config.location_id,
              rating,
              review_date: reviewDate,
              review_text: text,
              review_url: url,
              source: platform,
              title,
            },
            [
              "author_name", "business_id", "location_id", "rating",
              "review_date", "review_text", "review_url", "source", "title",
            ],
          );
          const hash = await md5hex(hashInput);

          parsed.push({
            title,
            rating,
            author,
            text,
            review_date: reviewDate,
            url,
            raw_data: sanitizedRaw,
            hash,
          });
        }

        // Dedup: check existing hashes in DB
        const allHashes = parsed.map((r) => r.hash);
        const { data: existingRows } = await db
          .from("reviews")
          .select("review_hash")
          .in("review_hash", allHashes);

        const existingHashes = new Set(
          (existingRows ?? []).map((r: { review_hash: string }) => r.review_hash),
        );

        // Filter out duplicates (DB + in-batch)
        const seenInBatch = new Set<string>();
        const toInsert: Record<string, unknown>[] = [];

        for (const r of parsed) {
          if (existingHashes.has(r.hash) || seenInBatch.has(r.hash)) continue;
          seenInBatch.add(r.hash);

          toInsert.push({
            location_id: config.location_id,
            business_id: businessId,
            source: platform,
            title: r.title,
            text: r.text,
            url: r.url || null,
            rating: r.rating,
            author: r.author,
            review_date: r.review_date || new Date().toISOString().slice(0, 10),
            review_hash: r.hash,
            raw_data: r.raw_data,
            status: "pending",
          });
        }

        // Bulk insert
        if (toInsert.length > 0) {
          // Insert in chunks of 500 to avoid payload limits
          for (let i = 0; i < toInsert.length; i += 500) {
            const chunk = toInsert.slice(i, i + 500);
            const { error: insertErr } = await db.from("reviews").insert(chunk);
            if (insertErr) throw insertErr;
          }
        }

        // Update scraping config
        const updateData: Record<string, unknown> = {
          status: "completed",
          last_scraped_at: new Date().toISOString(),
          last_error: null,
        };

        // Set initial_scrape_done on first successful run
        if (!config.initial_scrape_done) {
          updateData.initial_scrape_done = true;
        }

        await db
          .from("scraping_configs")
          .update(updateData)
          .eq("id", config.id);

        results.push({
          config_id: config.id,
          status: "completed",
          reviews_stored: toInsert.length,
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
