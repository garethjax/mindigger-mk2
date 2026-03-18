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
