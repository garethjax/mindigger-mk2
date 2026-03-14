import { describe, expect, test } from "bun:test";
import { REVIEW_CLAIM_CHUNK_SIZE, chunkArray } from "./batching";

describe("review claim batching", () => {
  test("splits large review id lists into postgrest-safe chunks", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `review-${index}`);
    const chunks = chunkArray(ids, REVIEW_CLAIM_CHUNK_SIZE);

    expect(REVIEW_CLAIM_CHUNK_SIZE).toBe(100);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.length).toBe(100);
    expect(chunks[1]?.length).toBe(100);
    expect(chunks[2]?.length).toBe(50);
  });
});
