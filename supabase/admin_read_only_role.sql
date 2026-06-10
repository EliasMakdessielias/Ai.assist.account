-- =============================================
-- BokPilot Control Center – Fas 1: read_only_admin
-- Femte plattformsrollen. Får SE allt (operations/support/billing) men ALDRIG mutera.
-- Additivt & icke-brytande: befintliga roller/funktioner oförändrade i beteende.
-- Server (RPC/RLS) är auktoritativ. Kör i Supabase SQL Editor (eller via CLI-migration).
-- Bygger på befintliga helpers: is_platform_admin(), is_superadmin(), has_platform_role(),
-- can_manage_operations/billing(), log_platform_audit().
-- =============================================

-- 1. Tillåt rollen i platform_user_roles (utöka CHECK-constrainten).
alter table public.platform_user_roles drop constraint if exists platform_user_roles_role_check;
alter table public.platform_user_roles add constraint platform_user_roles_role_check
  check (role = any (array['superadmin','operations_admin','support_admin','billing_admin','read_only_admin']));

-- 2. Roll-helper.
create or replace function public.is_read_only_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_platform_role('read_only_admin') $$;

-- 3. Läs-gates inkluderar read_only_admin. Manage-gates lämnas OFÖRÄNDRADE
--    (can_manage_operations/can_manage_billing) → read_only kan aldrig mutera.
create or replace function public.can_view_operations()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_platform_role('operations_admin') or public.is_read_only_admin() $$;

create or replace function public.can_view_support()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_platform_role('support_admin') or public.is_read_only_admin() $$;

-- Ny dedikerad läs-gate för billing (manage = can_manage_billing, oförändrad).
create or replace function public.can_view_billing()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_platform_role('billing_admin') or public.is_read_only_admin() $$;

-- 4. Billing-läs-RPC gate:as på can_view_billing (läsning). Skriv-RPC:er (admin_set_*)
--    fortsätter kräva can_manage_billing och ändras INTE här. Body identisk med originalet.
create or replace function public.admin_list_subscriptions(p_status text default null, p_plan_id uuid default null, p_search text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.can_view_billing() then raise exception 'forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(r)) from (
    select c.id company_id, c.name company_name, c.org_nr,
      s.id subscription_id, s.plan_id, p.name plan_name, s.status, s.billing_period,
      s.trial_ends_at, s.current_period_start, s.current_period_end, s.cancelled_at, s.suspended_at,
      s.payment_provider, s.payment_customer_id, s.payment_subscription_id
    from companies c
    left join company_subscriptions s on s.company_id=c.id
    left join subscription_plans p on p.id=s.plan_id
    where (p_status is null or s.status=p_status)
      and (p_plan_id is null or s.plan_id=p_plan_id)
      and (p_search is null or c.name ilike '%'||p_search||'%' or c.org_nr ilike '%'||p_search||'%')
    order by c.name limit 500) r), '[]'::jsonb);
end $$;

-- 5. Grant/revoke accepterar read_only_admin (superadmin hanteras fortsatt via platform_admins).
create or replace function public.admin_grant_platform_role(p_email text, p_role text)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_superadmin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_role not in ('operations_admin','support_admin','billing_admin','read_only_admin') then
    raise exception 'ogiltig roll (superadmin hanteras via platform_admins)' using errcode='22023'; end if;
  insert into public.platform_user_roles(email, role, granted_by) values (lower(p_email), p_role, auth.uid())
    on conflict (email, role) do nothing;
  perform public.log_platform_audit('role_granted', lower(p_email), jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_revoke_platform_role(p_email text, p_role text)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_superadmin() then raise exception 'forbidden' using errcode='42501'; end if;
  delete from public.platform_user_roles where lower(email)=lower(p_email) and role=p_role;
  perform public.log_platform_audit('role_revoked', lower(p_email), jsonb_build_object('role', p_role));
end $$;

-- 6. my_platform_access exponerar isReadOnly + canViewBilling (frontend-gating speglar detta).
create or replace function public.my_platform_access()
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'isSuperadmin', public.is_superadmin(),
    'roles', (select coalesce(array_agg(distinct role), array[]::text[]) from (
        select role from public.platform_user_roles where lower(email)=lower(auth.jwt() ->> 'email')
        union select 'superadmin' where public.is_superadmin()) x),
    'canViewOperations', public.can_view_operations(),
    'canManageOperations', public.can_manage_operations(),
    'canViewSupport', public.can_view_support(),
    'canViewBilling', public.can_view_billing(),
    'canManageBilling', public.can_manage_billing(),
    'isReadOnly', public.is_read_only_admin())
$$;
