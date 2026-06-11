-- Tvingande periodlås (Bokföringslagen 1999:1078, avvikelse 2 i SYSTEMDOKUMENTATION.md §16).
-- DB-nivå: ingen verifikation kan skapas, ändras eller raderas i låst period eller utanför
-- öppet räkenskapsår – oavsett klient (UI, edge, service_role). Bokföringslogiken är oförändrad;
-- triggrarna validerar bara. Felmeddelanden på svenska med prefix PERIODLÅST:.
--
-- Regler:
--   1) companies.bokforing_last_tom ('YYYY-MM' från Inställningar, alt. 'YYYY-MM-DD'):
--      datum <= låsets sista dag → blockeras (insert/update/delete).
--   2) fiscal_years: finns räkenskapsår för företaget måste datum ligga i ett ÖPPET ('active') år.
--      Saknar företaget räkenskapsår helt → ingen årsspärr (nystartade företag blockeras inte).
--   3) Bankavstämning (verifikation_rows.avstamd) är INTE en bokföringsändring och tillåts även i låst period.
--   4) Bypass endast för administrativ total-radering (reset_company/purge_test_data) via
--      transaktionslokal GUC app.periodlas_bypass (samma mönster som app.bulk_import).

-- 1) Central kontroll.
create or replace function public.assert_period_open(p_company uuid, p_datum date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lock text; v_lock_end date; v_fy int; v_open int;
begin
  if current_setting('app.periodlas_bypass', true) = 'on' then return; end if;
  if p_company is null or p_datum is null then return; end if;

  select bokforing_last_tom into v_lock from public.companies where id = p_company;
  if not found then return; end if;   -- företaget håller på att raderas (cascade) – inget att skydda

  if v_lock is not null and v_lock <> '' then
    if v_lock ~ '^\d{4}-\d{2}$' then
      v_lock_end := (to_date(v_lock || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
    elsif v_lock ~ '^\d{4}-\d{2}-\d{2}$' then
      v_lock_end := to_date(v_lock, 'YYYY-MM-DD');
    end if;
    if v_lock_end is not null and p_datum <= v_lock_end then
      raise exception 'PERIODLÅST: Bokföringen är låst till och med %. Verifikationer daterade % eller tidigare kan inte skapas, ändras eller raderas. Justera låset under Inställningar om det är fel.', v_lock, v_lock_end;
    end if;
  end if;

  select count(*) into v_fy from public.fiscal_years where company_id = p_company;
  if v_fy > 0 then
    select count(*) into v_open from public.fiscal_years
      where company_id = p_company and status = 'active' and p_datum between start_date and end_date;
    if v_open = 0 then
      raise exception 'PERIODLÅST: Datumet % ligger utanför öppet räkenskapsår. Öppna rätt räkenskapsår under Inställningar → Räkenskapsår.', p_datum;
    end if;
  end if;
end $$;

-- 2) Verifikationer: insert/update/delete valideras. UPDATE kräver att BÅDE gamla och nya
--    datumet är öppet (annars kan en låst post ändras eller flyttas in i låst period).
create or replace function public.enforce_periodlas_verifikation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_period_open(new.company_id, new.datum);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.assert_period_open(old.company_id, old.datum);
    perform public.assert_period_open(new.company_id, new.datum);
    return new;
  else
    perform public.assert_period_open(old.company_id, old.datum);
    return old;
  end if;
end $$;
drop trigger if exists trg_periodlas_verifikation on public.verifikationer;
create trigger trg_periodlas_verifikation
  before insert or update or delete on public.verifikationer
  for each row execute function public.enforce_periodlas_verifikation();

-- 3) Verifikationsrader: samma skydd via moderverifikationens datum. Saknas modern
--    (cascade efter ver-radering) har ver-triggern redan avgjort. Ändring av ENBART
--    avstämningsflaggan (avstamd) tillåts – bankavstämning ändrar inte bokföringen.
create or replace function public.enforce_periodlas_ver_rows() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ver uuid; v_company uuid; v_datum date;
begin
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
    select v.company_id, v.datum into v_company, v_datum from public.verifikationer v where v.id = v_ver;
    if found then perform public.assert_period_open(v_company, v_datum); end if;
  end if;
  if tg_op = 'UPDATE' and new.verifikation_id is distinct from old.verifikation_id and old.verifikation_id is not null then
    select v.company_id, v.datum into v_company, v_datum from public.verifikationer v where v.id = old.verifikation_id;
    if found then perform public.assert_period_open(v_company, v_datum); end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_periodlas_ver_rows on public.verifikation_rows;
create trigger trg_periodlas_ver_rows
  before insert or update or delete on public.verifikation_rows
  for each row execute function public.enforce_periodlas_ver_rows();

-- 4) Bypass för administrativ total-radering: reset_company och purge_test_data raderar
--    medvetet ALLT (auditas redan). En transaktionslokal GUC släpper förbi periodlåset.
--    Funktionerna återskapas identiskt med tillägget av EN rad (set_config).
create or replace function public.reset_company(p_company uuid, p_opts jsonb)
returns jsonb language plpgsql security definer as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_uid uuid := auth.uid();
  v jsonb := '{}'::jsonb; n int;
begin
  perform public._assert_company_access(p_company);
  if coalesce((p_opts->>'bookkeeping')::boolean, false) then
    perform set_config('app.periodlas_bypass', 'on', true);  -- avsiktlig total-radering, auditas nedan
    delete from public.verifikationer where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('verifikationer', n);
  end if;
  if coalesce((p_opts->>'customer_invoices')::boolean, false) then
    delete from public.invoices where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('invoices', n);
  end if;
  if coalesce((p_opts->>'supplier_invoices')::boolean, false) then
    delete from public.supplier_invoices where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('supplier_invoices', n);
  end if;
  if coalesce((p_opts->>'bank_transactions')::boolean, false) then
    delete from public.bank_transactions where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('bank_transactions', n);
  end if;
  if coalesce((p_opts->>'documents')::boolean, false) then
    delete from public.documents where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('documents', n);
  end if;
  if coalesce((p_opts->>'salaries')::boolean, false) then
    delete from public.salaries where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('salaries', n);
  end if;
  if coalesce((p_opts->>'products')::boolean, false) then
    delete from public.products where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('products', n);
  end if;
  if coalesce((p_opts->>'customers')::boolean, false) then
    update public.invoices set customer_id = null where company_id = p_company and customer_id is not null;
    delete from public.customers where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('customers', n);
  end if;
  if coalesce((p_opts->>'suppliers')::boolean, false) then
    update public.supplier_invoices set supplier_id = null where company_id = p_company and supplier_id is not null;
    delete from public.suppliers where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('suppliers', n);
  end if;
  if coalesce((p_opts->>'chart_of_accounts')::boolean, false) then
    perform set_config('app.bulk_import', 'on', true);
    perform set_config('app.allow_locked_change', 'on', true);  -- tillåt radering av låsta vid full återställning
    delete from public.accounts where company_id = p_company;
    get diagnostics n = row_count; v := v || jsonb_build_object('accounts', n);
  end if;
  if coalesce((p_opts->>'settings')::boolean, false) then
    begin
      update public.companies set onboarded = false where id = p_company;
      v := v || jsonb_build_object('settings_reset', true);
    exception when undefined_column then
      v := v || jsonb_build_object('settings_reset', false);
    end;
  end if;
  insert into public.audit_log(company_id, entity, action, new_data, changed_by, changed_by_email)
  values (p_company, 'company', 'reset', p_opts || jsonb_build_object('result', v), v_uid, v_email);
  return jsonb_build_object('ok', true, 'deleted', v);
end;
$$;

create or replace function public.purge_test_data(p_company uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_uid uuid := auth.uid();
  d jsonb := '{}'::jsonb; n int; v_accounts int;
begin
  if not public.is_platform_admin() then
    raise exception 'ATKOMST_NEKAD: Endast administratörer kan tömma testdata.';
  end if;
  if p_company is null then
    raise exception 'FEL: företag saknas.';
  end if;

  perform set_config('app.periodlas_bypass', 'on', true);  -- avsiktlig total-radering, auditas nedan

  -- Barnposter hanteras via FK (cascade/set-null). Ordning: filer/transaktioner
  -- → fakturor → verifikationer → register → loggar.
  delete from public.documents          where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('documents', n);
  delete from public.bank_transactions  where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('bank_transactions', n);
  delete from public.invoices           where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('invoices', n);
  delete from public.supplier_invoices  where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('supplier_invoices', n);
  delete from public.verifikationer     where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('verifikationer', n);
  delete from public.salaries           where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('salaries', n);
  delete from public.account_import_batches where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('import_batches', n);
  delete from public.products           where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('products', n);
  delete from public.customers          where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('customers', n);
  delete from public.suppliers          where company_id = p_company; get diagnostics n = row_count; d := d || jsonb_build_object('suppliers', n);

  -- KONTOPLANEN ÄR GRUNDDATA OCH RADERAS ALDRIG (varken låsta eller olåsta konton).
  select count(*) into v_accounts from public.accounts where company_id = p_company;

  insert into public.audit_log(company_id, entity, action, new_data, changed_by, changed_by_email)
  values (p_company, 'company', 'purge_test_data',
          d || jsonb_build_object('chart_of_accounts_preserved', true, 'preserved_accounts', v_accounts),
          v_uid, v_email);

  return jsonb_build_object('ok', true, 'deleted', d,
                            'chart_of_accounts_preserved', true, 'preserved_accounts', v_accounts);
end;
$$;
