/**
 * Compare topic extraction quality between two OpenAI models.
 *
 * Usage:
 *   OPENAI_API_KEY=... bun run scripts/compare-topic-extraction.ts \
 *     --input ./scripts/data/reviews-sample.json \
 *     --sector "Food & Beverage" \
 *     --categories "QUALITA_CIBO,SERVIZIO,PREZZO,AMBIENTE" \
 *     --candidate-model gpt-4.1-mini
 *
 * Input JSON format:
 * [
 *   { "id": "r1", "title": "Ottimo", "text": "..." },
 *   { "id": "r2", "title": "..." , "text": "..." }
 * ]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildReviewSystemPrompt,
  buildReviewUserMessage,
} from "../packages/shared/src/ai/prompts";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const DEFAULT_BASELINE_MODEL = "gpt-4.1";
const DEFAULT_TEMPERATURE = 0.1;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

// API-compat schema for strict structured output.
// Current OpenAI validation requires every property key to be present in "required".
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
                properties: {
                  name: { type: "string" },
                },
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
  italian_category: {
    name: string;
  };
};

type ReviewResult = {
  italian_topics: Topic[];
  sentiment: number;
  language: string;
  italian_translation?: {
    italian_title: string;
    italian_text: string;
  } | null;
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
  outPath?: string;
  limit?: number;
  temperature: number;
};

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
  const limitRaw = map.get("--limit");
  const tempRaw = map.get("--temperature");

  if (!inputPath || !sectorName || !categoriesRaw || !candidateModel) {
    printHelp();
    throw new Error("Missing required args: --input --sector --categories --candidate-model");
  }

  const categories = categoriesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (categories.length === 0) {
    throw new Error("At least one category is required in --categories");
  }

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const temperature = tempRaw ? Number.parseFloat(tempRaw) : DEFAULT_TEMPERATURE;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error("--temperature must be a number between 0 and 2");
  }

  return {
    inputPath,
    sectorName,
    categories,
    baselineModel,
    candidateModel,
    outPath,
    limit,
    temperature,
  };
}

function printHelp(): void {
  console.log(`
Compare topic extraction between two models

Required:
  --input <path>               JSON file with review array
  --sector <name>              Sector name used in system prompt
  --categories <csv>           Category names, comma-separated
  --candidate-model <model>    Model to compare against baseline

Optional:
  --baseline-model <model>     Default: ${DEFAULT_BASELINE_MODEL}
  --limit <n>                  Process first N reviews
  --temperature <n>            Default: ${DEFAULT_TEMPERATURE}
  --out <path>                 Output JSON path
  --help
`);
}

function normalizeTopicName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function safeParseReviews(path: string): InputReview[] {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Input JSON must be an array");
  }

  const reviews: InputReview[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as Record<string, unknown>).id ?? "");
    const text = String((item as Record<string, unknown>).text ?? "");
    const titleValue = (item as Record<string, unknown>).title;
    const title =
      titleValue === null || titleValue === undefined ? null : String(titleValue);
    if (!id || !text) continue;
    reviews.push({ id, title, text });
  }
  return reviews;
}

async function callModel(params: {
  apiKey: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  review: InputReview;
}): Promise<ModelResponse> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(OPENAI_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: params.model,
          response_format: REVIEW_ANALYSIS_SCHEMA_COMPAT,
          messages: [
            { role: "system", content: params.systemPrompt },
            {
              role: "user",
              content: buildReviewUserMessage(params.review.title ?? "", params.review.text),
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < MAX_RETRIES) continue;
        return { ok: false, error: `HTTP ${res.status}: ${body}` };
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        return { ok: false, error: "Missing content in response" };
      }

      try {
        const result = JSON.parse(content) as ReviewResult;
        return { ok: true, result, usage: json.usage as Usage, rawContent: content };
      } catch (error) {
        return {
          ok: false,
          error: `Invalid JSON content: ${error instanceof Error ? error.message : String(error)}`,
          usage: json.usage as Usage,
          rawContent: content,
        };
      }
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "TimeoutError";
      if (attempt < MAX_RETRIES) continue;
      return {
        ok: false,
        error: isAbort
          ? `Request timeout after ${REQUEST_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    }
  }

  return { ok: false, error: "Unreachable retry state" };
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
    avg_baseline_only_topics: avg(
      bothSuccessRows.map((r) => r.baseline_only_topics.length),
    ),
    avg_candidate_only_topics: avg(
      bothSuccessRows.map((r) => r.candidate_only_topics.length),
    ),
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
    `topic-compare-${baselineModel}-vs-${candidateModel}-${timestamp}.json`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  const inputReviews = safeParseReviews(args.inputPath);
  const reviews =
    typeof args.limit === "number" ? inputReviews.slice(0, args.limit) : inputReviews;

  if (reviews.length === 0) {
    throw new Error("No valid reviews found in input");
  }

  const systemPrompt = buildReviewSystemPrompt(args.sectorName, args.categories);
  const rows: CompareRow[] = [];

  console.log(
    `Comparing ${reviews.length} reviews: baseline=${args.baselineModel}, candidate=${args.candidateModel}`,
  );

  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i];
    console.log(`[${i + 1}/${reviews.length}] ${review.id}`);

    const baseline = await callModel({
      apiKey,
      model: args.baselineModel,
      temperature: args.temperature,
      systemPrompt,
      review,
    });

    const candidate = await callModel({
      apiKey,
      model: args.candidateModel,
      temperature: args.temperature,
      systemPrompt,
      review,
    });

    rows.push(compareResults({ id: review.id, baseline, candidate }));
  }

  const summary = buildSummary(rows);
  const outPath = args.outPath ? resolve(args.outPath) : defaultOutPath(args.baselineModel, args.candidateModel);
  mkdirSync(dirname(outPath), { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    config: {
      baseline_model: args.baselineModel,
      candidate_model: args.candidateModel,
      temperature: args.temperature,
      sector_name: args.sectorName,
      categories: args.categories,
      input_path: resolve(args.inputPath),
      reviews_processed: reviews.length,
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
  console.error("Comparison failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
