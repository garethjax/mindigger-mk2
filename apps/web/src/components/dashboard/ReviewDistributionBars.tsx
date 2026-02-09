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
    return `${m}/${y.slice(2)}`; // "03/25"
  }
  const [y, m, d] = date.split("-");
  void y;
  return `${d}/${m}`;
}

function labelModulo(aggregation: Props["aggregation"], n: number): number {
  if (n <= 0) return 1;
  if (aggregation === "month") return Math.max(1, Math.ceil(n / 6));
  if (aggregation === "week") return Math.max(1, Math.ceil(n / 10));
  return Math.max(1, Math.ceil(n / 12));
}

export default function ReviewDistributionBars({ data, aggregation, onAggregationChange }: Props) {
  const { points, maxCount } = useMemo(() => {
    const pts = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const max = pts.reduce((acc, p) => Math.max(acc, Number(p.count) || 0), 0);
    return { points: pts, maxCount: max };
  }, [data]);

  const BAR_AREA_PX = 240;
  const Y_TICK_STEP = 25;
  const yMax = maxCount > 0 ? Math.ceil(maxCount / Y_TICK_STEP) * Y_TICK_STEP : Y_TICK_STEP;
  const yTicks = Array.from({ length: Math.floor(yMax / Y_TICK_STEP) + 1 }, (_, i) => i * Y_TICK_STEP);

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
          <div class="flex h-[300px] flex-col">
            <div class="flex flex-1 gap-2 border-b border-gray-100 pb-2">
              {/* Y axis */}
              <div class="relative w-10 shrink-0">
                {yTicks.map((t) => {
                  const y = yMax > 0 ? (t / yMax) * BAR_AREA_PX : 0;
                  const top = BAR_AREA_PX - y;
                  return (
                    <div
                      key={`y-${t}`}
                      class="absolute right-1 text-[10px] leading-3 text-gray-400"
                      style={{ top: `${top - 6}px` }}
                    >
                      {t}
                    </div>
                  );
                })}
              </div>

              {/* Plot area */}
              <div class="flex-1 overflow-x-auto">
                <div class="relative">
                  {/* Horizontal gridlines */}
                  <div class="absolute inset-x-0 top-0" style={{ height: `${BAR_AREA_PX}px` }}>
                    {yTicks
                      .filter((t) => t > 0)
                      .map((t) => {
                        const y = yMax > 0 ? (t / yMax) * BAR_AREA_PX : 0;
                        const top = BAR_AREA_PX - y;
                        return (
                          <div
                            key={`grid-${t}`}
                            class="absolute inset-x-0 border-t border-gray-100"
                            style={{ top: `${top}px` }}
                          />
                        );
                      })}
                  </div>

                  <div class="flex items-end gap-1" style={{ height: `${BAR_AREA_PX}px` }}>
                    {points.map((p, idx) => {
                      const count = Number(p.count) || 0;
                      const barPx = count > 0 ? Math.max(1, Math.round((count / yMax) * BAR_AREA_PX)) : 0;

                      const mod = labelModulo(aggregation, points.length);
                      const showLabel = idx % mod === 0;

                      return (
                        <div key={p.date} class="flex w-6 flex-col items-center justify-end">
                          <div class="flex w-full items-end" style={{ height: `${BAR_AREA_PX}px` }}>
                            <div
                              class="w-full rounded-sm bg-blue-500/60"
                              style={{ height: `${barPx}px` }}
                              title={`${p.date} · Totale: ${count}`}
                            />
                          </div>
                          <div class="mt-1 h-4 text-[10px] leading-4 text-gray-500">
                            {showLabel ? toLabel(p.date, aggregation) : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
