-- ROBO-bp Etapp C2 (migration robo_bp_control_observation_status): status per observation i en kontrollkörning.
-- run_control initierar status='open' på varje observation. Ny RPC sätter status (open/resolved/dismissed).
-- Rör ENDAST robo_bp_control_runs.summary – ALDRIG verifikationer/fakturor/konton/robo_bp_checks.
-- (run_control-kroppen är identisk med robo_bp_control_runs.sql men med 'status','open' tillagt per observation.)

create or replace function public.robo_bp_set_control_observation_status(p_run_id uuid, p_code text, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid; v_fy uuid; v_sum jsonb; v_new jsonb := '[]'::jsonb; o jsonb; v_from text; v_found boolean := false;
begin
  if p_status not in ('open', 'resolved', 'dismissed') then raise exception 'invalid_status' using errcode = '22023'; end if;
  select company_id, fiscal_year_id, summary into v_company, v_fy, v_sum from public.robo_bp_control_runs where id = p_run_id;
  if v_company is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_company not in (select user_company_ids()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public.has_ai_feature(v_company, 'robo_bp') then
    insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
      values (v_company, auth.uid(), 'denied', jsonb_build_object('reason', 'no_license', 'op', 'set_control_observation_status'));
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for o in select * from jsonb_array_elements(coalesce(v_sum -> 'observations', '[]'::jsonb)) loop
    if o ->> 'code' = p_code then
      v_from := coalesce(o ->> 'status', 'open'); v_found := true;
      o := jsonb_set(o, '{status}', to_jsonb(p_status));
      o := jsonb_set(o, '{marked_by}', to_jsonb(auth.uid()::text));
      o := jsonb_set(o, '{marked_at}', to_jsonb(now()::text));
    end if;
    v_new := v_new || o;
  end loop;
  if not v_found then raise exception 'code_not_found' using errcode = 'P0002'; end if;

  update public.robo_bp_control_runs set summary = jsonb_set(v_sum, '{observations}', v_new) where id = p_run_id;

  insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
    values (v_company, auth.uid(), 'control_observation_status_changed', jsonb_build_object(
      'runId', p_run_id, 'code', p_code, 'fromStatus', v_from, 'toStatus', p_status, 'fiscalYearId', v_fy));

  return jsonb_build_object('runId', p_run_id, 'code', p_code, 'fromStatus', v_from, 'toStatus', p_status);
end $$;
