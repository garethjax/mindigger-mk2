import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

/**
 * analysis-poll — pg_cron every minute
 *
 * 1. Query ai_batches with status='in_progress' and batch_type='reviews'
 * 2. Check batch status with provider API
 * 3. If completed: download results, process each review
 * 4. Create topics + topic_scores, update reviews, track tokens
 */

const OPENAI_API = "https://api.openai.com/v1";

function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createAdminClient();
  const results: { batch_id: string; status: string; processed?: number }[] = [];

  try {
    const body = await req.json().catch(() => ({})) as { batch_id?: string };

    // Get in-progress review batches
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

        // Check batch status with OpenAI
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

        // Map OpenAI status to our status
        if (batchStatus === "in_progress" || batchStatus === "validating" || batchStatus === "finalizing") {
          results.push({ batch_id: batch.id, status: "still_processing" });
          continue;
        }

        if (batchStatus === "failed" || batchStatus === "expired" || batchStatus === "cancelled") {
          await db
            .from("ai_batches")
            .update({ status: batchStatus === "cancelled" ? "cancelled" : "failed" })
            .eq("id", batch.id);

          // Mark reviews as failed
          // We need to find reviews that were batched for this batch
          // Since we don't have a direct FK, use batched_at timestamp range
          results.push({ batch_id: batch.id, status: batchStatus });
          continue;
        }

        if (batchStatus !== "completed") {
          results.push({ batch_id: batch.id, status: batchStatus });
          continue;
        }

        // Batch completed — download results
        const outputFileId = statusData.output_file_id;
        if (!outputFileId) {
          await db.from("ai_batches").update({ status: "failed" }).eq("id", batch.id);
          results.push({ batch_id: batch.id, status: "no_output_file" });
          continue;
        }

        const fileRes = await fetch(
          `${OPENAI_API}/files/${outputFileId}/content`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);

        const fileText = await fileRes.text();
        const lines = fileText.trim().split("\n");

        let processed = 0;
        let errors = 0;

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const reviewId = parsed.custom_id as string;
            const response = parsed.response;

            if (response?.status_code !== 200) {
              await db.from("reviews").update({ status: "failed" }).eq("id", reviewId);
              errors++;
              continue;
            }

            const body = response.body;
            const content = body?.choices?.[0]?.message?.content;
            const usage = body?.usage;

            const aiResult = JSON.parse(content);

            // Get review's business_id and location_id for topic_scores
            const { data: review } = await db
              .from("reviews")
              .select("business_id, location_id")
              .eq("id", reviewId)
              .single();

            if (!review) {
              errors++;
              continue;
            }

            // Update review
            const updateData: Record<string, unknown> = {
              ai_result: aiResult,
              status: "completed",
            };

            if (aiResult.italian_translation) {
              if (aiResult.italian_translation.italian_title) {
                updateData.title = sanitize(aiResult.italian_translation.italian_title);
              }
              if (aiResult.italian_translation.italian_text) {
                updateData.text = sanitize(aiResult.italian_translation.italian_text);
              }
            }

            await db.from("reviews").update(updateData).eq("id", reviewId);

            // Delete old topic_scores for this review
            await db.from("topic_scores").delete().eq("review_id", reviewId);

            // Create topics + topic_scores
            for (const topicData of aiResult.italian_topics ?? []) {
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
                  business_id: review.business_id,
                  location_id: review.location_id,
                });
              }
            }

            // Track token usage
            if (usage && review.business_id) {
              await trackTokenUsage(db, review.business_id, batch.provider, "reviews", usage);
            }

            processed++;
          } catch {
            errors++;
          }
        }

        // Update batch status
        await db
          .from("ai_batches")
          .update({ status: "completed" })
          .eq("id", batch.id);

        results.push({
          batch_id: batch.id,
          status: "completed",
          processed,
        });
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
