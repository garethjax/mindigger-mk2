import { createAdminClient } from "./supabase.ts";

type SupabaseClient = ReturnType<typeof createAdminClient>;

interface TokenUsageData {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
}

export async function trackTokenUsage(
  db: SupabaseClient,
  businessId: string,
  provider: string,
  batchType: string,
  usage: TokenUsageData,
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
