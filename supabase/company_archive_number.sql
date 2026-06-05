-- Slumpmässigt, permanent arkivnummer per företag (ersätter sekventiellt
-- company_number i e-postadresserna). Applicerad som migration
-- "company_archive_number_random". Se docs/inbound-email.md.
--
-- Adressformat: {archive_number}.{kvi|lev|dok|avt}@arkiv.bokpilot.se

alter table public.companies add column if not exists archive_number bigint;

-- Generator (BEFORE INSERT): slumpa unikt 7-siffrigt nummer (1000000-9999999).
-- Sätts bara om null -> permanent under företagets livstid.
create or replace function public.assign_archive_number() returns trigger as $$
declare candidate bigint; tries int := 0;
begin
  if NEW.archive_number is not null then return NEW; end if;
  loop
    candidate := 1000000 + floor(random() * 9000000)::bigint;
    exit when not exists (select 1 from public.companies where archive_number = candidate);
    tries := tries + 1;
    if tries > 100 then raise exception 'Kunde inte generera unikt arkivnummer'; end if;
  end loop;
  NEW.archive_number := candidate;
  return NEW;
end $$ language plpgsql;
drop trigger if exists trg_assign_archive_number on public.companies;
create trigger trg_assign_archive_number before insert on public.companies
  for each row execute function public.assign_archive_number();

-- Backfill befintliga företag
do $$
declare r record; candidate bigint; tries int;
begin
  for r in select id from public.companies where archive_number is null loop
    tries := 0;
    loop
      candidate := 1000000 + floor(random() * 9000000)::bigint;
      exit when not exists (select 1 from public.companies where archive_number = candidate);
      tries := tries + 1;
      if tries > 100 then raise exception 'Kunde inte generera unikt arkivnummer'; end if;
    end loop;
    update public.companies set archive_number = candidate where id = r.id;
  end loop;
end $$;

alter table public.companies alter column archive_number set not null;
create unique index if not exists companies_archive_number_key on public.companies(archive_number);

-- Provisionering med arkivnummer + korta suffix
create or replace function public.provision_company_inboxes() returns trigger as $$
declare m record;
begin
  if NEW.archive_number is null then return NEW; end if;
  for m in select * from (values
      ('kvitto','kvi'),('leverantorsfaktura','lev'),('dokument','dok'),('avtal','avt')
    ) as x(t, sfx) loop
    insert into public.inbox_addresses (company_id, inbox_type, email_address)
    values (NEW.id, m.t, NEW.archive_number::text || '.' || m.sfx || '@arkiv.bokpilot.se')
    on conflict (company_id, inbox_type) do nothing;
  end loop;
  return NEW;
end $$ language plpgsql security definer;

-- Regenerera befintliga adresser till nytt format (kringgå format-vakten tillfälligt)
alter table public.inbox_addresses disable trigger trg_inbox_addr_guard;
update public.inbox_addresses ia
set email_address = c.archive_number::text || '.' ||
      case ia.inbox_type
        when 'kvitto' then 'kvi' when 'leverantorsfaktura' then 'lev'
        when 'dokument' then 'dok' when 'avtal' then 'avt' end
      || '@arkiv.bokpilot.se',
    updated_at = now()
from public.companies c where c.id = ia.company_id;
alter table public.inbox_addresses enable trigger trg_inbox_addr_guard;

-- Arkivnumret är permanent: ignorera försök att ändra det vid UPDATE
-- (migration protect_archive_number_immutable).
create or replace function public.protect_archive_number() returns trigger as $$
begin
  if NEW.archive_number is distinct from OLD.archive_number then
    NEW.archive_number := OLD.archive_number;
  end if;
  return NEW;
end $$ language plpgsql;
drop trigger if exists trg_protect_archive_number on public.companies;
create trigger trg_protect_archive_number before update on public.companies
  for each row execute function public.protect_archive_number();
