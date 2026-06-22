-- Global support-widget: läsmarkörer (olästa-badge), olästräkning, realtime + ljud-bilagor.
-- Tillämpad via migration support_widget_reads_unread_realtime + support_attachment_allow_audio.
-- support-bucketens allowed_mime_types utökades även med audio/* (storage.buckets).

-- Per användare/ärende: när användaren senast läste ärendet (server-side, ej bara localStorage).
create table if not exists public.support_reads (
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);
alter table public.support_reads enable row level security;

drop policy if exists support_reads_select_own on public.support_reads;
drop policy if exists support_reads_insert_own on public.support_reads;
drop policy if exists support_reads_update_own on public.support_reads;
create policy support_reads_select_own on public.support_reads for select using (user_id = auth.uid());
create policy support_reads_insert_own on public.support_reads for insert with check (user_id = auth.uid());
create policy support_reads_update_own on public.support_reads for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Markera ett ärende som läst t.o.m. nu (upsert) för inloggad användare.
create or replace function public.mark_support_read(p_ticket_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.support_reads (ticket_id, user_id, last_read_at)
  values (p_ticket_id, auth.uid(), now())
  on conflict (ticket_id, user_id) do update set last_read_at = excluded.last_read_at;
end; $$;

-- Antal olästa supportsvar för inloggad kund: support-/AI-svar (is_admin) i icke-stängda
-- egna ärenden, nyare än senaste läsning. Egna meddelanden räknas aldrig som olästa.
create or replace function public.support_unread_count()
returns integer language sql security definer set search_path = public stable as $$
  select coalesce(count(*), 0)::int
  from public.support_messages m
  join public.support_tickets t on t.id = m.ticket_id
  left join public.support_reads r on r.ticket_id = t.id and r.user_id = auth.uid()
  where t.created_by_user_id = auth.uid()
    and t.status <> 'closed'
    and m.is_admin = true
    and m.sender_user_id is distinct from auth.uid()
    and m.created_at > coalesce(r.last_read_at, t.created_at);
$$;

grant execute on function public.mark_support_read(uuid) to authenticated;
grant execute on function public.support_unread_count() to authenticated;

-- Realtime: kunden ska se nya supportsvar utan sidrefresh (RLS gäller fortfarande).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.support_messages';
  end if;
end $$;
