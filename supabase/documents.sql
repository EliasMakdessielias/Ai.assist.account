-- Underlag/dokument kopplade till företag och (valfritt) verifikation
create table if not exists documents (
  id uuid default gen_random_uuid() primary key,
  company_id uuid references companies(id) on delete cascade,
  verifikation_id uuid references verifikationer(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz default now()
);

alter table documents enable row level security;

drop policy if exists "documents_policy" on documents;
create policy "documents_policy" on documents for all
  using (company_id in (select user_company_ids()))
  with check (company_id in (select user_company_ids()));

-- Säkerhet för filerna i bucketen "underlag":
-- mappnamnet (första delen av sökvägen) = företagets id, och användaren måste tillhöra företaget.
drop policy if exists "underlag_select" on storage.objects;
drop policy if exists "underlag_insert" on storage.objects;
drop policy if exists "underlag_delete" on storage.objects;

create policy "underlag_select" on storage.objects for select to authenticated
  using (bucket_id = 'underlag' and (storage.foldername(name))[1] in (
    select company_id::text from user_companies where user_id = auth.uid()));

create policy "underlag_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'underlag' and (storage.foldername(name))[1] in (
    select company_id::text from user_companies where user_id = auth.uid()));

create policy "underlag_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'underlag' and (storage.foldername(name))[1] in (
    select company_id::text from user_companies where user_id = auth.uid()));
