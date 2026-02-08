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

/**
 * Gemini AI provider — stub implementation.
 * Will support both Batch (Vertex AI) and Direct mode.
 * Requires Google AI Studio API key or GCP service account.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  constructor(_apiKey: string) {
    // Will be used when implemented
  }

  supportsBatch(): boolean {
    return true;
  }

  async submitReviewBatch(
    _reviews: ReviewForAnalysis[],
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<BatchSubmission> {
    throw new Error("GeminiProvider.submitReviewBatch not implemented yet");
  }

  async checkBatchStatus(_batchId: string): Promise<BatchJobStatus> {
    throw new Error("GeminiProvider.checkBatchStatus not implemented yet");
  }

  async retrieveBatchResults(
    _batchId: string,
  ): Promise<BatchResult<ReviewAnalysisResult>[]> {
    throw new Error("GeminiProvider.retrieveBatchResults not implemented yet");
  }

  async analyzeReviewsDirect(
    _reviews: ReviewForAnalysis[],
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<{ results: BatchResult<ReviewAnalysisResult>[]; usage: TokenUsageInfo }> {
    throw new Error("GeminiProvider.analyzeReviewsDirect not implemented yet");
  }

  async submitSwotBatch(
    _swotId: string,
    _reviewsText: string,
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<BatchSubmission> {
    throw new Error("GeminiProvider.submitSwotBatch not implemented yet");
  }

  async retrieveSwotBatchResults(
    _batchId: string,
  ): Promise<BatchResult<SwotAnalysisResult>[]> {
    throw new Error("GeminiProvider.retrieveSwotBatchResults not implemented yet");
  }

  async analyzeSwotDirect(
    _swotId: string,
    _reviewsText: string,
    _model: string,
    _config: Record<string, unknown>,
  ): Promise<{ result: SwotAnalysisResult; usage: TokenUsageInfo }> {
    throw new Error("GeminiProvider.analyzeSwotDirect not implemented yet");
  }
}
