# ROBOT BP – Etapp A: gap-analys (ingen kod ändrad)

> Jämför **befintlig ROBO-bp** mot specifikationen för den kompletta betalda "ROBOT BP"-funktionen.
> Read-only analys. Ingen kod, prompt, databas eller feature flag ändrad. Namnet **ROBO-bp** är redan
> etablerat i kod/DB/UI/handbok och **återanvänds** (specens "ROBOT BP" = samma funktion). Underlag:
> [robo-bp-status.md](robo-bp-status.md) + kodläsning + DB-katalog.

## 0. Sammanfattning

ROBO-bp Steg 1–2K ger en **solid, säker kärna**: server-side AI-kontrakt, deterministiska observationer,
kontrollpunkter med statusflöde, transparens/confidence, safe-intent guard, licensgrind, RLS och
metadata-only audit. Mot den fulla ROBOT BP-specen finns kärnan i **AI-assistent**, **kontroller (grund)**,
**säkerhet** och **betald funktion**. Det som **saknas** är främst: konsult-/flerbolagskonsol, en
persisterad **kontrollmotor** med rik checktaxonomi, **kontrollinställningar**, **rapportmodul**,
**dokument/RAG**, **externa integrationer**, samt en **samlad tabbad ROBO-bp-vy**.

Bedömning per krav: **GRÖN** = finns och uppfyller, **GUL** = delvis, **RÖD** = saknas.

## 1. Per-område gap-tabell

| # | Specområde | Status | Finns idag (bevis) | Gap |
| --- | --- | --- | --- | --- |
| 1 | **AI-assistent** | 🟡 | `RoboBpPanel.jsx` chat-slide-over; historik per bolag/användare (`robo_bp_conversations/_messages`); källor/basis/confidence/beslutsnivå/"Underlag"; create_check från findings+observationer; safe-intent guard | Promptförslag (fasta exempelfrågor), "Spara som PDF" på svar, dedikerad assistent-tabb/sida |
| 2 | **Kontroller** | 🟡 | `robo_bp_checks` + sida `/robo-bp/kontroller` (`RoboBpChecks.jsx`): filter status/risk/vy/år, statusflöde open→in_progress→done/dismissed | Flerbolagskonsol (lista bolag: org.nr, källa, antal avvikelser, senast kontrollerad, momsperiod); knapp "Ny bokföringskontroll"; "Markera allt som löst / Inte ett problem / Ångra"; PDF-nedladdning; berörda verifikat/konton i resultatvyn |
| 3 | **Kontrollinställningar** | 🔴 | – | Hela området saknas: ingen settings-tabell/dialog (känslighet, kategorier, momsperiod, regelverk, exkluderade konton, egna momskonton, seriekontroller, standard för nya bolag) |
| 4 | **Kontrollmotor** | 🟡 | Deterministiska observationer i `robo_bp_context` (no_fiscal_year, missing_ver_desc, unbalanced_ver, supplier/customer_overdue, supplier_no_name, many_without_status) + lib `checkDebetKredit/checkMomsRimlighet/checkFakturaTotal`. Närliggande motorer finns: `run_monthly_control`, `bokslut_checks` | Persisterad rule-engine som skapar checks med fullt schema (code/severity/affected_accounts/affected_vouchers/affected_invoices/source=rule_engine\|ai_assisted/resolved_by/resolved_at). Saknade kontroller: momsavvikelse, momskonto mot ovanligt konto, bortbokade kund-/lev.skulder utan betalningsspår, utländska inköp utan justeringskonto, periodisering saknas, transaktioner som sticker ut, ovanliga bank/kassa-rörelser, kritiska kassaflödesmånader |
| 5 | **Rapporter** | 🔴 | Återanvändbar infra finns: `annual_report_exports` + edge `annual-report-pdf` (pdf-lib) + storage-bucket; SIE-sida finns | Ingen ROBO-bp-rapportmodul (lista/skapa/format text-Excel-PDF/redigera). Rapporttyper (ekonomisk översikt, kassaflöde, nyckeltal, avvikelse, intäkt/kostnad/moms, betalningsförmåga, kritiska månader) saknas |
| 6 | **Dokument** | 🔴 | Generell `documents`-tabell finns | Ingen ROBO-bp-dokumentvy; ingen RAG (medvetet uppskjuten – kräver separat säkerhetsdesign) |
| 7 | **Import/integrationer** | 🟡 | SIE-import-UI i `Sie.jsx`; BokPilot-intern data (kärnan) | Fortnox/Visma/Bokio saknas helt (ej i projektet) → endast UI-plan + integrationskontrakt enligt spec. SIE som källa till ROBO-bp ej kopplat |
| 8 | **Datasäkerhet** | 🟢 | Server-side context assembly; klienten skickar bara `{company_id, descriptor, question}`; audit metadata-only (inga råa frågor/AI-svar); RLS (SELECT-policys) + mutationer via SECURITY DEFINER-RPC; company isolation; hallucinationsspärr; inga secrets till klient; GDPR-dataminimering via minimal kontext | Formuleringskontroll av UI-påståenden (inga ogrundade "servrar i Stockholm"-texter) bör granskas när nya UI-ytor byggs |
| 9 | **Betald funktion** | 🟡 | Feature flag `robo_bp` i `company_ai_features` via `has_ai_feature`; licensgrind i panel + sida + sidomeny; låst läge visas; per-bolag-aktivering möjlig | Superadmin-UI för att aktivera per bolag + **audit av aktivering** bör verifieras/läggas till; namnval `robo_bp` vs `robot_bp` (behåll `robo_bp`) |
| 10 | **UI-princip** | 🟡 | Panel + `/robo-bp/kontroller` följer BokPilots design | Saknar **samlad tabbad vy** (Assistenten / Kontroller / Rapporter / Dokument / Inställningar) eller AI-paket-undermeny för de fyra ytorna |
| 11 | **Säkra begränsningar** | 🟢 | Safe-intent guard (Steg 2J) blockerar bokför/skapa/ändra/radera/godkänn/lås upp/lämna in/betala/skicka myndighet före AI; ingen mutationskod; `requires_human_review` tvingas; `suggest_accounting` blockerat | Guard-meddelandet säger "ROBO-bp" (spec vill "ROBOT BP") – behåll etablerat namn, ev. justera ordval |

## 2. Återanvändbara tillgångar (bygg på dessa, inte nytt)

- **Kontrollpunkter:** `robo_bp_checks` + `robo_bp_create_check`/`robo_bp_set_check_status` (decision_basis, confidence_label, audit).
- **Kontext/observationer:** `robo_bp_context`-RPC (smart, server-side, minimal projektion) + `src/lib/roboBp.js` (rena, testade helpers).
- **Rapport/PDF:** `annual_report_exports` + edge `annual-report-pdf` (pdf-lib) + storage-bucket + kvalitetskontroller – mönster för ROBO-bp-rapporter.
- **Kontrollmotor-mönster:** `run_monthly_control` och `bokslut_checks` (idempotent upsert, auto-resolve, risknivå, audit) – mall för ROBO-bp rule-engine.
- **Dokument:** generell `documents`-tabell.
- **Licens:** `company_ai_features` + `has_ai_feature`.
- **SIE:** befintlig parser/UI i `Sie.jsx`.

## 3. Audit & datakontrakt (nuläge)

- Audit-actions: `ai_query`, `intent_blocked`, `check_created`, `check_status_changed`, `denied`, `suggestion_accepted` – alla metadata-only. Ingen DB-check-constraint på `action` → enkelt att utöka (t.ex. `control_run`, `settings_changed`, `report_created`, `license_activated`).
- Till AI skickas: bolagsnamn/org.nr, vy, selection, smart kontoplan, saldo per klass, 10 senaste ver/lev/kund, summary (antal/öppna/förfallna/intäkt/kostnad/moms), observationer, frågan. **Aldrig**: rådata-rader utöver projektionen, bilagor, OCR, personnummer, andra bolags data.

## 4. Rekommenderad etappordning (minst-risk först)

| Etapp | Innehåll | Beroende | Risk |
| --- | --- | --- | --- |
| **B** | Samlad tabbad ROBO-bp-vy (Assistenten/Kontroller/Rapporter/Dokument/Inställningar) – UI-skelett, licensgrindat; flytta in panel + checks-sida | Inget backend-beroende | Låg (ren UI) |
| **C** | Kontroller: flerbolagskonsol + kontrollresultatvy + status-knappar (löst/inte problem/ångra) + PDF. Återanvänd `robo_bp_checks`. Ev. liten **rule-engine-RPC** som persisterar checks från `robo_bp_context`-observationerna (source=rule_engine) | B | Medel (DB-additiv, ingen bokföringsmutation) |
| **D** | Kontrollinställningar: ny `robo_bp_settings` (company-scoped, RLS, audit) + dialog (känslighet/kategorier/momsperiod/regelverk/exkluderade konton/egna momskonton/seriekontroll/standard) | C | Medel (additiv tabell) |
| **E** | Rapporter: lista/skapa/text-format först; Excel/PDF via befintlig export-infra när stabilt. Tydlig märkning data/antaganden/AI-text/deterministiskt | C/D | Medel |
| **F** | Dokument: vy + uppladdning + mappstruktur (beta). **RAG först efter separat säkerhetsdesign** | E | Hög (skjuts) |
| **G** | Integrationer: SIE först (isolerat); Fortnox/Visma/Bokio endast UI-plan + integrationskontrakt tills OAuth/behörighet/dataavtal designats | F | Hög (skjuts) |

## 5. Vad som INTE ska byggas ännu

- Ingen RAG / dokument-till-AI utan separat säkerhetsdesign.
- Inga externa integrationer (Fortnox/Visma/Bokio) – endast plan/kontrakt.
- Ingen IFRS-rapportering (systemet stödjer K2/K3-spår, ej IFRS → visa inte IFRS).
- Inga ogrundade datasäkerhetspåståenden i UI.
- Ingen autobokföring/-kontering, ingen breddning av flaggan till fler bolag utan pilotbeslut (se [robo-bp-pilot1-no-human-traffic.md](robo-bp-pilot1-no-human-traffic.md)).

## 6. Kända begränsningar / öppna frågor inför Etapp B+

- "Tomt statusfält"-kontroll går inte att trigga på verifikationer (status NOT NULL+CHECK) – gäller även framtida rule-engine.
- `no_fiscal_year`-observationen är panel-/kontraktsstyrd (panelen skickar `fiscalYearId=null`), inte data-styrd; bör adresseras om räkenskapsårsval ska påverka kontroller.
- Superadmin-aktiverings-UI + aktiverings-audit bör bekräftas i Etapp B/D.
- Mänsklig pilot är ännu ej körd; bredd till fler bolag förblir blockerat tills pilot utvärderats.

## 7. Leveransrapport (Etapp A)

- **Filer ändrade:** endast detta dokument (gap-rapport). **Ingen kod.**
- **Tabeller/RPC/Edge ändrade:** inga.
- **RLS/behörighet:** oförändrad (robo_bp-tabeller har SELECT-policys; mutationer via SECURITY DEFINER-RPC).
- **Feature flag:** `robo_bp` aktiv endast testbolaget `4f0d…` – oförändrad.
- **Data till AI / inte till AI:** oförändrat (se §3).
- **Audit-actions:** oförändrade (se §3).
- **Testresultat:** ej körda i Etapp A (ren analys; senast grönt: build + Vitest 965/965 i Steg 2K).
- **Live-smoke:** ej relevant (ingen körning).
- **Vad som inte byggdes:** allt – Etapp A är endast analys.
- **Kända begränsningar:** se §6.
