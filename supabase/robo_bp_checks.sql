-- ROBO-bp Steg 2C: minimal, ISOLERAD kontrollpunkt/uppgift från ROBO-bp:s findings/observations.
-- INGEN bokföring, inga konteringsförslag, rör aldrig verifikationer/fakturor. Read-only koppling till AI-förslag.
create table if not exists public.robo_bp_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null default 'robo_bp',
  view text,
  fiscal_year_id uuid,
  title text not null,
  description text,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high', 'critical')),
  affected_objects jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  conversation_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_robo_checks_company on public.robo_bp_checks(company_id, status, created_at desc);

alter table public.robo_bp_checks enable row level security;
drop policy if exists robo_checks_select on public.robo_bp_checks;
create policy robo_checks_select on public.robo_bp_checks for select using (company_id in (select user_company_ids()));

-- Skapa kontrollpunkt: medlemskap + licens (robo_bp) + roll (ej uttalat read-only). Dedup vid dubbelklick.
-- Audit (check_created) = ENDAST metadata: source, view, risk_level, affected ids, check id. Ingen titel/beskrivning, ingen frågetext.
create or replace function public.robo_bp_create_check(
  p_company uuid, p_view text, p_fiscal_year_id uuid, p_title text, p_description text,
  p_risk_level text, p_affected_objects jsonb default '[]'::jsonb, p_conversation_id uuid default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_role text; v_id uuid; v_risk text; v_aff jsonb;
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

  -- Dedup: öppen kontrollpunkt med samma konversation + titel → returnera befintlig (ingen dubblett).
  select id into v_id from public.robo_bp_checks
    where company_id = p_company and status = 'open' and title = left(p_title, 200)
      and coalesce(conversation_id::text, '') = coalesce(p_conversation_id::text, '')
    order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.robo_bp_checks(company_id, source, view, fiscal_year_id, title, description, risk_level, affected_objects, status, conversation_id, created_by)
    values (p_company, 'robo_bp', p_view, p_fiscal_year_id, left(p_title, 200), left(coalesce(p_description, ''), 2000), v_risk, v_aff, 'open', p_conversation_id, auth.uid())
    returning id into v_id;

  insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
    values (p_company, auth.uid(), 'check_created', jsonb_build_object(
      'source', 'robo_bp', 'view', p_view, 'risk_level', v_risk, 'checkId', v_id,
      'affectedIds', (select coalesce(jsonb_agg(o->>'id'), '[]'::jsonb) from jsonb_array_elements(v_aff) o)));
  return v_id;
end $$;
