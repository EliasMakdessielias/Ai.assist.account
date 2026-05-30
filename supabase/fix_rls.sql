-- Fix: tillåt inloggade användare att skapa sitt företag vid registrering
drop policy if exists "users_own_companies" on companies;

create policy "companies_select" on companies
  for select using (id in (select company_id from user_companies where user_id = auth.uid()));
create policy "companies_update" on companies
  for update using (id in (select company_id from user_companies where user_id = auth.uid()));
create policy "companies_delete" on companies
  for delete using (id in (select company_id from user_companies where user_id = auth.uid()));
create policy "companies_insert" on companies
  for insert with check (auth.uid() is not null);
