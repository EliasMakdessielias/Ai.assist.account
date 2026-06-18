-- Robust quota-/jobbhantering för AI-tolkning (OCR) av kvitton/leverantörsfakturor.
-- Mål: 429 RESOURCE_EXHAUSTED ska INTE leda till retry-storm; cooldown per
-- användare/företag/dokument; idempotenta jobb (dubbelklick återanvänder jobbet);
-- felsökbar quota-logg; korrekta dokumentstatusar.

-- 1) Dokumentets AI-jobbtillstånd ------------------------------------------------
alter table public.documents
  add column if not exists ai_status text,            -- queued|processing|quota_limited|needs_review|completed|failed
  add column if not exists ai_attempts int not null default 0,
  add column if not exists ai_cooldown_until timestamptz,
  add column if not exists ai_job_id uuid,
  add column if not exists ai_job_started_at timestamptz,
  add column if not exists ai_last_error text;

-- 2) Cooldown per scope (document/user/company) ---------------------------------
create table if not exists public.ai_cooldowns (
  scope text not null check (scope in ('document', 'user', 'company')),
  scope_key text not null,
  cooldown_until timestamptz not null,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (scope, scope_key)
);
create index if not exists ai_cooldowns_until_idx on public.ai_cooldowns (cooldown_until);
alter table public.ai_cooldowns enable row level security;  -- endast service role (edge) rör tabellen

-- 3) Anropslogg för rate limit per användare/företag ----------------------------
create table if not exists public.ai_call_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  company_id uuid,
  document_id uuid
);
create index if not exists ai_call_log_recent_idx on public.ai_call_log (created_at);
alter table public.ai_call_log enable row level security;

-- 4) Felsökbar AI-/quota-felslogg (exakt provider/modell/status/body/request id) -
create table if not exists public.ai_error_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text,
  model text,
  status_code int,
  error_code text,
  error_body text,
  request_id text,
  attempts int,
  kind text,
  user_id uuid,
  company_id uuid,
  document_id uuid
);
create index if not exists ai_error_log_doc_idx on public.ai_error_log (document_id, created_at desc);
alter table public.ai_error_log enable row level security;
drop policy if exists ai_error_log_select on public.ai_error_log;
create policy ai_error_log_select on public.ai_error_log for select
  using (company_id in (select company_id from public.user_companies where user_id = auth.uid()));

-- 5) Generisk systemfelslogg (så report_system_error faktiskt sparar) -----------
create table if not exists public.system_error_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  component text,
  message text,
  severity text,
  error_code text,
  metadata jsonb,
  company_id uuid
);
create index if not exists system_error_log_recent_idx on public.system_error_log (occurred_at desc);
alter table public.system_error_log enable row level security;

-- 6) report_system_error – 7-arg-overload som FAKTISKT sparar felet -------------
-- (Edge-funktionerna anropar med p_severity/p_error_code/p_metadata/p_occurred_at;
--  tidigare fanns bara 3-arg-versionen → anropen misslyckades tyst.)
drop function if exists public.report_system_error(text, text, uuid, text, text, jsonb, timestamptz);
create function public.report_system_error(
  p_component text, p_message text, p_company_id uuid default null,
  p_severity text default 'error', p_error_code text default null,
  p_metadata jsonb default '{}'::jsonb, p_occurred_at timestamptz default now()
) returns uuid
  language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  insert into public.system_error_log(component, message, severity, error_code, metadata, company_id, occurred_at)
  values (p_component, left(coalesce(p_message, ''), 4000), p_severity, p_error_code, p_metadata, p_company_id, coalesce(p_occurred_at, now()))
  returning id into v_id;
  -- behåll admin-notisen (best effort, får ej fela)
  begin perform public.report_system_error(p_component, p_message, p_company_id); exception when others then null; end;
  return v_id;
end $$;

-- 7) Claim av AI-jobb: cooldown + rate limit + idempotens + processing-lås -------
create or replace function public.ai_claim_job(p_document_id uuid, p_company_id uuid, p_user_id uuid)
  returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
  v_scope text; v_until timestamptz;
  v_doc record; v_job uuid;
  v_user_calls int; v_company_calls int;
begin
  -- a) aktiv cooldown (dokument/användare/företag) – ta den som varar längst
  select scope, cooldown_until into v_scope, v_until from public.ai_cooldowns
   where cooldown_until > v_now
     and ((scope = 'document' and scope_key = p_document_id::text)
       or (scope = 'user' and scope_key = p_user_id::text)
       or (scope = 'company' and scope_key = p_company_id::text))
   order by cooldown_until desc limit 1;
  if v_until is not null then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown', 'scope', v_scope,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_until - v_now)))::int));
  end if;

  -- b) dokumentet finns?
  select id, ai_status, ai_job_id, ai_job_started_at into v_doc
    from public.documents where id = p_document_id and company_id = p_company_id;
  if v_doc.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  -- c) jobb redan igång för dokumentet (dubbelklick) → återanvänd
  if v_doc.ai_status = 'processing' and v_doc.ai_job_started_at > v_now - interval '90 seconds' then
    return jsonb_build_object('allowed', false, 'reason', 'in_progress', 'job_id', v_doc.ai_job_id);
  end if;

  -- d) rate limit per användare och företag (senaste 60 s)
  select count(*) filter (where user_id = p_user_id),
         count(*) filter (where company_id = p_company_id)
    into v_user_calls, v_company_calls
    from public.ai_call_log where created_at > v_now - interval '60 seconds';
  if v_user_calls >= 8 or v_company_calls >= 20 then
    insert into public.ai_cooldowns(scope, scope_key, cooldown_until, reason)
      values (case when v_user_calls >= 8 then 'user' else 'company' end,
              case when v_user_calls >= 8 then p_user_id::text else p_company_id::text end,
              v_now + interval '60 seconds', 'rate_limit')
      on conflict (scope, scope_key) do update set cooldown_until = excluded.cooldown_until, reason = excluded.reason, updated_at = v_now;
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited',
      'scope', case when v_user_calls >= 8 then 'user' else 'company' end, 'retry_after_seconds', 60);
  end if;

  -- e) claim: markera processing + räkna upp försök + logga anropet
  v_job := gen_random_uuid();
  update public.documents
     set ai_status = 'processing', ai_job_id = v_job, ai_job_started_at = v_now,
         ai_attempts = coalesce(ai_attempts, 0) + 1
   where id = p_document_id and company_id = p_company_id;
  insert into public.ai_call_log(user_id, company_id, document_id) values (p_user_id, p_company_id, p_document_id);
  return jsonb_build_object('allowed', true, 'job_id', v_job);
end $$;

-- 8) Avsluta AI-jobb: sätt status + ev. cooldown (document/company/user) --------
create or replace function public.ai_finish_job(
  p_document_id uuid, p_company_id uuid, p_status text,
  p_cooldown_seconds int default 0, p_user_id uuid default null, p_error text default null
) returns void
  language plpgsql security definer set search_path to 'public'
as $$
declare v_until timestamptz := now() + make_interval(secs => greatest(0, p_cooldown_seconds));
begin
  update public.documents
     set ai_status = p_status,
         ai_cooldown_until = case when p_cooldown_seconds > 0 then v_until else ai_cooldown_until end,
         ai_last_error = left(coalesce(p_error, ai_last_error), 1000),
         ai_job_started_at = null
   where id = p_document_id and company_id = p_company_id;

  if p_cooldown_seconds > 0 then
    insert into public.ai_cooldowns(scope, scope_key, cooldown_until, reason) values
      ('document', p_document_id::text, v_until, p_status),
      ('company', p_company_id::text, v_until, p_status)
      on conflict (scope, scope_key) do update set cooldown_until = excluded.cooldown_until, reason = excluded.reason, updated_at = now();
    if p_user_id is not null then
      insert into public.ai_cooldowns(scope, scope_key, cooldown_until, reason)
        values ('user', p_user_id::text, v_until, p_status)
        on conflict (scope, scope_key) do update set cooldown_until = excluded.cooldown_until, reason = excluded.reason, updated_at = now();
    end if;
  end if;
end $$;

-- 9) Logga ett AI-/quota-fel (full felkropp för felsökning) ---------------------
create or replace function public.log_ai_error(
  p_provider text, p_model text, p_status_code int, p_error_code text, p_error_body text,
  p_request_id text, p_attempts int, p_kind text, p_user_id uuid, p_company_id uuid, p_document_id uuid
) returns void
  language sql security definer set search_path to 'public'
as $$
  insert into public.ai_error_log(provider, model, status_code, error_code, error_body, request_id, attempts, kind, user_id, company_id, document_id)
  values (p_provider, p_model, p_status_code, p_error_code, left(coalesce(p_error_body, ''), 8000), p_request_id, p_attempts, p_kind, p_user_id, p_company_id, p_document_id);
$$;

-- 10) Säkerhet: dessa skrivande SECURITY DEFINER-funktioner ska bara köras av
-- edge-funktionerna (service_role), inte av inloggade klienter direkt.
revoke all on function public.ai_claim_job(uuid, uuid, uuid) from public;
revoke all on function public.ai_finish_job(uuid, uuid, text, int, uuid, text) from public;
revoke all on function public.log_ai_error(text, text, int, text, text, text, int, text, uuid, uuid, uuid) from public;
revoke all on function public.report_system_error(text, text, uuid, text, text, jsonb, timestamptz) from public;
grant execute on function public.ai_claim_job(uuid, uuid, uuid) to service_role;
grant execute on function public.ai_finish_job(uuid, uuid, text, int, uuid, text) to service_role;
grant execute on function public.log_ai_error(text, text, int, text, text, text, int, text, uuid, uuid, uuid) to service_role;
grant execute on function public.report_system_error(text, text, uuid, text, text, jsonb, timestamptz) to service_role;
