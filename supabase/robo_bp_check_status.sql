-- ROBO-bp Steg 2E: minimalt statusflöde för kontrollpunkter (open → in_progress → done / dismissed).
-- Rör ALDRIG verifikationer/fakturor/bokföring. Audit check_status_changed = endast metadata.
update public.robo_bp_checks set status = 'done' where status = 'resolved';
update public.robo_bp_checks set status = 'dismissed' where status = 'ignored';
alter table public.robo_bp_checks drop constraint if exists robo_bp_checks_status_check;
alter table public.robo_bp_checks add constraint robo_bp_checks_status_check
  check (status in ('open', 'in_progress', 'done', 'dismissed'));

create or replace function public.robo_bp_set_check_status(p_check uuid, p_status text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid; v_role text; v_from text; v_view text; v_risk text;
begin
  if p_status not in ('open', 'in_progress', 'done', 'dismissed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select company_id, status, view, risk_level into v_company, v_from, v_view, v_risk from public.robo_bp_checks where id = p_check;
  if v_company is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_company not in (select user_company_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.has_ai_feature(v_company, 'robo_bp') then
    insert into public.robo_bp_audit_log(company_id, user_id, action, detail) values (v_company, auth.uid(), 'denied', jsonb_build_object('reason', 'no_license', 'op', 'set_check_status'));
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select role into v_role from public.user_companies where user_id = auth.uid() and company_id = v_company limit 1;
  if v_role is null or lower(v_role) in ('viewer', 'read_only', 'readonly', 'lasare', 'guest', 'gast') then
    insert into public.robo_bp_audit_log(company_id, user_id, action, detail) values (v_company, auth.uid(), 'denied', jsonb_build_object('reason', 'role', 'op', 'set_check_status'));
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.robo_bp_checks set status = p_status, updated_at = now() where id = p_check;
  insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
    values (v_company, auth.uid(), 'check_status_changed', jsonb_build_object('checkId', p_check, 'fromStatus', v_from, 'toStatus', p_status, 'view', v_view, 'risk_level', v_risk));
  return p_status;
end $$;
