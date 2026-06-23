/*
 * BokPilot Service Worker — Etapp 1A (säker PWA-grund).
 *
 * SCOPE & SÄKERHET:
 * - Endast SAMMA ORIGIN hanteras. Allt cross-origin (Supabase API/Storage/Edge Functions,
 *   Tabler-ikoner via CDN, health-anrop) lämnas HELT orört → webbläsarens vanliga nätverk (network-only).
 * - Cachelagrar ENBART app-skal (index.html), content-hashade statiska assets, lokal logo,
 *   manifest och offline-fallback. ALDRIG API-svar, autentiserade svar eller bokföringsdata.
 * - Endast GET. Mutationer (POST/PUT/PATCH/DELETE) rörs aldrig.
 * - Ingen automatisk skipWaiting: ny version aktiveras först på klientens begäran (SKIP_WAITING).
 *
 * Kill switch: ladda /kill-sw.html ELLER ersätt denna fil med en self-unregistering stub vid deploy.
 */
const VERSION = 'v1';
const SHELL_CACHE = `bokpilot-shell-${VERSION}`;
const ASSET_CACHE = `bokpilot-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const SHELL_KEY = '/index.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/logo.svg'];
const STATIC_HTML = new Set(['/offline.html', '/kill-sw.html']);
const ASSET_RE = /\.(?:js|css|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|webp|gif|ico)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE);
    // Avsiktligt INGEN self.skipWaiting() — vänta tills klienten aktivt uppdaterar.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Rensa endast BokPilots egna gamla cacheversioner.
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('bokpilot-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                      // aldrig mutationer

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;       // cross-origin (Supabase/CDN) = orört, network-only

  // 1) Navigeringar (SPA-rutter): network-first → senast verifierat app-skal → offline-fallback.
  if (req.mode === 'navigate') {
    if (STATIC_HTML.has(url.pathname)) {
      event.respondWith(fetch(req).catch(() => caches.match(url.pathname)));
      return;
    }
    event.respondWith((async () => {
      try {
        const net = await fetch(req);                    // alltid försök hämta aktuell version först
        if (net && net.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(SHELL_KEY, net.clone());             // behåll senast fungerande skal
        }
        return net;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(SHELL_KEY)) || (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  // 2) Content-hashade statiska assets (immutabla) → cache-first.
  if (url.pathname.startsWith('/assets/') || ASSET_RE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        if (net && net.ok && net.type === 'basic') cache.put(req, net.clone());
        return net;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  // 3) Övrigt same-origin GET: network-only (cachas aldrig).
});
