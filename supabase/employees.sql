-- Anställda (employees) – grund för lönemodulen. Personnummer = känsliga personuppgifter (GDPR);
-- isoleras per företag via RLS. Manuell lön: arbetsgivaravgift_procent lagras per anställd
-- (default 31,42 %; kan sättas lägre för t.ex. pensionärer/ungdomar i ett senare steg).
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  fornamn text not null,
  efternamn text not null,
  personnummer text,
  epost text,
  telefon text,
  befattning text,
  anstallningsform text not null default 'tillsvidare',   -- tillsvidare|visstid|provanstallning|timanstalld
  lonetyp text not null default 'manad',                   -- manad|timme
  manadslon numeric,
  timlon numeric,
  skattetabell int,
  skattekolumn int default 1,
  arbetsgivaravgift_procent numeric not null default 31.42,
  clearingnr text,
  kontonr text,
  anstallningsdatum date,
  slutdatum date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.employees enable row level security;
drop policy if exists employees_policy on public.employees;
create policy employees_policy on public.employees for all
  using (company_id in (select user_company_ids()))
  with check (company_id in (select user_company_ids()));
create index if not exists employees_company_idx on public.employees (company_id, is_active);
