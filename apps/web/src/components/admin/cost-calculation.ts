import type { TokenUsageRow, PricingRow } from "./ai-config-types";

export function computeCost(row: TokenUsageRow, pricing: PricingRow[]): number {
  // Batch pricing (50% of direct) + incentivized tier estimate (another ~50% free)
  const p = pricing.find(
    (pr) => pr.provider === row.provider && pr.mode === "batch" &&
      (pr.model === row.model || row.model.startsWith(pr.model)),
  );
  if (!p) return 0;
  const uncachedInput = row.prompt_tokens - row.cached_tokens;
  return (
    (uncachedInput * p.input_price +
      row.cached_tokens * p.cached_input_price +
      row.completion_tokens * p.output_price) /
    1_000_000 /
    2
  );
}
