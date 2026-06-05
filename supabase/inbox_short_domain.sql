-- Kortare adressformat: {archive_number}.{kv|lf|do|av}@ark.bpilot.se
-- Applicerad som migration "inbox_short_domain_suffixes".
-- kvitto->kv, leverantorsfaktura->lf, dokument->do, avtal->av; domän ark.bpilot.se.

create or replace function public.provision_company_inboxes() returns trigger as $$
declare m record;
begin
  if NEW.archive_number is null then return NEW; end if;
  for m in select * from (values
      ('kvitto','kv'),('leverantorsfaktura','lf'),('dokument','do'),('avtal','av')
    ) as x(t, sfx) loop
    insert into public.inbox_addresses (company_id, inbox_type, email_address)
    values (NEW.id, m.t, NEW.archive_number::text || '.' || m.sfx || '@ark.bpilot.se')
    on conflict (company_id, inbox_type) do nothing;
  end loop;
  return NEW;
end $$ language plpgsql security definer;

-- Regenerera befintliga adresser till nytt format
alter table public.inbox_addresses disable trigger trg_inbox_addr_guard;
update public.inbox_addresses ia
set email_address = c.archive_number::text || '.' ||
      case ia.inbox_type
        when 'kvitto' then 'kv' when 'leverantorsfaktura' then 'lf'
        when 'dokument' then 'do' when 'avtal' then 'av' end
      || '@ark.bpilot.se',
    updated_at = now()
from public.companies c where c.id = ia.company_id;
alter table public.inbox_addresses enable trigger trg_inbox_addr_guard;
