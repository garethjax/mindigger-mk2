import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface Location {
  id: string;
  name: string;
  business_id: string;
}

interface Props {
  locations: Location[];
}

const PERIODS = [
  { value: "3", label: "Ultimi 3 mesi" },
  { value: "6", label: "Ultimi 6 mesi" },
  { value: "12", label: "Ultimo anno" },
  { value: "24", label: "Ultimi 2 anni" },
  { value: "36", label: "Ultimi 3 anni" },
];

export default function SwotForm({ locations }: Props) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [period, setPeriod] = useState("6");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const supabase = createSupabaseBrowser();

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const location = locations.find((l) => l.id === locationId);
    if (!location) {
      setMessage({ type: "error", text: "Seleziona una location" });
      setLoading(false);
      return;
    }

    // Create SWOT analysis record
    const { data, error } = await supabase
      .from("swot_analyses")
      .insert({
        location_id: locationId,
        business_id: location.business_id,
        period,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      setMessage({ type: "error", text: "Errore nella creazione dell'analisi" });
      setLoading(false);
      return;
    }

    // Trigger SWOT submission via Edge Function
    const { error: triggerError } = await supabase.functions.invoke("swot-submit", {
      body: { swot_id: data.id },
    });

    if (triggerError) {
      setMessage({ type: "error", text: "Analisi creata ma invio fallito. Verr\u00e0 elaborata dal cron." });
    } else {
      setMessage({ type: "success", text: "Analisi SWOT avviata! Riceverai una notifica al completamento." });
    }

    setLoading(false);
    setTimeout(() => (window.location.href = "/swot"), 2000);
  }

  return (
    <form onSubmit={handleSubmit} class="max-w-lg space-y-4">
      {message && (
        <div
          class={`rounded-lg p-3 text-sm ${
            message.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div>
        <label class="mb-1 block text-sm font-medium text-gray-700">Location</label>
        <select
          value={locationId}
          onChange={(e) => setLocationId((e.target as HTMLSelectElement).value)}
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium text-gray-700">Periodo</label>
        <select
          value={period}
          onChange={(e) => setPeriod((e.target as HTMLSelectElement).value)}
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div class="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          class="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Avvio analisi..." : "Avvia Analisi SWOT"}
        </button>
        <a
          href="/swot"
          class="rounded-lg border border-gray-300 px-6 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Annulla
        </a>
      </div>
    </form>
  );
}
