import { describe, expect, test } from "bun:test";
import { buildBatchPollSummary } from "../ai-batch-poll-summary";

describe("buildBatchPollSummary", () => {
  test("explains when all checked batches are still processing", () => {
    expect(
      buildBatchPollSummary([
        { status: "still_processing" },
        { status: "locked_by_other" },
        { status: "still_processing" },
        { status: "validating" },
      ]),
    ).toBe("Controllo status completato: 4 ancora in corso.");
  });

  test("summarizes mixed outcomes", () => {
    expect(
      buildBatchPollSummary([
        { status: "completed" },
        { status: "failed" },
        { status: "cancelled" },
        { status: "still_processing" },
      ]),
    ).toBe("Controllo status completato: 1 completati, 1 ancora in corso, 1 con errore, 1 cancellati.");
  });
});
