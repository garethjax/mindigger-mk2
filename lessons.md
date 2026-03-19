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

## Evoluzione architetturale

### Modularizzazione edge functions (2026-03-18)
Estratti moduli condivisi in `supabase/functions/_shared/`:
- `token-usage.ts` — tracking aggregato token OpenAI (era duplicato in 5 file)
- `batch-polling.ts` — locking, status check OpenAI, download output (era duplicato in 3 poll functions)

### Modularizzazione componenti admin (2026-03-18)
Componenti admin troppo grandi (~1000+ LOC) smontati in sotto-componenti:
- `AIConfigPanel.tsx` → `ai-config-types.ts`, `cost-calculation.ts`, `ProviderConfigTab.tsx`
- `BusinessDetailView.tsx` → `BusinessEditor.tsx`
