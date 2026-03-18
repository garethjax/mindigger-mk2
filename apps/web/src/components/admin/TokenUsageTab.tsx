import type { TokenUsageRow } from "./ai-config-types";

interface Props {
  tokenUsage: TokenUsageRow[];
}

export default function TokenUsageTab({ tokenUsage }: Props) {
  const totalTokens = tokenUsage.reduce((sum, t) => sum + t.total_tokens, 0);

  const tokensByBusiness = new Map<string, { name: string; total: number }>();
  for (const t of tokenUsage) {
    const key = t.business_id;
    const existing = tokensByBusiness.get(key);
    if (existing) {
      existing.total += t.total_tokens;
    } else {
      tokensByBusiness.set(key, {
        name: t.businesses?.name ?? t.business_id.slice(0, 8),
        total: t.total_tokens,
      });
    }
  }

  return (
    <div class="space-y-4">
      <div class="rounded-lg border border-gray-200 bg-white p-4">
        <div class="text-sm text-gray-500">Token totali (ultimi 500 record)</div>
        <div class="text-2xl font-bold">{totalTokens.toLocaleString("it-IT")}</div>
      </div>

      {/* By business */}
      <div class="rounded-lg border border-gray-200 bg-white">
        <div class="border-b border-gray-100 px-4 py-3">
          <h3 class="text-sm font-bold text-gray-500">Per Business</h3>
        </div>
        <div class="divide-y divide-gray-100">
          {[...tokensByBusiness.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([id, info]) => (
              <div key={id} class="flex items-center justify-between px-4 py-2">
                <span class="text-sm text-gray-700">{info.name}</span>
                <span class="font-mono text-sm text-gray-600">
                  {info.total.toLocaleString("it-IT")}
                </span>
              </div>
            ))}
          {tokensByBusiness.size === 0 && (
            <div class="p-4 text-center text-sm text-gray-400">
              Nessun dato di consumo token.
            </div>
          )}
        </div>
      </div>

      {/* Recent records */}
      <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Data</th>
              <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Business</th>
              <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Tipo</th>
              <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Model</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Prompt</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Cached</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Compl.</th>
              <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Totale</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            {tokenUsage.slice(0, 30).map((t, i) => (
              <tr key={i}>
                <td class="px-4 py-2 text-xs text-gray-600">{t.date}</td>
                <td class="px-4 py-2 text-xs text-gray-600">{t.businesses?.name ?? "—"}</td>
                <td class="px-4 py-2 text-xs text-gray-500">{t.batch_type}</td>
                <td class="px-4 py-2 font-mono text-xs text-gray-500">{t.model}</td>
                <td class="px-4 py-2 text-right font-mono text-xs">{t.prompt_tokens.toLocaleString()}</td>
                <td class="px-4 py-2 text-right font-mono text-xs text-amber-600">{t.cached_tokens.toLocaleString()}</td>
                <td class="px-4 py-2 text-right font-mono text-xs">{t.completion_tokens.toLocaleString()}</td>
                <td class="px-4 py-2 text-right font-mono text-xs font-medium">{t.total_tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {tokenUsage.length === 0 && (
          <div class="p-8 text-center text-sm text-gray-400">Nessun dato.</div>
        )}
      </div>
    </div>
  );
}
