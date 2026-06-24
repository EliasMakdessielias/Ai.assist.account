# Offline-stöd & PWA – status

Initiativ: säker offline-first/autosave för BokPilot, byggt i etapper. **Endast Etapp 1A är implementerad.**
Ingen autosave, IndexedDB, sync queue, konflikthantering, server-revision eller offline-redigering finns ännu.

## Etapp 1A – säker PWA-grund + verifierad nätverksstatus ✅ (klar)

### Arkitekturbeslut
- **Handskriven Service Worker** (`public/sw.js`) i stället för `vite-plugin-pwa`. Motiv: inga nya
  beroenden, full kontroll på cache-allowlist och uppdateringsflöde, content-hashade Vite-assets
  cachas säkert cache-first utan precompile-manifest. (Bundle-optimering = separat prestandaetapp.)
- **Same-origin-only fetch-hantering.** Allt cross-origin (Supabase API/Storage/Edge Functions,
  Tabler-ikon-CDN, health-anrop) lämnas helt orört → webbläsarens nätverk (network-only).
- **Ingen auto-skipWaiting.** Ny version aktiveras först på användarens val.
- **Network health** via verifierat, tidsbegränsat anrop till Supabase publika `/auth/v1/health`,
  inte enbart `navigator.onLine`.

### Filer (skapade)
- `public/manifest.webmanifest` – installerbar PWA (sv), theme `#1a1a18`, ikon `/logo.svg`.
- `public/sw.js` – versionsstyrd SW (nav network-first, hashed-assets cache-first, övrigt network-only).
- `public/offline.html` – självständig offline-fallback (ingen extern font/ikon/skript).
- `public/kill-sw.html` – standalone kill switch-sida.
- `src/lib/pwa.js` – registrering (endast prod), kontrollerad uppdatering, kill switch, `window.__bokpilotKillSwitch`.
- `src/lib/offline/networkHealth.js` – centralt hälsolager + ren `classifyNetwork()`.
- `src/lib/offline/networkHealth.test.js` – 7 enhetstester för klassningen.
- `src/hooks/useNetworkStatus.js` – React-hook mot hälsolagret.
- `src/components/offline/NetworkStatusBadge.jsx` – diskret status (CSS-prick + svensk text, fungerar offline).

### Filer (ändrade, minimalt/additivt)
- `index.html` – `<link rel="manifest">` + `<meta name="theme-color">`.
- `src/main.jsx` – `registerPWA()` + `startNetworkHealth()` (efter render).
- `src/components/Layout.jsx` – monterar `<NetworkStatusBadge />` (autentiserad vy).

**Inga ändringar i:** bokföringslogik, DB/tabeller, RLS, triggers, Edge Functions, RPC:er, befintliga sparflöden.

### Installerade paket
- **Inga.** (vite-plugin-pwa medvetet bortvalt.)

### Cache-allowlist (exakt)
SW cachar ENBART:
- `/index.html` (app-skal – innehåller ingen användardata)
- `/assets/*` content-hashade JS/CSS (+ andra lokala statiska: woff2/ttf/svg/png/ico/webp)
- `/logo.svg`
- `/manifest.webmanifest`
- `/offline.html`

### Network-only (cachas ALDRIG)
- Alla `*.supabase.co`-anrop (REST, Auth, Storage, Edge Functions, Realtime) – cross-origin, ej hanterade av SW.
- Health-/session-svar.
- Alla icke-GET (mutationer).
- Allt övrigt same-origin GET som inte är på allowlisten.

### Service Worker-livscykel
1. `install`: precachar offline/manifest/logo. **Ingen** skipWaiting.
2. Ny version → `waiting` (gammal version styr vidare, arbete avbryts ej).
3. `src/lib/pwa.js` upptäcker waiting → badge visar **"Ny version av BokPilot finns tillgänglig."** + **Uppdatera**.
4. Användaren klickar → `postMessage('SKIP_WAITING')` → SW `skipWaiting` → `controllerchange` → kontrollerad reload.
5. `activate`: tar bort endast gamla `bokpilot-*`-cacheversioner.

### Kill switch / rollback (verifierad)
- **/kill-sw.html** (fungerar utan app-bundeln): avregistrerar SW + raderar `bokpilot-*`-cache + sätter `bokpilot.pwa.disabled=1`.
- **Konsol:** `window.__bokpilotKillSwitch()`.
- **localStorage-flagga** `bokpilot.pwa.disabled=1` → `registerPWA()` kör killSwitch och registrerar aldrig.
- **Deploy-nivå:** ersätt `public/sw.js` med en self-unregistering stub.
- Rör aldrig Supabase-session, cookies eller bokföringsdata; raderar endast BokPilots egna caches.

### Nätverksstatus (klassning)
`online | unstable | offline | server_unreachable | server_error | session`
- HTTP-svar (även 401/403/5xx) ⇒ servern **nådd** ⇒ aldrig "offline".
- 5xx ⇒ `server_error`. Timeout/nätfel ⇒ `offline` (om `navigator.onLine=false`) annars `server_unreachable`.
- Blandade resultat ⇒ `unstable`. Ogiltig session (Supabase) + nåbar ⇒ `session`.
- Backoff med jitter vid fel, paus när fliken är dold, manuell "Försök igen", visar senaste serverkontakt.

UI-statusar i denna etapp: Online / Instabil anslutning / Offline / Servern kan inte nås / Sessionen behöver
förnyas / Ny version tillgänglig. (Inga "Synkroniserar/Konflikt/Väntar" – funktionerna finns inte ännu.)

### Testresultat
- **Enhetstester:** 815 gröna (inkl. 7 nya för `classifyNetwork`: 401/403 ej offline, 500 ej offline,
  timeout→offline/unreachable, instabil, session). `npm run build` grön.
- **Live (preview/dist, port 4173):**
  - SW registrerad, aktiverad, kontrollerande. Caches: endast `bokpilot-shell-v1` + `bokpilot-assets-v1`.
  - Cache-innehåll = exakt allowlisten; **0 Supabase-svar cachade**.
  - Uppdatering: v2 → **waiting** medan v1 fortsatt styr (ingen auto-aktivering). SKIP_WAITING → v2 aktiv +
    **v1-cache rensad** + kontrollerad reload.
  - Kill switch: 0 registreringar, 0 BokPilot-caches kvar.
- **Ej körbart i denna miljö (manuellt på enhet rekommenderas):** äkta OS-offline-navigering
  (flygplansläge). Verifierat indirekt: app-skal + offline.html ligger i cache och navigeringshanteraren
  är network-first → skal → offline. Bör slutverifieras manuellt i flygplansläge.
- **Ingen typecheck/lint-skript finns** i projektet (endast `vitest`); inget sådant kördes.

### Prestanda (kallstart)
Produktionsbygge (gzip): `index-*.js` ~385 kB, `index-*.css` ~9 kB; tunga libs separata och laddas vid behov
(`pdf` ~140 kB, `xlsx` ~143 kB, `jszip` ~30 kB, `pdf.worker` lazy). **Före:** ingen cache → allt över nät vid
varje start. **Efter:** app-skal + hashade assets serveras från cache vid andra start (mätbart snabbare
upprepad start). Generell bundle-bantning (route-splitting/pdfjs) är **utanför scope** och planeras som egen
prestandaetapp.

### Kända begränsningar
- `session`-status är en heuristik från Supabase auth-state (ingen separat autentiserad poll i denna etapp).
- SW-cacheversion (`v1`) bumpas manuellt per release för att rensa gammal asset-cache; hashade assets är
  immutabla så stale-risk är låg, och navigering är alltid network-first.
- Tabler-ikoner laddas fortfarande från CDN (medvetet lämnat externt denna etapp; offline-kritisk UI som
  badge/offline-sida använder inte ikonfonten). Lokalisering kan göras i en senare UI-/prestandaetapp.
- Ingen CSP finns i projektet; rekommenderas adderas senare (inkl. `worker-src 'self'`).

### Avvikelser från planen
- Inga funktionella avvikelser. Valde handskriven SW framför `vite-plugin-pwa` (motiverat ovan).

## Etapp 1B – produktionshärdning ✅ (klar)

### Automatisk buildId (ersätter manuell versionering)
- `vite.config.js`-plugin `bokpilot-sw-build-id` ersätter `__BUILD_ID__` i `dist/sw.js` efter bygget.
  Prioritet: `VERCEL_GIT_COMMIT_SHA`/`COMMIT_REF`/`VITE_BUILD_ID` → `git rev-parse --short=12 HEAD` →
  content-hash av `dist/assets`. Deterministiskt per build, ändras när releasen ändras. Cache-namn =
  `bokpilot-shell-<buildId>` / `bokpilot-assets-<buildId>`. Diagnostik via SW-message `GET_BUILD_ID`
  → `getBuildId()` i `src/lib/pwa.js`, exponeras som `window.__bokpilotBuildId` + loggas i konsolen.
  **Ingen manuell v1→v2 längre.**

### Exakt cachematchningslogik (härdad fetch-handler)
1. Endast `GET`. Allt annat passerar (network-only).
2. Endast `url.origin === self.location.origin`. Cross-origin (Supabase/CDN/health) returneras aldrig av SW.
3. `navigate`: `/offline.html` & `/kill-sw.html` → direkt nät m. cache-fallback. Övriga rutter → network-first;
   vid lyckat svar cachas `/index.html` som skal; vid nätfel → cachat skal → `/offline.html` → `Response.error()`.
4. `/assets/*` eller filändelse i `{js,mjs,css,woff(2),ttf,otf,eot,svg,png,jpg,jpeg,webp,gif,ico}` → cache-first.
5. Cache sker ENDAST om `res.ok && status===200 && type==='basic' && redirected===false`
   (utesluter redirects, opaque/cross-origin och felsvar). Asset-cache trimmas till max 80 poster (äldst först).
6. Alla cacheoperationer är try/catch:ade → cachefel blockerar aldrig network-only-användning.
7. Rensning vid `activate` tar bort endast `bokpilot-*` som inte är aktuell build.

### Verkliga offline-tester (browser: Chromium via preview/CDP, dist-build)
Origin-servern (localhost:4173) **stoppades på riktigt** under testerna:
- ✅ Omladdning av startsidan offline → app-skalet bootade (titel rätt, `#root` fyllt, ingen webbläsar-felsida).
- ✅ Direktladdning av djup SPA-route `/bokforing/ny` offline → SW serverade skal, routern bootade rätt route.
- ✅ Samma-origin assets (manifest/logo/js/css) serverades från SW-cache medan origin var nere.
- ✅ Supabase aldrig från cache (verifierat: 0 supabase-poster i Cache Storage; cross-origin rörs ej av SW).
- ✅ Recovery: när origin kom tillbaka lyckades live-fetch igen.
- ✅ buildId-rotation (1A-verifierat mönster, nu auto): ny build → waiting utan auto-aktivering →
  SKIP_WAITING → aktiv + gammal cache rensad + kontrollerad reload.
- **Begränsning:** äkta OS-flygplansläge på fysisk enhet bör fortfarande slutverifieras i produktion (Vercel).

### Prestanda (localhost, dist) – före/efter
| Mått | COLD (ingen SW styr) | WARM (SW styr) |
|---|---|---|
| TTFB | ~7 ms | ~7 ms |
| FCP | ~64 ms | ~56 ms |
| DOMContentLoaded | ~51 ms | ~38 ms |
| load | ~52 ms | ~38 ms |
| requests | 28 | 29 |
| nätverksbytes (app-assets) | ~0 (HTTP-cache redan varm) | **0 – allt 29 från cache/SW** |

- **Separering:** På localhost är nätverkskostnaden försumbar och webbläsarens **HTTP-cache** var redan varm,
  så absoluta siffror underskattar en äkta nätverks-kallstart. Den mätbara SW-vinsten: **alla app-assets
  serveras utan nätverk i varmt läge** (0 bytes) och fungerar även när origin är nere/instabil. Vite content-hash
  gör assets cache-bara säkert (cache-first utan stale-risk). LCP gick ej att fånga tillförlitligt på den
  sparsamma login-vyn i headless-läge → **bör mätas i produktion med Lighthouse** (rekommendation).
- Ingen bundle-refaktor gjord (utanför scope).

### Health-modell (precisering)
- Probe = Supabase `/auth/v1/health` (publik, kort timeout, ej cachad). Detta är en **reachability-proxy**
  för "BokPilots servrar nåbara", **inte** full hälsa per deltjänst (REST/Storage/Edge). UI-texterna är
  preciserade: tooltip "BokPilots servrar svarar", "Internet finns men BokPilots servrar svarar inte" (5xx /
  unreachable), "Din inloggning behöver förnyas – servern är nåbar" (session). 401/403 & 5xx ⇒ aldrig offline.
- **Beslut:** byggde INTE ett nytt app-ägt health-endpoint denna etapp (undviker edge-cold-start och extra
  attackyta). Reachability-proxy + preciserade texter räcker; ett dediketat `health` kan övervägas senare.

### Externa ikonresurser
- PWA-/statuskomponenterna (`NetworkStatusBadge`, `offline.html`, `kill-sw.html`) använder **inga** Tabler-/CDN-ikoner
  (CSS-prickar + text) → fungerar fullt ut utan CDN. Verifierat (grep: 0 träffar på `ti `/jsdelivr i offline-komponenter).
- Resten av appens Tabler-ikoner laddas fortfarande från jsdelivr (medvetet kvar; full ikon-lokalisering = senare UI-etapp).

### CSP (Report-Only)
- Lagt i `vercel.json` (rewrites bevarade) som **Content-Security-Policy-Report-Only** (blockerar inget):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
  img-src 'self' data: blob: https://*.supabase.co; font-src 'self' data: https://cdn.jsdelivr.net;
  connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; manifest-src 'self';
  frame-ancestors 'self'; base-uri 'self'; object-src 'none'`.
- Dessutom: `Cache-Control: no-cache` + `Service-Worker-Allowed: /` för `/sw.js`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **Inventering:** inga `eval`/`new Function`/`dangerouslySetInnerHTML`/inline app-scripts (Vite injicerar extern modul).
  `style-src 'unsafe-inline'` krävs p.g.a. React `style={{…}}` (inline style-attribut) – kvarstående undantag.
  `style-src`/`font-src` tillåter jsdelivr (Tabler). **Kända Report-Only-överträdelser att lösa före enforce:**
  de inline-`<script>` i `offline.html`/`kill-sv.html` (statiska recovery-sidor) – hash:as eller flyttas till fil;
  ev. `style 'unsafe-inline'` kan ersättas med nonce/hashes i en senare etapp.
- **Ej enforce ännu** (per krav): rapportläge ska verifieras i produktion först. Inget report-uri konfigurerat
  (överträdelser syns i webbläsarkonsolen); ett rapport-endpoint kan läggas till senare.

### Kill switch / recovery (verifierad)
- Verifierat live: kill switch tog bort **endast** BokPilots SW-registrering + `bokpilot-*`-caches.
  **Främmande cache (`other-system-v1`), `localStorage` (inkl. `activeCompanyId`) överlevde.** 0 SW-reg kvar.
- Fungerar utan React-bundeln (`/kill-sw.html` är fristående HTML+inline-JS) och täcker flera buildId-caches
  (raderar alla `bokpilot-*`) samt flera flikar (avregistrerar delad registrering). Rör aldrig Supabase-session/cookies/IndexedDB.

### Ändrade filer (1B)
`vite.config.js` (buildId-plugin), `public/sw.js` (auto buildId + härdad cache), `src/lib/pwa.js` (getBuildId/diagnostik),
`src/lib/offline/networkHealth.js` (precisering), `src/components/offline/NetworkStatusBadge.jsx` (precisa texter),
`vercel.json` (CSP-RO + headers + sw.js no-cache), `docs/offline-pwa-status.md`.

### Installerade paket (1B)
- **Inga.**

### Kända risker/begränsningar (1B)
- CSP är Report-Only; enforce kräver att inline-scripten i de två statiska HTML-sidorna hash:as/flyttas + ev. style-nonce.
- Perf-siffror är från localhost (HTTP-cache varm); produktionsmätning (Lighthouse, throttling) rekommenderas för
  representativ kall-vs-varm jämförelse och LCP.
- Health = reachability-proxy (auth-gateway), ej per-tjänst.
- `connect-src`/`img-src` använder wildcard `*.supabase.co` (kan snävas till exakt projekt-subdomän senare).

### Rollback (1B)
- Funktionellt: kill switch (`/kill-sw.html` / `window.__bokpilotKillSwitch()` / `bokpilot.pwa.disabled=1`) +
  deploy-stub av `sw.js`. CSP-RO kan tas bort genom att radera `headers`-blocket i `vercel.json` (rewrites kvar).

## Etapp 2A – lokal autosave-pilot ✅ (klar)

**Pilot:** kommentarsutkastet i CheckDrawer på `/ai-bokslut` (bokslut-check-kommentar). Vald för att det är ett
fritt textfält inom ett bokslutsengagemang, **aldrig** del av godkänt årsredovisningsinnehåll eller bokföring,
med en tydlig befintlig serverspar-väg (`bokslut_comment_check`). Ingen ändring av bokföringsdata/serverlogik.

### Installerade paket
- **Inga.** Dexie utvärderades men handrullad IndexedDB-wrapper räcker för 2 stores (mindre yta, inget beroende).

### IndexedDB-schema (`bokpilot-offline`, v1)
- `autosaveEntries` (keyPath `id`) – pilotens textutkast.
- `localMetadata` (keyPath `key`) – reserverad för diagnostik (oanvänd i 2A).
- Post-fält: `id, schemaVersion, userId, companyId, fiscalYearId, engagementId, entityType, fieldId, payload,
  payloadHash, localRevision, writerTabId, createdAt, updatedAt, expiresAt, appBuildId, status`. Status: `local`.
  **Lagras ALDRIG:** token, refresh-token, lösenord, API-nyckel, session, hela användarobjekt.

### Sammansatt nyckel
`userId|companyId|fiscalYearId|engagementId|entityType|fieldId` (entityType=`bokslut_check_comment`,
fieldId=check-id). Hela identiteten verifieras vid **läsning, skrivning och rensning** (`identityMatches`).
Inget utkast kan hittas via enbart entityId/aktivt bolag.

### Autosave
Hook `useAutosaveDraft`: debounce 800 ms, hash-dedup (`payloadHash`, undviker identiska skrivningar), atomisk
`localRevision` via en IndexedDB-transaktion, fångar `QuotaExceededError`/lagringsfel (status → fel, formuläret
fortsätter funka), blockerar aldrig UI. Tomt fält → lokalt utkast raderas. Texter: "Sparar lokalt…",
"Sparat lokalt på den här enheten", "… Ännu inte sparad på servern", "Lokal lagring misslyckades".
Ordet "synkad" används aldrig.

### Återställning (aldrig automatisk)
`RestoreDraftBanner` visar tidpunkt, bolag, räkenskapsår, "finns endast lokalt på den här enheten" + val:
**Återställ / Visa skillnad / Behåll nuvarande / Radera lokalt utkast**. Återställning kräver aktivt klick;
ingen auto-merge, ingen tyst överskrivning av serverinnehåll.

### Bekräftat serversparande
Lokalt utkast raderas ENDAST efter bekräftad lyckad `bokslut_comment_check` (i success-grenen → `clearLocal`).
Vid fel/timeout/401/403/5xx behålls utkastet (catch-grenen rör det inte). "Synkad" visas inte.

### Företags-/års-/användarisolering
Nyckeln innehåller bolag, år, engagemang och användare → byte ger annan nyckel → tidigare kontexts text kan
aldrig visas i ny kontext. Utkast laddas bara vid fullständig nyckelmatchning. Gammalt utkast lämnas lokalt
tills retention/explicit radering.

### Logout-policy
- **Explicit utloggning** (`useAuth.signOut`): purgar den utloggade användarens pilotutkast (best-effort,
  dynamisk import, blockerar aldrig utloggningen).
- **Tillfälligt sessionsfel** (ej `signOut`): rensar INGET (drafts user-keyade; visas aldrig för annan användare).
- **Medveten avgränsning (2A):** en blockerande "varning före utloggning"-dialog lades INTE till (skulle ändra
  delad auth/signout-UX i flera anropsställen). Fältet auto-flushas inom ~1 s och är användarisolerat + purgas
  vid logout. Pre-logout-varning kan läggas till senare.
- **Ärlig begränsning:** application-level isolation, **inte** kryptografisk isolering mot XSS eller lokal
  enhetsåtkomst. IndexedDB beskrivs aldrig som krypterad eller garanterad/permanent lagring.

### Multi-tab
Varje flik har ett `tabId`; `BroadcastChannel('bokpilot-autosave')`. Vid redigering av samma utkast i annan
flik visas "Det här utkastet redigeras även i en annan flik". Ingen tyst last-write-wins; `localRevision`
uppräknas atomärt. (Full serverkonflikthantering byggs inte här.)

### Retention & lagring
`expiresAt = updatedAt + 30 dagar`; `purgeExpired()` körs vid appstart (rensar endast utgångna). Tak
`MAX_ENTRIES=200` (äldst först), `MAX_PAYLOAD_BYTES=50 KB`. `navigator.storage.estimate()` för diagnostik.
`persist()` begärs aldrig automatiskt.

### Feature flag
`src/lib/offline/flags.js`: AV i produktion som standard; PÅ i dev/preview; PÅ för testbolag
(`4f0d40a9-…`) eller via `localStorage bokpilot.flags.autosavePilot='1'`. Av → exakt tidigare beteende
(ingen banner/indikator, ingen IDB-skrivning), och avstängning raderar inte befintlig lokal data.
Diagnostik via `window.__bokpilotFlags`. Flaggan är inte enda säkerhetskontrollen.

### Ändrade/skapade filer (2A)
Nya: `src/lib/offline/{idb.js,autosaveStore.js,flags.js,autosaveStore.test.js}`,
`src/hooks/useAutosaveDraft.js`, `src/components/offline/{AutosaveIndicator.jsx,RestoreDraftBanner.jsx}`.
Ändrade: `src/pages/AiBokslut.jsx` (CheckDrawer-kommentar wired bakom flagga; clearLocal vid lyckad server-spar),
`src/hooks/useAuth.jsx` (purge vid explicit logout), `src/main.jsx` (retention-purge + flagg-diagnostik).
**Orört:** alla sparflöden, RPC:er, RLS, triggers, bokföring.

### Testresultat (2A)
- **Enhetstester:** 822 gröna (7 nya rena helpers: makeId-determinism/full-nyckel, payloadHash, isExpired,
  identityComplete/Matches, byteLength, retention). (Känd flaky: datumkänsligt Kontoanalys-test – orelaterat.)
- **Live (prod-build, Chromium, riktig IndexedDB):** skriv→debounce→**IDB-post med full identitet, payload,
  status=local, INGA tokens**; reload→**RestoreDraftbanner**; återställ→rätt text; **server-spar→lokalt utkast
  borttaget först efter bekräftelse**; **multi-tab-varning**; nyckel = full sammansatt identitet (isolering);
  **flagga av → ingen banner/indikator/IDB-skrivning och befintlig data bevarad**; SW-cache = endast shell/assets
  (inga IDB/API-svar).
- **Code-path-verifierat (ej forcerat live):** serverfel/401/403/5xx behåller lokalt utkast (clearLocal endast i
  success-grenen). Rekommenderas att slutverifieras manuellt med nätverksfel i produktion.

### Kända risker (2A)
- App-level isolation, ej krypto/XSS-skydd (dokumenterat).
- Ingen blockerande pre-logout-varning (medveten avgränsning; purge sker ändå).
- Retention/quota live-testades via enhetstester + startup-purge; quota-fel testat via kodväg.

### Rollback (2A)
Sätt flaggan av (default i prod) → exakt tidigare beteende, ingen radering. Ta bort hook-anropet i CheckDrawer
för fullständig återgång. Lokal data kan rensas via `purgeUserDrafts`/retention eller genom att radera
IndexedDB `bokpilot-offline`. Inget befintligt flöde påverkas.

## Etapp 2B – säkerhetsstängning av piloten ✅ (klar)

Härdning + full verifiering av 2A-piloten. Ingen ny entitet, ingen sync/revision/idempotency/migration.

### Logout-flöde
`useAuth.signOut` (explicit utloggning): listar användarens lokala pilotutkast → om >0 visas bekräftelse
(`window.confirm`) med **antal + senaste spartid** och valen "OK = logga ut och radera" / "Avbryt = återgå".
Avbryt → ingen utloggning, inga utkast raderade. Vid OK körs `supabase.auth.signOut()`; **endast vid lyckad
utloggning** purgas utkasten. Misslyckad utloggning (kast) → utkast behålls. Tillfälligt sessionsfel går aldrig
denna väg → rensar inget. Minimal påverkan på auth-UX (en confirm endast när utkast finns).

### Revisionsalgoritm (multi-tab optimistic concurrency)
Varje skrivning sker i EN readwrite-transaktion (`idbUpdate`): läs aktuell `localRevision`, jämför med hookens
`expectedRevision`; skriv + öka revision atomärt ENDAST vid matchning, annars kasta `RevisionConflict(current)`
(transaktionen avbryts → ingen överskrivning). Hooken: vid konflikt pausas autosave och visar "En nyare lokal
version finns i en annan flik" med **"Läs in nyare version"** (adoptera andra flikens text) eller **"Behåll min
text som separat lokalt utkast"** (sparar min text under en egen fork-identity, adopterar sedan nyare i fältet).
Aldrig automatisk last-write-wins. BroadcastChannel-varningen finns kvar som snabb signal ovanpå detta.

### Kontrollerade kontextbyten (anti-leak)
- CheckDrawer monteras med `key={check.id}` → helt färskt state per check (ingen text läcker check→check).
- AiBokslut stänger drawers vid bolags-/årsbyte (`setSelected(null)` på `[company?.id, fyId]`).
- Hooken nollställer state + `lastHash`/`expectedRev` vid identitetsbyte och använder en `alive`-flagga så
  sena async-resultat från en tidigare identity ignoreras (ingen stale update).

### Felmatris (serverspar) – lokalt utkast behålls
`bokslut_comment_check` rensar lokalt utkast ENBART i success-grenen (`clearLocal`). Alla fel
(offline, timeout, 401, 403, 500, Supabase-fel, avbrutet, okänt svar) går till catch → utkast + formulärtext
behålls, ingen falsk "Sparad på servern". Live-verifierat via fetch-stubbar (network-fail + 500/401-svar).
Lyckad bekräftad respons raderar exakt rätt post (live-verifierat i 2A + 2B).

### Lagringsfel
IndexedDB-adaptern är injicerbar (`__setOpsForTests`). Enhetstestat: `QuotaExceededError` propageras →
hooken sätter status "Lokal lagring misslyckades", formulärtexten finns kvar i React-state, manuell server-spar
fungerar; läsfel (`idbGet` kastar) sväljs → `getDraft` returnerar null (ingen krasch).

### Feature flag-modell (strikt)
- **DEV** (vite dev): på; `localStorage='0'` kan stänga av lokalt.
- **Byggd miljö (production/preview/staging/okänd):** `localStorage` kan ALDRIG aktivera. Aktivering kräver
  allowlistat testbolag (`4f0d40a9-…`) eller testanvändare. En vanlig användare kan inte slå på
  produktionspiloten via localStorage. Diagnostik: `autosaveFlagDiagnostics()` / `window.__bokpilotFlags`.

### IndexedDB-schemaändring
DB `bokpilot-offline` höjd till **v2**: oanvänd store `localMetadata` borttagen i `onupgradeneeded`
(`deleteObjectStore`), `autosaveEntries` + befintliga utkast bevaras. Uppgradering v1→v2 är icke-destruktiv för utkast.

### Byte-baserad storleksgräns
Mäts i UTF-8 bytes via `TextEncoder` (`byteLength`). Max **50 KB per utkast** (`payload-too-large` annars),
max **200 poster** totalt (äldst rensas), retention **30 dagar**. Enhetstestat med Unicode (`😀`=4 bytes, `åäö`=6).

### Flaky-test: rotorsak & fix
`Kontoanalys – hela raden expanderar` föll i isolering p.g.a. en **läckande 150 ms-timer** från
`stangPopout` (`window.close()` + `setTimeout(navigate('/kontoanalys'),150)`): popout-Stäng-testets
`window.close`-mock var no-op → `window.closed` förblev false → den fördröjda `navigate` avfyrades i ett
EFTERFÖLJANDE test och anropade den nyss återställda `nav`-spionen. Fix (endast test): close-mocken sätter
`window.closed=true` (speglar riktig browser) → fallback-guarden hoppar över navigeringen, ingen läcka.
Dessutom frystes systemtiden i testet (`vi.useFakeTimers({toFake:['Date']})` → 2026) för att ta bort beroendet
av `new Date().getFullYear()` i komponentens default-period (skulle annars fela i CI ett annat år).
**Ingen produktionslogik ändrad.**

### Tre testkörningar
Kontoanalys-testet: 14/14 tre gånger i rad. Full svit: se commit-meddelandet (tre på varandra följande gröna körningar).

### Ändrade/skapade filer (2B)
`src/lib/offline/idb.js` (v2 + ta bort localMetadata), `src/lib/offline/autosaveStore.js` (RevisionConflict +
expectedRevision + listUserDrafts + injicerbar ops), `src/lib/offline/flags.js` (strikt env-modell),
`src/hooks/useAutosaveDraft.js` (konflikt + resolvers + paus), `src/hooks/useAuth.jsx` (logout-confirm),
`src/pages/AiBokslut.jsx` (konfliktbanner + key + stäng-drawer-vid-kontextbyte),
`src/pages/Kontoanalys.test.jsx` (flaky-fix), `src/lib/offline/autosaveStore.test.js` (nya tester).

### Kända risker (2B)
- `window.confirm` används för logout-bekräftelsen (blunt men minimalt, fungerar från alla signOut-anrop).
- Konfliktlösning är LOKAL (mellan flikar), inte mot server (serverkonflikt = Etapp 3).
- App-level isolation, ej krypto/XSS (oförändrat).

### Rollback (2B)
Flagga av (default i prod) → tidigare beteende. IDB v2 är additiv/icke-destruktiv; vid behov radera IndexedDB
`bokpilot-offline`. Logout-confirm/konflikt-UI visas bara när flaggan är på.

## Etapp 2C – slutlig acceptansverifiering ✅ (klar)

### 1. Separata serverfel (per fall, ej gemensamt catch)
Servspar extraherat till `commitCheckComment(supabase, checkId, comment)` (kastar vid ALLA fel, true endast vid
validerad respons). Enhetstest (`commit.test.js`) verifierar VARJE fall separat: 401, 403, 500, timeout, AbortError,
offline (Failed to fetch), felaktigt RPC-svar (null/undefined), lyckad. Live (prod-build) per fall separat: 401,
403, 500, abort, offline → **formulärtext + IndexedDB-post behålls, ingen "Kommentar sparad", svenskt fel**.
Lyckad respons rensar exakt rätt post (clearLocal endast i success-grenen; verifierat 2A/2B).

### 2. Logout-flöde (ordning)
`window.confirm` behålls (appens etablerade dialogmönster – används i 11 filer inkl. samma flöden; `ConfirmDialog`
är en kontoplan-lokal wizardmodal, ej delat system). Exakt ordning i `useAuth.signOut`:
1) `listUserDrafts(uid)` → 2) om >0: `window.confirm` (antal + senaste spartid; Avbryt → `return false`, ingen
utloggning) → 3) `await supabase.auth.signOut()` (kastar vid fel → hoppar purge) → 4) **endast vid lyckad**
utloggning: `purgeUserDrafts(uid)` → 5) rensa state. Tillfälligt sessionsfel går aldrig denna väg.
**Live-not:** den explicita utloggningen triggades INTE i preview (sessionen är icke-återställbar där); byggstenarna
`listUserDrafts`/`purgeUserDrafts` är verifierade och ordningen är garanterad av kodstrukturen (purge efter await).

### 3. Kontextisolering
CheckDrawer `key={check.id}` (färskt state per check), drawer stängs vid bolags-/årsbyte, hook nollställer +
`alive`-flagga ignorerar sena async-resultat. Live: check A→B → fält tomt (ingen läcka, 2B+2C). Snabba växlingar
täcks av remount + alive-guard. Användarisolering via nyckeln (userId ingår) + per-användar-purge.

### 4. IndexedDB-läsfel (≠ saknad post)
`getDraftResult` returnerar **draft_loaded | draft_not_found | storage_read_error**. Vid `storage_read_error`
(idbGet kastar / IDB otillgänglig) visar hooken "Lokalt utkast kunde inte läsas", **pausar autosave** (skriver
inte över en eventuell befintlig post), loggar ingen payload, och erbjuder "Försök igen" (`retryRead`).
Enhetstestat (open/read-fel + otillgänglig IDB). Läsfel behandlas ALDRIG som "inget utkast".

### 5. Fork-utkast (synliga & hanterbara)
Separata konfliktkopior listas i CheckDrawer ("Separata lokala konfliktkopior (N)") med spartid + **Återställ**
(läs in i fältet) + **Radera**. `listForkDrafts(identity)` matchar full identity + fork-prefix. Retention 30 dagar
gäller även forks. Live verifierat: fork skapad vid "Behåll min text som separat" → syns i listan → kan raderas.

### 6. Feature flag (serverstyrd, auktoritativ)
Aktivering i byggd miljö = **`has_ai_feature(company, 'offline_autosave_pilot')`** (company_ai_features/plan, RLS).
Inga hårdkodade frontend-ID:n, ingen localStorage/URL-styrning i prod (localStorage endast dev-override).
Live (prod-build): pilot på via serverflagga med **tom localStorage**; icke-allowlistat bolag av; localStorage='1'
aktiverar INTE i byggd miljö. Frontend-flaggan är presentation; server + RLS + servervalidering är auktoritativa.

### 7. Tre testkörningar
Full svit **DETERMINISTISK: 841/841 (79 filer) tre körningar i rad**. Build grön.

### Ändrade/skapade filer (2C)
Nya: `src/lib/offline/commit.js` (+ `commit.test.js`). Ändrade: `src/lib/offline/autosaveStore.js` (getDraftResult/
listForkDrafts/deleteDraftById + tester), `src/lib/offline/flags.js` (serverstyrd), `src/hooks/useAutosaveDraft.js`
(read-error-paus + retryRead + forks), `src/pages/AiBokslut.jsx` (serverflagga + läsfel-banner + fork-lista +
commitCheckComment), `docs/offline-pwa-status.md`. DB: rad i `company_ai_features` (data, ej migration) för testbolaget.

### Kända risker (2C)
- Logout-confirm via `window.confirm` (appmönster); live-logout ej kört i preview (icke-återställbar session) – ordning kodverifierad.
- Read-error live-forcering ej möjlig i preview-harnessen → deterministiska injicerade-ops-tester istället.
- Konfliktlösning är lokal (server-konflikt = Etapp 3).

## Etapp 2D – end-to-end-verifiering (status: EJ KOMPLETT – ett krav Inte verifierad)

### Kodändringar (verifiering visade faktiska brister)
- **Hook-bugg (browserfunnen):** att öppna en check med ett befintligt utkast – utan att skriva – kunde radera
  utkastet (tom-fält-städningen kördes före laddningen var klar). Fix: `initializedRef` (spara/radera först efter
  laddning) + `hadContentRef` (radera tomt utkast ENDAST om användaren själv tömt). Browser-omverifierad: båda
  utkasten kvarstår vid återöppning; städning vid manuell tömning fungerar fortfarande.
- **Riktig timeout:** `commitCheckComment` använder nu en AbortController kopplad via Supabase-adaptern
  (`.abortSignal`), 15 000 ms. Browser-bevisat att signalen når `fetch` och att själva nätverksanropet
  aborteras (inte bara UI). Skild från 401/403/500 och valideringsfel. Ingen auto-retry.
- **Misslyckad signOut:** `useAuth.signOut` kontrollerar nu `{ error }` och raderar INTE utkast vid serverfel.
- **Serverstyrd flagga utan plan-fallback:** `fetchPilotServerEnabled` läser EXPLICIT company_ai_features
  (ingen has_ai_feature/plan-fallback). Frånvaro/false/fel/flera rader → false.

### RLS för company_ai_features (verifierat)
SELECT-policy: `company_id IN user_company_ids()`. INSERT/UPDATE/DELETE har INGA policys. Vanliga `anon`/
`authenticated`-roller kan därför INTE skriva (verifierat: INSERT → RLS-violation; UPDATE/DELETE → 0 rader).
**OBS (PostgreSQL-modellen):** table owner, `service_role` och roller med BYPASSRLS kringgår fortfarande RLS –
administration av pilotflaggan sker via server (service role)/SECURITY DEFINER, aldrig från klienten. PK
`(company_id, feature_key)` ⇒ max en rad per bolag/nyckel.

### Build + tester (efter ALLA 2D-kodändringar)
Build grön. Full svit **DETERMINISTISK: 850/850 (80 filer), tre körningar i rad.**

### Kontextmatris (reversibla fixtures skapade + städade)
Fixtures: extra räkenskapsår 2025 för testbolaget, ett isolerat testbolag B (medlemskap + tillfällig
company_ai_features-rad + licens). **Alla fixtures borttagna efteråt; pilotflaggsrader = 0 (prior value återställd).**
- check A→B: **Verifierad i browser** (ingen läcka direkt/efter laddning, sen async ignoreras, återbyte hittar rätt).
- räkenskapsår A→B: **Verifierad i browser** (drawer stängs, ingen läcka, två utkast med distinkt fiscalYearId, återbyte hittar 2026-utkastet).
- engagement A→B: **Verifierad i browser** (årbyte = engagementbyte; distinkt engagementId).
- bolag A→B (pilot på BÅDA via serverflagga): **Verifierad i browser** (ingen läcka åt något håll, distinkt companyId, återbyte hittar A:s utkast).
- användare A→B: **Inte verifierad** – en andra riktig auth-inloggning kunde inte skapas säkert i testmiljön
  (ingen auth-admin-väg; rå auth.users-insert är osäker). Stödbevis: identiteten innehåller userId,
  `identityMatches` kräver full match (Enhetstestad), och per-användar-purge vid utloggning (Verifierad i browser, L2).

### Logout (recoverable testsession via token-backup/restore)
- utan utkast → ingen dialog, utloggning sker: **Verifierad i browser** (L3: confirm anropas ej).
- med utkast + Avbryt → ingen utloggning, utkast kvar: **Verifierad i browser** (dialog visar antal + senaste tid).
- med utkast + bekräfta → signOut lyckas FÖRST, sedan purge av endast den användarens utkast: **Verifierad i browser** (landade på /login, utkast = 0).
- misslyckad signOut → utkast behålls + sessionen kvar (ingen falsk utloggning): **Verifierad i browser** (L4).
- sessionsavbrott utan explicit logout → utkast behålls: **Kodinspekterad** (purge anropas ENDAST från den
  explicita signOut-knappen, aldrig från auth SIGNED_OUT-event) + L4 stödjer browservägen.

### Felmatris via produktionsadaptern (supabase.rpc, transport-stub)
401, 403, 500, AbortError, offline, felaktigt svar → formulärtext + IDB-post kvar, ingen falsk "Kommentar sparad":
**Verifierad i browser**. Lyckad respons → raderar exakt rätt post: **Verifierad i browser**. Riktig timeout →
fetch-signal aborterad + "Tidsgräns nådd" + utkast kvar: **Verifierad i browser**.

### Flagg-matris
enabled=true→på, enabled=false→av, ingen rad→av, planens AI-features aktiverar INTE (licensierat bolag utan rad
gav av), localStorage aktiverar inte i byggd miljö: **Verifierad i browser**. RLS-skrivskydd: **Integrationstestad**
(SQL som authenticated-roll).

## Nästa (ej påbörjat – inväntar separat beslut)
- **Etapp 2D – kvarstår:** användare A→B i browser kräver en säker andra-konto-fixture (auth-admin). Tills den
  finns är kravet **Inte verifierad** och Etapp 2 ska inte beskrivas som komplett.
- **Etapp 3:** säker Sync Queue (server-revision, idempotency, multi-tab-lås, audit, servervalidering) för piloten.
  Kräver additiv migration (revision-kolumn + idempotens-tabell). Bygg INTE utan separat beslut.
