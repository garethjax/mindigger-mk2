import { useState, useEffect, useCallback } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface Location {
  id: string;
  name: string;
  business_id: string;
  business_sector_id: string | null;
}

interface Category {
  id: string;
  name: string;
}

interface CategoryStats {
  category_id: string;
  category_name: string;
  total_reviews: number;
  high_ratings: number;
  high_pct: number;
  low_ratings: number;
  low_pct: number;
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
  const [loadingStats, setLoadingStats] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [categoryStats, setCategoryStats] = useState<CategoryStats[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const supabase = createSupabaseBrowser();

  const fetchCategoryStats = useCallback(async () => {
    if (!locationId || !period) return;

    const location = locations.find((l) => l.id === locationId);
    if (!location?.business_sector_id) {
      setCategoryStats([]);
      return;
    }

    setLoadingStats(true);

    // Calculate period start date
    const periodMonths = parseInt(period, 10);
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - periodMonths);
    const startDate = periodStart.toISOString().slice(0, 10);

    // Fetch categories for this sector
    const { data: categories } = await supabase
      .from("categories")
      .select("id, name")
      .eq("business_sector_id", location.business_sector_id)
      .order("name");

    if (!categories || categories.length === 0) {
      setCategoryStats([]);
      setLoadingStats(false);
      return;
    }

    // Fetch reviews with their categories and ratings for this location+period
    const { data: reviews } = await supabase
      .from("reviews")
      .select("id, rating, review_categories(category_id)")
      .eq("location_id", locationId)
      .eq("status", "completed")
      .gte("review_date", startDate);

    const stats: CategoryStats[] = [];

    for (const cat of categories) {
      let total = 0;
      let high = 0;
      let low = 0;

      for (const review of reviews ?? []) {
        const cats = review.review_categories as { category_id: string }[];
        if (cats?.some((rc) => rc.category_id === cat.id)) {
          total++;
          const r = review.rating ?? 0;
          if (r >= 3) high++;
          if (r <= 2) low++;
        }
      }

      stats.push({
        category_id: cat.id,
        category_name: cat.name,
        total_reviews: total,
        high_ratings: high,
        high_pct: total > 0 ? Math.round((high / total) * 100) : 0,
        low_ratings: low,
        low_pct: total > 0 ? Math.round((low / total) * 100) : 0,
      });
    }

    setCategoryStats(stats);
    // Select all categories by default
    setSelectedCategories(new Set(stats.map((s) => s.category_id)));
    setLoadingStats(false);
  }, [locationId, period, locations]);

  useEffect(() => {
    fetchCategoryStats();
  }, [fetchCategoryStats]);

  function toggleCategory(catId: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selectedCategories.size === categoryStats.length) {
      setSelectedCategories(new Set());
    } else {
      setSelectedCategories(new Set(categoryStats.map((s) => s.category_id)));
    }
  }

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

    if (selectedCategories.size === 0) {
      setMessage({ type: "error", text: "Seleziona almeno una categoria" });
      setLoading(false);
      return;
    }

    // Build statistics array for selected categories
    const statistics = categoryStats
      .filter((s) => selectedCategories.has(s.category_id))
      .map((s) => ({
        category_uid: s.category_id,
        category_name: s.category_name,
        total_reviews: s.total_reviews,
        high_ratings: { count: s.high_ratings, percentage: s.high_pct },
        low_ratings: { count: s.low_ratings, percentage: s.low_pct },
      }));

    // Create SWOT analysis record
    const { data, error } = await supabase
      .from("swot_analyses")
      .insert({
        location_id: locationId,
        business_id: location.business_id,
        period,
        statistics,
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
      setMessage({ type: "error", text: "Analisi creata ma invio fallito. Verrà elaborata dal cron." });
    } else {
      setMessage({ type: "success", text: "Analisi SWOT avviata! Riceverai una notifica al completamento." });
    }

    setLoading(false);
    setTimeout(() => (window.location.href = "/swot"), 2000);
  }

  return (
    <form onSubmit={handleSubmit} class="max-w-2xl space-y-4">
      {message && (
        <div
          class={`rounded-lg p-3 text-sm ${
            message.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div class="grid grid-cols-2 gap-4">
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
      </div>

      {/* Category statistics table */}
      {loadingStats ? (
        <div class="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">
          Caricamento statistiche categorie...
        </div>
      ) : categoryStats.length > 0 ? (
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700">
            Ambiti da analizzare
          </label>
          <div class="overflow-hidden rounded-lg border border-gray-200">
            <table class="w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={selectedCategories.size === categoryStats.length}
                      onChange={toggleAll}
                      class="mr-2 rounded border-gray-300"
                    />
                    Categoria
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-gray-600">Recensioni</th>
                  <th class="px-3 py-2 text-right font-medium text-gray-600">
                    <span class="text-green-600">3-5 Stelle</span>
                  </th>
                  <th class="px-3 py-2 text-right font-medium text-gray-600">
                    <span class="text-red-600">1-2 Stelle</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {categoryStats.map((stat) => (
                  <tr
                    key={stat.category_id}
                    class={`cursor-pointer transition ${
                      selectedCategories.has(stat.category_id)
                        ? "bg-blue-50/50"
                        : "bg-white opacity-60"
                    }`}
                    onClick={() => toggleCategory(stat.category_id)}
                  >
                    <td class="px-3 py-2">
                      <label class="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedCategories.has(stat.category_id)}
                          onChange={() => toggleCategory(stat.category_id)}
                          onClick={(e) => e.stopPropagation()}
                          class="rounded border-gray-300"
                        />
                        {stat.category_name}
                      </label>
                    </td>
                    <td class="px-3 py-2 text-right font-medium">{stat.total_reviews}</td>
                    <td class="px-3 py-2 text-right">
                      <span class="text-green-700">{stat.high_ratings}</span>
                      <span class="ml-1 text-gray-400">({stat.high_pct}%)</span>
                    </td>
                    <td class="px-3 py-2 text-right">
                      <span class="text-red-700">{stat.low_ratings}</span>
                      <span class="ml-1 text-gray-400">({stat.low_pct}%)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="mt-1 text-xs text-gray-400">
            {selectedCategories.size} di {categoryStats.length} categorie selezionate
          </p>
        </div>
      ) : null}

      <div class="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading || selectedCategories.size === 0}
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
