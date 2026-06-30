-- ROBO-bp Steg 2A: server-side läsning av STRIKT BEGRÄNSAD bokföringskontext.
-- SECURITY DEFINER + medlemskapsgrind. Minimal projektion, hårda LIMITs. Inga bilagor, ingen OCR-text,
-- inga råa fakturarader, inga personnummer, inga secrets. Läser bara – muterar ALDRIG.
create or replace function public.robo_bp_context(p_company uuid, p_fiscal_year_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_start date; v_end date;
  v_accounts jsonb; v_balances jsonb; v_vers jsonb; v_sup jsonb; v_cust jsonb;
begin
  if p_company is null or p_company not in (select user_company_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_fiscal_year_id is not null then
    select start_date, end_date into v_start, v_end from public.fiscal_years where id = p_fiscal_year_id and company_id = p_company;
  end if;

  -- Kontoplan: ENDAST nr, namn, klass (kontoklass = första siffran), aktiv. Max 200.
  select coalesce(jsonb_agg(jsonb_build_object('nr', account_nr, 'name', name, 'class', substr(account_nr, 1, 1), 'active', is_active) order by account_nr), '[]'::jsonb)
    into v_accounts
  from (select account_nr, name, is_active from public.accounts where company_id = p_company order by account_nr limit 200) a;

  -- Summerad balans/resultat per kontoklass för räkenskapsåret (om datum finns), annars allt.
  select coalesce(jsonb_agg(jsonb_build_object('class', klass, 'debet', round(d, 2), 'kredit', round(k, 2), 'saldo', round(d - k, 2)) order by klass), '[]'::jsonb)
    into v_balances
  from (
    select substr(vr.account_nr, 1, 1) as klass, sum(coalesce(vr.debet, 0)) d, sum(coalesce(vr.kredit, 0)) k
    from public.verifikation_rows vr join public.verifikationer v on v.id = vr.verifikation_id
    where v.company_id = p_company and v.makulerad_av is null
      and (v_start is null or v.datum between v_start and v_end)
    group by 1
  ) b;

  -- Senaste 10 verifikationer: id, datum, beskrivning, total, status. INGA rader.
  select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'verNr', ver_nr, 'datum', datum, 'beskrivning', left(coalesce(beskrivning, ''), 120), 'total', round(coalesce(total_debet, 0), 2), 'status', status) order by datum desc, ver_nr desc), '[]'::jsonb)
    into v_vers
  from (select id, ver_nr, datum, beskrivning, total_debet, status from public.verifikationer where company_id = p_company and makulerad_av is null order by datum desc, ver_nr desc nulls last limit 10) t;

  -- Senaste 10 leverantörsfakturor: id, leverantörsnamn, datum, förfallo, total, moms, status, kredit.
  select coalesce(jsonb_agg(jsonb_build_object('id', si.id::text, 'supplierId', si.supplier_id::text, 'supplier', left(coalesce(s.name, ''), 80), 'invoiceDate', si.invoice_date, 'dueDate', si.due_date, 'total', round(coalesce(si.total_amount, 0), 2), 'vat', round(coalesce(si.vat_amount, 0), 2), 'status', si.status, 'kredit', coalesce(si.kreditfaktura, false)) order by si.invoice_date desc), '[]'::jsonb)
    into v_sup
  from (select id, supplier_id, invoice_date, due_date, total_amount, vat_amount, status, kreditfaktura from public.supplier_invoices where company_id = p_company and coalesce(makulerad, false) = false order by invoice_date desc nulls last limit 10) si
  left join public.suppliers s on s.id = si.supplier_id;

  -- Senaste 10 kundfakturor: id, kundnamn, datum, total, status.
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id::text, 'customerId', i.customer_id::text, 'customer', left(coalesce(c.name, ''), 80), 'invoiceDate', i.invoice_date, 'total', round(coalesce(i.total_amount, 0), 2), 'status', i.status) order by i.invoice_date desc), '[]'::jsonb)
    into v_cust
  from (select id, customer_id, invoice_date, total_amount, status from public.invoices where company_id = p_company order by invoice_date desc nulls last limit 10) i
  left join public.customers c on c.id = i.customer_id;

  return jsonb_build_object(
    'accounts', v_accounts, 'balances', v_balances, 'verifications', v_vers,
    'supplierInvoices', v_sup, 'customerInvoices', v_cust,
    'counts', jsonb_build_object('accounts', jsonb_array_length(v_accounts), 'verifications', jsonb_array_length(v_vers), 'supplierInvoices', jsonb_array_length(v_sup), 'customerInvoices', jsonb_array_length(v_cust))
  );
end $$;
