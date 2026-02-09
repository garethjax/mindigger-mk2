import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface Profile {
  id: string;
  role: string;
  full_name: string | null;
  business_id: string | null;
  account_enabled: boolean;
  account_locked: boolean;
  active_subscription: boolean;
  free_trial_consumed: boolean;
}

interface Business {
  id: string;
  name: string;
}

interface Props {
  profile: Profile;
  allBusinesses: Business[];
}

export default function UserEditForm({ profile, allBusinesses }: Props) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [role, setRole] = useState(profile.role);
  const [businessId, setBusinessId] = useState(profile.business_id ?? "");
  const [enabled, setEnabled] = useState(profile.account_enabled);
  const [locked, setLocked] = useState(profile.account_locked);
  const [subscription, setSubscription] = useState(profile.active_subscription);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const supabase = createSupabaseBrowser();

  async function handleSave(e: Event) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName || null,
        role,
        business_id: businessId || null,
        account_enabled: enabled,
        account_locked: locked,
        active_subscription: subscription,
      })
      .eq("id", profile.id);

    if (error) {
      setMessage({ type: "err", text: error.message });
    } else {
      setMessage({ type: "ok", text: "Profilo aggiornato!" });
    }
    setLoading(false);
  }

  const currentBiz = allBusinesses.find((b) => b.id === businessId);

  return (
    <div class="space-y-6">
      {/* Profile Form */}
      <form onSubmit={handleSave} class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Profilo</h2>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">ID</label>
          <div class="text-sm text-gray-600 font-mono">{profile.id}</div>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Nome Completo</label>
          <input
            type="text"
            value={fullName}
            onInput={(e) => setFullName((e.target as HTMLInputElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Ruolo</label>
          <select
            value={role}
            onChange={(e) => setRole((e.target as HTMLSelectElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="business">Analista</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Azienda Associata</label>
          <select
            value={businessId}
            onChange={(e) => setBusinessId((e.target as HTMLSelectElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">— Nessun business —</option>
            {allBusinesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div class="space-y-2">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
              class="rounded border-gray-300"
            />
            <span class="text-sm text-gray-700">Account abilitato</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked((e.target as HTMLInputElement).checked)}
              class="rounded border-gray-300"
            />
            <span class="text-sm text-gray-700">Account bloccato</span>
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={subscription}
              onChange={(e) => setSubscription((e.target as HTMLInputElement).checked)}
              class="rounded border-gray-300"
            />
            <span class="text-sm text-gray-700">Abbonamento attivo</span>
          </label>
        </div>

        {message && (
          <div
            class={`rounded-lg p-3 text-sm ${
              message.type === "ok"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Salvataggio..." : "Salva Modifiche"}
        </button>
      </form>

      {/* Current Business Info */}
      {currentBiz && (
        <div class="rounded-lg border border-gray-200 bg-white p-6">
          <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Azienda Associata
          </h2>
          <div class="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
            <span class="text-sm text-gray-700">{currentBiz.name}</span>
            <a
              href={`/regia/businesses/${currentBiz.id}`}
              class="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Dettagli
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
