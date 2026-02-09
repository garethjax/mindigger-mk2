import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface RatingPeriodPoint {
  date: string;   // ISO date "2024-01-15"
  rating: number;  // 1–5
  count: number;
}

interface Props {
  data: RatingPeriodPoint[];
  aggregation: "day" | "week" | "month";
  onAggregationChange: (agg: "day" | "week" | "month") => void;
}

const RATING_COLORS: Record<number, { stroke: string; fill: string }> = {
  5: { stroke: "rgb(34,197,94)",  fill: "rgba(34,197,94,0.35)" },   // green
  4: { stroke: "rgb(132,204,22)", fill: "rgba(132,204,22,0.35)" },  // lime
  3: { stroke: "rgb(234,179,8)",  fill: "rgba(234,179,8,0.35)" },   // yellow
  2: { stroke: "rgb(249,115,22)", fill: "rgba(249,115,22,0.35)" },  // orange
  1: { stroke: "rgb(239,68,68)",  fill: "rgba(239,68,68,0.35)" },   // red
};

const RATING_LABELS: Record<number, string> = {
  5: "Eccellente",
  4: "Buono",
  3: "Neutro",
  2: "Negativo",
  1: "Molto Neg.",
};

function toEpochSeconds(isoDate: string): number {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Math.floor(t / 1000);
}

// uPlot stacked area: each series value = own count + sum of series below it
type StackedData = [number[], ...((number | null)[])[]] ;

export default function ReviewAreaChart({ data, aggregation, onAggregationChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Build stacked uPlot data: [timestamps, rating1, rating2, rating3, rating4, rating5]
  // Stacked from bottom (1) to top (5) so higher ratings are visually on top.
  const uplotData: StackedData = useMemo(() => {
    // Collect unique sorted dates
    const dateSet = new Set<string>();
    for (const d of data) dateSet.add(d.date);
    const dates = Array.from(dateSet).sort();

    // Build lookup: date → { rating → count }
    const lookup = new Map<string, Map<number, number>>();
    for (const d of data) {
      let rMap = lookup.get(d.date);
      if (!rMap) { rMap = new Map(); lookup.set(d.date, rMap); }
      rMap.set(d.rating, (rMap.get(d.rating) ?? 0) + d.count);
    }

    const xs = dates.map(toEpochSeconds);
    // Raw counts per rating (1..5), order bottom-to-top for stacking
    const raw: number[][] = [1, 2, 3, 4, 5].map((rating) =>
      dates.map((date) => lookup.get(date)?.get(rating) ?? 0),
    );

    // Stack: each series[i] = raw[i] + sum(raw[0..i-1])
    const stacked: (number | null)[][] = [];
    for (let i = 0; i < 5; i++) {
      stacked.push(
        dates.map((_, j) => {
          let sum = 0;
          for (let k = 0; k <= i; k++) sum += raw[k][j];
          return sum;
        }),
      );
    }

    return [xs, ...stacked] as StackedData;
  }, [data]);

  // Keep reference to raw counts for tooltip
  const rawCounts = useMemo(() => {
    const dateSet = new Set<string>();
    for (const d of data) dateSet.add(d.date);
    const dates = Array.from(dateSet).sort();
    const lookup = new Map<string, Map<number, number>>();
    for (const d of data) {
      let rMap = lookup.get(d.date);
      if (!rMap) { rMap = new Map(); lookup.set(d.date, rMap); }
      rMap.set(d.rating, (rMap.get(d.rating) ?? 0) + d.count);
    }
    return [1, 2, 3, 4, 5].map((rating) =>
      dates.map((date) => lookup.get(date)?.get(rating) ?? 0),
    );
  }, [data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    roRef.current?.disconnect();
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      setWidth(Math.floor(entry?.contentRect?.width ?? 0));
    });
    ro.observe(containerRef.current);
    roRef.current = ro;
    return () => { ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!uplotRootRef.current) return;
    if (width <= 0) return;

    const height = 300;

    const ensureTooltipEl = (): HTMLDivElement => {
      if (tooltipRef.current) return tooltipRef.current;
      const el = document.createElement("div");
      el.className =
        "pointer-events-none absolute z-10 hidden rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-xs text-gray-800 shadow";
      tooltipRef.current = el;
      return el;
    };

    const tooltipEl = ensureTooltipEl();
    const rawRef = rawCounts;

    // Series: index 0 = x, 1..5 = rating 1..5 (stacked bottom to top)
    // We render in reverse visual order: 5 first (top band drawn last → on top)
    const series: uPlot.Series[] = [{}];
    for (let i = 0; i < 5; i++) {
      const rating = i + 1; // 1, 2, 3, 4, 5
      const colors = RATING_COLORS[rating];
      series.push({
        label: RATING_LABELS[rating],
        stroke: colors.stroke,
        fill: colors.fill,
        width: 1,
        paths: uPlot.paths.spline!(),
      });
    }

    const opts: uPlot.Options = {
      width,
      height,
      series,
      scales: {
        x: { time: true },
        y: { min: 0 },
      },
      axes: [
        {},
        { label: "Recensioni" },
      ],
      cursor: { drag: { x: false, y: false } },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              tooltipEl.classList.add("hidden");
              return;
            }

            const ts = u.data[0][idx] as number;
            const dt = new Date(ts * 1000);
            const dateStr = dt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });

            const parts: string[] = [dateStr];
            let total = 0;
            for (let r = 4; r >= 0; r--) {
              const c = rawRef[r]?.[idx] ?? 0;
              total += c;
              if (c > 0) parts.push(`${RATING_LABELS[r + 1]}: ${c}`);
            }
            parts.push(`Totale: ${total}`);

            tooltipEl.textContent = parts.join(" · ");
            const left = Math.floor(u.cursor.left ?? 0);
            const top = Math.floor(u.cursor.top ?? 0);
            tooltipEl.style.left = `${left + 12}px`;
            tooltipEl.style.top = `${top + 12}px`;
            tooltipEl.classList.remove("hidden");
          },
        ],
      },
    };

    const root = uplotRootRef.current;
    root.innerHTML = "";
    root.style.position = "relative";
    root.appendChild(tooltipEl);

    chartRef.current?.destroy();
    chartRef.current = new uPlot(opts, uplotData, root);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [width, uplotData, rawCounts]);

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

      <div class="mb-2 flex flex-wrap gap-2">
        {[5, 4, 3, 2, 1].map((r) => (
          <div key={r} class="flex items-center gap-1 text-[10px] text-gray-600">
            <span
              class="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: RATING_COLORS[r].stroke }}
            />
            {RATING_LABELS[r]}
          </div>
        ))}
      </div>

      <div ref={containerRef} class="w-full">
        <div ref={uplotRootRef} />
      </div>
    </div>
  );
}
