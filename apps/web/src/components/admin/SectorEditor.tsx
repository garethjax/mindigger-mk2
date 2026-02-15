import { useMemo, useState } from "preact/hooks";

interface Sector {
  id: string;
  name: string;
  description: string | null;
  platforms: string[];
  prompt_template: string | null;
}

interface Category {
  id: string;
  name: string;
}

interface SaveCategory {
  id?: string;
  name: string;
}

export interface SectorEditorPayload {
  sectorId?: string;
  name: string;
  description: string | null;
  platforms: string[];
  categories: SaveCategory[];
  prompt_template: string | null;
}

interface Props {
  sector?: Sector;
  categories?: Category[];
  isNew: boolean;
  onSave?: (data: SectorEditorPayload) => void | Promise<void>;
}

interface CategoryState {
  localId: string;
  id?: string;
  name: string;
}

const PLATFORM_OPTIONS = [
  { value: "google_maps", label: "Google Maps" },
  { value: "tripadvisor", label: "TripAdvisor" },
  { value: "booking", label: "Booking" },
] as const;

function buildLocalId(seed: string, index: number): string {
  return `${seed}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function SectorEditor({ sector, categories = [], isNew, onSave }: Props) {
  const initialCategories = useMemo<CategoryState[]>(
    () =>
      categories.map((c, index) => ({
        localId: buildLocalId(c.id, index),
        id: c.id,
        name: c.name,
      })),
    [categories],
  );

  const [name, setName] = useState(sector?.name ?? "");
  const [description, setDescription] = useState(sector?.description ?? "");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(sector?.platforms ?? []);
  const [categoryItems, setCategoryItems] = useState<CategoryState[]>(initialCategories);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [promptTemplate, setPromptTemplate] = useState(sector?.prompt_template ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function togglePlatform(platform: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform],
    );
  }

  function addCategory() {
    const normalized = newCategoryName.trim();
    if (!normalized) return;
    if (categoryItems.some((c) => c.name.toLowerCase() === normalized.toLowerCase())) {
      setFeedback({ type: "err", text: "Categoria gia' presente." });
      return;
    }

    setCategoryItems((prev) => [
      ...prev,
      {
        localId: buildLocalId("new", prev.length),
        name: normalized,
      },
    ]);
    setNewCategoryName("");
    setFeedback(null);
  }

  function removeCategory(localId: string) {
    setCategoryItems((prev) => prev.filter((c) => c.localId !== localId));
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (!name.trim()) {
      setFeedback({ type: "err", text: "Il nome settore e' obbligatorio." });
      return;
    }

    const payload: SectorEditorPayload = {
      sectorId: sector?.id,
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      platforms: selectedPlatforms,
      categories: categoryItems.map((item) => ({
        id: item.id,
        name: item.name.trim(),
      })),
      prompt_template: promptTemplate.trim() ? promptTemplate.trim() : null,
    };

    setSaving(true);
    setFeedback(null);

    try {
      if (onSave) {
        await onSave(payload);
      } else {
        console.info("SectorEditor payload (UI shell):", payload);
      }
      setFeedback({ type: "ok", text: "Bozza settore pronta. Integrazione DB prevista nel task successivo." });
    } catch {
      setFeedback({ type: "err", text: "Errore durante il salvataggio della bozza." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} class="space-y-6">
      {!isNew && (
        <div class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Modalita' UI shell: il caricamento/salvataggio DB verra' integrato nel task successivo.
        </div>
      )}

      {feedback && (
        <div
          class={`rounded-lg p-3 text-sm ${
            feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </div>
      )}

      <section class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Sezione 1 - Dati base</h2>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Nome settore *</label>
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">Descrizione</label>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            rows={3}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <span class="mb-2 block text-sm font-medium text-gray-700">Piattaforme</span>
          <div class="flex flex-wrap gap-3">
            {PLATFORM_OPTIONS.map((platform) => (
              <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform.value)}
                  onChange={() => togglePlatform(platform.value)}
                  class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{platform.label}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Sezione 2 - Categorie</h2>

        <div class="space-y-2">
          {categoryItems.length === 0 && (
            <p class="text-sm text-gray-500">Nessuna categoria inserita.</p>
          )}

          {categoryItems.map((category) => (
            <div class="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <span class="text-sm text-gray-800">{category.name}</span>
              <button
                type="button"
                onClick={() => removeCategory(category.localId)}
                class="text-xs font-medium text-red-600 hover:text-red-800"
              >
                Rimuovi
              </button>
            </div>
          ))}
        </div>

        <div class="flex gap-2">
          <input
            type="text"
            value={newCategoryName}
            onInput={(e) => setNewCategoryName((e.target as HTMLInputElement).value)}
            placeholder="Nuova categoria"
            class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={addCategory}
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Aggiungi
          </button>
        </div>
      </section>

      <section class="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Sezione 3 - Prompt AI</h2>

        <div>
          <label class="mb-1 block text-sm font-medium text-gray-700">
            Prompt AI personalizzato (opzionale)
          </label>
          <textarea
            value={promptTemplate}
            onInput={(e) => setPromptTemplate((e.target as HTMLTextAreaElement).value)}
            rows={7}
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p class="mt-1 text-xs text-gray-500">
            Variabili disponibili: {"{{sectorName}}"}, {"{{categories}}"}. Lascia vuoto per usare il
            prompt di sistema.
          </p>
        </div>
      </section>

      <div class="flex items-center justify-end gap-2">
        <a
          href="/regia/sectors"
          class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Annulla
        </a>
        <button
          type="submit"
          disabled={saving}
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Salvataggio..." : "Salva"}
        </button>
      </div>
    </form>
  );
}
