# Mind Digger 2.0 - Piano di Refactoring

## Context

Mind Digger è una piattaforma di analisi recensioni online (Booking, Google Maps, TripAdvisor, Trustpilot). L'architettura attuale (Django + Celery + Redis + React) genera overhead eccessivo per un team snello. Questo refactoring migra tutto verso un'architettura **Serverless & API-First** con costi fissi zero.

**Decisioni confermate:**
- Backend: 100% Supabase (PostgreSQL + Edge Functions TypeScript + Auth + RLS + pg_cron)
- Frontend: Riscrittura completa Astro SSR + Preact Islands (riuso componenti Chart.js via preact/compat)
- Styling: Tailwind CSS (sostituisce MUI)
- AI: Multi-provider + dual mode (batch economico / direct veloce), configurabile da admin
- Dati: Migrazione necessaria da PostgreSQL legacy
- Widget mappe: integrato nel flusso admin (necessario per Place ID → Botster)
- Import Trustpilot JSON: Fase 2 (fuori scope iniziale)
- mindigger-evolved: fuori scope

---

## Fase 0: Scaffolding Monorepo (~2 giorni)

**Obiettivo:** Struttura pnpm workspaces funzionante.

```
digital-matrix-monorepo26/
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
  .env.example
  apps/
    web/                    # Astro 5.x + Preact + Tailwind
  packages/
    shared/                 # Tipi condivisi, enums, utilità
  supabase/
    config.toml
    migrations/
    functions/
    seed.sql
  scripts/
    migrate.ts              # Migrazione dati legacy
```

**Task:**
1. Init git repo, `pnpm-workspace.yaml` con `packages/*` e `apps/*`
2. Init Astro 5.x in `apps/web/` con adapter Vercel, integrazione Preact, Tailwind
3. Init `packages/shared/` come pacchetto TypeScript
4. Init Supabase CLI (`supabase init`)
5. `tsconfig.base.json` condiviso

**Verifica:** `pnpm install` ok, `supabase start` avvia Docker locale, `pnpm --filter web dev` serve Astro

---

## Fase 1: Database + Auth (Settimana 1)

**Obiettivo:** Schema completo Supabase con RLS e autenticazione funzionante.

### Schema DB (migration `001_initial_schema.sql`)

**Tabelle principali:**

| Tabella | Note |
|---------|------|
| `profiles` | Estende `auth.users`. Campi: role (admin/business), subscription, free_trial |
| `business_sectors` | Nome + `platforms TEXT[]` (sostituisce bitfield legacy) |
| `categories` | Nome + FK business_sector |
| `businesses` | Nome, tipo, logo_url, FK user |
| `locations` | Nome, FK business, FK sector, is_competitor |
| `scraping_configs` | **Unifica** GoogleMaps/TripAdvisor/BookingLocation. Platform enum + `platform_config JSONB` per dati specifici (place_id, url). **Dual depth**: `initial_depth`, `recurring_depth`, `frequency` (weekly/monthly), `initial_scrape_done` flag |
| `reviews` | Source, title, text, rating, author, date, `review_hash TEXT` (MD5 dedup), `raw_data JSONB`, `ai_result JSONB`, status enum |
| `review_categories` | Junction table M2M |
| `topics` + `topic_scores` | Topic con score 1-5 per review |
| `ai_batches` | external_batch_id, provider, status, batch_type (reviews/swot) |
| `swot_analyses` | Location, period, results JSONB, status |
| `ai_configs` | Provider, mode (batch/direct), model config. Admin-managed |
| `token_usage` | Tracking consumo token per business/provider/giorno |

**RLS:** Ogni utente vede solo i propri business/locations/reviews. Admin vede tutto. Edge Functions usano service_role (bypassa RLS).

**Auth:** Supabase Auth con email/password + magic link. Trigger su `auth.users` INSERT crea riga in `profiles`.

**File legacy da studiare per lo schema:**
- `mindigger_back/mindigger.core/business/models/` - Modelli Business, Location
- `mindigger_back/mindigger.core/reviews/models/` - Review, Batch, Swot, Token
- `mindigger_back/mindigger.core/botster/models/` - GoogleMaps/TripAdvisor/BookingLocation
- `mindigger_back/mindigger.core/authentication/models/` - CustomUser

**Verifica:** `supabase db reset` applica migrazioni, RLS testato (user A non vede dati user B), signup/login funziona

---

## Fase 2: Pipeline Scraping (Settimane 2-3)

**Obiettivo:** Replicare il flusso Botster come Edge Functions + pg_cron, con ottimizzazione costi.

### Ottimizzazione costi Botster: Dual Depth

Il legacy usa la stessa depth per ogni run, sprecando crediti. Il nuovo sistema distingue scraping iniziale e ricorrente:

| Piattaforma | Scraping iniziale | Scraping ricorrente | Frequenza ricorrente |
|------------|-------------------|---------------------|---------------------|
| Google Maps | 1000-2000 reviews | ~100 reviews | Settimanale |
| TripAdvisor | 1000-2000 reviews | 30 reviews | Settimanale |
| Booking | 250 crediti (fisso) | 250 crediti (fisso) | **Mensile** |

**Schema `scraping_configs`** include:
- `initial_depth INT` - profondità primo scraping (es. 2000)
- `recurring_depth INT` - profondità scraping ricorrenti (es. 100)
- `frequency TEXT CHECK (frequency IN ('weekly', 'monthly'))` - default 'weekly', Booking → 'monthly'
- `initial_scrape_done BOOLEAN DEFAULT false` - flag per sapere se usare initial o recurring depth

**Logica**: `scraping/trigger` controlla `initial_scrape_done`: se false usa `initial_depth` e poi setta il flag a true; se true usa `recurring_depth`.

### Pulizia automatica job Botster

Botster addebita un costo giornaliero di storage per ogni job. Va automatizzata l'archiviazione.

**Edge Function `scraping/cleanup`** (pg_cron settimanale):
- Query Botster API `GET /jobs` (paginata, 50 per pagina)
- Per ogni job completato/fallito con `created_at` > 14 giorni: `POST /jobs/{id}/archive`
- Rate limiting con batch da 10 + delay 3s tra batch (come `svuota-botster/archive_old_jobs.py`)
- L'archive in Botster elimina definitivamente dopo 30 giorni, senza costi ulteriori

**File di riferimento per il port:** `svuota-botster/archive_old_jobs.py`, `svuota-botster/archive_progressive.py`

### Edge Functions:

**`scraping/trigger`** (chiamata da admin)
- Input: `{ location_id, platform }`
- Carica scraping_config, determina depth (initial o recurring in base al flag)
- Chiama Botster API con depth corretto, salva bot_id, status → 'elaborating'
- Porta logica da: `mindigger_back/.../botster/adapters/abstract_core_adapter.py`

**`scraping/poll`** (chiamata da pg_cron ogni minuto)
- Queries scraping_configs con status='elaborating'
- Per ognuna: chiama Botster API check status → se completato: parse results + store_reviews con MD5 dedup
- Quando completato con successo: setta `initial_scrape_done = true` se era il primo run
- Porta logica da: `mindigger_back/.../botster/tasks/check_active_jobs.py` e `mindigger_back/.../botster/utils/store_reviews.py`

**`scraping/scheduled`** (pg_cron, dual schedule)
- **Settimanale** (lunedì 00:00): trigger per location Google Maps e TripAdvisor con `frequency = 'weekly'`
- **Mensile** (1° del mese 00:00): trigger per location Booking con `frequency = 'monthly'`
- Usa sempre `recurring_depth` (initial_scrape_done sarà già true)
- Porta logica da: `mindigger_back/.../botster/tasks/scheduled_scrape.py`

**`scraping/cleanup`** (pg_cron settimanale, domenica 03:00)
- Archivia job Botster completati/falliti > 14 giorni
- Batch processing con rate limiting
- Porta logica da: `svuota-botster/archive_old_jobs.py`

### Utilità condivise (`packages/shared/src/scraping/`):
- `botster-client.ts` - Client HTTP per Botster API (create job, check status, get results, list jobs, archive job)
- `field-mappings.ts` - Port di FieldMappings (mapping campi per piattaforma)
- `review-parser.ts` - Port di parse_results()
- `review-hasher.ts` - MD5 dedup hash (crypto.subtle)

### pg_cron schedules:
```sql
-- Poll Botster ogni minuto
SELECT cron.schedule('poll-scraping-jobs', '* * * * *', ...);
-- Scraping settimanale (Google + TripAdvisor) - Lunedì 00:00
SELECT cron.schedule('weekly-scraping', '0 0 * * 1', ...);
-- Scraping mensile (Booking) - 1° del mese 00:00
SELECT cron.schedule('monthly-scraping', '0 0 1 * *', ...);
-- Cleanup job Botster - Domenica 03:00
SELECT cron.schedule('botster-cleanup', '0 3 * * 0', ...);
```

**Verifica:** Trigger manuale scraping → depth corretto usato (initial/recurring) → poll recupera risultati → reviews salvate con dedup → cleanup archivia job vecchi

---

## Fase 3: Pipeline AI Analysis (Settimane 3-4)

**Obiettivo:** Multi-provider AI con Strategy Pattern, batch e direct mode.

### Provider Interface (`packages/shared/src/ai/types.ts`):

```typescript
interface AIProvider {
  name: string
  supportsBatch(): boolean
  submitBatch(reviews, config): Promise<{ batchId: string }>
  checkBatchStatus(batchId): Promise<BatchStatus>
  retrieveBatchResults(batchId): Promise<AnalysisResult[]>
  analyzeDirect(reviews, config): Promise<AnalysisResult[]>
}
```

### Implementazioni:
- `openai-provider.ts` - Batch (50% sconto, JSONL upload) + Direct
- `gemini-provider.ts` - Batch (Vertex AI) + Direct
- `openrouter-provider.ts` - Solo Direct (no batch)
- `provider-factory.ts` - Legge `ai_configs` e istanzia il provider attivo

### Edge Functions:

**`analysis/submit`** (pg_cron ogni minuto, sostituisce ReviewsAnalyzer)
- Query reviews PENDING, raggruppa per business_sector
- Per ogni settore: costruisce prompt con categorie disponibili
- Batch mode → submitBatch() + crea riga ai_batches
- Direct mode → analyzeDirect() + salva risultati subito
- Porta logica da: `mindigger_back/.../reviews/tasks/ai_interfaces/reviews_analyzer.py`

**`analysis/poll`** (pg_cron ogni minuto, sostituisce ReviewsBatchRetrieval)
- Query ai_batches con status='in_progress', batch_type='reviews'
- Per ogni batch: checkBatchStatus() → se completo: retrieveBatchResults()
- Processa risultati: assegna categorie, crea topics + topic_scores, salva ai_result
- Porta logica da: `mindigger_back/.../reviews/tasks/ai_interfaces/ai_main.py`

**`swot/submit`** + **`swot/poll`** (stesso pattern per analisi SWOT)
- Porta logica da: `mindigger_back/.../reviews/tasks/ai_interfaces/swot_analyzer.py`

### Prompt Engineering:
- Riusa i prompt esistenti da `mindigger_back/.../reviews/tasks/ai_interfaces/`
- Schema JSON strutturato per output coerente (categorie italiane, topic con score 1-5)

**Verifica:** Insert reviews pending → analysis/submit crea batch → analysis/poll recupera risultati → reviews aggiornate con ai_result, topics creati. Test anche direct mode.

---

## Fase 4: Frontend Astro - Dashboard Utente (Settimane 4-6)

**Obiettivo:** Dashboard completa con SSR + Preact Islands interattive.

### Setup Astro:
- Astro 5.x, adapter Vercel SSR
- Middleware auth: verifica sessione Supabase, redirect a login
- Layout: `BaseLayout.astro`, `DashboardLayout.astro`, `AdminLayout.astro`
- Tailwind CSS per styling

### Pagine e Route:

| Route | Tipo | Descrizione |
|-------|------|-------------|
| `/auth/login` | Astro page | Email/password + magic link |
| `/auth/forgot-password` | Astro page | Reset password |
| `/auth/callback` | Astro page | Callback Supabase Auth |
| `/analytics` | SSR + Islands | Dashboard principale |
| `/competitor` | SSR + Islands | Vista competitor (isCompetitor=true) |
| `/swot` | SSR + Islands | Lista analisi SWOT |
| `/swot/create` | SSR + Island | Form creazione SWOT |
| `/swot/[id]` | SSR + Island | Dettaglio SWOT |
| `/settings` | SSR + Island | Profilo utente |

### Preact Islands (componenti interattivi):
- **FilterBar** - Dropdown location, categoria, date range
- **TopCards** - Distribuzione rating con indicatori crescita
- **ReviewChart** - Chart.js stacked area + heatmap (riuso config legacy via preact/compat)
- **ReviewList** - Lista paginata con infinite scroll
- **TopicFilter** - Autocomplete topic
- **SwotForm** - Form creazione SWOT
- **RealtimeStatus** - Subscribe Supabase Realtime per status scraping/analysis live

### Componenti Chart.js da portare:
- `mindigger-client/.../StackedAreaAnalytics.js` → Preact island
- `mindigger-client/.../HeatmapAnalytics.js` → Preact island
- Config Chart.js (datasets, scales, options) riusata identica

**Verifica:** Login funziona, dashboard carica con SSR, filtri interattivi, grafici renderizzano, SWOT creation → analisi → risultato visibile, realtime status updates

---

## Fase 5: Admin Dashboard + Widget Mappe (Settimana 7)

**Obiettivo:** Pannello admin completo con integrazione widget mappe per Place ID.

### Pagine Admin:

| Route | Descrizione |
|-------|-------------|
| `/admin` | Overview stats (utenti, reviews, jobs attivi) |
| `/admin/users` | Lista utenti + enable/disable/lock |
| `/admin/users/create` | Creazione utente + assegnazione business |
| `/admin/businesses` | Lista business + edit |
| `/admin/businesses/create` | **Creazione business con widget mappe integrato** |
| `/admin/scraping` | Status scraping real-time tutti gli utenti |
| `/admin/ai-config` | Configurazione provider AI + mode + vista token usage |

### Widget Mappe:
- Port del widget da `mappe-digitalmatrix/index.html` come Preact island
- Google Maps Places Autocomplete → Place ID
- Brave Search per link TripAdvisor/Booking
- Integrato nel form di creazione business/location
- Place ID + URLs salvati in `scraping_configs.platform_config`

**File sorgente:** `mappe-digitalmatrix/index.html` (439 righe, vanilla JS → Preact)

### Edge Function `admin/ai-config`:
- GET/POST config provider AI attivo
- Solo ruolo admin (verifica JWT claims)

**Verifica:** Admin crea business → widget trova Place ID → location configurata → scraping triggerable. Config AI modificabile e effettiva.

---

## Fase 6: Email + Scheduled Tasks (Settimana 8)

**Obiettivo:** Report settimanali e notifiche email.

### Edge Functions:
- **`reports/weekly`** - Report distribuzione reviews per email (porta da `send_reports`)
- **`reports/generate`** - Generazione PDF scaricabile
- **`scraping/scheduled`** - Trigger settimanale (già in Fase 2)

### pg_cron:
- Lunedì 00:00: trigger scraping settimanale
- Lunedì 12:00: invio report email (dopo che scraping ha avuto tempo)

### Email:
- Servizio transazionale (Resend free tier: 3000 email/mese)
- Template: report settimanale, SWOT completata, notifiche admin

**File legacy template:** `mindigger_back/.../email_handler/templates/`

**Verifica:** Report email inviato con distribuzione corretta, PDF generato e scaricabile

---

## Fase 7: Migrazione Dati (Settimane 9-10)

**Obiettivo:** Migrare dati di produzione dal PostgreSQL Django a Supabase.

### Script `scripts/migrate.ts`:

| Legacy | Nuovo | Trasformazione chiave |
|--------|-------|----------------------|
| `authentication_customuser` | `auth.users` + `profiles` | Crea user Supabase Auth + profilo. Mappa UUID, roles → role |
| `dashboard_admin_businesssector` | `business_sectors` | Int PK → UUID. Bitfield bots → `platforms[]` array |
| `category_category` | `categories` | uid → id, mappa FK sector |
| `business_business` | `businesses` | uid → id, mappa FK user |
| `business_location` | `locations` | uid → id, mappa FK |
| 3x `botster_*location` | `scraping_configs` | Unifica in tabella unica, platform_config JSONB |
| `reviews_review` | `reviews` | uid → id, binary review_hash → hex string |
| `reviews_review_categories` | `review_categories` | Mappa FK con nuovi UUID |
| `topics_topic` | `topics` | uid → id |
| `topics_topicscore` | `topic_scores` | uid → id, mappa FK |
| `reviews_swot` | `swot_analyses` | uid → id |
| `reviews_batch` | `ai_batches` | Int → UUID |
| `reviews_token` | `token_usage` | Int → UUID |

**Ordine migrazione** (rispetta FK): sectors → categories → users → profiles → businesses → locations → scraping_configs → reviews → review_categories → topics → topic_scores → swot → batches → token_usage

### Script `scripts/validate-migration.ts`:
- Confronto row count legacy vs nuovo
- Spot-check record specifici
- Verifica unicità review_hash
- Verifica integrità FK

**Verifica:** Tutti i dati migrati con count corretto, utenti legacy possono loggarsi, reviews visibili nella nuova dashboard

---

## Fase 2+ (Post-lancio): Import Trustpilot

**Obiettivo:** Tool admin per importare JSON reviews Trustpilot.

- Edge Function `import/trustpilot` - Riceve JSON (formato output scraper), parsa, store_reviews con dedup
- Pagina admin `/admin/import` - Upload file JSON, preview dati, conferma import
- Mappa dati Trustpilot (Date, Author, Body, Heading, Rating, Location) → schema reviews

**File di riferimento:** `trustpilot/trustpilot_scraper/authenticated.py` per formato output

---

## Analisi Costi (Costi Fissi Zero)

| Componente | Free Tier | Costo idle |
|------------|-----------|------------|
| Supabase (DB + Auth + Edge Functions) | 500MB DB, 50K users, 500K invocations | 0 EUR |
| Vercel (Astro hosting) | 100GB bandwidth | 0 EUR |
| OpenAI Batch | Pay per token (-50%) | ~2-5 EUR/audit |
| Botster | Pay per job | Variabile |
| Email (Resend) | 3000/mese | 0 EUR |
| **Totale quando idle** | | **0 EUR** |

---

## Rischi e Mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Edge Function timeout (150s) su batch grandi | Chunking reviews, pg_cron frequente, direct mode come fallback |
| Cambio formato Botster API | raw_data JSONB preservato, FieldMappings astraggono i campi |
| Rate limit/deprecation provider AI | Strategy Pattern → switch istantaneo a altro provider |
| Errori migrazione FK | Script validazione, run su staging prima, legacy DB read-only come backup |
| Cold start Edge Functions | pg_cron fire-and-forget, funzioni stateless e idempotenti |
