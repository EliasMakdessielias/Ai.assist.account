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

## Nästa (ej påbörjat – inväntar separat beslut)
- **Etapp 2:** lokal autosave-pilot (IndexedDB/Dexie) för EN godkänd utkasttyp, ingen synk.
  Rekommenderad pilot: kundfakturautkast (eller AI-Bokslut-anteckning som lägsta risk). Se Etapp 0-rapport.
