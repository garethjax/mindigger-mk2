import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import type { AIConfig, PricingRow } from "./ai-config-types";

interface ProviderConfigTabProps {
  configs: AIConfig[];
  pricing: PricingRow[];
  setMessage: (msg: { type: "ok" | "err"; text: string } | null) => void;
}

export default function ProviderConfigTab({ configs, pricing, setMessage }: ProviderConfigTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModel, setEditModel] = useState("");
  const [editMode, setEditMode] = useState("");
  const [saving, setSaving] = useState(false);

  const supabase = createSupabaseBrowser();

  function getPricingForConfig(cfg: AIConfig): PricingRow | undefined {
    return pricing.find(
      (p) => p.provider === cfg.provider && p.model === cfg.model && p.mode === cfg.mode,
    );
  }

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

  return (
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
  );
}
