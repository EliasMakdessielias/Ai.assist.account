-- Lagra e-post på kopplingen så medlemmar kan listas
alter table user_companies add column if not exists email text;

-- Medlemmar ska kunna se alla medlemmar i sina företag (för team-vyn)
drop policy if exists "users_own_user_companies" on user_companies;
drop policy if exists "uc_select" on user_companies;
drop policy if exists "uc_insert" on user_companies;
drop policy if exists "uc_delete" on user_companies;
create policy "uc_select" on user_companies for select
  using (user_id = auth.uid() or company_id in (select user_company_ids()));
create policy "uc_insert" on user_companies for insert
  with check (user_id = auth.uid());
create policy "uc_delete" on user_companies for delete
  using (company_id in (select user_company_ids()));

-- Inbjudningar till företag
create table if not exists company_invites (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  email text not null,
  role text default 'member',
  status text default 'pending',
  invited_by uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table company_invites enable row level security;
drop policy if exists "ci_company" on company_invites;
drop policy if exists "ci_invitee_select" on company_invites;
drop policy if exists "ci_invitee_update" on company_invites;
create policy "ci_company" on company_invites for all
  using (company_id in (select user_company_ids()))
  with check (company_id in (select user_company_ids()));
create policy "ci_invitee_select" on company_invites for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));
create policy "ci_invitee_update" on company_invites for update
  using (lower(email) = lower(auth.jwt() ->> 'email'));
