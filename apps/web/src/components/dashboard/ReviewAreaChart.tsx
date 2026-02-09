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

// Order: bottom (1=Molto Neg.) to top (5=Eccellente). Index 0 = rating 1.
const BANDS = [
  { rating: 1, label: "Molto Neg.", stroke: "rgb(239,68,68)",  fill: "rgba(239,68,68,0.6)" },
  { rating: 2, label: "Negativo",   stroke: "rgb(249,115,22)", fill: "rgba(249,115,22,0.6)" },
  { rating: 3, label: "Neutro",     stroke: "rgb(234,179,8)",  fill: "rgba(234,179,8,0.6)" },
  { rating: 4, label: "Buono",      stroke: "rgb(132,204,22)", fill: "rgba(132,204,22,0.6)" },
  { rating: 5, label: "Eccellente", stroke: "rgb(34,197,94)",  fill: "rgba(34,197,94,0.6)" },
];

function toEpochSeconds(isoDate: string): number {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return Math.floor(t / 1000);
}

export default function ReviewAreaChart({ data, aggregation, onAggregationChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Build stacked uPlot data + raw counts for tooltip
  const { uplotData, rawCounts } = useMemo(() => {
    const dateSet = new Set<string>();
    for (const d of data) dateSet.add(d.date);
    const dates = Array.from(dateSet).sort();

    const lookup = new Map<string, Map<number, number>>();
    for (const d of data) {
      let rMap = lookup.get(d.date);
      if (!rMap) { rMap = new Map(); lookup.set(d.date, rMap); }
      rMap.set(d.rating, (rMap.get(d.rating) ?? 0) + d.count);
    }

    const xs = dates.map(toEpochSeconds);

    // Raw per-rating counts: index 0 = rating 1, index 4 = rating 5
    const raw: number[][] = BANDS.map((b) =>
      dates.map((date) => lookup.get(date)?.get(b.rating) ?? 0),
    );

    // Cumulative stack: series[i][j] = sum(raw[0..i][j])
    // Series 0 (rating 1) = raw[0], Series 1 = raw[0]+raw[1], etc.
    const stacked: number[][] = [];
    for (let i = 0; i < 5; i++) {
      stacked.push(
        dates.map((_, j) => {
          let sum = 0;
          for (let k = 0; k <= i; k++) sum += raw[k][j];
          return sum;
        }),
      );
    }

    return {
      uplotData: [xs, ...stacked] as [number[], ...number[][]],
      rawCounts: raw,
    };
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

    // Series: [x, rating1_stacked, rating2_stacked, ..., rating5_stacked]
    // Draw top band last so it's visually on top.
    // uPlot bands fill BETWEEN two series. We draw from top (series 5) down.
    const series: uPlot.Series[] = [{}];
    for (let i = 0; i < 5; i++) {
      series.push({
        label: BANDS[i].label,
        stroke: BANDS[i].stroke,
        width: 1,
        // The fill is controlled by bands below, not series fill
        fill: undefined,
        points: { show: false },
      });
    }

    // Bands: fill area between series[i+1] (top) and series[i] (bottom).
    // series indices are 1-based (0 is x-axis).
    // Band for series 1 (rating 1): fills from series 1 down to y=0
    // Band for series 2 (rating 2): fills between series 2 and series 1
    // etc.
    const bands: uPlot.Band[] = [];
    // Bottom band: series 1 fills to y=0 (use series fill for this)
    // For proper stacking, use bands from top to bottom:
    // band between series[5] and series[4], series[4] and [3], etc.
    for (let i = 4; i >= 1; i--) {
      bands.push({
        series: [i + 1, i] as [number, number],
        fill: BANDS[i].fill,
      });
    }
    // Bottom-most band: series[1] fills down. Use series fill for this.
    series[1].fill = BANDS[0].fill;

    const opts: uPlot.Options = {
      width,
      height,
      series,
      bands,
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
            // Show from highest rating to lowest
            for (let r = 4; r >= 0; r--) {
              const c = rawRef[r]?.[idx] ?? 0;
              total += c;
              if (c > 0) parts.push(`${BANDS[r].label}: ${c}`);
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
        {[...BANDS].reverse().map((b) => (
          <div key={b.rating} class="flex items-center gap-1 text-[10px] text-gray-600">
            <span
              class="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: b.stroke }}
            />
            {b.label}
          </div>
        ))}
      </div>

      <div ref={containerRef} class="w-full">
        <div ref={uplotRootRef} />
      </div>
    </div>
  );
}
