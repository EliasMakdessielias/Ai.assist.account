# SYSTEMDOKUMENTATION – BokPilot

> **Status:** as-built per 2026-06-11. Detta är BokPilots systemdokumentation för räkenskapsinformation
> (Bokföringslagen 1999:1078, 5 kap. + god redovisningssed). Den beskriver hur affärshändelser registreras,
> behandlas, bokförs, spåras och arkiveras – samt **var nuvarande implementation inte fullt ut uppfyller det
> bindande redovisningsprotokollet** (se [§16 Efterlevnad och luckor](#16-efterlevnad-och-luckor)).
>
> Bindande protokoll: BokPilot får aldrig bokföra utan verifikation, huvudbokspåverkan, spårbart underlag,
> debet/kredit-balans, korrekt moms, korrekt räkenskapsår/period, behandlingshistorik och audit trail. Strider
> en uppgift mot detta ska arbetet **stoppas och konflikten rapporteras innan kod ändras**.
>
> Kompletterande karta över koden: `PROJECT_MAP.md`. Arbetssätt/historik: `HANDOFF.md`.

---

## 1. Systemöversikt

Stack: React 18 + Vite + Tailwind + React Router · Supabase (Postgres, RLS, Storage, Edge Functions) ·
Vercel (app.bokpilot.se) · Google Gemini (OCR/tolkning). Allt företagsdata är **company_id-scopat och RLS-skyddat**.

Lager:
- **Kundapp** (`app.bokpilot.se`) – löpande bokföring, underlag, fakturor, rapporter.
- **Control Center** (`admin.bokpilot.se`, host-gated) – drift/support/billing. **Pausat** tills Stripe-konto är klart.
- **Edge functions** (Deno) – OCR (`tolka-underlag`), inkommande e-post (`inbound-email`), Stripe-webhook m.fl.
- **Workers** (Node, schemalagda) – IMAP-import, e-postutskick.

## 2. Datamodell (bokföringskärna)

| Tabell | Roll | Nyckelkolumner |
|---|---|---|
| `companies` | Företag | `id`, `name`, `org_nr`, `bokforing_last_tom` (låst t.o.m.), `service_state` |
| `fiscal_years` | Räkenskapsår | `company_id`, `year`, `start_date`, `end_date`, `status` |
| `accounts` | Kontoplan (BAS) | `account_nr`, `name`, `is_active`, `is_locked`, `is_blocked_for_manual_booking`, `vat_code`, `opening_balance` |
| `verifikationer` | Verifikation (grundbok) | `company_id`, `ver_nr`, `ver_serie`, `datum`, `beskrivning`, `total_debet`, `total_kredit`, `is_locked`, `created_by`, `created_at`, `kommentar` |
| `verifikation_rows` | Verifikationsrader (huvudbok) | `verifikation_id`, `account_nr`, `account_name`, `debet`, `kredit`, `transaction_info`, `sort_order` |
| `supplier_invoices` | Leverantörsfakturor | `supplier_id`, `invoice_nr`, `invoice_date`, `due_date`, `amount_excl_vat`, `vat_amount`, `total_amount`, `kreditfaktura`, `bokford`, `verifikation_id`, `betalning_ver_id`, `makulerad` |
| `invoices` | Kundfakturor | `customer_id`, `invoice_nr`, `verifikation_id` |
| `documents` | Underlag | `company_id`, `storage_path` (bucket `underlag`), `file_name`, `mime_type`, `kategori`, `tolkning` (json), `verifikation_id` |
| `suppliers` / `customers` | Register | `company_id`, `name`, `org_nr`, betaluppgifter |
| `audit_log` | Behandlingshistorik (delvis) | `company_id`, `entity`, `entity_ref`, `action`, `old_data`, `new_data`, `batch_id`, `changed_by`, `changed_by_email`, `created_at` |

Specialloggar: `ai_usage_log` (OCR-användning), `inbound_email_log` (e-postmottagning, utan mailbody/base64),
`download_audit_log` (nedladdning av underlag), `notification_events`/`notification_provider_logs`,
`platform_audit_log` (adminåtgärder), `stripe_event_log` (idempotens). `worker_health` + `report_system_error`
(systemfel utan secrets/rå body).

**Spårbarhetskedja (krav §16 i protokollet):**
```
Underlag (documents) → Tolkning (documents.tolkning / tolka-underlag) → Faktura/Kvitto/Dagskassa
  → Verifikation (verifikationer) → Verifikationsrader (verifikation_rows) → Huvudbok (Kontoanalys) → Rapport (Balans/Resultat)
```
Kopplingar: `supplier_invoices.verifikation_id` → `verifikationer.id`; `documents.verifikation_id` → `verifikationer.id`;
`verifikation_rows.verifikation_id` → `verifikationer.id`. Alla FK:er company-scopade via RLS.

## 3. Bokföringsflöden

### 3.1 Leverantörsfaktura → bokförd verifikation  (`src/pages/NyLeverantorsfaktura.jsx`)
Underlag laddas upp/mejlas in → OCR tolkar → leverantörsfaktura fylls → kontering → **Bokför** skapar:
`supplier_invoices` (insert) → `verifikationer` (ver_nr via RPC `next_ver_nr`) → `verifikation_rows` →
`documents.verifikation_id` kopplas → `supplier_invoices.bokford=true, verifikation_id`. **Allt-eller-inget:** fel
efter verifikationshuvudet raderar huvudet (CASCADE + revert-trigger) så ingen halv-bokföring lämnas kvar.
Ren logik + tester i `src/lib/leverantorsfaktura.js`.

**Normal faktura:** kostnad debet, ingående moms (2640/2641) debet, leverantörsskuld 2440 kredit.
**Kreditfaktura:** omvänt (kostnad+moms kredit, 2440 debet); huvudfält Total/Moms får visas negativa, men debet/kredit-rader
hålls **positiva**. Kreditdetektion från OCR (`detectCreditInvoice`): kreditfaktura/kreditnota/kreditering/krediteras/
att erhålla/credit note + 2440-på-debet + negativt belopp.

### 3.2 Kundfaktura  (`src/pages/NyFaktura.jsx`, `VisaFaktura.jsx`)
Normal: kundfordran 1510 debet, intäkt 3xxx kredit, utgående moms (261x–263x) kredit. Kreditfaktura: omvänt.
Kopplas till kund, fakturanummer, förfallodatum, verifikation. *(Kreditfaktura-logiken för kund är inte härdad i
samma omfattning som leverantörsfakturan – se §16.)*

### 3.3 Kvitto  (`src/components/Kvitto.jsx`, Bokföring → Registrera kvitto)
Tolkar datum/leverantör/total/moms, föreslår konto, skapar balanserad verifikation, kopplar bild/PDF.

### 3.4 Dagskassa  (`src/components/Dagskassa.jsx`, Bokföring → Registrera dagskassa)
Försäljning per momssats (25/12/6), kontant/kort, utgående moms, balanserad verifikation, underlag.

### 3.5 Manuell verifikation  (`src/pages/NyVerifikation.jsx`)
Fri verifikation med kontoplan-validering, debet=kredit-krav, låsta konton respekteras.

**Hård regel i alla flöden:** `debet = kredit`, differens `0,00`, inga negativa debet/kredit. Verifikationshuvudet sätter
`total_debet`/`total_kredit` (positiva).

## 4. Huvudbok och rapporter  (`src/pages/Kontoanalys.jsx`)

- **Huvudbok:** per konto – ingående saldo, periodens rader (Ver.nr, bokföringsdatum, beskrivning, dokumenttyp, belopp,
  löpande saldo, bilaga-indikator), utgående saldo. **Ver.nr expanderar inline** (ingen navigation) → verifikationens rader
  (konto/momskod/projekt/debet/kredit) + relaterade verifikationer. **Fakturanummer** länkar endast vid säker, company-scopad
  relation (`verifikation_id` → faktura). I **popout** sker ingen navigation.
- **Balansräkning** (`src/lib/balansrakning.js`): 1xxx/2xxx, hierarkisk (IB/Förändring/UB), balanskontroll + Årets resultat.
- **Resultaträkning** (`src/lib/resultatrakning.js`): 3xxx–8xxx, Perioden + Ackumulerat, konto-expand → transaktioner → VerDetail.
- Gemensam hierarki-byggare `src/lib/rapport.js`. **Varje rapportsumma kan brytas ned till konton och vidare till
  verifikationsrader.** Live-verifierat: Beräknat resultat = Årets resultat (konsekvens Resultat ↔ Balans).

**Regel:** ingen bokförd rad får sakna huvudbokspåverkan – `verifikation_rows` ÄR huvudboken (per konto via Kontoanalys).

## 5. Moms

Stödda satser: 25/12/6/0 %, momsfri, omvänd skattskyldighet, EU-inköp. Ingående moms normalt **2640/2641** (debet vid inköp),
utgående moms **261x–263x** (kredit vid försäljning). Momskod hämtas från `accounts.vat_code` (visas i huvudbok/verifikationspanel).
Kreditfaktura vänder momsens sida korrekt; negativ moms ger rätt sida, inte negativa radbelopp. OCR-prompten sätter momssats och
föredrar 2640 framför 2641 när båda finns. **Momsrapport** finns som sida (`src/pages/Moms.jsx`); spårbarhet rapport→verifikationsrad
är delvis – se §16.

## 6. Behandlingshistorik och audit trail

Implementerat idag:
- **`audit_log`** (trigger `accounts_audit` + RPC:er `import_chart_of_accounts`/`seed_bas_accounts`/`clear_chart_of_accounts`/
  `reset_company`/`purge_test_data`) → **kontoplansändringar** (create/import/replace/update/import_skip_locked) med before/after.
- **`platform_audit_log`** (`log_platform_audit`) → adminåtgärder (service_state, roller, support).
- **`download_audit_log`** (`log_inbox_download`) → nedladdning av underlag (user/company/antal, aldrig filinnehåll).
- **`ai_usage_log`** (`record_ai_usage`) → OCR-användning. **`inbound_email_log`** → e-postmottagning (utan mailbody/base64).
- **`stripe_event_log`** → idempotens. **`report_system_error`** → systemfel utan secrets/kortdata/rå body.

**Aldrig loggat:** API-nycklar, lösenord, kortdata, rå OCR-/mailbody med känsligt innehåll, secrets.

> **VIKTIG LUCKA:** `audit_log` täcker idag **inte** kärnhändelserna *skapa verifikation*, *bokför*, *makulering*, *rättelse*,
> *momsrapport*. Se §16.

## 7. Räkenskapsår och periodlåsning

- `fiscal_years` (start/slut/status) per företag; Kontoanalys auto-väljer aktivt år.
- `companies.bokforing_last_tom` visas ("Bokföring låst t.o.m. …") i rapportfiltren.

> **VIKTIG LUCKA:** Periodlåset är **endast visning** – det finns **ingen trigger** som hindrar bokföring i låst period eller
> utanför öppet räkenskapsår (`finns_periodlas_trigger=false`). Se §16.

## 8. Service locks (tjänstelås)

`companies.service_state` (active/paused/blocked). Pausat/blockerat företag: kundappen låses (svensk låsvy), **server-side
write-lock-triggers** (`enforce_company_write_lock` på 17 affärstabeller via `can_company_write`) hindrar kundmutationer;
edge functions/workers (`inbound-email`, `tolka-underlag`, `ocr-folio`, IMAP) självkollar `service_state` via
`supabase/functions/_shared/serviceState.ts`. Data raderas aldrig. Support/notiser/audit/billing förblir nåbara.

## 9. Behörigheter

Kund: RLS via `user_companies`-medlemskap (endast eget företags data). Plattformsroller (`platform_user_roles`):
superadmin/operations_admin/support_admin/billing_admin/read_only_admin (`src/lib/platformRoles.js`, DB-gates
`can_view_*`/`can_manage_*`). Service_role (edge/worker) bypassar RLS men respekterar service_state explicit.

## 10. Underlag, OCR och arkivering

Underlag: upload (UI), e-postimport (`{archiveNumber}underlag@bokpilot.se` → IMAP → `inbound-email` → Inkorg), manuell koppling.
Filtyper: PDF/JPG/PNG/WEBP (exe/script/HTML/ZIP avvisas). Lagring i Storage-bucket `underlag` (RLS). OCR via Gemini
(`tolka-underlag`, verify_jwt=true) → strukturerad data + konteringsförslag; tolkning sparas i `documents.tolkning`.
Arkivering: underlag + verifikationer + rader bevaras; radering av verifikation återställer faktura/underlag (SET NULL +
revert-trigger). WhatsApp är **endast supportlänk**, aldrig kanal för underlag.

## 11. Felhantering

Edge functions skiljer klientfel från systemfel (`report_system_error` endast för genuina systemfel). Bokför-flödet är
allt-eller-inget (kompenserande radering). Fel visas på **svenska** och begripligt; OCR-osäkerhet/kvot ger åtgärdbar text.

## 12. Import/export

Kontoplan: import (CSV/Fortnox), kontrollerat byte (`planImport`), dubblettskydd, blockerade standardkonton bevaras
(`is_locked`/`is_blocked_for_manual_booking` + `protect_locked_account`-trigger). SIE/import-export-sidor under Inställningar.

## 13. Integrationer

E-post (Hostinger IMAP → inbound-email), OCR (Gemini primär, Folio valfri/avstängd), Stripe (Fas 3-kod klar, **ej aktiv** –
secrets/price-id saknas; webhook signaturverifierad, verify_jwt=false).

## 14. Automatiska vs manuella behandlingar

- **Automatiska:** OCR-tolkning, e-postimport→Inkorg, klassificering, notiser, e-postutskick, schemalagd grace/cron.
  Ingen automatik **bokför** utan användarens **Bokför**-klick.
- **Manuella:** all bokföring (Bokför), rättelse, makulering, kontoplansändring, periodval.

## 15. Ändringshistorik (dokument)

| Datum | Ändring |
|---|---|
| 2026-06-11 | Första versionen av SYSTEMDOKUMENTATION.md (as-built + lucksanalys) efter bindande redovisningsprotokoll. |

---

## 16. Efterlevnad och luckor

Områden där nuvarande implementation **inte fullt ut** uppfyller det bindande protokollet. Dessa ska åtgärdas innan
respektive flöde kan anses lagenligt komplett, och **en framtida uppgift som bokför utan att täcka dem ska stoppas och
konflikten rapporteras**.

1. **Behandlingshistorik för bokföring saknas (§1, §2, §6).** `audit_log` loggar idag kontoplan men **inte** skapa
   verifikation / bokför / makulering / rättelse / momsrapport. **Åtgärd:** trigger/RPC som skriver `audit_log` (entity
   `verifikation`/`supplier_invoice` …, action `bokford`/`makulerad`/`rattad`, old/new, `source`) vid dessa händelser.
   `audit_log` saknar dessutom `source`-fält (ui/edge/worker) som protokollet kräver.
2. **Periodlås ej tvingande (§2, §15).** `companies.bokforing_last_tom` visas men ingen DB-trigger hindrar bokföring i låst
   period eller utanför öppet räkenskapsår. **Åtgärd:** BEFORE INSERT/UPDATE-trigger på `verifikationer` som validerar
   `datum` mot öppet `fiscal_years` och `bokforing_last_tom`.
3. **Makulering förstör original (§2, §4).** Det finns ingen status (`aktiv/makulerad/rättad`) på `verifikationer`;
   "makulering" sker via **radering** (`trg_verifikation_delete` återställer faktura/underlag) → originalet bevaras inte.
   **Åtgärd:** statusfält + **motverifikation** (omvänd kontering) i stället för fysisk radering, så historik och spårbarhet
   bevaras enligt god redovisningssed.
4. **Rättelseflöde saknas (§2, §15).** Ändring av en bokförd post sker via direkt om-spara, inte via spårbar rättelse i
   ny verifikation. **Åtgärd:** rättelseflöde (rättelseverifikation, serie R) i låst/bokförd period.
5. **Momsrapport-spårbarhet (§7).** Momsrapporten härleds inte rad-för-rad till verifikationsrader i nuläget.
   **Åtgärd:** koppling momsrapport → underliggande `verifikation_rows` med period/momskod.
6. **Kundfaktura-kreditlogik (§12)** är inte härdad/testad i samma omfattning som leverantörsfakturan.
7. **Skatt/deklaration (§8)** är inte byggt; ska byggas stegvis med tydlig regelkälla och separation bokförings-/deklarationsdata.

**Konsekvens (bindande):** tills luckorna 1–3 är åtgärdade kan BokPilot bokföra utan fullständig behandlingshistorik och utan
tvingande periodlås, vilket strider mot Bokföringslagen. Detta är dokumenterat som känd avvikelse; nästa redovisningsuppgift
bör prioritera **(1) audit av bokföring, (2) tvingande periodlås, (3) makulering via motverifikation**.
