# Piano Deploy MVP (Vercel + Supabase)

## Obiettivo
Deploy MVP a costo minimo, mantenendo affidabili i job ricorrenti e riducendo le invocazioni inutili quando il sistema e' idle.

## Contesto attuale monorepo
- Frontend Astro SSR con adapter Vercel (`apps/web/astro.config.mjs`)
- Backend su Supabase (Postgres + Edge Functions + Auth + RLS)
- Orchestrazione pipeline gia' basata su `pg_cron` + `pg_net`

## Raccomandazione deploy
- Frontend: Vercel (Hobby per MVP)
- Backend: Supabase (Free per MVP, con monitoraggio quote)
- DNS: Cloudflare, subdomain `preview.mindigger.it` puntato al frontend

## Strategia cron per MVP
Principio: tenere sempre attivi solo i cron ricorrenti di business, e rendere i poll "event-driven".

- Cron sempre attivi:
  - `weekly-scraping` (settimanale)
  - `monthly-scraping` (mensile)
  - `botster-cleanup` (settimanale)
- Cron di polling:
  - restano schedulati ogni minuto
  - ma chiamano Edge Functions solo se `WHERE EXISTS` trova lavoro attivo

Implementato in migration:
- `supabase/migrations/013_event_driven_polling.sql`

## Regole event-driven introdotte
- `poll-scraping-jobs`: invoca `scraping-poll` solo se esistono `scraping_configs` in `elaborating/checking`
- `analysis-submit`: invoca solo se esistono review `pending` o `analyzing` stale (>24h)
- `analysis-poll`: invoca solo se esistono `ai_batches` review `in_progress`
- `swot-poll`: invoca solo se esistono `ai_batches` swot `in_progress`

## UX operativa MVP
- Pulsante manuale "Check now" in admin per forzare il controllo immediato dello stato job
- Poll automatico a basso impatto come rete di sicurezza
- Nessun polling aggressivo lato frontend quando non ci sono processi attivi

## Quote/costi: approccio pragmatico
- Inizio su Free (Vercel + Supabase)
- Monitoraggio settimanale:
  - invocazioni Edge Functions
  - tempo esecuzione funzioni lunghe
  - storage database
- Upgrade solo al superamento soglie operative

## Checklist go-live
1. Configurare env vars su Vercel e Supabase (API keys, URL, anon key, service role dove richiesto)
2. Applicare migration fino a `013_event_driven_polling.sql`
3. Verificare variabili DB usate dai cron:
   - `app.settings.functions_url`
   - `app.settings.service_role_key`
4. Eseguire test end-to-end:
   - trigger scraping manuale
   - transizione stati fino a completamento
   - submit/poll analisi AI
   - esecuzione cron settimanale/mensile in staging
5. Puntare `preview.mindigger.it` al progetto Vercel via Cloudflare

## Trigger per passare a piani paid
- Cron/queue rallentano oltre SLA operativo
- Invocazioni Edge Function vicine ai limiti free
- Necessita' di timeout maggiore per job complessi
- Requisiti di affidabilita' superiore (niente pause ambiente free)

## To-do post deploy (prima di introdurre cache dashboard)
1. Testare su ambiente `preview.mindigger.it` la latenza percepita nel cambio location.
2. Testare la latenza percepita quando si applicano/rimuovono filtri dashboard.
3. Misurare tempi medi e p95 per:
   - cards + chart (blocco alto dashboard)
   - lista recensioni (pagina da 20 righe)
4. Decidere solo dopo test se introdurre cache client-side:
   - cache lunga per cards/chart
   - cache breve per lista recensioni
5. Se il ritardo e' accettabile, lasciare MVP senza caching aggiuntivo.
