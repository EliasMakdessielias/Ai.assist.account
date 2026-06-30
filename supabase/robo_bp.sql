-- ROBO-bp – kontrollerad AI-bokföringsassistent. Steg 1: konversationer, meddelanden,
-- bekräftade regler (scaffold för Steg 4) + audit. Allt RLS-isolerat per bolag
-- (company_id in (select user_company_ids())). ROBO-bp bokför/ändrar/godkänner ALDRIG något.
-- Mutationer sker via edge (service role, medlemskap verifieras i kod) eller SECURITY DEFINER-RPC.

create table if not exists public.robo_bp_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year_id uuid,                                  -- kontextreferens (RLS via company_id)
  user_id uuid not null default auth.uid(),
  title text,
  context_view text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_robo_conv_company on public.robo_bp_conversations(company_id, updated_at desc);

create table if not exists public.robo_bp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.robo_bp_conversations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  structured jsonb,                                     -- validerat AI-svar (schema i src/lib/roboBp.js)
  basis text[],
  risk_level text check (risk_level in ('low','medium','high','critical')),
  created_at timestamptz not null default now()
);
create index if not exists idx_robo_msg_conv on public.robo_bp_messages(conversation_id, created_at);

-- Bekräftade bokföringsmönster (Steg 4). Permanent regel kräver approved_by (behörig användare).
create table if not exists public.robo_bp_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  counterparty text not null,
  org_nr text,
  suggested_account text,
  vat_handling text,
  confidence numeric not null default 0,
  source text not null default 'historik' check (source in ('historik','anvandarbekraftelse','regelmotor')),
  created_by uuid,
  approved_by uuid,                                     -- null = ej bekräftad → får ej användas som regel
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  success_count int not null default 0,
  active boolean not null default true
);
create index if not exists idx_robo_rules_company on public.robo_bp_rules(company_id, active);

create table if not exists public.robo_bp_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid default auth.uid(),
  action text not null,                                 -- ai_query | suggestion_accepted | rule_confirmed | denied
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_robo_audit_company on public.robo_bp_audit_log(company_id, created_at desc);

alter table public.robo_bp_conversations enable row level security;
alter table public.robo_bp_messages enable row level security;
alter table public.robo_bp_rules enable row level security;
alter table public.robo_bp_audit_log enable row level security;

drop policy if exists robo_conv_select on public.robo_bp_conversations;
create policy robo_conv_select on public.robo_bp_conversations for select using (company_id in (select user_company_ids()));
drop policy if exists robo_msg_select on public.robo_bp_messages;
create policy robo_msg_select on public.robo_bp_messages for select using (company_id in (select user_company_ids()));
drop policy if exists robo_rules_select on public.robo_bp_rules;
create policy robo_rules_select on public.robo_bp_rules for select using (company_id in (select user_company_ids()));
drop policy if exists robo_audit_select on public.robo_bp_audit_log;
create policy robo_audit_select on public.robo_bp_audit_log for select using (company_id in (select user_company_ids()));

-- Audit-RPC: loggar känsliga AI-händelser. Kollar bolagsmedlemskap, släpper aldrig andra bolags id.
create or replace function public.log_robo_bp_event(p_company uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_company is null or p_company not in (select user_company_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.robo_bp_audit_log(company_id, user_id, action, detail)
    values (p_company, auth.uid(), coalesce(nullif(p_action, ''), 'ai_query'), coalesce(p_detail, '{}'::jsonb))
    returning id into v_id;
  return v_id;
end $$;
