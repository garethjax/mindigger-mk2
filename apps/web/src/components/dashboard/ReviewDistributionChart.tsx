import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface ChartDataPoint {
  date: string; // "YYYY-MM-DD"
  count: number;
}

interface Props {
  data: ChartDataPoint[];
  aggregation: "day" | "week" | "month";
  onAggregationChange: (agg: "day" | "week" | "month") => void;
  title?: string;
}

function toEpochSeconds(isoDate: string): number {
  const v = isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00Z`;
  return Math.floor(Date.parse(v) / 1000);
}

function roundUpToStep(n: number, step: number): number {
  if (n <= 0) return step;
  return Math.ceil(n / step) * step;
}

const BAR_FILL = "rgba(59,130,246,0.55)";
const BAR_STROKE = "rgba(59,130,246,0.9)";

export default function ReviewDistributionChart({
  data,
  aggregation,
  onAggregationChange,
  title = "Distribuzione Recensioni",
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const { uplotData, maxCount } = useMemo(() => {
    const pts = [...data].sort((a, b) => a.date.localeCompare(b.date));
    const xs = pts.map((d) => toEpochSeconds(d.date));
    const counts = pts.map((d) => (Number.isFinite(d.count) ? d.count : 0));
    const max = counts.reduce((acc, v) => Math.max(acc, v), 0);
    return { uplotData: [xs, counts] as [number[], number[]], maxCount: max };
  }, [data]);

  const Y_TICK_STEP = 25;
  const yMax = roundUpToStep(maxCount, Y_TICK_STEP);

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

    const ySplits: uPlot.Axis.Splits = () => {
      const splits: number[] = [];
      for (let v = 0; v <= yMax; v += Y_TICK_STEP) splits.push(v);
      return splits;
    };

    // Capture for draw hook closure
    const capturedYMax = yMax;

    const opts: uPlot.Options = {
      width,
      height,
      series: [
        {},
        {
          label: "Totale",
          show: true,
          stroke: "transparent",
          width: 0,
          points: { show: false },
        },
      ],
      scales: {
        x: { time: true },
        y: { min: 0, max: capturedYMax },
      },
      axes: [
        { values: (_u, splits) => splits.map((v) => fmtDate(new Date(v * 1000))) },
        {
          label: "Recensioni",
          splits: ySplits,
          values: (_u, splits) => splits.map((v) => (v === 0 ? "0" : String(v))),
          grid: { show: true, stroke: "rgba(229,231,235,1)", width: 1 },
        },
      ],
      cursor: { drag: { x: false, y: false } },
      hooks: {
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx;
            const xData = u.data[0];
            const yData = u.data[1];
            if (!xData.length) return;

            const dpr = window.devicePixelRatio || 1;
            const nBars = xData.length;
            // Calculate bar width from plot area
            const plotWidth = u.bbox.width / dpr;
            const gapFraction = aggregation === "month" ? 0.3 : aggregation === "week" ? 0.25 : 0.15;
            const barW = Math.max((plotWidth / nBars) * (1 - gapFraction), 1);

            ctx.save();
            ctx.fillStyle = BAR_FILL;
            ctx.strokeStyle = BAR_STROKE;
            ctx.lineWidth = 1;

            for (let i = 0; i < nBars; i++) {
              const cx = u.valToPos(xData[i], "x", true);
              const cy = u.valToPos(yData[i] as number, "y", true);
              const y0 = u.valToPos(0, "y", true);
              const h = y0 - cy;
              if (h > 0) {
                ctx.fillRect(cx - barW / 2, cy, barW, h);
                ctx.strokeRect(cx - barW / 2, cy, barW, h);
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
            const count = u.data[1][idx] as number;
            const dt = new Date(ts * 1000);
            const dateStr = dt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
            tooltipEl.textContent = `${dateStr} · Totale: ${count.toLocaleString("it-IT")}`;

            const left = Math.floor(u.cursor.left ?? 0);
            const top = Math.floor(u.cursor.top ?? 0);
            tooltipEl.style.left = `${left + 12}px`;
            tooltipEl.style.top = `${top - 25}px`;
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
  }, [aggregation, uplotData, width, yMax]);

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
