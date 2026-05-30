-- När en verifikation raderas: återställ kopplad leverantörsfaktura
--  * Bokföringsverifikation borttagen  -> fakturan låses upp (ej bokförd, redigerbar)
--  * Betalningsverifikation borttagen   -> fakturan återgår till obetald
create or replace function on_verifikation_delete()
returns trigger language plpgsql security definer as $$
begin
  update supplier_invoices
    set bokford = false, verifikation_id = null
    where verifikation_id = old.id;

  update supplier_invoices
    set paid_amount = 0, paid_date = null, status = 'unpaid', betalning_ver_id = null
    where betalning_ver_id = old.id;

  return old;
end $$;

drop trigger if exists trg_verifikation_delete on verifikationer;
create trigger trg_verifikation_delete
  before delete on verifikationer
  for each row execute function on_verifikation_delete();
