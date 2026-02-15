import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
}

interface SearchResult {
  title: string;
  url: string;
}

interface Props {
  googleMapsApiKey: string;
  onPlaceSelected?: (result: {
    placeId: string;
    name: string;
    address: string;
    tripadvisorUrl?: string;
    bookingUrl?: string;
  }) => void;
}

export default function PlaceFinder({ googleMapsApiKey, onPlaceSelected }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [tripResults, setTripResults] = useState<SearchResult[]>([]);
  const [bookingResults, setBookingResults] = useState<SearchResult[]>([]);
  const [tripLoading, setTripLoading] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");

  const supabase = createSupabaseBrowser();

  // Load Google Maps script
  useEffect(() => {
    if (!googleMapsApiKey) {
      setError("Chiave Google Maps API non configurata.");
      return;
    }

    // Check if already loaded
    if (window.google?.maps) {
      initMap();
      return;
    }

    // Define global callback
    (window as any).__initPlaceFinder = () => {
      initMap();
      delete (window as any).__initPlaceFinder;
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&callback=__initPlaceFinder`;
    script.async = true;
    script.defer = true;
    script.onerror = () => setError("Errore caricamento Google Maps API.");
    document.head.appendChild(script);

    return () => {
      delete (window as any).__initPlaceFinder;
    };
  }, [googleMapsApiKey]);

  function initMap() {
    if (!mapRef.current || !inputRef.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 41.902782, lng: 12.496366 },
      zoom: 6,
    });
    mapInstanceRef.current = map;

    const marker = new google.maps.Marker({
      map,
      anchorPoint: new google.maps.Point(0, -29),
    });
    markerRef.current = marker;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current);
    autocomplete.setFields(["place_id", "name", "formatted_address", "geometry"]);

    autocomplete.addListener("place_changed", () => {
      marker.setVisible(false);
      const selected = autocomplete.getPlace();

      if (!selected.geometry?.location) {
        setError("Nessun dettaglio disponibile per questa ricerca.");
        return;
      }

      setError("");
      setTripResults([]);
      setBookingResults([]);

      if (selected.geometry.viewport) {
        map.fitBounds(selected.geometry.viewport);
      } else {
        map.setCenter(selected.geometry.location);
        map.setZoom(17);
      }
      marker.setPosition(selected.geometry.location);
      marker.setVisible(true);

      const result: PlaceResult = {
        placeId: selected.place_id ?? "",
        name: selected.name ?? "",
        address: selected.formatted_address ?? "",
      };
      setPlace(result);

      // Trigger Brave searches
      if (selected.name) {
        searchBrave(selected.name);
      }
    });
  }

  async function searchBrave(placeName: string) {
    // TripAdvisor search
    setTripLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("brave-search", {
        body: {
          query: `${placeName} tripadvisor`,
          filter_regex: "https?://(www\\.)?tripadvisor\\.(com|it)/",
        },
      });
      if (!error && data?.results) {
        setTripResults(data.results.slice(0, 5));
      }
    } catch {
      // Ignore errors silently
    }
    setTripLoading(false);

    // Small delay for rate limiting
    await new Promise((r) => setTimeout(r, 650));

    // Booking.com search
    setBookingLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("brave-search", {
        body: {
          query: `${placeName} booking.com`,
          filter_regex: "https?://(www\\.)?booking\\.com/",
        },
      });
      if (!error && data?.results) {
        setBookingResults(data.results.slice(0, 5));
      }
    } catch {
      // Ignore errors silently
    }
    setBookingLoading(false);
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function sanitizeUrl(rawUrl: string): string {
    try {
      const u = new URL(rawUrl);
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  function selectUrl(platform: "tripadvisor" | "booking", url: string) {
    if (!place || !onPlaceSelected) return;
    onPlaceSelected({
      placeId: place.placeId,
      name: place.name,
      address: place.address,
      ...(platform === "tripadvisor" ? { tripadvisorUrl: url } : { bookingUrl: url }),
    });
  }

  return (
    <div class="space-y-4">
      {/* Search Input */}
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500">Cerca Luogo</label>
        <input
          ref={inputRef}
          type="text"
          placeholder="Inserisci un nome o indirizzo"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Map */}
      <div ref={mapRef} class="h-64 w-full rounded-lg border border-gray-200" />

      {/* Place Details */}
      {place && (
        <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 class="mb-2 text-sm font-bold text-gray-700">Luogo Selezionato</h3>
          <div class="space-y-1 text-sm">
            <div>
              <span class="text-gray-400">Nome:</span>{" "}
              <span class="font-medium">{place.name}</span>
            </div>
            <div>
              <span class="text-gray-400">Indirizzo:</span> {place.address}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-400">Place ID:</span>
              <code class="rounded bg-white px-2 py-0.5 font-mono text-xs">{place.placeId}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(place.placeId, "placeId")}
                class={`rounded px-2 py-0.5 text-xs font-medium ${
                  copied === "placeId"
                    ? "bg-green-100 text-green-700"
                    : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                }`}
              >
                {copied === "placeId" ? "Copiato!" : "Copia"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TripAdvisor Results */}
      {(tripLoading || tripResults.length > 0) && (
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="mb-2 text-sm font-bold text-gray-700">Link TripAdvisor</h3>
          {tripLoading ? (
            <p class="text-xs text-gray-400">Ricerca in corso...</p>
          ) : tripResults.length > 0 ? (
            <ul class="space-y-2">
              {tripResults.map((r, i) => {
                const url = sanitizeUrl(r.url);
                const key = `trip-${i}`;
                return (
                  <li key={i} class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                      <a href={url} target="_blank" rel="noopener" class="block truncate text-xs font-medium text-blue-600 hover:underline">
                        {r.title}
                      </a>
                      <span class="block truncate text-xs text-gray-400">{url}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { copyToClipboard(url, key); selectUrl("tripadvisor", url); }}
                      class={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                        copied === key
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {copied === key ? "Copiato!" : "Usa"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="text-xs text-gray-400">Nessun risultato TripAdvisor.</p>
          )}
        </div>
      )}

      {/* Booking Results */}
      {(bookingLoading || bookingResults.length > 0) && (
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <h3 class="mb-2 text-sm font-bold text-gray-700">Link Booking.com</h3>
          {bookingLoading ? (
            <p class="text-xs text-gray-400">Ricerca in corso...</p>
          ) : bookingResults.length > 0 ? (
            <ul class="space-y-2">
              {bookingResults.map((r, i) => {
                const url = sanitizeUrl(r.url);
                const key = `book-${i}`;
                return (
                  <li key={i} class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                      <a href={url} target="_blank" rel="noopener" class="block truncate text-xs font-medium text-blue-600 hover:underline">
                        {r.title}
                      </a>
                      <span class="block truncate text-xs text-gray-400">{url}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { copyToClipboard(url, key); selectUrl("booking", url); }}
                      class={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                        copied === key
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {copied === key ? "Copiato!" : "Usa"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="text-xs text-gray-400">Nessun risultato Booking.com.</p>
          )}
        </div>
      )}
    </div>
  );
}
