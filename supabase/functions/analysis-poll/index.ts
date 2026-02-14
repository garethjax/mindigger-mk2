import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

/**
 * analysis-poll — pg_cron every minute
 *
 * Processes OpenAI batch results in chunks, using bulk DB operations:
 * - 1 bulk SELECT for review metadata
 * - 1 bulk DELETE for old topic_scores
 * - 1 pre-loaded topic cache
 * - 1 bulk INSERT for new topic_scores
 * - Parallel review UPDATEs in micro-batches
 * - Aggregated token usage (1 upsert per business)
 *
 * Progress saved in metadata.processed_offset between invocations.
 */

const OPENAI_API = "https://api.openai.com/v1";
const CHUNK_SIZE = 200;
const UPDATE_CONCURRENCY = 20;
const IN_CLAUSE_LIMIT = 100; // PostgREST URL length limit — max UUIDs per .in() call

function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createAdminClient();
  const results: { batch_id: string; status: string; processed?: number; total?: number; remaining?: number }[] = [];

  try {
    const body = await req.json().catch(() => ({})) as { batch_id?: string };

    let batchQuery = db
      .from("ai_batches")
      .select("*")
      .eq("status", "in_progress")
      .eq("batch_type", "reviews");

    if (body.batch_id) {
      batchQuery = batchQuery.eq("id", body.batch_id);
    }

    const { data: batches, error: batchErr } = await batchQuery;

    if (batchErr) throw batchErr;
    if (!batches || batches.length === 0) {
      return new Response(
        JSON.stringify({ message: "No in-progress batches", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    for (const batch of batches) {
      try {
        const apiKey = Deno.env.get("OPENAI_API_KEY");
        if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

        const metadata = (batch.metadata ?? {}) as Record<string, unknown>;
        const savedOutputFileId = metadata.output_file_id as string | undefined;
        const offset = (metadata.processed_offset as number) ?? 0;

        // If we already have output_file_id in metadata, skip OpenAI status check
        let outputFileId = savedOutputFileId;

        if (!outputFileId) {
          const statusRes = await fetch(
            `${OPENAI_API}/batches/${batch.external_batch_id}`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          );

          if (!statusRes.ok) {
            results.push({ batch_id: batch.id, status: "api_error" });
            continue;
          }

          const statusData = await statusRes.json();
          const batchStatus = statusData.status;

          if (batchStatus === "in_progress" || batchStatus === "validating" || batchStatus === "finalizing") {
            results.push({ batch_id: batch.id, status: "still_processing" });
            continue;
          }

          if (batchStatus === "failed" || batchStatus === "expired" || batchStatus === "cancelled") {
            await db
              .from("ai_batches")
              .update({ status: batchStatus === "cancelled" ? "cancelled" : "failed" })
              .eq("id", batch.id);
            results.push({ batch_id: batch.id, status: batchStatus });
            continue;
          }

          if (batchStatus !== "completed") {
            results.push({ batch_id: batch.id, status: batchStatus });
            continue;
          }

          outputFileId = statusData.output_file_id;
          if (!outputFileId) {
            await db.from("ai_batches").update({ status: "failed" }).eq("id", batch.id);
            results.push({ batch_id: batch.id, status: "no_output_file" });
            continue;
          }
        }

        // Download output file
        const fileRes = await fetch(
          `${OPENAI_API}/files/${outputFileId}/content`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);

        const fileText = await fileRes.text();
        const lines = fileText.trim().split("\n");
        const totalLines = lines.length;
        const chunk = lines.slice(offset, offset + CHUNK_SIZE);

        // --- Phase 1: Parse all JSONL lines, collect reviewIds ---
        type ParsedLine = {
          reviewId: string;
          aiResult: Record<string, unknown>;
          usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
        };
        const parsed: ParsedLine[] = [];
        const failedIds: string[] = [];

        for (const line of chunk) {
          try {
            const obj = JSON.parse(line);
            const reviewId = obj.custom_id as string;
            const response = obj.response;

            if (response?.status_code !== 200) {
              failedIds.push(reviewId);
              continue;
            }

            const content = response.body?.choices?.[0]?.message?.content;
            const usage = response.body?.usage ?? null;
            const aiResult = JSON.parse(content);
            parsed.push({ reviewId, aiResult, usage });
          } catch {
            // unparseable line — skip
          }
        }

        const reviewIds = parsed.map((p) => p.reviewId);

        // --- Phase 2: Bulk mark failed reviews (chunked for PostgREST URL limit) ---
        for (let i = 0; i < failedIds.length; i += IN_CLAUSE_LIMIT) {
          await db.from("reviews").update({ status: "failed" }).in("id", failedIds.slice(i, i + IN_CLAUSE_LIMIT));
        }

        // --- Phase 3: Bulk fetch review metadata (chunked) ---
        const reviewMap = new Map<string, { business_id: string; location_id: string }>();
        for (let i = 0; i < reviewIds.length; i += IN_CLAUSE_LIMIT) {
          const { data: reviewRows } = await db
            .from("reviews")
            .select("id, business_id, location_id")
            .in("id", reviewIds.slice(i, i + IN_CLAUSE_LIMIT));

          for (const r of reviewRows ?? []) {
            reviewMap.set(r.id, { business_id: r.business_id, location_id: r.location_id });
          }
        }

        // --- Phase 4: Bulk delete old topic_scores (chunked) ---
        for (let i = 0; i < reviewIds.length; i += IN_CLAUSE_LIMIT) {
          await db.from("topic_scores").delete().in("review_id", reviewIds.slice(i, i + IN_CLAUSE_LIMIT));
        }

        // --- Phase 5: Pre-load topic + category caches ---
        const topicCache = new Map<string, string>();
        {
          const { data: existingTopics } = await db.from("topics").select("id, name");
          for (const t of existingTopics ?? []) {
            topicCache.set(t.name, t.id);
          }
        }

        // Category cache scoped to the batch's business_sector
        const categoryCache = new Map<string, string>(); // UPPERCASE name → id
        {
          const batchLocationId = metadata.location_id as string | undefined;
          let sectorId: string | null = null;
          if (batchLocationId) {
            const { data: loc } = await db
              .from("locations")
              .select("business_sector_id")
              .eq("id", batchLocationId)
              .maybeSingle();
            sectorId = loc?.business_sector_id ?? null;
          }
          let catQuery = db.from("categories").select("id, name");
          if (sectorId) {
            catQuery = catQuery.eq("business_sector_id", sectorId);
          }
          const { data: existingCategories } = await catQuery;
          for (const c of existingCategories ?? []) {
            categoryCache.set(c.name.toUpperCase(), c.id);
          }
        }

        // --- Phase 6: Process reviews — prepare updates + topic_scores ---
        let processed = 0;
        const allTopicScores: {
          review_id: string;
          topic_id: string;
          score: number;
          business_id: string;
          location_id: string;
        }[] = [];
        const allReviewCategories: { review_id: string; category_id: string }[] = [];
        const reviewCategorySeen = new Set<string>(); // dedup "reviewId:categoryId"
        const usageAgg = new Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>();

        // Collect all review update operations
        const updateOps: (() => Promise<void>)[] = [];

        for (const { reviewId, aiResult, usage } of parsed) {
          const review = reviewMap.get(reviewId);
          if (!review) continue;

          // Prepare review update
          const updateData: Record<string, unknown> = {
            ai_result: aiResult,
            status: "completed",
          };

          if (aiResult.italian_translation) {
            const translation = aiResult.italian_translation as Record<string, string>;
            if (translation.italian_title) {
              updateData.title = sanitize(translation.italian_title);
            }
            if (translation.italian_text) {
              updateData.text = sanitize(translation.italian_text);
            }
          }

          updateOps.push(async () => {
            await db.from("reviews").update(updateData).eq("id", reviewId);
          });

          // Collect topic_scores + review_categories (resolve IDs from caches)
          const topics = (aiResult.italian_topics ?? []) as { italian_name: string; score: number; italian_category?: { name: string } }[];
          for (const topicData of topics) {
            const topicName = sanitize(topicData.italian_name).toUpperCase();
            if (!topicName) continue;

            let topicId = topicCache.get(topicName);

            if (!topicId) {
              // Create missing topic — sequential to avoid race conditions
              const { data: newTopic } = await db
                .from("topics")
                .insert({ name: topicName })
                .select("id")
                .single();

              if (newTopic) {
                topicCache.set(topicName, newTopic.id);
                topicId = newTopic.id;
              }
            }

            if (topicId) {
              allTopicScores.push({
                review_id: reviewId,
                topic_id: topicId,
                score: topicData.score,
                business_id: review.business_id,
                location_id: review.location_id,
              });
            }

            // Collect review_category (match AI category name to DB)
            const catName = topicData.italian_category?.name?.toUpperCase();
            if (catName) {
              const catId = categoryCache.get(catName);
              if (catId) {
                const key = `${reviewId}:${catId}`;
                if (!reviewCategorySeen.has(key)) {
                  reviewCategorySeen.add(key);
                  allReviewCategories.push({ review_id: reviewId, category_id: catId });
                }
              }
            }
          }

          // Aggregate token usage
          if (usage && review.business_id) {
            const prev = usageAgg.get(review.business_id) ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            prev.prompt_tokens += usage.prompt_tokens ?? 0;
            prev.completion_tokens += usage.completion_tokens ?? 0;
            prev.total_tokens += usage.total_tokens ?? 0;
            usageAgg.set(review.business_id, prev);
          }

          processed++;
        }

        // --- Phase 7: Execute review UPDATEs in parallel micro-batches ---
        for (let i = 0; i < updateOps.length; i += UPDATE_CONCURRENCY) {
          await Promise.all(updateOps.slice(i, i + UPDATE_CONCURRENCY).map((fn) => fn()));
        }

        // --- Phase 8: Bulk INSERT topic_scores ---
        if (allTopicScores.length > 0) {
          // PostgREST supports bulk insert; split in batches of 1000 to stay safe
          for (let i = 0; i < allTopicScores.length; i += 1000) {
            const batch_slice = allTopicScores.slice(i, i + 1000);
            await db.from("topic_scores").insert(batch_slice);
          }
        }

        // --- Phase 8b: Bulk delete + insert review_categories ---
        if (reviewIds.length > 0) {
          for (let i = 0; i < reviewIds.length; i += IN_CLAUSE_LIMIT) {
            await db.from("review_categories").delete().in("review_id", reviewIds.slice(i, i + IN_CLAUSE_LIMIT));
          }
        }
        if (allReviewCategories.length > 0) {
          for (let i = 0; i < allReviewCategories.length; i += 1000) {
            await db.from("review_categories").insert(allReviewCategories.slice(i, i + 1000));
          }
        }

        // --- Phase 9: Flush aggregated token usage ---
        for (const [businessId, usage] of usageAgg) {
          await trackTokenUsage(db, businessId, batch.provider, "reviews", usage);
        }

        // --- Phase 10: Save progress ---
        const newOffset = offset + chunk.length;
        const allDone = newOffset >= totalLines;

        if (allDone) {
          await db
            .from("ai_batches")
            .update({
              status: "completed",
              metadata: { ...metadata, processed_offset: newOffset, output_file_id: outputFileId },
            })
            .eq("id", batch.id);

          results.push({ batch_id: batch.id, status: "completed", processed, total: totalLines });
        } else {
          await db
            .from("ai_batches")
            .update({
              metadata: { ...metadata, processed_offset: newOffset, output_file_id: outputFileId },
            })
            .eq("id", batch.id);

          results.push({
            batch_id: batch.id,
            status: "chunked",
            processed,
            total: totalLines,
            remaining: totalLines - newOffset,
          });
        }
      } catch (innerErr) {
        await db
          .from("ai_batches")
          .update({ status: "failed" })
          .eq("id", batch.id);
        results.push({
          batch_id: batch.id,
          status: `error: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
        });
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function trackTokenUsage(
  db: ReturnType<typeof createAdminClient>,
  businessId: string,
  provider: string,
  batchType: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await db
    .from("token_usage")
    .select("id, prompt_tokens, completion_tokens, total_tokens")
    .eq("business_id", businessId)
    .eq("provider", provider)
    .eq("batch_type", batchType)
    .eq("date", today)
    .maybeSingle();

  if (existing) {
    await db
      .from("token_usage")
      .update({
        prompt_tokens: existing.prompt_tokens + usage.prompt_tokens,
        completion_tokens: existing.completion_tokens + usage.completion_tokens,
        total_tokens: existing.total_tokens + usage.total_tokens,
      })
      .eq("id", existing.id);
  } else {
    await db.from("token_usage").insert({
      business_id: businessId,
      provider,
      batch_type: batchType,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      date: today,
    });
  }
}
