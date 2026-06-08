-- Notification system. Applicerat som migrationer:
--   notification_system_core  (tabeller, RLS, render_template, notify_event, seed-mallar)
--   notify_on_inbound_document (trigger som notifierar vid inkommande underlag)
-- Se PROJECT_MAP.md för översikt. Nedan: kärnlogiken (funktioner + trigger) för repo-record.
-- Tabeller: notification_templates/events/queue/deliveries/subscriptions/preferences/provider_logs.

-- {{var}} -> värde; saknade tas bort.
create or replace function public.render_template(p_tmpl text, p_vars jsonb) returns text as $$
declare result text; k text; v text;
begin
  if p_tmpl is null then return null; end if;
  result := p_tmpl;
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    result := replace(result, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return regexp_replace(result, '\{\{[a-zA-Z0-9_]+\}\}', '', 'g');
end $$ language plpgsql immutable;

-- Skapar event + köposter per mottagare/kanal enligt preferenser. in_app -> 'sent',
-- övriga -> 'pending'. Obligatoriska events kan ej stängas av för in_app. sms/push kräver opt-in.
-- (Full definition i migration notification_system_core.)

-- Trigger: inkommande underlag (source='email') -> notify_event.
create or replace function public.notify_on_inbound_document() returns trigger as $$
declare et text; dt text;
begin
  if NEW.source is distinct from 'email' then return NEW; end if;
  dt := case NEW.kategori when 'kvitto' then 'Kvitto' when 'leverantorsfaktura' then 'Leverantörsfaktura'
    when 'kundfaktura' then 'Kundfaktura' when 'avtal' then 'Avtal' when 'dokument' then 'Dokument' else 'Underlag' end;
  et := case when NEW.status = 'needs_review' or NEW.kategori = 'okand' then 'invoice_needs_review'
    when NEW.kategori = 'kvitto' then 'kvitto_classified'
    when NEW.kategori = 'leverantorsfaktura' then 'supplier_invoice_received' else 'underlag_received' end;
  perform public.notify_event(NEW.company_id, et,
    jsonb_build_object('documentType', dt, 'confidence', coalesce(round(NEW.confidence * 100)::text, ''),
      'actionUrl', 'https://app.bokpilot.se/inkorg'),
    'document', NEW.id, '/inkorg');
  return NEW;
end $$ language plpgsql security definer;
drop trigger if exists trg_notify_inbound_document on public.documents;
create trigger trg_notify_inbound_document after insert on public.documents
  for each row execute function public.notify_on_inbound_document();

-- Email-leverans (Fas 2). Migrationer:
--   notification_deliveries_unique_queue  (en leveransrad per köpost, för worker-upsert)
--   apply_email_unsubscribe_fn            (RPC bakom edge function notif-unsubscribe)
-- alter table public.notification_deliveries add constraint notification_deliveries_queue_id_key unique (queue_id);

-- Avregistrera email-notiser för ett event (alla användarens företag). Obligatoriska vägras (-1).
-- Anropas av edge function notif-unsubscribe (service role). Kö-processor: scripts/email-worker/.
create or replace function public.apply_email_unsubscribe(p_user_id uuid, p_event_type text)
returns int as $$
declare n int;
begin
  if p_event_type = any (array['security_event','permission_changed','system_error','locked_account_blocked','user_invited']) then
    return -1; -- vägras: obligatoriskt event
  end if;
  insert into public.notification_preferences (user_id, company_id, event_type, channel, enabled)
  select p_user_id, uc.company_id, p_event_type, 'email', false
  from public.user_companies uc where uc.user_id = p_user_id
  on conflict (user_id, company_id, event_type, channel) do update set enabled = false, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$ language plpgsql security definer set search_path = public;
revoke all on function public.apply_email_unsubscribe(uuid, text) from anon, authenticated;

-- Preferens-UI (Inställningar → Notiser). Migration: notification_preference_rpcs.
-- Sätt egen preference med validering (tenant isolation + obligatoriska + sms/push opt-in).
-- Skapa testnotis (in_app/email). Se src/pages/Notiser.jsx. (Fullständig definition i migrationen.)
-- create function set_notification_preference(p_company_id uuid, p_event_type text, p_channel text, p_enabled boolean) ...
-- create function send_test_notification(p_company_id uuid, p_channel text) returns uuid ...

-- Affärsflödes-hooks (migration notify_event_hooks). Kontrakt i src/lib/notificationHooks.js.
-- Idempotens: notification_events.dedupe_key (unik per company_id) + notify_event(... p_dedupe_key).
-- Triggers: trg_notify_bookkeeping_suggestion (documents UPDATE tolkad), trg_notify_verifikation_created
--   (verifikationer INSERT, ej Momsredovisning, endast skaparen), trg_notify_import_failed (account_import_batches).
-- run_scheduled_notifications(): payment_overdue (invoices/supplier_invoices) + bank_reconciliation_action.
--   Schemalagd via pg_cron-jobb 'bokpilot-scheduled-notifications' (0 6 * * *).
-- report_system_error(component, message, company?): system_error endast plattformsadmins, timme-bucket dedupe.
-- notify_vat_report_ready(company, verifikation_id, period): anropas från Moms-sidan.
-- notify_event har email-default-off för informativa events; obligatoriska tvångas på för in_app+email.

-- system_error-rapportering (migration system_error_reporting). Helper: src/lib/systemError.js.
-- notify_event(... p_channels text[]): kanal-restriktion för severity-routing.
-- worker_health(component, last_success_at, last_failure_at, consecutive_failures, last_error) + record_worker_health().
-- report_system_error(component, message, company?, severity?, errorCode?, metadata?, occurredAt?):
--   warning->in_app, error/critical->in_app+email; dedupe system_error:{component}:{errorCode}:{hourBucket};
--   eskalerar till critical efter >=3 consecutive. Endast plattformsadmins.
-- Rapporterande komponenter: email-worker, inbound-email, tolka-underlag (service-role direkt) + imap-import via
--   edge 'report-error' (HMAC ERROR_REPORT_SECRET). Metadata saneras (inga tokens/credentials/innehåll).

-- Admin-dashboard (migration admin_system_dashboard). UI: src/pages/Systemovervakning.jsx (/admin/system).
-- notification_events.acknowledged_at/by; report_system_error håller system_error company-null (kunder ser ej).
-- admin_system_overview() (admin-gated): worker_health-status + queue-summary + system_errors + leveransfel.
-- admin_retry_notification / admin_cancel_notification / admin_acknowledge_system_error (is_platform_admin-gated).
-- record_worker_health rensar last_error vid lyckad körning. Cron pingar 'scheduled-notifications'.

-- Plattformsroller (migration platform_roles). Modell: src/lib/platformRoles.js.
-- platform_user_roles(email, role in operations_admin/support_admin/billing_admin) + platform_audit_log.
-- superadmin = platform_admins (befintlig). Helpers: is_superadmin(), has_platform_role(role),
--   can_view_operations(), can_manage_operations(), can_view_support(), can_manage_billing().
-- Drift-RLS (worker_health, notification_events/queue/deliveries/provider_logs) + admin_system_overview
--   gate:as nu på can_view_operations(); actions (retry/cancel/ack) på can_manage_operations() + audit.
-- Roll-admin (superadmin): admin_grant_platform_role/admin_revoke_platform_role (+ audit). my_platform_access()
--   -> frontend. admin_list_platform_roles() för UI. Alla actions loggas i platform_audit_log.

-- Driftvarningar (migration ops_failing_alerts). report_system_error notifierar nu superadmin +
-- operations_admin (platform_admins ∪ platform_user_roles role=operations_admin). occurredAt i payload.
-- critical -> dedupe-suffix ':critical' (bryter igenom inom timmen). Mallar: system_error in_app + email
-- (subject "BokPilot driftvarning: {{component}} - {{severity}}"). buildEmailHtml absolutifierar relativa CTA-länkar.

-- Support-admin (migrationer support_admin_core + support_admin_rpcs). UI: src/pages/SupportAdmin.jsx (/admin/support).
-- Tabeller: support_tickets/support_messages/support_internal_notes/support_attachments. RLS: kund ser egna/företagets
-- ärenden+meddelanden (tenant isolation), support_admin/superadmin ser alla; interna anteckningar endast can_view_support().
-- RPC: list/get/reply/add_internal_note/assign/update_status/update_priority (admin) + create/customer_reply (kund) +
-- list_support_admins. Notiser: support_ticket_created/_admin_reply/_customer_reply (+mallar). support_admin_ids().
-- nq_select uppdaterad: user_id=auth.uid() OR can_view_operations() (mottagare ser egna notiser).
-- VIKTIGT: notify_event fanns i 3 överlagrade versioner (9/10/11-arg) p.g.a. create-or-replace med ändrad signatur;
-- de äldre droppades, endast 11-arg (…, p_dedupe_key, p_channels) finns kvar -> 6-arg trigger-anrop ej längre tvetydiga.

-- Kund-support (migration customer_support). UI: src/pages/Support.jsx (/support).
-- create_support_ticket clampar urgent->high (kund får max high) + audit. customer_reply_support_ticket + audit.
-- customer_close_support_ticket (kund stänger eget ärende -> closed) + audit. Kund läser via RLS-SELECT (ej admin-RPC).
