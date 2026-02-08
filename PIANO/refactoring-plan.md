# Mind Digger 2.0 - Piano di Refactoring

## Context

Mind Digger è una piattaforma di analisi recensioni online (Booking, Google Maps, TripAdvisor, Trustpilot). L'architettura attuale (Django + Celery + Redis + React) genera overhead eccessivo per un team snello. Questo refactoring migra tutto verso un'architettura **Serverless & API-First** con costi fissi zero.

**Decisioni confermate:**
- Backend: 100% Supabase (PostgreSQL + Edge Functions TypeScript + Auth + RLS + pg_cron + pgvector)
- Frontend: Riscrittura completa Astro SSR + Preact Islands (riuso componenti Chart.js via preact/compat)
- Styling: Tailwind CSS v4 (via @tailwindcss/vite, sostituisce MUI)
- AI: Multi-provider + dual mode (batch economico / direct veloce), configurabile da admin
- Embeddings: Gemini Embedding 001 (768 dim), opt-in per business, ricerca semantica reviews
- Dati: Migrazione dati (no password hash) da PostgreSQL legacy, reset password obbligatorio
- Runtime: Bun (package manager + TS runner), deploy su Vercel
- Hosting: `app2.mindigger.it` (convivenza con legacy `app.mindigger.it`)
- Admin: route `/regia/*` (protezione Cloudflare Rules + Supabase Auth role check)
- Widget mappe: integrato nel flusso admin (necessario per Place ID → Botster)
- Import Trustpilot JSON: Fase 2+ (fuori scope iniziale)
- mindigger-evolved: fuori scope

---

## Fase 0: Scaffolding Monorepo ✅

**Obiettivo:** Struttura Bun workspaces funzionante.

```
digital-matrix-monorepo26/
  package.json              # Bun workspaces root
  tsconfig.base.json
  .env.example
  apps/
    web/                    # Astro 5.17 + Preact + Tailwind v4
  packages/
    shared/                 # Tipi condivisi, enums, utilità
  supabase/
    config.toml
    migrations/
    functions/
    seed.sql
  scripts/
    migrate.ts              # Migrazione dati legacy
    validate-migration.ts   # Validazione post-migrazione
```

**Completato:**
- Bun workspaces monorepo (apps/web, packages/shared)
- Astro 5.17 SSR + Preact compat + Tailwind v4 via `@tailwindcss/vite`
- Adapter Vercel, route utente + admin `/regia/*`
- Shared package con tipi e enums TypeScript (14 interface, 10 enum)
- Supabase CLI init
- `bun install` in 18s, `astro dev` in 879ms

---

## Fase 1: Database + Auth ✅

**Obiettivo:** Schema completo Supabase con RLS e autenticazione funzionante.

### Schema DB (migration `001_initial_schema.sql`)

**Extensions:** pgcrypto, pg_cron, pgvector

**Tabelle principali (14):**

| Tabella | Note |
|---------|------|
| `profiles` | Estende `auth.users`. Campi: role (admin/business), account_enabled/locked, subscription, free_trial |
| `business_sectors` | Nome + `platforms platform[]` (sostituisce bitfield legacy: 1→google, 3→google+tripadvisor, 7→tutti) |
| `categories` | Nome + FK business_sector. 77 categorie su 6 settori (Food, Hospitality, Healthcare, Retail, Dealer, Pharmacy) |
| `businesses` | Nome, tipo, logo_url, FK user, **embeddings_enabled** + **embeddings_status** (opt-in ricerca semantica) |
| `locations` | Nome, FK business, FK sector, is_competitor, report_sent |
| `scraping_configs` | **Unifica** 3 tabelle legacy (87 righe). Platform enum + `platform_config JSONB`. Dual depth + frequency. Campi robustezza: retry_count, last_error, next_poll_at |
| `reviews` | 103K righe legacy. Source, title, text, url, rating, author, date, `review_hash TEXT` (hex MD5), `raw_data JSONB`, `ai_result JSONB`, **`embedding vector(768)`** (nullable), status enum |
| `review_categories` | Junction M2M. 227K righe legacy |
| `topics` + `topic_scores` | 54K topic + 219K score. TopicScore con FK denormalizzate (business, location) per performance |
| `ai_batches` | external_batch_id (formato: `batch_67b4aa...`), provider, status (8 stati), batch_type |
| `swot_analyses` | Location, period enum (3-60 mesi), `statistics JSONB` (array breakdown categorie), `results JSONB` (SWOT + suggerimenti operativi) |
| `ai_configs` | Provider, mode (batch/direct), model config. Admin-managed. Default: OpenAI gpt-4.1, batch, temp 0.1 |
| `token_usage` | Tracking consumo token per business/provider/tipo/giorno. UNIQUE constraint per upsert |

**Indici:** 18 indici standard + 1 indice HNSW parziale per embedding cosine similarity

**RLS:** Abilitato su tutte le 14 tabelle. Helper `is_admin()`. User vede solo propri dati, admin vede tutto. Edge Functions usano service_role.

**Auth:** Supabase Auth con email/password + magic link. Trigger su `auth.users` INSERT crea profilo. **Password legacy NON migrate** — reset obbligatorio al primo accesso (24 utenti, 1 admin).

**Validato contro dump produzione:**
- 103,245 reviews, 54,238 topics, 227,502 review_categories
- review_hash bytea → TEXT hex confermato
- ai_result JSONB con italian_topics, sentiment, language, italian_translation confermato
- Swot statistics/results JSONB struttura confermata
- Bitfield bots (1,3,7) → platforms[] mappatura confermata
- 6 settori, 77 categorie, 20 business, 43 location, 87 scraping configs

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
- `frequency scraping_frequency` - default 'weekly', Booking → 'monthly'
- `initial_scrape_done BOOLEAN DEFAULT false` - flag per sapere se usare initial o recurring depth
- `retry_count INT`, `last_error TEXT`, `next_poll_at TIMESTAMPTZ` - robustezza

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
- Idempotenza: `SELECT ... FOR UPDATE SKIP LOCKED` per claim atomico
- Porta logica da: `mindigger_back/.../botster/adapters/abstract_core_adapter.py`

**`scraping/poll`** (chiamata da pg_cron ogni minuto)
- Queries scraping_configs con status='elaborating'
- Claim atomico con `FOR UPDATE SKIP LOCKED` (sostituisce `@no_simultaneous_execution`)
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
- `field-mappings.ts` - Port di FieldMappings (mapping campi per piattaforma con fallback multipli)
- `review-parser.ts` - Port di parse_results() (include rating 0-10→1-5 per Booking, date parsing multi-formato)
- `review-hasher.ts` - MD5 dedup hash (crypto.subtle), input: JSON sorted di 9 campi

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

## Fase 3: Pipeline AI Analysis + Embeddings (Settimane 3-4)

**Obiettivo:** Multi-provider AI con Strategy Pattern, batch e direct mode. Generazione embeddings opt-in.

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
- `openai-provider.ts` - Batch (50% sconto, JSONL upload) + Direct. Model default: gpt-4.1, temp 0.1
- `gemini-provider.ts` - Batch (Vertex AI) + Direct
- `openrouter-provider.ts` - Solo Direct (no batch)
- `provider-factory.ts` - Legge `ai_configs` e istanzia il provider attivo

### Embedding Provider:
- `gemini-embeddings.ts` - Gemini Embedding 001 via OpenRouter ($0.15/M input, $0 output)
- 768 dimensioni (ottimo MTAB score, sufficiente per review retrieval)
- Possibilità futura: test con 512/256 dim per ottimizzare storage

### Edge Functions:

**`analysis/submit`** (pg_cron ogni minuto, sostituisce ReviewsAnalyzer)
- Query reviews PENDING (e stale ELABORATING >24h), raggruppa per business_sector
- Per ogni settore: costruisce prompt con categorie disponibili (system prompt parametrico)
- Gestione "Senza Commenti": reviews senza testo → skip AI, assegna categoria automatica
- Batch mode → submitBatch() + crea riga ai_batches
- Direct mode → analyzeDirect() + salva risultati subito
- Porta logica da: `mindigger_back/.../reviews/tasks/ai_interfaces/reviews_analyzer.py`

**`analysis/poll`** (pg_cron ogni minuto, sostituisce ReviewsBatchRetrieval)
- Query ai_batches con status='in_progress', batch_type='reviews'
- Per ogni batch: checkBatchStatus() → se completo: retrieveBatchResults()
- Processa risultati: assegna categorie (match case-insensitive), crea topics + topic_scores, salva ai_result
- Sanitizza testi: rimuove control chars, normalizza Unicode
- Gestione traduzioni: se language != 'it', salva italian_translation in title/text
- Porta logica da: `mindigger_back/.../reviews/tasks/ai_interfaces/ai_main.py`

**`swot/submit`** + **`swot/poll`** (stesso pattern per analisi SWOT)
- Input SWOT: reviews filtrate per location + period + categorie
- Output: strengths/weaknesses/opportunities/threats (points[]) + operational_suggestions
- Statistiche pre-calcolate: breakdown per categoria con high/low ratings
- Porta logica da: `mindigger_back/.../reviews/tasks/ai_interfaces/swot_analyzer.py`

**`embeddings/generate`** (chiamata da admin, background)
- Input: `{ business_id }`
- Setta `businesses.embeddings_status = 'processing'`
- Query reviews per business_id dove embedding IS NULL
- Batch da 100 reviews → Gemini Embedding 001 API
- Testo input: title + text italiano (usa italian_translation se disponibile)
- Salva embedding `vector(768)` su ogni review
- Al completamento: `embeddings_status = 'completed'`, `embeddings_enabled = true`
- Gestione errori: `embeddings_status = 'failed'`, log errore

**`search/reviews`** (chiamata da frontend)
- Input: `{ business_id, query, limit?, filters? }`
- Verifica `businesses.embeddings_enabled = true`
- Embed query utente via Gemini Embedding 001 (costo: ~$0.000003)
- Query: `ORDER BY embedding <=> query_embedding` con filtri addizionali (date, rating, platform)
- Scoped per business_id (RLS + WHERE clause)
- Fallback: se embeddings non attivi, usa filtri classici

### Prompt Engineering:
- Riusa i prompt esistenti da `mindigger_back/.../reviews/tasks/ai_interfaces/`
- System prompt parametrico per settore + categorie disponibili
- Schema JSON strutturato per output coerente (categorie italiane, topic con score 1-5)
- Pydantic-like validation su output AI

**Verifica:** Insert reviews pending → analysis/submit crea batch → analysis/poll recupera risultati → reviews aggiornate con ai_result, topics creati. Test anche direct mode. Admin abilita embeddings per Salsamenteria → 15K reviews processate → ricerca semantica funziona.

---

## Fase 4: Frontend Astro - Dashboard Utente (Settimane 4-6)

**Obiettivo:** Dashboard completa con SSR + Preact Islands interattive. Deploy su `app2.mindigger.it`.

### Setup Astro:
- Astro 5.17, adapter Vercel SSR
- Middleware auth: verifica sessione Supabase, redirect a login
- Layout: `BaseLayout.astro`, `DashboardLayout.astro`, `AdminLayout.astro`
- Tailwind CSS v4 via `@tailwindcss/vite`

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
- **FilterBar** - Dropdown location, piattaforma, date range, rating
- **TopCards** - Distribuzione rating con indicatori crescita
- **ReviewChart** - Chart.js stacked area + heatmap (riuso config legacy via preact/compat)
- **ReviewList** - Lista paginata con infinite scroll
- **SemanticSearch** - Barra ricerca naturale (visibile solo se business.embeddings_enabled). Input libero → Edge Function `search/reviews` → risultati ranked per rilevanza
- **SwotForm** - Form creazione SWOT
- **RealtimeStatus** - Subscribe Supabase Realtime per status scraping/analysis live

### Componenti Chart.js da portare:
- `mindigger-client/.../StackedAreaAnalytics.js` → Preact island
- `mindigger-client/.../HeatmapAnalytics.js` → Preact island
- Config Chart.js (datasets, scales, options) riusata identica

**Verifica:** Login funziona, dashboard carica con SSR, filtri interattivi, grafici renderizzano, ricerca semantica su Salsamenteria funziona, SWOT creation → analisi → risultato visibile, realtime status updates

---

## Fase 5: Admin Dashboard + Widget Mappe (Settimana 7)

**Obiettivo:** Pannello admin completo con integrazione widget mappe per Place ID. Route: `/regia/*` protette da Cloudflare Rules.

### Pagine Admin:

| Route | Descrizione |
|-------|-------------|
| `/regia` | Overview stats (utenti, reviews, jobs attivi) |
| `/regia/users` | Lista utenti + enable/disable/lock |
| `/regia/users/create` | Creazione utente + assegnazione business |
| `/regia/businesses` | Lista business + edit + **toggle ricerca semantica** |
| `/regia/businesses/create` | **Creazione business con widget mappe integrato** |
| `/regia/scraping` | Status scraping real-time tutti gli utenti |
| `/regia/ai-config` | Configurazione provider AI + mode + vista token usage |

### Widget Mappe:
- Port del widget da `mappe-digitalmatrix/index.html` come Preact island
- Google Maps Places Autocomplete → Place ID
- Brave Search per link TripAdvisor/Booking
- Integrato nel form di creazione business/location
- Place ID + URLs salvati in `scraping_configs.platform_config`

**File sorgente:** `mappe-digitalmatrix/index.html` (439 righe, vanilla JS → Preact)

### Gestione Embeddings (admin):
- Toggle "Abilita ricerca semantica" per business in `/regia/businesses`
- Click → chiama `embeddings/generate` → progress indicator
- Status visibile: idle / processing / completed / failed
- Costo stimato mostrato prima dell'attivazione (n_reviews × $0.000015)

### Edge Function `admin/ai-config`:
- GET/POST config provider AI attivo
- Solo ruolo admin (verifica JWT claims)

**Verifica:** Admin crea business → widget trova Place ID → location configurata → scraping triggerable. Config AI modificabile e effettiva. Toggle embeddings funziona.

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
- Servizio transazionale (Resend free tier: 3000 email/mese, sostituisce AWS SES)
- Template: report settimanale, SWOT completata, notifiche admin, welcome/reset password

**File legacy template:** `mindigger_back/.../email_handler/templates/` (swot-ready.html, reviews_report.html)

**Verifica:** Report email inviato con distribuzione corretta, PDF generato e scaricabile

---

## Fase 7: Migrazione Dati (Settimane 9-10)

**Obiettivo:** Migrare dati di produzione dal PostgreSQL Django a Supabase.

**Decisione auth:** Password hash legacy (PBKDF2) NON migrato. Utenti ricevono email con link reset password. Con 24 utenti (1 admin + 23 business, di cui la maggior parte test interni) è gestibile con comunicazione diretta.

### Script `scripts/migrate.ts`:

| Legacy | Nuovo | Trasformazione chiave |
|--------|-------|----------------------|
| `authentication_customuser` | `auth.users` + `profiles` | Crea user Supabase Auth (NO password hash), profilo con role. 24 utenti |
| `dashboard_admin_businesssector` | `business_sectors` | Int PK → UUID. Bitfield bots → `platforms[]` (1→[google], 3→[google,tripadvisor], 7→[google,tripadvisor,booking]). 6 settori |
| `category_category` | `categories` | uid → id, mappa FK sector. 77 categorie |
| `business_business` | `businesses` | uid → id, mappa FK user. 21 business |
| `business_location` | `locations` | uid → id, mappa FK. 51 location |
| 3x `botster_*location` | `scraping_configs` | Unifica in tabella unica (87 righe), platform_config JSONB. bot_id formato parziale UUID |
| `reviews_review` | `reviews` | uid → id, binary review_hash → hex string, source bitfield → platform enum. 103K righe |
| `reviews_review_categories` | `review_categories` | Mappa FK con nuovi UUID. 227K righe |
| `topics_topic` | `topics` | uid → id. 54K topic |
| `topics_topicscore` | `topic_scores` | uid → id, mappa FK. 219K righe |
| `reviews_swot` | `swot_analyses` | uid → id, period int → swot_period enum. 59 righe |
| `reviews_batch` | `ai_batches` | Int → UUID, status/type int → enum. 59 righe |
| `reviews_token` | `token_usage` | Tabella vuota nel legacy (era commentato nel codice) |

**Ordine migrazione** (rispetta FK): sectors → categories → users → profiles → businesses → locations → scraping_configs → reviews → review_categories → topics → topic_scores → swot → batches → token_usage

### Script `scripts/validate-migration.ts`:
- Confronto row count legacy vs nuovo
- Spot-check record specifici
- Verifica unicità review_hash
- Verifica integrità FK

### Post-migrazione:
- Generazione embeddings per Salsamenteria di Parma (15,202 reviews → ~$0.23)
- Test ricerca semantica con dati reali

**Verifica:** Tutti i dati migrati con count corretto, utenti legacy possono completare reset password e accedere, reviews visibili nella nuova dashboard

---

## Fase 2+ (Post-lancio): Import Trustpilot

**Obiettivo:** Tool admin per importare JSON reviews Trustpilot.

- Edge Function `import/trustpilot` - Riceve JSON (formato output scraper), parsa, store_reviews con dedup
- Pagina admin `/regia/import` - Upload file JSON, preview dati, conferma import
- Mappa dati Trustpilot (Date, Author, Body, Heading, Rating, Location) → schema reviews

**File di riferimento:** `trustpilot/trustpilot_scraper/authenticated.py` per formato output

---

## Analisi Costi

### Costi fissi (idle)

| Componente | Free Tier | Costo idle |
|------------|-----------|------------|
| Supabase (DB + Auth + Edge Functions) | 500MB DB, 50K users, 500K invocations | 0 EUR |
| Vercel (Astro hosting) | 100GB bandwidth | 0 EUR |
| OpenAI Batch | Pay per token (-50%) | 0 EUR |
| Botster | Pay per job | 0 EUR |
| Email (Resend) | 3000/mese | 0 EUR |
| Gemini Embeddings | Pay per token | 0 EUR |
| **Totale quando idle** | | **0 EUR** |

### Costi operativi (per audit/business)

| Operazione | Costo stimato |
|-----------|---------------|
| Analisi AI batch (103K reviews) | ~2-5 EUR |
| Embedding generation (15K reviews) | ~$0.23 |
| Embedding singola query | ~$0.000003 |
| Scraping Botster | Variabile per job |
| Supabase Pro (se serve >500MB) | $25/mese |

---

## Rischi e Mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Edge Function timeout (150s) su batch grandi | Chunking reviews, pg_cron frequente, direct mode come fallback |
| Cambio formato Botster API | raw_data JSONB preservato, FieldMappings astraggono i campi |
| Rate limit/deprecation provider AI | Strategy Pattern → switch istantaneo a altro provider |
| Errori migrazione FK | Script validazione, run su staging prima, legacy DB read-only come backup |
| Cold start Edge Functions | pg_cron fire-and-forget, funzioni stateless e idempotenti |
| Storage DB > 500MB con embeddings | Indice HNSW parziale (solo righe con embedding). Dimensioni riducibili (768→512→256). Pro tier $25/mese se necessario |
| Costi embedding incontrollati | Opt-in per business, stima costo mostrata in admin prima dell'attivazione |
| Concorrenza cron jobs | `SELECT ... FOR UPDATE SKIP LOCKED` per claim atomico record |
| Password legacy incompatibili | Reset password obbligatorio, comunicazione diretta ai ~24 utenti |

---

## Volumi Dati di Produzione (da dump Feb 2026)

| Entità | Count |
|--------|-------|
| Utenti | 24 (1 admin, 23 business) |
| Business | 21 |
| Location | 51 |
| Settori | 6 |
| Categorie | 77 |
| Scraping configs | 87 (43 Google + 31 TripAdvisor + 13 Booking) |
| Reviews | 103,245 |
| Review-Categories | 227,502 |
| Topics | 54,238 |
| Topic Scores | 219,294 |
| SWOT | 59 |
| AI Batches | 59 |
| Token Usage | 0 (non usato nel legacy) |

**Top business per volume:** Azienda per l'Evento (28K), Andrea Hospitality (18K), Salsamenteria di Parma (15K)
