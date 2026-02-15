import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface AIConfig {
  id: string;
  provider: string;
  mode: string;
  model: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

interface TokenUsageRow {
  business_id: string;
  provider: string;
  model: string;
  batch_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  date: string;
  businesses: { name: string } | null;
}

interface Batch {
  id: string;
  external_batch_id: string;
  provider: string;
  batch_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PricingRow {
  id: string;
  provider: string;
  model: string;
  mode: string;
  input_price: number;
  cached_input_price: number;
  output_price: number;
}

interface CreditBalance {
  initial_amount: number;
  reference_date: string;
  notes: string | null;
}

interface Props {
  configs: AIConfig[];
  tokenUsage: TokenUsageRow[];
  batches: Batch[];
  pricing: PricingRow[];
  creditBalance: CreditBalance | null;
}

const BATCH_STATUS_COLORS: Record<string, string> = {
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  expired: "bg-gray-100 text-gray-500",
  validating: "bg-yellow-100 text-yellow-700",
  finalizing: "bg-yellow-100 text-yellow-700",
  cancelled: "bg-gray-100 text-gray-500",
};

function computeCost(
  row: TokenUsageRow,
  pricing: PricingRow[],
): number {
  // Batch pricing (50% of direct) + incentivized tier estimate (another ~50% free)
  const p = pricing.find(
    (pr) => pr.provider === row.provider && pr.model === row.model && pr.mode === "batch",
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


export default function AIConfigPanel({ configs, tokenUsage, batches, pricing, creditBalance }: Props) {
  const [tab, setTab] = useState<"config" | "tokens" | "batches" | "costs">("config");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModel, setEditModel] = useState("");
  const [editMode, setEditMode] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [batchActionLoading, setBatchActionLoading] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState<Batch[]>(batches);

  const supabase = createSupabaseBrowser();

  function startEdit(cfg: AIConfig) {
    setEditingId(cfg.id);
    setEditModel(cfg.model);
    setEditMode(cfg.mode);
  }

  async function saveEdit(cfgId: string) {
    setSaving(true);
    setMessage(null);
    const { error } = await supabase
      .from("ai_configs")
      .update({ model: editModel, mode: editMode })
      .eq("id", cfgId);

    if (error) {
      setMessage({ type: "err", text: error.message });
    } else {
      setMessage({ type: "ok", text: "Configurazione aggiornata!" });
      setEditingId(null);
    }
    setSaving(false);
  }

  async function toggleActive(cfgId: string, currentActive: boolean) {
    setMessage(null);
    if (!currentActive) {
      await supabase.from("ai_configs").update({ is_active: false }).neq("id", "");
    }
    const { error } = await supabase
      .from("ai_configs")
      .update({ is_active: !currentActive })
      .eq("id", cfgId);

    if (error) {
      setMessage({ type: "err", text: error.message });
    } else {
      setMessage({ type: "ok", text: !currentActive ? "Provider attivato!" : "Provider disattivato!" });
    }
  }

  async function runBatchAction(batchId: string, action: "stop" | "restart" | "reprocess") {
    const key = `${batchId}:${action}`;
    setBatchActionLoading(key);
    setMessage(null);

    const { data, error } = await supabase.functions.invoke("analysis-batch-admin", {
      body: { batch_id: batchId, action },
    });

    if (error) {
      let detail = error.message;
      const context = (error as { context?: Response }).context;
      if (context) {
        const bodyText = await context.text().catch(() => "");
        detail = `HTTP ${context.status}${bodyText ? ` - ${bodyText}` : ""}`;
      }
      setMessage({ type: "err", text: `Batch ${action}: ${detail}` });
      setBatchActionLoading(null);
      return;
    }

    let nextStatus: string | null = null;
    let msgType: "ok" | "err" = "ok";
    let msgText = `Azione "${action}" completata.`;

    if (action === "reprocess") {
      const result = (data as { poll_result?: { results?: Array<{ status?: string; processed?: number }> } })
        ?.poll_result?.results?.[0];
      const s = result?.status ?? "unknown";
      nextStatus = s === "still_processing"
        ? "in_progress"
        : s === "no_output_file"
          ? "failed"
          : s;

      if (s === "completed") {
        msgText = `Riavvio completato: batch completato (${result?.processed ?? 0} review processate).`;
      } else if (s === "still_processing") {
        msgText = "Riavvio eseguito: batch ancora in elaborazione lato provider.";
      } else if (s === "cancelled") {
        msgType = "err";
        msgText = "Riavvio eseguito: batch risulta cancellato lato provider.";
      } else if (s === "no_output_file") {
        msgType = "err";
        msgText = "Riavvio eseguito: nessun output file disponibile per il batch.";
      } else if (s === "failed") {
        msgType = "err";
        msgText = "Riavvio eseguito: batch fallito lato provider.";
      } else {
        msgType = "err";
        msgText = `Riavvio eseguito: stato batch "${s}".`;
      }
    } else if (action === "stop") {
      nextStatus = "cancelled";
    } else if (action === "restart") {
      nextStatus = "in_progress";
    }

    setMessage({ type: msgType, text: msgText });
    setBatchRows((prev) => prev.map((row) => {
      if (row.id !== batchId) return row;
      const now = new Date().toISOString();
      return { ...row, status: nextStatus ?? row.status, updated_at: now };
    }));
    setBatchActionLoading(null);
  }

  // Token usage aggregation
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

  // Pricing lookup for Provider tab
  function getPricingForConfig(cfg: AIConfig): PricingRow | undefined {
    return pricing.find(
      (p) => p.provider === cfg.provider && p.model === cfg.model && p.mode === cfg.mode,
    );
  }

  const TABS = [
    { key: "config" as const, label: "Provider" },
    { key: "tokens" as const, label: "Token Usage" },
    { key: "costs" as const, label: "Costi" },
    { key: "batches" as const, label: "Batch AI" },
  ];

  return (
    <div class="space-y-4">
      {/* Tabs */}
      <div class="flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            class={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div
          class={`rounded-lg p-3 text-sm ${
            message.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Config tab */}
      {tab === "config" && (
        <div class="space-y-3">
          {configs.map((cfg) => {
            const isEditing = editingId === cfg.id;
            const cfgPricing = getPricingForConfig(cfg);
            return (
              <div
                key={cfg.id}
                class={`rounded-lg border p-4 ${
                  cfg.is_active
                    ? "border-green-300 bg-green-50/50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <span class="text-base font-medium">
                      {cfg.provider.charAt(0).toUpperCase() + cfg.provider.slice(1)}
                    </span>
                    {cfg.is_active && (
                      <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Attivo
                      </span>
                    )}
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleActive(cfg.id, cfg.is_active)}
                      class={`rounded px-3 py-1 text-xs font-medium ${
                        cfg.is_active
                          ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                          : "bg-green-600 text-white hover:bg-green-700"
                      }`}
                    >
                      {cfg.is_active ? "Disattiva" : "Attiva"}
                    </button>
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => startEdit(cfg)}
                        class="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Modifica
                      </button>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div class="mt-3 space-y-3">
                    <div class="flex gap-3">
                      <div class="flex-1">
                        <label class="mb-1 block text-xs font-medium text-gray-500">Modello</label>
                        <input
                          type="text"
                          value={editModel}
                          onInput={(e) => setEditModel((e.target as HTMLInputElement).value)}
                          class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="mb-1 block text-xs font-medium text-gray-500">Modalita'</label>
                        <select
                          value={editMode}
                          onChange={(e) => setEditMode((e.target as HTMLSelectElement).value)}
                          class="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="batch">Batch</option>
                          <option value="direct">Direct</option>
                        </select>
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => saveEdit(cfg.id)}
                        class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? "..." : "Salva"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        class="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                ) : (
                  <div class="mt-2 space-y-1">
                    <div class="flex gap-4 text-xs text-gray-500">
                      <span>Modello: <span class="font-mono font-medium text-gray-700">{cfg.model}</span></span>
                      <span>Mode: {cfg.mode}</span>
                      <span>Config: {JSON.stringify(cfg.config)}</span>
                    </div>
                    {cfgPricing && (
                      <div class="flex gap-3 text-xs text-gray-400">
                        <span>Input: <span class="font-mono">${cfgPricing.input_price}</span>/1M</span>
                        <span>Cached: <span class="font-mono">${cfgPricing.cached_input_price}</span>/1M</span>
                        <span>Output: <span class="font-mono">${cfgPricing.output_price}</span>/1M</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {configs.length === 0 && (
            <div class="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
              Nessuna configurazione AI. Il seed dovrebbe creare una config OpenAI di default.
            </div>
          )}
        </div>
      )}

      {/* Token Usage tab */}
      {tab === "tokens" && (
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
      )}

      {/* Costs tab */}
      {tab === "costs" && (
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
      )}

      {/* Batches tab */}
      {tab === "batches" && (
        <div class="space-y-3">
          <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Batch ID</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Provider</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Tipo</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Creato</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Aggiornato</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Azioni</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {batchRows.map((b) => {
                const statusColor = BATCH_STATUS_COLORS[b.status] ?? "bg-gray-100 text-gray-600";
                return (
                  <tr key={b.id}>
                    <td class="px-4 py-2 font-mono text-xs text-gray-600">
                      {b.external_batch_id.slice(0, 20)}…
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-600">{b.provider}</td>
                    <td class="px-4 py-2 text-xs text-gray-500">{b.batch_type}</td>
                    <td class="px-4 py-2">
                      <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {b.status}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-500">
                      {new Date(b.created_at).toLocaleString("it-IT")}
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-500">
                      {new Date(b.updated_at).toLocaleString("it-IT")}
                    </td>
                    <td class="px-4 py-2">
                      <div class="flex flex-wrap gap-2">
                        {b.status === "in_progress" && (
                          <button
                            type="button"
                            disabled={batchActionLoading === `${b.id}:stop`}
                            onClick={() => runBatchAction(b.id, "stop")}
                            class="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {batchActionLoading === `${b.id}:stop` ? "..." : "Cancella"}
                          </button>
                        )}
                        {(b.status === "failed" || b.status === "cancelled") && (
                          <button
                            type="button"
                            disabled={batchActionLoading === `${b.id}:reprocess`}
                            onClick={() => runBatchAction(b.id, "reprocess")}
                            class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {batchActionLoading === `${b.id}:reprocess` ? "..." : "Riavvia"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {batchRows.length === 0 && (
            <div class="p-8 text-center text-sm text-gray-400">Nessun batch AI.</div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
