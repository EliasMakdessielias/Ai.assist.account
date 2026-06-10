-- =============================================
-- BokPilot Control Center – Fas 2: företagshantering + service-state
-- Tri-state tjänstestyrning per företag (active/paused/blocked) som LÅSER kundappen
-- utan att radera data. Server-side gate (SECURITY DEFINER + can_manage_operations),
-- audit (platform_audit_log) och notiser (befintliga notify_event – ingen parallell modell).
-- Additivt & icke-brytande. Kör i Supabase SQL Editor.
-- =============================================

-- 1. Service-state-fält på companies (default 'active' → oförändrat beteende för befintliga rader).
alter table public.companies add column if not exists service_state text not null default 'active';
alter table public.companies drop constraint if exists companies_service_state_check;
alter table public.companies add constraint companies_service_state_check
  check (service_state in ('active','paused','blocked'));
alter table public.companies add column if not exists service_reason text;
alter table public.companies add column if not exists service_note text;       -- intern, exponeras ALDRIG för kund
alter table public.companies add column if not exists service_changed_at timestamptz;
alter table public.companies add column if not exists service_changed_by uuid;

-- 2. Kund (authenticated) får ALDRIG ändra service-state direkt (companies-RLS tillåter annars
--    medlem att uppdatera egen rad). SECURITY DEFINER-RPC:n nedan (körs som ägare) kringgår detta.
revoke update (service_state, service_reason, service_note, service_changed_at, service_changed_by)
  on public.companies from authenticated, anon;

-- 3. Notismallar (sv-SE) för service-state – krävs för att notify_event ska skapa notiser.
insert into public.notification_templates (event_type, channel, lang, subject, body, required_vars, is_active) values
 ('service_paused','in_app','sv-SE','Ditt BokPilot-konto är pausat',
  'Ditt BokPilot-konto för {{companyName}} är tillfälligt pausat. Orsak: {{reason}}. Kontakta support för att återaktivera.',
  '{}'::text[], true),
 ('service_paused','email','sv-SE','Ditt BokPilot-konto är pausat',
  'Hej,\n\nDitt BokPilot-konto för {{companyName}} är tillfälligt pausat sedan {{date}}.\n\nOrsak: {{reason}}\n\nKontakta support för att återaktivera tjänsten: {{actionUrl}}\n\nDin bokföringsdata är oförändrad och raderas inte.',
  array['actionUrl'], true),
 ('service_blocked','in_app','sv-SE','Ditt BokPilot-konto är blockerat',
  'Ditt BokPilot-konto för {{companyName}} är blockerat. Orsak: {{reason}}. Kontakta support.',
  '{}'::text[], true),
 ('service_blocked','email','sv-SE','Ditt BokPilot-konto är blockerat',
  'Hej,\n\nDitt BokPilot-konto för {{companyName}} är blockerat sedan {{date}}.\n\nOrsak: {{reason}}\n\nKontakta support: {{actionUrl}}\n\nDin data är oförändrad och raderas inte.',
  array['actionUrl'], true),
 ('service_reactivated','in_app','sv-SE','Ditt BokPilot-konto är återaktiverat',
  'Ditt BokPilot-konto för {{companyName}} är åter aktivt. Välkommen tillbaka!',
  '{}'::text[], true),
 ('service_reactivated','email','sv-SE','Ditt BokPilot-konto är återaktiverat',
  'Hej,\n\nDitt BokPilot-konto för {{companyName}} är åter aktivt sedan {{date}}. Välkommen tillbaka!\n\nÖppna BokPilot: {{actionUrl}}',
  array['actionUrl'], true)
on conflict (event_type, channel, lang) do nothing;

-- 4. Mutation: pausa/blockera/återaktivera. Gate = can_manage_operations() (superadmin/operations_admin).
--    read_only/support/billing nekas. Audit + (valfri) notis till företagets admins.
create or replace function public.admin_set_company_service_state(
  p_company_id uuid, p_state text, p_reason text default null, p_note text default null, p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_prev text; v_name text; v_admins uuid[]; v_label text; v_event text;
begin
  if not public.can_manage_operations() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_state not in ('active','paused','blocked') then raise exception 'ogiltigt service-state' using errcode='22023'; end if;
  select service_state, name into v_prev, v_name from public.companies where id = p_company_id;
  if v_prev is null then raise exception 'företag saknas' using errcode='P0002'; end if;

  update public.companies set
    service_state = p_state,
    service_reason = case when p_state = 'active' then null else p_reason end,
    service_note = case when p_state = 'active' then null else p_note end,
    service_changed_at = now(),
    service_changed_by = auth.uid(),
    suspended = (p_state <> 'active')          -- håll legacy-låset i synk
  where id = p_company_id;

  perform public.log_platform_audit('company_service_state_changed', p_company_id::text,
    jsonb_build_object('previous_state', v_prev, 'new_state', p_state, 'reason', p_reason, 'notified', p_notify));

  if p_notify then
    v_label := case p_state when 'paused' then 'tillfälligt pausat' when 'blocked' then 'blockerat' else 'återaktiverat' end;
    v_event := case p_state when 'active' then 'service_reactivated' when 'blocked' then 'service_blocked' else 'service_paused' end;
    select array_agg(user_id) into v_admins from public.user_companies where company_id = p_company_id and role = 'admin';
    perform public.notify_event(
      p_company_id, v_event,
      jsonb_build_object('companyName', v_name, 'stateLabel', v_label, 'reason', coalesce(nullif(p_reason,''),'—'),
        'date', to_char(now(),'YYYY-MM-DD'), 'actionUrl', 'https://app.bokpilot.se/support'),
      'company', p_company_id, 'https://app.bokpilot.se/support',
      v_admins, auth.uid(), case when p_state = 'blocked' then 'high' else 'normal' end,
      null, array['in_app','email']);
  end if;

  return jsonb_build_object('company_id', p_company_id, 'previous_state', v_prev, 'new_state', p_state);
end $$;

-- 5. Företagslista (admin-översikt). Gate = can_view_operations() (inkl. read_only_admin/superadmin).
create or replace function public.admin_list_companies(p_search text default null, p_state text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_view_operations() then raise exception 'forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(r)) from (
    select c.id company_id, c.name, c.org_nr, c.email, c.archive_number::text archive_number,
      coalesce(c.service_state,'active') service_state, c.service_reason, c.service_changed_at,
      s.status sub_status, p.name plan_name, s.billing_period,
      (select count(*) from user_companies uc where uc.company_id = c.id) user_count,
      (select count(*) from documents d where d.company_id = c.id) document_count,
      (select count(*) from support_tickets t where t.company_id = c.id and t.status not in ('resolved','closed')) open_tickets,
      greatest(
        (select max(created_at) from documents d where d.company_id = c.id),
        (select max(created_at) from verifikationer v where v.company_id = c.id)) last_activity,
      (select max(uu.last_sign_in_at) from auth.users uu
         join user_companies uc2 on uc2.user_id = uu.id where uc2.company_id = c.id) last_login,
      case
        when coalesce(c.service_state,'active') in ('paused','blocked') then 'blocked'
        when s.status = 'past_due' then 'at_risk'
        when (select count(*) from support_tickets t where t.company_id = c.id and t.status not in ('resolved','closed')) > 3 then 'warning'
        else 'healthy'
      end risk
    from companies c
    left join company_subscriptions s on s.company_id = c.id
    left join subscription_plans p on p.id = s.plan_id
    where (p_search is null
        or c.name ilike '%'||p_search||'%' or c.org_nr ilike '%'||p_search||'%'
        or c.email ilike '%'||p_search||'%' or coalesce(c.archive_number::text,'') ilike '%'||p_search||'%')
      and (p_state is null
        or (p_state in ('active','paused','blocked') and coalesce(c.service_state,'active') = p_state)
        or (p_state in ('trial','past_due','cancelled','expired','suspended') and s.status = p_state))
    order by c.name limit 500) r), '[]'::jsonb);
end $$;

-- 6. Företagsprofil (detalj). Gate = can_view_operations().
create or replace function public.admin_get_company(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_view_operations() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'company', (select to_jsonb(x) from (
      select id, name, org_nr, vat_nr, email, phone, address, postnr, postort, archive_number::text archive_number,
        company_number, foretagsform, momsperiod, valuta, created_at, onboarded,
        coalesce(service_state,'active') service_state, service_reason, service_note, service_changed_at, service_changed_by, suspended
      from companies where id = p_company_id) x),
    'users', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', uc.user_id, 'email', coalesce(uc.email, uu.email), 'role', uc.role, 'last_sign_in_at', uu.last_sign_in_at)
        order by uc.role), '[]'::jsonb)
      from user_companies uc left join auth.users uu on uu.id = uc.user_id where uc.company_id = p_company_id),
    'subscription', (select to_jsonb(x) from (
      select s.status, s.billing_period, p.name plan_name, s.trial_ends_at, s.current_period_start, s.current_period_end,
        s.cancelled_at, s.suspended_at, s.payment_provider, s.payment_status, s.last_payment_at, s.next_billing_at
      from company_subscriptions s left join subscription_plans p on p.id = s.plan_id where s.company_id = p_company_id) x),
    'usage', jsonb_build_object(
      'users', (select count(*) from user_companies where company_id = p_company_id),
      'documents', (select count(*) from documents where company_id = p_company_id),
      'verifikationer', (select count(*) from verifikationer where company_id = p_company_id),
      'inbound', (select count(*) from documents where company_id = p_company_id and source = 'email'),
      'open_tickets', (select count(*) from support_tickets where company_id = p_company_id and status not in ('resolved','closed'))),
    'recent_inbound', (select coalesce(jsonb_agg(jsonb_build_object(
        'file_name', file_name, 'kategori', kategori, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from (select file_name, kategori, created_at from documents where company_id = p_company_id and source = 'email' order by created_at desc limit 5) d),
    'support', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'subject', subject, 'status', status, 'priority', priority, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from (select id, subject, status, priority, created_at from support_tickets where company_id = p_company_id order by created_at desc limit 8) t),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object(
        'action', action, 'actor_email', actor_email, 'detail', detail, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from (select action, actor_email, detail, created_at from platform_audit_log where target = p_company_id::text order by created_at desc limit 20) a)
  ) into v;
  if (v->'company') is null then raise exception 'företag saknas' using errcode='P0002'; end if;
  return v;
end $$;
