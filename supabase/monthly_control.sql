-- Månadskontroll – datamodell, behörighet och regelmotor.
-- Tillämpat via migrationerna:
--   monthly_control_tables        (tabeller + RLS + index + realtime)
--   monthly_control_actions       (_mc_recount, åtgärds-RPC:er, mc_open_counts)
--   monthly_control_run_engine    (run_monthly_control – regelmotorn)
-- Denna fil är referens/dokumentation. Endast LÄSNING av bokföringsdata sker i motorn (inga mutationer).

-- ── Tabeller ──────────────────────────────────────────────────────────────
create table if not exists public.monthly_controls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  year int not null, month int not null check (month between 1 and 12),
  status text not null default 'not_started',           -- not_started/in_progress/needs_action/ready_for_review/closed
  progress_percent int not null default 0,
  critical_count int not null default 0, high_count int not null default 0,
  normal_count int not null default 0, low_count int not null default 0, resolved_count int not null default 0,
  last_run_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), closed_at timestamptz,
  unique (company_id, year, month)
);

create table if not exists public.monthly_control_items (
  id uuid primary key default gen_random_uuid(),
  monthly_control_id uuid not null references public.monthly_controls(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  module text not null, related_type text, related_id uuid,
  title text not null, description text,
  priority text not null default 'normal',               -- critical/high/normal/low
  status text not null default 'open',                   -- open/in_progress/waiting_for_user/waiting_for_support/resolved/ignored/blocked
  assigned_to uuid references auth.users(id), due_date date,
  suggested_action text, action_url text, rule_key text not null,
  source_data jsonb not null default '{}'::jsonb,
  ignored_reason text, resolved_by uuid references auth.users(id), resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Idempotens: en punkt per kontroll+regel+objekt.
create unique index if not exists monthly_control_items_uniq
  on public.monthly_control_items (monthly_control_id, rule_key, coalesce(related_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.monthly_control_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.monthly_control_items(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id), body text not null, created_at timestamptz not null default now()
);

create table if not exists public.monthly_control_events (
  id uuid primary key default gen_random_uuid(),
  monthly_control_id uuid references public.monthly_controls(id) on delete cascade,
  item_id uuid references public.monthly_control_items(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id),
  event_type text not null,                              -- run/created/auto_resolved/started/resolved/ignored/assigned/comment/reopened
  detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- RLS: läsning per företag (user_company_ids). Mutationer endast via SECURITY DEFINER-RPC.
-- Se migration monthly_control_tables för policies + realtime på monthly_control_items.

-- ── RPC:er (se migrationer för fullständiga definitioner) ───────────────────
--   run_monthly_control(company,year,month) -> jsonb   (kör regler, idempotent upsert, auto-resolve, recount)
--   start_mc_item(item) / resolve_mc_item(item) / ignore_mc_item(item, reason) / reopen_mc_item(item)
--   assign_mc_item(item, user) / comment_mc_item(item, body) -> uuid
--   mc_open_counts(company) -> jsonb {critical, high, open}   (sidomeny/dashboard-badge)

-- ── Regler som motorn kör (schema-verifierade) ──────────────────────────────
-- Inkorg:   unlinked_inbox_documents(hög), untolkad_documents(normal),
--           low_confidence_documents(normal), failed_ai_interpretations(hög)
-- Bokföring: unbalanced_journal_entries(kritisk), journal_entry_without_attachment(normal)
-- Lev.fakt: unbooked_supplier_invoices(hög), supplier_invoice_without_kontering(normal),
--           overdue_supplier_invoices(kritisk), unhandled_credit_invoices(hög)
-- Kundfakt: unbooked_customer_invoices(hög)  [verifikation_id saknas]
-- Bank:     unmatched_bank_transactions(hög)
-- Lön:      employees_missing_data(normal)
--
-- DEFERRED (kräver data/struktur som ännu inte finns – byggs när underlaget finns):
--   * Moms: ingen momsrapport-tabell finns → momsrapport-status/differens kan inte kontrolleras.
--   * Kontoavstämning per konto: ingen avstämd-flagga per konto (endast verifikation_rows.avstamd).
--   * Kundfaktura förfallen/utkast + lönekörning utkast/ej bokförd: status-vokabulär ej fastställt
--     (tabellerna invoices/salaries saknar data) → undviker gissade filter (bokföringskorrekthet).
--   * E-postunderlag utan företagsmatchning: plattformsnivå (inbound_email_log), ej företagsskopat.
