-- OCR-test = internt diagnostikverktyg → strikt superadmin-only även server-side.
-- Skärper get_ocr_provider_config: tidigare (can_view_operations() OR is_superadmin()) → ENDAST is_superadmin().
-- Oförändrat: SECURITY DEFINER, search_path, returtyp, body, inga secrets exponeras.
-- set_ocr_provider_config rörs INTE (redan is_superadmin() + platform_audit_log).
create or replace function public.get_ocr_provider_config()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r public.ocr_provider_config;
begin
  if not public.is_superadmin() then
    raise exception 'forbidden';
  end if;
  select * into r from public.ocr_provider_config where id limit 1;
  return jsonb_build_object(
    'folioEnabled', coalesce(r.folio_enabled, false),
    'folioBaseUrl', r.folio_base_url,
    'updatedAt', r.updated_at
  );
end $function$;
