-- ROBO-bp Demo-data 1 – SEED. Liten, reversibel, tydligt DEMO-märkt. ENDAST testbolaget 4f0d… .
-- Inga personuppgifter, inga riktiga motparter, inga bilagor/OCR/betalningar/integrationer.
-- Kör robo_bp_demo_cleanup.sql FÖRST (idempotent). Kontoplan/räkenskapsår rörs aldrig.
do $$
declare
  c uuid := '4f0d40a9-a1f1-4271-ad6b-dbbc481853d5';
  s1 uuid; s2 uuid; cu1 uuid; cu2 uuid; v uuid;
begin
  -- Leverantörer (2, fiktiva)
  insert into public.suppliers(company_id, name, org_nr, is_active) values
    (c, 'DEMO Leverantör Alfa AB', 'DEMO000001', true) returning id into s1;
  insert into public.suppliers(company_id, name, org_nr, is_active) values
    (c, 'DEMO Leverantör Beta AB', 'DEMO000002', true) returning id into s2;

  -- Kunder (2, fiktiva). kundtyp + faktura_installningar är NOT NULL.
  insert into public.customers(company_id, name, org_nr, kundtyp, faktura_installningar) values
    (c, 'DEMO Kund Ett AB', 'DEMO000003', 'foretag', '{}'::jsonb) returning id into cu1;
  insert into public.customers(company_id, name, org_nr, kundtyp, faktura_installningar) values
    (c, 'DEMO Kund Två AB', 'DEMO000004', 'foretag', '{}'::jsonb) returning id into cu2;

  -- Verifikationer (10, ver_serie='DEMO', status 'aktiv', daterade inom räkenskapsåret 2026)
  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-01','DEMO','2026-02-03','[DEMO] Försäljning konsulttjänst',12500,12500,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'1930','Bankkonto',12500,0,0),(v,'3001','Försäljning',0,10000,1),(v,'2611','Utgående moms 25%',0,2500,2);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-02','DEMO','2026-02-10','[DEMO] Inköp kontorsmateriel',1000,1000,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'6110','Kontorsmateriel',800,0,0),(v,'2641','Ingående moms',200,0,1),(v,'1930','Bankkonto',0,1000,2);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-03','DEMO','2026-03-01','[DEMO] Lokalhyra mars',6250,6250,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'5010','Lokalhyra',5000,0,0),(v,'2641','Ingående moms',1250,0,1),(v,'1930','Bankkonto',0,6250,2);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-04','DEMO','2026-03-15','[DEMO] Försäljning vara (faktura)',6250,6250,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'1510','Kundfordringar',6250,0,0),(v,'3001','Försäljning',0,5000,1),(v,'2611','Utgående moms 25%',0,1250,2);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-05','DEMO','2026-04-02','[DEMO] Datakommunikation',500,500,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'6230','Datakommunikation',400,0,0),(v,'2641','Ingående moms',100,0,1),(v,'1930','Bankkonto',0,500,2);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-06','DEMO','2026-04-20','[DEMO] Bankavgift',150,150,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'6570','Bankkostnader',150,0,0),(v,'1930','Bankkonto',0,150,1);

  -- DEMO-07: TOM beskrivning → triggar missing_ver_desc
  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-07','DEMO','2026-05-05','',300,300,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'6110','Kontorsmateriel',300,0,0),(v,'1930','Bankkonto',0,300,1);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-08','DEMO','2026-05-12','[DEMO] Momsredovisning',2500,2500,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'2611','Utgående moms 25%',2500,0,0),(v,'2641','Ingående moms',0,1550,1),(v,'2650','Redovisningskonto moms',0,950,2);

  -- DEMO-09: AVSIKTLIG OBALANS (total_debet≠total_kredit) → triggar unbalanced_ver. Endast demo, rensas av cleanup.
  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-09','DEMO','2026-05-25','[DEMO] OBALANSERAD anomali (avsiktlig)',1000,900,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'4010','Inköp varor',1000,0,0),(v,'1930','Bankkonto',0,900,1);

  insert into public.verifikationer(company_id,ver_nr,ver_serie,datum,beskrivning,total_debet,total_kredit,status)
    values (c,'DEMO-10','DEMO','2026-06-08','[DEMO] Försäljning tjänst',3750,3750,'aktiv') returning id into v;
  insert into public.verifikation_rows(verifikation_id,account_nr,account_name,debet,kredit,sort_order) values
    (v,'1930','Bankkonto',3750,0,0),(v,'3001','Försäljning',0,3000,1),(v,'2611','Utgående moms 25%',0,750,2);

  -- Leverantörsfakturor (3). currency ∈ (SEK..). paid_amount/bokford/makulerad NOT NULL.
  insert into public.supplier_invoices(company_id,supplier_id,invoice_nr,invoice_date,due_date,amount_excl_vat,vat_amount,total_amount,status,currency,paid_amount,bokford,makulerad) values
    (c, s1,   'DEMO-LF-01','2026-04-10','2026-05-10',5000,1250,6250,'obetald','SEK',0,   false,false),  -- FÖRFALLEN → supplier_overdue
    (c, null, 'DEMO-LF-02','2026-06-01','2026-07-15',1600, 400,2000,'obetald','SEK',0,   false,false),  -- supplier_id NULL → supplier_no_name
    (c, s2,   'DEMO-LF-03','2026-06-05','2026-07-20', 800, 200,1000,'betald', 'SEK',1000,false,false);  -- normal/betald

  -- Kundfakturor (2)
  insert into public.invoices(company_id,customer_id,invoice_nr,invoice_date,due_date,amount_excl_vat,vat_amount,total_amount,status) values
    (c, cu1, 'DEMO-KF-01','2026-04-15','2026-05-15',5000,1250,6250,'skickad'),  -- FÖRFALLEN → customer_overdue
    (c, cu2, 'DEMO-KF-02','2026-06-10','2026-07-10',3000, 750,3750,'skickad');  -- normal
end $$;
