import { useEffect, useState } from "preact/hooks";
import BusinessEditor from "./BusinessEditor";
import LocationManager from "./LocationManager";
import {
  getToastDuration,
  type EditableLocation,
} from "./helpers";

interface Business {
  id: string;
  name: string;
  type: string;
  ragione_sociale: string | null;
  email: string | null;
  referente_nome: string | null;
  embeddings_enabled: boolean;
}

interface Location extends EditableLocation {}

interface ScrapingConfig {
  id: string;
  location_id: string;
  platform: string;
  status: string;
  initial_scrape_done: boolean;
  last_scraped_at: string | null;
  platform_config: Record<string, string>;
}

interface Sector {
  id: string;
  name: string;
  platforms: string[];
}

interface Props {
  business: Business;
  locations: Location[];
  scrapingConfigs: ScrapingConfig[];
  sectors: Sector[];
  usersLabel: string;
  reviewCount: number;
  googleMapsApiKey?: string;
}

export default function BusinessDetailView({
  business,
  locations: initialLocations,
  scrapingConfigs,
  sectors,
  usersLabel,
  reviewCount,
  googleMapsApiKey,
}: Props) {
  const [locations, setLocations] = useState(initialLocations);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, getToastDuration(message.type));
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  return (
    <div class="space-y-6">
      <BusinessEditor
        business={business}
        usersLabel={usersLabel}
        reviewCount={reviewCount}
        onSave={() => {
          // Business data saved — parent can refresh if needed
        }}
        onMessage={setMessage}
      />

      {message && (
        <div class="pointer-events-none fixed right-6 top-6 z-50">
          <div
            class={`pointer-events-auto min-w-80 max-w-md rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
              message.type === "ok"
                ? "border-green-200 bg-green-50/95 text-green-800"
                : "border-red-200 bg-red-50/95 text-red-800"
            }`}
            aria-live="polite"
          >
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-medium">{message.text}</p>
              <button
                type="button"
                onClick={() => setMessage(null)}
                class="shrink-0 text-xs font-medium opacity-70 hover:opacity-100"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      <LocationManager
        businessId={business.id}
        locations={locations}
        scrapingConfigs={scrapingConfigs}
        sectors={sectors}
        googleMapsApiKey={googleMapsApiKey}
        onLocationsChange={setLocations}
        onMessage={setMessage}
      />
    </div>
  );
}
