import { useMemo } from "preact/hooks";

interface Point {
  date: string; // "YYYY-MM-DD"
  count: number;
}

interface Props {
  data: Point[];
  aggregation: "day" | "week" | "month";
  onAggregationChange: (agg: "day" | "week" | "month") => void;
}

function toLabel(date: string, aggregation: Props["aggregation"]): string {
  // date is already the bucket start (day/week/month).
  // Keep labels sparse and readable.
  if (aggregation === "month") {
    const [y, m] = date.split("-");
    return `${m}/${y}`;
  }
  const [y, m, d] = date.split("-");
  void y;
  return `${d}/${m}`;
}

export default function ReviewDistributionBars({ data, aggregation, onAggregationChange }: Props) {
  const { points, maxCount } = useMemo(() => {
    const pts = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const max = pts.reduce((acc, p) => Math.max(acc, Number(p.count) || 0), 0);
    return { points: pts, maxCount: max };
  }, [data]);

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold text-gray-900">Distribuzione Recensioni</div>
        <div class="inline-flex overflow-hidden rounded-md border border-gray-200">
          {([
            ["day", "Giorno"],
            ["week", "Settimana"],
            ["month", "Mese"],
          ] as const).map(([agg, label]) => (
            <button
              type="button"
              key={agg}
              onClick={() => onAggregationChange(agg)}
              class={`px-3 py-1.5 text-xs font-medium ${
                aggregation === agg ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div class="mb-2 flex items-center gap-1 text-[10px] text-gray-600">
        <span class="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />
        Totale
      </div>

      {points.length === 0 ? (
        <div class="py-10 text-center text-sm text-gray-400">Nessun dato</div>
      ) : (
        <div class="overflow-x-auto">
          <div class="flex h-[300px] items-end gap-1">
            {points.map((p) => {
              const heightPct = maxCount > 0 ? Math.round((p.count / maxCount) * 100) : 0;
              return (
                <div key={p.date} class="flex w-6 flex-col items-center justify-end gap-1">
                  <div
                    class="w-full rounded-sm bg-blue-500/60"
                    style={{ height: `${heightPct}%` }}
                    title={`${p.date} · Totale: ${p.count}`}
                  />
                  <div class="text-[10px] text-gray-500">{toLabel(p.date, aggregation)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
