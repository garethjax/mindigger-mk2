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
  batch_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
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

interface Props {
  configs: AIConfig[];
  tokenUsage: TokenUsageRow[];
  batches: Batch[];
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

export default function AIConfigPanel({ configs, tokenUsage, batches }: Props) {
  const [tab, setTab] = useState<"config" | "tokens" | "batches">("config");
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
    // Deactivate all, then activate selected
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

  const TABS = [
    { key: "config" as const, label: "Provider" },
    { key: "tokens" as const, label: "Token Usage" },
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
                  <div class="mt-2 flex gap-4 text-xs text-gray-500">
                    <span>Modello: <span class="font-mono font-medium text-gray-700">{cfg.model}</span></span>
                    <span>Mode: {cfg.mode}</span>
                    <span>Config: {JSON.stringify(cfg.config)}</span>
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
            <div class="text-sm text-gray-500">Token totali (ultimi 100 record)</div>
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
                  <th class="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">Prompt</th>
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
                    <td class="px-4 py-2 text-right font-mono text-xs">{t.prompt_tokens.toLocaleString()}</td>
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
