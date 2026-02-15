import { useState, useEffect } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface ScrapingConfig {
  id: string;
  platform: string;
  status: string;
  bot_id: string | null;
  initial_scrape_done: boolean;
  initial_depth: number;
  recurring_depth: number;
  frequency: string;
  retry_count: number;
  last_error: string | null;
  last_scraped_at: string | null;
  next_poll_at: string | null;
  updated_at: string;
  locations: {
    id: string;
    name: string;
    is_competitor: boolean;
    businesses: {
      id: string;
      name: string;
    };
  } | null;
}

interface Props {
  configs: ScrapingConfig[];
  profileMap: Record<string, string>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; sortOrder: number }> = {
  elaborating: { label: "In corso", color: "bg-blue-100 text-blue-700", sortOrder: 0 },
  checking: { label: "Verifica", color: "bg-yellow-100 text-yellow-700", sortOrder: 1 },
  failed: { label: "Errore", color: "bg-red-100 text-red-700", sortOrder: 2 },
  completed: { label: "Completato", color: "bg-green-100 text-green-700", sortOrder: 3 },
  idle: { label: "Idle", color: "bg-gray-100 text-gray-600", sortOrder: 4 },
};

const PLATFORM_LABELS: Record<string, string> = {
  google_maps: "Google Maps",
  tripadvisor: "TripAdvisor",
  booking: "Booking",
  trustpilot: "Trustpilot",
};

export default function ScrapingDashboard({ configs, profileMap }: Props) {
  const [filter, setFilter] = useState<"all" | "active" | "failed" | "idle">("all");
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [pollLoading, setPollLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [botsterCredits, setBotsterCredits] = useState<number | null>(null);

  const supabase = createSupabaseBrowser();

  useEffect(() => {
    supabase.functions.invoke("botster-credits").then(({ data, error }) => {
      if (!error && data?.credits != null) {
        setBotsterCredits(Number(data.credits));
      }
    });
  }, []);

  const filtered = configs
    .filter((c) => {
      if (filter === "active") return c.status === "elaborating" || c.status === "checking";
      if (filter === "failed") return c.status === "failed";
      if (filter === "idle") return c.status === "idle";
      return true;
    })
    .sort((a, b) => {
      const sa = STATUS_CONFIG[a.status]?.sortOrder ?? 99;
      const sb = STATUS_CONFIG[b.status]?.sortOrder ?? 99;
      return sa - sb;
    });

  const activeCount = configs.filter(
    (c) => c.status === "elaborating" || c.status === "checking"
  ).length;
  const failedCount = configs.filter((c) => c.status === "failed").length;

  async function triggerScraping(locationId: string, platform: string) {
    setTriggerLoading(`${locationId}:${platform}`);
    setMessage(null);

    const { error } = await supabase.functions.invoke("scraping-trigger", {
      body: { location_id: locationId, platform },
    });

    if (error) {
      setMessage({ type: "err", text: error.message });
    } else {
      setMessage({ type: "ok", text: `Scraping avviato! Ricarica per aggiornare lo stato.` });
    }
    setTriggerLoading(null);
  }

  async function pollScrapingStatus() {
    setPollLoading(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("scraping-poll", {
        body: {},
      });
      if (error) {
        setMessage({ type: "err", text: `Errore polling: ${error.message}` });
      } else {
        const results = data?.results ?? [];
        const completed = results.filter((r: { status: string }) => r.status === "completed").length;
        const failed = results.filter((r: { status: string }) => r.status === "job_failed").length;
        const processing = results.filter((r: { status: string }) => r.status !== "completed" && r.status !== "job_failed").length;
        if (results.length === 0) {
          setMessage({ type: "ok", text: "Nessun job attivo da controllare." });
        } else {
          setMessage({ type: "ok", text: `Controllati ${results.length} job: ${completed} completati, ${processing} in corso, ${failed} falliti. Ricarica la pagina.` });
        }
      }
    } catch {
      setMessage({ type: "err", text: "Errore durante il controllo." });
    }
    setPollLoading(false);
  }

  return (
    <div class="space-y-4">
      {/* Filter tabs + poll button */}
      <div class="flex items-center justify-between">
      <div class="flex gap-2">
        {(
          [
            { key: "all", label: `Tutti (${configs.length})` },
            { key: "active", label: `Attivi (${activeCount})` },
            { key: "failed", label: `Errori (${failedCount})` },
            { key: "idle", label: "Idle" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            class={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === tab.key
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeCount > 0 && (
        <button
          type="button"
          disabled={pollLoading}
          onClick={pollScrapingStatus}
          class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {pollLoading ? "Controllo..." : "Controlla Stato"}
        </button>
      )}
      </div>

      {botsterCredits !== null && (
        <div class="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
          <div class="text-sm text-gray-500">Crediti Botster disponibili</div>
          <div class="text-2xl font-bold text-blue-700">{botsterCredits.toLocaleString("it-IT")}</div>
        </div>
      )}

      {message && (
        <div
          class={`rounded-lg p-3 text-sm ${
            message.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Config list */}
      <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Location</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Business</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Piattaforma</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Depth</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Ultimo Scraping</th>
              <th class="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Azioni</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            {filtered.map((cfg) => {
              const st = STATUS_CONFIG[cfg.status] ?? STATUS_CONFIG.idle;
              const loc = cfg.locations;
              const biz = loc?.businesses;
              const key = `${loc?.id}:${cfg.platform}`;
              const isLoading = triggerLoading === key;
              const depthLabel = cfg.initial_scrape_done
                ? `${cfg.recurring_depth} (rec)`
                : `${cfg.initial_depth} (init)`;

              return (
                <tr key={cfg.id} class={cfg.status === "failed" ? "bg-red-50/30" : ""}>
                  <td class="px-4 py-3">
                    <div class="text-sm font-medium text-gray-900">
                      {loc?.name ?? "—"}
                    </div>
                    {loc?.is_competitor && (
                      <span class="text-xs text-orange-500">Competitor</span>
                    )}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    {biz?.name ?? "—"}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">
                    {PLATFORM_LABELS[cfg.platform] ?? cfg.platform}
                    <div class="text-xs text-gray-400">{cfg.frequency}</div>
                  </td>
                  <td class="px-4 py-3">
                    <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                      {st.label}
                    </span>
                    {cfg.retry_count > 0 && (
                      <span class="ml-1 text-xs text-gray-400">
                        (retry: {cfg.retry_count})
                      </span>
                    )}
                    {cfg.last_error && (
                      <div class="mt-1 max-w-48 truncate text-xs text-red-500" title={cfg.last_error}>
                        {cfg.last_error}
                      </div>
                    )}
                  </td>
                  <td class="px-4 py-3 text-xs text-gray-600 font-mono">
                    {depthLabel}
                  </td>
                  <td class="px-4 py-3 text-xs text-gray-500">
                    {cfg.last_scraped_at
                      ? new Date(cfg.last_scraped_at).toLocaleString("it-IT")
                      : "Mai"}
                  </td>
                  <td class="px-4 py-3 text-right">
                    {loc && (
                      <button
                        type="button"
                        disabled={isLoading || cfg.status === "elaborating" || cfg.status === "checking"}
                        onClick={() => triggerScraping(loc.id, cfg.platform)}
                        class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isLoading ? "..." : "Avvia Scraping rapido"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div class="p-8 text-center text-sm text-gray-500">
            Nessuna configurazione trovata per il filtro selezionato.
          </div>
        )}
      </div>
    </div>
  );
}
