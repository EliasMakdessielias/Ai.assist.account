-- Auditlogg för AI-support (all AI-kommunikation sparas och kan granskas). Isolerad per företag.
create table if not exists public.support_ai_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid,
  user_id uuid,
  question text,
  answer text,
  in_scope boolean,
  escalated boolean not null default false,
  route text,
  model text
);
create index if not exists support_ai_events_company_idx on public.support_ai_events (company_id, created_at desc);
alter table public.support_ai_events enable row level security;
drop policy if exists support_ai_events_select on public.support_ai_events;
-- Kunden ser sitt företags egna AI-händelser; skrivning sker via edge (service role).
create policy support_ai_events_select on public.support_ai_events for select
  using (company_id in (select user_company_ids()));
