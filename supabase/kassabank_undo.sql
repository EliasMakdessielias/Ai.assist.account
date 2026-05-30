-- Spåra inläsningar (batch) + återställ bankhändelse när verifikation raderas
alter table bank_transactions
  add column if not exists import_batch uuid,
  add column if not exists imported_at timestamptz default now();

create or replace function on_verifikation_delete()
returns trigger language plpgsql security definer as $$
begin
  -- Bokföringsverifikation borttagen -> faktura låses upp
  update supplier_invoices set bokford = false, verifikation_id = null
    where verifikation_id = old.id;
  -- Betalningsverifikation borttagen -> faktura åter obetald
  update supplier_invoices set paid_amount = 0, paid_date = null, status = 'unpaid', betalning_ver_id = null
    where betalning_ver_id = old.id;
  -- Bankhändelse kopplad till verifikationen -> åter ej bokförd
  update bank_transactions set status = 'unmatched', verifikation_id = null
    where verifikation_id = old.id;
  return old;
end $$;

drop trigger if exists trg_verifikation_delete on verifikationer;
create trigger trg_verifikation_delete
  before delete on verifikationer
  for each row execute function on_verifikation_delete();
