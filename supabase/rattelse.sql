-- Spårbart rättelseflöde (Bokföringslagen 1999:1078, avvikelse 4 i SYSTEMDOKUMENTATION.md §16).
-- Kedja: original (status='rattad') → rättelseverifikation (serie R, omvända rader, status='rattelse')
-- → ersättningsverifikation (vanlig aktiv verifikation med relation `ersatter`).
--
-- Skillnad mot makulering: makulering NOLLAR en post (motverifikation, samma serie/datum);
-- rättelse nollar OCH ersätts med korrekt bokföring (serie R + ny verifikation). Båda bevarar originalet.
--
-- Låst period: originalet ändras aldrig (endast spårbarhetslänkning status/rattad_av, som inte är
-- bokföringsinnehåll); rättelseverifikationen bokförs på första öppna datum eller användarens valda
-- öppna datum. Valt datum i låst period blockeras av periodlåset (PERIODLÅST-fel).
--
-- GUC:er (transaktionslokala, endast settbara av SECURITY DEFINER-RPC:er):
--   app.makulera_insert  – systemets egen insättning av motverifikationer/rättelseverifikationer + rader
--   app.rattelse_link    – tillåter ENBART spårbarhetslänkning (status/rattad_av/makulerad_av) på låst original
--   app.periodlas_bypass – administrativ total-radering (reset/purge), som tidigare

-- 1) Additiva kolumner + utökad status.
alter table public.verifikationer add column if not exists rattad_av uuid references public.verifikationer(id);
alter table public.verifikationer add column if not exists rattar uuid references public.verifikationer(id);
alter table public.verifikationer add column if not exists ersatter uuid references public.verifikationer(id);
alter table public.verifikationer drop constraint if exists verifikationer_status_chk;
alter table public.verifikationer add constraint verifikationer_status_chk
  check (status in ('aktiv', 'makulerad', 'motverifikation', 'rattad', 'rattelse'));
-- Ersättningsverifikationen är en VANLIG aktiv verifikation (kan själv makuleras/rättas) med relationen `ersatter`.

-- 2) Första öppna bokföringsdatum (för rättelse när originalets period är låst).
create or replace function public.first_open_booking_date(p_company uuid) returns date
language plpgsql security definer set search_path = public as $$
declare
  v_lock text; v_lock_end date; v_start date; v_end date; v_d date;
begin
  select bokforing_last_tom into v_lock from public.companies where id = p_company;
  if v_lock ~ '^\d{4}-\d{2}$' then
    v_lock_end := (to_date(v_lock || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
  elsif v_lock ~ '^\d{4}-\d{2}-\d{2}$' then
    v_lock_end := to_date(v_lock, 'YYYY-MM-DD');
  end if;
  select start_date, end_date into v_start, v_end
    from public.fiscal_years where company_id = p_company and status = 'active'
    order by start_date limit 1;
  if v_start is not null then
    v_d := greatest(v_start, coalesce(v_lock_end + 1, v_start));
    if v_d > v_end then
      raise exception 'PERIODLÅST: Det finns inget öppet datum i det aktiva räkenskapsåret. Justera låset under Inställningar eller öppna ett nytt räkenskapsår.';
    end if;
  else
    v_d := coalesce(v_lock_end + 1, current_date);
  end if;
  return v_d;
end $$;

-- 3) Periodlås, UPDATE-grenen: ren spårbarhetslänkning (status/rattad_av/makulerad_av) från systemets
--    RPC:er ändrar INTE bokföringsinnehållet och tillåts även när posten ligger i låst period.
--    Kolumnjämförelsen garanterar att inget bokföringsinnehåll ändras under GUC:en.
create or replace function public.enforce_periodlas_verifikation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_period_open(new.company_id, new.datum);
    return new;
  elsif tg_op = 'UPDATE' then
    if current_setting('app.rattelse_link', true) = 'on'
       and new.datum = old.datum
       and new.company_id is not distinct from old.company_id
       and new.ver_nr = old.ver_nr
       and new.ver_serie is not distinct from old.ver_serie
       and new.beskrivning is not distinct from old.beskrivning
       and coalesce(new.total_debet, 0) = coalesce(old.total_debet, 0)
       and coalesce(new.total_kredit, 0) = coalesce(old.total_kredit, 0) then
      return new;
    end if;
    perform public.assert_period_open(old.company_id, old.datum);
    perform public.assert_period_open(new.company_id, new.datum);
    return new;
  else
    perform public.assert_period_open(old.company_id, old.datum);
    return old;
  end if;
end $$;

-- 4) Oföränderlighet utökas: rättade original och rättelseverifikationer skyddas som makulerade.
create or replace function public.protect_makulerad_verifikation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.periodlas_bypass', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.status in ('makulerad', 'motverifikation', 'rattad', 'rattelse') then
    raise exception 'MAKULERAD: Verifikation % är % och kan inte ändras eller raderas. Historiken bevaras enligt Bokföringslagen.', old.ver_nr, old.status;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

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
    if found and v_status in ('makulerad', 'motverifikation', 'rattad', 'rattelse') then
      raise exception 'MAKULERAD: Verifikation % är % – raderna kan inte ändras. Historiken bevaras enligt Bokföringslagen.', v_nr, v_status;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- 5) Länk-/statusvalidering vid INSERT: status- och relationskolumnerna kan inte missbrukas från klient.
create or replace function public.validate_verifikation_links() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid; v_status text;
begin
  if current_setting('app.periodlas_bypass', true) = 'on' then return new; end if;
  if new.status in ('makulerad', 'rattad') then
    raise exception 'FEL: En ny verifikation kan inte skapas med status %.', new.status;
  end if;
  if new.status in ('motverifikation', 'rattelse') and current_setting('app.makulera_insert', true) <> 'on' then
    raise exception 'FEL: Verifikationer med status % skapas endast via systemets makulerings-/rättelsefunktion.', new.status;
  end if;
  if new.ersatter is not null then
    select company_id, status into v_company, v_status from public.verifikationer where id = new.ersatter;
    if not found then
      raise exception 'FEL: Verifikationen som ska ersättas finns inte.';
    end if;
    if v_company is distinct from new.company_id then
      raise exception 'ATKOMST_NEKAD: Ersättningen måste avse en verifikation i samma företag.';
    end if;
    if v_status <> 'rattad' then
      raise exception 'FEL: Endast en rättad verifikation kan ersättas.';
    end if;
  end if;
  if new.rattar is not null then
    select company_id into v_company from public.verifikationer where id = new.rattar;
    if not found or v_company is distinct from new.company_id or new.status <> 'rattelse' then
      raise exception 'FEL: Ogiltig rättelsekoppling.';
    end if;
  end if;
  if new.motverkar is not null then
    select company_id into v_company from public.verifikationer where id = new.motverkar;
    if not found or v_company is distinct from new.company_id or new.status <> 'motverifikation' then
      raise exception 'FEL: Ogiltig makuleringskoppling.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_validate_ver_links on public.verifikationer;
create trigger trg_validate_ver_links
  before insert on public.verifikationer
  for each row execute function public.validate_verifikation_links();

-- 6) Makulering: GUC:en sätts numera FÖRE motverifikationens insert (krävs av länkvalideringen ovan).
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
  if v_orig.status in ('rattad', 'rattelse') then
    raise exception 'FEL: Verifikation % ingår i en rättelsekedja (%) och kan inte makuleras.', v_orig.ver_nr, v_orig.status;
  end if;

  v_mot_nr := public.next_ver_nr(v_orig.company_id, v_orig.ver_serie);
  perform set_config('app.makulera_insert', 'on', true);
  insert into public.verifikationer(company_id, ver_nr, ver_serie, datum, beskrivning,
                                    total_debet, total_kredit, created_by, status, motverkar)
  values (v_orig.company_id, v_mot_nr, v_orig.ver_serie, v_orig.datum,
          left('Makulering av ' || v_orig.ver_nr || coalesce(': ' || nullif(trim(p_orsak), ''), ''), 200),
          v_orig.total_kredit, v_orig.total_debet, v_actor, 'motverifikation', v_orig.id)
  returning id into v_mot_id;
  insert into public.verifikation_rows(verifikation_id, account_nr, account_name, debet, kredit, transaction_info, sort_order)
  select v_mot_id, r.account_nr, r.account_name, coalesce(r.kredit, 0), coalesce(r.debet, 0), r.transaction_info, r.sort_order
  from public.verifikation_rows r where r.verifikation_id = v_orig.id;
  perform set_config('app.makulera_insert', 'off', true);

  update public.verifikationer set status = 'makulerad', makulerad_av = v_mot_id where id = v_orig.id;

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

-- 7) Rättelse-RPC: skapar rättelseverifikationen (serie R, omvända rader) atomärt och markerar
--    originalet som rättat. Ersättningsverifikationen bokförs separat av användaren (relation `ersatter`).
create or replace function public.ratta_verifikation(p_ver_id uuid, p_orsak text, p_datum date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_orig public.verifikationer%rowtype;
  v_locked boolean := false;
  v_datum date;
  v_rat_id uuid;
  v_rat_nr text;
begin
  if nullif(trim(p_orsak), '') is null then
    raise exception 'FEL: Ange en orsak till rättelsen.';
  end if;
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
    raise exception 'MAKULERAD: Verifikation % är makulerad och kan inte rättas.', v_orig.ver_nr;
  end if;
  if v_orig.status = 'motverifikation' then
    raise exception 'FEL: En motverifikation kan inte rättas.';
  end if;
  if v_orig.status = 'rattad' then
    raise exception 'RÄTTAD: Verifikation % är redan rättad.', v_orig.ver_nr;
  end if;
  if v_orig.status = 'rattelse' then
    raise exception 'FEL: En rättelseverifikation kan inte rättas. Bokför en ny verifikation i stället.';
  end if;

  begin
    perform public.assert_period_open(v_orig.company_id, v_orig.datum);
  exception when others then
    v_locked := true;
  end;
  v_datum := coalesce(p_datum,
                      case when v_locked then public.first_open_booking_date(v_orig.company_id) else v_orig.datum end);

  perform public.log_accounting_audit(
    'verification_correction_started', 'verifikation', v_orig.id::text, null,
    jsonb_build_object('original_verification_id', v_orig.id, 'original_ver_nr', v_orig.ver_nr,
                       'reason', left(trim(p_orsak), 200), 'correction_date', v_datum,
                       'period_locked_original', v_locked),
    v_orig.company_id, null, null);

  -- Rättelseverifikation i serie R. Periodlåset validerar v_datum (PERIODLÅST-fel om låst datum valts).
  v_rat_nr := public.next_ver_nr(v_orig.company_id, 'R - Rättelser');
  perform set_config('app.makulera_insert', 'on', true);
  insert into public.verifikationer(company_id, ver_nr, ver_serie, datum, beskrivning,
                                    total_debet, total_kredit, created_by, status, rattar)
  values (v_orig.company_id, v_rat_nr, 'R - Rättelser', v_datum,
          left('Rättelse av verifikation ' || v_orig.ver_nr || ': ' || trim(p_orsak), 200),
          v_orig.total_kredit, v_orig.total_debet, v_actor, 'rattelse', v_orig.id)
  returning id into v_rat_id;
  insert into public.verifikation_rows(verifikation_id, account_nr, account_name, debet, kredit, transaction_info, sort_order)
  select v_rat_id, r.account_nr, r.account_name, coalesce(r.kredit, 0), coalesce(r.debet, 0), r.transaction_info, r.sort_order
  from public.verifikation_rows r where r.verifikation_id = v_orig.id;
  perform set_config('app.makulera_insert', 'off', true);

  -- Spårbarhetslänkning av originalet – ändrar inget bokföringsinnehåll, tillåts även i låst period.
  perform set_config('app.rattelse_link', 'on', true);
  update public.verifikationer set status = 'rattad', rattad_av = v_rat_id where id = v_orig.id;
  perform set_config('app.rattelse_link', 'off', true);

  perform public.log_accounting_audit(
    'verification_reversal_created', 'verifikation', v_rat_id::text, null,
    jsonb_build_object('original_verification_id', v_orig.id, 'original_ver_nr', v_orig.ver_nr,
                       'reversal_verification_id', v_rat_id, 'reversal_ver_nr', v_rat_nr,
                       'reason', left(trim(p_orsak), 200), 'correction_date', v_datum,
                       'period_locked_original', v_locked),
    v_orig.company_id,
    jsonb_build_object('status', 'aktiv'),
    jsonb_build_object('status', 'rattad', 'rattad_av', v_rat_id));

  return jsonb_build_object('ok', true, 'rattelse_id', v_rat_id, 'rattelse_nr', v_rat_nr,
                            'datum', v_datum, 'period_locked_original', v_locked);
end $$;
grant execute on function public.ratta_verifikation(uuid, text, date) to authenticated, service_role;

-- 8) Behandlingshistorik: status med i update-loggen; ersättningsverifikation loggar
--    verification_replacement_created (nya vern) + verification_corrected (originalet, hela kedjan).
create or replace function public.audit_verifikation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text := case when auth.uid() is not null then 'ui' else 'system' end;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.log_accounting_audit('verification_created', 'verifikation', new.id::text, v_src,
        jsonb_build_object('ver_nr', new.ver_nr, 'ver_serie', new.ver_serie, 'datum', new.datum,
          'total_debet', new.total_debet, 'total_kredit', new.total_kredit), new.company_id, null, null);
      if new.ersatter is not null then
        perform public.log_accounting_audit('verification_replacement_created', 'verifikation', new.id::text, v_src,
          jsonb_build_object('original_verification_id', new.ersatter,
            'replacement_verification_id', new.id, 'replacement_ver_nr', new.ver_nr,
            'correction_date', new.datum), new.company_id, null, null);
        perform public.log_accounting_audit('verification_corrected', 'verifikation', new.ersatter::text, v_src,
          (select jsonb_build_object('original_verification_id', o.id, 'original_ver_nr', o.ver_nr,
             'reversal_verification_id', o.rattad_av,
             'replacement_verification_id', new.id, 'replacement_ver_nr', new.ver_nr,
             'correction_date', new.datum)
           from public.verifikationer o where o.id = new.ersatter), new.company_id, null, null);
      end if;
    elsif tg_op = 'UPDATE' then
      perform public.log_accounting_audit('verification_updated', 'verifikation', new.id::text, v_src,
        jsonb_build_object('ver_nr', new.ver_nr), new.company_id,
        jsonb_build_object('beskrivning', old.beskrivning, 'total_debet', old.total_debet, 'total_kredit', old.total_kredit, 'is_locked', old.is_locked, 'status', old.status),
        jsonb_build_object('beskrivning', new.beskrivning, 'total_debet', new.total_debet, 'total_kredit', new.total_kredit, 'is_locked', new.is_locked, 'status', new.status));
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
