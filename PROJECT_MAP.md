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

**Integration (hooks):**
- Trigger `trg_notify_inbound_document` på `documents`: när inkommande underlag (`source='email'`)
  skapas → `notify_event` (kvitto→`kvitto_classified`, lev.faktura→`supplier_invoice_received`,
  osäkert→`invoice_needs_review`). Täcker både IMAP- och webhook-vägen.
- Fler events kan kopplas genom att anropa `notify_event(...)` (RPC från edge functions / DB-triggers).

**UI:**
- `NotificationCenter` (klocka + dropdown i Sidebar): olästa-badge, läs/markera alla, länk till objekt.
  Auto-uppdatering vid fönster-fokus + var 60:e sek.
- Preferenser: `notification_preferences` per kanal (UI-yta kan byggas i Inställningar).

**Events som stöds (17):** underlag_received, kvitto_classified, supplier_invoice_received,
invoice_needs_review, ocr_failed, bookkeeping_suggestion, verifikation_created, payment_overdue,
vat_report_ready, bank_reconciliation_action, import_failed, user_invited, security_event,
permission_changed, chart_import_done, locked_account_blocked, system_error.

**Provider-config (env, ALDRIG hårdkodat):** email/sms/push-adaptrar konfigureras via miljövariabler
i kö-processorn (Fas 2). Saknas credentials → posten markeras `skipped` (ingen placeholder).

**Tester:** `src/lib/notifications.test.js` (rendering, saknade variabler, opt-out, obligatoriska, kanaler).

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
