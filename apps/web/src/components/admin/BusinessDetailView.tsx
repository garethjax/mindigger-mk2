import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import { PLATFORM_DEFAULTS } from "@/lib/scraping-defaults";
import PlaceFinder from "./PlaceFinder";

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
  recurring_updates: boolean;
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

interface PlaceData {
  placeId: string;
  name: string;
  address: string;
  tripadvisorUrl?: string;
  bookingUrl?: string;
}

interface PlatformFields {
  google_maps: string;
  tripadvisor: string;
  booking: string;
  trustpilot: string;
}

interface Props {
  business: Business;
  locations: Location[];
  scrapingConfigs: ScrapingConfig[];
  sectors: Sector[];
  usersLabel: string;
  reviewCount: number;
  googleMapsApiKey?: string;
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

const INITIAL_PLATFORM_FIELDS: PlatformFields = {
  google_maps: "",
  tripadvisor: "",
  booking: "",
  trustpilot: "",
};

export default function BusinessDetailView({
  business,
  locations: initialLocations,
  scrapingConfigs: initialConfigs,
  sectors,
  usersLabel,
  reviewCount,
  googleMapsApiKey,
}: Props) {
  const [locations, setLocations] = useState(initialLocations);
  const [configs, setConfigs] = useState(initialConfigs);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocSector, setNewLocSector] = useState(sectors[0]?.id ?? "");
  const [newLocCompetitor, setNewLocCompetitor] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  // Business edit state
  const [editingBusiness, setEditingBusiness] = useState(false);
  const [bizName, setBizName] = useState(business.name);
  const [bizType, setBizType] = useState(business.type);
  const [bizRagioneSociale, setBizRagioneSociale] = useState(business.ragione_sociale ?? "");
  const [bizEmail, setBizEmail] = useState(business.email ?? "");
  const [bizReferente, setBizReferente] = useState(business.referente_nome ?? "");
  const [bizSaving, setBizSaving] = useState(false);

  // Scraping config form state
  const [configuringLocationId, setConfiguringLocationId] = useState<string | null>(null);
  const [platformFields, setPlatformFields] = useState<PlatformFields>({ ...INITIAL_PLATFORM_FIELDS });
  const [configSaving, setConfigSaving] = useState(false);

  const supabase = createSupabaseBrowser();

  const configsByLocation = new Map<string, ScrapingConfig[]>();
  for (const c of configs) {
    const list = configsByLocation.get(c.location_id) ?? [];
    list.push(c);
    configsByLocation.set(c.location_id, list);
  }

  async function saveBusiness(e: Event) {
    e.preventDefault();
    setBizSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from("businesses")
      .update({
        name: bizName.trim(),
        type: bizType,
        ragione_sociale: bizRagioneSociale.trim() || null,
        email: bizEmail.trim() || null,
        referente_nome: bizReferente.trim() || null,
      })
      .eq("id", business.id);

    if (error) {
      setMessage({ type: "err", text: `Errore: ${error.message}` });
    } else {
      setMessage({ type: "ok", text: "Dati azienda aggiornati" });
      setEditingBusiness(false);
    }
    setBizSaving(false);
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
      .select("id, name, is_competitor, business_sector_id, recurring_updates, created_at")
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

  async function importReviewsFromJson(configId: string, platform: string, file: File | null) {
    if (!file) return;

    const key = `${configId}:import`;
    setImportLoading(key);
    setMessage(null);

    try {
      const rawText = await file.text();
      const rawJson = JSON.parse(rawText);

      const { data, error } = await supabase.functions.invoke("scraping-import", {
        body: {
          config_id: configId,
          raw_reviews: rawJson,
          trigger_analysis: true,
        },
      });

      if (error) {
        let detail = error.message;
        const context = (error as { context?: Response }).context;
        if (context) {
          const bodyText = await context.text().catch(() => "");
          detail = `HTTP ${context.status}${bodyText ? ` - ${bodyText}` : ""}`;
        }
        setMessage({ type: "err", text: `Errore import: ${detail}` });
      } else {
        const inserted = Number(data?.inserted_reviews ?? 0);
        const parsed = Number(data?.parsed_reviews ?? 0);
        const platformLabel = PLATFORM_LABELS[platform] ?? platform;
        setMessage({
          type: "ok",
          text: `Import ${platformLabel} completato: ${inserted} inserite su ${parsed} review lette.`,
        });
      }
    } catch {
      setMessage({ type: "err", text: "JSON non valido. Controlla il file esportato da Botster." });
    } finally {
      setImportLoading(null);
    }
  }

  async function toggleRecurring(locationId: string, current: boolean) {
    const { error } = await supabase
      .from("locations")
      .update({ recurring_updates: !current })
      .eq("id", locationId);

    if (error) {
      setMessage({ type: "err", text: `Errore: ${error.message}` });
    } else {
      setLocations(locations.map((l) =>
        l.id === locationId ? { ...l, recurring_updates: !current } : l
      ));
    }
  }

  function openConfigForm(locationId: string) {
    setConfiguringLocationId(locationId);
    setPlatformFields({ ...INITIAL_PLATFORM_FIELDS });
    setMessage(null);
  }

  function closeConfigForm() {
    setConfiguringLocationId(null);
    setPlatformFields({ ...INITIAL_PLATFORM_FIELDS });
  }

  function handlePlaceSelected(data: PlaceData) {
    setPlatformFields((prev) => ({
      ...prev,
      google_maps: data.placeId || prev.google_maps,
      tripadvisor: data.tripadvisorUrl || prev.tripadvisor,
      booking: data.bookingUrl || prev.booking,
    }));
  }

  async function saveScrapingConfigs(locationId: string, sectorId: string) {
    const sector = sectors.find((s) => s.id === sectorId);
    if (!sector) return;

    setConfigSaving(true);
    setMessage(null);

    // Skip platforms already configured for this location
    const alreadyConfigured = configs
      .filter((c) => c.location_id === locationId)
      .map((c) => c.platform);

    const canAdd = (p: string) =>
      sector.platforms.includes(p) && !alreadyConfigured.includes(p);

    const platformConfigs: {
      location_id: string;
      platform: string;
      platform_config: Record<string, string>;
      initial_depth: number;
      recurring_depth: number;
      frequency: string;
    }[] = [];

    const platformFieldMap: Record<string, { key: keyof PlatformFields; configKey: string }> = {
      google_maps: { key: "google_maps", configKey: "place_id" },
      tripadvisor: { key: "tripadvisor", configKey: "location_url" },
      booking: { key: "booking", configKey: "location_url" },
      trustpilot: { key: "trustpilot", configKey: "location_url" },
    };

    for (const [platform, { key, configKey }] of Object.entries(platformFieldMap)) {
      const value = platformFields[key];
      if (value && canAdd(platform)) {
        const defaults = PLATFORM_DEFAULTS[platform];
        platformConfigs.push({
          location_id: locationId,
          platform,
          platform_config: { [configKey]: value },
          initial_depth: defaults?.initial_depth ?? 1000,
          recurring_depth: defaults?.recurring_depth ?? 50,
          frequency: defaults?.frequency ?? "weekly",
        });
      }
    }

    if (platformConfigs.length === 0) {
      setMessage({ type: "err", text: "Compila almeno una piattaforma prima di salvare." });
      setConfigSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("scraping_configs")
      .insert(platformConfigs)
      .select("id, location_id, platform, status, initial_scrape_done, last_scraped_at, platform_config");

    if (error) {
      setMessage({ type: "err", text: `Errore salvataggio: ${error.message}` });
    } else if (data) {
      setConfigs([...configs, ...data]);
      setMessage({ type: "ok", text: `${data.length} piattaforma/e configurata/e` });
      closeConfigForm();
    }
    setConfigSaving(false);
  }

  return (
    <div class="space-y-6">
      {/* Dati Azienda */}
      <div class="rounded-lg border border-gray-200 bg-white p-6">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Dati Azienda</h2>
          {!editingBusiness && (
            <button
              type="button"
              onClick={() => setEditingBusiness(true)}
              class="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Modifica
            </button>
          )}
        </div>

        {editingBusiness ? (
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
                disabled={bizSaving}
                class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {bizSaving ? "..." : "Salva"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingBusiness(false);
                  setBizName(business.name);
                  setBizType(business.type);
                  setBizRagioneSociale(business.ragione_sociale ?? "");
                  setBizEmail(business.email ?? "");
                  setBizReferente(business.referente_nome ?? "");
                }}
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
                      <label
                        class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer"
                        title={loc.recurring_updates ? "Aggiornamento ricorrente attivo" : "Aggiornamento ricorrente disattivato"}
                      >
                        <input
                          type="checkbox"
                          checked={loc.recurring_updates}
                          onChange={() => toggleRecurring(loc.id, loc.recurring_updates)}
                          class="rounded border-gray-300"
                        />
                        Ricorrente
                      </label>
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
                  {(() => {
                    const configuredPlatforms = locConfigs.map((c) => c.platform);
                    const missingPlatforms = (sector?.platforms ?? []).filter(
                      (p) => !configuredPlatforms.includes(p)
                    );
                    const isConfiguring = configuringLocationId === loc.id;

                    return (
                      <div class="mt-2 space-y-2">
                        {/* Existing configs */}
                        {locConfigs.map((cfg) => {
                          const st = STATUS_LABELS[cfg.status] ?? STATUS_LABELS.idle;
                          const key = `${loc.id}:${cfg.platform}`;
                          const isLoading = triggerLoading === key;
                          const isImporting = importLoading === `${cfg.id}:import`;
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
                              <div class="flex items-center gap-2">
                                <label class="cursor-pointer rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                                  {isImporting ? "Import..." : "Importa recensioni"}
                                  <input
                                    type="file"
                                    accept=".json,application/json"
                                    class="hidden"
                                    disabled={isImporting || isLoading}
                                    onChange={(e) => {
                                      const input = e.target as HTMLInputElement;
                                      const file = input.files?.[0] ?? null;
                                      void importReviewsFromJson(cfg.id, cfg.platform, file);
                                      input.value = "";
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={isLoading || isImporting || cfg.status === "elaborating" || cfg.status === "checking"}
                                  onClick={() => triggerScraping(loc.id, cfg.platform)}
                                  class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {isLoading ? "..." : "Avvia Scraping rapido"}
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {/* Add platform button or form */}
                        {isConfiguring ? (
                          <div class="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-4">
                            <div class="flex items-center justify-between">
                              <h3 class="text-sm font-bold text-gray-700">
                                {locConfigs.length > 0 ? "Aggiungi piattaforma" : "Configura Piattaforme"}
                              </h3>
                              <button
                                type="button"
                                onClick={closeConfigForm}
                                class="text-xs text-gray-400 hover:text-gray-600"
                              >
                                Annulla
                              </button>
                            </div>

                            {/* PlaceFinder (if API key available) */}
                            {googleMapsApiKey && (
                              <div class="rounded-lg border border-gray-200 bg-white p-4">
                                <h4 class="mb-2 text-xs font-medium text-gray-500 uppercase">
                                  Cerca luogo (auto-compila i campi)
                                </h4>
                                <PlaceFinder
                                  googleMapsApiKey={googleMapsApiKey}
                                  onPlaceSelected={handlePlaceSelected}
                                />
                              </div>
                            )}

                            {/* Manual platform fields — only show missing platforms */}
                            <div class="space-y-3">
                              <h4 class="text-xs font-medium text-gray-500 uppercase">
                                {locConfigs.length > 0
                                  ? "Piattaforme da configurare"
                                  : `Piattaforme disponibili per ${sector?.name ?? "questo settore"}`}
                              </h4>

                              {missingPlatforms.includes("google_maps") && (
                                <div>
                                  <label class="mb-1 block text-xs font-medium text-gray-600">
                                    Google Maps — Place ID
                                  </label>
                                  <input
                                    type="text"
                                    value={platformFields.google_maps}
                                    onInput={(e) =>
                                      setPlatformFields((p) => ({ ...p, google_maps: (e.target as HTMLInputElement).value }))
                                    }
                                    placeholder="ChIJ..."
                                    class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
                                  />
                                </div>
                              )}

                              {missingPlatforms.includes("tripadvisor") && (
                                <div>
                                  <label class="mb-1 block text-xs font-medium text-gray-600">
                                    TripAdvisor — URL
                                  </label>
                                  <input
                                    type="url"
                                    value={platformFields.tripadvisor}
                                    onInput={(e) =>
                                      setPlatformFields((p) => ({ ...p, tripadvisor: (e.target as HTMLInputElement).value }))
                                    }
                                    placeholder="https://tripadvisor.com/..."
                                    class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                                  />
                                </div>
                              )}

                              {missingPlatforms.includes("booking") && (
                                <div>
                                  <label class="mb-1 block text-xs font-medium text-gray-600">
                                    Booking.com — URL
                                  </label>
                                  <input
                                    type="url"
                                    value={platformFields.booking}
                                    onInput={(e) =>
                                      setPlatformFields((p) => ({ ...p, booking: (e.target as HTMLInputElement).value }))
                                    }
                                    placeholder="https://booking.com/hotel/..."
                                    class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                                  />
                                </div>
                              )}

                              {missingPlatforms.includes("trustpilot") && (
                                <div>
                                  <label class="mb-1 block text-xs font-medium text-gray-600">
                                    Trustpilot — URL
                                  </label>
                                  <input
                                    type="url"
                                    value={platformFields.trustpilot}
                                    onInput={(e) =>
                                      setPlatformFields((p) => ({ ...p, trustpilot: (e.target as HTMLInputElement).value }))
                                    }
                                    placeholder="https://trustpilot.com/review/..."
                                    class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                                  />
                                </div>
                              )}

                              {missingPlatforms.length === 0 && (
                                <p class="text-xs text-gray-400">
                                  Tutte le piattaforme del settore sono già configurate.
                                </p>
                              )}
                            </div>

                            {missingPlatforms.length > 0 && (
                              <button
                                type="button"
                                disabled={configSaving}
                                onClick={() => saveScrapingConfigs(loc.id, loc.business_sector_id)}
                                class="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                {configSaving ? "Salvataggio..." : "Salva configurazione"}
                              </button>
                            )}
                          </div>
                        ) : missingPlatforms.length > 0 ? (
                          <div class="flex items-center gap-2">
                            {locConfigs.length === 0 && (
                              <p class="text-xs text-gray-400">Nessuna configurazione scraping.</p>
                            )}
                            <button
                              type="button"
                              onClick={() => openConfigForm(loc.id)}
                              class="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              {locConfigs.length > 0 ? "+ Aggiungi piattaforma" : "Configura piattaforme"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
