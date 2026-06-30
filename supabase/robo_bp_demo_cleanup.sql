-- ROBO-bp Demo-data – CLEANUP. Tar bort EXAKT demo-datan i ENDAST testbolaget. Reversibel, idempotent.
-- Rör ALDRIG kontoplan, räkenskapsår, feature flags eller riktiga bolag.
do $$
declare c uuid := '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5';
begin
  delete from public.verifikation_rows where verifikation_id in
    (select id from public.verifikationer where company_id = c and ver_serie = 'DEMO');
  delete from public.verifikationer   where company_id = c and ver_serie = 'DEMO';
  delete from public.invoice_rows where invoice_id in
    (select id from public.invoices where company_id = c and invoice_nr like 'DEMO-%');
  delete from public.invoices          where company_id = c and invoice_nr like 'DEMO-%';
  delete from public.supplier_invoices where company_id = c and invoice_nr like 'DEMO-%';
  delete from public.suppliers         where company_id = c and name like 'DEMO %';
  delete from public.customers         where company_id = c and name like 'DEMO %';
end $$;
