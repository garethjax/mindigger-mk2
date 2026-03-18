import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import ScrapingConfigPanel, { type ScrapingConfig } from "./ScrapingConfigPanel";
import {
  applyLocationUpdate,
  buildLocationUpdatePayload,
  type EditableLocation,
} from "./helpers";

interface Location extends EditableLocation {}

interface Sector {
  id: string;
  name: string;
  platforms: string[];
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

  function handleConfigsChange(locationId: string, updatedLocConfigs: ScrapingConfig[]) {
    const otherConfigs = configs.filter((c) => c.location_id !== locationId);
    setConfigs([...otherConfigs, ...updatedLocConfigs]);
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
                    <span class="text-xs text-gray-400">
                      {sector?.name ?? "\u2014"}
                    </span>
                  </div>
                </div>

                {/* Scraping configs for this location */}
                <ScrapingConfigPanel
                  locationId={loc.id}
                  locationName={loc.name}
                  businessId={businessId}
                  businessSectorId={loc.business_sector_id}
                  scrapingConfigs={locConfigs}
                  sector={sector}
                  googleMapsApiKey={googleMapsApiKey}
                  onConfigsChange={(updated) => handleConfigsChange(loc.id, updated)}
                  onMessage={onMessage}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
