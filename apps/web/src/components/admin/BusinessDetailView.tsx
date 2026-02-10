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
  usersLabel: string;
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

// ── CSV helpers (RFC 4180 + Excel BOM) ──────────────────────────────
function csvEscapeField(value: unknown): string {
  if (value == null) return '""';
  const str = String(value);
  // Always quote: double any internal double-quotes
  return '"' + str.replace(/"/g, '""') + '"';
}

function buildCsvRow(fields: unknown[]): string {
  return fields.map(csvEscapeField).join(",");
}

const CSV_HEADERS: string[] = [
  "id", "source", "title", "text", "rating", "author",
  "review_date", "url", "status", "created_at",
];

async function downloadLocationCsv(
  supabase: ReturnType<typeof createSupabaseBrowser>,
  locationId: string,
  locationName: string,
  businessId: string,
) {
  const PAGE = 5000;
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from("reviews")
      .select("id, source, title, text, rating, author, review_date, url, status, created_at")
      .eq("location_id", locationId)
      .eq("business_id", businessId)
      .order("review_date", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error || !data) break;
    allRows.push(...data);
    done = data.length < PAGE;
    offset += PAGE;
  }

  const lines = [buildCsvRow(CSV_HEADERS)];
  for (const row of allRows) {
    lines.push(buildCsvRow(CSV_HEADERS.map((h) => row[h])));
  }

  // UTF-8 BOM so Excel auto-detects encoding
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = locationName.replace(/[^a-zA-Z0-9_-]+/g, "_");
  a.download = `recensioni_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
// ─────────────────────────────────────────────────────────────────────

export default function BusinessDetailView({
  business,
  locations: initialLocations,
  scrapingConfigs: initialConfigs,
  sectors,
  usersLabel,
  reviewCount,
}: Props) {
  const [locations, setLocations] = useState(initialLocations);
  const [configs, setConfigs] = useState(initialConfigs);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocSector, setNewLocSector] = useState(sectors[0]?.id ?? "");
  const [newLocCompetitor, setNewLocCompetitor] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const supabase = createSupabaseBrowser();

  const configsByLocation = new Map<string, ScrapingConfig[]>();
  for (const c of configs) {
    const list = configsByLocation.get(c.location_id) ?? [];
    list.push(c);
    configsByLocation.set(c.location_id, list);
  }

  async function addLocation(e: Event) {
    e.preventDefault();
    if (!newLocName.trim()) return;
    setAddLoading(true);
    setMessage(null);

    const { data, error } = await supabase
      .from("locations")
      .insert({
        name: newLocName.trim(),
        business_id: business.id,
        business_sector_id: newLocSector,
        is_competitor: newLocCompetitor,
      })
      .select("id, name, is_competitor, business_sector_id, created_at")
      .single();

    if (error) {
      setMessage({ type: "err", text: `Errore: ${error.message}` });
    } else if (data) {
      setLocations([...locations, data]);
      setNewLocName("");
      setNewLocCompetitor(false);
      setShowAddForm(false);
      setMessage({ type: "ok", text: `Location "${data.name}" aggiunta` });
    }
    setAddLoading(false);
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
      {/* Dati Azienda */}
      <div class="rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Dati Azienda</h2>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">Nome:</span>{" "}
            <span class="font-medium">{business.name}</span>
          </div>
          <div>
            <span class="text-gray-400">Tipo:</span> {business.type}
          </div>
          {business.ragione_sociale && (
            <div>
              <span class="text-gray-400">Ragione Sociale:</span>{" "}
              <span class="font-medium">{business.ragione_sociale}</span>
            </div>
          )}
          {business.email && (
            <div>
              <span class="text-gray-400">Email:</span> {business.email}
            </div>
          )}
          {business.referente_nome && (
            <div>
              <span class="text-gray-400">Referente:</span> {business.referente_nome}
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
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            class="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {showAddForm ? "Annulla" : "+ Aggiungi Location"}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={addLocation} class="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div class="flex flex-wrap items-end gap-3">
              <div class="flex-1 min-w-48">
                <label class="mb-1 block text-xs font-medium text-gray-600">Nome</label>
                <input
                  type="text"
                  required
                  value={newLocName}
                  onInput={(e) => setNewLocName((e.target as HTMLInputElement).value)}
                  class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Nome location"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-600">Settore</label>
                <select
                  value={newLocSector}
                  onChange={(e) => setNewLocSector((e.target as HTMLSelectElement).value)}
                  class="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <label class="flex items-center gap-1.5 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={newLocCompetitor}
                  onChange={(e) => setNewLocCompetitor((e.target as HTMLInputElement).checked)}
                  class="rounded border-gray-300"
                />
                Competitor
              </label>
              <button
                type="submit"
                disabled={addLoading}
                class="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {addLoading ? "..." : "Aggiungi"}
              </button>
            </div>
          </form>
        )}

        {locations.length === 0 && !showAddForm ? (
          <p class="text-sm text-gray-400">Nessuna location. Clicca "+ Aggiungi Location" per iniziare.</p>
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
                    <div class="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={csvLoading === loc.id}
                        onClick={async () => {
                          setCsvLoading(loc.id);
                          setMessage(null);
                          try {
                            await downloadLocationCsv(supabase, loc.id, loc.name, business.id);
                            setMessage({ type: "ok", text: `CSV scaricato per "${loc.name}"` });
                          } catch {
                            setMessage({ type: "err", text: `Errore download CSV per "${loc.name}"` });
                          }
                          setCsvLoading(null);
                        }}
                        class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        title="Scarica recensioni CSV"
                      >
                        {csvLoading === loc.id ? "..." : "Download recensioni"}
                      </button>
                      <span class="text-xs text-gray-400">
                        {sector?.name ?? "—"}
                      </span>
                    </div>
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
                              {isLoading ? "..." : "Avvia Scraping rapido"}
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
