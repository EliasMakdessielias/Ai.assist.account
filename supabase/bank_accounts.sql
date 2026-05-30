-- Kassa- och bankkonton (inställning): namngivna konton kopplade till bokföringskonto
create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  namn text not null,
  typ text not null default 'Företagskonto',
  valuta text not null default 'SEK',
  account_nr text,
  bankgiro text,
  iban text,
  aktiv boolean not null default true,
  created_at timestamptz default now()
);

alter table bank_accounts enable row level security;
drop policy if exists bank_accounts_policy on bank_accounts;
create policy bank_accounts_policy on bank_accounts for all
  using (company_id in (select user_company_ids()))
  with check (company_id in (select user_company_ids()));
