import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface ChartDataPoint {
  date: string; // "YYYY-MM-DD"
  count: number;
}

interface Props {
  data: ChartDataPoint[];
  aggregation: "week" | "month";
  onAggregationChange: (agg: "week" | "month") => void;
  title?: string;
}

function toEpochSeconds(isoDate: string): number {
  const v = isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00Z`;
  const t = Date.parse(v);
  return Math.floor(t / 1000);
}

function roundUpToStep(n: number, step: number): number {
  if (n <= 0) return step;
  return Math.ceil(n / step) * step;
}

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
      const nextWidth = Math.floor(entry?.contentRect?.width ?? 0);
      setWidth(nextWidth);
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

    const dateFmt =
      aggregation === "month"
        ? uPlot.fmtDate("{MM}/{YY}")
        : uPlot.fmtDate("{DD}/{MM}");

    const ySplits: uPlot.Axis.Splits = () => {
      const splits: number[] = [];
      for (let v = 0; v <= yMax; v += Y_TICK_STEP) splits.push(v);
      return splits;
    };

    const barGapPx = aggregation === "month" ? 10 : 6;

    const opts: uPlot.Options = {
      width,
      height,
      series: [
        {},
        {
          label: "Totale",
          fill: "rgba(59,130,246,0.55)",
          stroke: "rgba(59,130,246,0.9)",
          width: 1,
          paths: uPlot.paths.bars?.({ gap: barGapPx, radius: 0.15 }),
        },
      ],
      scales: {
        x: { time: true },
        y: {
          min: 0,
          range: () => [0, yMax],
        },
      },
      axes: [
        {
          values: (_u, splits) => splits.map((v) => dateFmt(new Date(v * 1000))),
        },
        {
          label: "Recensioni",
          splits: ySplits,
          values: (_u, splits) => splits.map((v) => (v === 0 ? "0" : String(v))),
          grid: { show: true, stroke: "rgba(229,231,235,1)", width: 1 },
        },
      ],
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
            const count = u.data[1][idx] as number;
            const dt = new Date(ts * 1000);

            const dateStr = dt.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
            tooltipEl.textContent = `${dateStr} · Totale: ${count.toLocaleString("it-IT")}`;

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
  }, [aggregation, uplotData, width, yMax]);

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold text-gray-900">{title}</div>
        <div class="inline-flex overflow-hidden rounded-md border border-gray-200">
          {([
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
