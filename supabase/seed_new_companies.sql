-- 1. Mall-kontoplan (kopieras från ditt företags korrekt kodade kontoplan)
create table if not exists bas_accounts (
  account_nr text primary key,
  name text not null,
  vat_code text default '',
  is_active boolean default true
);
insert into bas_accounts (account_nr, name, vat_code, is_active)
select account_nr, name, vat_code, is_active
from accounts where company_id = '49acf1f0-cb6d-4642-b25f-736775eaa9da'
on conflict (account_nr) do nothing;

-- 2. Trigger: nya företag får automatiskt kontoplan + räkenskapsår
create or replace function seed_new_company() returns trigger as $$
begin
  insert into accounts (company_id, account_nr, name, vat_code, is_active)
    select NEW.id, account_nr, name, vat_code, is_active from bas_accounts
    on conflict (company_id, account_nr) do nothing;
  insert into fiscal_years (company_id, year, start_date, end_date, status)
    values (NEW.id, extract(year from now())::int,
            make_date(extract(year from now())::int, 1, 1),
            make_date(extract(year from now())::int, 12, 31), 'active');
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_seed_new_company on companies;
create trigger trg_seed_new_company after insert on companies
  for each row execute function seed_new_company();

-- 3. Engångsfix: ge alla befintliga företag UTAN kontoplan en (t.ex. Haia)
insert into accounts (company_id, account_nr, name, vat_code, is_active)
select c.id, b.account_nr, b.name, b.vat_code, b.is_active
from companies c cross join bas_accounts b
where not exists (select 1 from accounts a where a.company_id = c.id)
on conflict (company_id, account_nr) do nothing;

-- 4. Engångsfix: räkenskapsår för företag som saknar
insert into fiscal_years (company_id, year, start_date, end_date, status)
select c.id, extract(year from now())::int, make_date(extract(year from now())::int,1,1), make_date(extract(year from now())::int,12,31), 'active'
from companies c
where not exists (select 1 from fiscal_years fy where fy.company_id = c.id);
