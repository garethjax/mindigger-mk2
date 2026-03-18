import { useEffect, useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import { PLATFORM_DEFAULTS } from "@/lib/scraping-defaults";
import PlaceFinder from "./PlaceFinder";
import {
  applyLocationUpdate,
  buildScrapingConfigUpdatePayload,
  buildLocationUpdatePayload,
  formatFunctionInvokeError,
  getToastDuration,
  getScrapingConfigFieldMeta,
  getScrapingConfigFieldValue,
  isScrapingConfigBusy,
  type EditableLocation,
} from "./helpers";

interface Location extends EditableLocation {}

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
  businessId: string;
  locations: Location[];
  scrapingConfigs: ScrapingConfig[];
  sectors: Sector[];
  googleMapsApiKey?: string;
  onLocationsChange: (locations: Location[]) => void;
  onMessage: (msg: { type: "ok" | "err"; text: string }) => void;
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

export default function LocationManager({
  businessId,
  locations,
  scrapingConfigs: initialConfigs,
  sectors,
  googleMapsApiKey,
  onLocationsChange,
  onMessage,
}: Props) {
  const [configs, setConfigs] = useState(initialConfigs);
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocSector, setNewLocSector] = useState(sectors[0]?.id ?? "");
  const [newLocCompetitor, setNewLocCompetitor] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editingLocationName, setEditingLocationName] = useState("");
  const [editingLocationSectorId, setEditingLocationSectorId] = useState("");
  const [editingLocationCompetitor, setEditingLocationCompetitor] = useState(false);
  const [locationSaving, setLocationSaving] = useState<string | null>(null);

  // Scraping config form state
  const [configuringLocationId, setConfiguringLocationId] = useState<string | null>(null);
  const [platformFields, setPlatformFields] = useState<PlatformFields>({ ...INITIAL_PLATFORM_FIELDS });
  const [configSaving, setConfigSaving] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [editingConfigValue, setEditingConfigValue] = useState("");
  const [editingConfigSaving, setEditingConfigSaving] = useState<string | null>(null);

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

    const { data, error } = await supabase
      .from("locations")
      .insert({
        name: newLocName.trim(),
        business_id: businessId,
        business_sector_id: newLocSector,
        is_competitor: newLocCompetitor,
      })
      .select("id, name, is_competitor, business_sector_id, recurring_updates, created_at")
      .single();

    if (error) {
      onMessage({ type: "err", text: `Errore: ${error.message}` });
    } else if (data) {
      onLocationsChange([...locations, data]);
      setNewLocName("");
      setNewLocCompetitor(false);
      setShowAddForm(false);
      onMessage({ type: "ok", text: `Location "${data.name}" aggiunta` });
    }
    setAddLoading(false);
  }

  async function triggerScraping(locationId: string, config: ScrapingConfig) {
    const key = `${locationId}:${config.platform}`;
    if (triggerLoading === key) return;

    const currentConfig = configs.find((item) => item.id === config.id) ?? config;
    if (isScrapingConfigBusy(currentConfig.status)) {
      onMessage({
        type: "err",
        text: `Scraping già in corso per ${PLATFORM_LABELS[currentConfig.platform] ?? currentConfig.platform}.`,
      });
      return;
    }

    setTriggerLoading(key);

    const { error } = await supabase.functions.invoke("scraping-trigger", {
      body: { location_id: locationId, platform: config.platform },
    });

    if (error) {
      const detail = await formatFunctionInvokeError(error as { message: string; context?: Response });
      onMessage({ type: "err", text: `Errore trigger: ${detail}` });
    } else {
      setConfigs(configs.map((item) =>
        item.id === config.id
          ? { ...item, status: "elaborating" }
          : item
      ));
      onMessage({
        type: "ok",
        text: `Scraping avviato per ${PLATFORM_LABELS[config.platform] ?? config.platform}`,
      });
    }
    setTriggerLoading(null);
  }

  async function importReviewsFromJson(configId: string, platform: string, file: File | null) {
    if (!file) return;

    const key = `${configId}:import`;
    setImportLoading(key);

    try {
      const rawText = await file.text();
      const rawJson = JSON.parse(rawText);

      const { data, error } = await supabase.functions.invoke("scraping-import", {
        body: {
          config_id: configId,
          raw_reviews: rawJson,
          trigger_analysis: false,
        },
      });

      if (error) {
        const detail = await formatFunctionInvokeError(error as { message: string; context?: Response });
        onMessage({ type: "err", text: `Errore import: ${detail}` });
      } else {
        const inserted = Number(data?.inserted_reviews ?? 0);
        const parsed = Number(data?.parsed_reviews ?? 0);
        const platformLabel = PLATFORM_LABELS[platform] ?? platform;
        onMessage({
          type: "ok",
          text: `Import ${platformLabel} completato: ${inserted} inserite su ${parsed} review lette. Analisi AI in coda via cron.`,
        });
      }
    } catch {
      onMessage({ type: "err", text: "JSON non valido. Controlla il file esportato da Botster." });
    } finally {
      setImportLoading(null);
    }
  }

  async function triggerLocationPipeline(locationId: string, locationName: string) {
    setAnalysisLoading(locationId);

    const { data, error } = await supabase.functions.invoke("analysis-submit", {
      body: { location_id: locationId },
    });

    if (error) {
      const detail = await formatFunctionInvokeError(error as { message: string; context?: Response });
      onMessage({ type: "err", text: `Pipeline AI (${locationName}): ${detail}` });
      setAnalysisLoading(null);
      return;
    }

    const payload = data as { submitted?: number; batches?: string[]; message?: string; active_batches?: number };
    if (payload?.message?.toLowerCase().includes("already in progress")) {
      onMessage({
        type: "ok",
        text: `Pipeline AI (${locationName}): già in corso (${payload.active_batches ?? 1} batch attivi).`,
      });
      setAnalysisLoading(null);
      return;
    }

    const submitted = Number(payload?.submitted ?? 0);
    const batches = ((data as { batches?: string[] })?.batches ?? []).length;
    if (submitted === 0) {
      onMessage({ type: "ok", text: `Pipeline AI (${locationName}): nessuna review pending da inviare.` });
    } else {
      onMessage({
        type: "ok",
        text: `Pipeline AI (${locationName}) avviata: ${submitted} review inviate, ${batches} batch creati.`,
      });
    }
    setAnalysisLoading(null);
  }

  async function toggleRecurring(locationId: string, current: boolean) {
    const { error } = await supabase
      .from("locations")
      .update({ recurring_updates: !current })
      .eq("id", locationId);

    if (error) {
      onMessage({ type: "err", text: `Errore: ${error.message}` });
    } else {
      onLocationsChange(locations.map((l) =>
        l.id === locationId ? { ...l, recurring_updates: !current } : l
      ));
    }
  }

  function openLocationEditor(location: Location) {
    setEditingLocationId(location.id);
    setEditingLocationName(location.name);
    setEditingLocationSectorId(location.business_sector_id);
    setEditingLocationCompetitor(location.is_competitor);
  }

  function cancelLocationEditor() {
    setEditingLocationId(null);
    setEditingLocationName("");
    setEditingLocationSectorId("");
    setEditingLocationCompetitor(false);
  }

  async function saveLocation(locationId: string) {
    const payload = buildLocationUpdatePayload({
      name: editingLocationName,
      businessSectorId: editingLocationSectorId,
      isCompetitor: editingLocationCompetitor,
    });

    if (!payload.name) {
      onMessage({ type: "err", text: "Il nome location non può essere vuoto." });
      return;
    }

    setLocationSaving(locationId);

    const { error } = await supabase
      .from("locations")
      .update(payload)
      .eq("id", locationId);

    if (error) {
      onMessage({ type: "err", text: `Errore location: ${error.message}` });
    } else {
      onLocationsChange(applyLocationUpdate(locations, { id: locationId, ...payload }));
      onMessage({ type: "ok", text: `Location "${payload.name}" aggiornata.` });
      cancelLocationEditor();
    }

    setLocationSaving(null);
  }

  function openConfigForm(locationId: string) {
    setConfiguringLocationId(locationId);
    setPlatformFields({ ...INITIAL_PLATFORM_FIELDS });
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
      onMessage({ type: "err", text: "Compila almeno una piattaforma prima di salvare." });
      setConfigSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from("scraping_configs")
      .insert(platformConfigs)
      .select("id, location_id, platform, status, initial_scrape_done, last_scraped_at, platform_config");

    if (error) {
      onMessage({ type: "err", text: `Errore salvataggio: ${error.message}` });
    } else if (data) {
      setConfigs([...configs, ...data]);
      onMessage({ type: "ok", text: `${data.length} piattaforma/e configurata/e` });
      closeConfigForm();
    }
    setConfigSaving(false);
  }

  function openConfigEditor(config: ScrapingConfig) {
    setEditingConfigId(config.id);
    setEditingConfigValue(getScrapingConfigFieldValue(config.platform, config.platform_config ?? {}));
  }

  function cancelConfigEditor() {
    setEditingConfigId(null);
    setEditingConfigValue("");
  }

  async function saveConfigSource(config: ScrapingConfig) {
    const payload = buildScrapingConfigUpdatePayload(config.platform, editingConfigValue);
    const rawValue = Object.values(payload.platform_config)[0] ?? "";
    if (!rawValue) {
      onMessage({ type: "err", text: "Il riferimento sorgente non può essere vuoto." });
      return;
    }

    setEditingConfigSaving(config.id);

    const { error } = await supabase
      .from("scraping_configs")
      .update(payload)
      .eq("id", config.id);

    if (error) {
      onMessage({ type: "err", text: `Errore config scraping: ${error.message}` });
    } else {
      setConfigs(configs.map((item) =>
        item.id === config.id
          ? { ...item, platform_config: payload.platform_config }
          : item
      ));
      onMessage({ type: "ok", text: `Sorgente ${PLATFORM_LABELS[config.platform] ?? config.platform} aggiornata.` });
      cancelConfigEditor();
    }

    setEditingConfigSaving(null);
  }

  return (
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
            const isEditingLocation = editingLocationId === loc.id;

            return (
              <div
                key={loc.id}
                class="rounded-lg border border-gray-100 bg-gray-50 p-4"
              >
                <div class="mb-2 flex items-center justify-between">
                  {isEditingLocation ? (
                    <div class="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        value={editingLocationName}
                        onInput={(e) => setEditingLocationName((e.target as HTMLInputElement).value)}
                        class="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      />
                      <select
                        value={editingLocationSectorId}
                        onChange={(e) => setEditingLocationSectorId((e.target as HTMLSelectElement).value)}
                        class="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      >
                        {sectors.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <label class="flex items-center gap-1.5 text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={editingLocationCompetitor}
                          onChange={(e) => setEditingLocationCompetitor((e.target as HTMLInputElement).checked)}
                          class="rounded border-gray-300"
                        />
                        Competitor
                      </label>
                    </div>
                  ) : (
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-gray-900">{loc.name}</span>
                      {loc.is_competitor && (
                        <span class="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          Competitor
                        </span>
                      )}
                    </div>
                  )}
                  <div class="flex items-center gap-3">
                    {isEditingLocation ? (
                      <>
                        <button
                          type="button"
                          disabled={locationSaving === loc.id}
                          onClick={() => saveLocation(loc.id)}
                          class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {locationSaving === loc.id ? "..." : "Salva"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelLocationEditor}
                          class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Annulla
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openLocationEditor(loc)}
                        class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Modifica
                      </button>
                    )}
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
                        try {
                          await downloadLocationCsv(supabase, loc.id, loc.name, businessId);
                          onMessage({ type: "ok", text: `CSV scaricato per "${loc.name}"` });
                        } catch {
                          onMessage({ type: "err", text: `Errore download CSV per "${loc.name}"` });
                        }
                        setCsvLoading(null);
                      }}
                      class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      title="Scarica recensioni CSV"
                    >
                      {csvLoading === loc.id ? "..." : "Download recensioni"}
                    </button>
                    <button
                      type="button"
                      disabled={analysisLoading === loc.id}
                      onClick={() => triggerLocationPipeline(loc.id, loc.name)}
                      class="rounded border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      title="Invia in pipeline AI le recensioni pending di questa location"
                    >
                      {analysisLoading === loc.id ? "..." : "Avvia Pipeline AI"}
                    </button>
                    <span class="text-xs text-gray-400">
                      {sector?.name ?? "\u2014"}
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
                        const fieldMeta = getScrapingConfigFieldMeta(cfg.platform);
                        const configValue = getScrapingConfigFieldValue(cfg.platform, cfg.platform_config ?? {});
                        const isEditingConfig = editingConfigId === cfg.id;

                        return (
                          <div
                            key={cfg.id}
                            class="rounded border border-gray-200 bg-white px-3 py-2"
                          >
                            <div class="flex items-start justify-between gap-4">
                              <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-3">
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
                                        : "\u2014"}
                                    </span>
                                  )}
                                </div>

                                <div class="mt-2 rounded border border-gray-100 bg-gray-50 px-3 py-2">
                                  <div class="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                    {fieldMeta.label}
                                  </div>
                                  {isEditingConfig ? (
                                    <div class="mt-2 flex flex-wrap items-center gap-2">
                                      <input
                                        type={fieldMeta.inputType}
                                        value={editingConfigValue}
                                        onInput={(e) => setEditingConfigValue((e.target as HTMLInputElement).value)}
                                        placeholder={fieldMeta.placeholder}
                                        class="min-w-[20rem] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono text-gray-700 focus:border-blue-500 focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        disabled={editingConfigSaving === cfg.id}
                                        onClick={() => saveConfigSource(cfg)}
                                        class="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        {editingConfigSaving === cfg.id ? "..." : "Salva sorgente"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelConfigEditor}
                                        class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                      >
                                        Annulla
                                      </button>
                                    </div>
                                  ) : (
                                    <div class="mt-1 flex items-start justify-between gap-3">
                                      <code class="block whitespace-normal break-all text-xs text-gray-600">
                                        {configValue || "\u2014"}
                                      </code>
                                      <button
                                        type="button"
                                        onClick={() => openConfigEditor(cfg)}
                                        class="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                      >
                                        Modifica sorgente
                                      </button>
                                    </div>
                                  )}
                                </div>
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
                                  disabled={isLoading || isImporting || isScrapingConfigBusy(cfg.status)}
                                  onClick={() => triggerScraping(loc.id, cfg)}
                                  class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {isLoading ? "..." : "Avvia Scraping rapido"}
                                </button>
                              </div>
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
  );
}
