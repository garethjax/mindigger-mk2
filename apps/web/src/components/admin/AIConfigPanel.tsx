import { useEffect, useRef, useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import { buildBatchPollSummary } from "./ai-batch-poll-summary";
import type { AIConfig, TokenUsageRow, Batch, BatchMetadata, PricingRow, CreditBalance } from "./ai-config-types";
import { BATCH_STATUS_COLORS } from "./ai-config-types";
import ProviderConfigTab from "./ProviderConfigTab";
import TokenUsageTab from "./TokenUsageTab";
import CostsTab from "./CostsTab";

interface Props {
  configs: AIConfig[];
  tokenUsage: TokenUsageRow[];
  batches: Batch[];
  pricing: PricingRow[];
  creditBalance: CreditBalance | null;
}


export default function AIConfigPanel({ configs, tokenUsage, batches, pricing, creditBalance }: Props) {
  const [tab, setTab] = useState<"config" | "tokens" | "batches" | "costs">("config");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [batchActionLoading, setBatchActionLoading] = useState<string | null>(null);
  const [batchPollLoading, setBatchPollLoading] = useState(false);
  const [batchRows, setBatchRows] = useState<Batch[]>(batches);
  const [analysisSubmitLoading, setAnalysisSubmitLoading] = useState(false);
  const [rescoreLoading, setRescoreLoading] = useState(false);
  const [rescoreBusinessId, setRescoreBusinessId] = useState("");
  const [rescoreBusinessName, setRescoreBusinessName] = useState("");
  const [businessSuggestions, setBusinessSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [businessNames, setBusinessNames] = useState<Map<string, string>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supabase = createSupabaseBrowser();

  // Load business names for batch metadata on mount
  useEffect(() => {
    const ids = new Set<string>();
    for (const b of batches) {
      const bid = (b.metadata as BatchMetadata | undefined)?.business_id;
      if (bid) ids.add(bid);
    }
    if (ids.size === 0) return;
    supabase
      .from("businesses")
      .select("id, name")
      .in("id", [...ids])
      .then(({ data }) => {
        const m = new Map<string, string>();
        for (const row of data ?? []) m.set(row.id, row.name);
        setBusinessNames(m);
      });
  }, []);

  async function refreshBusinessNames(rows: Batch[]) {
    const ids = new Set<string>();
    for (const b of rows) {
      const bid = b.metadata?.business_id;
      if (bid && !businessNames.has(bid)) ids.add(bid);
    }
    if (ids.size === 0) return;
    const { data } = await supabase.from("businesses").select("id, name").in("id", [...ids]);
    setBusinessNames((prev) => {
      const next = new Map(prev);
      for (const row of data ?? []) next.set(row.id, row.name);
      return next;
    });
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

  async function runRescore() {
    if (!rescoreBusinessId.trim()) {
      if (!confirm("Nessun business selezionato: il re-score partira' su TUTTI i business. Continuare?")) return;
    }
    setRescoreLoading(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {};
      if (rescoreBusinessId.trim()) body.business_id = rescoreBusinessId.trim();

      const { data, error } = await supabase.functions.invoke("rescore-submit", { body });
      if (error) {
        const context = (error as { context?: Response }).context;
        const bodyText = context ? await context.text().catch(() => "") : "";
        throw new Error(`HTTP ${context?.status ?? "?"} - ${bodyText || error.message}`);
      }

      const result = data as { submitted: number; message?: string; external_batch_id?: string };
      if (result.submitted === 0) {
        setMessage({ type: "ok", text: result.message ?? "Nessuna recensione inconsistente trovata." });
      } else {
        // Immediately trigger a poll cycle so the new batch appears
        await supabase.functions.invoke("rescore-poll", { body: {} });
        const { data: refreshedBatches } = await supabase
          .from("ai_batches")
          .select("id, external_batch_id, provider, batch_type, status, created_at, updated_at, metadata")
          .order("created_at", { ascending: false })
          .limit(50);
        setBatchRows(refreshedBatches ?? []);
        refreshBusinessNames(refreshedBatches ?? []);
        setMessage({
          type: "ok",
          text: `Re-score avviato: ${result.submitted} recensioni in elaborazione (batch ${result.external_batch_id?.slice(0, 16)}…).`,
        });
      }
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Errore re-score." });
    } finally {
      setRescoreLoading(false);
    }
  }

  function searchBusinesses(query: string) {
    setRescoreBusinessName(query);
    setRescoreBusinessId("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setBusinessSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("businesses")
        .select("id, name")
        .ilike("name", `%${query}%`)
        .limit(8);
      setBusinessSuggestions(data ?? []);
      setShowSuggestions(true);
    }, 300);
  }

  function selectBusiness(b: { id: string; name: string }) {
    setRescoreBusinessId(b.id);
    setRescoreBusinessName(b.name);
    setBusinessSuggestions([]);
    setShowSuggestions(false);
  }

  async function runAnalysisSubmit() {
    setAnalysisSubmitLoading(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("analysis-submit", { body: {} });
      if (error) {
        const context = (error as { context?: Response }).context;
        const bodyText = context ? await context.text().catch(() => "") : "";
        throw new Error(`HTTP ${context?.status ?? "?"} - ${bodyText || error.message}`);
      }
      const result = data as { submitted?: number; message?: string; batch_ids?: string[] };
      if (result.submitted === 0 || result.message?.includes("No pending")) {
        setMessage({ type: "ok", text: "Nessuna recensione pending da analizzare." });
      } else {
        const { data: refreshedBatches } = await supabase
          .from("ai_batches")
          .select("id, external_batch_id, provider, batch_type, status, created_at, updated_at, metadata")
          .order("created_at", { ascending: false })
          .limit(50);
        setBatchRows(refreshedBatches ?? []);
        refreshBusinessNames(refreshedBatches ?? []);
        setMessage({
          type: "ok",
          text: `Analisi avviata: ${result.submitted ?? "?"} recensioni inviate in ${result.batch_ids?.length ?? "?"} batch.`,
        });
      }
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Errore invio analisi." });
    } finally {
      setAnalysisSubmitLoading(false);
    }
  }

  async function runBatchPoll() {
    setBatchPollLoading(true);
    setMessage(null);

    const pollNames = ["analysis-poll", "swot-poll", "rescore-poll"] as const;
    const polledResults: Array<{ status?: string }> = [];

    try {
      for (const fnName of pollNames) {
        const { data, error } = await supabase.functions.invoke(fnName, { body: {} });
        if (error) {
          let detail = error.message;
          const context = (error as { context?: Response }).context;
          if (context) {
            const bodyText = await context.text().catch(() => "");
            detail = `HTTP ${context.status}${bodyText ? ` - ${bodyText}` : ""}`;
          }
          throw new Error(`${fnName}: ${detail}`);
        }

        const results = (data as { results?: Array<{ status?: string }> } | null)?.results ?? [];
        polledResults.push(...results);
      }

      const { data: refreshedBatches, error: refreshErr } = await supabase
        .from("ai_batches")
        .select("id, external_batch_id, provider, batch_type, status, created_at, updated_at, metadata")
        .order("created_at", { ascending: false })
        .limit(50);

      if (refreshErr) {
        throw new Error(refreshErr.message);
      }

      setBatchRows(refreshedBatches ?? []);
      refreshBusinessNames(refreshedBatches ?? []);
      setMessage({
        type: "ok",
        text: buildBatchPollSummary(polledResults),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Errore durante il controllo status batch.";
      setMessage({ type: "err", text: detail });
    } finally {
      setBatchPollLoading(false);
    }
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
        <ProviderConfigTab configs={configs} pricing={pricing} setMessage={setMessage} />
      )}

      {/* Token Usage tab */}
      {tab === "tokens" && <TokenUsageTab tokenUsage={tokenUsage} />}

      {/* Costs tab */}
      {tab === "costs" && (
        <CostsTab tokenUsage={tokenUsage} pricing={pricing} creditBalance={creditBalance} />
      )}

      {/* Batches tab */}
      {tab === "batches" && (
        <div class="space-y-3">
          {/* Re-score panel */}
          <div class="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <div class="mb-2 flex items-center gap-2">
              <span class="text-sm font-semibold text-amber-800">Re-score semantico</span>
              <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                admin only
              </span>
            </div>
            <p class="mb-3 text-xs text-amber-700">
              Rileva le recensioni con score incoerenti rispetto al sentiment globale e le rimanda
              all'LLM (batch, basso costo) per correggere solo i punteggi dei topic.
            </p>
            <div class="flex items-center gap-2">
              <div class="relative flex-1">
                <input
                  type="text"
                  placeholder="Cerca business (vuoto = tutti)"
                  value={rescoreBusinessName}
                  onInput={(e) => searchBusinesses((e.target as HTMLInputElement).value)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => businessSuggestions.length > 0 && setShowSuggestions(true)}
                  class="w-full rounded border border-amber-300 bg-white px-2 py-1.5 text-xs focus:border-amber-500 focus:outline-none"
                />
                {rescoreBusinessId && (
                  <button
                    type="button"
                    onClick={() => { setRescoreBusinessId(""); setRescoreBusinessName(""); }}
                    class="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-400 hover:text-amber-700"
                  >
                    ×
                  </button>
                )}
                {showSuggestions && businessSuggestions.length > 0 && (
                  <div class="absolute left-0 top-full z-10 mt-1 w-full rounded border border-amber-200 bg-white shadow-md">
                    {businessSuggestions.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onMouseDown={() => selectBusiness(b)}
                        class="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-amber-50"
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={rescoreLoading}
                onClick={runRescore}
                class="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {rescoreLoading ? "Avvio..." : "Avvia Re-score"}
              </button>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <button
              type="button"
              disabled={analysisSubmitLoading}
              onClick={runAnalysisSubmit}
              class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {analysisSubmitLoading ? "Invio..." : "Invia recensioni pending"}
            </button>
            <button
              type="button"
              disabled={batchPollLoading}
              onClick={runBatchPoll}
              class="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {batchPollLoading ? "Controllo..." : "Controlla status"}
            </button>
          </div>
          <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Batch ID</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Business</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Tipo</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Dettagli</th>
                <th class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Creato</th>
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
                    <td class="px-4 py-2 text-xs text-gray-600">
                      {b.metadata?.business_id
                        ? businessNames.get(b.metadata.business_id) ?? b.metadata.business_id.slice(0, 8) + "…"
                        : <span class="text-gray-400">tutti</span>}
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-500">{b.batch_type}</td>
                    <td class="px-4 py-2">
                      <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {b.status}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-500">
                      {b.metadata?.review_count != null && (
                        <span>{b.metadata.review_count} review</span>
                      )}
                      {b.status === "completed" && b.metadata?.fixed != null && (
                        <span class="ml-1 text-green-600">({b.metadata.fixed} corrette)</span>
                      )}
                      {b.status === "completed" && (b.metadata?.failed as number) > 0 && (
                        <span class="ml-1 text-red-500">({b.metadata!.failed} errori)</span>
                      )}
                    </td>
                    <td class="px-4 py-2 text-xs text-gray-500">
                      {new Date(b.created_at).toLocaleString("it-IT")}
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
