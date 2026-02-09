import { useState, useEffect } from "preact/hooks";

interface Location {
  id: string;
  name: string;
  is_competitor: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface Props {
  locations: Location[];
  categories?: Category[];
  isCompetitor?: boolean;
  onFilterChange: (filters: FilterState) => void;
}

export interface FilterState {
  locationId: string | null;
  categoryId: string | null;
  dateFrom: string;
  dateTo: string;
  source: string | null;
}

export default function FilterBar({
  locations,
  categories = [],
  isCompetitor = false,
  onFilterChange,
}: Props) {
  const filtered = locations.filter((l) => l.is_competitor === isCompetitor);

  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [locationId, setLocationId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(sixMonthsAgo);
  const [dateTo, setDateTo] = useState(today);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    onFilterChange({ locationId, categoryId, dateFrom, dateTo, source });
  }, [locationId, categoryId, dateFrom, dateTo, source]);

  return (
    <div class="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div class="min-w-[180px]">
        <label class="mb-1 block text-xs font-medium text-gray-500">Sedi</label>
        <select
          value={locationId ?? ""}
          onChange={(e) => setLocationId((e.target as HTMLSelectElement).value || null)}
          class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Tutte le sedi</option>
          {filtered.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      <div class="min-w-[180px]">
        <label class="mb-1 block text-xs font-medium text-gray-500">Argomento</label>
        <select
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId((e.target as HTMLSelectElement).value || null)}
          class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Tutti gli argomenti</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Data di Inizio</label>
        <input
          type="date"
          value={dateFrom}
          onInput={(e) => setDateFrom((e.target as HTMLInputElement).value)}
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Data di Fine</label>
        <input
          type="date"
          value={dateTo}
          onInput={(e) => setDateTo((e.target as HTMLInputElement).value)}
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>

      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium text-gray-500">Piattaforma</label>
        <select
          value={source ?? ""}
          onChange={(e) => setSource((e.target as HTMLSelectElement).value || null)}
          class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Tutte</option>
          <option value="google_maps">Google Maps</option>
          <option value="tripadvisor">TripAdvisor</option>
          <option value="booking">Booking</option>
          <option value="trustpilot">Trustpilot</option>
        </select>
      </div>
    </div>
  );
}
