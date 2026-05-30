-- Plattformsadministratörer (superadmin – du som äger/säljer appen)
create table if not exists platform_admins (
  email text primary key,
  created_at timestamptz default now()
);
insert into platform_admins (email) values ('info@acountx.se') on conflict (email) do nothing;

alter table platform_admins enable row level security;
drop policy if exists "pa_self" on platform_admins;
create policy "pa_self" on platform_admins for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Hjälpfunktion: är inloggad användare plattformsadmin?
create or replace function is_platform_admin() returns boolean as $$
  select exists(select 1 from platform_admins where lower(email) = lower(auth.jwt() ->> 'email'))
$$ language sql security definer stable;

-- Avstängning av företag
alter table companies add column if not exists suspended boolean default false;

-- Admin-åtkomst (utöver vanliga regler)
drop policy if exists "companies_admin_all" on companies;
create policy "companies_admin_all" on companies for all
  using (is_platform_admin()) with check (is_platform_admin());
drop policy if exists "uc_admin_read" on user_companies;
create policy "uc_admin_read" on user_companies for select using (is_platform_admin());
drop policy if exists "ver_admin_read" on verifikationer;
create policy "ver_admin_read" on verifikationer for select using (is_platform_admin());
