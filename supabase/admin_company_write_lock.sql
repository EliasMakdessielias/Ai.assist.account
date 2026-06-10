-- =============================================
-- BokPilot Control Center – Fas 2 härdning: server-side write-lock per service_state
-- När companies.service_state = paused/blocked blockeras KUNDSTYRDA mutationer av affärsdata
-- (skapa/ändra/radera/ladda upp). Data raderas aldrig. Supportflödet fortsätter fungera.
--
-- Design (central guard + triggers):
--   can_company_write(company) – central regel. active → true; paused/blocked → false;
--     superadmin/operations_admin → true (adminåtgärder).
--   BEFORE INSERT/UPDATE/DELETE-trigger på varje affärstabell anropar guarden. Triggern fires
--     ÄVEN inuti SECURITY DEFINER-RPC:er (till skillnad från RLS som de bypassar), så kundinitierade
--     definer-funktioner (import_chart_of_accounts/clear_chart_of_accounts/reset_company) täcks utan
--     att de behöver skrivas om.
--   auth.uid() IS NULL ⇒ system/service-role-jobb (inbound-email, workers, cron) → SLÄPPS IGENOM
--     (drift/audit/notiser/inkommande underlag fortsätter; inget bokförs automatiskt).
--   Stöds av Storage-RLS för underlag-upload (kund kan ej ladda upp till låst företag).
-- Kör i Supabase SQL Editor. Additivt & icke-brytande för aktiva företag.
-- =============================================

-- 1. Central guard. SECURITY DEFINER så service_state alltid kan läsas oavsett anroparens RLS.
create or replace function public.can_company_write(p_company_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when p_company_id is null then true                              -- ej företagsscopat
    when public.can_manage_operations() then true                   -- superadmin / operations_admin
    else coalesce((select service_state from public.companies where id = p_company_id), 'active') = 'active'
  end
$$;

-- 2. Trigger-funktion för tabeller MED company_id. Endast inloggad kund (auth.uid() satt)
--    omfattas; system/service-role (auth.uid() null) släpps igenom (krav 6).
create or replace function public.enforce_company_write_lock()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid;
begin
  v_company := case when TG_OP = 'DELETE' then OLD.company_id else NEW.company_id end;
  if auth.uid() is not null and not public.can_company_write(v_company) then
    raise exception 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.' using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end $$;

-- 3. Trigger-funktioner för rad-tabeller UTAN company_id (slår upp via förälder).
create or replace function public.enforce_write_lock_verifikation_rows()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid; v_vid uuid;
begin
  v_vid := case when TG_OP = 'DELETE' then OLD.verifikation_id else NEW.verifikation_id end;
  select company_id into v_company from public.verifikationer where id = v_vid;
  if auth.uid() is not null and not public.can_company_write(v_company) then
    raise exception 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.' using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end $$;

create or replace function public.enforce_write_lock_invoice_rows()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid; v_iid uuid;
begin
  v_iid := case when TG_OP = 'DELETE' then OLD.invoice_id else NEW.invoice_id end;
  select company_id into v_company from public.invoices where id = v_iid;
  if auth.uid() is not null and not public.can_company_write(v_company) then
    raise exception 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.' using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end $$;

-- 4. Koppla triggers på affärstabellerna (company_id-tabeller). Support_*, notification_*, audit-loggar,
--    company_subscriptions, user_companies/company_invites och system/katalog-tabeller LÄMNAS medvetet utanför.
do $$
declare t text;
begin
  foreach t in array array[
    'documents','verifikationer','invoices','supplier_invoices','customers','suppliers','products',
    'bank_transactions','bank_accounts','account_import_batches','accounts','article_templates',
    'bookkeeping_templates','fiscal_years','salaries'
  ] loop
    execute format('drop trigger if exists trg_write_lock on public.%I', t);
    execute format(
      'create trigger trg_write_lock before insert or update or delete on public.%I for each row execute function public.enforce_company_write_lock()', t);
  end loop;
end $$;

drop trigger if exists trg_write_lock on public.verifikation_rows;
create trigger trg_write_lock before insert or update or delete on public.verifikation_rows
  for each row execute function public.enforce_write_lock_verifikation_rows();

drop trigger if exists trg_write_lock on public.invoice_rows;
create trigger trg_write_lock before insert or update or delete on public.invoice_rows
  for each row execute function public.enforce_write_lock_invoice_rows();

-- 5. Storage: blockera KUNDSTYRD upload/radering av underlag till låst företag.
--    underlag_select lämnas orörd (signerad läsning fungerar). service_role bypassar storage-RLS
--    (inbound-email kan fortsatt lagra inkommande underlag). support-bucketen rörs INTE.
drop policy if exists "underlag_insert" on storage.objects;
create policy "underlag_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'underlag'
    and (storage.foldername(name))[1] in (select company_id::text from public.user_companies where user_id = auth.uid())
    and public.can_company_write(nullif((storage.foldername(name))[1], '')::uuid)
  );

drop policy if exists "underlag_delete" on storage.objects;
create policy "underlag_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'underlag'
    and (storage.foldername(name))[1] in (select company_id::text from public.user_companies where user_id = auth.uid())
    and public.can_company_write(nullif((storage.foldername(name))[1], '')::uuid)
  );
