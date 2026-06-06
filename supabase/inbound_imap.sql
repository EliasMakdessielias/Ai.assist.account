-- IMAP-import: idempotens på Message-ID. Migration "inbound_imap_idempotency".
alter table public.inbound_email_log add column if not exists message_id text;
create unique index if not exists inbound_email_log_message_id_key
  on public.inbound_email_log(message_id) where message_id is not null;
alter table public.documents add column if not exists inbound_message_id text;
