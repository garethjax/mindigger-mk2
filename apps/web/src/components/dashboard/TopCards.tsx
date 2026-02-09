export interface SentimentCard {
  label: string;
  count: number;
  percentage: number;
  color: string;
  ratingRange: [number, number];
}

interface Props {
  totalReviews: number;
  avgRating: number;
  sentiments: SentimentCard[];
  periodGrowth?: number;
}

function StarIcon({ filled }: { filled: boolean }) {
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

export default function TopCards({ totalReviews, avgRating, sentiments, periodGrowth }: Props) {
  return (
    <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* Card Totale */}
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div class="text-xs font-medium text-gray-500">Totale Recensioni</div>
        <div class="mt-1 text-2xl font-bold">{totalReviews.toLocaleString("it-IT")}</div>
        <div class="mt-1.5 flex gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <StarIcon key={star} filled={star <= Math.round(avgRating)} />
          ))}
          <span class="ml-1 text-xs text-gray-500">{avgRating.toFixed(1)}</span>
        </div>
        {periodGrowth != null && (
          <div
            class={`mt-1 text-xs font-medium ${periodGrowth >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {periodGrowth >= 0 ? "+" : ""}
            {periodGrowth}% nel periodo
          </div>
        )}
      </div>

      {/* Sentiment Cards */}
      {sentiments.map((s) => (
        <div key={s.label} class="rounded-lg border border-gray-200 bg-white p-4">
          <div class="text-xs font-medium text-gray-500">{s.label}</div>
          <div class="mt-1 text-2xl font-bold">{s.count.toLocaleString("it-IT")}</div>
          <div class="mt-1 text-xs text-gray-400">{s.percentage.toFixed(0)}% del totale</div>
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              class={`h-full rounded-full ${s.color}`}
              style={{ width: `${s.percentage}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
