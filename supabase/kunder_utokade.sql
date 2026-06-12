-- Utökat kundkort (Fortnox-inspirerat): Grunduppgifter + Faktureringsuppgifter.
-- ADDITIVT – befintliga kolumner (name, org_nr, contact_person, email, phone, address,
-- payment_terms, is_active) behålls. Endast fält som BokPilot faktiskt använder/lagrar;
-- inga låtsasfunktioner (e-faktura/prislistor/mallar byggs inte här).

-- Kundnummer: unikt per företag, auto-föreslås i UI (max + 1), redigerbart.
alter table public.customers add column if not exists kund_nr integer;
alter table public.customers add column if not exists kundtyp text not null default 'foretag';
do $$ begin
  alter table public.customers add constraint customers_kundtyp_chk check (kundtyp in ('foretag', 'privat'));
exception when duplicate_object then null; end $$;

-- Fakturaadress (address = rad 1, finns redan) + ort/postnr/land.
alter table public.customers add column if not exists address2 text;
alter table public.customers add column if not exists postnr text;
alter table public.customers add column if not exists ort text;
alter table public.customers add column if not exists land text;
alter table public.customers add column if not exists telefon2 text;
alter table public.customers add column if not exists webb text;

-- Leveransadress (separat från fakturaadressen).
alter table public.customers add column if not exists lev_namn text;
alter table public.customers add column if not exists lev_adress text;
alter table public.customers add column if not exists lev_adress2 text;
alter table public.customers add column if not exists lev_postnr text;
alter table public.customers add column if not exists lev_ort text;
alter table public.customers add column if not exists lev_land text;

alter table public.customers add column if not exists anteckningar text;

-- Faktureringsuppgifter.
alter table public.customers add column if not exists leveransvillkor text;
alter table public.customers add column if not exists leveranssatt text;
alter table public.customers add column if not exists valuta text default 'SEK';
alter table public.customers add column if not exists var_referens text;
alter table public.customers add column if not exists er_referens text;
alter table public.customers add column if not exists vat_nummer text;
-- Försäljningskonto: används av bokforing.js vid bokföring av kundfaktura (fallback 3001).
alter table public.customers add column if not exists forsaljningskonto text;

-- Backfill: numrera befintliga kunder per företag i skapelseordning.
with n as (
  select id, row_number() over (partition by company_id order by created_at, id) as rn
  from public.customers where kund_nr is null
)
update public.customers c set kund_nr = n.rn from n where c.id = n.id;

create unique index if not exists customers_company_kundnr_uniq
  on public.customers(company_id, kund_nr) where kund_nr is not null;
