-- Inbound-mottagningsadresser (arkiv.bokpilot.se). Applicerad som migration
-- "inbound_email_inbox_addresses". Se docs/inbound-email.md för helheten.

-- 1. Sekventiellt företagsnummer (0000001-stil)
create sequence if not exists public.company_number_seq;
alter table public.companies add column if not exists company_number bigint;
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.companies where company_number is null
)
update public.companies c set company_number = o.rn from ordered o
where c.id = o.id and c.company_number is null;
select setval('public.company_number_seq', greatest((select coalesce(max(company_number),0) from public.companies), 1));
alter table public.companies alter column company_number set default nextval('public.company_number_seq');
create unique index if not exists companies_company_number_key on public.companies(company_number);

-- 2. Mottagningsadresser
create table if not exists public.inbox_addresses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  inbox_type text not null check (inbox_type in ('kvitto','leverantorsfaktura','dokument','avtal')),
  email_address text not null unique,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (company_id, inbox_type)
);
create index if not exists inbox_addresses_company_idx on public.inbox_addresses(company_id);
alter table public.inbox_addresses enable row level security;
drop policy if exists ia_select on public.inbox_addresses;
drop policy if exists ia_update on public.inbox_addresses;
drop policy if exists ia_insert on public.inbox_addresses;
drop policy if exists ia_delete on public.inbox_addresses;
create policy ia_select on public.inbox_addresses for select
  using (company_id in (select user_company_ids()) or public.is_platform_admin());
create policy ia_update on public.inbox_addresses for update
  using (company_id in (select user_company_ids()) or public.is_platform_admin())
  with check (company_id in (select user_company_ids()) or public.is_platform_admin());
create policy ia_insert on public.inbox_addresses for insert with check (public.is_platform_admin());
create policy ia_delete on public.inbox_addresses for delete using (public.is_platform_admin());

-- Adressformat/typ är oföränderligt; uppdatera updated_at
create or replace function public.inbox_addr_guard() returns trigger as $$
begin
  if (NEW.email_address is distinct from OLD.email_address)
     or (NEW.inbox_type is distinct from OLD.inbox_type)
     or (NEW.company_id is distinct from OLD.company_id) then
    raise exception 'Mottagningsadressens format kan inte ändras';
  end if;
  NEW.updated_at := now();
  return NEW;
end $$ language plpgsql;
drop trigger if exists trg_inbox_addr_guard on public.inbox_addresses;
create trigger trg_inbox_addr_guard before update on public.inbox_addresses
  for each row execute function public.inbox_addr_guard();

-- 3. Auto-provisionering av 4 adresser vid nytt företag + backfill
create or replace function public.provision_company_inboxes() returns trigger as $$
declare prefix text; t text;
begin
  if NEW.company_number is null then return NEW; end if;
  prefix := lpad(NEW.company_number::text, 7, '0');
  foreach t in array array['kvitto','leverantorsfaktura','dokument','avtal'] loop
    insert into public.inbox_addresses (company_id, inbox_type, email_address)
    values (NEW.id, t, prefix || '.' || t || '@arkiv.bokpilot.se')
    on conflict (company_id, inbox_type) do nothing;
  end loop;
  return NEW;
end $$ language plpgsql security definer;
drop trigger if exists trg_provision_inboxes on public.companies;
create trigger trg_provision_inboxes after insert on public.companies
  for each row execute function public.provision_company_inboxes();

insert into public.inbox_addresses (company_id, inbox_type, email_address)
select c.id, t.type, lpad(c.company_number::text,7,'0') || '.' || t.type || '@arkiv.bokpilot.se'
from public.companies c
cross join (values ('kvitto'),('leverantorsfaktura'),('dokument'),('avtal')) as t(type)
where c.company_number is not null
on conflict (company_id, inbox_type) do nothing;

-- 4. E-postmetadata på documents (inkorgens lager)
alter table public.documents alter column storage_path drop not null;
alter table public.documents
  add column if not exists source text default 'upload',
  add column if not exists status text default 'new',
  add column if not exists email_from text,
  add column if not exists email_to text,
  add column if not exists email_subject text,
  add column if not exists email_body text,
  add column if not exists received_at timestamptz;

-- 5. Logg för inkommande e-post
create table if not exists public.inbound_email_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  recipient text, sender text, subject text,
  status text not null,              -- received | rejected | needs_review | error | received_with_warnings
  detail text,
  attachment_count int default 0,
  created_at timestamptz default now()
);
create index if not exists inbound_email_log_company_idx on public.inbound_email_log(company_id, created_at desc);
alter table public.inbound_email_log enable row level security;
drop policy if exists iel_select on public.inbound_email_log;
create policy iel_select on public.inbound_email_log for select
  using ((company_id is not null and company_id in (select user_company_ids())) or public.is_platform_admin());
