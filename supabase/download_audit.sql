-- [INBOX_DOWNLOAD] Audit-logg för nedladdningar från Inkorgen (krav F.5).
-- Loggar VEM/VILKET företag/sektion/antal/typ/tid – ALDRIG filinnehåll.
-- Insert sker endast via SECURITY DEFINER-RPC med medlemskapskontroll.
-- (Applicerad som migration 'download_audit_log'.)
create table if not exists download_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  company_id uuid,
  section text,
  kind text,            -- 'single' | 'selected' | 'section'
  file_count int,
  created_at timestamptz default now()
);
alter table download_audit_log enable row level security;

drop policy if exists dal_select on download_audit_log;
create policy dal_select on download_audit_log for select
  using (company_id in (select company_id from user_companies where user_id = auth.uid()));

create or replace function log_inbox_download(p_company_id uuid, p_section text, p_kind text, p_file_count int)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from user_companies where user_id = auth.uid() and company_id = p_company_id) then
    raise exception 'forbidden';
  end if;
  insert into download_audit_log (user_id, company_id, section, kind, file_count)
  values (auth.uid(), p_company_id, left(coalesce(p_section, ''), 40), left(coalesce(p_kind, ''), 20), greatest(0, coalesce(p_file_count, 0)));
end $$;

grant execute on function log_inbox_download(uuid, text, text, int) to authenticated;
