/*
 * BokPilot Service Worker — Etapp 1B (produktionshärdad PWA-grund).
 *
 * SCOPE & SÄKERHET:
 * - Endast SAMMA ORIGIN hanteras. Allt cross-origin (Supabase API/Auth/Storage/Edge/Realtime,
 *   Tabler-ikon-CDN, health-anrop) lämnas HELT orört → webbläsarens vanliga nätverk (network-only).
 * - Cachelagrar ENBART app-skal (index.html) + content-hashade lokala statiska assets + logo +
 *   manifest + offline-fallback. ALDRIG API-svar, autentiserade svar, redirects, opaque eller felsvar.
 * - Endast GET. Mutationer rörs aldrig. Cachefel blockerar aldrig vanlig nätverksanvändning.
 * - Ingen automatisk skipWaiting: ny version aktiveras först på klientens begäran (SKIP_WAITING).
 *
 * VERSIONERING: BUILD_ID injiceras automatiskt vid produktionsbuild (se vite.config.js).
 * Kill switch: /kill-sw.html ELLER ersätt denna fil med en self-unregistering stub vid deploy.
 */
const BUILD_ID = '__BUILD_ID__';                 // ersätts vid build; 'dev'-värde i okompilerat läge
const SHELL_CACHE = `bokpilot-shell-${BUILD_ID}`;
const ASSET_CACHE = `bokpilot-assets-${BUILD_ID}`;
const CURRENT = new Set([SHELL_CACHE, ASSET_CACHE]);
const OFFLINE_URL = '/offline.html';
const SHELL_KEY = '/index.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/logo.svg'];
const STATIC_HTML = new Set(['/offline.html', '/kill-sw.html']);
const ASSET_RE = /\.(?:js|mjs|css|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|webp|gif|ico)$/i;
const ASSET_CACHE_CAP = 80;                       // tak mot obegränsad ackumulering

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE);
    // Avsiktligt INGEN self.skipWaiting().
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Rensa endast BokPilots egna gamla cacheversioner (aldrig andra system).
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('bokpilot-') && !CURRENT.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) { self.skipWaiting(); return; }
  if (data && data.type === 'GET_BUILD_ID') {
    const reply = { type: 'BUILD_ID', buildId: BUILD_ID };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  }
});

// Endast lyckade, icke-omdirigerade, same-origin "basic"-svar med 200 får cachas.
function isCacheable(res) {
  return !!res && res.ok && res.status === 200 && res.type === 'basic' && res.redirected === false;
}

async function trimCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= ASSET_CACHE_CAP) return;
    for (let i = 0; i < keys.length - ASSET_CACHE_CAP; i++) await cache.delete(keys[i]); // äldst först
  } catch { /* ignore */ }
}

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
        const net = await fetch(req);
        if (isCacheable(net)) {
          try { (await caches.open(SHELL_CACHE)).put(SHELL_KEY, net.clone()); } catch { /* ignore */ }
        }
        return net;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(SHELL_KEY)) || (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  // 2) Content-hashade lokala statiska assets → cache-first (immutabla).
  if (url.pathname.startsWith('/assets/') || ASSET_RE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        if (isCacheable(net)) { try { await cache.put(req, net.clone()); trimCache(cache); } catch { /* ignore */ } }
        return net;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  // 3) Övrigt same-origin GET: network-only (cachas aldrig).
});
