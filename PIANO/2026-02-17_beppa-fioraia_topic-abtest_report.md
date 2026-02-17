# Beppa Fioraia - Topic Extraction A/B Test (2026-02-17)

## Obiettivo
Valutare se sostituire `gpt-4.1` con `gpt-5-mini-2025-08-07` per estrazione topic/categorizzazione su recensioni reali.

## Dataset
- Business: Beppa Fioraia
- Review con testo usate: 250
- File input: `/Users/garethjax/code/digital-matrix-monorepo26/scripts/data/beppa-fioraia-reviews-sample-250.json`

## Configurazione comune
- Prompt settore: Ristorazione
- Categorie: Altro, Cibo, Generale, Locale, Percezione, Personale, Prezzo, Problemi, Senza Commenti, Servizio, Vino
- Regola sentiment esplicita: 1=molto negativo ... 5=molto positivo
- Output strutturato JSON schema
- Modalita: Batch API

## Run eseguite

### 1) Baseline vs Candidate default (stabilized)
- Baseline batch: `batch_6994837af2248190a96356f4c03eda77` (completed 250/250)
- Candidate batch (retry riuscito): `batch_699493a9b16881909622ea3e97bf3a2e` (completed 250/250)
- Report: `/Users/garethjax/code/digital-matrix-monorepo26/scripts/reports/topic-compare-batch-gpt4.1-vs-gpt5mini-beppa-250-stabilized-retry2.json`

Risultati principali:
- both_success: 250/250
- avg_abs_sentiment_delta: 0.052
- avg_jaccard topic: 0.0843
- avg_common_topics: 0.636
- token totali:
  - baseline: 157,632
  - candidate: 414,698

### 2) Candidate con costo ridotto (`reasoning_effort=minimal`, `verbosity=low`)
- Candidate batch finale: `batch_6994c178519c81908c7df74f9e74deb7` (completed 250/250)
- Report: `/Users/garethjax/code/digital-matrix-monorepo26/scripts/reports/topic-compare-batch-gpt4.1-vs-gpt5mini-beppa-250-minreason-lowverb-retry3.json`

Risultati principali:
- both_success: 250/250
- avg_abs_sentiment_delta: 0.044
- avg_jaccard topic: 0.0424
- avg_common_topics: 0.328
- token totali:
  - baseline: 157,632
  - candidate: 177,579

Delta token candidate vs run default:
- 414,698 -> 177,579
- Riduzione: -237,119 token (-57.18%)

## Categorizzazione (dal run default 250)
Riferimento: `/Users/garethjax/code/digital-matrix-monorepo26/scripts/reports/topic-compare-batch-gpt4.1-vs-gpt5mini-beppa-250-stabilized-retry2.json`

- Overlap categorie per review (Jaccard medio): 0.817
- Zero-overlap categorie: 0 review
- Topic con stesso nome e stessa categoria: 150/159 (94.3%)

## Nota operativa su Batch API
Durante i test su `gpt-5-mini-2025-08-07` alcuni batch sono rimasti a lungo in `in_progress` con `completed=0` prima di partire realmente.
Strategia efficace usata: rilancio candidate batch con stesso input file fino a scheduling su nodi piu veloci.

## Decisione finale
Per ora **restare su `gpt-4.1` in produzione** per estrazione topic/categorizzazione.

Motivi principali:
- comportamento piu stabile come riferimento storico del sistema
- nel confronto, il candidate mostra differenze lessicali elevate sui topic
- anche ottimizzando (`minimal + low`), il guadagno costo riduce l'overlap topic rispetto al baseline

## File/script usati nel test
- `/Users/garethjax/code/digital-matrix-monorepo26/scripts/compare-topic-extraction.ts`
- `/Users/garethjax/code/digital-matrix-monorepo26/scripts/compare-topic-extraction-batch.ts`
- `/Users/garethjax/code/digital-matrix-monorepo26/package.json`
