import { useMemo, useState } from "preact/hooks";
import { createSupabaseBrowser } from "@/lib/supabase";

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

const DEFAULT_PROMPT_TEMPLATE = `You are an expert text analyzer for reviews about {{sectorName}} sector.
Analyze the review and extract the following information in valid JSON format.

Rules:
1. italian_categories: Select up to 5 most relevant categories from the list provided. Do not invent new categories.
2. italian_topics: Generate up to 5 most relevant topics. Each italian_topic should have only one relation with one of categories from the list provided.
3. For each italian_topic, provide a satisfaction score from 1 to 5 (1 = strong dissatisfaction/problem, 5 = strong satisfaction/praise)
4. If the review is not in Italian, you MUST provide the 'italian_translation' field.
5. If the review title is not present, you MUST generate a title in Italian for the review.

Available categories: [{{categories}}]`;

function buildLocalId(seed: string, index: number): string {
  return `${seed}-${index}`;
}

function renderTemplate(template: string, sectorName: string, categoriesValue: string): string {
  return template
    .replaceAll("{{sectorName}}", sectorName)
    .replaceAll("{{categories}}", categoriesValue);
}

export default function SectorEditor({ sector, categories = [], isNew, onSave }: Props) {
  const supabase = createSupabaseBrowser();

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
  const [nextLocalIndex, setNextLocalIndex] = useState(initialCategories.length);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const cleanedCategories = useMemo(
    () =>
      categoryItems
        .map((item) => ({ ...item, name: item.name.trim() }))
        .filter((item) => item.name.length > 0),
    [categoryItems],
  );

  const promptCategories = useMemo(
    () => cleanedCategories.map((item) => `"${item.name.toUpperCase().replace(/\s+/g, "_")}"`).join(", "),
    [cleanedCategories],
  );

  const activeTemplate = promptTemplate.trim() ? promptTemplate : DEFAULT_PROMPT_TEMPLATE;

  const promptPreview = useMemo(
    () =>
      renderTemplate(
        activeTemplate,
        name.trim() || "Settore",
        promptCategories || '"SENZA_COMMENTI", "ALTRO"',
      ),
    [activeTemplate, name, promptCategories],
  );

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
        localId: buildLocalId("new", nextLocalIndex),
        name: normalized,
      },
    ]);
    setNextLocalIndex((prev) => prev + 1);
    setNewCategoryName("");
    setFeedback(null);
  }

  function removeCategory(localId: string) {
    setCategoryItems((prev) => prev.filter((c) => c.localId !== localId));
  }

  async function saveWithSupabase(payload: SectorEditorPayload): Promise<string> {
    let savedSectorId = payload.sectorId;

    if (isNew || !savedSectorId) {
      const { data: createdSector, error: createError } = await supabase
        .from("business_sectors")
        .insert({
          name: payload.name,
          description: payload.description,
          platforms: payload.platforms,
          prompt_template: payload.prompt_template,
        })
        .select("id")
        .single();

      if (createError || !createdSector) {
        throw new Error(createError?.message ?? "Errore nella creazione del settore");
      }
      savedSectorId = createdSector.id;
    } else {
      const { error: updateError } = await supabase
        .from("business_sectors")
        .update({
          name: payload.name,
          description: payload.description,
          platforms: payload.platforms,
          prompt_template: payload.prompt_template,
        })
        .eq("id", savedSectorId);

      if (updateError) {
        throw new Error(updateError.message);
      }
    }

    const keptCategoryIds = new Set(payload.categories.map((item) => item.id).filter(Boolean) as string[]);
    const removedCategories = categories.filter((item) => !keptCategoryIds.has(item.id));

    if (removedCategories.length > 0) {
      const blocked: string[] = [];
      const removableIds: string[] = [];

      for (const item of removedCategories) {
        const { count, error: countError } = await supabase
          .from("review_categories")
          .select("category_id", { count: "exact", head: true })
          .eq("category_id", item.id);

        if (countError) {
          throw new Error(countError.message);
        }

        if ((count ?? 0) > 0) {
          blocked.push(`${item.name} (${count})`);
        } else {
          removableIds.push(item.id);
        }
      }

      if (blocked.length > 0) {
        throw new Error(`Impossibile rimuovere categorie in uso: ${blocked.join(", ")}`);
      }

      if (removableIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("categories")
          .delete()
          .in("id", removableIds);

        if (deleteError) {
          throw new Error(deleteError.message);
        }
      }
    }

    const newCategoryRows = payload.categories.filter((item) => !item.id);
    if (newCategoryRows.length > 0) {
      const { error: categoryInsertError } = await supabase
        .from("categories")
        .insert(
          newCategoryRows.map((item) => ({
            name: item.name,
            business_sector_id: savedSectorId,
          })),
        );

      if (categoryInsertError) {
        throw new Error(categoryInsertError.message);
      }
    }

    if (!savedSectorId) {
      throw new Error("ID settore non disponibile dopo il salvataggio.");
    }

    return savedSectorId;
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (!name.trim()) {
      setFeedback({ type: "err", text: "Il nome settore e' obbligatorio." });
      return;
    }

    if (cleanedCategories.length === 0) {
      setFeedback({ type: "err", text: "Inserisci almeno una categoria." });
      return;
    }

    const categoryNames = new Set<string>();
    for (const item of cleanedCategories) {
      const key = item.name.toLowerCase();
      if (categoryNames.has(key)) {
        setFeedback({ type: "err", text: "Le categorie devono avere nomi univoci." });
        return;
      }
      categoryNames.add(key);
    }

    const payload: SectorEditorPayload = {
      sectorId: sector?.id,
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      platforms: selectedPlatforms,
      categories: cleanedCategories.map((item) => ({
        id: item.id,
        name: item.name,
      })),
      prompt_template: promptTemplate.trim() ? promptTemplate.trim() : null,
    };

    setSaving(true);
    setFeedback(null);

    try {
      let savedSectorId = payload.sectorId ?? "";

      if (onSave) {
        await onSave(payload);
      } else {
        savedSectorId = await saveWithSupabase(payload);
      }

      setFeedback({ type: "ok", text: "Settore salvato con successo." });

      if (isNew && savedSectorId) {
        window.location.href = `/regia/sectors/${savedSectorId}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore durante il salvataggio del settore.";
      setFeedback({ type: "err", text: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} class="min-w-0 space-y-6">
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
        <p class="text-xs text-gray-500">Suggerite come default: "Senza Commenti" e "Altro".</p>

        <div class="space-y-2">
          {categoryItems.length === 0 && <p class="text-sm text-gray-500">Nessuna categoria inserita.</p>}

          {categoryItems.map((category) => (
            <div class="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <span class="min-w-0 break-words text-sm text-gray-800">{category.name}</span>
              <button
                type="button"
                onClick={() => removeCategory(category.localId)}
                class="shrink-0 text-xs font-medium text-red-600 hover:text-red-800"
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
          <label class="mb-1 block text-sm font-medium text-gray-700">Prompt AI personalizzato (opzionale)</label>
          <div class="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPromptTemplate(DEFAULT_PROMPT_TEMPLATE)}
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Carica default
            </button>
          </div>
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

        <div>
          <div class="mb-1 block text-sm font-medium text-gray-700">Preview prompt risultante</div>
          <pre class="max-h-64 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">{promptPreview}</pre>
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
