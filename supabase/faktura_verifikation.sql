-- Länk från kundfaktura till dess bokförda verifikation
alter table invoices add column if not exists verifikation_id uuid references verifikationer(id) on delete set null;
