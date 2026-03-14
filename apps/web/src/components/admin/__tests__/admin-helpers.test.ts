import { describe, expect, test } from "bun:test";
import {
  applyLocationUpdate,
  buildLocationUpdatePayload,
  formatFunctionInvokeError,
  type EditableLocation,
} from "../helpers";

describe("formatFunctionInvokeError", () => {
  test("includes http status and response body when available", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };

    await expect(formatFunctionInvokeError(error)).resolves.toBe(
      'HTTP 403 - {"error":"Admin access required"}',
    );
  });
});

describe("location reclassification helpers", () => {
  test("builds a trimmed payload and applies it to the matching location", () => {
    const original: EditableLocation[] = [
      {
        id: "loc-1",
        name: "Foresteria Villa Cerna",
        is_competitor: false,
        business_sector_id: "hospitality",
        recurring_updates: true,
        created_at: "2026-03-14T12:00:00.000Z",
      },
      {
        id: "loc-2",
        name: "Competitor",
        is_competitor: true,
        business_sector_id: "restaurant",
        recurring_updates: false,
        created_at: "2026-03-14T12:00:00.000Z",
      },
    ];

    const payload = buildLocationUpdatePayload({
      name: "  Villa Cerna Ristorante  ",
      businessSectorId: "restaurant",
      isCompetitor: true,
    });

    expect(payload).toEqual({
      name: "Villa Cerna Ristorante",
      business_sector_id: "restaurant",
      is_competitor: true,
    });

    expect(
      applyLocationUpdate(original, {
        id: "loc-1",
        ...payload,
      }),
    ).toEqual([
      {
        ...original[0],
        name: "Villa Cerna Ristorante",
        business_sector_id: "restaurant",
        is_competitor: true,
      },
      original[1],
    ]);
  });
});
