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
