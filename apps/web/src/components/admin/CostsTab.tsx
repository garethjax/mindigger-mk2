import type { TokenUsageRow, PricingRow, CreditBalance } from "./ai-config-types";
import { computeCost } from "./cost-calculation";

interface Props {
  tokenUsage: TokenUsageRow[];
  pricing: PricingRow[];
  creditBalance: CreditBalance | null;
}

export default function CostsTab({ tokenUsage, pricing, creditBalance }: Props) {
  // Cost computation
  const totalCost = tokenUsage.reduce(
    (sum, t) => sum + computeCost(t, pricing),
    0,
  );

  // Credit balance: remaining = initial - costs after reference date
  const costAfterRef = creditBalance
    ? tokenUsage
        .filter((t) => t.date > creditBalance.reference_date)
        .reduce((sum, t) => sum + computeCost(t, pricing), 0)
    : 0;
  const remainingCredit = creditBalance
    ? creditBalance.initial_amount - costAfterRef
    : null;

  // Costs by business
  const costsByBusiness = new Map<
    string,
    { name: string; prompt: number; cached: number; completion: number; cost: number }
  >();
  for (const t of tokenUsage) {
    const key = t.business_id;
    const existing = costsByBusiness.get(key);
    const cost = computeCost(t, pricing);
    if (existing) {
      existing.prompt += t.prompt_tokens;
      existing.cached += t.cached_tokens;
      existing.completion += t.completion_tokens;
      existing.cost += cost;
    } else {
      costsByBusiness.set(key, {
        name: t.businesses?.name ?? t.business_id.slice(0, 8),
        prompt: t.prompt_tokens,
        cached: t.cached_tokens,
        completion: t.completion_tokens,
        cost,
      });
    }
  }

  return (
    <div class="space-y-4">
      {/* Balance + Total cost cards */}
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        {remainingCredit !== null && creditBalance && (
          <div class="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <div class="text-sm text-gray-500">Credito residuo stimato</div>
            <div class="text-2xl font-bold text-blue-700">${remainingCredit.toFixed(2)}</div>
            <div class="mt-1 text-xs text-gray-400">
              Checkpoint: ${creditBalance.initial_amount.toFixed(2)} al {creditBalance.reference_date}
              {costAfterRef > 0 && (
                <span> &mdash; spesi ${costAfterRef.toFixed(2)} da allora</span>
              )}
            </div>
          </div>
        )}
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <div class="text-sm text-gray-500">Costo stimato totale (batch mode, -50%)</div>
          <div class="text-2xl font-bold text-green-700">${totalCost.toFixed(2)}</div>
          <div class="mt-1 text-xs text-gray-400">
            Basato su {tokenUsage.length} record
          </div>
        </div>
      </div>

      {/* Cost by business */}
      <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-100 px-4 py-3">
          <h3 class="text-sm font-bold text-gray-500">Costo per Business</h3>
        </div>
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Business</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Input</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Cached</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Output</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Costo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            {[...costsByBusiness.entries()]
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([id, info]) => (
                <tr key={id}>
                  <td class="px-4 py-2 text-sm text-gray-700">{info.name}</td>
                  <td class="px-4 py-2 text-right font-mono text-xs">{info.prompt.toLocaleString()}</td>
                  <td class="px-4 py-2 text-right font-mono text-xs text-amber-600">{info.cached.toLocaleString()}</td>
                  <td class="px-4 py-2 text-right font-mono text-xs">{info.completion.toLocaleString()}</td>
                  <td class="px-4 py-2 text-right font-mono text-sm font-medium text-green-700">
                    ${info.cost.toFixed(2)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {costsByBusiness.size === 0 && (
          <div class="p-8 text-center text-sm text-gray-400">Nessun dato.</div>
        )}
      </div>

      {/* Daily detail */}
      <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-100 px-4 py-3">
          <h3 class="text-sm font-bold text-gray-500">Dettaglio giornaliero</h3>
        </div>
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Data</th>
              <th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Business</th>
              <th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tipo</th>
              <th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Model</th>
              <th class="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Input</th>
              <th class="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Cached</th>
              <th class="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Output</th>
              <th class="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Costo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            {tokenUsage.slice(0, 50).map((t, i) => {
              const cost = computeCost(t, pricing);
              return (
                <tr key={i}>
                  <td class="px-3 py-2 text-xs text-gray-600">{t.date}</td>
                  <td class="px-3 py-2 text-xs text-gray-600">{t.businesses?.name ?? "—"}</td>
                  <td class="px-3 py-2 text-xs text-gray-500">{t.batch_type}</td>
                  <td class="px-3 py-2 font-mono text-xs text-gray-500">{t.model}</td>
                  <td class="px-3 py-2 text-right font-mono text-xs">{(t.prompt_tokens - t.cached_tokens).toLocaleString()}</td>
                  <td class="px-3 py-2 text-right font-mono text-xs text-amber-600">{t.cached_tokens.toLocaleString()}</td>
                  <td class="px-3 py-2 text-right font-mono text-xs">{t.completion_tokens.toLocaleString()}</td>
                  <td class="px-3 py-2 text-right font-mono text-xs font-medium text-green-700">${cost.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {tokenUsage.length === 0 && (
          <div class="p-8 text-center text-sm text-gray-400">Nessun dato.</div>
        )}
      </div>

      {/* Pricing reference */}
      {pricing.length > 0 && (
        <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div class="border-b border-gray-100 px-4 py-3">
            <h3 class="text-sm font-bold text-gray-500">Prezzi configurati ($/1M tokens)</h3>
          </div>
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Provider</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Model</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Mode</th>
                <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Input</th>
                <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Cached</th>
                <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Output</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {pricing.map((p) => (
                <tr key={p.id}>
                  <td class="px-4 py-2 text-xs text-gray-700">{p.provider}</td>
                  <td class="px-4 py-2 font-mono text-xs text-gray-700">{p.model}</td>
                  <td class="px-4 py-2 text-xs text-gray-500">{p.mode}</td>
                  <td class="px-4 py-2 text-right font-mono text-xs">${p.input_price}</td>
                  <td class="px-4 py-2 text-right font-mono text-xs text-amber-600">${p.cached_input_price}</td>
                  <td class="px-4 py-2 text-right font-mono text-xs">${p.output_price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
