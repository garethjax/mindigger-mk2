import { useState, useEffect } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import FilterBar, { type FilterState } from "./FilterBar";
import TopCards, { type SentimentCard } from "./TopCards";
import ReviewList from "./ReviewList";
import ReviewChart from "./ReviewChart";
import ReviewAreaChart, { type RatingPeriodPoint } from "./ReviewAreaChart";

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
  businessId: string;
  isCompetitor?: boolean;
}

interface Stats {
  totalReviews: number;
  avgRating: number;
  distribution: { rating: number; count: number; percentage: number }[];
}

interface ChartDataPoint {
  date: string;
  count: number;
  avgRating: number;
}

const SENTIMENTS: Array<{ rating: number; label: string; color: string; ratingRange: [number, number] }> = [
  { rating: 5, label: "Eccellente", color: "bg-green-500", ratingRange: [5, 5] },
  { rating: 4, label: "Buono", color: "bg-lime-500", ratingRange: [4, 4] },
  { rating: 3, label: "Neutro", color: "bg-yellow-500", ratingRange: [3, 3] },
  { rating: 2, label: "Negativo", color: "bg-orange-500", ratingRange: [2, 2] },
  { rating: 1, label: "Molto Negativo", color: "bg-red-500", ratingRange: [1, 1] },
];

export default function Dashboard({ locations, categories = [], businessId, isCompetitor = false }: Props) {
  const [filters, setFilters] = useState<FilterState>({
    locationId: null,
    categoryId: null,
    ratings: [5, 4, 3, 2, 1],
    dateFrom: "",
    dateTo: "",
    source: null,
  });
  const [stats, setStats] = useState<Stats>({
    totalReviews: 0,
    avgRating: 0,
    distribution: [],
  });
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [areaData, setAreaData] = useState<RatingPeriodPoint[]>([]);
  const [aggregation, setAggregation] = useState<"day" | "week" | "month">("week");

  const supabase = createSupabaseBrowser();

  const filterDeps = [businessId, filters.locationId, filters.dateFrom, filters.dateTo, filters.source];

  useEffect(() => {
    loadStats();
  }, filterDeps);

  useEffect(() => {
    loadChart();
    loadAreaChart();
  }, [...filterDeps, aggregation]);

  async function loadStats() {
    let query = supabase
      .from("reviews")
      .select("rating")
      .eq("status", "completed")
      .eq("business_id", businessId);

    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.source) query = query.eq("source", filters.source);
    if (filters.dateFrom) query = query.gte("review_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("review_date", filters.dateTo);

    const { data, error } = await query;

    if (error || !data) return;

    const total = data.length;
    const sum = data.reduce((acc, r) => acc + (r.rating ?? 0), 0);
    const avg = total > 0 ? sum / total : 0;

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

  async function loadChart() {
    const { data, error } = await supabase.rpc("reviews_by_period", {
      p_business_id: businessId,
      p_location_id: filters.locationId ?? undefined,
      p_date_from: filters.dateFrom || undefined,
      p_date_to: filters.dateTo || undefined,
      p_source: filters.source ?? undefined,
      p_granularity: aggregation,
    });

    if (error || !data) {
      setChartData([]);
      return;
    }

    setChartData(
      (data as { period: string; count: number; avg_rating: number }[]).map((row) => ({
        date: row.period,
        count: Number(row.count),
        avgRating: Number(row.avg_rating),
      })),
    );
  }

  async function loadAreaChart() {
    const { data, error } = await supabase.rpc("reviews_by_rating_period", {
      p_business_id: businessId,
      p_location_id: filters.locationId ?? undefined,
      p_date_from: filters.dateFrom || undefined,
      p_date_to: filters.dateTo || undefined,
      p_source: filters.source ?? undefined,
      p_granularity: aggregation,
    });

    if (error || !data) {
      setAreaData([]);
      return;
    }

    setAreaData(
      (data as { period: string; rating: number; count: number }[]).map((row) => ({
        date: row.period,
        rating: Number(row.rating),
        count: Number(row.count),
      })),
    );
  }

  const enabledRatings = new Set(filters.ratings ?? [5, 4, 3, 2, 1]);
  const enabledTotal = stats.distribution.reduce(
    (acc, d) => (enabledRatings.has(d.rating) ? acc + d.count : acc),
    0,
  );
  const enabledSum = stats.distribution.reduce(
    (acc, d) => (enabledRatings.has(d.rating) ? acc + d.rating * d.count : acc),
    0,
  );
  const enabledAvg = enabledTotal > 0 ? enabledSum / enabledTotal : 0;

  const sentiments: SentimentCard[] = SENTIMENTS.map((s) => {
    const d = stats.distribution.find((x) => x.rating === s.rating);
    const enabled = enabledRatings.has(s.rating);
    return {
      label: s.label,
      count: d?.count ?? 0,
      percentage: enabledTotal > 0 && enabled ? ((d?.count ?? 0) / enabledTotal) * 100 : 0,
      color: s.color,
      ratingRange: s.ratingRange,
      enabled,
    };
  });

  return (
    <div>
      <FilterBar
        locations={locations}
        categories={categories}
        isCompetitor={isCompetitor}
        onFilterChange={setFilters}
      />

      <TopCards
        totalReviews={enabledTotal}
        avgRating={enabledAvg}
        sentiments={sentiments}
      />

      <div class="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ReviewChart
          data={chartData}
          aggregation={aggregation}
          onAggregationChange={setAggregation}
        />
        <ReviewAreaChart
          data={areaData}
          aggregation={aggregation}
          onAggregationChange={setAggregation}
        />
      </div>

      <ReviewList filters={filters} businessId={businessId} />
    </div>
  );
}
