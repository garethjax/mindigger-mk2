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
- Nome, piattaforme abilitate, numero categorie, numero location associate
- Azioni: Modifica (`Elimina settore` deferred post-v1)
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
- File: `supabase/migrations/012_sector_prompt_template.sql` (010 e 011 gia' occupati da cost_tracking e credit_balance)
- ALTER TABLE `business_sectors` ADD COLUMN `description TEXT`, `prompt_template TEXT`
- Nessun seed: i 6 settori esistenti restano con `prompt_template = NULL` (usano il default)

### Task 2 — Pagina Astro + componente lista settori (Codex-friendly)
- File: `apps/web/src/pages/regia/sectors/index.astro`
- Componente: `apps/web/src/components/admin/SectorList.tsx`
- **Navigazione:** Aggiungere `{ href: "/regia/sectors", label: "Settori" }` in `navItems` dentro `AdminLayout.astro` (riga 11)
- Query: `business_sectors` con `categories(count)` + `locations(count)` (conta location, non business distinti)
- Puro UI read-only + link a editor
- **Codex-friendly:** componente isolato, nessuna dipendenza da ambiente live

### Task 3 — SectorEditor UI shell (Codex-friendly, nessuna chiamata DB)
- File: `apps/web/src/components/admin/SectorEditor.tsx`
- Sezioni 1-2 (dati base + categorie) + sezione 3 (textarea prompt)
- **Solo UI/form con stato locale.** Nessuna chiamata Supabase. Usa callback `onSave(data)`.
- Claude integrera' le chiamate DB in Task 4 (integrazione)
- **Codex-friendly:** componente puro, testabile in isolamento

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

**Branch:** `codex/sector-prompt-builder`

**File da creare:**
- `apps/web/src/pages/regia/sectors/index.astro`
- `apps/web/src/components/admin/SectorList.tsx`

**Layout:** Seguire pattern identico a `/regia/businesses` (vedi `apps/web/src/pages/regia/businesses/index.astro`)

**Navigazione:** Aggiungere `{ href: "/regia/sectors", label: "Settori" }` nell'array `navItems` in `apps/web/src/layouts/AdminLayout.astro` (riga 11), dopo "Aziende".

**Query Supabase:**
```typescript
const { data: sectors } = await supabase
  .from("business_sectors")
  .select("id, name, platforms, description, created_at, categories(count), locations(count)")
  .order("name");
```

`locations(count)` conta le location associate al settore (non i business distinti). Una location = un punto vendita/sede. E' il dato rilevante per capire se il settore e' in uso.

**UI:**
- Tabella con colonne: Nome, Piattaforme (badge per ognuna), N. Categorie, N. Location, Azioni
- Ogni riga ha link a `/regia/sectors/[id]` (pagina editor, Task 3)
- Bottone "Nuovo Settore" in alto a destra
- Stile Tailwind coerente con le altre pagine Regia

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

- **CASCADE su categorie:** a schema attuale, `categories` ha `ON DELETE CASCADE` verso `business_sectors`, e `review_categories` ha FK verso `categories`. Cancellare una categoria fa sparire le righe in `review_categories`. **Mitigazione v1:** controllo applicativo nell'editor — impedire eliminazione categoria se ha review_categories collegate (query count prima di delete). Mostrare warning "X review usano questa categoria".
- **CASCADE su settori:** cancellare un settore fa cascade su `categories` (e quindi `review_categories`) e su `locations` (`business_sector_id ON DELETE CASCADE`). **Decisione v1:** nessuna eliminazione settore da UI. **Deferred post-v1:** valutare delete protetta con guard `locations(count) == 0`.
- **Prompt injection:** il template viene usato come system prompt OpenAI. Non e' un rischio diretto (solo admin scrive), ma validare che non contenga placeholders non supportati.
- **Retrocompatibilita':** settori esistenti con `prompt_template = NULL` usano il default. Zero breaking change.
- **Costo re-analisi:** cambiare il prompt di un settore non ri-analizza automaticamente le review esistenti. Serve azione esplicita dall'admin (gia' disponibile in AI Config > batch admin).
