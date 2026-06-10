# PROJECT_MAP – BokPilot

> Karta över systemets delar. För arbetssätt/historik se `HANDOFF.md`.
> Stack: React 18 + Vite + Tailwind + React Router · Supabase (Postgres, RLS,
> Storage, Edge Functions) · Vercel (app.bokpilot.se) · Gemini (AI edge functions).

## BokPilot Control Center (admin.bokpilot.se) – [ADMIN_PLATFORM]
Separat admin-skal, **host-gated i samma deploy** (samma mönster som bokpilot.se/app.bokpilot.se).
`src/lib/host.js` `isAdminHost()` (= värd `admin.bokpilot.se`, lokalt via `?admin`); `App.jsx` renderar
`<AdminApp/>` istället för kundappen på admin-värden. **Infra:** domänen `admin.bokpilot.se` måste läggas
till i Vercel + DNS (CNAME, som app-subdomänen) – koden är klar, domänen provisioneras separat.
- **Skal** `src/admin/`: `AdminApp.jsx` (auth-guard via `useAuth.platformAccess` → forbidden-vy om ingen
  plattformsroll; återanvänder `Login`), `AdminLayout.jsx` (egen sidomeny, rollbadge, länk till kundappen),
  `ControlCenter.jsx` (dashboard). Återanvänder befintliga admin-sidor (Systemövervakning/Support/Billing/OCR)
  i admin-skalets routes – ingen duplicering. Routes gate:as per `access`-flagga.
- **Dashboard (Fas 1)** komponerar BEFINTLIGA RPC:er (inga nya datamodeller): `admin_list_subscriptions` +
  `subscription_plans` (RLS-katalog) → MRR/ARR/ARPC + status- & företagsräkning; `admin_system_overview` →
  worker health + kö; `list_support_tickets` → öppna ärenden. Ren aggregering i `src/lib/adminMetrics.js`
  (`computeBillingMetrics`/`summarizeWorkerHealth`/`countOpenTickets`, testad). Varje sektion laddas oberoende
  och visar ärlig "ingen åtkomst"-not om rollen saknar gate. Churn/trial-conversion/health-score = Fas 7.
- **Femte rollen `read_only_admin`** (ser allt, muterar inget). Frontend-modell: `src/lib/platformRoles.js`
  (`isReadOnlyAdmin`, `canViewBilling`, `canAccessAdmin`, uppdaterad `CAPABILITY_MATRIX`/`accessFromRoles`).
  **DB-migration (ej applicerad – körs av admin):** `supabase/admin_read_only_role.sql` – utökar
  `platform_user_roles`-CHECK, `is_read_only_admin()`, läs-gates (`can_view_operations/support` + ny
  `can_view_billing`) inkluderar read_only, manage-gates oförändrade, `admin_list_subscriptions` gate:ad på
  `can_view_billing`, grant/revoke accepterar rollen, `my_platform_access` exponerar `isReadOnly`+`canViewBilling`.
  Additivt & icke-brytande.
- **Företagshantering + tjänstelås (Fas 2)** `src/admin/Foretag.jsx` (lista: sök namn/org.nr/e-post/arkivnr +
  statusfilter, riskindikator → profil) och `src/admin/ForetagProfil.jsx` (grunddata/användare/abonnemang/usage/
  inkommande underlag/support/audit + admin actions). **Service-state** på `companies` (`service_state`
  active/paused/blocked + `service_reason`/`service_note`(intern)/`service_changed_at`/`service_changed_by`) –
  **låser kundappen utan att radera data**. Kund (authenticated) har `REVOKE UPDATE` på service-kolumnerna →
  kan aldrig låsa upp sig själv; mutation endast via RPC. Ren logik: `src/lib/serviceLock.js`
  (`isCompanyLocked`/`lockAllowsPath`/`serviceStateMeta`) + `src/lib/adminCompanies.js`
  (`filterCompanies`/`canMutateServiceState`/`riskMeta`) – testade.
  - **Kundapp-låsvy** `Layout.jsx` (`ServiceLockView`): paused/blocked → svensk låsvy ("Ditt BokPilot-konto är
    tillfälligt pausat." + status/orsak/datum + **Kontakta support** / **Logga ut**). Supportflödet (`/support`)
    förblir nåbart (`lockAllowsPath`); allt annat blockeras. Plattformsadmin släpps förbi. Kontrolleras före legacy-`suspended`.
  - **RPC:er (`supabase/admin_company_service_state.sql`, ej applicerad – körs av admin):**
    `admin_set_company_service_state(company,state,reason,note,notify)` (gate **can_manage_operations** =
    superadmin/operations_admin; read_only/support/billing nekas) → uppdaterar state + `suspended`-sync, **audit**
    (`log_platform_audit('company_service_state_changed', …)` med previous/new/reason) + **notis** via befintliga
    `notify_event` (event `service_paused`/`service_blocked`/`service_reactivated`, in_app+email till företagets
    admins, nya `notification_templates`-rader). `admin_list_companies(search,state)` + `admin_get_company(id)`
    (gate **can_view_operations**, inkl. read_only). Inga parallella modeller. Routes `/foretag`, `/foretag/:id`.
  **Leverans hittills: Fas 1–2.** Tester: `serviceLock.test.js`, `adminCompanies.test.js`, `Layout.test.jsx`.
- **Server-side write-lock (Fas 2-härdning)** `supabase/admin_company_write_lock.sql` (ej applicerad – körs av admin):
  central guard `can_company_write(company)` (active→true; paused/blocked→false; superadmin/operations_admin→true) +
  **BEFORE INSERT/UPDATE/DELETE-triggers** (`enforce_company_write_lock`) på 15 affärstabeller (documents,
  verifikationer, invoices, supplier_invoices, customers, suppliers, products, bank_transactions, bank_accounts,
  account_import_batches, accounts, article_templates, bookkeeping_templates, fiscal_years, salaries) + rad-tabeller
  (verifikation_rows/invoice_rows via förälder). Triggern fires ÄVEN i SECURITY DEFINER-RPC:er → kundinitierade
  `import_chart_of_accounts`/`clear_chart_of_accounts`/`reset_company` täcks utan omskrivning. **`auth.uid() IS NULL`
  (service-role/workers/cron) släpps igenom** (inbound-email/imap/tolka/email-worker/scheduled-notifications/audit/
  notiser fortsätter; inget bokförs automatiskt). Storage-RLS `underlag_insert`/`underlag_delete` får guard (kund kan
  ej ladda upp/radera till låst företag; `underlag_select` + service-role orörda; support-bucket orörd). Fel:
  **"Tjänsten är pausad för detta företag. Kontakta BokPilot support."** (errcode 42501). Klientspegel/UI-felmappning:
  `serviceLock.js` `canCompanyWrite`/`friendlyWriteError`/`LOCKED_WRITE_TABLES`/`WRITE_LOCK_EXEMPT_TABLES` (testade).
  **Undantag (medvetna):** support_*, notification_*, audit-loggar, company_subscriptions, user_companies/company_invites,
  worker_health, system/katalog – får aldrig låsas (support/drift/billing/notiser måste fungera).
- **Bakgrundsflöden respekterar service_state (Fas 2-härdning steg 2)** – service_role bypassar RLS+triggern, så
  edge/workers självkollar via gemensam helper `supabase/functions/_shared/serviceState.ts`
  (`getCompanyServiceState`/`isServiceLocked`/`assertCompanyAcceptsUnderlag`, svensk orsak). **Pausat/blockerat företag:**
  - `inbound-email`: skapar INGA document/storage; loggar `inbound_email_log` status `service_{state}` (utan mailbody/base64);
    `record_worker_health(ok)`; svarar 200 `{status:'rejected',reason:'service_locked'}` (ej 500). DB-läsfel = tekniskt → system_error.
  - `imap-import`: `classifyWebhookOutcome` (`parse.mjs`) → `service_locked` behandlas som **affärsavvisning** (flyttas undan,
    ingen retry-loop, INGET system_error). Tekniska webhookfel = system_error vid upprepning (krav 4).
  - `tolka-underlag` & `ocr-folio`: kontroll efter medlemskapskoll, FÖRE Gemini/Folio → kör inte, skriver ingen tolkning,
    returnerar 403 med svensk orsak (`code:'service_locked'`), inget system_error. `ocr-folio` disabled/not_configured bevaras.
  - Klient `tolka.js`: fångar `service_locked` → ren svensk text, INGET omförsök. Tester:
    `supabase/functions/_shared/serviceState.test.js`, `parse.test.mjs` (classifyWebhookOutcome), `tolka.test.js`.

## Notification system (`src/lib/notifications.js`, DB, `src/components/NotificationCenter.jsx`)
Centralt notissystem som hela appen kan använda utan duplicerad logik.

**Kanaler:** `in_app` (live), `email` (kräver provider-credentials), `sms`, `push` (kräver opt-in + provider).

**Datamodell (Supabase):**
| Tabell | Roll |
|---|---|
| `notification_templates` | mallar per (event_type, channel, lang) med `{{variabler}}`, fallback till in_app |
| `notification_events` | rå händelse (company, event_type, payload, object) |
| `notification_queue` | köpost per kanal+mottagare (status/priority/scheduledAt/attempts/nextRetryAt/idempotencyKey, `read_at` för in_app) |
| `notification_deliveries` | leveransspårning (providerMessageId, delivered/opened/clicked/failed) |
| `notification_subscriptions` | push device tokens / sms opt-in (explicit samtycke) |
| `notification_preferences` | per användare/event/kanal på/av |
| `notification_provider_logs` | provider-metadata (ALDRIG secrets/fullt fakturainnehåll) |

**Kärnfunktioner (Postgres):**
- `render_template(tmpl, vars jsonb)` – ersätter `{{var}}`, tar bort saknade.
- `notify_event(company, event_type, payload, object_type, object_id, link_url, user_ids?, actor?, priority?)`
  – skapar event + köposter per mottagare/kanal enligt preferenser; in_app → `sent` direkt,
  övriga → `pending`. Obligatoriska events (security/system/permission/locked/invite) kan ej stängas av för in_app.
  sms/push kräver aktiv opt-in-subscription. Idempotens via `idempotency_key = event:user:channel`.

**Integration (hooks):** kontrakt i `src/lib/notificationHooks.js` (`NOTIFY_HOOKS`, dedupe/actionUrl/mottagare).
Idempotens på event-nivå via `notification_events.dedupe_key` (unikt per `company_id`) + `notify_event(... p_dedupe_key)`.
- `trg_notify_inbound_document` (documents INSERT, `source='email'`) → kvitto/lev.faktura/osäkert. *(Fas 1)*
- `trg_notify_bookkeeping_suggestion` (documents UPDATE `tolkad` false→true) → `bookkeeping_suggestion`, /inkorg.
- `trg_notify_verifikation_created` (verifikationer INSERT, ej Momsredovisning) → `verifikation_created`,
  endast skaparen (`created_by`), /bokforing/{id}.
- `trg_notify_import_failed` (account_import_batches `status=failed`/`error`) → `import_failed`, /installningar/import-export.
- `run_scheduled_notifications()` (pg_cron **`bokpilot-scheduled-notifications`** dagligen 06:00):
  `payment_overdue` (kundfaktura `status=sent`+förfallen, leverantörsfaktura obetald saldo+förfallen,
  dedupe `payment_overdue:{invoiceId}:{dueDate}`) + `bank_reconciliation_action` (omatchade banktransaktioner,
  dedupe per företag+dag). Returnerar antal notifierade (loggas i `cron.job_run_details`).
- `report_system_error(component, message, company?, severity?, errorCode?, metadata?, occurredAt?)` (RPC) →
  `system_error` till **superadmin + operations_admin** (mottagare = `platform_admins` ∪ `platform_user_roles`
  role=operations_admin; aldrig vanliga kunder). Severity-routing: `warning`→in_app, `error`/`critical`→in_app+email
  (via `notify_event(... p_channels)`); `critical`→priority `urgent`. Dedupe `system_error:{component}:{errorCode}:{hourBucket}`
  (+`:critical`-suffix så kritisk eskalering bryter igenom inom timmen även om lägre severity kvitterats). Max en
  notis per fel och timme – kvitterat fel ger ingen ny notis i samma bucket. Eskalerar till `critical` efter ≥3
  consecutive (`worker_health`). **Driftvarnings-mall** (`system_error` email, sv-SE): subject
  "BokPilot driftvarning: {{component}} - {{severity}}", body med component/severity/errorCode/occurredAt/message +
  länk till Systemövervakning ({{actionUrl}}). E-post-CTA absolutifierar relativa länkar (`absoluteUrl`).
  Canonical helper `src/lib/systemError.js` (severity/routing/dedupe/sanering – tester). **Rapporterande komponenter:**
  - `email-worker` (= kö-processor): RPC direkt (service-role) + health-ping vid lyckad körning.
  - `inbound-email` edge: config-secret saknas, storage-upload, DB-insert, ohanterat pipeline-fel.
  - `tolka-underlag` (OCR/Gemini) edge: gemini-API/rate-limit/timeout/file-extraction/malformed-svar (ej klientfel).
  - `imap-import` (saknar service-role): rapporterar via **edge `report-error`** (HMAC `ERROR_REPORT_SECRET`) –
    connection/auth/mailbox-read/webhook/parse/repeated. Inga IMAP/SMTP-credentials i metadata.
  - **Sanering (krav 3):** `sanitizeMetadata` tar bort tokens/credentials/bodies/innehåll, trunkerar, begränsar storlek.
  - **Health (`worker_health`):** last_success/last_failure/consecutive_failures per komponent (`record_worker_health`).
- `notify_vat_report_ready(company, verifikationId, period)` (RPC) → anropas av Moms-sidan efter momsredovisning.
- **Email-default-off** (`EMAIL_DEFAULT_OFF`): informativa events (underlag/kvitto/verifikation/förslag/kontoplanimport)
  default endast in_app; viktiga (faktura/moms/bank/import/säkerhet/system) default in_app+email. Obligatoriska låsta på (in_app+email).

**UI:**
- `NotificationCenter` (klocka + dropdown i Sidebar): olästa-badge, läs/markera alla, länk till objekt.
  Auto-uppdatering vid fönster-fokus + var 60:e sek.
- **Preferens-UI** `src/pages/Notiser.jsx` (Inställningar → Notiser, route `/installningar/notiser`):
  event-typer grupperade i 7 sektioner (`EVENT_GROUPS`: Underlag & Inkorg, Fakturor, Bokföring, Moms,
  Bank, Säkerhet, System), toggle per kanal (in_app/email/sms/push). Status per cell via `channelStatus()`:
  Aktiv / Avstängd / Obligatorisk (låst) / Kräver opt-in / Provider saknas. sms/push disabled tills provider finns
  (`CHANNEL_PROVIDER_AVAILABLE`). Obligatoriska events låsta på för in_app/email. Testknapp "Skicka testnotis"
  (in_app + email). Läser `notification_preferences` + `notification_subscriptions` (RLS-scopat per användare).
- **Backend-validering (RPC, SECURITY DEFINER):**
  - `set_notification_preference(company, event_type, channel, enabled)` – tenant isolation (medlem i företaget),
    vägrar stänga av obligatoriska (in_app/email), kräver aktiv opt-in för sms/push. Upsert i `notification_preferences`.
  - `send_test_notification(company, channel)` – skapar testnotis i kön (in_app→sent, email→pending), återanvänder
    befintlig modell (ingen ny parallell datamodell).
  - `apply_email_unsubscribe(user, event_type)` – bakom edge function `notif-unsubscribe` (se Email-leverans).

**Plattformsroller** (`src/lib/platformRoles.js`, DB):
- Roller: `superadmin` (högsta, = `platform_admins`-tabellen), `operations_admin`, `support_admin`, `billing_admin`
  (i `platform_user_roles(email, role)`). Granulära helpers: `is_superadmin()`, `has_platform_role(role)`
  (superadmin har alla), `can_view_operations()`, `can_manage_operations()`, `can_view_support()`, `can_manage_billing()`.
- **Behörighetsmatris:** superadmin=allt · operations_admin=drift (se+retry/cancel/ack) · support_admin=support
  (ej drift/billing) · billing_admin=billing (ej drift/secrets). Kunder nekas allt.
- Roll-admin (superadmin): `admin_grant_platform_role`/`admin_revoke_platform_role` (UI: Superadmin-sidan).
  `my_platform_access()` → frontend (`useAuth.platformAccess`). Alla rolländringar + drift-actions loggas i
  `platform_audit_log` (actor, action, target, detail). superadmin tilldelas EJ via grant (via platform_admins).

**Admin: Systemövervakning** (`src/pages/Systemovervakning.jsx`, `src/lib/systemStatus.js`):
- Route `/admin/system` (Plattform → Systemövervakning), **superadmin + operations_admin** (`can_view_operations()`
  RPC-gating + RLS). Actions kräver `can_manage_operations()` (döljs i läsläge). Forbidden-state för övriga.
  Självständig sida – kan flyttas till admin.bokpilot.se utan ändring.
- En RPC `admin_system_overview()` (admin-gated, en round-trip) returnerar: **worker_health** per komponent
  (imap-import, inbound-email, tolka-underlag, email-worker, scheduled-notifications) med status
  healthy/warning/failing/unknown; **queue-summary** (pending/processing/sent today/failed/skipped/cancelled/
  retries/oldest pending age); senaste 50 **system_error** (filtrerbara komponent/severity/kvittering);
  senaste 30 **e-postleveransfel**.
- Statuslogik (`computeWorkerStatus`, testad): unknown=ingen record, failing=consecutive>0 eller error/critical
  nyligen, warning=warning eller gammal success (>24h), healthy annars.
- Actions (admin-gated RPC): `admin_retry_notification`, `admin_cancel_notification`,
  `admin_acknowledge_system_error` (`notification_events.acknowledged_at/by`).
- **Sekretess:** system_error-events hålls `company_id=null` så kunder aldrig kan läsa dem; worker_health +
  notification_* skyddas av RLS (`is_platform_admin()`). On-demand-workers pingar `record_worker_health(true)`
  vid lyckad körning (rensar last_error); cron pingar `scheduled-notifications`.

**Admin: Support** (`src/pages/SupportAdmin.jsx`, `src/lib/support.js`):
- Route `/admin/support` (Plattform → Support), **superadmin + support_admin** (`can_view_support()` RPC-gating +
  RLS). operations_admin/billing_admin nekas om de inte också har support_admin. Forbidden-state för övriga.
- **Datamodell:** `support_tickets` (company, created_by, assigned_admin, subject, category, priority, status,
  last_message_at, closed_at), `support_messages` (konversation, is_admin), `support_internal_notes`
  (**aldrig synliga för kund** – RLS `can_view_support()`), `support_attachments`. Status: new/open/
  waiting_for_customer/waiting_for_support/resolved/closed. Priority: low/normal/high/urgent. 7 kategorier.
- **RLS:** kund ser egna/sitt företags ärenden + meddelanden (tenant isolation via `user_company_ids()`),
  support ser alla; interna anteckningar endast support. Skrivning via SECURITY DEFINER-RPC.
- **RPC (krav 11):** `list_support_tickets`/`get_support_ticket` (admin, + begränsad kundöversikt: namn/org.nr/
  användare/senaste aktivitet/inkomna underlag/misslyckade importer – ingen bokföringsdata), `reply_support_ticket`,
  `add_internal_note`, `assign_support_ticket`, `update_support_ticket_status`, `update_support_ticket_priority`,
  `create_support_ticket`/`customer_reply_support_ticket` (kund), `list_support_admins`. Alla loggar i `platform_audit_log`.
- **Notiser:** nytt ärende → support_admin/superadmin; **admin svarar → kund (in_app + email)**; kund svarar →
  tilldelad+support; urgent → hög/urgent prioritet (event types `support_ticket_created`/`_admin_reply`/`_customer_reply`).
  Mottagare ser egna notiser via uppdaterad `nq_select` (`user_id=auth.uid() OR can_view_operations()`).
- **`support_ticket_admin_reply` (email till kund):** `reply_support_ticket(ticket, body, attachment_count)` notifierar
  endast ticketens skapare (aldrig support själv/andra företag). Mall: subject "BokPilot Support har svarat på ditt
  ärende", body = ärendeämne + excerpt (max 300 tecken) + ev. "Svaret innehåller X bilagor." (aldrig filer/interna
  notes) + länk `https://app.bokpilot.se/support/{ticketId}` (route `/support/:ticketId` öppnar ärendet). Respekterar
  opt-out (`notification_preferences` → endast in_app om email avstängt; ej mandatory). Email går via queue → worker (retry/tracking).
  Interna anteckningar och kundsvar skapar aldrig email till kunden själv.

**Kund: Support** (`src/pages/Support.jsx`, route `/support`, sidebar Hjälp → Support – synlig för alla inloggade):
- Kund skapar ärende (kategori + ämne + meddelande + prioritet **låg/normal/hög**, ingen urgent), ser **sitt
  företags** ärenden (RLS, tenant isolation), öppnar tråd, svarar, och **stänger** eget ärende. Kundvänliga
  statusnamn (`customerStatusLabel`: new/open→"Öppet" osv). **Ser aldrig interna anteckningar** (RLS) eller admin-vyn.
- Läser ärenden/meddelanden via direkt RLS-skyddad SELECT (inga admin-fält visas). Skriver via RPC:
  `create_support_ticket` (status=new, första meddelandet, urgent→high-clamp), `customer_reply_support_ticket`
  (status→waiting_for_support), `customer_close_support_ticket` (→closed). Alla loggar i `platform_audit_log`
  (utan meddelandeinnehåll). Admin-RPC (`list/get_support_ticket` m.fl.) är `can_view_support()`-gated → ej åtkomliga för kund.

**Support-bilagor** (`src/lib/supportAttachments.js`, `src/components/SupportAttachments.jsx`):
- Kund + admin kan bifoga filer vid nytt ärende/svar; admin även på interna anteckningar. Privat storage-bucket
  **`support`**, nyckel `{companyId}/{ticketId}/{messageId|noteId}/{säkert filnamn}`. **Max 10 MB/fil, 5 filer/meddelande**.
  Tillåtna: pdf/png/jpg/jpeg/webp/txt/csv/xlsx/docx/json. Blockerade: exe/bat/cmd/js/msi/ps1/sh/html m.fl.
- **Validering i både frontend och backend** (`add_support_attachment`-RPC + bucket `file_size_limit`/`allowed_mime_types`).
  Filnamn saneras (anti path-traversal), path valideras mot ärendets company/ticket.
- **Visibility:** meddelande-bilagor `customer_visible`; interna anteckningars bilagor `internal_only` (kund ser dem aldrig).
  RLS på `support_attachments` + storage.objects (insert: eget företags mapp/support; select: visibility+tenant).
  Nedladdning via **signerad URL** (privat bucket) – gated av storage-RLS; `log_support_attachment_download` auditas.
  Notiser inkluderar bara antal/text, aldrig filinnehåll.

**Admin: Billing** (`src/pages/BillingAdmin.jsx`, `src/lib/billing.js`):
- Route `/admin/billing` (Plattform → Billing), **superadmin + billing_admin** (`can_manage_billing()` RPC-gating + RLS).
  support_admin/operations_admin/kund nekas. Forbidden-state för övriga.
- **Datamodell:** `subscription_plans` (namn, mån/års-pris SEK, limits: users/companies/invoices/documents/storage_mb/
  ai_ops, support_level, features jsonb, is_active) + `company_subscriptions` (ett per företag: plan, status,
  billing_period, period/trial-datum, cancelled/suspended_at, **payment_provider/customer_id/subscription_id =
  billing-readiness, ej kopplat till provider**). Status: trial/active/past_due/suspended/cancelled/expired.
  Billing period: monthly/yearly/trial. Seedade planer: Bas/Plus/Premium.
- **UI:** flik **Abonnemang** (företagslista + filter status/plan/sök + detaljpanel: ändra plan, period, status
  (= suspend/reactivate/cancel), trial/period-datum, billing-identifierare read-only) + flik **Planer** (lista,
  skapa/redigera, aktivera/inaktivera, sätt limits/features/priser).
- **RPC (gate `can_manage_billing`, alla audit-loggade):** `admin_list_subscriptions`, `admin_get_subscription`,
  `admin_set_company_plan` (vägrar inaktiv plan), `admin_set_subscription_status`, `admin_set_subscription_dates`,
  `admin_list_plans`, `admin_upsert_plan`, `admin_set_plan_active`. RLS: planer läsbara (katalog), abonnemang
  per eget företag eller billing-admin; skrivning endast via RPC.
- **Notiser:** statusbyte (past_due/suspended/cancelled) → kund (`subscription_status_changed`). Cron
  `notify_subscription_lifecycle()` (dagligen): trial slutar ≤3 dagar (`subscription_trial_ending`), period slutar
  ≤7 dagar (`subscription_expiring`) → kund (stabil källa: subscription-datum). Mallar för alla tre. **Ingen provider-
  integration ännu** – strukturen är adaptervänlig (payment_*-fält) för framtida Stripe e.d.

**Kund: Abonnemang** (`src/pages/Abonnemang.jsx`, route `/installningar/abonnemang`, Inställningar → Abonnemang):
- Kund ser **endast sitt företags** abonnemang (RPC `my_subscription` validerar medlemskap; RLS skyddar tabellerna).
  Visar nuvarande plan (namn/beskrivning/pris/period/status/period- & trial-slut/supportnivå), **kundvända statusnamn**
  (`CUSTOMER_STATUS_LABELS`: trial→Testperiod osv), limits + **usage där data finns** (`usageRows`: användare/fakturor/
  underlag/lagring från riktiga tabeller; AI = "–", hittar ej på siffror), varningsbanner vid past_due/suspended/expired
  (länk till Support; ingen enforcement-låsning ännu), och plan-jämförelse (Bas/Plus/Premium).
- **Uppgraderingsbegäran** (`request_subscription_change`): skapar support-ärende (kategori `billing`, prioritet `normal`,
  ämne "Begäran om abonnemangsändring", meddelande med önskad plan) + notis till **billing_admin/superadmin**
  (`subscription_change_requested`) + audit. Kunden ser ärendet i Support (in-app bekräftelse). **Ingen betalning/Stripe.**
- Kund kan **inte** ändra plan/status själv – admin-RPC:er är `can_manage_billing()`-gated.

**Plan-enforcement (soft)** (`src/lib/planLimits.js`, DB):
- **Mjuka gränser** – varnar men stänger ALDRIG av bokföringsfunktioner. Kontrollerar 6 limits: users/companies/
  invoices/documents/storage/ai. Usage-aggregering: users (`user_companies`), invoices/documents (denna månad),
  storage (sum `documents.file_size`), ai (`ai_usage_log`, loggas av tolka-underlag).
- **RPC:** `check_plan_limit(company, metric)` + `check_all_plan_limits(company)` → `{limit, used, remaining,
  percentUsed, status}` med status **ok (<80%) / warning (80–99%) / exceeded (≥100%) / unlimited (null/-1)**.
  `enforce_plan_limit(company, metric)` = check + in_app-notis vid warning/exceeded (dedupe per metric+status+företag+dag).
  Åtkomst: eget företag eller `can_manage_billing()` (RLS/RPC skyddar).
- **Notiser:** `plan_limit_warning` / `plan_limit_exceeded` (in_app, mallar). Recipients = företagets medlemmar.
- **Enforcement inkopplat (soft, blockerar ej):** AI/OCR (`tolka-underlag` – `record_ai_usage` + enforce ai),
  inkommande e-post (`inbound-email` – enforce documents), fakturaskapande (`NyFaktura`), användarinbjudan (`Team`),
  företagsskapande (`useAuth.createCompany`) via `enforceAndToast` (kundvänlig varning). AI/OCR tillåts vid exceeded
  (soft warning, ingen hard block – krav 9).
- **UI (Abonnemang-sidan):** progress bars per limit (grön/gul/röd), varningsbanner vid warning/exceeded, "Begär uppgradering".
- **Refaktorerat (central logik, ingen duplicering):** `_plan_limit_status` (calc, utan gate) + `_notify_plan_limit`
  (notis + dedupe + kanaler, utan gate). `check_plan_limit`/`enforce_plan_limit` = gate + dessa. `enforce_plan_limit`
  tillåter service_role (edge-flöden). Kanaler: **warning→in_app, exceeded→in_app+email**.
- **Schemalagd plan-enforcement** `run_scheduled_plan_enforcement()` (i cron `bokpilot-scheduled-notifications`,
  dagligen 06:00): kontrollerar alla active/trial-företag × 6 limits, notiser till företagets medlemmar (dedupe per
  event+metric+dag → warning→exceeded samma dag tillåts), + **plan_usage_summary** (in_app+email) till
  billing_admin/superadmin när något är över gräns. Audit `plan_enforcement_run` (companies_checked/warnings/exceeded/
  errors/duration_ms). Klient-kontrakt `channelsForStatus`/`planLimitDedupeKey` (testat).

**Admin: Plananvändning** (`src/components/UsageOverview.jsx`, flik i Billing-vyn, `src/lib/planLimits.js`):
- **superadmin + billing_admin** (`can_manage_billing()`). Översikt över alla företag: namn/org, plan, abonnemangsstatus,
  **overall risk (ok/warning/exceeded)**, högsta förbrukning (%), antal överskridna, senaste aktivitet.
- RPC `admin_plan_usage_overview(search, plan, sub_status, status, limit_type, sort, limit, offset)` – aggregerar usage
  per företag effektivt (index på documents/invoices(company_id,created_at)), filter (status/plan/sub_status/limitType/sök)
  + sortering (högst förbrukning/flest överskridna/mest lagring/mest AI/nyaste/äldst aktiv) + paginering.
- **Detalj-drawer** (`admin_company_usage_detail`): per-limit progress bars, senaste warning/exceeded-notiser, billing-ärenden,
  + **"Skicka uppgraderingsförslag"** (`admin_send_upgrade_suggestion` – notis `upgrade_suggestion` till kunden + audit,
  manuellt, ingen auto-spam) och "Ändra plan" (→ Abonnemang-fliken).

**Betalning: Stripe-adapter** (`src/lib/stripeBilling.js`, edge functions, DB) – **adapterbaserad, billing-ready** (väntar på Stripe-credentials):
- **Datamodell:** `company_subscriptions` + `payment_price_id/checkout_session_id/payment_status/last_payment_at/next_billing_at`;
  `subscription_plans.stripe_price_monthly/yearly` (price→plan-mapping); `stripe_event_log` (idempotens på Stripe event id).
- **Edge functions:** `stripe-checkout` (verify_jwt – kund startar checkout för eget företag via `stripe_checkout_context`-gate),
  `stripe-portal` (billing portal), `stripe-webhook` (verify_jwt=false, **verifierar Stripe-signatur**, extraherar fält,
  delegerar till RPC). Stripe-specifik parsning i edge, providerneutral logik i DB (`payment_provider`-struktur kvar).
- **Webhook-brain `stripe_handle_event`** (service_role): idempotens (event-log), price→plan + `map_stripe_status`
  (trialing→trial, active→active, past_due→past_due, canceled→cancelled, unpaid/incomplete→past_due), sync av subscription,
  **okänt price → `report_system_error` + ingen ändring** (krav 10). Events: checkout.session.completed,
  customer.subscription.created/updated/deleted, invoice.payment_succeeded/failed.
- **Notiser:** `payment_succeeded`/`plan_changed`→kund; `payment_failed`/`subscription_cancelled`→kund + billing_admin (mallar).
  Audit: checkout/sync/payment/cancel. **Checkout-knappen** på Abonnemang försöker Stripe; om ej konfigurerat → faller
  tillbaka till supportärende (`request_subscription_change`). Billing-admin ser payment-ids/status/nästa debitering + Stripe-länk.
- **Env (krav 1, se `supabase/functions/.env.example`):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`,
  `STRIPE_CANCEL_URL` (secret keys ENDAST som edge-secrets, aldrig i DB). Utan dessa: allt fungerar utom faktisk checkout.
- **Price-id per plan (admin-yta):** `subscription_plans.stripe_product_id/stripe_price_monthly/stripe_price_yearly`. Fylls i
  av billing_admin/superadmin i **Billing → Planer → Redigera** (validering: `prod_`/`price_`-prefix, tomt tillåtet;
  audit). Plan-kort visar **Stripe kopplad / Saknar price-id**. Checkout väljer price från planen utifrån vald period;
  saknas price → `configured:false` (blockeras med supportärende-fallback). `isValidStripeId`/`planStripeStatus` (testat).

**Events som stöds (17):** underlag_received, kvitto_classified, supplier_invoice_received,
invoice_needs_review, ocr_failed, bookkeeping_suggestion, verifikation_created, payment_overdue,
vat_report_ready, bank_reconciliation_action, import_failed, user_invited, security_event,
permission_changed, chart_import_done, locked_account_blocked, system_error.

**Email-leverans (Fas 2, LIVE):** kö-processor `scripts/email-worker/index.mjs` (Node + nodemailer)
hämtar `notification_queue` (channel=`email`, status=`pending`, `scheduled_at<=now`, ev. `next_retry_at<=now`),
slår upp mottagar-email via service role (`auth.users`), skickar via SMTP och spårar i `notification_deliveries`.
- **SMTP via env (ALDRIG hårdkodat):** `SMTP_HOST/PORT/SECURE/USER/PASSWORD/FROM` (Hostinger i v1).
  Övriga env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NOTIF_UNSUB_SECRET`, `UNSUB_BASE_URL`, `EMAIL_BATCH_SIZE`.
  `.env` är gitignorerad; `.env.example` finns. Ren leveranslogik i `src/lib/emailDelivery.js` (testad).
- **Statusflöde:** `pending → processing` (atomiskt claim, ingen dubbelutskick) → `sent`/`failed`/`skipped`.
  Fastnade `processing`-poster >15 min återställs till `pending`.
- **Retry:** exponentiell backoff (`2^attempt` min, tak 60), `attempt_count`/`max_attempts`/`next_retry_at`.
  Saknad/ogiltig adress + 5xx = permanent fail (ingen retry). maxAttempts stoppar retry → `failed`.
- **Tracking:** `notification_deliveries` (unik per `queue_id`): `provider_message_id`, `delivered_at`,
  `failed_at`, `failure_reason`, `last_attempt_at`. `notification_provider_logs` får metadata (ALDRIG innehåll/secrets).
- **Opt-out & obligatoriska:** skickar bara där användaren inte valt bort (`notification_preferences`);
  obligatoriska (security/permission/system/locked/invite) skickas alltid och kan ej avregistreras.
- **Unsubscribe:** footer-länk för icke-obligatoriska, HMAC-token → edge function `notif-unsubscribe`
  (publik, `verify_jwt=false`) → RPC `apply_email_unsubscribe` sätter email-pref `false`. `List-Unsubscribe`-header.
- **Cron:** Windows-task `BokPilotEmailWorker` (`node index.mjs` var 5:e min) — samma mönster som IMAP-importern.
- **Admin/test:** `node index.mjs --verify` (testa SMTP), `node index.mjs --test <email>` (testmail).

**Provider-config (env, ALDRIG hårdkodat):** sms/push-adaptrar konfigureras via miljövariabler i kö-processorn.
Saknas opt-in/credentials → posten skickas ej (sms/push kräver aktiv subscription).

**Tester:** `src/lib/notifications.test.js` (rendering, saknade variabler, opt-out, obligatoriska, kanaler),
`src/lib/emailDelivery.test.js` (email-validering, backoff, permanent fel, leveransbeslut, retry/maxAttempts,
unsubscribe-token, obligatoriska skyddade). Integrationstestat live: pending→sent, opt-out→skipped,
obligatorisk→sänd trots opt-out, ogiltig mottagare→permanent fail, ingen dubbelutskick, unsubscribe 200/obligatorisk 400.

## Inbound underlag via e-post
- Adress per företag: `{archiveNumber}underlag@bokpilot.se` (Hostinger MX, catch-all → `underlag@bokpilot.se`).
- IMAP-importer: `scripts/imap-import/index.mjs` (+ `parse.mjs`), schemalagd task var 5:e min,
  POSTar till edge function `inbound-email` (HMAC/token-auth), idempotens via Message-ID.
- Edge function `inbound-email`: validerar, klassificerar (`classifyDocument`), lagrar bilaga, skapar Inkorg-post.

## OCR-providers (Gemini primär, Folio valfri)
- **[OCR_PROVIDER_ARCHITECTURE]** `src/lib/ocr/ocrProviders.js`: modulär provider-modell – PRIMARY=`gemini`
  (befintligt `tolka-underlag`-flöde, oförändrat), valfri SECONDARY=`folio_ocr`. Normaliserat resultatformat
  `{ providerName, rawText, pages, layoutBlocks, confidence, processingTimeMs, errors, fallbackUsed }`
  (`normalizeOcrResult`/`normalizeFolioResult`), flaggor (`ocrConfig`), körplan (`resolveOcrPlan`). Ren/testbar
  (`ocrProviders.test.js`). Äger ingen bokföringslogik.
- **[OCR_FALLBACK]** `runOcrWithFallback({plan, providers})`: kör sekundär först om aktiv, faller tillbaka till
  primär vid fel/timeout om `ENABLE_OCR_FALLBACK=true`. Skapar aldrig trasiga poster (`{failed:true}` vid total miss).
  Flaggor: `OCR_PROVIDER_PRIMARY=gemini`, `OCR_PROVIDER_SECONDARY=folio_ocr`, `ENABLE_OCR_FALLBACK=true`.
- **[FOLIO_OCR_EXPERIMENTAL_PROVIDER]** edge function `ocr-folio` (verify_jwt=true, inloggad+company-åtkomst,
  ops-gated via `my_platform_access`, CORS: authorization/x-client-info/apikey/content-type): isolerad proxy mot
  SEPARAT Folio-tjänst. **Default AV.** Config-prioritet: **DB-rad `ocr_provider_config`** (admin-toggle) gäller om
  satt, annars env (`ENABLE_FOLIO_OCR`/`FOLIO_OCR_BASE_URL`). API-secret (`FOLIO_OCR_API_SECRET`) ENDAST env, aldrig
  DB/frontend. Statuslägen (`status`): `disabled` / `not_configured` / `available` / `unavailable`. Laddar dokument
  från Storage (service-role), POSTar `{filename,mimeType,contentBase64,persist:false}` till `{base}/ocr` med timeout,
  normaliserar svaret. `record_worker_health('folio-ocr',…)`; `report_system_error` **endast vid riktig service-failure**
  (ej disabled/not_configured/timeout). Folio-fel påverkar aldrig Gemini och skapar inga dokumentposter.
- **Admin-toggle (krav 11):** `ocr_provider_config` (singleton) + RPC:er `get_ocr_provider_config()` (operations/superadmin,
  läser folioEnabled+baseUrl, inga secrets) och `set_ocr_provider_config(p_enabled,p_base_url)` (endast superadmin, auditas
  i `platform_audit_log`).
- **UI** `src/pages/OcrTest.jsx` (`/admin/ocr-test`, canViewOperations): provider-health-panel (Gemini=Produktion·tillgänglig,
  Folio=Experimentell·status), separata knappar **"Tolka med Gemini"** (`tolkaDocument`), **"Tolka med Folio"** (endast
  `ocr-folio`, inaktiv när disabled/not_configured), **"Kör båda"**. Lugna Folio-lägen (`src/lib/ocr/folioStatus.js`:
  `folioStatus`/`folioStatusMeta`/`folioRunOutcome`/`folioButtonDisabled`, testad). Superadmin ser Folio-konfigsektion
  (på/av + Base URL). Komponent `folio-ocr` i Systemövervakning. Doc: `docs/FOLIO_OCR.md`.

## Gemensam dokumentvisare [DOCUMENT_VIEWER]
Återanvändbart split-/dokumentvisarsystem (höger panel) – EN implementation delas av alla underlags-/fakturavyer.
- **Komponenter** `src/components/viewer/`:
  - `DocumentViewerPanel.jsx` – panelen: PDF (`PdfCanvas`, DPR-skarp) + bild, Auto = **fit-to-width**, manuell zoom,
    rotation, förstoringsglas (`DocMagnifier`), bläddring mellan flera underlag, nedladdning, valfri `footer`.
    Visar bara `url` som anroparen skapat (signerad URL från privat bucket `underlag`) – hämtar inga filer själv.
    Exporterar även `docKind(doc)` (image/pdf/other via mime + filändelse).
  - `DocumentSplitLayout.jsx` – arbetsyta (flex) + dragbar splitter + panel (fast px-bredd).
- **Hooks** `src/lib/viewer/`:
  - `useDocumentViewerLayout({ widthKey, openKey })` – panelbredd/öppen/splitter, **egen localStorage-nyckel per modul**
    (krockar ej): `bokpilot.visaLevfaktura.panelW2`, `bokpilot.inkorg.viewerW`, `bokpilot.bokforing.viewerW`,
    `bokpilot.levfaktura.inkomna.viewerW`, `bokpilot.bokforing.registrera.viewerW` (+ öppen/dölj via
    `openKey` `bokpilot.bokforing.registrera.viewerOpen`). Standard 45% (`resolveViewerWidth`), ogiltig sparad bredd återställs.
  - `useAutoFitToWidth(cw, ch, opts)` – Auto = `computeAutoScale` (fit-to-width; höjden begränsar ej), manuell zoom
    bevaras vid resize, `zoomLabel` (Auto · X% / Manual · X%), `resetAuto`.
  - `useMagnifier()` – delad på/av-pref (EN nyckel `bokpilot.viewer.magnifier` → konsekvent UX i alla vyer).
- **Används i:** `VisaLeverantorsfaktura` (kopplade bilder, + coupling via UnderlagPanel), `Inkorg` (alla flikar – markera
  underlag → förhandsvisning), `VisaVerifikation` (kopplade underlag + splitter), `InkomnaFakturor` (öga → panel),
  **Bokföring → Registrera dagskassa / Registrera kvitto** (`AccountingUnderlagPanel`, se nedan).
  Säkerhet: signed URLs + RLS, inga publika URL:er. Testat i `src/lib/viewer/viewer.test.jsx`.
- **Registrera dagskassa/kvitto – underlagspanel** `src/components/AccountingUnderlagPanel.jsx` (i `Bokforing.jsx`):
  höger panel "VÄLJ BILD" (toolbar: Saknas text?/refresh/E-posta = disabled tills stöd finns, **Ladda upp**), drag & drop,
  lugnt tomt läge (rubrik + hjälptext + infodruta "sparat och arkiverat digitalt") och `DocumentViewerPanel` när underlag
  valts + **Ta bort underlag**. **Visa/dölj** panelen via `useDocumentViewerLayout({ openKey })` + `DocumentSplitLayout
  onToggle` (gul kantflik) och knapp i Bokförings-headern; bredd/öppet sparas i localStorage. Uppladdning → bucket
  `underlag` under `{company_id}/…` + `documents`-rad (kategori `kvitto` för kvitto, annars `dokument`), signerad URL.
  Vid bokföring kopplas underlaget (`documents.verifikation_id`, scopat på `company_id`). Filtyper: PDF/JPG/PNG/WEBP;
  `safeName` (basename + allowlist, blockerar path traversal). Återanvänder all viewer-logik (ingen duplicering).
  Testat i `src/components/AccountingUnderlagPanel.test.jsx`, `src/pages/Bokforing.test.jsx`,
  `src/components/registreraUnderlag.link.test.jsx`.
- **Hover-förstoringsglas** `src/components/DocMagnifier.jsx`: zoom-in-cursor, lins (**240px**, rund, 1px-kant + shadow)
  som förstorar utsnittet **75%** (`MAG=1.75`) utöver aktuell skala (img via background, PDF-canvas via DPR-skarp
  drawImage), följer musen (rAF-throttlad, `clampLensBox` håller linsen inom viewer-ytan; korrekt vid vertikal scroll),
  av under splitter-drag.

## Inkorg-nedladdning [INBOX_DOWNLOAD]
Ladda ner underlag från Inkorgen: enskild fil, valda som ZIP, eller hela fliken som ZIP.
- **Ren logik** `src/lib/inboxDownload.js` (testad i `inboxDownload.test.js`): `sectionSlug` (kategori→slug:
  kvitton/leverantorsfakturor/kundfakturor/dokument/avtal/behover_granskas), `sanitizeFilename` (blockerar path
  traversal `../ / \`, null/styrtecken, allowlist `[A-Za-z0-9._-]`, behåller ändelse), `dedupeNames`
  (faktura.pdf→faktura_2.pdf…), `zipFileName` (`{slug}_{YYYY-MM-DD}.zip`, valda: `{slug}_valda_…`),
  `checkZipLimits` (max **50 filer / 150 MB**, dokumenterad client-side-gräns), `partialSummary`.
- **UI** `src/pages/Inkorg.jsx`: per-rad nedladdningsikon, bulk **"Ladda ner valda (N)"**, header **"Ladda ner alla (N)"**
  (disabled på tom flik). Progress-toasts (Förbereder/Hämtar/Skapar ZIP/Laddar ner), partiell sammanfattning
  ("4 laddades ner, 1 kunde inte hämtas"). ZIP byggs client-side med **jszip** (lazy-importerad), filer hämtas via
  signerade URL:er (TTL 120s).
- **Säkerhet:** signerade URL:er (kort TTL) via storage-RLS (`underlag_select`: foldern = company_id) → endast eget
  företags filer, cross-tenant nekas i backend; inga permanenta publika URL:er. Audit: RPC `log_inbox_download
  (p_company_id,p_section,p_kind,p_file_count)` → tabell `download_audit_log` (user/company/section/kind/antal/tid –
  aldrig filinnehåll; insert endast via SECURITY DEFINER + medlemskapskontroll).

## Övrigt (urval)
- Auto Fit = **fit-to-width** (`computeAutoScale` i `src/lib/docPreview.js`): `scale = (containerW - pad) / naturalW`,
  höjden begränsar ej → långa dokument scrollas vertikalt. Höger panel = **45%** standard (`resolveViewerWidth`).
- **Split-layout ~10/45/45:** dokumentpanelen tar **50% av ytan EFTER sidomenyn** (≈45% av fönstret). `sidebarWidth()`
  speglar `Layout.jsx` (utfälld `max(220, 10vw)`, hopfälld 72). `UnderlagPanel` med prop **`widthKey`** äger sin bredd
  via localStorage (default `resolveViewerWidth(saved, fönster−sidomeny, {fraction:0.5, minPx:420})`; splitter klampar
  panel ∈ [420, min(75% fönster, fönster−sidomeny−520)] så arbetsytan ≥520 ej kollapsar). `NyLeverantorsfaktura`
  använder key `bokpilot.levfaktura.ny.viewerW`; **`NyVerifikation`** (Verifikation – ny) använder
  `bokpilot.bokforing.nyverifikation.viewerW` + öppen/dölj i `bokpilot.bokforing.nyverifikation.viewerOpen` (gul flik).
  Utan `widthKey` behåller UnderlagPanel tidigare beteende (övriga anropare).
- Layout: `Layout.jsx` + `Sidebar.jsx` (hopfällbar meny, `sidebarCollapsed` i localStorage).
- Mottagningsadresser/arkivnummer: `src/lib/inboxAddresses.js`. Klassificering: `src/lib/classifyDocument.js`.
- Bokföring/verifikationer, leverantörs-/kundfakturor, kontoplan, moms, bankavstämning – se respektive sida i `src/pages/`.
