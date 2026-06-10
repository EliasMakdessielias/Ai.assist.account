-- =============================================
-- BokPilot Control Center – Fas 3: Stripe/abonnemang ↔ service_state-koppling
-- Återanvänder befintlig Stripe-adapter (stripe_handle_event/map_stripe_status/stripe_event_log,
-- edge stripe-checkout/portal/webhook). Lägger till: grace period, betalningsstatus-fält och
-- KOPPLING betalningsstatus → companies.service_state (Fas 2-låset) med skydd för admin-manuell lås.
--
-- Två-fälts-modell (ingen parallell modell):
--   company_subscriptions.status = billing-livscykel (trial/active/past_due/suspended/cancelled/expired)
--   companies.service_state       = appåtkomst (active/paused/blocked)  ← kopplas här
-- Policy: trial/active→active; past_due inom grace→active, efter grace→paused;
--   cancelled/expired/suspended→paused. blocked sätts ENDAST manuellt av admin.
-- Admin-skydd (krav 7): om service_state_manual=true (admin satte paused/blocked) rör Stripe det ALDRIG.
-- Kör i Supabase SQL Editor. Additivt & icke-brytande.
-- =============================================

-- 0. Beroende: läs-gate för billing (från admin_read_only_role.sql). Skapas idempotent här så att
--    denna migration är självständig även om read_only-rollmigrationen inte körts än.
create or replace function public.is_read_only_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_platform_role('read_only_admin') $$;
create or replace function public.can_view_billing()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_platform_role('billing_admin') or public.is_read_only_admin() $$;

-- 1. Saknade fält på company_subscriptions (återanvänder befintliga payment_*-kolumner för Stripe-id:n).
alter table public.company_subscriptions add column if not exists grace_until timestamptz;
alter table public.company_subscriptions add column if not exists cancel_at timestamptz;
alter table public.company_subscriptions add column if not exists last_payment_failed_at timestamptz;
alter table public.company_subscriptions add column if not exists next_payment_attempt_at timestamptz;
alter table public.company_subscriptions add column if not exists stripe_latest_invoice_id text;
alter table public.company_subscriptions add column if not exists discount_percent numeric;

-- 2. Flagga för admin-manuell service_state-lås (skyddas mot Stripe-överskrivning).
alter table public.companies add column if not exists service_state_manual boolean not null default false;

-- 3. admin_set_company_service_state sätter manual-flaggan (paused/blocked = manuell lås; active = släpp).
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
    service_state_manual = (p_state <> 'active'),     -- manuell lås kvar tills admin återaktiverar
    suspended = (p_state <> 'active')
  where id = p_company_id;

  perform public.log_platform_audit('company_service_state_changed', p_company_id::text,
    jsonb_build_object('previous_state', v_prev, 'new_state', p_state, 'reason', p_reason, 'notified', p_notify, 'source','admin'));

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

-- 4. Kärnkoppling: härled service_state ur billing-status + grace. Respekterar admin-manuell lås (krav 7).
create or replace function public.sync_company_service_state_from_billing(p_company uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_sub record; v_cur text; v_manual boolean; v_target text; v_name text; v_admins uuid[];
begin
  select * into v_sub from public.company_subscriptions where company_id = p_company;
  if not found then return 'no_subscription'; end if;
  select service_state, coalesce(service_state_manual,false), name into v_cur, v_manual, v_name from public.companies where id = p_company;
  if v_manual then return 'manual_lock_respected'; end if;   -- admin har manuellt satt paused/blocked → rör ej

  v_target := case
    when v_sub.status in ('trial','active') then 'active'
    when v_sub.status = 'past_due' then case when v_sub.grace_until is null or v_sub.grace_until > now() then 'active' else 'paused' end
    when v_sub.status in ('cancelled','expired','suspended') then 'paused'
    else 'active' end;

  if v_target is distinct from coalesce(v_cur,'active') then
    update public.companies set
      service_state = v_target,
      service_reason = case when v_target='active' then null else 'Utebliven betalning' end,
      service_changed_at = now(), service_changed_by = null, service_state_manual = false,
      suspended = (v_target <> 'active')
    where id = p_company;
    perform public.log_platform_audit('billing_service_state_'||v_target, p_company::text,
      jsonb_build_object('from', v_cur, 'to', v_target, 'sub_status', v_sub.status, 'source', 'stripe'));
    if v_target = 'paused' then
      select array_agg(user_id) into v_admins from public.user_companies where company_id=p_company and role='admin';
      perform public.notify_event(p_company, 'account_paused_unpaid',
        jsonb_build_object('companyName', v_name, 'actionUrl', 'https://app.bokpilot.se/support'),
        'company', p_company, 'https://app.bokpilot.se/support', v_admins, null, 'high',
        'account_paused_unpaid:'||p_company::text||':'||to_char(now(),'YYYY-MM-DD'), array['in_app','email']);
    end if;
  end if;
  return v_target;
end $$;

-- 5. Schemalagd grace-enforcement: past_due vars grace gått ut → paused (om ej admin-manuell lås).
create or replace function public.run_subscription_grace_enforcement()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in
    select cs.company_id from public.company_subscriptions cs join public.companies c on c.id = cs.company_id
    where cs.status = 'past_due' and cs.grace_until is not null and cs.grace_until <= now()
      and coalesce(c.service_state,'active') = 'active' and coalesce(c.service_state_manual,false) = false
  loop
    perform public.sync_company_service_state_from_billing(r.company_id);
    n := n + 1;
  end loop;
  perform public.log_platform_audit('subscription_grace_enforcement_run', 'system', jsonb_build_object('paused', n));
  return n;
end $$;

-- 6. Stripe webhook-brain: utöka med invoice-id + nästa försök + grace + service_state-koppling.
--    Drop:a gamla signaturen och skapa ny (2 nya parametrar) för att undvika overload-tvetydighet.
drop function if exists public.stripe_handle_event(text,text,text,text,text,text,timestamptz,timestamptz,text);
create or replace function public.stripe_handle_event(
  p_event_id text, p_type text, p_customer_id text default null, p_subscription_id text default null,
  p_price_id text default null, p_stripe_status text default null, p_period_start timestamptz default null,
  p_period_end timestamptz default null, p_client_reference text default null,
  p_invoice_id text default null, p_next_attempt timestamptz default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid; v_plan uuid; v_period text; v_status text; v_planname text; v_admins uuid[]; v_old_plan uuid;
begin
  begin insert into stripe_event_log(event_id, type) values (p_event_id, p_type);
  exception when unique_violation then return 'duplicate'; end;

  if p_client_reference is not null then
    begin v_company := p_client_reference::uuid; exception when others then v_company := null; end;
  end if;
  if v_company is null and p_customer_id is not null then
    select company_id into v_company from company_subscriptions where payment_customer_id = p_customer_id;
  end if;
  if v_company is null then return 'no_company'; end if;

  select plan_id into v_old_plan from company_subscriptions where company_id=v_company;

  if p_type = 'checkout.session.completed' then
    update company_subscriptions set payment_provider='stripe', payment_customer_id=coalesce(p_customer_id,payment_customer_id),
      payment_subscription_id=coalesce(p_subscription_id,payment_subscription_id), payment_checkout_session_id=p_event_id, updated_at=now()
      where company_id=v_company;
    perform public.log_platform_audit('stripe_checkout_completed', v_company::text, jsonb_build_object('subscription_id',p_subscription_id));

  elsif p_type in ('customer.subscription.created','customer.subscription.updated') then
    if p_price_id is not null then
      select id, 'monthly' into v_plan, v_period from subscription_plans where stripe_price_monthly = p_price_id;
      if v_plan is null then select id, 'yearly' into v_plan, v_period from subscription_plans where stripe_price_yearly = p_price_id; end if;
      if v_plan is null then
        perform public.report_system_error('stripe-webhook', 'Okänt Stripe price_id: '||p_price_id, v_company, 'error', 'unknown_price_id',
          jsonb_build_object('price_id', p_price_id, 'subscription_id', p_subscription_id));
        return 'unknown_price';
      end if;
    end if;
    v_status := public.map_stripe_status(p_stripe_status);
    update company_subscriptions set
      plan_id = coalesce(v_plan, plan_id), billing_period = coalesce(v_period, billing_period),
      status = coalesce(v_status, status), payment_provider='stripe',
      payment_customer_id=coalesce(p_customer_id,payment_customer_id), payment_subscription_id=coalesce(p_subscription_id,payment_subscription_id),
      payment_price_id=coalesce(p_price_id,payment_price_id),
      current_period_start=coalesce(p_period_start,current_period_start), current_period_end=coalesce(p_period_end,current_period_end),
      next_billing_at=coalesce(p_period_end,next_billing_at), updated_at=now()
      where company_id=v_company;
    perform public.log_platform_audit('stripe_subscription_synced', v_company::text, jsonb_build_object('status',v_status,'plan_id',v_plan));
    if v_plan is not null and v_plan is distinct from v_old_plan then
      select name into v_planname from subscription_plans where id=v_plan;
      perform public.notify_event(v_company, 'plan_changed',
        jsonb_build_object('planName',coalesce(v_planname,''),'actionUrl','https://app.bokpilot.se/installningar/abonnemang'),
        'subscription', null, '/installningar/abonnemang', null, null, 'normal');
    end if;

  elsif p_type = 'customer.subscription.deleted' then
    update company_subscriptions set status='cancelled', cancelled_at=now(), cancel_at=coalesce(cancel_at,now()), updated_at=now() where company_id=v_company;
    select name into v_planname from subscription_plans where id=v_old_plan;
    perform public.notify_event(v_company, 'subscription_cancelled',
      jsonb_build_object('planName',coalesce(v_planname,'ditt abonnemang'),'actionUrl','https://app.bokpilot.se/installningar/abonnemang'),
      'subscription', null, '/installningar/abonnemang', null, null, 'normal');
    select public.billing_admin_ids() into v_admins;
    if v_admins is not null then perform public.notify_event(v_company,'subscription_cancelled',
      jsonb_build_object('planName',coalesce(v_planname,''),'actionUrl','https://app.bokpilot.se/admin/billing'),
      'subscription', null, '/admin/billing', v_admins, null, 'normal', null, array['in_app']); end if;
    perform public.log_platform_audit('stripe_subscription_cancelled', v_company::text, '{}'::jsonb);

  elsif p_type = 'invoice.finalized' then
    update company_subscriptions set stripe_latest_invoice_id=coalesce(p_invoice_id,stripe_latest_invoice_id), updated_at=now() where company_id=v_company;

  elsif p_type = 'invoice.payment_succeeded' then
    update company_subscriptions set payment_status='paid', last_payment_at=now(),
      grace_until=null, last_payment_failed_at=null, next_payment_attempt_at=null,
      stripe_latest_invoice_id=coalesce(p_invoice_id,stripe_latest_invoice_id),
      next_billing_at=coalesce(p_period_end,next_billing_at),
      status=case when status in ('past_due','suspended') then 'active' else status end, updated_at=now()
      where company_id=v_company;
    select name into v_planname from subscription_plans where id=v_old_plan;
    perform public.notify_event(v_company, 'payment_succeeded',
      jsonb_build_object('planName',coalesce(v_planname,'din plan'),'nextBilling',to_char(coalesce(p_period_end,now()),'YYYY-MM-DD'),'actionUrl','https://app.bokpilot.se/installningar/abonnemang'),
      'subscription', null, '/installningar/abonnemang', null, null, 'normal');
    perform public.log_platform_audit('stripe_payment_succeeded', v_company::text, '{}'::jsonb);

  elsif p_type = 'invoice.payment_failed' then
    update company_subscriptions set payment_status='failed', status='past_due',
      last_payment_failed_at=now(), next_payment_attempt_at=p_next_attempt,
      stripe_latest_invoice_id=coalesce(p_invoice_id,stripe_latest_invoice_id),
      grace_until = now() + interval '7 days',           -- grace 7 dagar från senaste misslyckande
      updated_at=now() where company_id=v_company;
    select name into v_planname from subscription_plans where id=v_old_plan;
    perform public.notify_event(v_company, 'payment_failed',
      jsonb_build_object('planName',coalesce(v_planname,'din plan'),'actionUrl','https://app.bokpilot.se/installningar/abonnemang'),
      'subscription', null, '/installningar/abonnemang', null, null, 'high');
    perform public.notify_event(v_company, 'grace_period_started',
      jsonb_build_object('companyName',(select name from companies where id=v_company),'graceDays','7','actionUrl','https://app.bokpilot.se/installningar/abonnemang'),
      'subscription', null, '/installningar/abonnemang', null, null, 'high',
      'grace_period_started:'||v_company::text||':'||to_char(now(),'YYYY-MM-DD'), array['in_app','email']);
    select public.billing_admin_ids() into v_admins;
    if v_admins is not null then perform public.notify_event(v_company,'payment_failed',
      jsonb_build_object('planName',coalesce(v_planname,''),'actionUrl','https://app.bokpilot.se/admin/billing'),
      'subscription', null, '/admin/billing', v_admins, null, 'high', null, array['in_app','email']); end if;
    perform public.log_platform_audit('stripe_payment_failed', v_company::text, '{}'::jsonb);
  end if;

  -- Koppla betalningsstatus → service_state (respekterar admin-manuell lås).
  perform public.sync_company_service_state_from_billing(v_company);
  return 'ok';
end $$;

-- 7. Admin-RPC:er (gate can_manage_billing, audit).
create or replace function public.admin_set_subscription_grace(p_company_id uuid, p_grace_until timestamptz)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_manage_billing() then raise exception 'forbidden' using errcode='42501'; end if;
  update public.company_subscriptions set grace_until = p_grace_until, updated_at = now() where company_id = p_company_id;
  perform public.log_platform_audit('admin_set_grace', p_company_id::text, jsonb_build_object('grace_until', p_grace_until));
  return public.sync_company_service_state_from_billing(p_company_id);
end $$;

create or replace function public.admin_set_subscription_discount(p_company_id uuid, p_percent numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_manage_billing() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then raise exception 'ogiltig rabatt (0-100)' using errcode='22023'; end if;
  update public.company_subscriptions set discount_percent = p_percent, updated_at = now() where company_id = p_company_id;
  perform public.log_platform_audit('admin_set_discount', p_company_id::text, jsonb_build_object('percent', p_percent));
end $$;

create or replace function public.admin_sync_service_state(p_company_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_manage_billing() then raise exception 'forbidden' using errcode='42501'; end if;
  return public.sync_company_service_state_from_billing(p_company_id);
end $$;

-- 8. admin_list_subscriptions exponerar betalningsfält (för admin-UI + metrics). Body = original + nya kolumner.
create or replace function public.admin_list_subscriptions(p_status text default null, p_plan_id uuid default null, p_search text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_view_billing() then raise exception 'forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(r)) from (
    select c.id company_id, c.name company_name, c.org_nr,
      s.id subscription_id, s.plan_id, p.name plan_name, s.status, s.billing_period,
      s.trial_ends_at, s.current_period_start, s.current_period_end, s.cancelled_at, s.suspended_at,
      s.payment_provider, s.payment_customer_id, s.payment_subscription_id,
      s.payment_status, s.grace_until, s.last_payment_failed_at, s.next_payment_attempt_at, s.discount_percent
    from companies c
    left join company_subscriptions s on s.company_id=c.id
    left join subscription_plans p on p.id=s.plan_id
    where (p_status is null or s.status=p_status)
      and (p_plan_id is null or s.plan_id=p_plan_id)
      and (p_search is null or c.name ilike '%'||p_search||'%' or c.org_nr ilike '%'||p_search||'%')
    order by c.name limit 500) r), '[]'::jsonb);
end $$;

-- 8b. admin_get_subscription exponerar service_state + manual-flagga (för admin-UI:t).
create or replace function public.admin_get_subscription(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_manage_billing() then raise exception 'forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
    'company', (select jsonb_build_object('id',id,'name',name,'org_nr',org_nr,
        'service_state',coalesce(service_state,'active'),'service_state_manual',coalesce(service_state_manual,false))
      from companies where id=p_company_id),
    'subscription', (select row_to_json(s) from company_subscriptions s where s.company_id=p_company_id),
    'plan', (select row_to_json(p) from subscription_plans p where p.id=(select plan_id from company_subscriptions where company_id=p_company_id))
  ) into v;
  return v;
end $$;

-- 9. Notismallar (sv-SE) för grace + paused efter utebliven betalning.
insert into public.notification_templates (event_type, channel, lang, subject, body, required_vars, is_active) values
 ('grace_period_started','in_app','sv-SE','Betalning misslyckades – åtgärda inom {{graceDays}} dagar',
  'En betalning för {{companyName}} misslyckades. Du har {{graceDays}} dagar på dig att åtgärda innan kontot pausas.',
  '{}'::text[], true),
 ('grace_period_started','email','sv-SE','Betalning misslyckades – åtgärda inom {{graceDays}} dagar',
  'Hej,\n\nEn betalning för {{companyName}} misslyckades. Du har {{graceDays}} dagar på dig att uppdatera betalningen innan tjänsten pausas.\n\nHantera abonnemang: {{actionUrl}}\n\nDin data är oförändrad.',
  array['actionUrl'], true),
 ('account_paused_unpaid','in_app','sv-SE','Ditt BokPilot-konto är pausat (utebliven betalning)',
  'Kontot för {{companyName}} är pausat efter utebliven betalning. Uppdatera betalningen eller kontakta support för att återaktivera.',
  '{}'::text[], true),
 ('account_paused_unpaid','email','sv-SE','Ditt BokPilot-konto är pausat (utebliven betalning)',
  'Hej,\n\nKontot för {{companyName}} är pausat efter utebliven betalning. Din bokföringsdata är oförändrad och raderas inte.\n\nKontakta support eller uppdatera betalningen: {{actionUrl}}',
  array['actionUrl'], true)
on conflict (event_type, channel, lang) do nothing;

-- 10. Schemalägg grace-enforcement dagligen (06:15). Exception-säker (bryter ej migrationen om pg_cron saknas).
do $$
begin
  perform cron.schedule('bokpilot-subscription-grace', '15 6 * * *', $cron$select public.run_subscription_grace_enforcement()$cron$);
exception when others then
  raise notice 'pg_cron ej tillgänglig – schemalägg run_subscription_grace_enforcement() manuellt: %', sqlerrm;
end $$;
