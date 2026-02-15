import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

/**
 * swot-poll — pg_cron every minute
 *
 * 1. Query ai_batches with status='in_progress' and batch_type='swot'
 * 2. Check batch status with OpenAI
 * 3. If completed: download results, update swot_analyses
 */

const OPENAI_API = "https://api.openai.com/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createAdminClient();
  const results: { batch_id: string; status: string }[] = [];

  try {
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
        // Check batch status
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
          await db.from("ai_batches").update({ status: "failed" }).eq("id", batch.id);

          // Mark associated SWOT as failed
          const swotId = (batch.metadata as Record<string, unknown>)?.swot_id as string;
          if (swotId) {
            await db.from("swot_analyses").update({ status: "failed" }).eq("id", swotId);
          }

          results.push({ batch_id: batch.id, status: batchStatus });
          continue;
        }

        if (batchStatus !== "completed") {
          results.push({ batch_id: batch.id, status: batchStatus });
          continue;
        }

        // Download results
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
        await db.from("ai_batches").update({ status: "completed" }).eq("id", batch.id);
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
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number },
  model: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await db
    .from("token_usage")
    .select("id, prompt_tokens, completion_tokens, total_tokens, cached_tokens")
    .eq("business_id", businessId)
    .eq("provider", provider)
    .eq("model", model)
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
        cached_tokens: existing.cached_tokens + usage.cached_tokens,
      })
      .eq("id", existing.id);
  } else {
    await db.from("token_usage").insert({
      business_id: businessId,
      provider,
      model,
      batch_type: batchType,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cached_tokens: usage.cached_tokens,
      date: today,
    });
  }
}
