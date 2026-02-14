import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

/**
 * analysis-submit — pg_cron every minute
 *
 * 1. Query reviews with status='pending' (+ stale 'analyzing' > 24h)
 * 2. Handle empty reviews (mark completed, assign "Senza Commenti")
 * 3. Group by business_sector
 * 4. Load active AI config (provider + mode)
 * 5. Batch mode → build JSONL, submit to provider
 * 6. Direct mode → call provider directly, save results immediately
 */

const BATCH_LIMIT = 20_000;
const STALE_HOURS = 24;
const CLAIM_CHUNK_SIZE = 500;

// Inline provider logic to avoid cross-package import issues in Deno Edge Functions
const OPENAI_API = "https://api.openai.com/v1";

function buildSystemPrompt(sectorName: string, categoryNames: string[]): string {
  const categoryList = categoryNames
    .map((c) => `"${c.toUpperCase().replace(/ /g, "_")}"`)
    .join(", ");

  return `You are an expert text analyzer for reviews about ${sectorName} sector.
Analyze the review and extract the following information in valid JSON format.

Rules:
1. italian_categories: Select up to 5 most relevant categories from the list provided. Do not invent new categories.
2. italian_topics: Generate up to 5 most relevant topics. Each italian_topic should have only one relation with one of categories from the list provided.
3. For each italian_topic, provide a satisfaction score from 1 to 5 (1 = strong dissatisfaction/problem, 5 = strong satisfaction/praise)
4. If the review is not in Italian, you MUST provide the 'italian_translation' field.
5. If the review title is not present, you MUST generate a title in Italian for the review.

Available categories: [${categoryList}]`;
}

const REVIEW_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "review_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        italian_topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              italian_name: { type: "string" },
              score: { type: "integer", minimum: 1, maximum: 5 },
              italian_category: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
                additionalProperties: false,
              },
            },
            required: ["italian_name", "score", "italian_category"],
            additionalProperties: false,
          },
        },
        sentiment: { type: "integer", minimum: 1, maximum: 5 },
        language: { type: "string" },
        italian_translation: {
          type: ["object", "null"],
          properties: {
            italian_title: { type: "string" },
            italian_text: { type: "string" },
          },
          required: ["italian_title", "italian_text"],
          additionalProperties: false,
        },
      },
      required: ["italian_topics", "sentiment", "language", "italian_translation"],
      additionalProperties: false,
    },
  },
};

function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createAdminClient();

  try {
    const body = await req.json().catch(() => ({})) as { location_id?: string };
    const targetLocationId = body.location_id?.trim() || null;

    if (targetLocationId) {
      await requireAdmin(req.headers.get("authorization"));
    }

    // Get active AI config
    const { data: aiConfig, error: configErr } = await db
      .from("ai_configs")
      .select("*")
      .eq("is_active", true)
      .single();

    if (configErr || !aiConfig) {
      return new Response(
        JSON.stringify({ error: "No active AI config" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Safety guard: avoid duplicate submissions while previous review batches are still running.
    let activeBatchQuery = db
      .from("ai_batches")
      .select("id", { count: "exact", head: true })
      .eq("batch_type", "reviews")
      .eq("status", "in_progress");

    if (targetLocationId) {
      activeBatchQuery = activeBatchQuery.contains("metadata", { location_id: targetLocationId });
    }

    const { count: activeReviewBatches, error: activeBatchErr } = await activeBatchQuery;

    if (activeBatchErr) throw activeBatchErr;
    if ((activeReviewBatches ?? 0) > 0) {
      return new Response(
        JSON.stringify({
          message: targetLocationId
            ? "Review analysis already in progress for this location"
            : "Review analysis already in progress",
          active_batches: activeReviewBatches,
          location_id: targetLocationId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (aiConfig.provider === "openai" && !apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Query pending reviews (+ stale analyzing)
    const staleThreshold = new Date(
      Date.now() - STALE_HOURS * 60 * 60 * 1000,
    ).toISOString();

    let reviewQuery = db
      .from("reviews")
      .select(`
        id, title, text, location_id, business_id,
        locations!inner(
          business_sector_id,
          business_sectors:business_sector_id(id, name)
        )
      `)
      .or(`status.eq.pending,and(status.eq.analyzing,batched_at.lt.${staleThreshold})`);

    if (targetLocationId) {
      reviewQuery = reviewQuery.eq("location_id", targetLocationId);
    }

    const { data: reviews, error: reviewErr } = await reviewQuery.limit(BATCH_LIMIT);

    if (reviewErr) throw reviewErr;
    if (!reviews || reviews.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending reviews" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Handle empty reviews: mark completed with "Senza Commenti"
    const emptyReviews = reviews.filter(
      (r) => (!r.title || !r.title.trim()) && (!r.text || !r.text.trim()),
    );
    const validReviews = reviews.filter(
      (r) => (r.title && r.title.trim()) || (r.text && r.text.trim()),
    );

    if (emptyReviews.length > 0) {
      const emptyIds = emptyReviews.map((r) => r.id);
      await db
        .from("reviews")
        .update({
          status: "completed",
          text: "Nessun commento.",
          ai_result: {
            italian_topics: [],
            sentiment: 3,
            language: "it",
          },
        })
        .in("id", emptyIds);
    }

    if (validReviews.length === 0) {
      return new Response(
        JSON.stringify({
          message: "Only empty reviews found",
          empty_completed: emptyReviews.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Group by business_sector
    const bySector = new Map<
      string,
      { sectorName: string; reviews: typeof validReviews }
    >();

    for (const review of validReviews) {
      const loc = review.locations as {
        business_sector_id: string;
        business_sectors: { id: string; name: string };
      };
      const sectorId = loc.business_sector_id;
      const sectorName = loc.business_sectors.name;

      if (!bySector.has(sectorId)) {
        bySector.set(sectorId, { sectorName, reviews: [] });
      }
      bySector.get(sectorId)!.reviews.push(review);
    }

    // Fetch categories per sector
    const sectorIds = [...bySector.keys()];
    const { data: categories } = await db
      .from("categories")
      .select("id, name, business_sector_id")
      .in("business_sector_id", sectorIds);

    const categoriesBySector = new Map<string, string[]>();
    for (const cat of categories ?? []) {
      if (!categoriesBySector.has(cat.business_sector_id)) {
        categoriesBySector.set(cat.business_sector_id, []);
      }
      categoriesBySector.get(cat.business_sector_id)!.push(cat.name);
    }

    const model = aiConfig.model || "gpt-4.1";
    const temperature = (aiConfig.config as Record<string, unknown>)?.temperature ?? 0.1;
    const mode = aiConfig.mode; // "batch" | "direct"

    let totalSubmitted = 0;
    const batchIds: string[] = [];

    for (const [sectorId, group] of bySector) {
      const catNames = categoriesBySector.get(sectorId) ?? [];
      const systemPrompt = buildSystemPrompt(group.sectorName, catNames);

      if (mode === "batch" && aiConfig.provider === "openai") {
        // Build JSONL
        const lines: string[] = [];
        for (const review of group.reviews) {
          const line = {
            custom_id: review.id,
            method: "POST",
            url: "/v1/chat/completions",
            body: {
              model,
              temperature,
              top_p: 1,
              frequency_penalty: 0,
              presence_penalty: 0,
              response_format: REVIEW_SCHEMA,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `REVIEW: ${JSON.stringify({
                    title: sanitize(review.title),
                    text: sanitize(review.text),
                  })}`,
                },
              ],
            },
          };
          lines.push(JSON.stringify(line));
        }

        const jsonl = lines.join("\n") + "\n";

        // Upload file
        const blob = new Blob([jsonl], { type: "application/jsonl" });
        const form = new FormData();
        form.append("file", blob, "batch.jsonl");
        form.append("purpose", "batch");

        const uploadRes = await fetch(`${OPENAI_API}/files`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        if (!uploadRes.ok) throw new Error(`File upload failed: ${await uploadRes.text()}`);
        const fileData = await uploadRes.json();

        // Create batch
        const batchRes = await fetch(`${OPENAI_API}/batches`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input_file_id: fileData.id,
            endpoint: "/v1/chat/completions",
            completion_window: "24h",
            metadata: { batch_type: "REVIEWS", sector: sectorId },
          }),
        });
        if (!batchRes.ok) throw new Error(`Batch create failed: ${await batchRes.text()}`);
        const batchData = await batchRes.json();

        // Save batch tracking
        const locationIdForBatch = group.reviews[0]?.location_id ?? null;
        const businessIdForBatch = group.reviews[0]?.business_id ?? null;

        const { error: batchInsertErr } = await db.from("ai_batches").insert({
          external_batch_id: batchData.id,
          provider: aiConfig.provider,
          batch_type: "reviews",
          status: "in_progress",
          metadata: {
            sector_id: sectorId,
            review_count: group.reviews.length,
            location_id: locationIdForBatch,
            business_id: businessIdForBatch,
            scope: targetLocationId ? "location" : "global",
          },
        });
        if (batchInsertErr) throw batchInsertErr;

        batchIds.push(batchData.id);
        totalSubmitted += group.reviews.length;

        // Mark reviews as analyzing
        const reviewIds = group.reviews.map((r) => r.id);
        const batchedAt = new Date().toISOString();
        for (const ids of chunkArray(reviewIds, CLAIM_CHUNK_SIZE)) {
          const { error: claimErr } = await db
            .from("reviews")
            .update({ status: "analyzing", batched_at: batchedAt })
            .in("id", ids);
          if (claimErr) throw claimErr;
        }
      } else {
        // Direct mode — process one by one (or use batch of direct calls)
        // For now, process sequentially (can be parallelized later)
        for (const review of group.reviews) {
          try {
            const res = await fetch(`${OPENAI_API}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                temperature,
                top_p: 1,
                response_format: REVIEW_SCHEMA,
                messages: [
                  { role: "system", content: systemPrompt },
                  {
                    role: "user",
                    content: `REVIEW: ${JSON.stringify({
                      title: sanitize(review.title),
                      text: sanitize(review.text),
                    })}`,
                  },
                ],
              }),
            });

            if (!res.ok) {
              await db
                .from("reviews")
                .update({ status: "failed" })
                .eq("id", review.id);
              continue;
            }

            const data = await res.json();
            const content = data.choices?.[0]?.message?.content;
            const aiResult = JSON.parse(content);
            const usage = data.usage;

            // Update review with AI result
            const updateData: Record<string, unknown> = {
              ai_result: aiResult,
              status: "completed",
            };

            // Apply translation if provided
            if (aiResult.italian_translation) {
              if (aiResult.italian_translation.italian_title) {
                updateData.title = sanitize(aiResult.italian_translation.italian_title);
              }
              if (aiResult.italian_translation.italian_text) {
                updateData.text = sanitize(aiResult.italian_translation.italian_text);
              }
            }

            await db.from("reviews").update(updateData).eq("id", review.id);

            // Create topics + topic_scores
            await processTopics(db, review.id, review.business_id, review.location_id, aiResult);

            // Track token usage
            if (usage) {
              await trackTokenUsage(db, review.business_id, aiConfig.provider, "reviews", usage);
            }

            totalSubmitted++;
          } catch {
            await db.from("reviews").update({ status: "failed" }).eq("id", review.id);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        mode,
        submitted: totalSubmitted,
        empty_completed: emptyReviews.length,
        batches: batchIds,
        location_id: targetLocationId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/** Create/reuse topics and insert topic_scores from AI result. */
async function processTopics(
  db: ReturnType<typeof createAdminClient>,
  reviewId: string,
  businessId: string,
  locationId: string,
  aiResult: {
    italian_topics: { italian_name: string; score: number; italian_category: { name: string } }[];
  },
): Promise<void> {
  // Delete old scores for this review
  await db.from("topic_scores").delete().eq("review_id", reviewId);

  for (const topicData of aiResult.italian_topics) {
    const topicName = sanitize(topicData.italian_name).toUpperCase();
    if (!topicName) continue;

    // Find or create topic
    let { data: topic } = await db
      .from("topics")
      .select("id")
      .eq("name", topicName)
      .maybeSingle();

    if (!topic) {
      const { data: newTopic } = await db
        .from("topics")
        .insert({ name: topicName })
        .select("id")
        .single();
      topic = newTopic;
    }

    if (topic) {
      await db.from("topic_scores").insert({
        review_id: reviewId,
        topic_id: topic.id,
        score: topicData.score,
        business_id: businessId,
        location_id: locationId,
      });
    }
  }
}

/** Track token usage — upsert per business/provider/date/batch_type. */
async function trackTokenUsage(
  db: ReturnType<typeof createAdminClient>,
  businessId: string,
  provider: string,
  batchType: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Try to find existing record
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
