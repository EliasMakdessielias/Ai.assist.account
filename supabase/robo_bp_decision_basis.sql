-- ROBO-bp Steg 2H: confidence/beslutsnivå. ADDITIV migration – nullable fält, inga rader ändras destruktivt.
-- decision_basis = 'system_observation' (från observation) | 'ai_finding' (från finding). confidence_label = systemberäknad.
alter table public.robo_bp_checks add column if not exists decision_basis text;
alter table public.robo_bp_checks add column if not exists confidence_label text;
alter table public.robo_bp_checks drop constraint if exists robo_bp_checks_decision_basis_check;
alter table public.robo_bp_checks add constraint robo_bp_checks_decision_basis_check
  check (decision_basis is null or decision_basis in ('system_observation', 'ai_finding'));

-- Utöka create_check additivt med två nullable param (defaults → bakåtkompatibelt).
drop function if exists public.robo_bp_create_check(uuid, text, uuid, text, text, text, jsonb, uuid);
create function public.robo_bp_create_check(
  p_company uuid, p_view text, p_fiscal_year_id uuid, p_title text, p_description text, p_risk_level text,
  p_affected_objects jsonb default '[]'::jsonb, p_conversation_id uuid default null,
  p_decision_basis text default null, p_confidence_label text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_role text; v_id uuid; v_risk text; v_aff jsonb; v_basis text; v_conf text;
begin
  if p_company is null or p_company not in (select user_company_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.has_ai_feature(p_company, 'robo_bp') then
    insert into public.robo_bp_audit_log(company_id, user_id, action, detail) values (p_company, auth.uid(), 'denied', jsonb_build_object('reason', 'no_license', 'op', 'create_check'));
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select role into v_role from public.user_companies where user_id = auth.uid() and company_id = p_company limit 1;
  if v_role is null or lower(v_role) in ('viewer', 'read_only', 'readonly', 'lasare', 'guest', 'gast') then
    insert into public.robo_bp_audit_log(company_id, user_id, action, detail) values (p_company, auth.uid(), 'denied', jsonb_build_object('reason', 'role', 'op', 'create_check'));
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'title_required' using errcode = '22023'; end if;
  v_risk := case when p_risk_level in ('low', 'medium', 'high', 'critical') then p_risk_level else 'medium' end;
  v_aff := case when jsonb_typeof(p_affected_objects) = 'array' then p_affected_objects else '[]'::jsonb end;
  v_basis := case when p_decision_basis in ('system_observation', 'ai_finding') then p_decision_basis else null end;
  v_conf := nullif(left(coalesce(p_confidence_label, ''), 40), '');

  select id into v_id from public.robo_bp_checks
    where company_id = p_company and status = 'open' and title = left(p_title, 200)
      and coalesce(conversation_id::text, '') = coalesce(p_conversation_id::text, '')
    order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.robo_bp_checks(company_id, source, view, fiscal_year_id, title, description, risk_level, affected_objects, status, conversation_id, created_by, decision_basis, confidence_label)
    values (p_company, 'robo_bp', p_view, p_fiscal_year_id, left(p_title, 200), left(coalesce(p_description, ''), 2000), v_risk, v_aff, 'open', p_conversation_id, auth.uid(), v_basis, v_conf)
    returning id into v_id;

  insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
    values (p_company, auth.uid(), 'check_created', jsonb_build_object(
      'source', 'robo_bp', 'view', p_view, 'risk_level', v_risk, 'checkId', v_id,
      'affectedIds', (select coalesce(jsonb_agg(o->>'id'), '[]'::jsonb) from jsonb_array_elements(v_aff) o),
      'decisionBasis', v_basis, 'confidenceLabel', v_conf));
  return v_id;
end $function$;