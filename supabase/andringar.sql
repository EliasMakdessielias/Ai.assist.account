-- Ändringslogg för rättelser (bokföringslagen 5 kap. 5 §)
create table if not exists verifikation_andringar (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  original_id uuid references verifikationer(id) on delete cascade,
  rattelse_id uuid references verifikationer(id) on delete set null,
  orsak text not null,
  utford_av_epost text,
  skapad timestamptz default now()
);

alter table verifikation_andringar enable row level security;

drop policy if exists "andringar_policy" on verifikation_andringar;
create policy "andringar_policy" on verifikation_andringar for all
  using (company_id in (select user_company_ids()))
  with check (company_id in (select user_company_ids()));
