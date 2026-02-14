import type {
  Platform,
  UserRole,
  ReviewStatus,
  ScrapingStatus,
  ScrapingFrequency,
  BatchStatus,
  BatchType,
  AIMode,
  EmbeddingsStatus,
  SwotPeriod,
} from "./enums";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  avatar_url: string | null;
  account_enabled: boolean;
  account_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessSector {
  id: string;
  name: string;
  platforms: Platform[];
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  business_sector_id: string;
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  type: string | null;
  logo_url: string | null;
  user_id: string;
  embeddings_enabled: boolean;
  embeddings_status: EmbeddingsStatus;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  name: string;
  business_id: string;
  business_sector_id: string;
  is_competitor: boolean;
  recurring_updates: boolean;
  report_sent: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScrapingConfig {
  id: string;
  location_id: string;
  platform: Platform;
  platform_config: PlatformConfig;
  initial_depth: number;
  recurring_depth: number;
  frequency: ScrapingFrequency;
  initial_scrape_done: boolean;
  status: ScrapingStatus;
  bot_id: string | null;
  retry_count: number;
  last_error: string | null;
  next_poll_at: string | null;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PlatformConfig =
  | { place_id: string }
  | { location_url: string };

export interface Review {
  id: string;
  location_id: string;
  business_id: string;
  source: Platform;
  title: string | null;
  text: string | null;
  url: string | null;
  rating: number | null;
  author: string | null;
  review_date: string | null;
  review_hash: string;
  raw_data: Record<string, unknown> | null;
  ai_result: AIResult | null;
  status: ReviewStatus;
  batched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIResult {
  italian_topics: {
    italian_name: string;
    score: number;
    italian_category: { name: string };
  }[];
  sentiment: number;
  language: string;
  italian_translation?: {
    italian_title: string;
    italian_text: string;
  };
}

export interface Topic {
  id: string;
  name: string;
  business_sector_id: string | null;
  created_at: string;
}

export interface TopicScore {
  id: string;
  review_id: string;
  topic_id: string;
  score: number;
  business_id: string;
  location_id: string;
  created_at: string;
}

export interface AIBatch {
  id: string;
  external_batch_id: string;
  provider: string;
  batch_type: BatchType;
  status: BatchStatus;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SwotAnalysis {
  id: string;
  location_id: string;
  business_id: string;
  period: SwotPeriod;
  statistics: SwotStatistics[] | null;
  results: SwotResult | null;
  status: ReviewStatus;
  batched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SwotStatistics {
  category_name: string;
  category_uid: string;
  total_reviews: number;
  high_ratings: { count: number; percentage: number };
  low_ratings: { count: number; percentage: number };
}

export interface SwotResult {
  strengths: { points: string[] };
  weaknesses: { points: string[] };
  opportunities: { points: string[] };
  threats: { points: string[] };
  operational_suggestions: {
    title: string;
    description: string;
  }[];
}

export interface AIConfig {
  id: string;
  provider: string;
  mode: AIMode;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TokenUsage {
  id: string;
  business_id: string;
  provider: string;
  batch_type: BatchType;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  date: string;
  created_at: string;
}
