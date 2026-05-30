-- 1. Alla NYA företag startar pausade (måste aktiveras av plattformsadmin). Befintliga rader påverkas ej.
alter table companies alter column suspended set default true;

-- 2. Säkerhetsfunktionen returnerar bara AKTIVA företag -> pausade företags data blir
--    oåtkomlig i ALLA tabeller som använder user_company_ids() (verifikationer, fakturor,
--    konton, kunder, leverantörer, dokument, banktransaktioner m.m.).
create or replace function user_company_ids() returns setof uuid as $$
  select uc.company_id
  from user_companies uc
  join companies c on c.id = uc.company_id
  where uc.user_id = auth.uid()
    and coalesce(c.suspended, false) = false
$$ language sql security definer;
