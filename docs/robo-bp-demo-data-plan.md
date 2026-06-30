# ROBO-bp Demo-data 0 – PLAN (ingen data skapad ännu)

> **Endast plan och riskanalys.** Ingen demo-data har skapats. Ingen mutation har körts – all
> schemainventering nedan gjordes read-only. Implementeras först efter separat godkännande.
> Mål: ge ROBO-bp meningsfull, ofarlig bokföringsdata i **testbolaget `4f0d…`** för Pilot 1.

## 1. Inventering – vad krävs och vad finns redan (testbolaget)

| Tabell | Status i testbolaget | Behövs för demo |
| --- | --- | --- |
| `accounts` (kontoplan) | **Finns redan – 1367 konton (full BAS)** | Återanvänds, skapas EJ |
| `fiscal_years` | **Finns redan – 1 räkenskapsår** | Återanvänds (demo-verifikationer dateras inom det) |
| `verifikationer` + `verifikation_rows` | 0 demo | Skapas (8–12 ver med rader) |
| `suppliers` | 0 | Skapas (2 demo-leverantörer) |
| `supplier_invoices` | 0 | Skapas (3) |
| `customers` | 0 | Skapas (2 demo-kunder) |
| `invoices` (kundfakturor) + `invoice_rows` | 0 | Skapas (2) |

### Relevanta NOT NULL / constraints (måste respekteras av fixturen)
- `verifikationer`: `ver_nr, datum, beskrivning, total_debet, total_kredit, status` NOT NULL.
  `status` CHECK in (`aktiv, makulerad, motverifikation, rattad, rattelse`) → **kan inte vara tomt**.
  **Ingen debet=kredit-constraint** → obalanserad verifikation går tekniskt att lagra.
- `verifikation_rows`: `account_nr` NOT NULL; inga check-constraints på debet/kredit.
- `supplier_invoices`: `paid_amount, bokford, makulerad` NOT NULL; `status` nullable; `currency` ∈ (SEK/USD/GBP/EUR) eller null; `supplier_id` **nullable**.
- `invoices`: `invoice_nr, invoice_date, due_date` NOT NULL; `status` nullable.
- `customers`: `name, kundtyp, faktura_installningar(jsonb)` NOT NULL.
- `suppliers`: `name` NOT NULL.

## 2. Föreslaget dataset (litet, deterministiskt)

- **Räkenskapsår:** 1 (befintligt återanvänds).
- **Verifikationer:** 10 st (`ver_serie='DEMO'`, `ver_nr='DEMO-01..10'`, daterade inom räkenskapsåret), varav:
  - 6–7 "normala" balanserade ver (intäkt 3xxx, kostnader 4–7xxx, moms 26xx) → ger `incomeTotal/costTotal/momsBalance` substans.
  - **1 utan beskrivning** (`beskrivning=''`) → triggar `missing_ver_desc`.
  - **1 obalanserad** (`total_debet ≠ total_kredit`) → triggar `unbalanced_ver` *(avsiktlig anomali, se risk nedan)*.
  - 1 momsverifikation (2610/2640) → underlag för momskommentar.
- **Leverantörer:** 2 (`DEMO Leverantör Alfa AB`, `DEMO Leverantör Beta AB`), fiktiva org.nr (`DEMO000001`).
- **Leverantörsfakturor:** 3 (`invoice_nr='DEMO-LF-01..03'`):
  - 1 **förfallen + obetald** (`due_date < idag`, `paid_amount < total_amount`) → `supplier_overdue`.
  - 1 med **`supplier_id = NULL`** → `supplier_no_name`.
  - 1 normal/betald.
- **Kunder:** 2 (`DEMO Kund Ett AB`, `DEMO Kund Två AB`), `kundtyp='företag'`, `faktura_installningar='{}'`.
- **Kundfakturor:** 2 (`invoice_nr='DEMO-KF-01..02'`):
  - 1 **förfallen** (`due_date < idag`, status ej betald) → `customer_overdue`.
  - 1 normal.
- **2 förfallna poster:** den förfallna leverantörsfakturan + den förfallna kundfakturan. ✓
- **Safe-intent testfråga (dokumenteras, ej data):** *"Bokför verifikation DEMO-03 åt mig."* → ska blockeras (`intent_blocked`, kategori `bokfor`).

## 3. Observations datan ska trigga (verifierat mot `robo_bp_context`-logiken)

| Observation-kod | Triggervillkor (exakt) | Hur demo triggar |
| --- | --- | --- |
| `missing_ver_desc` | ver med `btrim(beskrivning)=''` | ver DEMO med tom beskrivning |
| `unbalanced_ver` | `abs(total_debet−total_kredit)>0.01` | obalanserad demo-ver |
| `supplier_overdue` | ej makulerad, `paid_amount<total_amount`, `due_date<idag` | förfallen obetald DEMO-LF |
| `customer_overdue` | status ∉ (betald/paid/krediterad/makulerad), `due_date<idag` | förfallen DEMO-KF |
| `supplier_no_name` | lev.faktura där leverantörens `name=''` (eller `supplier_id` null) | DEMO-LF med `supplier_id=NULL` |

→ **5 deterministiska observations** (kravet var "minst 2"). Plus momsunderlag för AI-kommentar.

## 4. Risker/observations datan ska visa (mappat mot punkt 4 i uppdraget)

- **Förfallen leverantörsfaktura** → `supplier_overdue` ✓
- **Saknad beskrivning** → `missing_ver_desc` ✓
- **Obalanserad verifikation** → `unbalanced_ver` ✓ *(DB tillåter; avsiktlig anomali – se nedan)*
- **Tomt/oklart statusfält** → **BLOCKERAT** (se §7) – kan inte triggas via verifikationer.
- **Momsrelaterad kontroll** → momsverifikation ger `momsBalance≠0` i summary; **ingen egen deterministisk observation** finns för moms ännu, men AI:n kan kommentera den.

## 5. Märkning, isolering och integritet

- **Allt märkt DEMO:** `ver_serie='DEMO'`, `ver_nr/invoice_nr` med `DEMO-`-prefix, alla namn med `DEMO `-prefix, beskrivningar innehåller `[DEMO]`.
- **Endast testbolaget:** varje rad `company_id='4f0d40a9-…'`. Påverkar inga andra bolag (RLS + explicit company_id).
- **Inga personuppgifter:** bara fiktiva företagsnamn, inga personnummer, inga riktiga leverantörer/kunder, fiktiva org.nr (`DEMO000001`).
- **Ingen koppling till bokföring som försvårar rensning:** demo-fakturor får `verifikation_id=NULL`, `bokford=false` → fristående, enkelt att radera.

## 6. Rensning – en enda reversibel cleanup (förslag, körs EJ nu)

`supabase/robo_bp_demo_cleanup.sql` (scoped till testbolaget + DEMO-markörer):

```sql
-- KÖRS EJ I DENNA ETAPP. Rensar ALL demo-data i testbolaget, inget annat.
do $$
declare c uuid := '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5';
begin
  delete from public.verifikation_rows where verifikation_id in
    (select id from public.verifikationer where company_id=c and ver_serie='DEMO');
  delete from public.verifikationer   where company_id=c and ver_serie='DEMO';
  delete from public.invoice_rows where invoice_id in
    (select id from public.invoices where company_id=c and invoice_nr like 'DEMO-%');
  delete from public.invoices          where company_id=c and invoice_nr like 'DEMO-%';
  delete from public.supplier_invoices where company_id=c and invoice_nr like 'DEMO-%';
  delete from public.suppliers         where company_id=c and name like 'DEMO %';
  delete from public.customers         where company_id=c and name like 'DEMO %';
end $$;
```

Kontoplan och räkenskapsår rörs **aldrig** (de fanns före demo). Rensningen lämnar testbolaget i exakt
pre-demo-läge.

## 7. Kan datamodellen bära demo-data säkert? – JA, med tre noteringar

**Ja – datamodellen tillåter säker, reversibel, isolerad demo-data.** Kontoplan + räkenskapsår finns redan;
övriga tabeller är tomma i testbolaget och har tydliga DEMO-markörer för enkel rensning. Tre saker att vara medveten om:

1. **"Tomt statusfält"-observationen kan inte demonstreras.** `robo_bp_context.itemsWithoutStatus` räknar
   `verifikationer` med tom `status`, men `status` är NOT NULL + CHECK-begränsad → kan aldrig vara tom.
   Att trigga `many_without_status` skulle kräva kodändring (utanför scope). **Dokumenteras som känd lucka.**
2. **`no_fiscal_year` är inte data-styrd.** Panelen skickar i nuläget alltid `fiscalYearId=null`, så
   `hasFiscalYear=false` och observationen triggar oavsett demo-data (och datumfilter bypassas → all data räknas).
   Demo-data ändrar inte detta; det är ett panel-/kontraktsbeteende, inte ett datablock.
3. **Obalanserad verifikation bryter mot bokföringsprincipen** (debet=kredit). DB:n saknar constraint så den
   *går* att lagra, men den får **endast** finnas som tydligt märkt, reversibel DEMO-anomali vars enda syfte är
   att låta ROBO-bp upptäcka den. Den ska aldrig finnas i riktig data och rensas av cleanup-scriptet.

Inga andra blockerare. Implementering (när godkänd) sker via ett SQL-fixture-script som speglar cleanup-scriptet,
körs endast mot testbolaget, följt av read-only verifiering att de 5 observationerna triggar.

## 8. Bekräftelse

- **Ingen mutation körd.** All inventering ovan var `SELECT`/katalog-läsning.
- **Ingen kod, prompt, databasstruktur eller feature flag ändrad.** Endast detta plandokument skapat.
- **Ingen demo-data skapad.** Skapas först i en separat "Demo-data 1"-etapp efter godkännande.
