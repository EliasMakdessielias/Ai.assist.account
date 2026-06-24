-- Etapp 3B-0: isolerad säkerhetshärdning av public.user_company_ids().
-- Reproducerbar spegling av redan applicerad DB-migration:
--   version 20260624222148  name harden_user_company_ids_search_path
-- OBS: redan applicerad i produktionsdatabasen. Denna fil finns för reproducerbarhet i nya miljöer.
-- Applicera INTE destruktivt igen i en miljö där den redan körts (CREATE OR REPLACE är dock idempotent).
--
-- ENDAST säkerhetskonfiguration + schemakvalificering. Funktionell logik byte-identisk mot tidigare:
--   SET search_path = '' + fullt kvalificerade objekt (public.*; auth.uid() redan kvalificerad;
--   coalesce löses från pg_catalog som alltid är implicit i search_path).
-- Bevarar: signatur (), RETURNS SETOF uuid, owner postgres, LANGUAGE sql, SECURITY DEFINER,
--          VOLATILE, PARALLEL UNSAFE, grants (CREATE OR REPLACE rör ej owner/ACL).

CREATE OR REPLACE FUNCTION public.user_company_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
  select uc.company_id
  from public.user_companies uc
  join public.companies c on c.id = uc.company_id
  where uc.user_id = auth.uid()
    and coalesce(c.suspended, false) = false
$function$;
