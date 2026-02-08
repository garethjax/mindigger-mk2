# Dubbi e Proposte Codex sul Piano di Refactoring

Documento di supporto per revisione con Claude Opus 4.6.

## Decisioni gia' allineate

1. Migrazione autenticazione: non migrare le password legacy.
2. Migrare invece i dati ad alto valore:
   - configurazioni business/location
   - scraping configs
   - recensioni e analisi collegate
3. Flusso utenti post-migrazione:
   - reset password tramite email/magic link al primo accesso
   - eventuale comunicazione diretta agli utenti interni/esterni

## Dubbi da validare con Claude

1. Schema operativo scraping jobs
   - Nel piano si usa `status='elaborating'` nei poll, ma non e' esplicitato in modo forte il modello stati e metadati job.
   - Domanda: conviene formalizzare subito campi minimi (`status`, `external_job_id`, `retry_count`, `last_error`, `next_poll_at`)?

2. Concorrenza e idempotenza cron
   - `scraping/poll`, `analysis/submit`, `analysis/poll` girano ogni minuto.
   - Domanda: quale strategia minima adottare per evitare doppie elaborazioni (locking SQL, dedup key, claim atomico dei record)?

3. Boundary sicurezza con `service_role`
   - Il piano dice che le Edge Functions usano `service_role` (bypass RLS).
   - Domanda: quali funzioni devono usarlo davvero, e quali no?
   - Domanda: serve audit log obbligatorio per operazioni critiche admin/backoffice?

4. Tempistiche e ordine migrazione
   - Migrazione dati prevista tardi (settimane 9-10) ma potrebbe essere piu' veloce.
   - Domanda: conviene anticipare un dry-run di migrazione dati in fase iniziale per ridurre rischio di incompatibilita' tardive?

5. Assunzione `initial_scrape_done`
   - Nel piano schedulato si assume che sia gia' `true`.
   - Domanda: come gestire location appena create o migrate che non hanno fatto primo scraping?

## Proposte concrete da integrare nel piano

1. Aggiornare Fase 7 (migrazione auth)
   - Sostituire "utenti legacy possono loggarsi" con:
     - "utenti legacy possono completare reset password e accedere"
   - Esplicitare che password hash legacy non viene migrato.

2. Guardrail costi operativi
   - Definire limiti: max job scraping per giorno, max reviews per run, max batch AI per ora.
   - Definire stop automatico o alert al superamento soglie.

3. Osservabilita' minima
   - Log strutturati per ogni job/batch.
   - Metriche minime: success rate, errore, durata, backlog.
   - Alert base su failure ripetuti o backlog in crescita.

4. Policy minima `service_role`
   - Consentito solo per funzioni cron/backoffice.
   - Endpoints admin con controllo ruolo `admin`.
   - Audit log per trigger scraping, cambio provider AI, import dati.

5. Cutover pragmatico
   - Eseguire dry-run migrazione anticipato.
   - Preparare checklist go-live/rollback snella.

## Nota operativa

Priorita' immediata: formalizzare la strategia auth (gia' decisa) e far validare a Claude i punti 1-2-4 della sezione "Dubbi da validare", perche' impattano direttamente la stabilita' del rollout.
