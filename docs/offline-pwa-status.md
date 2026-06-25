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

## Etapp 2E – stängning av kvarvarande E2E-luckor ✅

### 1. Feature-flag-race vid bolagsbyte (åtgärdad + browserverifierad)
Rotorsak: flaggläsningen låg i en delad effekt utan avbrott/nollställning → ett sent svar från bolag A kunde
tillämpas på bolag B, och flaggan nollställdes inte vid byte. Fix (AiBokslut): egen effekt bunden till `companyId`,
`setAutosavePilotServer(false)` direkt vid byte (autosave startar inte förrän rätt bolags flagga verifierats) +
`cancelled`-guard (request generation) som ignorerar sent svar. **Verifierad i browser via auktoritativ state:**
in-app byte B→A→B (rätt flagga utan reload), A(on)→B(off), A(off)→B(on), snabb A→B→A→B (rätt slutläge), och
**fördröjt A-svar efter att B blivit aktivt → ignorerat** (`staleAIgnored`). Inget utkast skrivs under fel companyId.

### 2. Användare A→B (verifierad i browser)
Tillfälligt testkonto B skapades via en **temporär service-role-edge** (`e2e-user-admin`) – service role stannar
server-side, nådde aldrig klienten; endast `@e2e.bokpilot.test`-adresser. Flöde: A skapar utkast → byte till B utan
explicit logout (token togs bort lokalt → A:s utkast raderades INTE) → login som B → **B ser aldrig A:s utkast**
(tomt fält, ingen banner) → B skapar eget utkast → **distinkta userId i IndexedDB** → B explicit logout raderar
ENDAST B:s utkast (A:s kvar) → re-login som A → **A ser endast A:s utkast**.

### 3. Sessionsavbrott (verifierad i browser)
Session ogiltigförklarad (utgången access token + ogiltig refresh token) UTAN explicit logout → Supabase
TOKEN_REFRESH_FAILED → **icke-explicit SIGNED_OUT** → `onAuthStateChange` nollar user → /login (re-auth krävs).
**Utkastet behölls (ingen purge)** – purge sker ENDAST i den explicita `signOut`. Re-auth → samma user → utkast återfunnet.

### 4. Regression
Build grön. Full svit **DETERMINISTISK: 850/850 (80 filer), tre körningar i rad** (diagnostik borttagen, prod-ren kod).

### Testfixtures + cleanup (exakta antal efter)
Återanvände befintliga bolag (inget nytt fullt bolag med kontoplanstrigger): testbolag A (4f0d) + den
disponibla "BokPilot AB - ska tas bort" (d3382ea7) som B, temporära company_ai_features-rader, temporärt
medlemskap, temporärt testkonto. **Cleanup verifierad:** e2e_users=0, B_membership=0, pilot_rows_anywhere=0,
B_temp_features=0, B_engagements=0, test_comments=0; A:s riktiga engagement+licens intakta (1/1). Lokal IDB + backuper rensade.

### Kvarstående manuell åtgärd (säkerhet)
`e2e-user-admin`-edgen är **neutraliserad** (v2: inert 410, ingen service-role, ingen kapacitet) men dess tomma
skal kunde inte raderas helt via tillgängliga verktyg (ingen delete-funktion i MCP, ingen access token för CLI).
**Radera funktionsskalet `e2e-user-admin` via Supabase-dashboard (Edge Functions).** Risken är redan eliminerad.

## Etapp 2F – säkerhetsstängning av `e2e-user-admin`

### Incidentklassificering: INGEN OBEHÖRIG AKTIVITET HITTAD
Exponeringen fanns men loggarna visar ENBART de planerade testoperationerna, utförda av den legitima
admin-användaren (admin@bokpilot.se / 3baa21a4). Inga oväntade konton, sessioner, medlemskap eller identiteter.

### Exponeringsfönster (UTC, 2026-06-24)
v1 deploy **20:44:33** (created_at 1782333873440) → v2 neutralisering **20:52:26** (updated_at 1782334346077). **≈ 7 min 53 s.**

### Anrop mot `e2e-user-admin` (edge- + auth-loggar)
| Tid UTC | Operation | Status | Anropare (verifierad via getUser 200) | Käll-IP | Förväntat? |
|---|---|---|---|---|---|
| 20:45:12 | OPTIONS | 200 | — | edge | Ja |
| 20:45:13 | create → autosave-e2e-b@e2e.bokpilot.test | 200 | admin@bokpilot.se | edge 3.75.x.x | Ja (skapa testkonto B) |
| 20:50:38 | delete-försök (B) | 500 (FK bokslut_audit_log) | admin@bokpilot.se | edge 63.177.x.x | Ja (B raderades sedan via SQL efter audit-rensning) |

Övriga auth-events i fönstret (alla planerade): B login 20:47:22 (klient-IP 83.251.x.x), B logout 20:48:23,
refresh-token-fel 20:49:24 (sessionsavbrottstestet). Inga andra `/admin/*`-anrop. service_role-aktören = edgen.

### Auth-/DB-granskning efter städning (exakta antal)
e2e_users=0, e2e_identities=0, B_user_row=0, B_sessions=0, B_refresh_tokens=0, B_membership=0,
B_bokslut_audit=0, users_created_in_window (kvar)=0, users_total=1 (endast legitim admin). Inga orphaner.

### v1:s auktoriseringsmodell (granskad)
v1 krävde giltig JWT (`verify_jwt=true` + `getUser()`); **create** var domän-låst till `@e2e.bokpilot.test`.
v1 SAKNADE `is_platform_admin()`, testanvändar-allowlist, rate limit, idempotency och egen audit; **delete**
tog ett godtyckligt `userId` utan allowlist → **tillfällig privilege-escalation-exponering** (en autentiserad
användare hade under fönstret kunnat radera valfri auth-användare). Loggarna visar att det INTE utnyttjades.

### Hemligheter (bedömning)
`SUPABASE_SERVICE_ROLE_KEY` användes ENDAST i edge-env. Nyckelvärdet förekom ALDRIG i frontend-bundle, Git
(edgen deployades inline via MCP – ej i repo/lokal mapp/historik), network-svar (endast `{id,email}`/`{ok}`/`{error}`),
console, testoutput eller docs. Endast den PUBLIKA anon-nyckeln användes i browsertesterna. → **Ingen nyckelexponering. Rotation behövs ej.**

### Borttagningsstatus: ✅ FULLSTÄNDIGT RADERAD (verifierad 2026-06-24)
Projektägaren raderade funktionen manuellt (Dashboard/CLI). Borttagningen är verifierad:
- **Metod:** `list_edge_functions` (MCP, **primär kontroll**) + HTTP-prob med `curl` (GET/POST/OPTIONS).
- **Primär kontroll:** `e2e-user-admin` SAKNAS i Edge Functions-listan. Ingen aktiv eller inaktiv version kvar.
- **Endpointstatus:** **GET 404**, **POST 404**, **OPTIONS 404** (samtliga metoder). Primär kontroll och
  HTTP-status samstämmiga → ingen propageringsväntan behövdes.
- **Återdeploy ej möjlig:** ej i Git, ingen lokal funktionsmapp, ingen CI-/deployreferens.
- **Testdata:** 0 (e2e_users/identities/sessions/refresh_tokens/membership/bokslut_audit/pilot-feature-rader/kommentarer).
- **Hemligheter:** inga tillfälliga E2E-secrets; `SERVICE_ROLE_KEY` ej exponerad → ingen rotation.
- **Incidentklassificering:** *"Ingen obehörig aktivitet identifierades i tillgängliga loggar."*
- **Status:** Etapp 2F KOMPLETT. Samtliga acceptanskriterier uppfyllda. Etapp 2 (offline autosave-pilot) komplett.

Historik: funktionen deployades som tillfällig v1 (skapa-kapacitet) under Etapp 2E, neutraliserades till
v2 (inert 410, ingen service-role) under Etapp 2F, och raderades slutligen helt av projektägaren.

### Förebyggande utvecklingsregel (säkerhet)
1. Inga temporära adminfunktioner i produktionsprojekt; auth-admin-tester körs i separat testprojekt/lokal Supabase.
2. Service-role-endpoints kräver plattformsadmin-kontroll + strikt action-allowlist + audit + rate limit.
3. Testfunktioner ska ha automatisk expiry; deployment + cleanup i SAMMA kontrollerade testscript.
4. Browsern får aldrig anropa en generell auth-admin-endpoint.

## Etapp 3B-0 – säkerhetshärdning av `public.user_company_ids()` ✅ (2026-06-25)
Isolerad säkerhetshärdning (separat från synkpiloten). Migration: `harden_user_company_ids_search_path`.
- **Ändring:** lade till `SET search_path = ''` + fullt schemakvalificerade objekt (`public.user_companies`,
  `public.companies`; `auth.uid()` redan kvalificerad; `coalesce` från implicit `pg_catalog`). **Funktionell logik
  byte-identisk.** Bevarade signatur `()`, `SETOF uuid`, owner `postgres`, `SECURITY DEFINER`, `VOLATILE`, grants.
- **Före/efter-paritet (verifierad):** medlem → samma 4 bolag; non-member → `[]`; `auth.uid()=NULL` → `[]`.
  Empirisk RLS (`SET ROLE authenticated`): medlem ser sina rader (3 checks/1 bolag), non-member ser 0 (cross-tenant-deny).
  End-to-end PostgREST med verklig JWT: 4 bolag + checks laddar (200), inga permission_denied.
- **56 beroende RLS-policys oförändrade.** Inga okvalificerade objektreferenser. `search_path` verifierat tomt.
- **Verifiering:** build grön; full svit 850/850 × 3; inga DB-fel orsakade av migrationen. Ingen rollback behövdes.
- **Lås:** endast kort ACCESS EXCLUSIVE på funktionsposten (pg_proc); inga tabellås; atomisk (begin/commit).
- **Avgränsning:** ingen pilot-/synkfunktion implementerad (ingen `bokslut_sync_comment`, revision-kolumn, idempotency-tabell).

## Etapp 3B – servergrund för säker synk av AI Bokslut-kommentar ✅ (2026-06-25)
Migration: `offline_autosave_sync_server_foundation` (repo-fil `supabase/offline_autosave_sync.sql`; 3B-0
speglad reproducerbart i `supabase/harden_user_company_ids.sql`). **Avstängd bakom `offline_autosave_sync`**
(explicit company_ai_features-rad, enabled=true, INGEN plan fallback, default av — ingen aktiv produktionsrad finns).
- **Schema:** `bokslut_checks` + `comment_revision bigint NOT NULL DEFAULT 1`, `comment_updated_at`, `comment_updated_by`
  (ingen FK till auth.users). BEFORE UPDATE-trigger äger revisionsfälten: ökar endast vid faktisk comment-ändring,
  återställer OLD annars (run_bokslut_analysis bumpar updated_at men **ej** comment_revision – verifierat).
- **`bokslut_sync_operations`:** idempotency-tabell, `UNIQUE(user_id, idempotency_key)`, check-constraints
  (entity/op/status), RLS på + `REVOKE ALL` från public/anon/authenticated (ingen klient-SELECT; endast definer-RPC). Retention 90 d (manuell cleanup-query dokumenterad).
- **RPC `bokslut_sync_comment`** (SECURITY DEFINER, `search_path=''`, kvalificerade objekt, EXECUTE endast authenticated):
  färska grindar (auth→entitet→medlemskap→roll→feature→status) **före** idempotency; canonical SHA-256 (jsonb fasta nycklar,
  NFC, `extensions.digest`, ingen klient-hash); claim via `INSERT ON CONFLICT DO NOTHING`; CAS `comment_revision=base`.
- **Gamla `bokslut_comment_check` härdad:** `left(2000)` borttagen → NFC + 8000-byte-avvisning + godkand/last-spärr;
  triggern ökar samma revision (gamla vägen kan inte kringgå storleks-/statusregler).
- **Payload:** `MAX_COMMENT_BYTES = 8000` UTF-8 efter NFC; ingen tyst trunkering (verifierat: 8000 ok, 8001 + 2001 emoji=8004 byte avvisas).
- **Testmatris (verifierad mot DB):** feature av/på, upsert/clear/no_change/overwrite, revision endast vid ändring,
  idempotens (replay=lagrat, mismatch, ny nyckel), revision_conflict, godkand/last-block, non-member/unauthorized/anon/
  authenticated-direktläsning nekas, audit exakt en gång utan kommentartext, clientCreatedAt påverkar ej identitet.
  Samtidighet bekräftades i 3B-1 med parallella DB-sessioner (se nedan).
- **Verifiering:** build grön; full svit 850/850 × 3. All testdata städad (ops=0, sync-audit=0, temp-flagga=0, fixtur återställd).
- **Avgränsning:** ingen klient-sync-queue/Background Sync/andra entiteter implementerade. Funktionen avstängd.

## Etapp 3B-1 – verifieringsstängning med verklig parallellitet ✅ (2026-06-25)
Migration: `offline_autosave_sync_nondisclosure` (repo: `supabase/offline_autosave_sync_nondisclosure.sql`).
**Servern ändrades på en punkt** (konkret test visade läcka): okänd/otillåten check gav tidigare olika svar
(`entity_deleted` vs `membership_removed`) → kunde avslöja att ett UUID fanns i annan tenant. Ny icke-avslöjande
modell: generiskt `not_found` för okänd check / cross-tenant-probe utan tidigare egen operation; `entity_deleted`
endast vid replay där operationraden binder user+nyckel+entitet; `membership_removed` endast vid replay av tidigare behörig op.

**Verifierad med parallella DB-sessioner** (samtidiga PostgREST-anrop, oberoende backends):
- 8 samtidiga identiska (samma nyckel/payload) → exakt **1 mutation + 1 audit**, övriga replay (alla `succeeded`, rev +1 en gång).
- 6 samtidiga samma nyckel/olika payload → **1 succeeded + 5 idempotency_payload_mismatch**.
- 6 samtidiga olika nycklar/samma baseRevision (CAS-race) → **1 succeeded + 5 revision_conflict**.
- Lock-timeout: hållen nyckel (>3 s) + samtidigt riktigt anrop → blockerade **3088 ms** → `transaction_retry`, ingen
  mutation/audit, ingen synlig claimed-rad; retry efter släppt lås → succeeded.

**Integrationstestad atomic rollback:** real RPC i yttre transaktion → ROLLBACK lämnar 0 rader/0 audit, oförändrad
revision, nyckel återanvändbar. *Detta bevisar transaktionell atomicitet, INTE en intern felpunkt efter claim* — en
intern crash-after-claip kunde inte testas utan permanent produktions-test-hook och lämnas därför **Inte verifierad**.

**Integrationstestat (simulerade identiteter):** lost-response-replay (replay returnerar lagrat succeeded, ingen ny
mutation/audit); rollmatris (member upsert/clear ✓, member overwrite nekas utan rad/audit, admin overwrite ✓, reversibel
rollflip); feature-matris (se nedan); gamla RPC:n (no-change → ingen revisionökning, ändring +1, 8000 ✓, 8001/emoji
avvisas, ingen trunkering); entitetsmatris (random UUID → not_found; raderad bunden entitet vid replay → entity_deleted;
cross-tenant-probe → not_found).

**Feature-matris (separata konkreta utfall):** ingen rad → `feature_disabled`; enabled=false → `feature_disabled`;
enabled=true → mutation lyckas; **plan-feature utan explicit rad** → `feature_disabled` (konkret divergens: `has_ai_feature`
med plan-fallback = true, RPC:ns explicita rad-predikat = false → RPC läser ALDRIG plan); **feature av före replay av
tidigare succeeded** → `feature_disabled` (replay kringgår aldrig färska grindar). Alla avvisade fall: 0 ny operationrad, 0 audit, 0 mutation.

**Migrationskedja:** projektet använder INTE `supabase/migrations/`; etablerat format är referens-SQL i `supabase/`-roten
+ MCP `apply_migration` (spårad i `supabase_migrations`). Tre filer = tre migrationer i versionsordning, motsvarar
live-definitionerna, ingen drift; temp hold-RPC + dblink ingår INTE i någon migrationsfil:
`harden_user_company_ids.sql` (20260624222148) → `offline_autosave_sync.sql` (20260624224219) → `offline_autosave_sync_nondisclosure.sql`.

**KVARSTÅR – Inte verifierad:** "olika användare med samma idempotencyKey" är INTE E2E-verifierad mellan två riktiga
principals — projektet har endast 1 auth-användare och en ny temporär auth-admin-edge är utesluten (3B-0/2F-regeln).
`UNIQUE(user_id, idempotency_key)` är schema- och integrationstestad (per-användar-scoping), men inte E2E mellan två konton.

**Temporära testobjekt borttagna:** `_test_hold_sync_key` (pg_proc=0, grants=0, finns ej i någon .sql/deploy-fil),
`dblink`-extension (borttagen; fanns inte före testet). Testanvändarens roll på testbolaget återställd till baseline `admin` (exakt samma värde).

**Status:** 3B-1 markeras INTE komplett. Enda kvarvarande lucka = två riktiga principals (ovan).

**Städning:** ops=0, sync-audit=0, testfixturer=0, feature-rad=0, claimed-orphans=0, roll återställd, dblink-extension
borttagen, temp-RPC borttagen, inga testanvändare. Build grön; full svit 850/850 × 3.

## Etapp 3C – intern feature-avstängd klientprototyp för synkkö ⚠️ (2026-06-25)
Klientens synkkö för EXAKT en entitet (`bokslut_checks.comment`). **AVSTÄNGD i alla byggda miljöer** bakom
`offline_autosave_sync` (serverstyrd, ingen plan-fallback; localStorage/URL/state kan ej aktivera i byggd miljö;
dev kräver dessutom uttrycklig opt-in). **Ingen produktionsrad aktiverad.** Ingen bokföringsåtgärd skapas.

**Nya moduler:** `src/lib/offline/idb.js` (v3 + `syncQueue`-store, bevarar autosave-utkast), `syncQueue.js`
(state machine, deterministisk resultatmappning, retry/backoff, dedup, NFC+8000-byte, per-användar-isolering),
`syncWorker.js` (RPC-anrop med timeout, en op åt gången, drain-while-leader), `syncLeader.js` (Web Locks +
BroadcastChannel-lease-fallback), `flags.js` (`fetchSyncServerEnabled`/`isSyncQueueEnabled`/`syncQueueDiagnostics`),
`hooks/useSyncQueue.js`, `components/SyncQueueUI.jsx` (SyncStatusIndicator/PendingSyncList/ConflictReviewDialog/RetryAction).
Wirad i `AiBokslut`-CheckDrawer bakom flaggan (inert när av → tidigare beteende oförändrat).

**Kärnegenskaper:** lokal op sparas FÖRE nätverksanrop; samma `idempotencyKey` återanvänds vid retry (ny nyckel vid
ny payload); dubbelklick → en op (dedup på identity+payloadHash+baseRevision); endast en flik bearbetar (Web Locks);
konflikt skrivs ALDRIG över automatiskt (tre val, overwrite endast admin/ny nyckel/aktuell baseRevision); autosave-utkast
behålls vid fel/konflikt; "Synkad" visas först vid serverbekräftat succeeded/no_change; diagnostik utan kommentartext.
Resultatmappning (§7) deterministisk; auto-retry endast timeout/unavailable/transaction_retry. baseRevision krävs
(saknas → "Serverversion behöver hämtas", ingen blind op).

**Bevisnivåer:**
- **Enhetstestad:** 33 nya tester (`syncQueue.test.js`) – state machine, resultatmappning (alla domän+transport),
  retry/backoff, dedup/dubbelklick, claim-atomicitet, recoverStuck, byte-gräns, isolering, sanitering (ingen text), leader-tiebreak.
- **Verifierad i browser (auth-fri):** IndexedDB v2→v3-uppgradering bevarar autosave-utkast + skapar `syncQueue`+index;
  Web Locks-exklusivitet (andra exklusiva begäran nekas medan första håller låset → grund för en-flik-bearbetning).
- **Verifierad med parallella DB-sessioner (ärvd från 3B-1):** serverns idempotency/CAS/lock-timeout.
- **Inte verifierad i denna miljö:** full live-E2E (köläggning→RPC→succeeded, offline/reconnect, två RIKTIGA flikar) –
  preview-sessionens refresh token gick ut (kan ej återautentisera utan användaren) och en enda preview-sida kan ej
  hosta två riktiga flikar. Logiken är dock enhetstestad och servervägen parallellt verifierad.

**Blockerare för produktion (kvarstår):** två RIKTIGA principals med samma `idempotencyKey` (1 auth-användare; ingen temp
auth-admin tillåten). **Build grön; full svit 883/883 × 3.** Inga DB-testdata/flaggor/temp-objekt (verifierat: alla = 0).

## Etapp 3C-1 – E2E-verifiering av klientkön (2026-06-25)
Användaren autentiserade preview-sessionen manuellt. E2E kördes via den **riktiga autentiserade workern** (sidans
egen Supabase-klient gjorde RPC-anropen; access/refresh token lästes/loggades aldrig av mig – endast nyckelns
*närvaro* kontrollerades, idempotencyKey rapporteras maskerad). Operationer skrevs till IndexedDB och bearbetades
av sidans worker via riktiga triggers. Isolerat testbolag (4f0d) med temporär `offline_autosave_sync=true`.

**Verifierad i browser (riktig autentiserad worker):**
| Test | Resultat (lokal status + server) |
|---|---|
| §2 Persist före nätverk | op skrevs som `pending` i IndexedDB FÖRE RPC; status_before=pending |
| §3 Online happy path | pending→`succeeded`; DB: rev 1→2, 1 op-rad, 1 audit, ingen kommentartext i audit/serverResult |
| §4 Lost-response replay | samma idempotencyKey → `succeeded` (replay), rev oförändrad (3), ingen ny op/mutation/audit |
| §5 revision_conflict | stale base=1 (server rev=2) → `conflict`, serverVersion rev=2 + changedBy, ingen auto-overwrite, lokal payload kvar |
| §6 godkänd | engagement `godkand` → `rejected`/`engagement_approved`, ingen mutation |
| §6 låst | engagement `last` → `rejected`/`engagement_locked`, ingen mutation |
| §7/§13 feature av efter köläggning | serverflagga false → `paused`/`feature_disabled`; localStorage återaktiverade INTE (serverstyrt); rev oförändrad, ingen audit |
| §14 ingen kommentartext | diagnostik + serverResult innehöll aldrig kommentartext |

Server-/DB-sammanställning efter E2E: rev=3, server-ops `succeeded,conflict,succeeded`, **mutationer=audits=2** (replay/conflict
skapade ingen mutation/audit). operationId loggat, idempotencyKey maskerad.

**Verifierad i browser (auth-fri, från 3C):** IndexedDB v2→v3 utan dataförlust; Web Locks-exklusivitet (andra exklusiva
låstagaren nekas medan första håller låset).

**Enhetstestad:** hela resultatmatrisen (mapServerResult, 15 utfall), retry/backoff deterministiskt (injicerbar klocka+random),
lease-takeover-cykel §9 (claim→stuck→recover→reclaim; samma operationId; attemptCount +1/försök), dedup, claim-atomicitet,
byte-gräns, isolering, sanitering. **38 synkkö-tester; full svit 888/888 × 3.**

**Integrationstestad / Kodinspekterad:** membership_removed (servern returnerar membership_removed – 3B-1; klientmappning enhetstestad);
logout-med-pending + sessionsavbrott-isolering (hook-policy: stoppa worker, släpp ledarskap, per-user-isolering – kodinspekterad,
ej kört live för att inte störa användarens riktiga session); autosave behålls vid fel (hooken raderar aldrig utkast utom vid succeeded – kodinspekterad).

**Inte verifierad:** **två RIKTIGA flikar (§10)** och **BroadcastChannel-fallback i två flikar (§11)** – preview-harnessen är
EN headless sida och kan inte öppna två riktiga browserflikar. Per regeln "ett Web Locks-test i en enda JS-evaluering räknas
inte som tvåflikstest" ersätts dessa INTE med enhetstest. Mekanismen (Web Locks-exklusivitet) är dock browser-verifierad.

**Cleanup (verifierat):** fixturkontroll=0, server-sync-ops=0, feature-flagga=0, fixtur-audit=0, engagement återställt till `pagar`,
lokal IndexedDB-syncQueue tömd (0), dev-localStorage-flagga borttagen. Inga temp-RPC/edge/extensions, inga testanvändare.

## Beslut 3C-1
**NO-GO för begränsad pilot** – men endast på grund av en **kvarvarande obligatorisk lucka**: **tvåfliksledarskap +
BroadcastChannel-fallback i två RIKTIGA flikar** kunde inte köras i denna enkelsidiga harness (får ej ersättas med enhetstest,
får ej GO utan). Samtliga övriga obligatoriska flöden (persist-före-nätverk, online, lost-response, riktig konflikt, feature-av,
godkänd/låst, cleanup, tre gröna regressioner) är **Verifierade i browser**. Återstår för GO: kör §10/§11 i en miljö som kan
öppna två riktiga flikar (t.ex. Playwright multi-page). **Två-principal-idempotens på servern kvarstår som separat blockerare för
produktionsaktivering.**

## Etapp 3C-2 – tvåfliks-/sessionsverifiering: BLOCKERAD av verktygsmiljön → NO-GO (2026-06-25)
Försök att köra de obligatoriska tvåflikstesterna (§3 Web Locks i två pages, §4 BroadcastChannel-fallback i två pages)
samt fullt UI-drivet flöde (§2). **Hård miljöblockerare:**
- **Ingen tvåsidig browserautomation tillgänglig.** Playwright är INTE installerat (saknas i package.json/node_modules;
  `npx` vill ladda ner `playwright@1.61.1`). `Claude_Preview` är en EN-sidig harness och kan inte öppna två pages i samma
  BrowserContext. → §3/§4 **Inte verifierad** (får ej ersättas med enhetstest).
- **Autentiserad storageState kan inte skapas regelkonformt.** §1 förbjuder att läsa/logga access/refresh token OCH
  fullständig storageState; ingen användartillhandahållen storageState finns. Även med Playwright skulle den autentiserade
  kontexten inte kunna skapas utan att bryta mot token-regeln.
- **§2 fullt UI-flöde:** den enkelsidiga harnessens syntetiska DOM-klick öppnade inte CheckDrawerns synk-sektion
  tillförlitligt. Hela synk-kedjan (IDB-commit före RPC → succeeded, persist-före-nätverk, lost-response, konflikt,
  feature-av, godkänd/låst) är dock redan **Verifierad i browser via den riktiga autentiserade workern** (3C-1);
  UI-knappen/komponenterna är **Kodinspekterade** (renderas bakom flaggan, build-verifierade).

Ingen kodändring gjordes (inget konkret E2E-test visade ett produktfel – blockeringen är verktygsmiljö, inte bugg).
Städning verifierad: fixturer=0, server-sync-ops=0, feature-flagga=0, engagement `pagar`, lokal syncQueue=0, dev-flagga borttagen.
Full svit 888/888 × 3 (oförändrad kod).

## Beslut 3C-2
**NO-GO för begränsad intern pilot.** Obligatoriska GO-krav som saknar verifiering: **Web Locks i två riktiga pages**,
**BroadcastChannel-fallback i två riktiga pages**, samt browserverifierad **logout/sessionsavbrott** och **membership_removed**
(de två senare undveks live: skulle störa användarens riktiga session resp. kräva en andra riktig principal). För GO krävs en
miljö med (a) tvåsidig browserautomation (t.ex. Playwright multi-page) och (b) en användartillhandahållen autentiserad
storageState eller inloggad testprofil. **Två-principal-idempotens på servern kvarstår som separat produktionsblockerare.**

## Nästa (ej påbörjat – inväntar separat beslut)
- **3C-2 (omkörning):** Playwright multi-page + användartillhandahållen storageState → kör §3/§4/§5/§6/§7-matrisen i två riktiga pages.
- **Produktionsaktivering:** kräver dessutom E2E mellan två riktiga principals + explicit beslut.
