import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface Business {
  id: string;
  name: string;
  type: string;
  ragione_sociale: string | null;
  email: string | null;
  referente_nome: string | null;
  embeddings_enabled: boolean;
}

interface Props {
  business: Business;
  usersLabel: string;
  reviewCount: number;
  onSave: (updated: {
    name: string;
    type: string;
    ragione_sociale: string | null;
    email: string | null;
    referente_nome: string | null;
  }) => void;
  onMessage: (msg: { type: "ok" | "err"; text: string }) => void;
}

export default function BusinessEditor({
  business,
  usersLabel,
  reviewCount,
  onSave,
  onMessage,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [bizName, setBizName] = useState(business.name);
  const [bizType, setBizType] = useState(business.type);
  const [bizRagioneSociale, setBizRagioneSociale] = useState(business.ragione_sociale ?? "");
  const [bizEmail, setBizEmail] = useState(business.email ?? "");
  const [bizReferente, setBizReferente] = useState(business.referente_nome ?? "");
  const [saving, setSaving] = useState(false);

  const supabase = createSupabaseBrowser();

  async function saveBusiness(e: Event) {
    e.preventDefault();
    setSaving(true);

    const updated = {
      name: bizName.trim(),
      type: bizType,
      ragione_sociale: bizRagioneSociale.trim() || null,
      email: bizEmail.trim() || null,
      referente_nome: bizReferente.trim() || null,
    };

    const { error } = await supabase
      .from("businesses")
      .update(updated)
      .eq("id", business.id);

    if (error) {
      onMessage({ type: "err", text: `Errore: ${error.message}` });
    } else {
      onMessage({ type: "ok", text: "Dati azienda aggiornati" });
      onSave(updated);
      setEditing(false);
    }
    setSaving(false);
  }

  function cancelEditing() {
    setEditing(false);
    setBizName(business.name);
    setBizType(business.type);
    setBizRagioneSociale(business.ragione_sociale ?? "");
    setBizEmail(business.email ?? "");
    setBizReferente(business.referente_nome ?? "");
  }

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-6">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Dati Azienda</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            class="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            Modifica
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={saveBusiness} class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Nome</label>
              <input
                type="text"
                required
                value={bizName}
                onInput={(e) => setBizName((e.target as HTMLInputElement).value)}
                class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Tipo</label>
              <select
                value={bizType}
                onChange={(e) => setBizType((e.target as HTMLSelectElement).value)}
                class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="organization">Organization</option>
                <option value="restaurant">Restaurant</option>
                <option value="hotel">Hotel</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Ragione Sociale</label>
              <input
                type="text"
                value={bizRagioneSociale}
                onInput={(e) => setBizRagioneSociale((e.target as HTMLInputElement).value)}
                class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Email</label>
              <input
                type="email"
                value={bizEmail}
                onInput={(e) => setBizEmail((e.target as HTMLInputElement).value)}
                class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500">Referente</label>
              <input
                type="text"
                value={bizReferente}
                onInput={(e) => setBizReferente((e.target as HTMLInputElement).value)}
                class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div class="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "..." : "Salva"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              class="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Annulla
            </button>
          </div>
        </form>
      ) : (
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">Nome:</span>{" "}
            <span class="font-medium">{bizName}</span>
          </div>
          <div>
            <span class="text-gray-400">Tipo:</span> {bizType}
          </div>
          {bizRagioneSociale && (
            <div>
              <span class="text-gray-400">Ragione Sociale:</span>{" "}
              <span class="font-medium">{bizRagioneSociale}</span>
            </div>
          )}
          {bizEmail && (
            <div>
              <span class="text-gray-400">Email:</span> {bizEmail}
            </div>
          )}
          {bizReferente && (
            <div>
              <span class="text-gray-400">Referente:</span> {bizReferente}
            </div>
          )}
          <div>
            <span class="text-gray-400">Utenti:</span> {usersLabel}
          </div>
          <div>
            <span class="text-gray-400">Recensioni totali:</span>{" "}
            <span class="font-medium">{reviewCount}</span>
          </div>
          <div>
            <span class="text-gray-400">Embeddings:</span>{" "}
            {business.embeddings_enabled ? (
              <span class="text-purple-600 font-medium">Attivi</span>
            ) : (
              <span class="text-gray-400">Disattivati</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
