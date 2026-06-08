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
