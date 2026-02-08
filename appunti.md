# Appunti per restyling del progetto mindigger.

Ecco un documento di sintesi descrittiva, strutturato per essere utilizzato come Brief di Progetto o System Prompt per discutere lo sviluppo con collaboratori umani o altre IA.

💎 Progetto: Mind Digger
Concept: Data Orchestration & AI Insights for Online Reputation

1. Visione del Progetto
Mind Digger è una piattaforma di analisi avanzata delle recensioni online (Booking, Google Maps, TripAdvisor, Trustpilot). Il sistema non si limita a raccogliere dati, ma "scava" nelle opinioni degli utenti per estrarre audit strategici e report qualitativi per i proprietari di business.

L'obiettivo attuale è un refactoring radicale per passare da un'architettura a microservizi sovradimensionata (eredità tecnica complessa) a un modello Lean & Serverless, ottimizzando i costi operativi e la velocità di esecuzione.

2. Lo Shift Architetturale
Il progetto sta migrando da un'impostazione "Enterprise Heavy" a una "API-First Orchestration":

Legacy (Dismissed): Backend in Python/Django, Gateway Kong, gestione task con Celery, Frontend in React. Una struttura a microservizi che generava un overhead di manutenzione eccessivo per un team snello.

Target (Mind Digger 2.0): * Frontend: Astro (SSR + Islands Architecture) per massimizzare le performance e la velocità di caricamento della dashboard.

Backend as a Service: Supabase per la gestione di Database (PostgreSQL), Autenticazione e Logica Edge.

Data Ingestion: Integrazione via API di servizi di scraping di terze parti (agnostici dal linguaggio).

AI Engine: OpenRouter (per l'accesso flessibile a Gemini e GPT-4) come motore di analisi del sentiment e generazione report.

3. Workflow di Analisi (The Pipeline)
Mind Digger opera come un orchestratore intelligente:

Ingestion: Il sistema interroga API di scraping esterne per ottenere dati grezzi (JSON) su specifici business.

Storage: I dati grezzi vengono salvati in Supabase (JSONB) per mantenere uno storico immutabile dell'audit.

Processing: Tramite Edge Functions (TypeScript), i dati vengono sintetizzati e inviati a OpenRouter (Gemini) per l'analisi semantica.

Delivery: Il cliente consulta i risultati su una dashboard scattante in Astro e può scaricare un report PDF generato automaticamente.

4. Stack Tecnologico di Riferimento
Frontend Framework: Astro (scelto per la capacità di mixare componenti statici e isole interattive).

Database & Serverless: Supabase (PostgreSQL + Edge Functions).

LLM Gateway: OpenRouter (Model: Gemini/GPT-4).

External Services: API di scraping (3rd party), API di generazione PDF.

5. Obiettivi Strategici (Q1 2026)
Validazione Audit: Vendita di report di audit mirati a una cerchia selezionata di utenti (basso volume, alto valore).

Costi Fissi Zero: L'intera infrastruttura deve scalare "a consumo". Se non ci sono audit in corso, i costi di mantenimento devono essere vicini allo zero.

Agilità: Capacità di cambiare modello di linguaggio o fonte di scraping semplicemente aggiornando una chiamata API, senza riscrivere la logica core del sistema.

Note per lo Sviluppatore / LLM
Quando analizzi Mind Digger, considera la priorità assoluta: la semplicità. Ogni componente aggiunto deve giustificare la sua esistenza in termini di ROI e velocità di consegna. Non stiamo costruendo un'infrastruttura per milioni di utenti contemporanei, ma un sistema di precisione per generare insight di alta qualità nel minor tempo possibile.




# cartelle di progetto collegate.

- /Users/garethjax/code/trustpilot: script per l'acquisizione di recensioni da trustpilot (usato stand alone, da pianificare integrazione nel software principale)
- /Users/garethjax/code/mappe-digitalmatrix: widget web che si interfaccia con vari servizi per acquisire i dati per lo scraping (usato nell'interfaccia admin)
- /Users/garethjax/code/mindigger_back: backend del progetto Mindigger
- /Users/garethjax/code/mindigger-client: frontend del progetto Mindigger.

---

# 📋 Planning Refactoring: Dashboard Review Analysis (Audit Phase)

## 1. Visione del Prodotto

Semplificare l'infrastruttura eliminando il debito tecnico dei microservizi a favore di un'architettura **Serverless & API-First**. Il sistema deve fungere da orchestratore tra fornitori di dati (Scraping API) e fornitori di intelligenza (OpenRouter/Gemini), minimizzando i costi fissi e la manutenzione.

---

## 2. Shift Tecnologico (Stack Comparison)

| Componente | Architettura Attuale (Legacy) | Nuova Architettura (Target) |
| --- | --- | --- |
| **Frontend** | React (Heavy SPA) | **Astro (SSR + Islands)** |
| **Backend** | Django + Python + Celery | **Supabase (Edge Functions)** |
| **API Gateway** | Kong | **Nativo (Supabase Auth/RLS)** |
| **Data Engine** | Scraping Interno / Microservizi | **3rd Party API + OpenRouter** |
| **Infrastruttura** | Server/Container gestiti | **Serverless (Vercel/Supabase)** |

---

## 3. Requisiti Funzionali

### A. Core Data Pipeline (Orchestrazione)

* **Ingestion:** Chiamata al servizio di scraping tramite parametri configurati (URL, fonte).
* **Storage Raw:** Salvataggio del JSON grezzo in PostgreSQL (`JSONB`) per auditabilità.
* **Analysis:** Invio dei dati puliti a **OpenRouter (Gemini)** per estrazione sentiment e reportistica testuale.
* **Persistence:** Salvataggio del report finale strutturato nel DB.

### B. User Dashboard (Consultazione)

* Visualizzazione scattante dei dati tramite **Astro SSR**.
* Grafici interattivi (Isole di interattività) per mostrare i trend delle recensioni.
* Sistema di login semplificato (Magic Link o Email/Password via Supabase).

### C. Admin Dashboard (Configurazione)

* Interfaccia per inserire nuovi business da analizzare.
* Monitoraggio dei crediti/costi delle API esterne per ogni audit.

### D. Export & Reporting

* Generazione di un report PDF scaricabile basato sull'analisi dell'LLM.

---

## 4. Roadmap di Implementazione (Sprint Plan)

### **Fase 1: Fondamenta & Data Model (Settimana 1)**

* Setup progetto **Supabase** e definizione schema DB (Tabelle: `Aziende`, `Audit`, `Recensioni`).
* Configurazione delle **Row Level Security (RLS)** per isolare i dati tra diversi clienti.
* Setup di **Astro** con integrazione Supabase.

### **Fase 2: Orchestrazione API (Settimana 2)**

* Sviluppo della prima **Edge Function** in TypeScript:
* `fetchAndAnalyze`: Innesca lo scraping -> Invia a OpenRouter -> Salva su DB.


* Ottimizzazione del **Prompt Engineering** per Gemini su OpenRouter per garantire output JSON coerenti.

### **Fase 3: UI & Visualizzazione (Settimana 3)**

* Sviluppo delle pagine di consultazione in Astro.
* Integrazione di una libreria di grafici leggera (es. *Chart.js* o *ApexCharts*).
* Sviluppo del modulo di generazione PDF (lato client o via API esterna).

### **Fase 4: Testing & Lancio Audit (Settimana 4)**

* Test end-to-end sul flusso di un audit reale.
* Monitoraggio latenze e costi API.
* Apertura accesso ai primi utenti selezionati.

---

## 5. Analisi dei Costi (Proiezione)

Il costo dell'infrastruttura seguirà una funzione lineare rispetto agli audit venduti:


* **Hosting:** ~0€ (Piano gratuito Vercel/Supabase per bassi volumi).
* **Scraping:** Variabile a consumo (già previsto).
* **AI (OpenRouter):** Estremamente basso con Gemini (ordine di pochi centesimi per audit).

---

## 6. Rischi e Mitigazioni

* **Rischio:** Variazione del formato JSON del fornitore di scraping.
* **Mitigazione:** Salvataggio del `raw_data` per permettere il ri-processamento senza dover ri-acquistare i dati.
* **Rischio:** Latenza delle Edge Functions durante analisi lunghe.
* **Mitigazione:** Implementazione di uno stato "In Elaborazione" nella dashboard con polling o sottoscrizione Real-time di Supabase.

---

> **Nota dell'AI:** Questo piano trasforma un sistema complesso in una "macchina da audit" snella. Eliminando Kong e Django, riduciamo i punti di fallimento e il tempo di sviluppo.
