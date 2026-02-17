/**
 * Compare topic extraction between two models using OpenAI Batch API.
 * Runs both model batches in parallel and compares outputs on the same reviews.
 *
 * Usage:
 *   OPENAI_API_KEY=... bun run scripts/compare-topic-extraction-batch.ts \
 *     --input ./scripts/data/reviews-sample.json \
 *     --sector "Ristorazione" \
 *     --categories "Altro,Cibo,Generale,Locale,Percezione,Personale,Prezzo,Problemi,Senza Commenti,Servizio,Vino" \
 *     --candidate-model gpt-5-mini-2025-08-07 \
 *     --limit 250
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildReviewSystemPrompt,
  buildReviewUserMessage,
} from "../packages/shared/src/ai/prompts";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_BASELINE_MODEL = "gpt-4.1";
const DEFAULT_POLL_INTERVAL_MS = 15000;

const REVIEW_ANALYSIS_SCHEMA_COMPAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "review_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        italian_topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              italian_name: { type: "string" },
              score: { type: "integer", minimum: 1, maximum: 5 },
              italian_category: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
                additionalProperties: false,
              },
            },
            required: ["italian_name", "score", "italian_category"],
            additionalProperties: false,
          },
        },
        sentiment: { type: "integer", minimum: 1, maximum: 5 },
        language: { type: "string" },
        italian_translation: {
          type: ["object", "null"],
          properties: {
            italian_title: { type: "string" },
            italian_text: { type: "string" },
          },
          required: ["italian_title", "italian_text"],
          additionalProperties: false,
        },
      },
      required: ["italian_topics", "sentiment", "language", "italian_translation"],
      additionalProperties: false,
    },
  },
};

type InputReview = {
  id: string;
  title?: string | null;
  text: string;
};

type Topic = {
  italian_name: string;
  score: number;
  italian_category: { name: string };
};

type ReviewResult = {
  italian_topics: Topic[];
  sentiment: number;
  language: string;
  italian_translation?: { italian_title: string; italian_text: string } | null;
};

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ModelResponse = {
  ok: boolean;
  error?: string;
  usage?: Usage;
  result?: ReviewResult;
  rawContent?: string;
};

type CompareRow = {
  id: string;
  baseline: ModelResponse;
  candidate: ModelResponse;
  overlap_jaccard: number | null;
  common_topics: string[];
  baseline_only_topics: string[];
  candidate_only_topics: string[];
  avg_score_delta_on_common: number | null;
  sentiment_delta: number | null;
};

type Summary = {
  total_reviews: number;
  baseline_success: number;
  candidate_success: number;
  both_success: number;
  avg_jaccard: number | null;
  avg_common_topics: number | null;
  avg_baseline_only_topics: number | null;
  avg_candidate_only_topics: number | null;
  avg_abs_sentiment_delta: number | null;
  avg_abs_topic_score_delta_common: number | null;
  baseline_tokens_total: number;
  candidate_tokens_total: number;
};

type Args = {
  inputPath: string;
  sectorName: string;
  categories: string[];
  baselineModel: string;
  candidateModel: string;
  baselineBatchId?: string;
  candidateBatchId?: string;
  candidateReasoningEffort?: string;
  candidateVerbosity?: string;
  outPath?: string;
  limit?: number;
  promptSuffix?: string;
  pollIntervalMs: number;
};

type OpenAIBatchResponseLine = {
  custom_id: string;
  response?: {
    status_code?: number;
    body?: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Usage;
    };
  };
  error?: { message?: string } | null;
};

function printHelp(): void {
  console.log(`
Compare topic extraction between two models with OpenAI Batch API

Required:
  --input <path>               JSON file with review array
  --sector <name>              Sector name used in system prompt
  --categories <csv>           Category names, comma-separated
  --candidate-model <model>    Model to compare against baseline

Optional:
  --baseline-model <model>     Default: ${DEFAULT_BASELINE_MODEL}
  --baseline-batch-id <id>     Reuse existing baseline batch (skip submit)
  --candidate-batch-id <id>    Reuse existing candidate batch (skip submit)
  --candidate-reasoning-effort <v>  Example: minimal
  --candidate-verbosity <v>         Example: low
  --limit <n>                  Process first N reviews
  --prompt-suffix <text>       Extra instruction appended to system prompt
  --poll-interval-ms <n>       Default: ${DEFAULT_POLL_INTERVAL_MS}
  --out <path>                 Output JSON path
  --help
`);
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      map.set(key, "true");
      continue;
    }
    map.set(key, next);
    i++;
  }

  if (map.has("--help") || map.has("-h")) {
    printHelp();
    process.exit(0);
  }

  const inputPath = map.get("--input");
  const sectorName = map.get("--sector");
  const categoriesRaw = map.get("--categories");
  const candidateModel = map.get("--candidate-model");
  const baselineModel = map.get("--baseline-model") ?? DEFAULT_BASELINE_MODEL;
  const outPath = map.get("--out");
  const promptSuffix = map.get("--prompt-suffix");
  const baselineBatchId = map.get("--baseline-batch-id");
  const candidateBatchId = map.get("--candidate-batch-id");
  const candidateReasoningEffort = map.get("--candidate-reasoning-effort");
  const candidateVerbosity = map.get("--candidate-verbosity");
  const limitRaw = map.get("--limit");
  const pollRaw = map.get("--poll-interval-ms");

  if (!inputPath || !sectorName || !categoriesRaw || !candidateModel) {
    printHelp();
    throw new Error("Missing required args: --input --sector --categories --candidate-model");
  }

  const categories = categoriesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (categories.length === 0) throw new Error("At least one category is required in --categories");

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const pollIntervalMs = pollRaw ? Number.parseInt(pollRaw, 10) : DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
    throw new Error("--poll-interval-ms must be >= 1000");
  }

  return {
    inputPath,
    sectorName,
    categories,
    baselineModel,
    candidateModel,
    baselineBatchId,
    candidateBatchId,
    candidateReasoningEffort,
    candidateVerbosity,
    outPath,
    limit,
    promptSuffix,
    pollIntervalMs,
  };
}

function safeParseReviews(path: string): InputReview[] {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Input JSON must be an array");

  const reviews: InputReview[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as Record<string, unknown>).id ?? "");
    const text = String((item as Record<string, unknown>).text ?? "");
    const titleValue = (item as Record<string, unknown>).title;
    const title = titleValue === null || titleValue === undefined ? null : String(titleValue);
    if (!id || !text) continue;
    reviews.push({ id, title, text });
  }
  return reviews;
}

function normalizeTopicName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function buildJsonl(
  reviews: InputReview[],
  model: string,
  systemPrompt: string,
  extraBody: Record<string, unknown> = {},
): string {
  const lines: string[] = [];
  for (const review of reviews) {
    const line = {
      custom_id: review.id,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model,
        ...extraBody,
        response_format: REVIEW_ANALYSIS_SCHEMA_COMPAT,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildReviewUserMessage(review.title ?? "", review.text) },
        ],
      },
    };
    lines.push(JSON.stringify(line));
  }
  return `${lines.join("\n")}\n`;
}

async function uploadJsonl(apiKey: string, jsonl: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([jsonl], { type: "application/jsonl" }), filename);

  const res = await fetch(`${OPENAI_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`File upload failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  if (!json?.id) throw new Error("File upload returned no id");
  return json.id as string;
}

async function createBatch(apiKey: string, fileId: string, model: string): Promise<string> {
  const res = await fetch(`${OPENAI_API}/batches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_file_id: fileId,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: { task: "topic_compare", model },
    }),
  });
  if (!res.ok) throw new Error(`Batch create failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  if (!json?.id) throw new Error("Batch create returned no id");
  return json.id as string;
}

async function pollBatchUntilDone(
  apiKey: string,
  batchId: string,
  label: string,
  pollIntervalMs: number,
): Promise<{ outputFileId: string; status: string }> {
  while (true) {
    const res = await fetch(`${OPENAI_API}/batches/${batchId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Batch status failed (${label}): ${res.status}`);

    const json = await res.json();
    const status = String(json?.status ?? "unknown");
    console.log(`[${label}] status=${status}`);

    if (status === "completed") {
      if (!json?.output_file_id) throw new Error(`Batch completed without output_file_id (${label})`);
      return { outputFileId: String(json.output_file_id), status };
    }
    if (status === "failed" || status === "expired" || status === "cancelled") {
      throw new Error(`Batch ${label} ended with status=${status}`);
    }

    await sleep(pollIntervalMs);
  }
}

async function downloadBatchOutput(apiKey: string, outputFileId: string): Promise<string> {
  const res = await fetch(`${OPENAI_API}/files/${outputFileId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Batch output download failed: ${res.status}`);
  return await res.text();
}

function parseBatchOutput(text: string): Map<string, ModelResponse> {
  const map = new Map<string, ModelResponse>();
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    let parsed: OpenAIBatchResponseLine;
    try {
      parsed = JSON.parse(line) as OpenAIBatchResponseLine;
    } catch {
      continue;
    }

    const customId = parsed.custom_id;
    if (!customId) continue;

    if (parsed.error) {
      map.set(customId, {
        ok: false,
        error: parsed.error.message ?? "Unknown batch line error",
      });
      continue;
    }

    const statusCode = parsed.response?.status_code ?? 0;
    const content = parsed.response?.body?.choices?.[0]?.message?.content;
    const usage = parsed.response?.body?.usage;

    if (statusCode < 200 || statusCode >= 300) {
      map.set(customId, { ok: false, error: `Status ${statusCode}`, usage });
      continue;
    }
    if (typeof content !== "string") {
      map.set(customId, { ok: false, error: "Missing content in output", usage });
      continue;
    }

    try {
      const result = JSON.parse(content) as ReviewResult;
      map.set(customId, { ok: true, result, usage, rawContent: content });
    } catch (error) {
      map.set(customId, {
        ok: false,
        error: `Invalid JSON content: ${error instanceof Error ? error.message : String(error)}`,
        usage,
        rawContent: content,
      });
    }
  }

  return map;
}

function compareResults(row: {
  id: string;
  baseline: ModelResponse;
  candidate: ModelResponse;
}): CompareRow {
  if (!row.baseline.ok || !row.candidate.ok || !row.baseline.result || !row.candidate.result) {
    return {
      id: row.id,
      baseline: row.baseline,
      candidate: row.candidate,
      overlap_jaccard: null,
      common_topics: [],
      baseline_only_topics: [],
      candidate_only_topics: [],
      avg_score_delta_on_common: null,
      sentiment_delta: null,
    };
  }

  const baseTopics = row.baseline.result.italian_topics ?? [];
  const candTopics = row.candidate.result.italian_topics ?? [];

  const baseMap = new Map<string, Topic>();
  const candMap = new Map<string, Topic>();
  for (const t of baseTopics) baseMap.set(normalizeTopicName(t.italian_name), t);
  for (const t of candTopics) candMap.set(normalizeTopicName(t.italian_name), t);

  const baseSet = new Set(baseMap.keys());
  const candSet = new Set(candMap.keys());
  const commonTopics = [...baseSet].filter((t) => candSet.has(t));
  const baselineOnlyTopics = [...baseSet].filter((t) => !candSet.has(t));
  const candidateOnlyTopics = [...candSet].filter((t) => !baseSet.has(t));

  const unionSize = new Set([...baseSet, ...candSet]).size;
  const overlapJaccard = unionSize === 0 ? 1 : commonTopics.length / unionSize;

  let avgScoreDeltaOnCommon: number | null = null;
  if (commonTopics.length > 0) {
    const total = commonTopics.reduce((acc, topicName) => {
      const b = baseMap.get(topicName)?.score ?? 0;
      const c = candMap.get(topicName)?.score ?? 0;
      return acc + (c - b);
    }, 0);
    avgScoreDeltaOnCommon = total / commonTopics.length;
  }

  return {
    id: row.id,
    baseline: row.baseline,
    candidate: row.candidate,
    overlap_jaccard: overlapJaccard,
    common_topics: commonTopics,
    baseline_only_topics: baselineOnlyTopics,
    candidate_only_topics: candidateOnlyTopics,
    avg_score_delta_on_common: avgScoreDeltaOnCommon,
    sentiment_delta: row.candidate.result.sentiment - row.baseline.result.sentiment,
  };
}

function buildSummary(rows: CompareRow[]): Summary {
  const bothSuccessRows = rows.filter((r) => r.baseline.ok && r.candidate.ok);
  const avg = (nums: number[]): number | null =>
    nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;

  const baselineTokensTotal = rows.reduce(
    (acc, row) => acc + (row.baseline.usage?.total_tokens ?? 0),
    0,
  );
  const candidateTokensTotal = rows.reduce(
    (acc, row) => acc + (row.candidate.usage?.total_tokens ?? 0),
    0,
  );

  return {
    total_reviews: rows.length,
    baseline_success: rows.filter((r) => r.baseline.ok).length,
    candidate_success: rows.filter((r) => r.candidate.ok).length,
    both_success: bothSuccessRows.length,
    avg_jaccard: avg(
      bothSuccessRows
        .map((r) => r.overlap_jaccard)
        .filter((n): n is number => typeof n === "number"),
    ),
    avg_common_topics: avg(bothSuccessRows.map((r) => r.common_topics.length)),
    avg_baseline_only_topics: avg(bothSuccessRows.map((r) => r.baseline_only_topics.length)),
    avg_candidate_only_topics: avg(bothSuccessRows.map((r) => r.candidate_only_topics.length)),
    avg_abs_sentiment_delta: avg(
      bothSuccessRows
        .map((r) => r.sentiment_delta)
        .filter((n): n is number => typeof n === "number")
        .map((n) => Math.abs(n)),
    ),
    avg_abs_topic_score_delta_common: avg(
      bothSuccessRows
        .map((r) => r.avg_score_delta_on_common)
        .filter((n): n is number => typeof n === "number")
        .map((n) => Math.abs(n)),
    ),
    baseline_tokens_total: baselineTokensTotal,
    candidate_tokens_total: candidateTokensTotal,
  };
}

function defaultOutPath(baselineModel: string, candidateModel: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(
    process.cwd(),
    "scripts",
    "reports",
    `topic-compare-batch-${baselineModel}-vs-${candidateModel}-${timestamp}.json`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const inputReviews = safeParseReviews(args.inputPath);
  const reviews = typeof args.limit === "number" ? inputReviews.slice(0, args.limit) : inputReviews;
  if (reviews.length === 0) throw new Error("No valid reviews found in input");

  const basePrompt = buildReviewSystemPrompt(args.sectorName, args.categories);
  const systemPrompt = args.promptSuffix ? `${basePrompt}\n\n${args.promptSuffix}` : basePrompt;

  let baselineBatchId = args.baselineBatchId;
  let candidateBatchId = args.candidateBatchId;
  const candidateExtraBody: Record<string, unknown> = {};
  if (args.candidateReasoningEffort) {
    candidateExtraBody.reasoning_effort = args.candidateReasoningEffort;
  }
  if (args.candidateVerbosity) {
    candidateExtraBody.verbosity = args.candidateVerbosity;
  }

  console.log(
    `Preparing batches for ${reviews.length} reviews: baseline=${args.baselineModel}, candidate=${args.candidateModel}`,
  );

  if (baselineBatchId) {
    console.log(`Reusing baseline batch: ${baselineBatchId}`);
  } else {
    const baselineJsonl = buildJsonl(reviews, args.baselineModel, systemPrompt);
    const baselineFileId = await uploadJsonl(apiKey, baselineJsonl, "baseline-batch.jsonl");
    baselineBatchId = await createBatch(apiKey, baselineFileId, args.baselineModel);
    console.log(`Created baseline batch: ${baselineBatchId}`);
  }

  if (candidateBatchId) {
    console.log(`Reusing candidate batch: ${candidateBatchId}`);
  } else {
    const candidateJsonl = buildJsonl(
      reviews,
      args.candidateModel,
      systemPrompt,
      candidateExtraBody,
    );
    const candidateFileId = await uploadJsonl(apiKey, candidateJsonl, "candidate-batch.jsonl");
    candidateBatchId = await createBatch(apiKey, candidateFileId, args.candidateModel);
    console.log(`Created candidate batch: ${candidateBatchId}`);
  }

  if (!baselineBatchId || !candidateBatchId) {
    throw new Error("Missing batch ids after preparation");
  }

  const [baselineDone, candidateDone] = await Promise.all([
    pollBatchUntilDone(apiKey, baselineBatchId, "baseline", args.pollIntervalMs),
    pollBatchUntilDone(apiKey, candidateBatchId, "candidate", args.pollIntervalMs),
  ]);

  const [baselineOutputText, candidateOutputText] = await Promise.all([
    downloadBatchOutput(apiKey, baselineDone.outputFileId),
    downloadBatchOutput(apiKey, candidateDone.outputFileId),
  ]);

  const baselineMap = parseBatchOutput(baselineOutputText);
  const candidateMap = parseBatchOutput(candidateOutputText);

  const rows: CompareRow[] = reviews.map((review) => {
    const baseline = baselineMap.get(review.id) ?? { ok: false, error: "Missing baseline result" };
    const candidate = candidateMap.get(review.id) ?? { ok: false, error: "Missing candidate result" };
    return compareResults({ id: review.id, baseline, candidate });
  });

  const summary = buildSummary(rows);
  const outPath = args.outPath ? resolve(args.outPath) : defaultOutPath(args.baselineModel, args.candidateModel);
  mkdirSync(dirname(outPath), { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    mode: "batch_parallel",
    config: {
      baseline_model: args.baselineModel,
      candidate_model: args.candidateModel,
      sector_name: args.sectorName,
      categories: args.categories,
      prompt_suffix: args.promptSuffix ?? null,
      candidate_reasoning_effort: args.candidateReasoningEffort ?? null,
      candidate_verbosity: args.candidateVerbosity ?? null,
      input_path: resolve(args.inputPath),
      reviews_processed: reviews.length,
      poll_interval_ms: args.pollIntervalMs,
      batches: {
        baseline_batch_id: baselineBatchId,
        candidate_batch_id: candidateBatchId,
      },
    },
    summary,
    rows,
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nReport saved to: ${outPath}`);
}

main().catch((error) => {
  console.error("Batch comparison failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
