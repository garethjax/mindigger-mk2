import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const supabase = createSupabaseBrowser();

  async function handlePasswordLogin(e: Event) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage({ type: "error", text: "Credenziali non valide" });
      setLoading(false);
    } else {
      window.location.href = "/analytics";
    }
  }

  async function handleMagicLink(e: Event) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setMessage({ type: "error", text: "Errore nell'invio del link" });
    } else {
      setMessage({ type: "success", text: "Link inviato! Controlla la tua email." });
    }
    setLoading(false);
  }

  return (
    <div class="space-y-4">
      {/* Mode toggle */}
      <div class="flex rounded-lg border border-gray-200 p-1">
        <button
          type="button"
          onClick={() => setMode("password")}
          class={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === "password" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => setMode("magic")}
          class={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
            mode === "magic" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Magic Link
        </button>
      </div>

      {message && (
        <div
          class={`rounded-lg p-3 text-sm ${
            message.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={mode === "password" ? handlePasswordLogin : handleMagicLink}>
        <div class="space-y-3">
          <div>
            <label for="email" class="mb-1 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="nome@esempio.it"
            />
          </div>

          {mode === "password" && (
            <div>
              <label for="password" class="mb-1 block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "..." : mode === "password" ? "Accedi" : "Invia Magic Link"}
          </button>
        </div>
      </form>

      {mode === "password" && (
        <p class="text-center text-xs text-gray-500">
          <a href="/auth/forgot-password" class="text-blue-600 hover:underline">
            Password dimenticata?
          </a>
        </p>
      )}
    </div>
  );
}
