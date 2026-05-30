-- Hårdare regel: bara plattformsadmin får skapa AKTIVA företag.
-- Alla andra nya företag tvingas vara pausade (suspended=true) -> kräver ditt godkännande.
drop policy if exists "companies_insert" on companies;
create policy "companies_insert" on companies for insert
  with check (
    auth.uid() is not null
    and (coalesce(suspended, true) = true or is_platform_admin())
  );
