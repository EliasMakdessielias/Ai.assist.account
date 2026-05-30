-- Tillåt: admin (alltid), vanliga (bara pausade), OCH förgodkända användare (aktiva) att skapa företag.
drop policy if exists "companies_insert" on companies;
create policy "companies_insert" on companies for insert
  with check (
    auth.uid() is not null
    and (
      coalesce(suspended, true) = true
      or is_platform_admin()
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'approved')::boolean, false)
    )
  );
