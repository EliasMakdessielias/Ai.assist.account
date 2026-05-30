-- Inkorg: kategorisera underlag + cacha AI-tolkning
alter table documents
  add column if not exists kategori text default 'dokument',
  add column if not exists tolkning jsonb,
  add column if not exists tolkad boolean default false;
