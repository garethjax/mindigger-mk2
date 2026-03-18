import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireInternalOrAdmin } from "../_shared/supabase.ts";
import { trackTokenUsage } from "../_shared/token-usage.ts";
import { acquireAndCheckBatch, downloadOutputFile, markBatchCompleted } from "../_shared/batch-polling.ts";

/**
 * swot-poll — pg_cron every minute
 *
 * 1. Query ai_batches with status='in_progress' and batch_type='swot'
 * 2. Check batch status with OpenAI
 * 3. If completed: download results, update swot_analyses
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

  const results: { batch_id: string; status: string }[] = [];

  try {
    await requireInternalOrAdmin(
      req.headers.get("authorization"),
      req.headers.get("x-internal-secret"),
    );

    const db = createAdminClient();
    // Get in-progress SWOT batches
    const { data: batches, error: batchErr } = await db
      .from("ai_batches")
      .select("*")
      .eq("status", "in_progress")
      .eq("batch_type", "swot");

    if (batchErr) throw batchErr;
    if (!batches || batches.length === 0) {
      return new Response(
        JSON.stringify({ message: "No in-progress SWOT batches", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    for (const batch of batches) {
      try {
        const pollResult = await acquireAndCheckBatch(db, batch, apiKey);
        if (pollResult.skip) {
          // SWOT-specific: mark swot_analyses as failed on terminal batch failure
          if (["failed", "expired", "cancelled"].includes(pollResult.status)) {
            const swotId = (batch.metadata as Record<string, unknown>)?.swot_id as string;
            if (swotId) {
              await db.from("swot_analyses").update({ status: "failed" }).eq("id", swotId);
            }
          }
          results.push({ batch_id: batch.id, status: pollResult.status });
          continue;
        }
        const { outputFileId, metadata } = pollResult;
        const lines = await downloadOutputFile(outputFileId, apiKey);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const swotId = parsed.custom_id as string;
            const response = parsed.response;

            if (response?.status_code !== 200) {
              await db.from("swot_analyses").update({ status: "failed" }).eq("id", swotId);
              continue;
            }

            const content = response.body?.choices?.[0]?.message?.content;
            const usage = response.body?.usage;
            const swotResult = JSON.parse(content);

            // Update SWOT with results
            await db
              .from("swot_analyses")
              .update({ results: swotResult, status: "completed" })
              .eq("id", swotId);

            // Track token usage
            if (usage) {
              const { data: swot } = await db
                .from("swot_analyses")
                .select("business_id")
                .eq("id", swotId)
                .single();

              if (swot) {
                const responseModel = response.body?.model ?? "gpt-4.1";
                const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
                await trackTokenUsage(db, swot.business_id, batch.provider, "swot", {
                  prompt_tokens: usage.prompt_tokens,
                  completion_tokens: usage.completion_tokens,
                  total_tokens: usage.total_tokens,
                  cached_tokens: cachedTokens,
                }, responseModel);
              }
            }
          } catch {
            // Individual result parse error — continue with others
          }
        }

        // Update batch status
        await markBatchCompleted(db, batch.id, metadata, outputFileId);
        results.push({ batch_id: batch.id, status: "completed" });
      } catch (innerErr) {
        await db.from("ai_batches").update({ status: "failed" }).eq("id", batch.id);
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
    const message = err instanceof Error ? err.message : "Internal error";
    const status = /authorization|token|access required|forbidden|unauthorized/i.test(message) ? 403 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
