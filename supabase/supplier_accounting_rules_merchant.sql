-- Utöka regelmotorn till kvitton: regler kan nyckla på butik/säljare (merchant_name) i stället
-- för supplier_id. Samma tabell (ingen parallell modell): leverantörsfakturor → supplier_id,
-- kvitton → merchant_name (normaliserat), supplier_id null.

alter table public.supplier_accounting_rules add column if not exists merchant_name text;

create index if not exists idx_supplier_accounting_rules_merchant
  on public.supplier_accounting_rules (company_id, merchant_name, status);
