import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireInternalOrAdmin } from "../_shared/supabase.ts";
import { chunkArray } from "../_shared/batching.ts";

const OPENAI_API = "https://api.openai.com/v1";
const CHUNK_SIZE = 200;

type AiResult = {
  sentiment?: number;
  language?: string;
  italian_translation?: unknown;
  italian_topics?: { italian_name: string; score: number; italian_category: { name: string } }[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireInternalOrAdmin(
      req.headers.get("authorization"),
      req.headers.get("x-internal-secret"),
    );

    const db = createAdminClient();
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), { status: 500 });
    }

    // --- Find in-progress rescore batches ---
    const { data: batches, error: batchErr } = await db
      .from("ai_batches")
      .select("*")
      .eq("status", "in_progress")
      .eq("batch_type", "rescore");

    if (batchErr) {
      return new Response(JSON.stringify({ error: batchErr.message }), { status: 500 });
    }
    if (!batches || batches.length === 0) {
      return new Response(
        JSON.stringify({ message: "No in-progress rescore batches" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pre-load topic name → id cache
    const { data: allTopics } = await db.from("topics").select("id, name");
    const topicCache = new Map<string, string>();
    for (const t of allTopics ?? []) {
      topicCache.set(t.name.toUpperCase(), t.id);
    }

    const results: unknown[] = [];

    for (const batch of batches) {
      const batchId = batch.id as string;
      const metadata = (batch.metadata ?? {}) as Record<string, unknown>;

      // Optimistic lock
      const lockTime = metadata.processing_lock as string | undefined;
      if (lockTime && Date.now() - new Date(lockTime).getTime() < 5 * 60 * 1000) {
        results.push({ batch_id: batchId, status: "locked_by_other" });
        continue;
      }
      const { data: locked } = await db
        .from("ai_batches")
        .update({ metadata: { ...metadata, processing_lock: new Date().toISOString() } })
        .eq("id", batchId)
        .eq("status", "in_progress")
        .select("id");
      if (!locked || locked.length === 0) {
        results.push({ batch_id: batchId, status: "lock_failed" });
        continue;
      }

      // --- Check OpenAI batch status ---
      let outputFileId = metadata.output_file_id as string | undefined;
      if (!outputFileId) {
        const statusRes = await fetch(`${OPENAI_API}/batches/${batch.external_batch_id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const statusData = await statusRes.json() as {
          status: string;
          output_file_id?: string;
        };
        const batchStatus = statusData.status;

        if (["in_progress", "validating", "finalizing"].includes(batchStatus)) {
          await db.from("ai_batches")
            .update({ metadata: { ...metadata, processing_lock: null } })
            .eq("id", batchId);
          results.push({ batch_id: batchId, status: "still_processing" });
          continue;
        }
        if (["failed", "expired", "cancelled"].includes(batchStatus)) {
          await db.from("ai_batches")
            .update({ status: batchStatus === "cancelled" ? "cancelled" : "failed", metadata: { ...metadata, processing_lock: null } })
            .eq("id", batchId);
          results.push({ batch_id: batchId, status: batchStatus });
          continue;
        }

        outputFileId = statusData.output_file_id;
        if (!outputFileId) {
          await db.from("ai_batches")
            .update({ status: "failed", metadata: { ...metadata, processing_lock: null } })
            .eq("id", batchId);
          results.push({ batch_id: batchId, status: "no_output_file" });
          continue;
        }
      }

      // --- Download output JSONL ---
      const fileRes = await fetch(`${OPENAI_API}/files/${outputFileId}/content`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const fileText = await fileRes.text();
      const lines = fileText.trim().split("\n");
      const totalLines = lines.length;
      const offset = (metadata.processed_offset as number) ?? 0;
      const chunk = lines.slice(offset, offset + CHUNK_SIZE);

      // --- Parse chunk ---
      const parsed: { reviewId: string; scores: number[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } } }[] = [];
      const failedIds: string[] = [];

      for (const line of chunk) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line) as {
          custom_id: string;
          response: { status_code: number; body?: { choices?: { message?: { content?: string } }[]; usage?: unknown } };
        };
        const reviewId = obj.custom_id;
        const response = obj.response;
        if (response?.status_code !== 200) {
          failedIds.push(reviewId);
          continue;
        }
        const content = response.body?.choices?.[0]?.message?.content;
        if (!content) {
          failedIds.push(reviewId);
          continue;
        }
        let rescoreResult: { scores?: number[] };
        try {
          rescoreResult = JSON.parse(content);
        } catch {
          failedIds.push(reviewId);
          continue;
        }
        if (!Array.isArray(rescoreResult.scores)) {
          failedIds.push(reviewId);
          continue;
        }
        parsed.push({
          reviewId,
          scores: rescoreResult.scores,
          usage: response.body?.usage as typeof parsed[0]["usage"],
        });
      }

      // --- Fetch current ai_result for each review ---
      const reviewIds = parsed.map((p) => p.reviewId);
      const reviewMap = new Map<string, { ai_result: AiResult; business_id: string }>();

      for (const ids of chunkArray(reviewIds, 100)) {
        const { data: rows } = await db
          .from("reviews")
          .select("id, ai_result, business_id")
          .in("id", ids);
        for (const r of rows ?? []) {
          reviewMap.set(r.id, { ai_result: r.ai_result as AiResult, business_id: r.business_id });
        }
      }

      // --- Apply score corrections ---
      let fixed = 0;
      const usageAgg = new Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number }>();

      for (const { reviewId, scores, usage } of parsed) {
        const reviewData = reviewMap.get(reviewId);
        if (!reviewData) continue;

        const topics = reviewData.ai_result.italian_topics ?? [];
        if (scores.length !== topics.length) continue; // mismatch — skip

        const updatedTopics = topics.map((t, i) => ({ ...t, score: scores[i] }));
        const updatedAiResult = { ...reviewData.ai_result, italian_topics: updatedTopics };

        await db.from("reviews")
          .update({ ai_result: updatedAiResult })
          .eq("id", reviewId);

        // Update topic_scores rows
        for (let i = 0; i < updatedTopics.length; i++) {
          const topicId = topicCache.get(updatedTopics[i].italian_name.toUpperCase());
          if (topicId) {
            await db.from("topic_scores")
              .update({ score: scores[i] })
              .eq("review_id", reviewId)
              .eq("topic_id", topicId);
          }
        }

        fixed++;

        // Aggregate token usage
        if (usage && reviewData.business_id) {
          const bId = reviewData.business_id;
          const prev = usageAgg.get(bId) ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
          prev.prompt_tokens += usage.prompt_tokens ?? 0;
          prev.completion_tokens += usage.completion_tokens ?? 0;
          prev.total_tokens += usage.total_tokens ?? 0;
          prev.cached_tokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
          usageAgg.set(bId, prev);
        }
      }

      // --- Track token usage ---
      const batchModel = (metadata.model as string) ?? "gpt-4o-mini";
      const today = new Date().toISOString().slice(0, 10);
      for (const [businessId, usage] of usageAgg) {
        const { data: existing } = await db.from("token_usage")
          .select("id, prompt_tokens, completion_tokens, total_tokens, cached_tokens")
          .eq("business_id", businessId)
          .eq("provider", "openai")
          .eq("model", batchModel)
          .eq("batch_type", "rescore")
          .eq("date", today)
          .maybeSingle();

        if (existing) {
          await db.from("token_usage").update({
            prompt_tokens: existing.prompt_tokens + usage.prompt_tokens,
            completion_tokens: existing.completion_tokens + usage.completion_tokens,
            total_tokens: existing.total_tokens + usage.total_tokens,
            cached_tokens: existing.cached_tokens + usage.cached_tokens,
          }).eq("id", existing.id);
        } else {
          await db.from("token_usage").insert({
            business_id: businessId,
            provider: "openai",
            model: batchModel,
            batch_type: "rescore",
            ...usage,
            date: today,
          });
        }
      }

      // --- Advance offset or mark complete ---
      const newOffset = offset + chunk.length;
      const allDone = newOffset >= totalLines;

      if (allDone) {
        await db.from("ai_batches").update({
          status: "completed",
          metadata: { ...metadata, processed_offset: newOffset, output_file_id: outputFileId, processing_lock: null },
        }).eq("id", batchId);
        results.push({ batch_id: batchId, status: "completed", fixed, total: totalLines });
      } else {
        await db.from("ai_batches").update({
          metadata: { ...metadata, processed_offset: newOffset, output_file_id: outputFileId, processing_lock: null },
        }).eq("id", batchId);
        results.push({ batch_id: batchId, status: "chunked", fixed, total: totalLines, remaining: totalLines - newOffset });
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: msg.includes("access denied") ? 403 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
