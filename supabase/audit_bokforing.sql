-- Behandlingshistorik för bokföringshändelser (Bokföringslagen 1999:1078, avvikelse 1).
-- ADDITIVT – återanvänder audit_log. Ändrar INTE bokföringslogik (triggers observerar bara) och
-- audit får ALDRIG stoppa en bokföring (varje trigger sväljer ev. loggfel). Inga secrets/råtext loggas.

-- 1) audit_log får source + metadata (rör inte befintliga kolumner/accounts_audit).
alter table public.audit_log add column if not exists source text;
alter table public.audit_log add column if not exists metadata jsonb;

-- 2) Central audit-helper (SECURITY DEFINER). Återanvänds av triggers + klient-RPC (document_interpreted).
--    company_id härleds för dokument-entity om den saknas; klientanrop kräver medlemskap (company_id-isolation).
create or replace function public.log_accounting_audit(
  p_action text, p_entity text, p_entity_ref text,
  p_source text default null, p_metadata jsonb default null,
  p_company_id uuid default null, p_before jsonb default null, p_after jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_company uuid := p_company_id;
begin
  -- Härled företag för dokument-tolkning (klienten har bara document_id) + company_id-isolation.
  if v_company is null and p_entity = 'document' and p_entity_ref is not null then
    select company_id into v_company from public.documents where id = p_entity_ref::uuid;
    if v_actor is not null and v_company is not null
       and not exists (select 1 from public.user_companies uc where uc.user_id = v_actor and uc.company_id = v_company) then
      return;   -- annan kunds dokument → logga inte
    end if;
  end if;
  if v_company is null then return; end if;
  insert into public.audit_log(company_id, entity, entity_ref, action, old_data, new_data, metadata, source, changed_by, changed_by_email)
  values (v_company, p_entity, p_entity_ref, p_action, p_before, p_after, p_metadata,
          coalesce(p_source, case when v_actor is not null then 'ui' else 'system' end), v_actor, v_email);
end $$;
grant execute on function public.log_accounting_audit(text, text, text, text, jsonb, uuid, jsonb, jsonb) to authenticated, service_role;

-- 3) Verifikation: skapad / ändrad / raderad (legacy makulering).
create or replace function public.audit_verifikation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text := case when auth.uid() is not null then 'ui' else 'system' end;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.log_accounting_audit('verification_created', 'verifikation', new.id::text, v_src,
        jsonb_build_object('ver_nr', new.ver_nr, 'ver_serie', new.ver_serie, 'datum', new.datum,
          'total_debet', new.total_debet, 'total_kredit', new.total_kredit), new.company_id, null, null);
    elsif tg_op = 'UPDATE' then
      perform public.log_accounting_audit('verification_updated', 'verifikation', new.id::text, v_src,
        jsonb_build_object('ver_nr', new.ver_nr), new.company_id,
        jsonb_build_object('beskrivning', old.beskrivning, 'total_debet', old.total_debet, 'total_kredit', old.total_kredit, 'is_locked', old.is_locked),
        jsonb_build_object('beskrivning', new.beskrivning, 'total_debet', new.total_debet, 'total_kredit', new.total_kredit, 'is_locked', new.is_locked));
    elsif tg_op = 'DELETE' then
      perform public.log_accounting_audit('verification_deleted_current_legacy_flow', 'verifikation', old.id::text, v_src,
        jsonb_build_object('warning', 'Legacy deletion flow, should be replaced by reversal flow'), old.company_id,
        jsonb_build_object('ver_nr', old.ver_nr, 'ver_serie', old.ver_serie, 'datum', old.datum, 'beskrivning', old.beskrivning,
          'total_debet', old.total_debet, 'total_kredit', old.total_kredit,
          'rader', (select coalesce(jsonb_agg(jsonb_build_object('konto', vr.account_nr, 'debet', vr.debet, 'kredit', vr.kredit) order by vr.sort_order), '[]'::jsonb)
                    from public.verifikation_rows vr where vr.verifikation_id = old.id)), null);
    end if;
  exception when others then null;   -- audit får aldrig stoppa bokföringen
  end;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_audit_verifikation_ins on public.verifikationer;
create trigger trg_audit_verifikation_ins after insert on public.verifikationer for each row execute function public.audit_verifikation();
drop trigger if exists trg_audit_verifikation_upd on public.verifikationer;
create trigger trg_audit_verifikation_upd after update on public.verifikationer for each row execute function public.audit_verifikation();
drop trigger if exists trg_audit_verifikation_del on public.verifikationer;
create trigger trg_audit_verifikation_del before delete on public.verifikationer for each row execute function public.audit_verifikation();

-- 4) Leverantörsfaktura bokförd (bokford → true).
create or replace function public.audit_supplier_invoice_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text := case when auth.uid() is not null then 'ui' else 'system' end;
begin
  begin
    if (tg_op = 'INSERT' and coalesce(new.bokford, false))
       or (tg_op = 'UPDATE' and coalesce(new.bokford, false) and not coalesce(old.bokford, false)) then
      perform public.log_accounting_audit('supplier_invoice_booked', 'supplier_invoice', new.id::text, v_src,
        jsonb_build_object('invoice_nr', new.invoice_nr, 'supplier_id', new.supplier_id, 'verifikation_id', new.verifikation_id,
          'total_amount', new.total_amount, 'vat_amount', new.vat_amount, 'is_credit_invoice', new.kreditfaktura),
        new.company_id, null, null);
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_audit_supplier_invoice_booked on public.supplier_invoices;
create trigger trg_audit_supplier_invoice_booked after insert or update of bokford on public.supplier_invoices for each row execute function public.audit_supplier_invoice_booked();

-- 5) Kundfaktura bokförd (verifikation_id satt).
create or replace function public.audit_customer_invoice_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text := case when auth.uid() is not null then 'ui' else 'system' end;
begin
  begin
    if (tg_op = 'INSERT' and new.verifikation_id is not null)
       or (tg_op = 'UPDATE' and new.verifikation_id is not null and old.verifikation_id is null) then
      perform public.log_accounting_audit('customer_invoice_booked', 'invoice', new.id::text, v_src,
        jsonb_build_object('invoice_nr', new.invoice_nr, 'customer_id', new.customer_id, 'verifikation_id', new.verifikation_id,
          'total_amount', new.total_amount, 'vat_amount', new.vat_amount),
        new.company_id, null, null);
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_audit_customer_invoice_booked on public.invoices;
create trigger trg_audit_customer_invoice_booked after insert or update of verifikation_id on public.invoices for each row execute function public.audit_customer_invoice_booked();
