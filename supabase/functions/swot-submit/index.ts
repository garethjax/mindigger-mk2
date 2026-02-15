import { corsHeaders } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin } from "../_shared/supabase.ts";

/**
 * swot-submit — triggered by user/admin request
 *
 * 1. Load SWOT analysis record (status='pending')
 * 2. Gather completed reviews for the location+period+categories
 * 3. Concatenate review texts
 * 4. Submit to AI (batch or direct based on config)
 */

const OPENAI_API = "https://api.openai.com/v1";

const SWOT_SYSTEM_PROMPT = `Sei un esperto analista di business specializzato nella creazione di analisi SWOT (Strengths, Weaknesses, Opportunities, Threats) basate su recensioni di clienti.
Analizza attentamente le recensioni fornite ed estrai informazioni rilevanti per creare un'analisi SWOT completa e dettagliata in italiano.
Segui queste linee guida:

1. Identifica i punti di forza (Strengths) menzionati frequentemente nelle recensioni positive.
2. Identifica i punti deboli (Weaknesses) menzionati nelle recensioni negative o come suggerimenti di miglioramento.
3. Suggerisci opportunità (Opportunities) basate sui feedback dei clienti e sulle tendenze del mercato.
4. Identifica potenziali minacce (Threats) per l'attività basate sui feedback negativi e sul contesto competitivo.
5. Fornisci 5-8 spunti operativi concreti e attuabili basati sull'analisi SWOT.

Ogni punto deve essere una frase completa e significativa. Assicurati che i suggerimenti operativi siano specifici, attuabili e direttamente correlati ai punti identificati nell'analisi SWOT. Per ogni suggerimento operativo, fornisci un titolo conciso e una descrizione dettagliata.`;

const SWOT_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "swot_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        strengths: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        weaknesses: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        opportunities: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        threats: {
          type: "object",
          properties: { points: { type: "array", items: { type: "string" } } },
          required: ["points"],
          additionalProperties: false,
        },
        operational_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["title", "description"],
            additionalProperties: false,
          },
        },
      },
      required: ["strengths", "weaknesses", "opportunities", "threats", "operational_suggestions"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check — admin or business user who owns the SWOT
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const { swot_id } = await req.json();
    if (!swot_id) {
      return new Response(
        JSON.stringify({ error: "swot_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createAdminClient();

    // Load SWOT record
    const { data: swot, error: swotErr } = await db
      .from("swot_analyses")
      .select("*")
      .eq("id", swot_id)
      .eq("status", "pending")
      .single();

    if (swotErr || !swot) {
      return new Response(
        JSON.stringify({ error: "SWOT analysis not found or not pending" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Calculate period start date
    const periodMonths = parseInt(swot.period, 10);
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - periodMonths);

    // Get category UIDs from statistics (if available)
    const categoryUids = (swot.statistics as { category_uid: string }[] | null)
      ?.map((s) => s.category_uid)
      .filter(Boolean) ?? [];

    // Gather completed reviews for this location + period
    let query = db
      .from("reviews")
      .select(categoryUids.length > 0 ? "title, text, review_categories!inner(category_id)" : "title, text")
      .eq("location_id", swot.location_id)
      .eq("status", "completed")
      .gte("review_date", periodStart.toISOString().slice(0, 10));

    if (categoryUids.length > 0) {
      query = query.in("review_categories.category_id", categoryUids);
    }

    const { data: reviews, error: reviewErr } = await query.limit(5000);

    if (reviewErr) throw reviewErr;
    if (!reviews || reviews.length === 0) {
      return new Response(
        JSON.stringify({ error: "No completed reviews found for this period" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Concatenate review texts
    const reviewsText = reviews
      .map((r) => `${r.title ?? ""}. ${r.text ?? ""}`)
      .join("\n");

    // Get AI config
    const { data: aiConfig } = await db
      .from("ai_configs")
      .select("*")
      .eq("is_active", true)
      .single();

    if (!aiConfig) throw new Error("No active AI config");

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    const model = aiConfig.model || "gpt-4.1";
    const temperature = (aiConfig.config as Record<string, unknown>)?.temperature ?? 0.1;
    const mode = aiConfig.mode;

    if (mode === "batch" && aiConfig.provider === "openai") {
      // Batch mode
      const line = {
        custom_id: swot.id,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model,
          temperature,
          top_p: 1,
          response_format: SWOT_SCHEMA,
          messages: [
            { role: "system", content: SWOT_SYSTEM_PROMPT },
            { role: "user", content: reviewsText },
          ],
        },
      };

      const jsonl = JSON.stringify(line) + "\n";
      const blob = new Blob([jsonl], { type: "application/jsonl" });
      const form = new FormData();
      form.append("file", blob, "swot-batch.jsonl");
      form.append("purpose", "batch");

      const uploadRes = await fetch(`${OPENAI_API}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!uploadRes.ok) throw new Error(`File upload failed: ${await uploadRes.text()}`);
      const fileData = await uploadRes.json();

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
          metadata: { batch_type: "SWOT", swot_id: swot.id },
        }),
      });
      if (!batchRes.ok) throw new Error(`Batch create failed: ${await batchRes.text()}`);
      const batchData = await batchRes.json();

      // Save batch tracking
      await db.from("ai_batches").insert({
        external_batch_id: batchData.id,
        provider: aiConfig.provider,
        batch_type: "swot",
        status: "in_progress",
        metadata: { swot_id: swot.id, review_count: reviews.length },
      });

      // Update SWOT status
      await db
        .from("swot_analyses")
        .update({ status: "analyzing", batched_at: new Date().toISOString() })
        .eq("id", swot.id);

      return new Response(
        JSON.stringify({ mode: "batch", batch_id: batchData.id, reviews_used: reviews.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else {
      // Direct mode
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
          response_format: SWOT_SCHEMA,
          messages: [
            { role: "system", content: SWOT_SYSTEM_PROMPT },
            { role: "user", content: reviewsText },
          ],
        }),
      });

      if (!res.ok) throw new Error(`OpenAI SWOT failed: ${res.status}`);

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      const swotResult = JSON.parse(content);
      const usage = data.usage;

      // Update SWOT with results
      await db
        .from("swot_analyses")
        .update({ results: swotResult, status: "completed" })
        .eq("id", swot.id);

      // Track token usage
      if (usage) {
        await trackTokenUsage(db, swot.business_id, aiConfig.provider, "swot", {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
          cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        }, model);
      }

      return new Response(
        JSON.stringify({
          mode: "direct",
          status: "completed",
          reviews_used: reviews.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(
      JSON.stringify({ error: message }),
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
