interface RelationCount {
  count: number;
}

interface SectorListItem {
  id: string;
  name: string;
  platforms: string[] | null;
  description?: string | null;
  created_at: string;
  categories?: RelationCount[] | RelationCount | null;
  locations?: RelationCount[] | RelationCount | null;
}

interface Props {
  sectors: SectorListItem[];
}

const PLATFORM_LABELS: Record<string, string> = {
  google_maps: "Google Maps",
  tripadvisor: "TripAdvisor",
  booking: "Booking",
};

function getCount(value: SectorListItem["categories"] | SectorListItem["locations"]): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value[0]?.count ?? 0;
  return value.count ?? 0;
}

export default function SectorList({ sectors }: Props) {
  return (
    <div class="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Nome
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Piattaforme
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              N. Categorie
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              N. Location
            </th>
            <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Creato
            </th>
            <th class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
              Azioni
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {sectors.map((sector) => {
            const categoriesCount = getCount(sector.categories);
            const locationsCount = getCount(sector.locations);
            const platforms = sector.platforms ?? [];

            return (
              <tr key={sector.id}>
                <td class="px-4 py-3">
                  <div class="text-sm font-medium text-gray-900">{sector.name}</div>
                  {sector.description && (
                    <div class="mt-0.5 max-w-xl truncate text-xs text-gray-500">{sector.description}</div>
                  )}
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-1">
                    {platforms.length > 0 ? (
                      platforms.map((platform) => (
                        <span
                          key={platform}
                          class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                        >
                          {PLATFORM_LABELS[platform] ?? platform}
                        </span>
                      ))
                    ) : (
                      <span class="text-xs text-gray-400">Nessuna</span>
                    )}
                  </div>
                </td>
                <td class="px-4 py-3 text-sm text-gray-700">{categoriesCount}</td>
                <td class="px-4 py-3 text-sm text-gray-700">{locationsCount}</td>
                <td class="px-4 py-3 text-xs text-gray-500">
                  {new Date(sector.created_at).toLocaleDateString("it-IT")}
                </td>
                <td class="px-4 py-3 text-right">
                  <a
                    href={`/regia/sectors/${sector.id}`}
                    class="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    Modifica
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sectors.length === 0 && (
        <div class="p-8 text-center text-sm text-gray-500">
          Nessun settore trovato.
        </div>
      )}
    </div>
  );
}
