# AI Bokslut & Årsredovisning — status

Licensstyrd modul i AI-paketet. **Huvudregel:** modulen läser bara bokföring — den bokför aldrig, ändrar
aldrig låsta perioder och lämnar aldrig in något. Allt kräver mänsklig granskning och loggas.

Senast uppdaterad: 2026-06-23. Källa: migrationer `ai_bokslut_*`, `src/pages/AiBokslut.jsx`, `src/lib/bokslut.js`.

---

## 1. Vad som ingår i Steg 1A (säker licensstyrd grund) — KLART
1. `company_ai_features` + `has_ai_feature` (licens: per-bolag override + fallback till `subscription_plans.features`).
2. `bokslut_engagements` (per bolag + räkenskapsår).
3. `bokslut_audit_log` (revisionsspår).
4. Grundläggande sida `/ai-bokslut`.
5. Licensgrind (saknas licens → "ingår inte i din nuvarande plan").
6. Val av bolag (useAuth) + räkenskapsår (`fiscal_years`).
7. Statuskort (öppna kontroller, kritiska, höga, status).
8. Bokslutschecklista med **fasta kategorier** (16 st i `CHECKLIST_CATEGORIES`).
9. Varningsbanner (AI-genererat måste granskas).
10. Placeholders: riskanalys, AI-förslag, bokslutsbilagor, K2-utkast ("Kommer i nästa steg").
11. Audit-logg när engagemang **skapas** (`engagement_created`) och **öppnas** (`engagement_opened`, strypt 1/timme/användare).

## 2. Redan byggt UTÖVER Steg 1A
Detta byggdes i den ursprungliga (större) Steg 1-leveransen och ligger kvar:
- Deterministisk regelmotor `run_bokslut_analysis` (fyller checklistan med riktiga kontroller).
- Tabellen `bokslut_checks` (kontrollpunkter med risknivå, status, saldo, källa, spårbarhet).
- Check-åtgärder: `bokslut_set_check_status`, `bokslut_assign_check`, `bokslut_comment_check`.
- Detalj-drawer i UI (påbörja/klar/kräver granskning/ignorera/tilldela/kommentera + spårbarhet).
- Sidomeny-badge (`bokslut_open_counts`) + **realtime** på `bokslut_checks`.
- Audit på `run_analysis` och check-åtgärder.

## 3. Delar som tillhör Steg 1B men REDAN finns
Allt i sektion 2 ovan motsvarar Steg 1B-omfånget:
- ✅ deterministisk regelmotor
- ✅ riktiga bokslutskontroller (balanskontroll, bankavstämning, saknade underlag, ovanliga saldon, moms 2650,
  kontrollkonton per område, årets resultat, noter/bokslutsverifikationer-scaffold)
- ✅ risknivåer (low/medium/high/critical)
- ✅ check-actions
- ✅ sidomeny-badge (+ realtime)

- ✅ **rollbaserad behörighet** (tillagt): `bokslut_can` / `bokslut_my_permissions` mot `user_companies.role`.
  admin = full; member = read/run_analysis/assign_check/comment_check (EJ resolve/ignore/approve/create_draft).
  Tvingas i `bokslut_set_check_status`/`assign`/`comment`; UI grindar Klar/Ignorera/Återöppna för medlemmar.
- ✅ **handboksartikel + kontextuell hjälp** (tillagt): kategori + artikel `ai-bokslut-arsredovisning`
  (syfte, licenskrav, statusar, risknivåer, checklista, "Kör analys", vad AI/automatiserat underlag är, vad
  systemet aldrig gör, konsultens ansvar, audit/spårbarhet, låst engagemang, vanliga fel). Hjälp-knapp på
  `/ai-bokslut` (även i licensgrind-vyn) öppnar artikeln direkt via `HelpButton slug="ai-bokslut-arsredovisning"`.
- ✅ **statusövergångar för engagemang** (tillagt): `set_bokslut_engagement_status` (admin-only, behörighet
  `manage_status`) sätter klar_for_konsult/godkand/avvisad/last. Auto-status (pagar/kraver_granskning) härleds av
  `_bokslut_recount`; admin-milstolpar (klar_for_konsult/godkand/avvisad/last) bevaras. `last` låser allt
  (endast läsning, ingen återgång). Alla statusändringar loggas (`engagement_status`). UI: statusknappar +
  lås-bekräftelse + låst-banner; vid lås disablas kör analys och alla check-åtgärder.
- ✅ **bokslutsbilagor (Steg 2A, tillagt):** tabell `bokslut_attachments` + RPC `bokslut_list_attachments`,
  `bokslut_create_attachment`, `bokslut_update_attachment`, `bokslut_set_attachment_status`,
  `bokslut_generate_attachment_suggestions` (REGELBASERAD, ingen AI, ingen bokföring). Behörighet:
  read = licens+medlemskap; create/update/comment/status = admin (`attachment_write`); approve =
  `attachment_approve`. Låst engagemang = read-only. Audit: attachment_created/updated/status_changed/
  reviewed/approved/suggestion_generated. Nekade försök loggas i `bokslut_denied_log`. UI: panel på
  /ai-bokslut (lista, "Skapa bilaga", "Föreslå bilagor", modal med saldo/avstämt/**live differens** +
  tydlig differensmarkering, statusåtgärder), koppling check→bilaga ("Skapa bilaga från kontroll" +
  "Bokslutsbilaga kopplad"-markering), varning att bilagan är underlag – inte automatisk bokföring.

**Återstår i Steg 1B:** att UI visar de fasta kategorierna som tom checklista redan innan analys körts
(idag visas tomt-läge tills "Kör analys").

## 4. Vad som fortfarande saknas innan/ inför Steg 2
- **AI-edge `bokslut-ai`** (strukturerad JSON) — finns inte.
- **AI-förslag** (`bokslut_suggestions`, status "Förslag, ej bokförd", confidence, requires_manual_review).
- **Draft adjustments** (utkast till bokslutsverifikationer — får aldrig bokföras automatiskt).
- **K2-årsredovisningsutkast** (`annual_report_drafts`: förvaltningsberättelse, RR, BR, noter,
  fastställelseintyg, underskriftssida) — endast placeholder.
- **Godkännandeflöde** (approve/reject + statusövergångar godkänd/avvisad/låst) — `status='last'` respekteras
  i motorn men kan inte sättas från UI ännu.
- **Rollbaserad behörighet** mot `user_companies.role` (de 5 nycklarna är definierade som typer men inte tvingade).
- **K3-regelverk** (arkitekturen är förberedd via `regelverk`-kolumn).
- **Djupare avstämning** i kontrollkonto-checkarna (idag `needs_review` med saldovisning, ingen reskontra-matchning).

## 5. Risker med regelmotorn / check-actions / badge / realtime
**Regelmotor (`run_bokslut_analysis`)**
- **Ingående balans-antagande:** saldo = `accounts.opening_balance` + årets rörelse. Om `opening_balance`
  inte underhålls per räkenskapsår kan utgående saldon och `trial_balance_not_zero` ge fel utslag i fleråriga bolag.
- **Kontoklass-beroende:** `unusual_balance` kräver korrekt `accounts.account_class`; saknas klass flaggas inget.
- **BAS-prefix-heuristik:** kontrollkonton matchas på kontoprefix (15/24/16/20/78/17/29/27/25, moms 2650).
  Avvikande/anpassad kontoplan kan ge fel kategorisering. Inga gissade konteringar görs.
- **Scaffold-checkar** (noter, bokslutsverifikationer) är textvägledning utan automatik — konsulten äger bedömningen.
- Motorn **muterar aldrig** bokföring och kräver inloggad medlem (ingen system/cron-väg, till skillnad från Månadskontroll).

**Check-actions**
- **Arbetsfördelning (SoD) – nu rollstyrd:** endast `admin` får markera klar/ignorera/återöppna; `member` får
  läsa, köra analys, tilldela och kommentera. Enforced server-side i RPC (raise med tydligt svenskt fel) och
  grindat i UI. Approve/create_draft är definierade och admin-only (enforce när de byggs i Steg 2).
- **Roll-vokabulär:** endast `admin` och `member` finns i appen (default `admin`); fler nivåer
  (t.ex. redovisningskonsult/granskare) saknas och kan läggas till i `bokslut_can` när rollen införs.
- **Nekande-audit (åtgärdat, separat tabell):** nekade åtgärder loggas i en egen tabell `bokslut_denied_log`
  via RPC:n `log_bokslut_denied` (egen transaktion → överlever att den nekade åtgärdens transaktion rullas
  tillbaka av RAISE). Loggar user_id, company_id, engagement_id (om tillgängligt), role, action, reason,
  context (route) och created_at. Täcker även **utan licens** (open_module) och **utan medlemskap/forbidden**
  (run_analysis) eftersom RPC:n inte kräver medlemskap. **Endast plattformsadmin** kan läsa tabellen (RLS via
  `is_platform_admin()`) – säkerhetsdata visas aldrig i kund-UI (därför flyttad UT ur `bokslut_audit_log` som
  visas på sidan). Avvägning: loggningen är klientdriven (anropas vid SQLSTATE 42501 / licens-/medlemsavslag);
  helt server-garanterad logg även för direkta API-anrop skulle kräva autonom transaktion (dblink) med lagrade
  DB-uppgifter – medvetet bortvalt p.g.a. credential-/säkerhetsrisk.
- ✅ **Plattformsadmin-vy (tillagt):** read-only vy i Control Center (`/bokslut-denied`, endast superadmin)
  med tabell (tid/företag/engagemang/användare/roll/åtgärd/orsak/route) och filter (datumintervall, company_id,
  user_id, åtgärd, roll + fritextsök). Gatad i AdminApp (`access.isSuperadmin`) och av RLS. Ingen radering/
  ändring/export. Icke-superadmin ser varken menyval, route eller data.
- `status='last'` kan nu sättas av admin från UI (med bekräftelse) och blockerar därefter alla mutationer
  (check-åtgärder, statusändring, ny analys). **Ingen upplåsning** finns (avsiktligt i detta steg) – noterat
  som möjlig framtida funktion (t.ex. superadmin-unlock).

**Auto-resolve**
- Auto-löser endast `status='open'` som inte längre matchar (rör inte `needs_review`/`in_progress`/
  användarlösta). Auto-lösta punkter (resolved_by null) återöppnas om villkoret återkommer — avsiktligt.

**Badge / realtime**
- `bokslut_open_counts` räknar öppna kontroller **för hela bolaget** (alla räkenskapsår), inte bara valt år —
  badgen kan därför vara högre än det år som visas på sidan.
- Realtime-prenumeration på `bokslut_checks` triggar omladdning vid varje ändring; RLS gäller. Liten risk för
  extra omladdningar vid hög aktivitet (inte ett korrekthetsproblem).

## 6. Hur funktionen testas manuellt
1. **Licensgrind:** öppna `/ai-bokslut`. Med licens (testbolaget har `ai_bokslut_arsredovisning`) visas sidan;
   utan licens visas "ingår inte i din nuvarande plan". Sidomenyvalet döljs utan licens.
2. **Engagemang + audit:** välj räkenskapsår → engagemang skapas (audit `engagement_created`). Ladda om →
   `engagement_opened` (strypt 1/timme). Kontroll: `select action,created_at from bokslut_audit_log order by created_at desc`.
3. **Kör analys:** klicka "Kör analys" → checklistan fylls per kontrollområde med risk-chip, saldo och status.
4. **Risk-checkar (verifierat exempel):** lägg tillfälligt ett konto med ovanligt saldo (t.ex. klass 1 med
   negativ `opening_balance`) → `trial_balance_not_zero` (kritisk) + `unusual_balance` (hög) ska dyka upp; ta
   bort kontot och kör om → de auto-löses. (Skapa aldrig fejkade verifikationer för test.)
5. **Check-åtgärder:** öppna en punkt i drawern → påbörja/klar/ignorera/tilldela/kommentera → verifiera audit
   (`check_status`/`check_assign`/`check_comment`) och att statuskort/badge uppdateras.
6. **Badge/realtime:** öppna sidan i två flikar; en åtgärd i ena ska uppdatera badgen i den andra utan refresh.
7. **Build/tester:** `npm run build` och `npx vitest run` (lib-test `src/lib/bokslut.test.js`).

## 7. Tabeller, RPC:er och routes
**Tabeller** (RLS: select per `company_id in (select user_company_ids())`; mutationer endast via RPC)
- `company_ai_features` (company_id, feature_key, enabled, note)
- `bokslut_engagements` (company_id, fiscal_year_id [unik], regelverk, status, ansvarig_user_id, last_analysis_at, open/critical/high_count)
- `bokslut_checks` (engagement_id, company_id, category, title, description, account_nr, saldo, risk_level, status, suggested_action, source, action_url, rule_key, assigned_to, comment, source_data, resolved_by/at)
- `bokslut_audit_log` (engagement_id, company_id, user_id, action, model, prompt_version, detail)
- `bokslut_denied_log` (user_id, company_id, engagement_id, role, action, reason, context, created_at) –
  **endast plattformsadmin läser** (RLS `is_platform_admin()`); skrivs via `log_bokslut_denied`. Ingen FK mot
  bokföring; rör ingen bokföringsdata.
- `bokslut_attachments` (engagement_id, company_id, type, title, account_nr, saldo_huvudbok, avstamt_belopp,
  differens, source, source_data, status, comment, check_id, rule_key, reviewed_by/at, created_by/at) –
  bokslutsbilagor (dokumentations-/avstämningsstöd, ingen bokföring).
- Realtime aktiverat på: `bokslut_checks`

**RPC:er** (SECURITY DEFINER)
- `has_ai_feature(p_company, p_key) -> boolean`
- `bokslut_can(p_company, p_action) -> boolean` (rollmappning mot user_companies.role)
- `bokslut_my_permissions(p_company) -> jsonb` (alla åtgärder inkl. manage_status → bool, för UI-grindning)
- `set_bokslut_engagement_status(p_engagement, p_status)` (admin-only; klar_for_konsult/godkand/avvisad/last; loggar)
- `log_bokslut_denied(p_action, p_reason, p_company, p_engagement, p_context)` (separat logg-RPC → bokslut_denied_log, egen tx)
- `bokslut_get_or_create(p_company, p_fiscal_year_id) -> jsonb` (loggar created/opened)
- `run_bokslut_analysis(p_engagement) -> jsonb`
- `bokslut_set_check_status(p_check, p_status, p_comment)`
- `bokslut_assign_check(p_check, p_user)`
- `bokslut_comment_check(p_check, p_comment)`
- `bokslut_open_counts(p_company) -> jsonb {critical, high, open}`
- `bokslut_list_attachments(p_engagement)`, `bokslut_create_attachment(...)`, `bokslut_update_attachment(...)`,
  `bokslut_set_attachment_status(p_attachment, p_status, p_comment)`,
  `bokslut_generate_attachment_suggestions(p_engagement) -> int` (regelbaserad, ingen AI)
- interna: `_bokslut_recount(p_eng)`, `_bokslut_check_guard(p_check)`, `_bokslut_attachment_guard(p_attachment)`

**Routes / frontend**
- Route: `/ai-bokslut` → `src/pages/AiBokslut.jsx` (i `src/App.jsx`)
- Adminroute (Control Center): `/bokslut-denied` → `src/pages/BokslutDeniedLog.jsx` (endast superadmin; i
  `src/admin/AdminApp.jsx` + nav i `src/admin/AdminLayout.jsx`)
- Sidomeny: "AI Bokslut & Årsredovisning" i Översikt/AI-paketet, licensgrindat + badge (`src/components/Sidebar.jsx`)
- Lib/typer: `src/lib/bokslut.js` (+ `src/lib/bokslut.test.js`)
- SQL-referens: `supabase/ai_bokslut.sql`

**Migrationer:** `ai_bokslut_tables_and_license`, `ai_bokslut_engine_and_actions`, `ai_bokslut_audit_engagement_open`,
`ai_bokslut_role_permissions`, `ai_bokslut_engagement_status_transitions`, `ai_bokslut_log_denied`,
`ai_bokslut_denied_log_table`, `ai_bokslut_attachments_table`, `ai_bokslut_attachment_rpcs`

**Behörighetsmodell:** licens + medlemskap = grund. Roll (`user_companies.role`): admin = alla 8 åtgärder;
member = read/run_analysis/assign_check/comment_check. Speglas i `src/lib/bokslut.js` (`BOKSLUT_ROLE_ACTIONS`).

**Licens-status:** `ai_bokslut_arsredovisning` aktiverad för testbolaget (`company_ai_features`).
