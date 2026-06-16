-- Lärande regelmotor: leverantör → bokföringskonto (företagsspecifik, spårbar).
-- En regel per (leverantör, fakturakategori, radnyckelord, konto). Confidence stiger med
-- bekräftelser, sänks vid korrigeringar. Globala standardförslag får vara grund, men
-- företagets egen historik väger tyngst. RLS isolerar per företag (user_company_ids).

create table if not exists public.supplier_accounting_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  supplier_name text,
  supplier_org_number text,
  document_type text,
  invoice_category text,                 -- 'debit' | 'kredit'
  line_keyword text,                     -- normaliserat radnyckelord (mobil, bredband, el …)
  account_number text not null,
  account_name text,
  vat_account text,
  vat_rate numeric,
  allocation_pattern jsonb,              -- { share: 0.6 } / flera-konton-mönster
  belopp_type text default 'kostnad',    -- kostnad | ingaende_moms | utgaende_moms | frakt | avgift | leverantorsskuld
  confirmation_count integer not null default 1,
  correction_count integer not null default 0,
  confidence_score numeric not null default 0.2,
  status text not null default 'active', -- active | disabled
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supplier_accounting_rules enable row level security;

drop policy if exists "supplier_accounting_rules_policy" on public.supplier_accounting_rules;
create policy "supplier_accounting_rules_policy" on public.supplier_accounting_rules
  for all using (company_id in (select user_company_ids()));

create index if not exists idx_supplier_accounting_rules_lookup
  on public.supplier_accounting_rules (company_id, supplier_id, status);
