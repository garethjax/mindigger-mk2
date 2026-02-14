# Piano Operativo — Prossime Fasi

**Stato attuale:** Branch `main` @ `a1d7ba5`, Fasi 0-5 complete.
**Obiettivo:** Dashboard analytics completa + migrazione dati legacy.

---

## Workstream Overview

```
                    ┌─────────────────────────────────────┐
                    │          ORCHESTRATORE (Claude)      │
                    │  integrazione, test live, debug      │
                    └──────────┬──────────┬───────────────┘
                               │          │
              ┌────────────────┤          ├────────────────┐
              ▼                ▼          ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  STREAM A    │ │  STREAM B    │ │  STREAM C    │ │  STREAM D    │
     │  Dashboard   │ │  Dati &      │ │  Charting    │ │  Infra &     │
     │  Components  │ │  Migration   │ │  uPlot       │ │  Polish      │
     │  (Codex)     │ │  (Codex)     │ │  (Codex)     │ │  (Claude)    │
     └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

---

## STREAM A — Dashboard Components (Codex)

Componenti Preact isolati, puramente UI. Nessuna dipendenza da ambiente live.

### A1. TopCards — 6 Sentiment Cards (CSS puro)

**Branch:** `feat/sentiment-topcards`

**Spec:**
Riscrivere `apps/web/src/components/dashboard/TopCards.tsx`.
Attualmente mostra 4 card generiche. Deve diventare **6 card sentimento** come nella vecchia interfaccia (vedi PIANO/analytics-top.jpg).

**Input props:**
```typescript
interface SentimentCard {
  label: string;        // "Eccellente", "Buono", "Neutro", "Negativo", "Molto Negativo"
  count: number;        // numero di recensioni in questa fascia
  percentage: number;   // percentuale sul totale
  color: string;        // tailwind color class
  ratingRange: [number, number]; // es. [4.5, 5] per Eccellente
}

interface Props {
  totalReviews: number;
  avgRating: number;
  sentiments: SentimentCard[];
  periodGrowth?: number;
}
```

**Mapping rating → sentimento:**
- Eccellente: 5 stelle (rating = 5) — verde (`bg-green-500`)
- Buono: 4 stelle (rating = 4) — lime (`bg-lime-500`)
- Neutro: 3 stelle (rating = 3) — giallo (`bg-yellow-500`)
- Negativo: 2 stelle (rating = 2) — arancione (`bg-orange-500`)
- Molto Negativo: 1 stella (rating = 1) — rosso (`bg-red-500`)

**Layout:** 6 card in griglia responsive: 2 col mobile, 3 col tablet, 6 col desktop.
Ogni card mostra: label, count grande, percentuale, barra colorata width%.

**Prima card speciale "Totale":** sfondo grigio, mostra totalReviews + avgRating con stelle.

**Non toccare:** Dashboard.tsx (l'adattamento delle props lo farà l'orchestratore in integrazione).

---

### A2. FilterBar — "Tutte le Sedi" + Argomento

**Branch:** `feat/filterbar-enhanced`

**Spec:**
Modificare `apps/web/src/components/dashboard/FilterBar.tsx`.

**Cambiamenti:**
1. Aggiungere opzione `<option value="">Tutte le sedi</option>` come primo elemento del dropdown sedi. Quando selezionato, `locationId = null` (già gestito da Dashboard.tsx come "nessun filtro location").

2. Aggiungere dropdown "Argomento" (categoria). Nuova prop:
```typescript
interface Category {
  id: string;
  name: string;
}
```
Props aggiuntive: `categories: Category[]`

3. Aggiornare `FilterState` export:
```typescript
export interface FilterState {
  locationId: string | null;  // null = tutte le sedi
  categoryId: string | null;  // null = tutti gli argomenti
  dateFrom: string;
  dateTo: string;
  source: string | null;
}
```

4. Label "Location" → "Sedi", "Piattaforma" rimane.

**Non toccare:** Dashboard.tsx, le pagine .astro (l'orchestratore adatterà i consumatori).

---

### A3. ReviewList — Star Filter + Topic Badges Colorati

**Branch:** `feat/reviewlist-enhanced`

**Spec:**
Modificare `apps/web/src/components/dashboard/ReviewList.tsx`.

**Cambiamenti:**

1. **Star filter bar** sopra la lista: 5 bottoni stella (1-5) + "Tutte". Cliccando su una stella filtra le recensioni per quel rating. Stato locale, filtra lato client sulle review già caricate O aggiunge filtro alla query Supabase.

   Preferire **filtro lato query** (aggiungere `ratingFilter: number | null` al FilterState oppure gestirlo internamente con stato locale + rifetch).

2. **Topic badges colorati**: i topic in `ai_result.italian_topics` devono mostrare il badge con colore basato sullo score:
   - score 4-5: `bg-green-100 text-green-700`
   - score 3: `bg-yellow-100 text-yellow-700`
   - score 1-2: `bg-red-100 text-red-700`

   Mostrare score numerico nel badge: `"Pulizia 4.2"`.

3. **Mostrare fino a 5 topic** (attualmente 3).

**Non toccare:** FilterBar.tsx, TopCards.tsx.

---

## STREAM B — Dati & Migrazione (Codex)

Tasks puramente SQL/TypeScript, nessuna UI.

### B1. Seed Categories — Migration SQL

**Branch:** `feat/seed-categories`

**Spec:**
Creare `supabase/migrations/006_seed_categories.sql`.

La tabella `categories` esiste già (migration 001) ma è vuota nel DB locale (il seed non le popola). Bisogna inserire le 77 categorie trovate nel legacy dump.

**Le categorie per settore si trovano nei prompt AI legacy.** Cercare nei file:
- `PIANO/old_dump/tables_split/` — cercare file relativo a `category_category`
- Oppure estrarle direttamente dal dump SQL

**Schema target:**
```sql
INSERT INTO categories (id, name, business_sector_id) VALUES
  (gen_random_uuid(), 'Nome Categoria', (SELECT id FROM business_sectors WHERE name = 'NomeSettore')),
  ...;
```

**I 6 settori** (da `business_sectors`): Food & Beverage, Hospitality, Healthy and Care, Retail, Dealer, Pharmacy.

**Nota:** i settori nel seed.sql attuale sono solo 3 (Hospitality, Ristorazione, Servizi). Questa migration deve:
1. Inserire i settori mancanti (Food & Beverage, Healthy and Care, Retail, Dealer, Pharmacy) — oppure aggiornare i nomi esistenti per allinearli al legacy
2. Inserire tutte le 77 categorie con le FK corrette

**File di riferimento per le categorie:** cercare nel dump `category_category` e `dashboard_admin_businesssector`.

---

### B2. Data Migration Script — scripts/migrate.ts

**Branch:** `feat/data-migration`

**Spec:**
Creare `scripts/migrate.ts` che legge dal dump SQL legacy (`PIANO/old_dump/dump26.sql` o dai file split in `PIANO/old_dump/tables_split/`) e inserisce i dati nel Supabase locale.

**Ordine migrazione** (rispetta FK):
1. `dashboard_admin_businesssector` → `business_sectors`
2. `category_category` → `categories`
3. `authentication_customuser` → `auth.users` + `profiles`
4. `business_business` → `businesses`
5. `business_location` → `locations`
6. 3x `botster_*location` → `scraping_configs`
7. `reviews_review` → `reviews`
8. `reviews_review_categories` → `review_categories`
9. `topics_topic` → `topics`
10. `topics_topicscore` → `topic_scores`
11. `reviews_swot` → `swot_analyses`
12. `reviews_batch` → `ai_batches`

**Trasformazioni chiave:**
- UUID: `uid` legacy → `id` nuovo (mantieni gli stessi UUID per preservare relazioni)
- `review_hash`: binary → hex string
- `businesses.user_id` → `profiles.business_id` (invertito)
- 3 tabelle botster → 1 `scraping_configs` con `platform` enum + `platform_config` JSONB
- `bots` bitfield in `business_sectors` → `platforms TEXT[]`
- Password utenti: **NON migrare** (forza reset password per tutti tranne admin)

**Approccio:** leggere i file `.sql` split da `PIANO/old_dump/tables_split/`, parsare le righe `COPY ... FROM stdin`, trasformare e inserire via Supabase client (service_role).

**File di output:** `scripts/migrate.ts` + `scripts/validate-migration.ts` (confronto row count).

**Nota:** lo script deve essere idempotente — se eseguito due volte non deve creare duplicati (usa UPSERT o DELETE+INSERT per tabella).

---

## STREAM C — Charting con uPlot (Codex)

### C1. ReviewChart — uPlot Area Chart Component

**Branch:** `feat/uplot-chart`

**Spec:**
Creare `apps/web/src/components/dashboard/ReviewChart.tsx`.

**Dipendenza:** `uplot` (da aggiungere a `apps/web/package.json`).

**Props:**
```typescript
interface ChartDataPoint {
  date: string;          // ISO date "2024-01-15"
  count: number;         // numero recensioni
  avgRating: number;     // rating medio nel periodo
}

interface Props {
  data: ChartDataPoint[];
  aggregation: "day" | "week" | "month";
  onAggregationChange: (agg: "day" | "week" | "month") => void;
}
```

**Comportamento:**
1. Toggle bar con 3 bottoni: Giorno / Settimana / Mese (attivo = sfondo scuro)
2. Area chart con:
   - Asse X: date
   - Asse Y sinistro: conteggio recensioni (area riempita, azzurro semi-trasparente)
   - Asse Y destro: rating medio (linea arancione)
3. Tooltip al hover: data, conteggio, rating medio
4. Responsive: usa ResizeObserver per adattarsi al container

**uPlot init pattern:**
```typescript
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// In useEffect:
const opts: uPlot.Options = {
  width: containerWidth,
  height: 300,
  series: [
    {},  // x-axis (timestamps)
    { label: "Recensioni", fill: "rgba(59,130,246,0.15)", stroke: "rgb(59,130,246)", width: 2 },
    { label: "Rating", stroke: "rgb(249,115,22)", width: 2, scale: "rating" },
  ],
  scales: {
    x: { time: true },
    y: { min: 0 },
    rating: { min: 1, max: 5 },
  },
  axes: [
    {},
    { label: "Recensioni" },
    { label: "Rating", side: 1, scale: "rating" },
  ],
};
const chart = new uPlot(opts, uplotData, containerRef.current);
```

**uPlot data format:** array di array: `[timestamps[], counts[], ratings[]]` dove timestamps sono epoch seconds.

**Cleanup:** `chart.destroy()` in useEffect cleanup.

**Non implementare:** il data fetching. Il componente riceve `data` come prop. L'orchestratore collegherà il fetch.

---

### C2. ReviewHeatmap — CSS Grid Heatmap

**Branch:** `feat/heatmap-css`

**Spec:**
Creare `apps/web/src/components/dashboard/ReviewHeatmap.tsx`.

**Nessuna dipendenza esterna.** Solo CSS Grid + Tailwind.

**Props:**
```typescript
interface HeatmapCell {
  day: number;   // 0=Mon, 6=Sun
  hour: number;  // 0-23
  count: number;
}

interface Props {
  data: HeatmapCell[];
  maxCount: number;   // per normalizzare l'intensità del colore
}
```

**Layout:**
- Griglia 7 righe (Lun-Dom) × 24 colonne (ore 0-23)
- Labels asse Y: Lun, Mar, Mer, Gio, Ven, Sab, Dom
- Labels asse X: 0, 3, 6, 9, 12, 15, 18, 21 (ogni 3 ore)
- Ogni cella: quadratino con colore proporzionale a `count / maxCount`
- Scala colori: bianco (0) → azzurro chiaro → blu scuro (max)
- Tooltip al hover (title attribute): "Lunedì ore 14: 23 recensioni"

**Colore celle:** calcolare opacity o step di colore via inline style:
```typescript
const intensity = maxCount > 0 ? cell.count / maxCount : 0;
const bg = `rgba(37, 99, 235, ${intensity * 0.9 + 0.1})`; // blu con alpha
```

Celle con count=0: `bg-gray-50`.

**Non implementare:** data fetching o aggregazione. Il componente riceve `data` come prop.

---

## STREAM D — Integrazione & Polish (Claude orchestratore)

Tasks che richiedono ambiente live, debug interattivo, o toccano più file.

### D1. Integrazione Dashboard.tsx

Dopo che A1/A2/A3 sono completati, aggiornare `Dashboard.tsx` per:
- Calcolare i 6 `sentiments` dai dati rating (attualmente calcola solo `distribution`)
- Passare `categories` a FilterBar (fetch da Supabase)
- Aggiungere `categoryId` al filtro query reviews
- Supportare `locationId = null` come "tutte le sedi" (rimuovere il guard `if (!filters.locationId) return`)
- Aggiungere fetch dati per ReviewChart (aggregazione temporale via Supabase RPC o query + group)
- Aggiungere fetch dati per ReviewHeatmap (query `review_date` → estrai day-of-week + hour)

### D2. Supabase RPC per aggregazioni chart

Creare funzioni PostgreSQL per le aggregazioni temporali (più efficienti del fetch tutti i rating lato client):
```sql
-- reviews_by_period(location_id, date_from, date_to, granularity)
-- returns: date, count, avg_rating
-- heatmap_data(location_id, date_from, date_to)
-- returns: day_of_week, hour, count
```

### D3. Test integrato con dati reali

Dopo B1 (seed categories) e B2 (migrazione), testare l'intera dashboard con i 103K reviews reali per verificare performance e correttezza.

### D4. Pagine .astro — fetch categories e "Tutte le sedi"

Aggiornare `analytics/index.astro` e `competitor/index.astro` per:
- Fetch categories dal DB e passarle come prop a Dashboard
- Adattare la logica "Tutte le sedi" (passare tutte le location, non solo la prima)

---

## Ordine di esecuzione

```
Settimana 1:
  Parallelo:
    CODEX → A1 (TopCards)        ~1h
    CODEX → A2 (FilterBar)       ~30min
    CODEX → A3 (ReviewList)      ~1h
    CODEX → B1 (Seed categories) ~1h
    CODEX → C1 (uPlot chart)     ~2h
    CODEX → C2 (Heatmap CSS)     ~1h

  Sequenziale (dopo che A1-A3 tornano):
    CLAUDE → D1 (Integrazione Dashboard.tsx)
    CLAUDE → D2 (RPC PostgreSQL)
    CLAUDE → D4 (Pagine .astro)
    CLAUDE → Test live

Settimana 2:
    CODEX → B2 (Data migration script)
    CLAUDE → D3 (Test con dati reali)
    CLAUDE → Fix e polish
```

---

## Come assegnare a Codex

Per ogni task Codex, creare il branch e poi dare il prompt con:

1. **Il file esatto da creare/modificare** (path completo)
2. **Le interface TypeScript** (copiate da questo piano)
3. **Il contesto dei file adiacenti** (es. "FilterBar.tsx esporta FilterState usato da Dashboard.tsx")
4. **Cosa NON toccare** (per evitare conflitti tra task paralleli)
5. **Il pattern di styling** Tailwind usato nel progetto (rounded-lg, border-gray-200, text-sm, etc.)

**Template prompt Codex:**
```
Branch: feat/xxx
File da modificare: apps/web/src/components/dashboard/Xxx.tsx
Contesto: [breve descrizione del progetto e dello stack]
Spec: [copia della sezione corrispondente da questo piano]
Vincoli: non modificare altri file. Usa Preact (import da "preact/hooks"), non React.
Stile: Tailwind CSS, classi consistenti con il resto del progetto (vedi file esistenti).
```

---

## Note importanti per Codex

- **Framework:** Preact, NON React. Import: `import { useState, useEffect } from "preact/hooks"`
- **Supabase client:** `import { createSupabaseBrowser } from "@/lib/supabase"`
- **Styling:** Tailwind CSS v4, classi inline, NO CSS modules
- **Export:** `export default function ComponentName` (Preact islands in Astro)
- **TypeScript:** strict mode, niente `any`
- **Convenzione nomi:** componenti PascalCase, file PascalCase.tsx
- **Lingua UI:** Italiano per label visibili, inglese per codice/variabili
