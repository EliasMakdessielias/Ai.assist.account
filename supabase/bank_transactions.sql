-- Inlästa banktransaktioner (bankimport)
create table if not exists bank_transactions (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  account_nr text not null,
  datum date,
  text text,
  amount numeric(15,2),
  status text default 'unmatched',  -- unmatched | booked | ignored
  verifikation_id uuid references verifikationer(id) on delete set null,
  imported_at timestamptz default now()
);

alter table bank_transactions enable row level security;

drop policy if exists "bank_transactions_policy" on bank_transactions;
create policy "bank_transactions_policy" on bank_transactions for all
  using (company_id in (select user_company_ids()))
  with check (company_id in (select user_company_ids()));
