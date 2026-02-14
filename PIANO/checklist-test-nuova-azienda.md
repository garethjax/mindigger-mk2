# Checklist: Test inserimento nuova azienda + location

Obiettivo: verificare il flusso completo di onboarding di una nuova azienda nel sistema, dalla creazione in admin fino alla visualizzazione dei dati in dashboard.

## Pre-requisiti

- [X] Dev environment attivo (`./dev.sh` completato senza errori)
- [X] Verificare che i health checks siano passati (service_role_key, ai_configs, OPENAI_API_KEY)
- [X] Login come admin: `admin@mindigger.it` / `admin123`
- [X] Verificare che Supabase Studio sia raggiungibile: http://127.0.0.1:54323

## 1. Creazione azienda

- [X] Navigare a Regia > Aziende (`/regia/businesses`)
- [X] Click "Nuova Azienda"
- [X] Compilare: nome, tipo (organization/agency), ragione sociale, email, referente
- [X] Verificare che l'azienda compaia nella lista

## 2. Creazione utente business

- [X] Navigare a Regia > Utenti (`/regia/users`)
- [X] Click "Crea Utente"
- [X] Compilare: email, password, nome completo, ruolo `business`, associare all'azienda appena creata
- [X] Verificare che l'utente compaia nella lista utenti
- [X] Verificare che l'utente compaia anche nel dettaglio azienda (campo "Utenti")

## 3. Aggiunta location

- [X] Navigare al dettaglio azienda (`/regia/businesses/[id]`)
- [X] Click "+ Aggiungi Location"
- [X] Compilare: nome, settore (scegliere tra quelli disponibili), flag competitor se necessario
- [X] Verificare che la location compaia nella sezione Location
- [X] Ripetere per almeno 2 location (una principale, una competitor)

## 4. Configurazione scraping

- [X] Per ogni location, verificare che le piattaforme del settore siano disponibili
- [X] Configurare almeno una piattaforma (es. Google Maps con `place_id`, TripAdvisor con `location_url`)
- [X] Nota: i `place_id` Google si trovano su https://developers.google.com/maps/documentation/places/web-service/place-id
- [X] Verificare che lo stato sia "Idle" dopo la configurazione

## 5. Test scraping / import recensioni

- [X] Opzione A: click "Avvia Scraping rapido" per una piattaforma configurata
- [X] Verificare che lo stato passi a "In corso"
- [X] Attendere completamento e verificare che le recensioni appaiano nel conteggio
- [X] Opzione B (no nuovi crediti Botster): click "Importa recensioni" e caricare export JSON della piattaforma
- [X] Verificare messaggio di esito import (review lette/inserite)
- [X] Verificare che il conteggio recensioni azienda/location aumenti dopo import

## 5B. Test pipeline AI post-import (batch OpenAI)

- [ X] Verificare stato code prima del submit:
  - [X ] `ai_batches` reviews non deve avere job duplicati in `in_progress` (o documentare quelli esistenti)
  - [X ] `reviews` deve avere righe `pending` dopo import
- [X ] Eseguire `analysis-submit` one-shot (manuale) e verificare risposta `200` senza errori schema
- [X ] Verificare creazione nuovi batch `reviews` in `ai_batches` con `status = in_progress`
- [X ] Eseguire `analysis-poll` one-shot (manuale) e verificare avanzamento stati (`validating/finalizing/completed/failed`)
- [X ] Se batch `failed`: scaricare `error_file` da OpenAI e classificare causa (schema, rate limit, payload, etc.)
- [X ] Verificare che le review passino da `pending`/`analyzing` a `completed`
- [X ] Verificare popolamento `topic_scores` e campi AI in `reviews.ai_result`

## 6. Test dashboard utente

- [X ] Logout da admin
- [X ] Login come utente business appena creato
- [X ] Verificare che la dashboard Analytics (`/analytics`) mostri i dati corretti
- [X ] Verificare i filtri:
  - [X ] **Sedi**: cambiare location, i dati si aggiornano
  - [X ] **Argomento**: selezionare una categoria, stats + grafici + lista recensioni si filtrano
  - [X ] **Argomento > "Tutti gli argomenti"**: torna ai dati completi (grafici inclusi)
  - [X ] **Piattaforma**: filtrare per source
  - [X ] **Rating**: toggle singole stelle
  - [X ] **Date**: cambiare intervallo, verificare che il conteggio cambi
- [X ] Verificare i grafici: Andamento Recensioni e Distribuzione Recensioni si renderizzano

## 7. Test CSV download (admin)

- [X] Login come admin
- [X ] Navigare al dettaglio azienda
- [X ] Click "Download recensioni" su una location con dati
- [X ] Verificare che il CSV si scarichi
- [X ] Aprire il CSV in Excel/Numbers: verificare che le colonne siano corrette e il testo non sia spezzato
- [X ] Verificare encoding: caratteri accentati (e, a, u) devono apparire correttamente

## 8. Test SWOT (se OPENAI_API_KEY configurata)

- [ ] Login come utente business
- [ ] Navigare a SWOT (`/swot`)
- [ ] Click "Nuova Analisi SWOT" (`/swot/create`)
- [ ] Selezionare location e periodo, confermare
- [ ] Verificare che appaia "In analisi" (non "Analisi creata ma invio fallito")
- [ ] Attendere completamento (1-5 minuti, dipende dal batch OpenAI)
- [ ] Verificare che la SWOT completata mostri i 4 quadranti + spunti operativi

## Bug noti da verificare (regressioni)

- [ ] **max_rows**: con date range ampio (es. dal 2008), il conteggio non deve essere troncato a 1000
- [ ] **Grafici vuoti**: dopo cambio filtro argomento e ritorno a "Tutti gli argomenti", i grafici devono avere dati
- [ ] **JWT edge functions**: le chiamate da browser a edge functions non devono dare "Invalid JWT"

## Note per la sessione

- Il branch attuale e' `main` con tutti i fix mergiati
- Se servono dati di test, la migrazione legacy si lancia con:
  ```
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." bun run scripts/migrate.ts
  ```
- I file di configurazione critica sono documentati in `CLAUDE.md` alla root del progetto
- Lo scraping richiede URL/place_id reali delle piattaforme per funzionare

## 9. Import da file JSON (nuovo flusso)

- [X] Nel dettaglio location e piattaforma e' disponibile il bottone **"Importa recensioni"**
- [X] L'import accetta file JSON export Botster (Google Maps / TripAdvisor)
- [X] L'import usa dedup su `review_hash` e inserisce nuove recensioni con stato `pending`
- [X] Dopo import la pipeline AI parte tramite `analysis-submit` schedulato oppure one-shot manuale
- [X] Verificare in Regia > AI Config che partano i batch OpenAI per recensioni importate
- [X] Verificare che, a polling completato, le recensioni passino a `completed` con topic/categorie valorizzati
