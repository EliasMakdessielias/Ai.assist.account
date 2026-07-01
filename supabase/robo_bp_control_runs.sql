-- ROBO-bp Etapp C1: minimal persisterad "bokföringskontroll" från BEFINTLIGA deterministiska observations.
-- Ingen ny rule-engine, ingen bokföringsmutation, skapar INGA robo_bp_checks (observations lagras i run.summary).
create table if not exists public.robo_bp_control_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  fiscal_year_id uuid,
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  status text not null default 'done' check (status in ('running', 'done', 'error')),
  summary jsonb not null default '{}'::jsonb
);
create index if not exists robo_bp_control_runs_company_idx on public.robo_bp_control_runs (company_id, started_at desc);

alter table public.robo_bp_control_runs enable row level security;
drop policy if exists robo_bp_control_runs_sel on public.robo_bp_control_runs;
create policy robo_bp_control_runs_sel on public.robo_bp_control_runs
  for select using (company_id in (select user_company_ids()));

-- Kör en kontroll: läser summary via robo_bp_context, bygger observations (spegel av observationsFrom),
-- persisterar en run + audit (metadata-only). Muterar ALDRIG bokföring. Kräver medlemskap + licens.
create or replace function public.robo_bp_run_control(p_company uuid, p_fiscal_year_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_sum jsonb; v_obs jsonb := '[]'::jsonb; v_id uuid; n numeric;
begin
  if p_company is null or p_company not in (select user_company_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not public.has_ai_feature(p_company, 'robo_bp') then
    insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
      values (p_company, auth.uid(), 'denied', jsonb_build_object('reason', 'no_license', 'op', 'run_control'));
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_sum := coalesce(public.robo_bp_context(p_company, p_fiscal_year_id, 'oversikt', 'kontrollkorning') -> 'summary', '{}'::jsonb);

  if coalesce((v_sum ->> 'hasFiscalYear')::boolean, false) = false then
    v_obs := v_obs || jsonb_build_object('code', 'no_fiscal_year', 'severity', 'medium', 'text', 'Inget räkenskapsår valt – siffrorna kan avse all historik.', 'count', 0);
  end if;
  n := coalesce((v_sum ->> 'missingVerDesc')::numeric, 0);
  if n > 0 then v_obs := v_obs || jsonb_build_object('code', 'missing_ver_desc', 'severity', 'low', 'text', n || ' verifikation(er) saknar beskrivning.', 'count', n); end if;
  n := coalesce((v_sum ->> 'unbalancedVer')::numeric, 0);
  if n > 0 then v_obs := v_obs || jsonb_build_object('code', 'unbalanced_ver', 'severity', 'high', 'text', n || ' verifikation(er) verkar obalanserade (debet ≠ kredit).', 'count', n); end if;
  n := coalesce((v_sum ->> 'supplierNoName')::numeric, 0);
  if n > 0 then v_obs := v_obs || jsonb_build_object('code', 'supplier_no_name', 'severity', 'low', 'text', n || ' leverantörsfaktura(or) saknar leverantörsnamn.', 'count', n); end if;
  n := coalesce((v_sum ->> 'supOverdue')::numeric, 0);
  if n > 0 then v_obs := v_obs || jsonb_build_object('code', 'supplier_overdue', 'severity', 'medium', 'text', n || ' förfallen(na) leverantörsfaktura(or).', 'count', n); end if;
  n := coalesce((v_sum ->> 'custOverdue')::numeric, 0);
  if n > 0 then v_obs := v_obs || jsonb_build_object('code', 'customer_overdue', 'severity', 'medium', 'text', n || ' förfallen(na) kundfaktura(or).', 'count', n); end if;

  insert into public.robo_bp_control_runs(company_id, fiscal_year_id, started_by, status, summary)
    values (p_company, p_fiscal_year_id, auth.uid(), 'done',
      jsonb_build_object('deviationCount', jsonb_array_length(v_obs), 'observations', v_obs))
    returning id into v_id;

  insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
    values (p_company, auth.uid(), 'control_run_created', jsonb_build_object(
      'runId', v_id, 'fiscalYearId', p_fiscal_year_id, 'deviationCount', jsonb_array_length(v_obs),
      'codes', (select coalesce(jsonb_agg(o ->> 'code'), '[]'::jsonb) from jsonb_array_elements(v_obs) o)));

  return jsonb_build_object('id', v_id, 'deviationCount', jsonb_array_length(v_obs), 'observations', v_obs, 'startedAt', now());
end $$;
