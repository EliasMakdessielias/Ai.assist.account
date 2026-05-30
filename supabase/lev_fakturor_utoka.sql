-- Leverantörsfakturor: utöka för Spiris-listan (löpnr, OCR, valuta, betalstatus, bokföringslänkar)
alter table supplier_invoices
  add column if not exists lopnr integer,
  add column if not exists ocr text,
  add column if not exists currency text default 'SEK',
  add column if not exists paid_amount numeric not null default 0,
  add column if not exists paid_date date,
  add column if not exists bokford boolean not null default false,
  add column if not exists makulerad boolean not null default false,
  add column if not exists kostnadskonto text default '4000',
  add column if not exists verifikation_id uuid references verifikationer(id) on delete set null,
  add column if not exists betalning_ver_id uuid references verifikationer(id) on delete set null;
