import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface ChartDataPoint {
  date: string; // ISO date "2024-01-15"
  count: number;
  avgRating?: number;
}

interface Props {
  data: ChartDataPoint[];
  aggregation: "day" | "week" | "month";
  onAggregationChange: (agg: "day" | "week" | "month") => void;
  title?: string;
  showRatingSeries?: boolean;
}

type UPlotData = [number[], (number | null)[]] | [number[], (number | null)[], (number | null)[]];

function toEpochSeconds(isoDate: string): number {
  // Accept either "YYYY-MM-DD" or full ISO timestamps.
  const v = isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00Z`;
  const t = Date.parse(v);
  return Math.floor(t / 1000);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function ReviewChart({
  data,
  aggregation,
  onAggregationChange,
  title = "Andamento Recensioni",
  showRatingSeries: showRatingSeriesProp = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const uplotData: UPlotData = useMemo(() => {
    const xs = data.map((d) => toEpochSeconds(d.date));
    const counts = data.map((d) => (Number.isFinite(d.count) ? d.count : null));
    if (!showRatingSeriesProp) return [xs, counts];

    const ratings = data.map((d) => {
      const r = d.avgRating;
      if (r == null) return null;
      if (!Number.isFinite(r)) return null;
      return clamp(r, 1, 5);
    });
    return [xs, counts, ratings] as [number[], (number | null)[], (number | null)[]];
  }, [data, showRatingSeriesProp]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    roRef.current?.disconnect();
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.floor(entry?.contentRect?.width ?? 0);
      setWidth(nextWidth);
    });
    ro.observe(containerRef.current);
    roRef.current = ro;

    return () => {
      ro.disconnect();
    };
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

    const showRating = showRatingSeriesProp;

    const opts: uPlot.Options = {
      width,
      height,
      series: showRating
        ? [
            {},
            {
              label: "Recensioni",
              fill: "rgba(59,130,246,0.15)",
              stroke: "rgb(59,130,246)",
              width: 2,
            },
            { label: "Rating", stroke: "rgb(249,115,22)", width: 2, scale: "rating" },
          ]
        : [
            {},
            {
              label: "Recensioni",
              fill: "rgba(59,130,246,0.15)",
              stroke: "rgb(59,130,246)",
              width: 2,
              points: { show: true, size: 6, width: 2, stroke: "rgb(59,130,246)", fill: "white" },
            },
          ],
      scales: {
        x: { time: true },
        y: { min: 0 },
        ...(showRating ? { rating: { min: 1, max: 5 } } : {}),
      },
      axes: showRating
        ? [{}, { label: "Recensioni" }, { label: "Rating", side: 1, scale: "rating" }]
        : [{}, { label: "Recensioni" }],
      cursor: {
        drag: { x: false, y: false },
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              tooltipEl.classList.add("hidden");
              return;
            }

            const ts = u.data[0][idx] as number;
            const count = u.data[1][idx] as number | null;
            const rating = showRating ? ((u.data[2][idx] as number | null) ?? null) : null;

            const dt = new Date(ts * 1000);
            const dateStr = dt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
            const countStr = count == null ? "n/d" : count.toLocaleString("it-IT");

            if (showRating) {
              const ratingStr = rating == null ? "n/d" : rating.toFixed(2);
              tooltipEl.textContent = `${dateStr} · ${countStr} recensioni · rating ${ratingStr}`;
            } else {
              tooltipEl.textContent = `${dateStr} · ${countStr} recensioni`;
            }

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
      // Keep tooltipEl allocated; it will be re-attached on next init.
    };
  }, [width, uplotData, showRatingSeriesProp]);

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold text-gray-900">{title}</div>
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

      <div ref={containerRef} class="w-full">
        <div ref={uplotRootRef} />
      </div>
    </div>
  );
}
