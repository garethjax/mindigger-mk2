import { useState, useEffect } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import FilterBar, { type FilterState } from "./FilterBar";
import TopCards from "./TopCards";
import ReviewList from "./ReviewList";

interface Location {
  id: string;
  name: string;
  is_competitor: boolean;
}

interface Props {
  locations: Location[];
  isCompetitor?: boolean;
}

interface Stats {
  totalReviews: number;
  avgRating: number;
  distribution: { rating: number; count: number; percentage: number }[];
}

export default function Dashboard({ locations, isCompetitor = false }: Props) {
  const [filters, setFilters] = useState<FilterState>({
    locationId: null,
    dateFrom: "",
    dateTo: "",
    source: null,
  });
  const [stats, setStats] = useState<Stats>({
    totalReviews: 0,
    avgRating: 0,
    distribution: [],
  });

  const supabase = createSupabaseBrowser();

  useEffect(() => {
    if (!filters.locationId) return;
    loadStats();
  }, [filters.locationId, filters.dateFrom, filters.dateTo, filters.source]);

  async function loadStats() {
    let query = supabase
      .from("reviews")
      .select("rating")
      .eq("status", "completed")
      .eq("location_id", filters.locationId!);

    if (filters.source) query = query.eq("source", filters.source);
    if (filters.dateFrom) query = query.gte("review_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("review_date", filters.dateTo);

    const { data, error } = await query;

    if (error || !data) return;

    const total = data.length;
    const sum = data.reduce((acc, r) => acc + (r.rating ?? 0), 0);
    const avg = total > 0 ? sum / total : 0;

    // Count per rating
    const counts = [0, 0, 0, 0, 0, 0]; // index 0 unused
    for (const r of data) {
      const rating = r.rating ?? 0;
      if (rating >= 1 && rating <= 5) counts[rating]++;
    }

    const distribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: counts[rating],
      percentage: total > 0 ? (counts[rating] / total) * 100 : 0,
    }));

    setStats({ totalReviews: total, avgRating: avg, distribution });
  }

  return (
    <div>
      <FilterBar
        locations={locations}
        isCompetitor={isCompetitor}
        onFilterChange={setFilters}
      />

      <TopCards
        totalReviews={stats.totalReviews}
        avgRating={stats.avgRating}
        distribution={stats.distribution}
      />

      <ReviewList filters={filters} />
    </div>
  );
}
