# Mind Digger 2.0: Versione Executive (CEO / CFO / CMO)

Questo documento e' una lettura "non tecnica" del refactoring di Mind Digger verso la nuova piattaforma (Supabase + Astro + Edge Functions). L'obiettivo e' chiarire cosa c'e' dietro la dashboard e perche' il progetto e' piu' sofisticato di quanto sembri guardando solo l'interfaccia.

## 1) Executive Summary (1 pagina)

Mind Digger 2.0 non e' solo una nuova dashboard: e' un sistema completo che automatizza un ciclo end-to-end:
1. acquisisce recensioni da piu' piattaforme (scraping controllato e schedulato),
2. deduplica e normalizza dati (qualita' e consistenza),
3. arricchisce i contenuti con AI (sentiment, categorie, topic, SWOT),
4. rende i risultati navigabili (filtri, grafici, liste),
5. abilita export e comunicazioni (PDF/DOCX, email, report periodici),
6. controlla costi, accessi e sicurezza (RLS, ruoli, tracciamento token).

Il vantaggio principale e' passare da un'app "monolitica" (piu' costosa e fragile da mantenere) a un'architettura modulare e scalabile con costi piu' prevedibili, tempi di delivery rapidi e minori rischi operativi.

## 2) Quello che si vede vs quello che succede davvero

### Quello che vede l'utente
- una pagina Analytics con filtri (periodo, sede, piattaforma, rating),
- KPI e grafici,
- lista recensioni con topic e link originali,
- creazione/consultazione SWOT.
- export dati (download recensioni processate, export SWOT, "scarica vista").

### Quello che deve succedere dietro le quinte
- autenticazione e permessi multi-tenant (ogni cliente vede solo i propri dati),
- ingestione dati da sorgenti esterne e normalizzazione,
- pipeline AI affidabile (batch e direct, ritentativi, stati, salvataggio risultati),
- query/aggregazioni veloci (grafici e filtri non devono "inchiodare"),
- osservabilita' e idempotenza (se una cosa fallisce, riparte senza duplicare),
- protezione costi (scraping e AI sono variabili, vanno governati).

## 3) Cosa e' stato convertito: macro-componenti

### Frontend (quello che l'utente usa)
- Astro SSR + Preact islands: performance e SEO, UI reattiva dove serve.
- Dashboard analytics: filtri, KPI, grafici (uPlot), lista recensioni (topic badge, link originali), creazione/dettaglio SWOT.
- Export e condivisione: download recensioni gia' processate, export SWOT, "scarica vista" (dashboard snapshot).
- Admin / Regia (`/regia/*`): gestione utenti/aziende/location (incl. competitor), configurazione scraping (Place ID, URL piattaforme), toggle feature, monitor operazioni.

### Backend (il "motore")
- Database Postgres su Supabase: schema e indici per recensioni, topic, categorie, SWOT, scraping configs.
- Sicurezza dati:
  - RLS (Row Level Security) su tabelle,
  - ruoli (admin / business),
  - funzioni server con service role dove necessario.
- Modello anagrafiche e permessi piu' chiaro:
  - livello agenzia (admin) che amministra,
  - aziende clienti,
  - location per azienda (incluse location competitor).
- Pipeline scraping (Edge Functions + scheduler):
  - trigger manuale,
  - poll schedulato,
  - cleanup job,
  - deduplica e parsing consistente multi-piattaforma.
- Pipeline AI:
  - submit/poll batch,
  - salvataggio output strutturato (categorie, topic, sentiment, traduzioni),
  - analisi SWOT come job asincrono.
- Export e comunicazioni:
  - invio email (report/notification),
  - generazione documenti scaricabili (PDF/DOCX) e allegati.

## 4) Perche' e' sofisticato (ma ha senso)

### 4.1 Multi-sorgente: non esiste una "review API standard"
Ogni piattaforma ha formati, limiti e campi diversi. Il sistema deve:
- mappare campi con fallback,
- gestire date e rating coerentemente,
- deduplicare (stessa recensione puo' riapparire),
- preservare raw data per audit e debugging.

### 4.2 Multi-tenant: ogni cliente deve vedere solo il suo
Non basta "mettere un login": serve un modello dati e permessi rigorosi.
RLS evita errori umani e bug applicativi che potrebbero esporre dati di altri clienti.

### 4.3 AI "operativa": non e' una demo
Portare AI in produzione implica:
- cost governance (batch economico vs direct veloce),
- gestione stati e ritentativi,
- validazione output (schema coerente, niente garbage),
- tracciamento token e costi per business.

### 4.4 Performance: dashboard non deve diventare lenta con 100k recensioni
Servono:
- indici e query ottimizzate,
- aggregazioni temporali (giorno/settimana/mese),
- caching dove opportuno,
- evitare di scaricare "tutto" sul browser.

## 5) Export e "Scarica vista": cosa significa in pratica

### Download recensioni processate (re-processing)
Un export pensato per "portare fuori" dati gia' puliti e arricchiti (AI result, topic, categorie) e riprocessarli con strumenti esterni (BI, analisi custom, agent, ecc.).

Perche' e' importante:
- evita di rieseguire scraping/AI solo per ottenere un dataset rielaborabile,
- accelera analisi ad hoc (es. audit, consulenza, post-processing),
- permette workflow ibridi (Mind Digger come "data refinery", strumenti esterni come "analysis suite").

### SWOT export (due formati, due casi d'uso)
- PDF landscape tipo "presentazione":
  - 5 pagine: Strengths, Weaknesses, Opportunities, Threats, Spunti operativi,
  - ideale per condivisione e meeting.
- DOCX portrait tipo "documento ufficio":
  - stampa/archiviazione,
  - editing interno (note, revisioni).

### "Scarica vista" (dashboard snapshot)
Un bottone che crea un documento statico della vista filtrata corrente:
- riepilogo filtri applicati,
- KPI/TopCards,
- grafici,
- estratto recensioni e topic rilevanti.

Nota: la versione solida non e' uno screenshot, ma un documento generato dagli stessi dati/aggregazioni della UI (riproducibile e auditabile).

## 6) Timeline e deliverable (vista management)

Una roadmap tipica e' composta da fasi:
- schema DB + sicurezza (fondazioni),
- scraping (ingestione dati),
- AI (arricchimento),
- dashboard (valore percepito),
- admin (operazioni e scalabilita'),
- export + email (comunicazione e retention).

Ogni fase produce deliverable verificabili (es. "scraping settimanale automatico", "SWOT completata con export e allegato email").

## 7) Costo e sostenibilita' (CFO-oriented)

Il costo si divide in:
- costi fissi (hosting/DB in free tier o pro),
- costi variabili legati a:
  - scraping (per job),
  - AI (token),
  - embeddings (una tantum + query).

Meccanismi di controllo:
- batch AI quando possibile,
- limitazioni per profondita' scraping (initial vs recurring),
- tracciamento token/usage per business e periodo,
- feature opt-in (es. embeddings).

## 8) Rischi e mitigazioni (CEO/CFO)

Rischi tipici:
- timeouts e job lunghi,
- cambi formato sorgenti,
- costo AI fuori controllo,
- bug di permessi multi-tenant,
- migrazione dati incompleta.

Mitigazioni:
- job asincroni e idempotenti,
- raw_data preservato e mappature robuste,
- usage tracking e policy di default conservative,
- RLS come guardrail,
- validate-migration (count, FK, spot-check).

## 9) Appendix: Cosa interessa a ciascun ruolo

### CMO (Marketing)
- Evidenze: trend per periodo, location, piattaforma, rating.
- "Tema per tema": topic e categorie per capire cosa spinge recensioni positive/negative.
- Materiali condivisibili: export SWOT e "Scarica vista" per report a stakeholder.
- Confronto competitor (se attivo) con filtri coerenti.

### CFO (Finance)
- Costi variabili controllabili (scraping e AI) con usage tracking.
- Riduzione overhead (meno servizi da mantenere, meno incidenti operativi).
- Auditability: raw_data + export riproducibili.
- Scalabilita' senza esplodere i costi fissi.

### CEO (Strategy)
- Piattaforma che diventa "prodotto": multi-tenant, scalabile, vendibile.
- Time-to-market piu' rapido per nuove feature (template export, nuovi report, nuove piattaforme).
- Meno rischio operativo: permessi e pipeline robuste.
- Base per funzionalita' avanzate (ricerca semantica, alerting, automazioni).

## 10) Prossime decisioni (da prendere velocemente)

1. Formati MVP: solo PDF per export SWOT o anche DOCX da subito.
2. Template: look "presentazione" standard (brand) e variante "documento ufficio".
3. "Scarica vista": quali blocchi includere nel primo rilascio (KPI + grafici + top N recensioni).
4. Dove generare i file: Edge Function vs job esterno (dipende da runtime/limiti).
