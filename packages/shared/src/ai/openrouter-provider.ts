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

/**
 * OpenRouter AI provider — stub implementation.
 * Supports Direct mode only (no batch API).
 * Compatible with OpenAI API format, routes to many models.
 */
export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter";

  constructor(_apiKey: string) {
    // Will be used when implemented
  }

  supportsBatch(): boolean {
    return false;
  }

  async submitReviewBatch(
    _reviews: ReviewForAnalysis[],
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<BatchSubmission> {
    throw new Error("OpenRouter does not support batch mode");
  }

  async checkBatchStatus(_batchId: string): Promise<BatchJobStatus> {
    throw new Error("OpenRouter does not support batch mode");
  }

  async retrieveBatchResults(
    _batchId: string,
  ): Promise<BatchResult<ReviewAnalysisResult>[]> {
    throw new Error("OpenRouter does not support batch mode");
  }

  async analyzeReviewsDirect(
    _reviews: ReviewForAnalysis[],
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<{ results: BatchResult<ReviewAnalysisResult>[]; usage: TokenUsageInfo }> {
    throw new Error("OpenRouterProvider.analyzeReviewsDirect not implemented yet");
  }

  async submitSwotBatch(
    _swotId: string,
    _reviewsText: string,
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<BatchSubmission> {
    throw new Error("OpenRouter does not support batch mode");
  }

  async retrieveSwotBatchResults(
    _batchId: string,
  ): Promise<BatchResult<SwotAnalysisResult>[]> {
    throw new Error("OpenRouter does not support batch mode");
  }

  async analyzeSwotDirect(
    _swotId: string,
    _reviewsText: string,
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<{ result: SwotAnalysisResult; usage: TokenUsageInfo }> {
    throw new Error("OpenRouterProvider.analyzeSwotDirect not implemented yet");
  }
}
