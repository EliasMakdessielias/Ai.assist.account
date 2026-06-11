-- Makulering via motverifikation (Bokföringslagen 1999:1078, avvikelse 3 i SYSTEMDOKUMENTATION.md §16).
-- Originalverifikationen BEVARAS (status='makulerad') och en motverifikation med omvänd kontering
-- skapas i samma serie/datum. Inga negativa debet/kredit-rader – sidorna byts. Makulerade
-- verifikationer och motverifikationer blir OFÖRÄNDERLIGA (skyddstriggers).
-- Periodlåset gäller: makulering i låst period blockeras (rättelse i låst period = framtida rättelseflöde).
--
-- GUC:er: app.periodlas_bypass ('on' = administrativ total-radering, reset/purge) släpper även förbi
-- oföränderlighetsskyddet. app.makulera_insert ('on') sätts ENDAST av makulera_verifikation under
-- moverifikationens radinsättning (radskyddet tillåter då rader på en ver med status='motverifikation').

-- 1) Additiva kolumner.
alter table public.verifikationer add column if not exists status text not null default 'aktiv';
alter table public.verifikationer add column if not exists makulerad_av uuid references public.verifikationer(id);
alter table public.verifikationer add column if not exists motverkar uuid references public.verifikationer(id);
do $$ begin
  alter table public.verifikationer add constraint verifikationer_status_chk
    check (status in ('aktiv', 'makulerad', 'motverifikation'));
exception when duplicate_object then null; end $$;

-- 2) Oföränderlighet: makulerad/motverifikation kan aldrig ändras eller raderas (utom admin-total-radering).
create or replace function public.protect_makulerad_verifikation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.periodlas_bypass', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.status in ('makulerad', 'motverifikation') then
    raise exception 'MAKULERAD: Verifikation % är % och kan inte ändras eller raderas. Historiken bevaras enligt Bokföringslagen.', old.ver_nr, old.status;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_makulerad_skydd on public.verifikationer;
create trigger trg_makulerad_skydd
  before update or delete on public.verifikationer
  for each row execute function public.protect_makulerad_verifikation();

-- 3) Radskydd: rader på makulerad/motverifikation är oföränderliga. Undantag:
--    (a) ändring av ENBART avstämningsflaggan, (b) motverifikationens egna radinsättning i RPC:n,
--    (c) admin-total-radering (bypass; cascade-radering efter ver-delete passerar då ver-skyddet släppt).
create or replace function public.protect_makulerad_ver_rows() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ver uuid; v_status text; v_nr text;
begin
  if current_setting('app.periodlas_bypass', true) = 'on'
     or current_setting('app.makulera_insert', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and new.verifikation_id is not distinct from old.verifikation_id
     and new.account_nr = old.account_nr
     and new.account_name is not distinct from old.account_name
     and coalesce(new.debet, 0) = coalesce(old.debet, 0)
     and coalesce(new.kredit, 0) = coalesce(old.kredit, 0)
     and new.transaction_info is not distinct from old.transaction_info
     and new.sort_order is not distinct from old.sort_order then
    return new;   -- endast avstamd ändrad
  end if;
  v_ver := case when tg_op = 'DELETE' then old.verifikation_id else new.verifikation_id end;
  if v_ver is not null then
    select v.status, v.ver_nr into v_status, v_nr from public.verifikationer v where v.id = v_ver;
    if found and v_status in ('makulerad', 'motverifikation') then
      raise exception 'MAKULERAD: Verifikation % är % – raderna kan inte ändras. Historiken bevaras enligt Bokföringslagen.', v_nr, v_status;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_makulerad_skydd_rows on public.verifikation_rows;
create trigger trg_makulerad_skydd_rows
  before insert or update or delete on public.verifikation_rows
  for each row execute function public.protect_makulerad_ver_rows();

-- 4) Central RPC: makulera via motverifikation. Återställer faktura-/bankkopplingar precis som
--    den tidigare delete-triggern gjorde, men originalet bevaras. Periodlåset valideras av
--    befintliga triggers (insert av motverifikationen + statusuppdateringen av originalet).
create or replace function public.makulera_verifikation(p_ver_id uuid, p_orsak text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_orig public.verifikationer%rowtype;
  v_mot_id uuid;
  v_mot_nr text;
begin
  select * into v_orig from public.verifikationer where id = p_ver_id;
  if not found then
    raise exception 'FEL: Verifikationen finns inte.';
  end if;
  if v_actor is not null and not exists (
    select 1 from public.user_companies uc where uc.user_id = v_actor and uc.company_id = v_orig.company_id
  ) then
    raise exception 'ATKOMST_NEKAD: Du har inte åtkomst till detta företag.';
  end if;
  if v_orig.status = 'makulerad' then
    raise exception 'MAKULERAD: Verifikation % är redan makulerad.', v_orig.ver_nr;
  end if;
  if v_orig.status = 'motverifikation' then
    raise exception 'FEL: En motverifikation kan inte makuleras. Bokför en ny verifikation i stället.';
  end if;

  -- Motverifikation: samma serie/datum (periodlåset validerar datumet), omvänd kontering.
  v_mot_nr := public.next_ver_nr(v_orig.company_id, v_orig.ver_serie);
  insert into public.verifikationer(company_id, ver_nr, ver_serie, datum, beskrivning,
                                    total_debet, total_kredit, created_by, status, motverkar)
  values (v_orig.company_id, v_mot_nr, v_orig.ver_serie, v_orig.datum,
          left('Makulering av ' || v_orig.ver_nr || coalesce(': ' || nullif(trim(p_orsak), ''), ''), 200),
          v_orig.total_kredit, v_orig.total_debet, v_actor, 'motverifikation', v_orig.id)
  returning id into v_mot_id;

  perform set_config('app.makulera_insert', 'on', true);
  insert into public.verifikation_rows(verifikation_id, account_nr, account_name, debet, kredit, transaction_info, sort_order)
  select v_mot_id, r.account_nr, r.account_name, coalesce(r.kredit, 0), coalesce(r.debet, 0), r.transaction_info, r.sort_order
  from public.verifikation_rows r where r.verifikation_id = v_orig.id;
  perform set_config('app.makulera_insert', 'off', true);

  update public.verifikationer set status = 'makulerad', makulerad_av = v_mot_id where id = v_orig.id;

  -- Återställ kopplingar så underlaget kan bokföras om (speglar tidigare delete-trigger).
  update public.supplier_invoices set bokford = false, verifikation_id = null where verifikation_id = v_orig.id;
  update public.supplier_invoices set paid_amount = 0, paid_date = null, status = 'unpaid', betalning_ver_id = null
    where betalning_ver_id = v_orig.id;
  update public.bank_transactions set status = 'unmatched', verifikation_id = null where verifikation_id = v_orig.id;
  update public.invoices set verifikation_id = null where verifikation_id = v_orig.id;

  perform public.log_accounting_audit(
    'verification_voided', 'verifikation', v_orig.id::text, null,
    jsonb_build_object('ver_nr', v_orig.ver_nr, 'motverifikation_id', v_mot_id, 'motverifikation_nr', v_mot_nr,
                       'orsak', left(nullif(trim(p_orsak), ''), 200)),
    v_orig.company_id,
    jsonb_build_object('status', 'aktiv'),
    jsonb_build_object('status', 'makulerad', 'makulerad_av', v_mot_id));

  return jsonb_build_object('ok', true, 'motverifikation_id', v_mot_id, 'motverifikation_nr', v_mot_nr);
end $$;
grant execute on function public.makulera_verifikation(uuid, text) to authenticated, service_role;
