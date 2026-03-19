import type {
  AIConfig as SharedAIConfig,
  AIBatch as SharedAIBatch,
  TokenUsage,
} from "@shared/types";

// Re-export DB-level types from @shared
export type AIConfig = SharedAIConfig;

// TokenUsageRow extends the shared TokenUsage with the Supabase join field
export interface TokenUsageRow extends Omit<TokenUsage, "id" | "created_at"> {
  businesses: { name: string } | null;
}

// BatchMetadata is view-specific (describes the JSON blob stored in ai_batches.metadata)
export interface BatchMetadata {
  business_id?: string;
  review_count?: number;
  model?: string;
  fixed?: number;
  failed?: number;
  [key: string]: unknown;
}

// Batch extends the shared AIBatch with a typed metadata field.
// Uses `string` for batch_type/status to stay compatible with Supabase query results
// which return plain strings rather than enum values.
export interface Batch extends Omit<SharedAIBatch, "metadata" | "batch_type" | "status"> {
  batch_type: string;
  status: string;
  metadata?: BatchMetadata;
}

// UI-specific types — no shared equivalent
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
