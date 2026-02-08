import { BatchType } from "../enums";
import type {
  AIProvider,
  BatchJobStatus,
  BatchResult,
  BatchSubmission,
  ReviewAnalysisResult,
  ReviewForAnalysis,
  SwotAnalysisResult,
  TokenUsageInfo,
} from "./types";
import {
  buildReviewSystemPrompt,
  buildReviewUserMessage,
  REVIEW_ANALYSIS_SCHEMA,
  SWOT_SYSTEM_PROMPT,
  SWOT_ANALYSIS_SCHEMA,
} from "./prompts";

const OPENAI_API = "https://api.openai.com/v1";

interface OpenAIBatchLine {
  custom_id: string;
  method: string;
  url: string;
  body: Record<string, unknown>;
}

/**
 * Sanitize text: remove control characters, NFC normalize.
 */
function sanitizeText(text: string | null | undefined): string {
  if (!text) return "";
  // Remove control chars except newline/tab
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  supportsBatch(): boolean {
    return true;
  }

  // -- Review Batch --

  async submitReviewBatch(
    reviews: ReviewForAnalysis[],
    model: string,
    config: Record<string, unknown>,
  ): Promise<BatchSubmission> {
    // Group reviews by their category set (assumes single sector per batch)
    const categoryNames = reviews[0]?.business_sector_categories ?? [];
    const sectorName = (config.sector_name as string) ?? "general";

    const systemPrompt = buildReviewSystemPrompt(sectorName, categoryNames);
    const temperature = (config.temperature as number) ?? 0.1;

    // Build JSONL lines
    const lines: string[] = [];
    for (const review of reviews) {
      const title = sanitizeText(review.title);
      const text = sanitizeText(review.text);

      const line: OpenAIBatchLine = {
        custom_id: review.id,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model,
          temperature,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          response_format: REVIEW_ANALYSIS_SCHEMA,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildReviewUserMessage(title, text) },
          ],
        },
      };
      lines.push(JSON.stringify(line));
    }

    const jsonl = lines.join("\n") + "\n";

    // Upload file
    const fileId = await this.uploadBatchFile(jsonl);

    // Create batch
    const batchRes = await fetch(`${OPENAI_API}/batches`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        input_file_id: fileId,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
        metadata: { batch_type: "REVIEWS" },
      }),
    });

    if (!batchRes.ok) {
      throw new Error(`OpenAI batch create failed: ${batchRes.status} ${await batchRes.text()}`);
    }

    const batch = await batchRes.json();

    return {
      batchId: batch.id,
      provider: this.name,
      batchType: BatchType.REVIEWS,
      reviewCount: reviews.length,
    };
  }

  async checkBatchStatus(batchId: string): Promise<BatchJobStatus> {
    const res = await fetch(`${OPENAI_API}/batches/${batchId}`, {
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`OpenAI batch status failed: ${res.status}`);
    }

    const data = await res.json();
    const statusMap: Record<string, BatchJobStatus> = {
      validating: "validating",
      in_progress: "in_progress",
      completed: "completed",
      failed: "failed",
      expired: "expired",
      cancelling: "in_progress",
      cancelled: "cancelled",
      finalizing: "in_progress",
    };

    return statusMap[data.status] ?? "in_progress";
  }

  async retrieveBatchResults(
    batchId: string,
  ): Promise<BatchResult<ReviewAnalysisResult>[]> {
    // Get batch to find output file
    const batchRes = await fetch(`${OPENAI_API}/batches/${batchId}`, {
      headers: this.headers,
    });
    if (!batchRes.ok) throw new Error(`OpenAI batch fetch failed: ${batchRes.status}`);

    const batch = await batchRes.json();
    if (!batch.output_file_id) {
      throw new Error("Batch has no output file yet");
    }

    // Download results file
    const fileRes = await fetch(`${OPENAI_API}/files/${batch.output_file_id}/content`, {
      headers: this.headers,
    });
    if (!fileRes.ok) throw new Error(`OpenAI file download failed: ${fileRes.status}`);

    const text = await fileRes.text();
    const lines = text.trim().split("\n");

    return lines.map((line) => this.parseResultLine<ReviewAnalysisResult>(line));
  }

  // -- Review Direct --

  async analyzeReviewsDirect(
    reviews: ReviewForAnalysis[],
    model: string,
    config: Record<string, unknown>,
  ): Promise<{ results: BatchResult<ReviewAnalysisResult>[]; usage: TokenUsageInfo }> {
    const categoryNames = reviews[0]?.business_sector_categories ?? [];
    const sectorName = (config.sector_name as string) ?? "general";
    const systemPrompt = buildReviewSystemPrompt(sectorName, categoryNames);
    const temperature = (config.temperature as number) ?? 0.1;

    const results: BatchResult<ReviewAnalysisResult>[] = [];
    let totalUsage: TokenUsageInfo = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    for (const review of reviews) {
      try {
        const res = await fetch(`${OPENAI_API}/chat/completions`, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({
            model,
            temperature,
            top_p: 1,
            response_format: REVIEW_ANALYSIS_SCHEMA,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: buildReviewUserMessage(
                  sanitizeText(review.title),
                  sanitizeText(review.text),
                ),
              },
            ],
          }),
        });

        if (!res.ok) {
          results.push({ customId: review.id, result: null, error: `API ${res.status}`, usage: null });
          continue;
        }

        const data = await res.json();
        const choice = data.choices?.[0];
        const content = choice?.message?.content;
        const usage = data.usage as TokenUsageInfo | undefined;

        if (usage) {
          totalUsage.prompt_tokens += usage.prompt_tokens;
          totalUsage.completion_tokens += usage.completion_tokens;
          totalUsage.total_tokens += usage.total_tokens;
        }

        const parsed = JSON.parse(content) as ReviewAnalysisResult;
        results.push({ customId: review.id, result: parsed, error: null, usage: usage ?? null });
      } catch (err) {
        results.push({
          customId: review.id,
          result: null,
          error: err instanceof Error ? err.message : String(err),
          usage: null,
        });
      }
    }

    return { results, usage: totalUsage };
  }

  // -- SWOT Batch --

  async submitSwotBatch(
    swotId: string,
    reviewsText: string,
    model: string,
    config: Record<string, unknown>,
  ): Promise<BatchSubmission> {
    const temperature = (config.temperature as number) ?? 0.1;

    const line: OpenAIBatchLine = {
      custom_id: swotId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model,
        temperature,
        top_p: 1,
        response_format: SWOT_ANALYSIS_SCHEMA,
        messages: [
          { role: "system", content: SWOT_SYSTEM_PROMPT },
          { role: "user", content: reviewsText },
        ],
      },
    };

    const jsonl = JSON.stringify(line) + "\n";
    const fileId = await this.uploadBatchFile(jsonl);

    const batchRes = await fetch(`${OPENAI_API}/batches`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        input_file_id: fileId,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
        metadata: { batch_type: "SWOT", swot_id: swotId },
      }),
    });

    if (!batchRes.ok) {
      throw new Error(`OpenAI SWOT batch create failed: ${batchRes.status}`);
    }

    const batch = await batchRes.json();
    return {
      batchId: batch.id,
      provider: this.name,
      batchType: BatchType.SWOT,
      reviewCount: 1,
    };
  }

  async retrieveSwotBatchResults(
    batchId: string,
  ): Promise<BatchResult<SwotAnalysisResult>[]> {
    const batchRes = await fetch(`${OPENAI_API}/batches/${batchId}`, {
      headers: this.headers,
    });
    if (!batchRes.ok) throw new Error(`OpenAI batch fetch failed: ${batchRes.status}`);

    const batch = await batchRes.json();
    if (!batch.output_file_id) throw new Error("Batch has no output file yet");

    const fileRes = await fetch(`${OPENAI_API}/files/${batch.output_file_id}/content`, {
      headers: this.headers,
    });
    if (!fileRes.ok) throw new Error(`OpenAI file download failed: ${fileRes.status}`);

    const text = await fileRes.text();
    const lines = text.trim().split("\n");

    return lines.map((line) => this.parseResultLine<SwotAnalysisResult>(line));
  }

  // -- SWOT Direct --

  async analyzeSwotDirect(
    swotId: string,
    reviewsText: string,
    model: string,
    config: Record<string, unknown>,
  ): Promise<{ result: SwotAnalysisResult; usage: TokenUsageInfo }> {
    const temperature = (config.temperature as number) ?? 0.1;

    const res = await fetch(`${OPENAI_API}/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        model,
        temperature,
        top_p: 1,
        response_format: SWOT_ANALYSIS_SCHEMA,
        messages: [
          { role: "system", content: SWOT_SYSTEM_PROMPT },
          { role: "user", content: reviewsText },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI SWOT direct failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const result = JSON.parse(content) as SwotAnalysisResult;
    const usage = data.usage as TokenUsageInfo;

    return { result, usage };
  }

  // -- Private helpers --

  private async uploadBatchFile(jsonl: string): Promise<string> {
    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const form = new FormData();
    form.append("file", blob, "batch.jsonl");
    form.append("purpose", "batch");

    const res = await fetch(`${OPENAI_API}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      throw new Error(`OpenAI file upload failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data.id;
  }

  private parseResultLine<T>(line: string): BatchResult<T> {
    try {
      const parsed = JSON.parse(line);
      const customId = parsed.custom_id as string;
      const response = parsed.response;

      if (response?.status_code !== 200) {
        return {
          customId,
          result: null,
          error: `API error: ${response?.status_code}`,
          usage: null,
        };
      }

      const body = response.body;
      const content = body?.choices?.[0]?.message?.content;
      const usage = body?.usage as TokenUsageInfo | undefined;
      const result = JSON.parse(content) as T;

      return { customId, result, error: null, usage: usage ?? null };
    } catch (err) {
      return {
        customId: "unknown",
        result: null,
        error: err instanceof Error ? err.message : String(err),
        usage: null,
      };
    }
  }
}
