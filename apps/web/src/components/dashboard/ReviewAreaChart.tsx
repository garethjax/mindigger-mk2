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

function toEpochSeconds(isoDate: string): number {
  // Accept either "YYYY-MM-DD" or full ISO timestamps.
  const v = isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00Z`;
  const t = Date.parse(v);
  return Math.floor(t / 1000);
}

export default function ReviewAreaChart({ data, aggregation, onAggregationChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Phase 1: render total review volume per period bucket.
  // This validates aggregation end-to-end before reintroducing per-rating stacking.
  const { uplotData, totalsByIdx } = useMemo(() => {
    const dateSet = new Set<string>();
    for (const d of data) dateSet.add(d.date);
    const dates = Array.from(dateSet).sort();

    const totalsByDate = new Map<string, number>();
    for (const d of data) totalsByDate.set(d.date, (totalsByDate.get(d.date) ?? 0) + d.count);

    const xs = dates.map(toEpochSeconds);
    const totals = dates.map((date) => totalsByDate.get(date) ?? 0);

    return {
      uplotData: [xs, totals] as [number[], number[]],
      totalsByIdx: totals,
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

    const series: uPlot.Series[] = [
      {},
      {
        label: "Recensioni",
        stroke: "rgb(59,130,246)",
        fill: "rgba(59,130,246,0.25)",
        width: 2,
        points: { show: true, size: 6, width: 2, stroke: "rgb(59,130,246)", fill: "white" },
      },
    ];

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

            const total = totalsByIdx[idx] ?? 0;
            tooltipEl.textContent = `${dateStr} · Totale: ${total}`;
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
  }, [width, uplotData, totalsByIdx]);

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
        <div class="flex items-center gap-1 text-[10px] text-gray-600">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "rgb(59,130,246)" }} />
          Totale
        </div>
      </div>

      <div ref={containerRef} class="w-full">
        <div ref={uplotRootRef} />
      </div>
    </div>
  );
}
