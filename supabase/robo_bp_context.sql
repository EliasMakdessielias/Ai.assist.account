-- ROBO-bp Steg 2B: SMART begränsad bokföringskontext (read-only). SECURITY DEFINER + medlemskapsgrind.
-- Smart kontourval (aktiva + använda i året + rörelse + vy-relevant + frågematchning, fyll med övriga, max 300)
-- + read-only summaries (counts/saldon). Inga bilagor, ingen OCR, inga rader, inga personnummer, ingen mutation.
create or replace function public.robo_bp_context(p_company uuid, p_fiscal_year_id uuid default null, p_view text default null, p_question text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_start date; v_end date;
  v_classes text[] := '{}';
  v_accounts jsonb; v_balances jsonb; v_vers jsonb; v_sup jsonb; v_cust jsonb; v_summary jsonb;
begin
  if p_company is null or p_company not in (select user_company_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_fiscal_year_id is not null then
    select start_date, end_date into v_start, v_end from public.fiscal_years where id = p_fiscal_year_id and company_id = p_company;
  end if;
  v_classes := case lower(coalesce(p_view, ''))
    when 'leverantorsfakturor' then array['2', '4', '5', '6', '7']
    when 'kundfakturor' then array['1', '2', '3']
    when 'kassa_bank' then array['1', '2']
    when 'moms' then array['2']
    else array[]::text[] end;

  -- SMART kontourval. Poäng: använd-i-året(5) + frågematch-konto(6) + frågematch-namn(3) + vy-klass(2) + rörelse(1) + aktiv(1). Max 300.
  with used as (
    select distinct vr.account_nr from public.verifikation_rows vr join public.verifikationer v on v.id = vr.verifikation_id
    where v.company_id = p_company and v.makulerad_av is null and (v_start is null or v.datum between v_start and v_end)
  ),
  qwords as (select unnest(regexp_split_to_array(lower(coalesce(p_question, '')), '\s+')) as w),
  ranked as (
    select a.account_nr, a.name, a.is_active,
      (case when a.is_active then 1 else 0 end)
      + (case when a.account_nr in (select account_nr from used) then 5 else 0 end)
      + (case when coalesce(a.opening_balance, 0) <> 0 then 1 else 0 end)
      + (case when substr(a.account_nr, 1, 1) = any (v_classes) then 2 else 0 end)
      + (case when exists (select 1 from qwords q where char_length(q.w) >= 3 and lower(a.name) like '%' || q.w || '%') then 3 else 0 end)
      + (case when a.account_nr in (select w from qwords where w ~ '^[0-9]{3,4}$') then 6 else 0 end) as score
    from public.accounts a where a.company_id = p_company
  )
  select coalesce(jsonb_agg(jsonb_build_object('nr', account_nr, 'name', name, 'class', substr(account_nr, 1, 1), 'active', is_active)), '[]'::jsonb)
    into v_accounts
  from (select account_nr, name, is_active from ranked order by score desc, account_nr limit 300) r;

  select coalesce(jsonb_agg(jsonb_build_object('class', klass, 'saldo', round(d - k, 2)) order by klass), '[]'::jsonb) into v_balances
  from (select substr(vr.account_nr, 1, 1) klass, sum(coalesce(vr.debet, 0)) d, sum(coalesce(vr.kredit, 0)) k
        from public.verifikation_rows vr join public.verifikationer v on v.id = vr.verifikation_id
        where v.company_id = p_company and v.makulerad_av is null and (v_start is null or v.datum between v_start and v_end)
        group by 1) b;

  select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'verNr', ver_nr, 'datum', datum, 'beskrivning', left(coalesce(beskrivning, ''), 120), 'total', round(coalesce(total_debet, 0), 2), 'status', status) order by datum desc, ver_nr desc), '[]'::jsonb) into v_vers
  from (select id, ver_nr, datum, beskrivning, total_debet, status from public.verifikationer where company_id = p_company and makulerad_av is null order by datum desc, ver_nr desc nulls last limit 10) t;

  select coalesce(jsonb_agg(jsonb_build_object('id', si.id::text, 'supplierId', si.supplier_id::text, 'supplier', left(coalesce(s.name, ''), 80), 'invoiceDate', si.invoice_date, 'dueDate', si.due_date, 'total', round(coalesce(si.total_amount, 0), 2), 'vat', round(coalesce(si.vat_amount, 0), 2), 'status', si.status, 'kredit', coalesce(si.kreditfaktura, false)) order by si.invoice_date desc), '[]'::jsonb) into v_sup
  from (select id, supplier_id, invoice_date, due_date, total_amount, vat_amount, status, kreditfaktura from public.supplier_invoices where company_id = p_company and coalesce(makulerad, false) = false order by invoice_date desc nulls last limit 10) si
  left join public.suppliers s on s.id = si.supplier_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id::text, 'customerId', i.customer_id::text, 'customer', left(coalesce(c.name, ''), 80), 'invoiceDate', i.invoice_date, 'dueDate', i.due_date, 'total', round(coalesce(i.total_amount, 0), 2), 'status', i.status) order by i.invoice_date desc), '[]'::jsonb) into v_cust
  from (select id, customer_id, invoice_date, due_date, total_amount, status from public.invoices where company_id = p_company order by invoice_date desc nulls last limit 10) i
  left join public.customers c on c.id = i.customer_id;

  -- SUMMARIES (aggregat över ALL data, inte bara 10) + observation-källor.
  select jsonb_build_object(
    'hasFiscalYear', (p_fiscal_year_id is not null),
    'verCount', (select count(*) from public.verifikationer v where v.company_id = p_company and v.makulerad_av is null and (v_start is null or v.datum between v_start and v_end)),
    'supCount', (select count(*) from public.supplier_invoices si where si.company_id = p_company and coalesce(si.makulerad, false) = false),
    'custCount', (select count(*) from public.invoices i where i.company_id = p_company),
    'supOpen', (select count(*) from public.supplier_invoices si where si.company_id = p_company and coalesce(si.makulerad, false) = false and coalesce(si.paid_amount, 0) < coalesce(si.total_amount, 0)),
    'supOverdue', (select count(*) from public.supplier_invoices si where si.company_id = p_company and coalesce(si.makulerad, false) = false and coalesce(si.paid_amount, 0) < coalesce(si.total_amount, 0) and si.due_date < current_date),
    'custOpen', (select count(*) from public.invoices i where i.company_id = p_company and lower(coalesce(i.status, '')) not in ('betald', 'paid', 'krediterad', 'makulerad')),
    'custOverdue', (select count(*) from public.invoices i where i.company_id = p_company and lower(coalesce(i.status, '')) not in ('betald', 'paid', 'krediterad', 'makulerad') and i.due_date < current_date),
    'incomeTotal', (select round(coalesce(sum(vr.kredit - vr.debet), 0), 2) from public.verifikation_rows vr join public.verifikationer v on v.id = vr.verifikation_id where v.company_id = p_company and v.makulerad_av is null and substr(vr.account_nr, 1, 1) = '3' and (v_start is null or v.datum between v_start and v_end)),
    'costTotal', (select round(coalesce(sum(vr.debet - vr.kredit), 0), 2) from public.verifikation_rows vr join public.verifikationer v on v.id = vr.verifikation_id where v.company_id = p_company and v.makulerad_av is null and substr(vr.account_nr, 1, 1) in ('4', '5', '6', '7') and (v_start is null or v.datum between v_start and v_end)),
    'momsBalance', (select round(coalesce(sum(vr.debet - vr.kredit), 0), 2) from public.verifikation_rows vr join public.verifikationer v on v.id = vr.verifikation_id where v.company_id = p_company and v.makulerad_av is null and substr(vr.account_nr, 1, 2) = '26' and (v_start is null or v.datum between v_start and v_end)),
    'missingVerDesc', (select count(*) from public.verifikationer v where v.company_id = p_company and v.makulerad_av is null and (v_start is null or v.datum between v_start and v_end) and coalesce(btrim(v.beskrivning), '') = ''),
    'unbalancedVer', (select count(*) from public.verifikationer v where v.company_id = p_company and v.makulerad_av is null and (v_start is null or v.datum between v_start and v_end) and abs(coalesce(v.total_debet, 0) - coalesce(v.total_kredit, 0)) > 0.01),
    'supplierNoName', (select count(*) from public.supplier_invoices si left join public.suppliers s on s.id = si.supplier_id where si.company_id = p_company and coalesce(si.makulerad, false) = false and coalesce(btrim(s.name), '') = ''),
    'itemsWithoutStatus', (select count(*) from public.verifikationer v where v.company_id = p_company and v.makulerad_av is null and coalesce(btrim(v.status), '') = '')
  ) into v_summary;

  return jsonb_build_object(
    'accounts', v_accounts, 'balances', v_balances, 'verifications', v_vers,
    'supplierInvoices', v_sup, 'customerInvoices', v_cust, 'summary', v_summary,
    'counts', jsonb_build_object('accounts', jsonb_array_length(v_accounts), 'verifications', jsonb_array_length(v_vers), 'supplierInvoices', jsonb_array_length(v_sup), 'customerInvoices', jsonb_array_length(v_cust))
  );
end $$;
