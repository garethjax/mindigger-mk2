import { useState, useEffect } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";
import type { FilterState } from "./FilterBar";

interface Review {
  id: string;
  title: string | null;
  text: string | null;
  rating: number | null;
  author: string | null;
  source: string;
  review_date: string | null;
  ai_result: {
    sentiment?: number;
    italian_topics?: { italian_name: string; score: number }[];
  } | null;
}

const SOURCE_LABELS: Record<string, string> = {
  google_maps: "Google",
  tripadvisor: "TripAdvisor",
  booking: "Booking",
  trustpilot: "Trustpilot",
};

const SOURCE_COLORS: Record<string, string> = {
  google_maps: "bg-blue-100 text-blue-700",
  tripadvisor: "bg-green-100 text-green-700",
  booking: "bg-indigo-100 text-indigo-700",
  trustpilot: "bg-emerald-100 text-emerald-700",
};

function topicBadgeColor(score: number): string {
  if (score >= 4) return "bg-green-100 text-green-700";
  if (score >= 3) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

interface Props {
  filters: FilterState;
}

const PAGE_SIZE = 20;

export default function ReviewList({ filters }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const supabase = createSupabaseBrowser();

  const ratings = filters.ratings ?? [5, 4, 3, 2, 1];
  const ratingsKey = ratings.join(",");
  const filterAllRatings = ratings.length === 5;

  async function loadReviews(reset = false) {
    setLoading(true);
    const currentPage = reset ? 0 : page;

    let query = supabase
      .from("reviews")
      .select("id, title, text, rating, author, source, review_date, ai_result")
      .eq("status", "completed")
      .order("review_date", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (filters.locationId) query = query.eq("location_id", filters.locationId);
    if (filters.source) query = query.eq("source", filters.source);
    if (filters.dateFrom) query = query.gte("review_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("review_date", filters.dateTo);
    if (!filterAllRatings) query = query.in("rating", ratings);

    const { data, error } = await query;

    if (!error && data) {
      setReviews(reset ? data : [...reviews, ...data]);
      setHasMore(data.length === PAGE_SIZE);
      if (reset) setPage(0);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadReviews(true);
  // TODO(D1): add categoryId filter to query, then add filters.categoryId to this dependency array
  }, [filters.locationId, filters.source, filters.dateFrom, filters.dateTo, ratingsKey]);

  function loadMore() {
    setPage((p) => p + 1);
    loadReviews();
  }

  function renderStars(rating: number | null) {
    if (rating == null) return null;
    return (
      <div class="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((s) => (
          <svg
            key={s}
            class={`h-3.5 w-3.5 ${s <= rating ? "text-yellow-400" : "text-gray-200"}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
    );
  }

  if (loading && reviews.length === 0) {
    return <div class="py-8 text-center text-sm text-gray-400">Caricamento recensioni...</div>;
  }

  return (
    <div>
      <h2 class="mb-3 text-lg font-semibold">Recensioni</h2>

      {reviews.length === 0 ? (
        <div class="py-8 text-center text-sm text-gray-400">Nessuna recensione trovata</div>
      ) : (
        <div class="space-y-3">
          {reviews.map((review) => (
            <div key={review.id} class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="mb-2 flex items-start justify-between gap-3">
                <div class="flex items-center gap-2">
                  {renderStars(review.rating)}
                  <span
                    class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[review.source] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {SOURCE_LABELS[review.source] ?? review.source}
                  </span>
                </div>
                <div class="text-xs text-gray-400">
                  {review.review_date ?? ""}
                </div>
              </div>

              {review.title && (
                <h3 class="mb-1 text-sm font-medium">{review.title}</h3>
              )}

              {review.text && (
                <p class="text-sm text-gray-600 line-clamp-3">{review.text}</p>
              )}

              <div class="mt-2 flex items-center justify-between">
                <span class="text-xs text-gray-400">{review.author ?? "Anonimo"}</span>
                {review.ai_result?.italian_topics && review.ai_result.italian_topics.length > 0 && (
                  <div class="flex flex-wrap gap-1">
                    {review.ai_result.italian_topics.slice(0, 5).map((t) => (
                      <span
                        key={t.italian_name}
                        class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${topicBadgeColor(t.score)}`}
                      >
                        {t.italian_name} {t.score.toFixed(1)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          class="mt-4 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Caricamento..." : "Carica altre recensioni"}
        </button>
      )}
    </div>
  );
}
