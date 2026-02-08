import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface Props {
  businesses: { id: string; name: string }[];
}

export default function UserCreateForm({ businesses }: Props) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"business" | "admin">("business");
  const [businessId, setBusinessId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const supabase = createSupabaseBrowser();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    // Call edge function to create user (needs service_role)
    const { data, error: fnError } = await supabase.functions.invoke(
      "admin-create-user",
      {
        body: {
          email,
          password,
          full_name: fullName,
          role,
          business_id: businessId || undefined,
        },
      }
    );

    if (fnError) {
      setError(fnError.message || "Errore nella creazione utente");
    } else if (data?.error) {
      setError(data.error);
    } else {
      setSuccess("Utente creato con successo!");
      setEmail("");
      setFullName("");
      setPassword("");
      setRole("business");
      setBusinessId("");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Email *</label>
        <input
          type="email"
          required
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
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
        <label class="mb-1 block text-xs font-medium text-gray-500">Password *</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Ruolo</label>
        <select
          value={role}
          onChange={(e) => setRole((e.target as HTMLSelectElement).value as "business" | "admin")}
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="business">Business</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {role === "business" && businesses.length > 0 && (
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">
            Assegna Business (opzionale)
          </label>
          <select
            value={businessId}
            onChange={(e) => setBusinessId((e.target as HTMLSelectElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">— Nessuno —</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div class="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>
      )}

      <button
        type="submit"
        disabled={loading}
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Creazione..." : "Crea Utente"}
      </button>
    </form>
  );
}
