-- Lärande över tid: spårbar träningsdata från användarens korrigeringar av AI-tolkningen.
-- En rad per ändrat fält: AI:ns originalvärde, användarens slutvärde, AI-säkerhet före,
-- samt leverantör/dokument/modell/promptversion. Företagsisolerat via RLS (user_company_ids).
-- Företagsspecifik data används aldrig för andra företag (RLS + company_id).

create table if not exists public.extraction_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  field text not null,
  original_value text,
  final_value text,
  confidence_before numeric,
  doc_type text,
  model text,
  prompt_version text,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.extraction_corrections enable row level security;

drop policy if exists "extraction_corrections_policy" on public.extraction_corrections;
create policy "extraction_corrections_policy" on public.extraction_corrections
  for all using (company_id in (select user_company_ids()));

create index if not exists idx_extraction_corrections_supplier
  on public.extraction_corrections (company_id, supplier_id, field);
