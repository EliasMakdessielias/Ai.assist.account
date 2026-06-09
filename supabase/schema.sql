-- =============================================
-- BOKPILOT - Bokföringsapp Databasschema
-- Supabase (PostgreSQL)
-- =============================================

-- Aktivera RLS (Row Level Security)
-- Varje tabell skyddas så att användare bara ser sitt eget företags data

-- FÖRETAG
create table companies (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  org_nr text,
  vat_nr text,
  address text,
  phone text,
  email text,
  website text,
  bankgiro text,
  plusgiro text,
  iban text,
  bic_swift text,
  payment_terms integer default 30,
  late_interest numeric(5,2) default 8.00,
  created_at timestamptz default now()
);

-- ANVÄNDARE → FÖRETAG (koppling)
create table user_companies (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  role text default 'admin',
  created_at timestamptz default now(),
  unique(user_id, company_id)
);

-- KONTOPLAN (BAS 2026)
create table accounts (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  account_nr text not null,
  name text not null,
  vat_code text default '',
  sru text default '',
  is_active boolean default true,
  opening_balance numeric(15,2) default 0,
  budget numeric(15,2) default 0,
  auto_kontering text default '',
  suggest_debit_credit text default 'debet',
  transaction_info text default 'allowed',
  created_at timestamptz default now(),
  unique(company_id, account_nr)
);

-- VERIFIKATIONER (Bokföringslagen 5 kap.)
create table verifikationer (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  ver_nr text not null,
  ver_serie text default 'A',
  datum date not null,
  beskrivning text not null,
  total_debet numeric(15,2) not null,
  total_kredit numeric(15,2) not null,
  is_locked boolean default true,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(company_id, ver_nr)
);

-- VERIFIKATIONSRADER
create table verifikation_rows (
  id uuid default gen_random_uuid() primary key,
  verifikation_id uuid references verifikationer(id) on delete cascade,
  account_nr text not null,
  account_name text default '',
  debet numeric(15,2) default 0,
  kredit numeric(15,2) default 0,
  transaction_info text default '',
  sort_order integer default 0
);

-- KUNDER
create table customers (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  name text not null,
  org_nr text,
  contact_person text,
  email text,
  phone text,
  address text,
  payment_terms integer default 30,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- LEVERANTÖRER
create table suppliers (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  name text not null,
  org_nr text,
  category text,
  bankgiro text,
  email text,
  phone text,
  address text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- FAKTUROR (Kundfordringar)
create table invoices (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  customer_id uuid references customers(id),
  invoice_nr text not null,
  invoice_date date not null,
  due_date date not null,
  amount_excl_vat numeric(15,2) default 0,
  vat_amount numeric(15,2) default 0,
  total_amount numeric(15,2) default 0,
  status text default 'draft',
  message text default '',
  created_at timestamptz default now(),
  unique(company_id, invoice_nr)
);

-- FAKTURARADER
create table invoice_rows (
  id uuid default gen_random_uuid() primary key,
  invoice_id uuid references invoices(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) default 1,
  unit_price numeric(15,2) default 0,
  vat_rate numeric(5,2) default 25,
  total numeric(15,2) default 0,
  sort_order integer default 0
);

-- LEVERANTÖRSFAKTUROR
create table supplier_invoices (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  invoice_nr text,
  invoice_date date,
  due_date date,
  amount_excl_vat numeric(15,2) default 0,
  vat_amount numeric(15,2) default 0,
  total_amount numeric(15,2) default 0,
  status text default 'unpaid',
  created_at timestamptz default now()
);

-- PRODUKTER / TJÄNSTER
create table products (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  article_nr text,
  name text not null,
  type text default 'service',
  unit text default 'st',
  unit_price numeric(15,2) default 0,
  vat_rate numeric(5,2) default 25,
  account_nr text default '3010',
  is_active boolean default true,
  created_at timestamptz default now()
);

-- RÄKENSKAPSÅR
create table fiscal_years (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  year integer not null,
  start_date date not null,
  end_date date not null,
  status text default 'active',
  created_at timestamptz default now()
);

-- LÖNEUNDERLAG
create table salaries (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  employee_name text not null,
  personal_nr text,
  period text not null,
  gross_salary numeric(15,2) default 0,
  tax_deduction numeric(15,2) default 0,
  net_salary numeric(15,2) default 0,
  employer_fee numeric(15,2) default 0,
  status text default 'draft',
  created_at timestamptz default now()
);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

alter table companies enable row level security;
alter table user_companies enable row level security;
alter table accounts enable row level security;
alter table verifikationer enable row level security;
alter table verifikation_rows enable row level security;
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table invoices enable row level security;
alter table invoice_rows enable row level security;
alter table supplier_invoices enable row level security;
alter table products enable row level security;
alter table fiscal_years enable row level security;
alter table salaries enable row level security;

-- Policy: användare ser bara sitt företags data
create policy "users_own_companies" on companies
  for all using (
    id in (select company_id from user_companies where user_id = auth.uid())
  );

create policy "users_own_user_companies" on user_companies
  for all using (user_id = auth.uid());

-- Macro för alla företagsbundna tabeller
create or replace function user_company_ids() returns setof uuid as $$
  select company_id from user_companies where user_id = auth.uid()
$$ language sql security definer;

create policy "accounts_policy" on accounts for all using (company_id in (select user_company_ids()));
create policy "verifikationer_policy" on verifikationer for all using (company_id in (select user_company_ids()));
create policy "verifikation_rows_policy" on verifikation_rows for all using (
  verifikation_id in (select id from verifikationer where company_id in (select user_company_ids()))
);
create policy "customers_policy" on customers for all using (company_id in (select user_company_ids()));
create policy "suppliers_policy" on suppliers for all using (company_id in (select user_company_ids()));
create policy "invoices_policy" on invoices for all using (company_id in (select user_company_ids()));
create policy "invoice_rows_policy" on invoice_rows for all using (
  invoice_id in (select id from invoices where company_id in (select user_company_ids()))
);
create policy "supplier_invoices_policy" on supplier_invoices for all using (company_id in (select user_company_ids()));
create policy "products_policy" on products for all using (company_id in (select user_company_ids()));
create policy "fiscal_years_policy" on fiscal_years for all using (company_id in (select user_company_ids()));
create policy "salaries_policy" on salaries for all using (company_id in (select user_company_ids()));

-- =============================================
-- FUNKTION: Nästa verifikationsnummer
-- =============================================
create or replace function next_ver_nr(p_company_id uuid, p_serie text default 'A')
returns text as $$
declare
  max_nr integer;
  prefix text;
begin
  prefix := substring(p_serie from 1 for 1);
  select coalesce(max(
    cast(regexp_replace(ver_nr, '[^0-9]', '', 'g') as integer)
  ), 0) into max_nr
  from verifikationer
  where company_id = p_company_id and ver_serie = p_serie;
  return prefix || (max_nr + 1);
end;
$$ language plpgsql security definer;
