import { useState, useEffect } from "preact/hooks";

type DatePreset =
  | ""
  | "current_month"
  | "last_30_days"
  | "last_quarter"
  | "last_90_days"
  | "this_year"
  | "previous_year";

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
  ratings: number[]; // enabled ratings (1..5). Default: all.
  dateFrom: string;
  dateTo: string;
  source: string | null;
}

function normalizeRatings(ratings: number[]): number[] {
  const set = new Set<number>();
  for (const r of ratings) {
    if (Number.isInteger(r) && r >= 1 && r <= 5) set.add(r);
  }
  return Array.from(set).sort((a, b) => b - a);
}

function isAllRatings(ratings: number[]): boolean {
  return normalizeRatings(ratings).length === 5;
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      class={`h-3.5 w-3.5 ${filled ? "text-yellow-400" : "text-gray-200"}`}
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

export default function FilterBar({
  locations,
  categories = [],
  isCompetitor = false,
  onFilterChange,
}: Props) {
  const filtered = locations.filter((l) => l.is_competitor === isCompetitor);

  function toISODateLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(d: Date, days: number): Date {
    const next = new Date(d);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function startOfYear(d: Date): Date {
    return new Date(d.getFullYear(), 0, 1);
  }

  function previousQuarterRange(d: Date): { from: Date; to: Date } {
    const q = Math.floor(d.getMonth() / 3); // 0..3
    const prevQ = q - 1;
    const year = prevQ < 0 ? d.getFullYear() - 1 : d.getFullYear();
    const qIndex = prevQ < 0 ? 3 : prevQ;
    const startMonth = qIndex * 3;
    const from = new Date(year, startMonth, 1);
    const to = new Date(year, startMonth + 3, 0); // last day of quarter
    return { from, to };
  }

  function applyPreset(preset: DatePreset) {
    const now = new Date();
    if (preset === "") return;

    if (preset === "current_month") {
      setDateFrom(toISODateLocal(startOfMonth(now)));
      setDateTo(toISODateLocal(now));
      return;
    }

    if (preset === "last_30_days") {
      setDateFrom(toISODateLocal(addDays(now, -29)));
      setDateTo(toISODateLocal(now));
      return;
    }

    if (preset === "last_90_days") {
      setDateFrom(toISODateLocal(addDays(now, -89)));
      setDateTo(toISODateLocal(now));
      return;
    }

    if (preset === "this_year") {
      setDateFrom(toISODateLocal(startOfYear(now)));
      setDateTo(toISODateLocal(now));
      return;
    }

    if (preset === "previous_year") {
      const year = now.getFullYear() - 1;
      setDateFrom(toISODateLocal(new Date(year, 0, 1)));
      setDateTo(toISODateLocal(new Date(year, 11, 31)));
      return;
    }

    if (preset === "last_quarter") {
      const { from, to } = previousQuarterRange(now);
      setDateFrom(toISODateLocal(from));
      setDateTo(toISODateLocal(to));
      return;
    }
  }

  const now = new Date();
  const today = toISODateLocal(now);
  const sixMonthsAgo = toISODateLocal(addDays(now, -180));

  const [locationId, setLocationId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<number[]>([5, 4, 3, 2, 1]);
  const [datePreset, setDatePreset] = useState<DatePreset>("");
  const [dateFrom, setDateFrom] = useState(sixMonthsAgo);
  const [dateTo, setDateTo] = useState(today);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    onFilterChange({ locationId, categoryId, ratings: normalizeRatings(ratings), dateFrom, dateTo, source });
  }, [locationId, categoryId, ratings, dateFrom, dateTo, source]);

  function toggleRating(rating: number) {
    setRatings((prev) => {
      const next = new Set(normalizeRatings(prev));
      if (next.has(rating)) next.delete(rating);
      else next.add(rating);
      const normalized = normalizeRatings(Array.from(next));
      // Keep at least one rating enabled.
      return normalized.length > 0 ? normalized : [5, 4, 3, 2, 1];
    });
  }

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

      <div class="min-w-[180px]">
        <label class="mb-1 block text-xs font-medium text-gray-500">Intervallo</label>
        <select
          value={datePreset}
          onChange={(e) => {
            const next = ((e.target as HTMLSelectElement).value ?? "") as DatePreset;
            setDatePreset(next);
            applyPreset(next);
          }}
          class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Personalizzato</option>
          <option value="current_month">Mese corrente</option>
          <option value="last_30_days">Ultimi 30 giorni</option>
          <option value="last_quarter">Ultimo trimestre</option>
          <option value="last_90_days">Ultimi 90 giorni</option>
          <option value="this_year">Quest'anno</option>
          <option value="previous_year">Anno precedente</option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Data di Inizio</label>
        <input
          type="date"
          value={dateFrom}
          onInput={(e) => {
            setDatePreset("");
            setDateFrom((e.target as HTMLInputElement).value);
          }}
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Data di Fine</label>
        <input
          type="date"
          value={dateTo}
          onInput={(e) => {
            setDatePreset("");
            setDateTo((e.target as HTMLInputElement).value);
          }}
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

      <div class="min-w-[220px]">
        <label class="mb-1 block text-xs font-medium text-gray-500">Rating</label>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRatings([5, 4, 3, 2, 1])}
            class={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              isAllRatings(ratings)
                ? "border-gray-800 bg-gray-800 text-white"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Tutte
          </button>
          {[5, 4, 3, 2, 1].map((r) => {
            const enabled = normalizeRatings(ratings).includes(r);
            return (
              <button
                type="button"
                key={r}
                onClick={() => toggleRating(r)}
                aria-pressed={enabled}
                class={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
                  enabled
                    ? "border-gray-800 bg-gray-800 text-white"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                }`}
                title={`${r} stelle`}
              >
                {r}
                <Star filled={enabled} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
