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
| `audit_log` | Behandlingshistorik (kontoplan + bokföring) | `company_id`, `entity`, `entity_ref`, `action`, `old_data`, `new_data`, `metadata`, `source`, `batch_id`, `changed_by`, `changed_by_email`, `created_at` |

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
- **`audit_log` – bokföringshändelser** (avvikelse 1 åtgärdad, `supabase/audit_bokforing.sql`) via central RPC
  `log_accounting_audit(...)` (SECURITY DEFINER) + observerande triggers som **aldrig** ändrar bokföringslogiken och **aldrig**
  kan stoppa en bokföring (varje trigger sväljer ev. loggfel):
  | Händelse | Action | Källa | Trigger / anrop |
  |---|---|---|---|
  | Skapa verifikation | `verification_created` | trigger på `verifikationer` | `trg_audit_verifikation_ins` (AFTER INSERT) |
  | Ändra verifikation | `verification_updated` | trigger på `verifikationer` | `trg_audit_verifikation_upd` (AFTER UPDATE) |
  | Makulera verifikation | `verification_voided` | RPC | `makulera_verifikation` (motverifikation skapas; metadata motverifikation_id/nr + orsak) |
  | Radera verifikation (legacy/rollback) | `verification_deleted_current_legacy_flow` | trigger på `verifikationer` | `trg_audit_verifikation_del` (BEFORE DELETE; metadata `warning`, raderna sparas i `old_data`) |
  | Bokför leverantörsfaktura | `supplier_invoice_booked` | trigger på `supplier_invoices` | `trg_audit_supplier_invoice_booked` (`bokford` false→true) |
  | Bokför kundfaktura | `customer_invoice_booked` | trigger på `invoices` | `trg_audit_customer_invoice_booked` (`verifikation_id` null→satt) |
  | OCR/tolkning av underlag | `document_interpreted` | klient (`ocr`) | `tolkaDocument` → `log_accounting_audit` (endast vitlistade fält via `redactInterpretation`, aldrig råtext) |

  Kvitto/dagskassa/momsrapport bokförs som verifikationer och fångas därmed av `verification_created` (egna ledger-händelser
  kräver egen datamodell – ej i denna uppgift). `source ∈ {ui, edge_function, worker, import, ocr, system}`; klientanrop för
  `document` härleder `company_id` från `documents` och kräver medlemskap (company_id-isolation).
- **`platform_audit_log`** (`log_platform_audit`) → adminåtgärder (service_state, roller, support).
- **`download_audit_log`** (`log_inbox_download`) → nedladdning av underlag (user/company/antal, aldrig filinnehåll).
- **`ai_usage_log`** (`record_ai_usage`) → OCR-användning. **`inbound_email_log`** → e-postmottagning (utan mailbody/base64).
- **`stripe_event_log`** → idempotens. **`report_system_error`** → systemfel utan secrets/kortdata/rå body.

**Aldrig loggat:** API-nycklar, lösenord, kortdata, rå OCR-/mailbody med känsligt innehåll, secrets, konteringsrader eller
beskrivningstext i `document_interpreted` (endast leverantör/org.nr/fakturanr/datum/belopp/moms/valuta/typ – trunkerade).

## 7. Räkenskapsår och periodlåsning

- `fiscal_years` (start/slut/status) per företag; Kontoanalys auto-väljer aktivt år.
- `companies.bokforing_last_tom` (format `YYYY-MM`, sätts i Inställningar) visas ("Bokföring låst t.o.m. …") i rapportfiltren.
- **Tvingande periodlås på DB-nivå** (avvikelse 2 åtgärdad, `supabase/periodlas.sql`): central kontroll
  `assert_period_open(company, datum)` + triggers `trg_periodlas_verifikation` (BEFORE INSERT/UPDATE/DELETE på
  `verifikationer`) och `trg_periodlas_ver_rows` (BEFORE INSERT/UPDATE/DELETE på `verifikation_rows`). Gäller **alla**
  klienter (UI, edge, service_role). Regler:
  1. `datum` ≤ sista dagen i `bokforing_last_tom` → insert/update/delete **blockeras** (svenskt fel `PERIODLÅST: …`).
  2. Finns räkenskapsår måste `datum` ligga i ett **öppet** (`active`) år; stängda år är låsta. Företag **utan**
     räkenskapsår blockeras inte av årsregeln (nystartade).
  3. UPDATE kräver att **både** gamla och nya datumet är öppna (låst post kan inte ändras eller flyttas in/ut ur lås).
  4. **Bankavstämning undantagen:** rad-update som endast ändrar `avstamd` tillåts (ingen bokföringsändring).
  5. **Bypass endast** för avsiktlig administrativ total-radering: `reset_company`/`purge_test_data` sätter
     transaktionslokal GUC `app.periodlas_bypass` (samma mönster som `app.bulk_import`); båda auditas redan.
  Kompenserande radering i bokför-flödet (`rollbackVer`) påverkas inte – en nyss skapad verifikation ligger per
  definition i öppen period.

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
Arkivering: underlag + verifikationer + rader bevaras; makulering sker via **motverifikation** (originalet bevaras,
`makulera_verifikation` återställer faktura-/bankkopplingar); legacy delete-revert-trigger kvarstår endast för
kompenserande rollback av ofullständig bokning. WhatsApp är **endast supportlänk**, aldrig kanal för underlag.

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
| 2026-06-11 | Avvikelse 1 åtgärdad: behandlingshistorik för bokföring (`audit_log.source`/`metadata` + `log_accounting_audit` + triggers + `document_interpreted`). Se §6 och §16.1. |
| 2026-06-11 | Avvikelse 2 åtgärdad: tvingande periodlås på DB-nivå (`assert_period_open` + triggers på `verifikationer`/`verifikation_rows`, avstämningsundantag, admin-bypass). Se §7 och §16.2. |
| 2026-06-11 | Avvikelse 3 åtgärdad: makulering via motverifikation (`status`/`makulerad_av`/`motverkar` + `makulera_verifikation` + oföränderlighetsskydd; UI Bokföring/Kassa & Bank). Se §16.3. |

---

## 16. Efterlevnad och luckor

Områden där nuvarande implementation **inte fullt ut** uppfyller det bindande protokollet. Dessa ska åtgärdas innan
respektive flöde kan anses lagenligt komplett, och **en framtida uppgift som bokför utan att täcka dem ska stoppas och
konflikten rapporteras**.

1. **Behandlingshistorik för bokföring — ✅ ÅTGÄRDAD (2026-06-11, `supabase/audit_bokforing.sql`).** `audit_log` har nu
   `source` + `metadata` (additivt) och central RPC `log_accounting_audit(...)`. Observerande triggers loggar
   `verification_created` / `verification_updated` / `verification_deleted_current_legacy_flow` / `supplier_invoice_booked` /
   `customer_invoice_booked`, och klienten loggar `document_interpreted` (se §6). Bokföringslogiken är **oförändrad** och audit
   kan **aldrig** stoppa en bokföring. Live-verifierat (rollback-säkert) och täckt av tester (`auditAccounting.test.js`,
   `tolka.test.js`). **Kvarstår:** dedikerade ledger-händelser för moms/skatt (egen datamodell) – se lucka 5.
2. **Periodlås — ✅ ÅTGÄRDAD (2026-06-11, `supabase/periodlas.sql`).** DB-triggers på `verifikationer` +
   `verifikation_rows` blockerar insert/update/delete i låst period (`bokforing_last_tom`) och utanför öppet räkenskapsår,
   för alla klienter. Bankavstämning (`avstamd`) undantagen; bypass endast för auditad admin-total-radering
   (`reset_company`/`purge_test_data`). Live-verifierat rollback-säkert (11 scenarier). Se §7.
3. **Makulering — ✅ ÅTGÄRDAD (2026-06-11, `supabase/makulering.sql`).** `verifikationer` har nu
   `status (aktiv/makulerad/motverifikation)` + `makulerad_av`/`motverkar`. RPC `makulera_verifikation(ver_id, orsak)`
   skapar **motverifikation** (omvänd kontering, samma serie/datum, inga negativa rader) och bevarar originalet
   (`status='makulerad'`). Makulerade/motverifikationer är **oföränderliga** (skyddstriggers på ver + rader; endast
   avstämningsflaggan undantagen). Faktura-/bankkopplingar återställs så underlaget kan bokföras om. Periodlåset gäller
   (makulering i låst period blockeras → kräver framtida rättelseflöde, lucka 4). UI: Bokföring "Makulera"-knapp +
   statusbadge; Kassa & Bank "Ångra" makulerar. **Kvarvarande fysisk radering:** endast kompenserande rollback i
   bokför-flödet (`rollbackVer`, nyss skapad ofullständig ver) — auditas som `verification_deleted_current_legacy_flow`.
4. **Rättelseflöde saknas (§2, §15).** Ändring av en bokförd post sker via direkt om-spara, inte via spårbar rättelse i
   ny verifikation. **Åtgärd:** rättelseflöde (rättelseverifikation, serie R) i låst/bokförd period.
5. **Momsrapport-spårbarhet (§7).** Momsrapporten härleds inte rad-för-rad till verifikationsrader i nuläget.
   **Åtgärd:** koppling momsrapport → underliggande `verifikation_rows` med period/momskod.
6. **Kundfaktura-kreditlogik (§12)** är inte härdad/testad i samma omfattning som leverantörsfakturan.
7. **Skatt/deklaration (§8)** är inte byggt; ska byggas stegvis med tydlig regelkälla och separation bokförings-/deklarationsdata.

**Konsekvens (bindande):** de tre kritiska luckorna 1 (behandlingshistorik), 2 (tvingande periodlås) och 3 (makulering
via motverifikation) är nu åtgärdade. Kvarstående luckor är 4–7 (rättelseflöde, momsrapport-spårbarhet rad-för-rad,
kundfaktura-kreditlogik, skatt/deklaration). Nästa redovisningsuppgift bör prioritera **(4) spårbart rättelseflöde**
(rättelseverifikation i serie R), som också är förutsättningen för att rätta poster i låst period.
