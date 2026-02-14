# Piano: Sector & Prompt Builder in Regia

**Stato:** Da implementare
**Priorita:** Media (non blocca operativita' corrente, migliora scalabilita' onboarding)
**Ispirazione:** `mindigger-evolved/mindigger/ui/pages/scopes.py` + `prompts.py`

---

## Contesto

Oggi i settori (`business_sectors`) e le categorie (`categories`) sono seedati via migration SQL e non modificabili da UI. Il prompt di analisi AI e' hardcoded in `analysis-submit/index.ts`. Per aggiungere un nuovo settore o personalizzare le categorie bisogna toccare il codice.

Nel tool Python originale (`mindigger-evolved`) esisteva un builder che permetteva di:
- Creare/modificare settori con le loro categorie
- Gestire versioni di prompt personalizzabili per settore
- Fare merge automatico di: prefisso settore + categorie + prompt generico + prompt custom

Obiettivo: portare questa capacita' nell'admin Regia del monorepo.

---

## Architettura

### Schema DB (1 migration)

```sql
-- Aggiungere colonne a business_sectors
ALTER TABLE business_sectors
  ADD COLUMN description TEXT,
  ADD COLUMN prompt_template TEXT;  -- override del prompt generico, nullable

-- prompt_template contiene il prompt custom per il settore.
-- Se NULL, analysis-submit usa il prompt default hardcoded.
-- Variabili supportate: {{sectorName}}, {{categories}}
```

Nessuna tabella nuova. `business_sectors` e `categories` esistono gia' con RLS admin pronto.

### Flusso prompt in analysis-submit

```
1. Leggi business_sectors.prompt_template per il settore
2. Se presente:
   - Sostituisci {{sectorName}} e {{categories}} nel template
   - Usa come system prompt
3. Se NULL:
   - Usa buildSystemPrompt() corrente (default hardcoded)
```

---

## Componenti UI

### Pagina: `/regia/sectors` (nuova)

Lista settori con:
- Nome, piattaforme abilitate, numero categorie, numero business associati
- Azioni: Modifica, (Elimina solo se nessun business associato)
- Bottone "Nuovo Settore"

### Componente: `SectorEditor.tsx` (nuovo)

Form di creazione/modifica settore con sezioni:

**Sezione 1 — Dati base**
- Nome settore (text)
- Descrizione (textarea, opzionale)
- Piattaforme (multi-select: google_maps, tripadvisor, booking)

**Sezione 2 — Categorie**
- Lista editabile delle categorie del settore
- Per ogni categoria: nome + bottone rimuovi
- Input + bottone "Aggiungi categoria"
- Nota: "Senza Commenti" e "Altro" sono raccomandate come categorie di default

**Sezione 3 — Prompt AI (opzionale)**
- Textarea con il prompt template personalizzato
- Placeholder/hint con le variabili disponibili: `{{sectorName}}`, `{{categories}}`
- Bottone "Carica default" che popola la textarea con il prompt generico corrente
- Preview live del prompt risultante (merge template + variabili)
- Se vuoto: usa il prompt generico di sistema (comportamento attuale)

---

## Task breakdown

### Task 1 — Migration DB (Claude)
- File: `supabase/migrations/010_sector_prompt_template.sql`
- ALTER TABLE `business_sectors` ADD COLUMN `description TEXT`, `prompt_template TEXT`
- Nessun seed: i 6 settori esistenti restano con `prompt_template = NULL` (usano il default)

### Task 2 — Pagina Astro + componente lista settori (Codex-friendly)
- File: `apps/web/src/pages/regia/sectors/index.astro`
- Componente: `apps/web/src/components/admin/SectorList.tsx`
- Query: `business_sectors` con count categorie e count business
- Puro UI read-only + link a editor
- **Codex-friendly:** componente isolato, nessuna dipendenza da ambiente live

### Task 3 — SectorEditor con CRUD categorie (Codex-friendly per UI, Claude per integrazione)
- File: `apps/web/src/components/admin/SectorEditor.tsx`
- Sezioni 1-2 (dati base + categorie)
- CRUD via Supabase client: insert/update `business_sectors`, insert/delete `categories`
- **Codex-friendly per la parte UI/form**, Claude per test integrazione DB

### Task 4 — Prompt builder UI (Claude)
- Sezione 3 del SectorEditor: textarea template + preview merge
- Logica di sostituzione variabili `{{sectorName}}` e `{{categories}}`
- Salvataggio in `business_sectors.prompt_template`

### Task 5 — Integrazione analysis-submit (Claude)
- Modificare `buildSystemPrompt()` in `analysis-submit/index.ts`:
  - Leggere `prompt_template` dal settore
  - Se presente: fare replace di `{{sectorName}}` e `{{categories}}`
  - Se NULL: usare il prompt hardcoded corrente
- Aggiungere la query del settore nella pipeline (gia' abbiamo `sectorId`)

### Task 6 — Test end-to-end (Claude)
- Creare un settore di test con prompt custom
- Sottomettere review per analisi
- Verificare che il prompt custom venga usato
- Verificare che il fallback al default funzioni

---

## Spec per Codex — Task 2: SectorList

**Branch:** `feat/sector-builder`

**File da creare:**
- `apps/web/src/pages/regia/sectors/index.astro`
- `apps/web/src/components/admin/SectorList.tsx`

**Layout:** Seguire pattern identico a `/regia/businesses` (vedi `apps/web/src/pages/regia/businesses/index.astro`)

**Query Supabase:**
```typescript
const { data: sectors } = await supabase
  .from("business_sectors")
  .select("id, name, platforms, description, created_at, categories(count)")
  .order("name");
```

**UI:**
- Tabella con colonne: Nome, Piattaforme (badge per ognuna), N. Categorie, Azioni
- Ogni riga ha link a `/regia/sectors/[id]` (pagina editor, Task 3)
- Bottone "Nuovo Settore" in alto a destra
- Stile Tailwind coerente con le altre pagine Regia

**Navigazione:** Aggiungere link "Settori" nel menu Regia (vedi `apps/web/src/components/admin/` per il pattern nav)

---

## Spec per Codex — Task 3: SectorEditor (UI shell)

**File da creare:**
- `apps/web/src/pages/regia/sectors/[id].astro`
- `apps/web/src/components/admin/SectorEditor.tsx`

**Props:**
```typescript
interface Props {
  sector?: {
    id: string;
    name: string;
    description: string | null;
    platforms: string[];
    prompt_template: string | null;
  };
  categories?: { id: string; name: string }[];
  isNew: boolean;
}
```

**Sezione 1 — Dati base:**
- Input nome (required)
- Textarea descrizione
- Multi-checkbox piattaforme: `google_maps`, `tripadvisor`, `booking`

**Sezione 2 — Categorie:**
- Lista delle categorie esistenti, ciascuna con bottone X per rimuovere
- Input + bottone "Aggiungi" per nuova categoria
- Stato locale (array), salvataggio batch al submit

**Sezione 3 — Prompt (textarea semplice per ora):**
- Textarea per `prompt_template`, label "Prompt AI personalizzato (opzionale)"
- Help text: "Variabili disponibili: {{sectorName}}, {{categories}}. Lascia vuoto per usare il prompt di sistema."

**Bottoni:**
- "Salva" (primary)
- "Annulla" (secondary, torna a lista)

**Non deve:** fare chiamate Supabase reali. Usare `onSave(data)` callback prop.
Claude integrera' le chiamate DB in fase di integrazione (Task 4-5).

---

## Rischi e note

- **Categorie orfane:** eliminare una categoria che ha `review_categories` associate richiede conferma + cascade o soft-delete. Per v1: impedire eliminazione se ci sono review_categories collegate.
- **Prompt injection:** il template viene usato come system prompt OpenAI. Non e' un rischio diretto (solo admin scrive), ma validare che non contenga placeholders non supportati.
- **Retrocompatibilita':** settori esistenti con `prompt_template = NULL` usano il default. Zero breaking change.
- **Costo re-analisi:** cambiare il prompt di un settore non ri-analizza automaticamente le review esistenti. Serve azione esplicita dall'admin (gia' disponibile in AI Config > batch admin).
