-- En enda inbound-adress per företag + klassificering.
-- Applicerad som migration "single_underlag_address_classification".
-- Format: {archive_number}.underlag@bpilot.se. Varje bilaga klassificeras vid
-- mottagning (se src/lib/classifyDocument.js + edge-funktionen inbound-email).

alter table public.inbox_addresses drop constraint if exists inbox_addresses_inbox_type_check;
alter table public.inbox_addresses add constraint inbox_addresses_inbox_type_check
  check (inbox_type in ('underlag','kvitto','leverantorsfaktura','dokument','avtal'));

create or replace function public.provision_company_inboxes() returns trigger as $$
begin
  if NEW.archive_number is null then return NEW; end if;
  insert into public.inbox_addresses (company_id, inbox_type, email_address)
  values (NEW.id, 'underlag', NEW.archive_number::text || '.underlag@bpilot.se')
  on conflict (company_id, inbox_type) do nothing;
  return NEW;
end $$ language plpgsql security definer;

-- Ersätt gamla (system-genererade) adresser med en enda underlag-adress
delete from public.inbox_addresses;
insert into public.inbox_addresses (company_id, inbox_type, email_address)
select id, 'underlag', archive_number::text || '.underlag@bpilot.se'
from public.companies where archive_number is not null;

-- Klassificering: confidence på documents (status finns redan; kategori återanvänds
-- som detekterad typ: kvitto/leverantorsfaktura/kundfaktura/dokument/avtal/okand)
alter table public.documents add column if not exists confidence numeric;
