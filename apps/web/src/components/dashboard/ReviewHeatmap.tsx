import { Fragment } from "preact";

interface HeatmapCell {
  day: number; // 0=Mon, 6=Sun
  hour: number; // 0-23
  count: number;
}

interface Props {
  data: HeatmapCell[];
  maxCount: number;
}

const DAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"] as const;
const DAY_FULL = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"] as const;

function cellKey(day: number, hour: number): string {
  return `${day}:${hour}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export default function ReviewHeatmap({ data, maxCount }: Props) {
  const map = new Map<string, number>();
  for (const c of data) {
    if (c.day < 0 || c.day > 6) continue;
    if (c.hour < 0 || c.hour > 23) continue;
    map.set(cellKey(c.day, c.hour), Math.max(0, c.count ?? 0));
  }

  const normalizedMax = Math.max(0, maxCount ?? 0);

  return (
    <div class="rounded-lg border border-gray-200 bg-white p-4">
      <div class="mb-3 text-sm font-semibold text-gray-900">Heatmap Recensioni</div>

      <div class="overflow-x-auto">
        <div
          class="grid gap-1"
          style={{
            gridTemplateColumns: "48px repeat(24, 12px)",
            gridTemplateRows: "16px repeat(7, 12px)",
            minWidth: "calc(48px + 24 * 12px + 23 * 4px)",
          }}
        >
          {/* Header row: hour labels every 3 hours */}
          <div />
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={`h-${hour}`} class="text-[10px] leading-4 text-gray-500">
              {hour % 3 === 0 ? hour : ""}
            </div>
          ))}

          {/* Day rows */}
          {Array.from({ length: 7 }, (_, day) => {
            const dayLabel = DAY_LABELS[day];
            const dayFull = DAY_FULL[day];
            return (
              <Fragment key={`row-${day}`}>
                <div key={`d-${day}`} class="pr-1 text-[10px] leading-3 text-gray-600">
                  {dayLabel}
                </div>
                {Array.from({ length: 24 }, (_, hour) => {
                  const count = map.get(cellKey(day, hour)) ?? 0;
                  const intensity =
                    normalizedMax > 0 ? clamp01(count / normalizedMax) : 0;

                  const bg =
                    count === 0
                      ? undefined
                      : `rgba(37, 99, 235, ${intensity * 0.9 + 0.1})`;

                  return (
                    <div
                      key={`c-${day}-${hour}`}
                      title={`${dayFull} ore ${hour}: ${count} recensioni`}
                      class={`h-3 w-3 rounded-sm border border-gray-100 ${
                        count === 0 ? "bg-gray-50" : ""
                      }`}
                      style={bg ? { backgroundColor: bg } : undefined}
                    />
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
