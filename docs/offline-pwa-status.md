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

## Nästa (ej påbörjat – inväntar separat beslut)
- **Etapp 2:** lokal autosave-pilot (IndexedDB/Dexie) för EN godkänd utkasttyp, ingen synk.
  Rekommenderad pilot: kundfakturautkast (eller AI-Bokslut-anteckning som lägsta risk). Se Etapp 0-rapport.
