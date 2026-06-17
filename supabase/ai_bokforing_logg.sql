-- Spårbarhet/audit för AI-bokföringshjälp: ett förslag per rad. Loggar AI:s svar, förslag,
-- confidence, om manuell granskning krävdes, vilken regelverks-/modellversion som användes och
-- om förslaget tillämpades. Företagsisolerat via RLS (GDPR, avsnitt 12/20 i regelverket).

create table if not exists public.ai_bokforing_logg (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  kind text,                                   -- kvitto | leverantorsfaktura | verifikation
  fraga text,
  svar text,
  konteringsforslag jsonb,
  konfidens numeric,
  kraver_manuell_granskning boolean,
  regelverk_version text,
  model text,
  applied boolean not null default false,      -- om användaren infogade förslaget
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.ai_bokforing_logg enable row level security;

drop policy if exists "ai_bokforing_logg_policy" on public.ai_bokforing_logg;
create policy "ai_bokforing_logg_policy" on public.ai_bokforing_logg
  for all using (company_id in (select user_company_ids()));

create index if not exists idx_ai_bokforing_logg_company on public.ai_bokforing_logg (company_id, created_at desc);
