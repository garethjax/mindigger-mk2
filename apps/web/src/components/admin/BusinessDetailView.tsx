import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface Business {
  id: string;
  name: string;
  type: string;
  user_id: string;
  embeddings_enabled: boolean;
}

interface Location {
  id: string;
  name: string;
  is_competitor: boolean;
  business_sector_id: string;
  created_at: string;
}

interface ScrapingConfig {
  id: string;
  location_id: string;
  platform: string;
  status: string;
  initial_scrape_done: boolean;
  last_scraped_at: string | null;
  platform_config: Record<string, string>;
}

interface Sector {
  id: string;
  name: string;
  platforms: string[];
}

interface Props {
  business: Business;
  locations: Location[];
  scrapingConfigs: ScrapingConfig[];
  sectors: Sector[];
  ownerName: string;
  reviewCount: number;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  idle: { label: "Idle", color: "bg-gray-100 text-gray-600" },
  elaborating: { label: "In corso", color: "bg-blue-100 text-blue-700" },
  checking: { label: "Verifica", color: "bg-yellow-100 text-yellow-700" },
  completed: { label: "Completato", color: "bg-green-100 text-green-700" },
  failed: { label: "Errore", color: "bg-red-100 text-red-700" },
};

const PLATFORM_LABELS: Record<string, string> = {
  google_maps: "Google Maps",
  tripadvisor: "TripAdvisor",
  booking: "Booking",
  trustpilot: "Trustpilot",
};

export default function BusinessDetailView({
  business,
  locations: initialLocations,
  scrapingConfigs: initialConfigs,
  sectors,
  ownerName,
  reviewCount,
}: Props) {
  const [locations] = useState(initialLocations);
  const [configs] = useState(initialConfigs);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const supabase = createSupabaseBrowser();

  const configsByLocation = new Map<string, ScrapingConfig[]>();
  for (const c of configs) {
    const list = configsByLocation.get(c.location_id) ?? [];
    list.push(c);
    configsByLocation.set(c.location_id, list);
  }

  async function triggerScraping(locationId: string, platform: string) {
    const key = `${locationId}:${platform}`;
    setTriggerLoading(key);
    setMessage(null);

    const { data, error } = await supabase.functions.invoke("scraping-trigger", {
      body: { location_id: locationId, platform },
    });

    if (error) {
      setMessage({ type: "err", text: `Errore trigger: ${error.message}` });
    } else {
      setMessage({ type: "ok", text: `Scraping avviato per ${PLATFORM_LABELS[platform] ?? platform}` });
    }
    setTriggerLoading(null);
  }

  return (
    <div class="space-y-6">
      {/* Business Info */}
      <div class="rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Info</h2>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">Nome:</span>{" "}
            <span class="font-medium">{business.name}</span>
          </div>
          <div>
            <span class="text-gray-400">Tipo:</span> {business.type}
          </div>
          <div>
            <span class="text-gray-400">Proprietario:</span> {ownerName}
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

      {/* Locations + Scraping */}
      <div class="rounded-lg border border-gray-200 bg-white p-6">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">
            Location ({locations.length})
          </h2>
        </div>

        {locations.length === 0 ? (
          <p class="text-sm text-gray-400">Nessuna location. Aggiungi location dalla pagina di creazione.</p>
        ) : (
          <div class="space-y-4">
            {locations.map((loc) => {
              const locConfigs = configsByLocation.get(loc.id) ?? [];
              const sector = sectors.find((s) => s.id === loc.business_sector_id);

              return (
                <div
                  key={loc.id}
                  class="rounded-lg border border-gray-100 bg-gray-50 p-4"
                >
                  <div class="mb-2 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-gray-900">{loc.name}</span>
                      {loc.is_competitor && (
                        <span class="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          Competitor
                        </span>
                      )}
                    </div>
                    <span class="text-xs text-gray-400">
                      {sector?.name ?? "—"}
                    </span>
                  </div>

                  {/* Scraping configs for this location */}
                  {locConfigs.length > 0 ? (
                    <div class="mt-2 space-y-2">
                      {locConfigs.map((cfg) => {
                        const st = STATUS_LABELS[cfg.status] ?? STATUS_LABELS.idle;
                        const key = `${loc.id}:${cfg.platform}`;
                        const isLoading = triggerLoading === key;
                        const configStr = Object.entries(cfg.platform_config ?? {})
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ");

                        return (
                          <div
                            key={cfg.id}
                            class="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2"
                          >
                            <div class="flex items-center gap-3">
                              <span class="text-xs font-medium text-gray-600">
                                {PLATFORM_LABELS[cfg.platform] ?? cfg.platform}
                              </span>
                              <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                                {st.label}
                              </span>
                              {cfg.initial_scrape_done && (
                                <span class="text-xs text-gray-400">
                                  Ultimo: {cfg.last_scraped_at
                                    ? new Date(cfg.last_scraped_at).toLocaleDateString("it-IT")
                                    : "—"}
                                </span>
                              )}
                              {configStr && (
                                <span class="text-xs text-gray-300 font-mono truncate max-w-48">
                                  {configStr}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={isLoading || cfg.status === "elaborating" || cfg.status === "checking"}
                              onClick={() => triggerScraping(loc.id, cfg.platform)}
                              class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {isLoading ? "..." : "Trigger"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p class="mt-1 text-xs text-gray-400">
                      Nessuna configurazione scraping. Configura le piattaforme per questa location.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
