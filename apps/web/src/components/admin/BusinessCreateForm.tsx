import { useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import PlaceFinder from "./PlaceFinder";

interface Props {
  users: { id: string; full_name: string | null }[];
  sectors: { id: string; name: string; platforms: string[] }[];
  googleMapsApiKey?: string;
}

interface LocationEntry {
  name: string;
  sectorId: string;
  isCompetitor: boolean;
}

interface PlaceData {
  placeId: string;
  name: string;
  address: string;
  tripadvisorUrl?: string;
  bookingUrl?: string;
}

export default function BusinessCreateForm({ users, sectors, googleMapsApiKey }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState("organization");
  const [userId, setUserId] = useState("");
  const [locations, setLocations] = useState<LocationEntry[]>([
    { name: "", sectorId: sectors[0]?.id ?? "", isCompetitor: false },
  ]);
  const [placeData, setPlaceData] = useState<PlaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const supabase = createSupabaseBrowser();

  function addLocation() {
    setLocations([...locations, { name: "", sectorId: sectors[0]?.id ?? "", isCompetitor: false }]);
  }

  function removeLocation(i: number) {
    setLocations(locations.filter((_, idx) => idx !== i));
  }

  function updateLocation(i: number, field: keyof LocationEntry, value: string | boolean) {
    const copy = [...locations];
    (copy[i] as any)[field] = value;
    setLocations(copy);
  }

  function handlePlaceSelected(data: PlaceData) {
    setPlaceData((prev) => ({ ...prev, ...data }));
    // Auto-fill first location name if empty
    if (locations[0] && !locations[0].name && data.name) {
      updateLocation(0, "name", data.name);
    }
    // Auto-fill business name if empty
    if (!name && data.name) {
      setName(data.name);
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!userId) {
      setError("Seleziona un utente proprietario");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");

    // Create business
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({ name, type })
      .select("id")
      .single();

    if (bizErr || !biz) {
      setError(bizErr?.message ?? "Errore nella creazione");
      setLoading(false);
      return;
    }

    // Assign user to this business
    if (userId) {
      await supabase
        .from("profiles")
        .update({ business_id: biz.id })
        .eq("id", userId);
    }

    // Create locations
    const validLocs = locations.filter((l) => l.name.trim());
    if (validLocs.length > 0) {
      const { error: locErr } = await supabase.from("locations").insert(
        validLocs.map((l) => ({
          name: l.name.trim(),
          business_id: biz.id,
          business_sector_id: l.sectorId,
          is_competitor: l.isCompetitor,
        }))
      );
      if (locErr) {
        setError(`Business creato ma errore nelle location: ${locErr.message}`);
        setLoading(false);
        return;
      }

      // Create scraping configs if we have place data
      if (placeData) {
        // Get the first created location's ID
        const { data: createdLocs } = await supabase
          .from("locations")
          .select("id")
          .eq("business_id", biz.id)
          .order("created_at")
          .limit(1);

        if (createdLocs?.[0]) {
          const locId = createdLocs[0].id;
          const sector = sectors.find((s) => s.id === validLocs[0].sectorId);
          const platformConfigs = [];

          // Google Maps config (if Place ID available)
          if (placeData.placeId && sector?.platforms.includes("google_maps")) {
            platformConfigs.push({
              location_id: locId,
              platform: "google_maps" as const,
              platform_config: { place_id: placeData.placeId },
              initial_depth: 2000,
              recurring_depth: 100,
              frequency: "weekly" as const,
            });
          }

          // TripAdvisor config
          if (placeData.tripadvisorUrl && sector?.platforms.includes("tripadvisor")) {
            platformConfigs.push({
              location_id: locId,
              platform: "tripadvisor" as const,
              platform_config: { location_url: placeData.tripadvisorUrl },
              initial_depth: 2000,
              recurring_depth: 30,
              frequency: "weekly" as const,
            });
          }

          // Booking config
          if (placeData.bookingUrl && sector?.platforms.includes("booking")) {
            platformConfigs.push({
              location_id: locId,
              platform: "booking" as const,
              platform_config: { location_url: placeData.bookingUrl },
              initial_depth: 250,
              recurring_depth: 250,
              frequency: "monthly" as const,
            });
          }

          if (platformConfigs.length > 0) {
            await supabase.from("scraping_configs").insert(platformConfigs);
          }
        }
      }
    }

    setSuccess("Business creato! Reindirizzamento...");
    setLoading(false);
    setTimeout(() => {
      window.location.href = `/regia/businesses/${biz.id}`;
    }, 800);
  }

  return (
    <form onSubmit={handleSubmit} class="max-w-2xl space-y-6">
      {/* Place Finder Widget */}
      {googleMapsApiKey && (
        <div class="rounded-lg border border-gray-200 bg-white p-6">
          <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
            Cerca Location
          </h2>
          <PlaceFinder
            googleMapsApiKey={googleMapsApiKey}
            onPlaceSelected={handlePlaceSelected}
          />
          {placeData && (
            <div class="mt-3 space-y-1 text-xs text-gray-500">
              {placeData.placeId && <div>Place ID: <code class="font-mono">{placeData.placeId}</code></div>}
              {placeData.tripadvisorUrl && <div>TripAdvisor: {placeData.tripadvisorUrl}</div>}
              {placeData.bookingUrl && <div>Booking: {placeData.bookingUrl}</div>}
            </div>
          )}
        </div>
      )}

      {/* Business Info */}
      <div class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Info Business</h2>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Nome *</label>
          <input
            type="text"
            required
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Tipo</label>
          <select
            value={type}
            onChange={(e) => setType((e.target as HTMLSelectElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="organization">Organization</option>
            <option value="hotel">Hotel</option>
            <option value="restaurant">Restaurant</option>
          </select>
        </div>

        <div>
          <label class="mb-1 block text-xs font-medium text-gray-500">Proprietario *</label>
          <select
            required
            value={userId}
            onChange={(e) => setUserId((e.target as HTMLSelectElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">— Seleziona utente —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Locations */}
      <div class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold uppercase tracking-wide text-gray-500">Location</h2>
          <button
            type="button"
            onClick={addLocation}
            class="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            + Aggiungi Location
          </button>
        </div>

        {locations.map((loc, i) => (
          <div key={i} class="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div class="flex-1 space-y-2">
              <input
                type="text"
                placeholder="Nome location"
                value={loc.name}
                onInput={(e) => updateLocation(i, "name", (e.target as HTMLInputElement).value)}
                class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <div class="flex gap-2">
                <select
                  value={loc.sectorId}
                  onChange={(e) => updateLocation(i, "sectorId", (e.target as HTMLSelectElement).value)}
                  class="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <label class="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={loc.isCompetitor}
                    onChange={(e) => updateLocation(i, "isCompetitor", (e.target as HTMLInputElement).checked)}
                    class="rounded border-gray-300"
                  />
                  Competitor
                </label>
              </div>
            </div>
            {locations.length > 1 && (
              <button
                type="button"
                onClick={() => removeLocation(i)}
                class="mt-1 text-xs text-red-500 hover:text-red-700"
              >
                Rimuovi
              </button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div class="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>
      )}

      <button
        type="submit"
        disabled={loading}
        class="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? "Creazione..." : "Crea Business"}
      </button>
    </form>
  );
}
