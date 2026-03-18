import { corsHeaders } from "../_shared/cors.ts";
import { uploadJSONL, createOpenAIBatch, insertBatchRecord } from "../_shared/batch-submission.ts";
import { createAdminClient, requireInternalOrAdmin } from "../_shared/supabase.ts";

const RESCORE_MODEL = "gpt-4.1";

const BATCH_LIMIT = 5_000;

const RESCORE_SYSTEM_PROMPT = `You are a satisfaction score validator for customer reviews.

You will receive a review text and a list of topics already extracted from it.
For each topic, assign a satisfaction score from 1 to 5 based ONLY on the
portion of the review that refers to that specific topic — ignore the overall
tone of the review.

Score meaning:
  1 = reviewer is very upset / strongly complains about this topic
  2 = reviewer is somewhat dissatisfied
  3 = neutral or mixed
  4 = reviewer is fairly satisfied
  5 = reviewer is very happy / strongly praises this topic

Return a JSON object with a single "scores" array containing one integer per
topic, in the same order as the input list.`;

const RESCORE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "rescore_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        scores: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
      required: ["scores"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireInternalOrAdmin(
      req.headers.get("authorization"),
      req.headers.get("x-internal-secret"),
    );

    const body = await req.json().catch(() => ({}));
    const { business_id, location_id } = body as { business_id?: string; location_id?: string };

    const db = createAdminClient();
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), { status: 500 });
    }

    // --- Find candidate reviews with score/sentiment mismatch ---
    let query = db
      .from("reviews")
      .select("id, text, title, ai_result")
      .eq("status", "completed")
      .not("ai_result->italian_topics", "is", null)
      .limit(BATCH_LIMIT);

    if (business_id) query = query.eq("business_id", business_id);
    if (location_id) query = query.eq("location_id", location_id);

    const { data: allReviews, error: fetchErr } = await query;
    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
    }

    type AiResult = {
      sentiment?: number;
      italian_topics?: { italian_name: string; score: number }[];
    };

    const candidates = (allReviews ?? []).filter((r) => {
      const result = r.ai_result as AiResult | null;
      if (!result) return false;
      const sentiment = result.sentiment;
      const topics = result.italian_topics ?? [];
      if (!sentiment || topics.length === 0) return false;
      // Negative overall but at least one topic scored positively
      if (sentiment <= 2 && topics.some((t) => t.score >= 4)) return true;
      // Positive overall but at least one topic scored negatively
      if (sentiment >= 4 && topics.some((t) => t.score <= 2)) return true;
      return false;
    });

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ submitted: 0, message: "No inconsistent reviews found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Build JSONL ---
    const lines: string[] = [];
    for (const review of candidates) {
      const result = review.ai_result as AiResult;
      const topics = (result.italian_topics ?? []).map((t) => t.italian_name);
      const reviewText = [review.title, review.text]
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);

      lines.push(
        JSON.stringify({
          custom_id: review.id,
          method: "POST",
          url: "/v1/chat/completions",
          body: {
            model: RESCORE_MODEL,
            response_format: RESCORE_SCHEMA,
            messages: [
              { role: "system", content: RESCORE_SYSTEM_PROMPT },
              { role: "user", content: JSON.stringify({ review: reviewText, topics }) },
            ],
          },
        }),
      );
    }
    // Upload JSONL, create batch, and track in ai_batches
    const fileId = await uploadJSONL(lines, apiKey);
    const batchData = await createOpenAIBatch(
      fileId,
      apiKey,
      { batch_type: "RESCORE" },
    );

    await insertBatchRecord(db, {
      externalBatchId: batchData.id,
      provider: "openai",
      batchType: "rescore",
      metadata: {
        review_count: candidates.length,
        business_id: business_id ?? null,
        location_id: location_id ?? null,
        model: RESCORE_MODEL,
      },
    });

    return new Response(
      JSON.stringify({ submitted: candidates.length, external_batch_id: batchData.id }),
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
