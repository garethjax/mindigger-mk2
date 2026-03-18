import { createAdminClient } from "./supabase.ts";

type SupabaseClient = ReturnType<typeof createAdminClient>;

const OPENAI_API = "https://api.openai.com/v1";
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export interface BatchRecord {
  id: string;
  external_batch_id: string;
  provider: string;
  batch_type: string;
  status: string;
  metadata: Record<string, unknown> | null;
}

export type PollSkipResult =
  | { skip: true; status: string }
  | { skip: false; outputFileId: string; metadata: Record<string, unknown> };

/**
 * Attempt to acquire lock, check OpenAI status, and return the output file ID.
 * Returns { skip: true, status } if the batch should be skipped.
 * Returns { skip: false, outputFileId, metadata } if ready to process.
 */
export async function acquireAndCheckBatch(
  db: SupabaseClient,
  batch: BatchRecord,
  apiKey: string,
): Promise<PollSkipResult> {
  const metadata = (batch.metadata ?? {}) as Record<string, unknown>;
  const savedOutputFileId = metadata.output_file_id as string | undefined;

  const lockTime = metadata.processing_lock as string | undefined;
  if (lockTime) {
    const lockAge = Date.now() - new Date(lockTime).getTime();
    if (lockAge < LOCK_TIMEOUT_MS) {
      return { skip: true, status: "locked_by_other" };
    }
  }

  const lockNow = new Date().toISOString();
  const { data: lockResult } = await db
    .from("ai_batches")
    .update({ metadata: { ...metadata, processing_lock: lockNow } })
    .eq("id", batch.id)
    .eq("status", "in_progress")
    .select("id");

  if (!lockResult || lockResult.length === 0) {
    return { skip: true, status: "lock_failed" };
  }

  let outputFileId = savedOutputFileId;

  if (!outputFileId) {
    const statusRes = await fetch(
      `${OPENAI_API}/batches/${batch.external_batch_id}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!statusRes.ok) {
      await releaseLock(db, batch.id, metadata);
      return { skip: true, status: "api_error" };
    }

    const statusData = await statusRes.json();
    const batchStatus = statusData.status as string;

    if (["in_progress", "validating", "finalizing"].includes(batchStatus)) {
      await releaseLock(db, batch.id, metadata);
      return { skip: true, status: "still_processing" };
    }

    if (["failed", "expired", "cancelled"].includes(batchStatus)) {
      const dbStatus = batchStatus === "cancelled" ? "cancelled" : "failed";
      await db.from("ai_batches")
        .update({ status: dbStatus, metadata: { ...metadata, processing_lock: null } })
        .eq("id", batch.id);
      return { skip: true, status: batchStatus };
    }

    if (batchStatus !== "completed") {
      await releaseLock(db, batch.id, metadata);
      return { skip: true, status: batchStatus };
    }

    outputFileId = statusData.output_file_id;
    if (!outputFileId) {
      await db.from("ai_batches")
        .update({ status: "failed", metadata: { ...metadata, processing_lock: null } })
        .eq("id", batch.id);
      return { skip: true, status: "no_output_file" };
    }
  }

  return { skip: false, outputFileId, metadata: { ...metadata, processing_lock: lockNow } };
}

/**
 * Download the output JSONL file from OpenAI and split into lines.
 */
export async function downloadOutputFile(
  outputFileId: string,
  apiKey: string,
): Promise<string[]> {
  const fileRes = await fetch(
    `${OPENAI_API}/files/${outputFileId}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);
  const fileText = await fileRes.text();
  return fileText.trim().split("\n");
}

/**
 * Mark batch as completed and release lock.
 */
export async function markBatchCompleted(
  db: SupabaseClient,
  batchId: string,
  metadata: Record<string, unknown>,
  outputFileId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<void> {
  await db.from("ai_batches").update({
    status: "completed",
    metadata: { ...metadata, output_file_id: outputFileId, processing_lock: null, ...extraMetadata },
  }).eq("id", batchId);
}

async function releaseLock(
  db: SupabaseClient,
  batchId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.from("ai_batches")
    .update({ metadata: { ...metadata, processing_lock: null } })
    .eq("id", batchId);
}
