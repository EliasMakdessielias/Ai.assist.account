# Admin- och plattformssäkerhet

Kort säkerhetsdokumentation för interna/admin-funktioner. Kompletterar `SYSTEMDOKUMENTATION.md`
och de enskilda funktionsdokumenten (t.ex. `docs/FOLIO_OCR.md`).

## OCR-test (Folio-OCR) – internt diagnostikverktyg, superadmin-only

**Status: STÄNGD.** OCR-test är ett **internt diagnostikverktyg** (manuell körning av den experimentella
Folio-OCR-providern + provider-konfiguration). Det är **inte** en kundfunktion och **inte** produktionsklart.
Gemini är produktionsflödet och påverkas inte.

### Åtkomstkrav (alla lager kräver plattforms-superadmin)

| Lager | Objekt | Guard |
|---|---|---|
| Sidomeny (kundapp) | OCR-test-länken i AI-paket-flyouten | `platformAccess.isSuperadmin` |
| Route (kundapp) | `/admin/ocr-test` | `RequireSuperadmin` (`src/components/RequireSuperadmin.jsx`) → redirect till `/` annars |
| Route (admin-subdomän) | `/ocr` (`AdminApp.jsx`) + navval (`AdminLayout.jsx`) | `access.isSuperadmin` / `need: 'superadmin'` |
| Edge Function | `ocr-folio` (healthCheck + dokument-körning) | `my_platform_access().isSuperadmin` → annars `403 forbidden` |
| RPC | `get_ocr_provider_config()` | `is_superadmin()` → annars `RAISE 'forbidden'` |
| RPC | `set_ocr_provider_config()` | `is_superadmin()` (+ `platform_audit_log`) |

`is_superadmin()` = `is_platform_admin()` = medlemskap i tabellen `platform_admins` (via JWT-e-post).
Detta är **samma** flagga som frontend `platformAccess.isSuperadmin` (RPC `my_platform_access`).
En ren `operations_admin` (i `platform_user_roles`) har `canViewOperations=true` men `isSuperadmin=false`
och har därför **ingen** åtkomst till OCR-test i något lager.

### Medvetet OFÖRÄNDRADE produktionsflöden (ej OCR-test-specifika)

- **`documents`-RLS:** `company_id in (select user_company_ids())` – varje bolagsmedlem läser sitt eget
  bolags dokument. Detta är normal kunddata och ska inte begränsas till superadmin.
- **Edge `tolka-underlag`** (Gemini, produktionstolkning): JWT + medlemskap i dokumentets bolag +
  service-lås. Delas av hela appen; får inte begränsas till superadmin.
- **`log_accounting_audit`**, **`set_ocr_provider_config`** (redan superadmin), övriga admin-routes,
  AI-paket/sidomeny i övrigt.

### Verifieringsnivå (ärlig)

- **RPC `get_ocr_provider_config` – verifierad LIVE** med JWT-claim-simulering (`set_config('request.jwt.claims', …)`):
  - superadmin (`admin@bokpilot.se`): `is_superadmin=true` → funktionen returnerar config.
  - icke-superadmin (syntetisk icke-plattforms-e-post): `is_superadmin=false` → `RAISE 'forbidden'`.
- **Edge `ocr-folio` – verifierad med deploy + kodgranskning:** deployad som **version 12, ACTIVE,
  `verify_jwt=true`**; gren `if (!access?.isSuperadmin) return 403` granskad i källan. Samma
  `my_platform_access().isSuperadmin`-grund som RPC:erna.
- **UI/route – enhetstestat** per persona (member / company admin / ops / support / billing / superadmin)
  i `src/components/Sidebar.test.jsx` (20 fall) och `src/components/RequireSuperadmin.test.jsx` (8 fall).
- **Begränsning:** ett **direkt ops-HTTP-anrop** mot `ocr-folio` kunde **inte** köras skarpt, eftersom
  databasen saknar en `operations_admin`-fixture (inga rader i `platform_user_roles`). Den nya guarden
  kollar dock enbart `isSuperadmin`, så member/company admin/ops faller alla på samma "ej superadmin →
  forbidden"-väg (verifierat för den vägen via simuleringen ovan).

### Framtida testpunkt (öppen)

- Skapa en **reversibel `operations_admin`-fixture** (i en transaktion som rullas tillbaka, eller i en
  separat testmiljö) och verifiera skarpt att `ocr-folio` returnerar **`403`** för en ops-roll och **`200`**
  för superadmin – samt att `get_ocr_provider_config` ger `forbidden` för ops. Detta stänger
  verifieringsglappet ovan utan att skapa permanent testdata i produktion.
