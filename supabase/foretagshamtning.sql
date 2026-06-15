-- Automatisk hämtning av svenska företagsuppgifter (officiellt API via UC/Allabolag).
-- ADDITIVT. Tre delar: (1) proveniens + normaliserat org-nr på customers,
-- (2) server-side cache (24h), (3) per-användare rate limit. Cache/rate har RLS PÅ utan
-- policy => endast service_role (edge-funktionen) når dem; ingen klientåtkomst.

-- 1) Proveniens på kundkortet.
alter table public.customers add column if not exists org_nr_normalized text;
alter table public.customers add column if not exists data_source text;            -- 'Allabolag' | 'Bolagsverket' | null
alter table public.customers add column if not exists source_retrieved_at timestamptz;
alter table public.customers add column if not exists source_api_version text;
alter table public.customers add column if not exists manual_fields jsonb;          -- nycklar som ändrats manuellt efter hämtning
alter table public.customers add column if not exists last_manual_edit_at timestamptz;
alter table public.customers add column if not exists last_manual_edit_by uuid;

-- Normaliserat org-nr (utan bindestreck): underhålls från org_nr via trigger.
create or replace function public.set_org_nr_normalized() returns trigger
language plpgsql set search_path = public as $$
declare d text;
begin
  d := regexp_replace(coalesce(new.org_nr, ''), '\D', '', 'g');
  if length(d) = 12 then d := substr(d, 3); end if;
  new.org_nr_normalized := case when length(d) = 10 then d else null end;
  return new;
end $$;
drop trigger if exists trg_customers_orgnr_norm on public.customers;
create trigger trg_customers_orgnr_norm
  before insert or update of org_nr on public.customers
  for each row execute function public.set_org_nr_normalized();

-- Backfill för befintliga kunder.
update public.customers set org_nr = org_nr where org_nr is not null;

-- Unikt org-nr per företag (dubblettskydd). Partiellt: bara när normaliserat nr finns.
create unique index if not exists customers_company_orgnr_uniq
  on public.customers(company_id, org_nr_normalized) where org_nr_normalized is not null;

-- 2) Cache av API-svaret per org-nr (globalt – företagsdata är inte tenant-specifik). 24h TTL i edge.
create table if not exists public.company_lookup_cache (
  org_nr text primary key,
  payload jsonb not null,
  api_version text,
  source text,
  fetched_at timestamptz not null default now()
);
alter table public.company_lookup_cache enable row level security;   -- ingen policy => endast service_role

-- 3) Per-användare rate limit (glidande fönster räknas i edge-funktionen).
create table if not exists public.company_lookup_rate (
  user_id uuid primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);
alter table public.company_lookup_rate enable row level security;    -- ingen policy => endast service_role
