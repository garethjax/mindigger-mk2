import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface ChartDataPoint {
  date: string;
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

function toEpochSeconds(isoDate: string): number {
  const v = isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00Z`;
  return Math.floor(Date.parse(v) / 1000);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const LINE_COLOR = "rgb(59,130,246)";
const LINE_FILL = "rgba(59,130,246,0.15)";
const RATING_COLOR = "rgb(249,115,22)";

export default function ReviewChart({
  data,
  aggregation,
  onAggregationChange,
  title = "Andamento Recensioni",
  showRatingSeries: showRating = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const { uplotData, maxCount } = useMemo(() => {
    const xs = data.map((d) => toEpochSeconds(d.date));
    const counts = data.map((d) => (Number.isFinite(d.count) ? d.count : 0));
    const max = counts.reduce((a, v) => Math.max(a, v), 0);

    if (!showRating) return { uplotData: [xs, counts] as [number[], number[]], maxCount: max };

    const ratings = data.map((d) => {
      const r = d.avgRating;
      if (r == null || !Number.isFinite(r)) return null;
      return clamp(r, 1, 5);
    });
    return { uplotData: [xs, counts, ratings] as [number[], number[], (number | null)[]], maxCount: max };
  }, [data, showRating]);

  const yMax = maxCount > 0 ? Math.ceil(maxCount * 1.15) : 10;

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
    return () => ro.disconnect();
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

    const fmtDate = aggregation === "month"
      ? uPlot.fmtDate("{MM}/{YY}")
      : uPlot.fmtDate("{DD}/{MM}/{YY}");

    const capturedYMax = yMax;
    const capturedShowRating = showRating;

    const seriesConfig: uPlot.Series[] = [
      {},
      { label: "Recensioni", show: true, stroke: "transparent", width: 0, points: { show: false } },
    ];
    if (capturedShowRating) {
      seriesConfig.push({ label: "Rating", show: true, stroke: "transparent", width: 0, scale: "rating", points: { show: false } });
    }

    const opts: uPlot.Options = {
      width,
      height,
      series: seriesConfig,
      scales: {
        x: { time: true },
        y: { min: 0, max: capturedYMax },
        ...(capturedShowRating ? { rating: { min: 1, max: 5 } } : {}),
      },
      axes: [
        { values: (_u, splits) => splits.map((v) => fmtDate(new Date(v * 1000))) },
        { label: "Recensioni" },
        ...(capturedShowRating ? [{ label: "Rating medio", side: 1 as const, scale: "rating" }] : []),
      ],
      cursor: { drag: { x: false, y: false } },
      hooks: {
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx;
            const xData = u.data[0];
            const yData = u.data[1];
            if (!xData.length) return;

            // Draw area fill + line for Recensioni
            ctx.save();

            // Area fill
            ctx.fillStyle = LINE_FILL;
            ctx.beginPath();
            const y0 = u.valToPos(0, "y", true);
            for (let i = 0; i < xData.length; i++) {
              const x = u.valToPos(xData[i], "x", true);
              const y = u.valToPos(yData[i] as number, "y", true);
              if (i === 0) {
                ctx.moveTo(x, y0);
                ctx.lineTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            // Close path back to baseline
            const lastX = u.valToPos(xData[xData.length - 1], "x", true);
            ctx.lineTo(lastX, y0);
            ctx.closePath();
            ctx.fill();

            // Line stroke
            ctx.strokeStyle = LINE_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < xData.length; i++) {
              const x = u.valToPos(xData[i], "x", true);
              const y = u.valToPos(yData[i] as number, "y", true);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Points
            ctx.fillStyle = "white";
            ctx.strokeStyle = LINE_COLOR;
            ctx.lineWidth = 2;
            for (let i = 0; i < xData.length; i++) {
              const x = u.valToPos(xData[i], "x", true);
              const y = u.valToPos(yData[i] as number, "y", true);
              ctx.beginPath();
              ctx.arc(x, y, 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }

            // Draw rating line if enabled
            if (capturedShowRating && u.data[2]) {
              const rData = u.data[2];
              ctx.strokeStyle = RATING_COLOR;
              ctx.lineWidth = 2;
              ctx.beginPath();
              let started = false;
              for (let i = 0; i < xData.length; i++) {
                const rv = rData[i];
                if (rv == null) continue;
                const x = u.valToPos(xData[i], "x", true);
                const y = u.valToPos(rv as number, "rating", true);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
              }
              ctx.stroke();

              // Rating points
              ctx.fillStyle = "white";
              ctx.strokeStyle = RATING_COLOR;
              ctx.lineWidth = 2;
              for (let i = 0; i < xData.length; i++) {
                const rv = rData[i];
                if (rv == null) continue;
                const x = u.valToPos(xData[i], "x", true);
                const y = u.valToPos(rv as number, "rating", true);
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              }
            }

            ctx.restore();
          },
        ],
        setCursor: [
          (u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              tooltipEl.classList.add("hidden");
              return;
            }

            const ts = u.data[0][idx] as number;
            const count = u.data[1][idx] as number | null;
            const rating = capturedShowRating ? ((u.data[2]?.[idx] as number | null) ?? null) : null;

            const dt = new Date(ts * 1000);
            const dateStr = dt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
            const countStr = count == null ? "n/d" : count.toLocaleString("it-IT");

            if (capturedShowRating) {
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
    };
  }, [width, uplotData, showRating, yMax, aggregation]);

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
