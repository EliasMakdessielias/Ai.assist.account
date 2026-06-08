# PROJECT_MAP – BokPilot

> Karta över systemets delar. För arbetssätt/historik se `HANDOFF.md`.
> Stack: React 18 + Vite + Tailwind + React Router · Supabase (Postgres, RLS,
> Storage, Edge Functions) · Vercel (app.bokpilot.se) · Gemini (AI edge functions).

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
  `system_error` **endast plattformsadmins**. Severity-routing: `warning`→in_app, `error`/`critical`→in_app+email
  (via `notify_event(... p_channels)`). Dedupe `system_error:{component}:{errorCode}:{hourBucket}` (anti-spam).
  Eskalerar till `critical` efter ≥3 consecutive failures (`worker_health`). Canonical helper `src/lib/systemError.js`
  (severity/routing/dedupe/sanering – tester). **Rapporterande komponenter:**
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

**Admin: Systemövervakning** (`src/pages/Systemovervakning.jsx`, `src/lib/systemStatus.js`):
- Route `/admin/system` (Plattform → Systemövervakning), **endast plattformsadmins** (`isAdmin` + RPC-gating
  `is_platform_admin()` + RLS). Självständig sida – kan flyttas till admin.bokpilot.se utan ändring.
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

## Övrigt (urval)
- Dokumentvisare: `src/components/PdfCanvas.jsx` (pdf.js) + `src/lib/docPreview.js` (Auto/Manual fit-to-panel,
  ResizeObserver) i UnderlagPanel / VisaLeverantorsfaktura / LeverantorEditor.
- Layout: `Layout.jsx` + `Sidebar.jsx` (hopfällbar meny, `sidebarCollapsed` i localStorage).
- Mottagningsadresser/arkivnummer: `src/lib/inboxAddresses.js`. Klassificering: `src/lib/classifyDocument.js`.
- Bokföring/verifikationer, leverantörs-/kundfakturor, kontoplan, moms, bankavstämning – se respektive sida i `src/pages/`.
