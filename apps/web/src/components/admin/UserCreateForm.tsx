import { useState, useRef, useEffect } from "preact/hooks";
import { generatePassphrase } from "@/lib/passphrase";

interface Props {
  businesses: { id: string; name: string }[];
}

export default function UserCreateForm({ businesses }: Props) {
  const MIN_PASSPHRASE_LENGTH = 10;

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState(() => generatePassphrase());
  const [showPassword, setShowPassword] = useState(true);
  const [sendRecoveryEmail, setSendRecoveryEmail] = useState(true);
  const [role, setRole] = useState<"business" | "admin">("business");
  const [businessId, setBusinessId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Searchable business dropdown
  const [bizSearch, setBizSearch] = useState("");
  const [bizDropdownOpen, setBizDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredBusinesses = businesses.filter((b) =>
    b.name.toLowerCase().includes(bizSearch.toLowerCase())
  );

  const selectedBizName = businesses.find((b) => b.id === businessId)?.name ?? "";

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setBizDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (password.length < MIN_PASSPHRASE_LENGTH) {
        setError(`La passphrase deve avere almeno ${MIN_PASSPHRASE_LENGTH} caratteri.`);
        setLoading(false);
        return;
      }

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          role,
          business_id: businessId || undefined,
          send_recovery_email: sendRecoveryEmail,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || `Errore ${res.status}`);
        setLoading(false);
        return;
      }

      const successParts: string[] = ["Utente creato con successo."];
      if (data.recovery_email_sent) {
        successParts.push("Email con link sicuro di impostazione password inviata.");
      }
      if (data.warning) {
        successParts.push(data.warning);
      }
      if (data.generated_passphrase && !data.recovery_email_sent) {
        successParts.push(`Passphrase temporanea: ${data.generated_passphrase}`);
      }
      setSuccess(successParts.join(" "));
    } catch (err) {
      setError("Errore di rete");
      setLoading(false);
      return;
    }

    setEmail("");
    setFullName("");
    setPassword(generatePassphrase());
    setSendRecoveryEmail(true);
    setRole("business");
    setBusinessId("");
    setBizSearch("");
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
        <label class="mb-1 block text-xs font-medium text-gray-500">Passphrase iniziale *</label>
        <div class="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={MIN_PASSPHRASE_LENGTH}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 pr-32 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div class="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
            <button
              type="button"
              onClick={() => setPassword(generatePassphrase())}
              class="rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700"
            >
              Rigenera
            </button>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              class="rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700"
            >
              {showPassword ? "Nascondi" : "Mostra"}
            </button>
          </div>
        </div>
        <p class="mt-1 text-xs text-gray-500">
          Minimo {MIN_PASSPHRASE_LENGTH} caratteri. L&apos;utente dovrà cambiarla al primo accesso.
        </p>
      </div>

      <div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <label class="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={sendRecoveryEmail}
            onChange={(e) => setSendRecoveryEmail((e.target as HTMLInputElement).checked)}
            class="mt-0.5"
          />
          <span>
            Invia subito email con link sicuro per impostare la password
            <span class="mt-1 block text-xs text-gray-500">
              Nessuna password viene inviata in chiaro via email.
            </span>
          </span>
        </label>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Ruolo</label>
        <select
          value={role}
          onChange={(e) => setRole((e.target as HTMLSelectElement).value as "business" | "admin")}
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="business">Analista</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {businesses.length > 0 && (
        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">
            Assegna Azienda (opzionale)
          </label>
          <div ref={dropdownRef} class="relative">
            <input
              type="text"
              value={bizDropdownOpen ? bizSearch : selectedBizName}
              onFocus={() => {
                setBizDropdownOpen(true);
                setBizSearch("");
              }}
              onInput={(e) => {
                setBizSearch((e.target as HTMLInputElement).value);
                setBizDropdownOpen(true);
              }}
              placeholder="Cerca azienda..."
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {businessId && !bizDropdownOpen && (
              <button
                type="button"
                onClick={() => {
                  setBusinessId("");
                  setBizSearch("");
                }}
                class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            )}
            {bizDropdownOpen && (
              <div class="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setBusinessId("");
                    setBizSearch("");
                    setBizDropdownOpen(false);
                  }}
                  class="w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50"
                >
                  — Nessuna —
                </button>
                {filteredBusinesses.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => {
                      setBusinessId(b.id);
                      setBizSearch("");
                      setBizDropdownOpen(false);
                    }}
                    class={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${
                      b.id === businessId ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700"
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
                {filteredBusinesses.length === 0 && (
                  <div class="px-3 py-2 text-sm text-gray-400">Nessun risultato</div>
                )}
              </div>
            )}
          </div>
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
