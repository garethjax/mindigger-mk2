export enum Platform {
  GOOGLE_MAPS = "google_maps",
  TRIPADVISOR = "tripadvisor",
  BOOKING = "booking",
  TRUSTPILOT = "trustpilot",
}

export enum UserRole {
  ADMIN = "admin",
  BUSINESS = "business",
}

export enum ReviewStatus {
  PENDING = "pending",
  ANALYZING = "analyzing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum ScrapingStatus {
  IDLE = "idle",
  ELABORATING = "elaborating",
  CHECKING = "checking",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum ScrapingFrequency {
  WEEKLY = "weekly",
  MONTHLY = "monthly",
}

export enum BatchStatus {
  VALIDATING = "validating",
  FAILED = "failed",
  IN_PROGRESS = "in_progress",
  FINALIZING = "finalizing",
  COMPLETED = "completed",
  EXPIRED = "expired",
  CANCELLING = "cancelling",
  CANCELLED = "cancelled",
}

export enum BatchType {
  REVIEWS = "reviews",
  SWOT = "swot",
}

export enum AIMode {
  BATCH = "batch",
  DIRECT = "direct",
}

export enum SwotPeriod {
  LAST_3_MONTHS = "3",
  LAST_6_MONTHS = "6",
  LAST_12_MONTHS = "12",
  LAST_24_MONTHS = "24",
  LAST_36_MONTHS = "36",
  LAST_48_MONTHS = "48",
  LAST_60_MONTHS = "60",
}

/** Legacy bitfield mapping for migration reference */
export const LEGACY_BOT_BITFIELD = {
  GOOGLE: 1,
  TRIPADVISOR: 2,
  BOOKING: 4,
} as const;
