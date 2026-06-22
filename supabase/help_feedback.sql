-- Feedback per handboksartikel ("Hjälpte artikeln dig?"). Användaren ser/skapar bara sin egen.
create table if not exists public.help_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  article_id text,
  article_slug text,
  user_id uuid default auth.uid(),
  company_id uuid,
  answer text,            -- 'ja' | 'nej'
  comment text
);
create index if not exists help_feedback_article_idx on public.help_feedback (article_slug, created_at desc);
alter table public.help_feedback enable row level security;
drop policy if exists help_feedback_insert on public.help_feedback;
drop policy if exists help_feedback_select on public.help_feedback;
create policy help_feedback_insert on public.help_feedback for insert with check (user_id = auth.uid());
create policy help_feedback_select on public.help_feedback for select using (user_id = auth.uid());
