# Distribuzione Recensioni: Alternative Provate

Contesto: il grafico "Distribuzione Recensioni" aveva i dati (tooltip mostrava valori), ma non renderizzava nulla o renderizzava in modo incoerente. L'obiettivo e' avere un istogramma affidabile e leggibile che si aggiorna con filtri (sedi, piattaforme, stelle) e che resti dentro al canvas.

## Opzione 1: uPlot (line/points) per validare dati e tooltip
- Idea: riusare lo stesso tipo di chart dell'"Andamento" per capire se e' un problema dati o rendering.
- Risultato: i valori erano presenti e il cursor/tooltip reagiva, ma la resa della "Distribuzione" restava non adatta (non e' un istogramma) e il problema originale di visibilita' non risultava risolto in modo chiaro.
- Commit di riferimento: `4752ea1` (riuso `ReviewChart` per distribution).

## Opzione 2: uPlot (tentativi vari) con aggregazione e hardening
- Idea: mantenere uPlot e correggere:
  - parsing date e bucket (`YYYY-MM-DD` vs ISO completo)
  - applicazione rating filters (stelle) anche alla distribuzione
  - serie/ordine e range Y
- Risultato: confermata la presenza dati via RPC; alcuni rendering migliorati, ma la distribuzione non era ancora un istogramma coerente e rimanevano ambiguita' sul perche' le barre non si vedessero stabilmente.
- Commit di riferimento (storici): `1eae334`, `1d5a45b`, `37f0fa8`.

## Opzione 3: Istogramma HTML/CSS (senza uPlot)
- Idea: eliminare l'incertezza del renderer e disegnare barre con layout CSS usando gli stessi dati aggregati della RPC.
- Vantaggi:
  - zero dipendenze dal path builder uPlot
  - debugging facile (DOM + CSS)
  - comportamento prevedibile per "Settimana/Mese"
- Svantaggi:
  - gestione responsive e label overlap richiede logica custom
  - "Giorno" puo' diventare troppo denso (scroll/1px/downsampling)
  - manca di alcune feature native (axes avanzati, ticks, hit testing sofisticato)
- Commit di riferimento: `2708c0d`, `c01c1cb`, `ff29819`, `2110173`, `106ac83`.

## Opzione 4 (SCELTA ATTUALE): uPlot istogramma con `paths.bars`
- Idea: tornare a uPlot ma usando un vero bar chart (`uPlot.paths.bars`) invece di forzare linee/aree.
- Vantaggi:
  - istogramma "vero" dentro al canvas
  - assi e griglia coerenti (inclusi tick ogni 25 via `splits`)
  - tooltip e interazione standard uPlot
  - look & feel piu' consistente con l'altro grafico uPlot
- Decisione: limitare la granularita' a `Settimana` e `Mese` per evitare densita' estrema e sbordi del canvas (la vista `Giorno` e' candidata a una visualizzazione diversa o downsampling).
- Commit di riferimento: `24b25fc` (week/month only), `a6bf775` (uPlot bars).

## Nota su pulizia
- Il renderer CSS (`ReviewDistributionBars.tsx`) e' rimasto nel repo per compatibilita' durante i test; ora non e' piu' usato dopo il passaggio a `ReviewDistributionChart` (uPlot). Se vuoi, lo rimuoviamo in un commit separato per tenere pulito.

