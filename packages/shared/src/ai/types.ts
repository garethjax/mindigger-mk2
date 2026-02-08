import type { BatchType } from "../enums";

/**
 * Result of analyzing a single review.
 * Matches the structured output expected from the AI model.
 */
export interface ReviewAnalysisResult {
  italian_topics: {
    italian_name: string;
    score: number; // 1-5
    italian_category: { name: string };
  }[];
  sentiment: number; // 1-5
  language: string;
  italian_translation?: {
    italian_title: string;
    italian_text: string;
  };
}

/**
 * Result of a SWOT analysis.
 */
export interface SwotAnalysisResult {
  strengths: { points: string[] };
  weaknesses: { points: string[] };
  opportunities: { points: string[] };
  threats: { points: string[] };
  operational_suggestions: {
    title: string;
    description: string;
  }[];
}

/**
 * A review to be sent for AI analysis.
 */
export interface ReviewForAnalysis {
  id: string;
  title: string | null;
  text: string | null;
  business_sector_categories: string[]; // Available category names for this sector
}

/**
 * Token usage from a single API call or batch result.
 */
export interface TokenUsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Result of a batch submission.
 */
export interface BatchSubmission {
  batchId: string;
  provider: string;
  batchType: BatchType;
  reviewCount: number;
}

/**
 * Status of a batch job.
 */
export type BatchJobStatus =
  | "validating"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

/**
 * Result of retrieving batch results.
 */
export interface BatchResult<T> {
  customId: string;
  result: T | null;
  error: string | null;
  usage: TokenUsageInfo | null;
}

/**
 * AI Provider interface — Strategy Pattern.
 *
 * Each provider (OpenAI, Gemini, OpenRouter) implements this interface.
 * The factory reads `ai_configs` to pick the active provider.
 */
export interface AIProvider {
  readonly name: string;

  /** Whether this provider supports the Batch API (cheaper, async). */
  supportsBatch(): boolean;

  /**
   * Submit a batch of reviews for analysis.
   * Returns the external batch ID for tracking.
   */
  submitReviewBatch(
    reviews: ReviewForAnalysis[],
    model: string,
    config: Record<string, unknown>,
  ): Promise<BatchSubmission>;

  /**
   * Check the status of a batch job.
   */
  checkBatchStatus(batchId: string): Promise<BatchJobStatus>;

  /**
   * Retrieve results from a completed batch.
   */
  retrieveBatchResults(
    batchId: string,
  ): Promise<BatchResult<ReviewAnalysisResult>[]>;

  /**
   * Analyze reviews directly (synchronous, full price).
   * Used when batch is not supported or for small/urgent batches.
   */
  analyzeReviewsDirect(
    reviews: ReviewForAnalysis[],
    model: string,
    config: Record<string, unknown>,
  ): Promise<{ results: BatchResult<ReviewAnalysisResult>[]; usage: TokenUsageInfo }>;

  /**
   * Submit a SWOT analysis batch.
   */
  submitSwotBatch(
    swotId: string,
    reviewsText: string,
    model: string,
    config: Record<string, unknown>,
  ): Promise<BatchSubmission>;

  /**
   * Retrieve SWOT batch results.
   */
  retrieveSwotBatchResults(
    batchId: string,
  ): Promise<BatchResult<SwotAnalysisResult>[]>;

  /**
   * Run a SWOT analysis directly.
   */
  analyzeSwotDirect(
    swotId: string,
    reviewsText: string,
    model: string,
    config: Record<string, unknown>,
  ): Promise<{ result: SwotAnalysisResult; usage: TokenUsageInfo }>;
}
