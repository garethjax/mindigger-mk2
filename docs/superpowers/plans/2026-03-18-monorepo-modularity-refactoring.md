# Monorepo Modularity Refactoring Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~450 lines of code duplication across edge functions and split 2 oversized frontend components (~2200 LOC combined) into focused, maintainable modules.

**Architecture:** Extract shared utilities from 6 Supabase edge functions into `_shared/` modules (Phase 1), split AIConfigPanel into per-tab components (Phase 2), split BusinessDetailView into domain sub-components (Phase 3), then wire up the existing `@shared` package types in the web app (Phase 4).

**Tech Stack:** Deno (edge functions), Preact + Tailwind (frontend), TypeScript throughout, Bun for tests.

---

## Phase 1 — Edge Functions Shared Modules

### Task 1.1: Extract `_shared/token-usage.ts`

**Files:**
- Create: `supabase/functions/_shared/token-usage.ts`
- Modify: `supabase/functions/analysis-poll/index.ts` (remove local `trackTokenUsage` function)
- Modify: `supabase/functions/rescore-poll/index.ts` (remove inline token tracking loop — no named function, just inline code)
- Modify: `supabase/functions/swot-poll/index.ts` (remove local `trackTokenUsage` function)
- Modify: `supabase/functions/analysis-submit/index.ts` (remove local `trackTokenUsage` function)
- Modify: `supabase/functions/swot-submit/index.ts` (remove local `trackTokenUsage` function)

> **Note:** `rescore-submit/index.ts` does NOT have token tracking — it only creates the batch. Token tracking for rescore happens entirely in `rescore-poll`.

- [ ] **Step 1: Create the shared module**

```typescript
// supabase/functions/_shared/token-usage.ts
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
```

- [ ] **Step 2: Replace in `analysis-poll/index.ts`**

Remove the local `trackTokenUsage` function (last ~44 lines of the file). Add import at top:
```typescript
import { trackTokenUsage } from "../_shared/token-usage.ts";
```
The call site at `trackTokenUsage(db, businessId, batch.provider, "reviews", usage, batchModel)` remains unchanged.

- [ ] **Step 3: Replace in `rescore-poll/index.ts`**

Remove the inline token tracking loop (lines ~217-247). Replace with:
```typescript
import { trackTokenUsage } from "../_shared/token-usage.ts";

// In the processing loop, after usageAgg is built:
const batchModel = (metadata.model as string) ?? "gpt-4.1";
for (const [businessId, usage] of usageAgg) {
  await trackTokenUsage(db, businessId, "openai", "rescore", usage, batchModel);
}
```

- [ ] **Step 4: Replace in `swot-poll/index.ts`**

Remove local `trackTokenUsage` function. Add import:
```typescript
import { trackTokenUsage } from "../_shared/token-usage.ts";
```

- [ ] **Step 5: Replace in `analysis-submit/index.ts`**

Remove local `trackTokenUsage` function (last ~44 lines). Add import:
```typescript
import { trackTokenUsage } from "../_shared/token-usage.ts";
```

- [ ] **Step 6: Replace in `swot-submit/index.ts`**

Remove local `trackTokenUsage` function (last ~44 lines). Add import:
```typescript
import { trackTokenUsage } from "../_shared/token-usage.ts";
```

- [ ] **Step 7: Verify all functions still serve correctly**

Run: `supabase functions serve` and verify no import errors in the console output.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/token-usage.ts supabase/functions/*/index.ts
git commit -m "refactor(edge): extract shared trackTokenUsage to _shared/token-usage.ts"
```

---

### Task 1.2: Extract `_shared/batch-polling.ts`

**Files:**
- Create: `supabase/functions/_shared/batch-polling.ts`
- Modify: `supabase/functions/analysis-poll/index.ts`
- Modify: `supabase/functions/rescore-poll/index.ts`
- Modify: `supabase/functions/swot-poll/index.ts`

- [ ] **Step 1: Create the shared module**

This module handles: optimistic locking, OpenAI batch status check, output file download, and terminal state management.

```typescript
// supabase/functions/_shared/batch-polling.ts
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
 * Returns { skip: true, status } if the batch should be skipped (locked, still processing, failed, etc.)
 * Returns { skip: false, outputFileId, metadata } if ready to process.
 * Handles lock release on skip cases.
 */
export async function acquireAndCheckBatch(
  db: SupabaseClient,
  batch: BatchRecord,
  apiKey: string,
): Promise<PollSkipResult> {
  const metadata = (batch.metadata ?? {}) as Record<string, unknown>;
  const savedOutputFileId = metadata.output_file_id as string | undefined;

  // --- Optimistic lock ---
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

  // --- Check OpenAI status (skip if we already have the output file) ---
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
```

- [ ] **Step 2: Refactor `analysis-poll/index.ts`**

Replace the locking block (lines ~75-146), file download (lines ~148-157), and completion marking (Phase 10) with shared functions:

```typescript
import { acquireAndCheckBatch, downloadOutputFile, markBatchCompleted } from "../_shared/batch-polling.ts";

// Inside the batch loop:
const apiKey = Deno.env.get("OPENAI_API_KEY");
if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

const pollResult = await acquireAndCheckBatch(db, batch, apiKey);
if (pollResult.skip) {
  results.push({ batch_id: batch.id, status: pollResult.status });
  continue;
}
const { outputFileId, metadata } = pollResult;
const lines = await downloadOutputFile(outputFileId, apiKey);
const totalLines = lines.length;

// ... existing parsing & processing phases ...

// At the end (Phase 10):
await markBatchCompleted(db, batch.id, metadata, outputFileId);
results.push({ batch_id: batch.id, status: "completed", processed, total: totalLines });
```

- [ ] **Step 3: Refactor `rescore-poll/index.ts`**

Same pattern — replace the locking block, status check, and file download with shared functions. Remove `const OPENAI_API` constant (now in shared module).

- [ ] **Step 4: Refactor `swot-poll/index.ts`**

Same pattern but with important differences:
- swot-poll currently does NOT use optimistic locking — `acquireAndCheckBatch` adds it (improvement).
- swot-poll does NOT cache `output_file_id` in metadata — the shared function adds this optimization.
- swot-poll has a SWOT-specific side effect: marking `swot_analyses` as failed. Handle this in the caller:

```typescript
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
```

> **Behavioral change:** The shared `acquireAndCheckBatch` explicitly releases the lock on `api_error` and `still_processing` cases. The original `analysis-poll` did NOT release the lock in these cases (relying on 5-minute stale timeout). The `rescore-poll` DID release it. The new shared behavior (always release) is an intentional improvement — cleaner lock management, no 5-minute stale windows.

- [ ] **Step 5: Verify all poll functions work**

Run: `supabase functions serve` and verify no import errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/batch-polling.ts supabase/functions/*/index.ts
git commit -m "refactor(edge): extract shared batch polling to _shared/batch-polling.ts"
```

---

### Task 1.3: Extract `_shared/batch-submission.ts`

**Files:**
- Create: `supabase/functions/_shared/batch-submission.ts`
- Modify: `supabase/functions/analysis-submit/index.ts`
- Modify: `supabase/functions/rescore-submit/index.ts`
- Modify: `supabase/functions/swot-submit/index.ts`

- [ ] **Step 1: Create the shared module**

```typescript
// supabase/functions/_shared/batch-submission.ts

const OPENAI_API = "https://api.openai.com/v1";

export interface BatchLine {
  custom_id: string;
  method: "POST";
  url: "/v1/chat/completions";
  body: {
    model: string;
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    response_format?: unknown;
    messages: { role: string; content: string }[];
  };
}

export interface SubmitBatchResult {
  fileId: string;
  batchId: string;
}

/**
 * Upload JSONL lines to OpenAI and create a batch job.
 * Returns the file ID and batch ID.
 */
export async function submitOpenAIBatch(
  apiKey: string,
  lines: BatchLine[],
  filename: string,
  batchMetadata: Record<string, string>,
): Promise<SubmitBatchResult> {
  const jsonl = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

  // Upload file
  const blob = new Blob([jsonl], { type: "application/jsonl" });
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("purpose", "batch");

  const uploadRes = await fetch(`${OPENAI_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!uploadRes.ok) throw new Error(`File upload failed: ${await uploadRes.text()}`);
  const fileData = await uploadRes.json() as { id: string };

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
      metadata: batchMetadata,
    }),
  });
  if (!batchRes.ok) throw new Error(`Batch create failed: ${await batchRes.text()}`);
  const batchData = await batchRes.json() as { id: string };

  return { fileId: fileData.id, batchId: batchData.id };
}
```

- [ ] **Step 2: Refactor `analysis-submit/index.ts`**

Replace JSONL upload + batch create block with:
```typescript
import { submitOpenAIBatch, type BatchLine } from "../_shared/batch-submission.ts";

// Build lines array (keep existing line-building logic)
const batchLines: BatchLine[] = group.reviews.map((review) => ({
  custom_id: review.id,
  method: "POST",
  url: "/v1/chat/completions",
  body: {
    model, temperature, top_p: 1, frequency_penalty: 0, presence_penalty: 0,
    response_format: REVIEW_SCHEMA,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `REVIEW: ${JSON.stringify({ title: sanitize(review.title), text: sanitize(review.text) })}` },
    ],
  },
}));

const { batchId } = await submitOpenAIBatch(apiKey, batchLines, "batch.jsonl", { batch_type: "REVIEWS", sector: sectorId });
```

- [ ] **Step 3: Refactor `rescore-submit/index.ts`**

Replace JSONL + upload + batch create with `submitOpenAIBatch()`. Note: rescore-submit does not use `temperature`/`top_p`/`frequency_penalty` — these are optional in `BatchLine.body`, so just omit them:

```typescript
import { submitOpenAIBatch, type BatchLine } from "../_shared/batch-submission.ts";

const batchLines: BatchLine[] = candidates.map((review) => ({
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
}));

const { batchId } = await submitOpenAIBatch(apiKey, batchLines, "rescore.jsonl", { batch_type: "RESCORE" });
```

- [ ] **Step 4: Refactor `swot-submit/index.ts`**

Same pattern as analysis-submit.

> **Note:** The `OPENAI_API` constant is still needed in submit functions that have a direct-mode code path (e.g., `analysis-submit` line 424, `swot-submit` line 264). Only remove it from files that no longer reference it directly.

- [ ] **Step 5: Verify and commit**

```bash
git add supabase/functions/_shared/batch-submission.ts supabase/functions/*/index.ts
git commit -m "refactor(edge): extract shared batch submission to _shared/batch-submission.ts"
```

---

### Task 1.4: Extract `_shared/sanitize.ts`

**Files:**
- Create: `supabase/functions/_shared/sanitize.ts`
- Modify: `supabase/functions/analysis-poll/index.ts`
- Modify: `supabase/functions/analysis-submit/index.ts`

> **Note:** `_shared/scraping-ingest.ts` already has a different `sanitize` function that handles `unknown` types and only strips null bytes (`\0`). The function extracted here strips the full control character range and takes `string | null | undefined`. These serve different purposes — the naming is acceptable since they live in different files and are imported explicitly.

- [ ] **Step 1: Create shared sanitize utility**

```typescript
// supabase/functions/_shared/sanitize.ts

/** Remove control characters that break JSON parsing in AI prompts/results. */
export function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
```

- [ ] **Step 2: Replace in both files**

```typescript
import { sanitize } from "../_shared/sanitize.ts";
```

Remove the local `sanitize` function from both files.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/sanitize.ts supabase/functions/analysis-*/index.ts
git commit -m "refactor(edge): extract sanitize to _shared/sanitize.ts"
```

---

## Phase 2 — Split AIConfigPanel.tsx

### Task 2.1: Extract shared types and utilities

**Files:**
- Create: `apps/web/src/components/admin/ai-config-types.ts`
- Create: `apps/web/src/components/admin/cost-calculation.ts`

- [ ] **Step 1: Create types file**

Move interfaces `AIConfig`, `TokenUsageRow`, `BatchMetadata`, `Batch`, `PricingRow`, `CreditBalance` and constant `BATCH_STATUS_COLORS` from AIConfigPanel.tsx to `ai-config-types.ts`:

```typescript
// apps/web/src/components/admin/ai-config-types.ts

export interface AIConfig {
  id: string;
  provider: string;
  mode: string;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface TokenUsageRow {
  business_id: string;
  provider: string;
  model: string;
  batch_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  date: string;
  businesses: { name: string } | null;
}

export interface BatchMetadata {
  business_id?: string;
  review_count?: number;
  model?: string;
  fixed?: number;
  failed?: number;
  [key: string]: unknown;
}

export interface Batch {
  id: string;
  external_batch_id: string;
  provider: string;
  batch_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  metadata?: BatchMetadata;
}

export interface PricingRow {
  id: string;
  provider: string;
  model: string;
  mode: string;
  input_price: number;
  cached_input_price: number;
  output_price: number;
}

export interface CreditBalance {
  initial_amount: number;
  reference_date: string;
  notes: string | null;
}

export const BATCH_STATUS_COLORS: Record<string, string> = {
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  expired: "bg-gray-100 text-gray-500",
  validating: "bg-yellow-100 text-yellow-700",
  finalizing: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-gray-100 text-gray-500",
};
```

- [ ] **Step 2: Create cost calculation utility**

Extract `computeCost()` to its own file:

```typescript
// apps/web/src/components/admin/cost-calculation.ts
import type { TokenUsageRow, PricingRow } from "./ai-config-types";

export function computeCost(row: TokenUsageRow, pricing: PricingRow[]): number {
  const p = pricing.find(
    (pr) => pr.provider === row.provider && pr.model === row.model && pr.mode === "batch",
  );
  if (!p) return 0;
  const uncachedInput = row.prompt_tokens - row.cached_tokens;
  return (
    (uncachedInput * p.input_price +
      row.cached_tokens * p.cached_input_price +
      row.completion_tokens * p.output_price) /
    1_000_000 /
    2
  );
}
```

- [ ] **Step 3: Update AIConfigPanel.tsx imports**

Replace inline type definitions with:
```typescript
import type { AIConfig, TokenUsageRow, Batch, PricingRow, CreditBalance } from "./ai-config-types";
import { BATCH_STATUS_COLORS } from "./ai-config-types";
import { computeCost } from "./cost-calculation";
```

- [ ] **Step 4: Verify and commit**

Run: `cd apps/web && npx tsc --noEmit`

```bash
git add apps/web/src/components/admin/ai-config-types.ts apps/web/src/components/admin/cost-calculation.ts apps/web/src/components/admin/AIConfigPanel.tsx
git commit -m "refactor(admin): extract AI config types and cost calculation"
```

---

### Task 2.2: Extract `ProviderConfigTab.tsx`

**Files:**
- Create: `apps/web/src/components/admin/ProviderConfigTab.tsx`
- Modify: `apps/web/src/components/admin/AIConfigPanel.tsx`

- [ ] **Step 1: Create the tab component**

Extract the Provider tab section (currently inside `{tab === "config" && ...}`) into a standalone component. Move `startEdit`, `saveEdit`, `toggleActive` functions and their associated state (`editingId`, `editModel`, `editMode`, `saving`) into this component.

Props: `configs: AIConfig[]`, `pricing: PricingRow[]`, `message/setMessage` callbacks.

> **Supabase client:** Each tab component that needs DB access should call `createSupabaseBrowser()` at its own component level (it's a lightweight singleton factory). Do NOT pass the client as a prop — Preact serialization boundaries in Astro islands don't allow non-serializable props.

- [ ] **Step 2: Replace in AIConfigPanel.tsx**

Replace the `{tab === "config" && (...)}` block with:
```tsx
{tab === "config" && (
  <ProviderConfigTab configs={configs} pricing={pricing} message={message} setMessage={setMessage} />
)}
```

- [ ] **Step 3: Verify and commit**

```bash
git add apps/web/src/components/admin/ProviderConfigTab.tsx apps/web/src/components/admin/AIConfigPanel.tsx
git commit -m "refactor(admin): extract ProviderConfigTab component"
```

---

### Task 2.3: Extract `TokenUsageTab.tsx`

**Files:**
- Create: `apps/web/src/components/admin/TokenUsageTab.tsx`
- Modify: `apps/web/src/components/admin/AIConfigPanel.tsx`

- [ ] **Step 1: Create the tab component**

Extract the Token Usage tab section. Move `tokensByBusiness` aggregation logic into this component.

Props: `tokenUsage: TokenUsageRow[]`

- [ ] **Step 2: Replace in AIConfigPanel.tsx and commit**

```bash
git commit -m "refactor(admin): extract TokenUsageTab component"
```

---

### Task 2.4: Extract `CostsTab.tsx`

**Files:**
- Create: `apps/web/src/components/admin/CostsTab.tsx`
- Modify: `apps/web/src/components/admin/AIConfigPanel.tsx`

- [ ] **Step 1: Create the tab component**

Extract the Costs tab section. Move `costsByBusiness` aggregation, `totalCost`, `costAfterRef`, `remainingCredit` computations into this component.

Props: `tokenUsage: TokenUsageRow[]`, `pricing: PricingRow[]`, `creditBalance: CreditBalance | null`

- [ ] **Step 2: Replace in AIConfigPanel.tsx and commit**

```bash
git commit -m "refactor(admin): extract CostsTab component"
```

---

### Task 2.5: Extract `BatchManagementTab.tsx`

**Files:**
- Create: `apps/web/src/components/admin/BatchManagementTab.tsx`
- Create: `apps/web/src/components/admin/BusinessSearchInput.tsx`
- Modify: `apps/web/src/components/admin/AIConfigPanel.tsx`

- [ ] **Step 1: Create BusinessSearchInput component**

Extract the business autocomplete search (debounce, suggestions dropdown, clear button) as a reusable component.

Props: `value: string`, `onSelect: (business: {id: string, name: string}) => void`, `onClear: () => void`

- [ ] **Step 2: Create BatchManagementTab component**

Extract the entire Batch AI tab: rescore panel, "Invia recensioni pending" button, "Controlla status" button, batch table. Move associated state and functions: `rescoreLoading`, `rescoreBusinessId`, `batchActionLoading`, `batchPollLoading`, `batchRows`, `businessNames`, `runRescore`, `runBatchPoll`, `runAnalysisSubmit`, `runBatchAction`, `refreshBusinessNames`.

Props: `batches: Batch[]`, `message/setMessage` callbacks.

- [ ] **Step 3: Replace in AIConfigPanel.tsx**

After extraction, AIConfigPanel becomes an orchestrator (~120-150 lines):

```tsx
export default function AIConfigPanel({ configs, tokenUsage, batches, pricing, creditBalance }: Props) {
  const [tab, setTab] = useState<"config" | "tokens" | "batches" | "costs">("config");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  return (
    <div class="space-y-4">
      {/* Tab bar */}
      {/* Message banner */}
      {tab === "config" && <ProviderConfigTab ... />}
      {tab === "tokens" && <TokenUsageTab ... />}
      {tab === "costs" && <CostsTab ... />}
      {tab === "batches" && <BatchManagementTab ... />}
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `cd apps/web && npx tsc --noEmit`

```bash
git add apps/web/src/components/admin/BusinessSearchInput.tsx apps/web/src/components/admin/BatchManagementTab.tsx apps/web/src/components/admin/AIConfigPanel.tsx
git commit -m "refactor(admin): extract BatchManagementTab and BusinessSearchInput"
```

---

## Phase 3 — Split BusinessDetailView.tsx

### Task 3.1: Extract `BusinessEditor.tsx`

**Files:**
- Create: `apps/web/src/components/admin/BusinessEditor.tsx`
- Modify: `apps/web/src/components/admin/BusinessDetailView.tsx`

- [ ] **Step 1: Create the component**

Extract the business metadata editing section (name, type, sector, contact info). Move associated state for business field editing.

Props: `business: Business`, `sectors: BusinessSector[]`, `onSave: (updated) => void`

- [ ] **Step 2: Replace in BusinessDetailView and commit**

```bash
git commit -m "refactor(admin): extract BusinessEditor component"
```

---

### Task 3.2: Extract `LocationManager.tsx`

**Files:**
- Create: `apps/web/src/components/admin/LocationManager.tsx`
- Modify: `apps/web/src/components/admin/BusinessDetailView.tsx`

- [ ] **Step 1: Create the component**

Extract location CRUD (add/edit/delete/toggle competitor). Move associated state for location editing modals.

Props: `businessId: string`, `locations: Location[]`, `onUpdate: () => void`

- [ ] **Step 2: Replace in BusinessDetailView and commit**

```bash
git commit -m "refactor(admin): extract LocationManager component"
```

---

### Task 3.3: Extract `ScrapingConfigPanel.tsx`

**Files:**
- Create: `apps/web/src/components/admin/ScrapingConfigPanel.tsx`
- Modify: `apps/web/src/components/admin/BusinessDetailView.tsx`

- [ ] **Step 1: Create the component**

Extract scraping configuration UI (platform configs, depth settings, status management). Move associated state.

Props: `locationId: string`, `configs: ScrapingConfig[]`, `onUpdate: () => void`

- [ ] **Step 2: Replace in BusinessDetailView and commit**

After all extractions, BusinessDetailView becomes a layout/orchestrator (~200 lines).

```bash
git commit -m "refactor(admin): extract ScrapingConfigPanel component"
```

---

## Phase 4 — Activate @shared Types

### Task 4.1: Wire up shared types in web app

**Files:**
- Modify: `apps/web/src/components/admin/ai-config-types.ts` (replace with imports)
- Modify: `apps/web/src/components/admin/BusinessDetailView.tsx`
- Modify: `apps/web/src/components/dashboard/ReviewList.tsx`
- Modify: other components that define local types matching `@shared`

- [ ] **Step 1: Verify `@shared` path alias works**

Check `apps/web/tsconfig.json` has the path alias:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

Test with a dummy import in any component.

- [ ] **Step 2: Replace local type definitions**

In `ai-config-types.ts`, replace `AIConfig` and `Batch` interfaces with:
```typescript
import type { AIConfig as SharedAIConfig, AIBatch } from "@shared/types";

// Extend shared types with view-specific fields where needed
export type AIConfig = SharedAIConfig;
export interface Batch extends AIBatch {
  metadata?: BatchMetadata;
}
```

For `Review`, `Location`, `Business` — import from `@shared/types` and remove local definitions. Add view-specific extensions where the local type has extra fields (e.g., joined relations).

> **Known type gaps in `@shared/types.ts` that need updating first:**
> - `TokenUsage` is missing `cached_tokens: number` and `model: string` fields
> - `TokenUsage` needs a view variant with `businesses: { name: string } | null` for joined queries
> - `Business` is missing `ragione_sociale`, `email`, `referente_nome` fields used in `BusinessDetailView`
> - `Location` may be missing fields used by `EditableLocation` in `helpers.ts`
>
> Before importing shared types, update `packages/shared/src/types.ts` to include these fields. Run `npx tsc --noEmit` in `apps/web` after each change to catch missing fields at compile time.

- [ ] **Step 3: Verify everything compiles**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: use @shared types in web app, remove local type duplication"
```

---

## Verification Checklist

After all phases:

- [ ] `cd apps/web && npx tsc --noEmit` passes
- [ ] `bun test apps/web/src/components/admin/__tests__/` passes
- [ ] `supabase functions serve` starts without import errors
- [ ] Manual test: open `/regia/ai-config` — all 4 tabs render correctly
- [ ] Manual test: open `/regia/businesses/{id}` — business/location/scraping sections work
- [ ] Manual test: trigger a rescore and poll — batch pipeline works end-to-end
