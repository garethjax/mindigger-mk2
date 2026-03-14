export type FunctionInvokeError = {
  message: string;
  context?: Pick<Response, "status" | "text"> | null;
};

export async function formatFunctionInvokeError(error: FunctionInvokeError): Promise<string> {
  const context = error.context;
  if (!context) {
    return error.message;
  }

  const bodyText = await context.text().catch(() => "");
  return `HTTP ${context.status}${bodyText ? ` - ${bodyText}` : ""}`;
}

export interface EditableLocation {
  id: string;
  name: string;
  is_competitor: boolean;
  business_sector_id: string;
  recurring_updates: boolean;
  created_at: string;
}

export function buildLocationUpdatePayload(input: {
  name: string;
  businessSectorId: string;
  isCompetitor: boolean;
}) {
  return {
    name: input.name.trim(),
    business_sector_id: input.businessSectorId,
    is_competitor: input.isCompetitor,
  };
}

export function applyLocationUpdate<T extends EditableLocation>(
  locations: T[],
  updated: Pick<T, "id"> & ReturnType<typeof buildLocationUpdatePayload>,
): T[] {
  return locations.map((location) =>
    location.id === updated.id
      ? {
          ...location,
          ...updated,
        }
      : location
  );
}

type ScrapingPlatform = "google_maps" | "tripadvisor" | "booking" | "trustpilot";

const SCRAPING_FIELD_META: Record<
  ScrapingPlatform,
  { field: string; label: string; inputType: "text" | "url"; placeholder: string }
> = {
  google_maps: {
    field: "place_id",
    label: "Google Maps — Place ID",
    inputType: "text",
    placeholder: "ChIJ...",
  },
  tripadvisor: {
    field: "location_url",
    label: "TripAdvisor — URL",
    inputType: "url",
    placeholder: "https://tripadvisor.com/...",
  },
  booking: {
    field: "location_url",
    label: "Booking.com — URL",
    inputType: "url",
    placeholder: "https://booking.com/hotel/...",
  },
  trustpilot: {
    field: "location_url",
    label: "Trustpilot — URL",
    inputType: "url",
    placeholder: "https://trustpilot.com/review/...",
  },
};

export function getScrapingConfigFieldMeta(platform: string) {
  return SCRAPING_FIELD_META[platform as ScrapingPlatform] ?? {
    field: "value",
    label: `${platform} — Config`,
    inputType: "text" as const,
    placeholder: "",
  };
}

export function getScrapingConfigFieldValue(
  platform: string,
  platformConfig: Record<string, string>,
): string {
  const meta = getScrapingConfigFieldMeta(platform);
  return platformConfig[meta.field] ?? "";
}

export function buildScrapingConfigUpdatePayload(platform: string, value: string) {
  const meta = getScrapingConfigFieldMeta(platform);
  return {
    platform_config: {
      [meta.field]: value.trim(),
    },
  };
}

export function isScrapingConfigBusy(status: string): boolean {
  return status === "elaborating" || status === "checking";
}

export function getToastDuration(type: "ok" | "err"): number {
  return type === "ok" ? 4000 : 8000;
}
