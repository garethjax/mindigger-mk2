import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const OPENAI_API = "https://api.openai.com/v1";

/**
 * Upload a JSONL file to the OpenAI Files API.
 * Returns the file ID on success.
 */
export async function uploadJSONL(
  lines: string[],
  apiKey: string,
): Promise<string> {
  const jsonl = lines.join("\n") + "\n";
  const blob = new Blob([jsonl], { type: "application/jsonl" });
  const form = new FormData();
  form.append("file", blob, "batch.jsonl");
  form.append("purpose", "batch");

  const res = await fetch(`${OPENAI_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`File upload failed: ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.id) {
    throw new Error(`File upload returned no id: ${JSON.stringify(data)}`);
  }

  return data.id as string;
}

/**
 * Create an OpenAI Batch via the Batch API.
 * Returns the batch object (at minimum `{ id: string }`).
 */
export async function createOpenAIBatch(
  inputFileId: string,
  apiKey: string,
  metadata?: Record<string, string>,
  endpoint = "/v1/chat/completions",
): Promise<{ id: string }> {
  const res = await fetch(`${OPENAI_API}/batches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint,
      completion_window: "24h",
      metadata,
    }),
  });

  if (!res.ok) {
    throw new Error(`Batch create failed: ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.id) {
    throw new Error(`Batch create returned no id: ${JSON.stringify(data)}`);
  }

  return { id: data.id as string };
}

export interface BatchRecordParams {
  externalBatchId: string;
  provider: string;
  batchType: string;
  metadata: Record<string, unknown>;
}

/**
 * Insert a tracking record into the `ai_batches` table.
 * Returns the inserted row's `id`.
 */
export async function insertBatchRecord(
  db: SupabaseClient,
  params: BatchRecordParams,
): Promise<string> {
  const { data, error } = await db
    .from("ai_batches")
    .insert({
      external_batch_id: params.externalBatchId,
      provider: params.provider,
      batch_type: params.batchType,
      status: "in_progress",
      metadata: params.metadata,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}
