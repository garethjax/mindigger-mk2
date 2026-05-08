# Lessons Learned — Digital Matrix Monorepo

## Workaround attivi

### Supabase JWT ES256 rejection
Le edge function callable da browser devono avere `verify_jwt = false` in `config.toml` perché il gateway Supabase non supporta ES256. L'auth viene verificata internamente via `requireInternalOrAdmin()`.

### pg_cron service_role_key
Dopo ogni `supabase stop && supabase start`, la chiave service_role non persiste. Va ri-settata con `ALTER DATABASE postgres SET app.settings.service_role_key = '...'`. Automatizzato nello script `scripts/restart-supabase.sh`.

### uPlot rendering
Il rendering standard di uPlot (paths/fills/bars) non funziona. Tutti i grafici usano `hooks.draw` con Canvas API diretto. Non usare mai le serie standard per nuovi grafici.

### PostgREST max_rows
Il default di 1000 righe tronca silenziosamente i risultati. Alzato a 50000 in `config.toml`.

## Problemi ricorrenti risolti

### Chunking nei poll functions (2026-03-18)
**Problema**: `analysis-poll` e `rescore-poll` processavano l'output OpenAI in chunk da 200 righe, richiedendo click multipli su "Controlla status". Con 203 recensioni, 3 restavano bloccate in `analyzing` per sempre.
**Soluzione**: Rimosso il chunking — processing single-pass di tutto l'output.

### Batch bloccati in "in corso" (2026-03-18)
**Problema**: Batch completati su OpenAI ma ancora "in_progress" nel DB perché il chunking non processava le ultime righe.
**Soluzione**: Stessa fix del chunking + reset manuale delle 203 review stuck con `UPDATE reviews SET status = 'pending' WHERE status = 'analyzing'`.

### 404 su rescore senza dati (2026-03-18)
**Problema**: Premere "rescore" senza selezionare un business dava HTTP 404.
**Soluzione**: Aggiunto dialog di conferma prima del rescore globale.

### Race condition scraping-poll vs Botster runs (2026-05-08)
**Problema**: Botster può rispondere con `job.state = "completed"` e `job.runs = []` per qualche secondo dopo la fine del job, prima che il run sia indicizzato. `scraping-poll` interpretava questa risposta come "completato senza dati" e marcava `scraping_configs.status = completed` senza re-pollare. Il run effettivo (1000 review) appariva poco dopo, ma il sistema non lo guardava più. Per IGINIO MASSARI TripAdvisor risultato: 0 review ingerite nonostante Botster ne avesse 1000.
**Recupero manuale**: usare lo script `bun run scripts/recover-scraping.ts` (senza argomenti scansiona e mostra i candidati; con `<config_id>` recupera uno; con `--all` recupera tutti). Internamente chiama la edge function `scraping-import` (richiede JWT admin, non service_role).
**Fix applicato (2026-05-08)**: in `supabase/functions/scraping-poll/index.ts` quando `runs.length === 0` ma `state === completed`, lo scraping resta `elaborating` per un re-poll al tick successivo, incrementando `retry_count`. Dopo `RUNS_RETRY_LIMIT = 10` tentativi (~10 minuti col cron ogni minuto) marca completed con un messaggio di errore informativo. `retry_count` viene azzerato sull'ingestion riuscita.

**Fix correlato (2026-05-08)**: `scraping-import` non passava `location_id` ad `analysis-submit` → modalità globale → bloccava qualsiasi nuovo batch se ce n'era già uno attivo. Ora passa `location_id`, abilitando batch OpenAI paralleli per location diverse.

### Wipe dei volumi Docker (2026-05-08)
**Problema**: Resize del disco virtuale di Docker → tutti i volumi cancellati, incluso il database Supabase locale (~15k review legacy + dati operativi). I volumi NON sono nella cartella di progetto, vivono in Docker.
**Recupero**: ricreato lo stack con `supabase start` + applicato migration + rieseguito `bun run scripts/migrate.ts` per i dati legacy Salsamenteria. Lezione: Supabase Cloud free come backup remoto + `pg_dump` periodico.

## Evoluzione architetturale

### Modularizzazione edge functions (2026-03-18)
Estratti moduli condivisi in `supabase/functions/_shared/`:
- `token-usage.ts` — tracking aggregato token OpenAI (era duplicato in 5 file)
- `batch-polling.ts` — locking, status check OpenAI, download output (era duplicato in 3 poll functions)

### Modularizzazione componenti admin (2026-03-18)
Componenti admin troppo grandi (~1000+ LOC) smontati in sotto-componenti:
- `AIConfigPanel.tsx` → `ai-config-types.ts`, `cost-calculation.ts`, `ProviderConfigTab.tsx`
- `BusinessDetailView.tsx` → `BusinessEditor.tsx`
