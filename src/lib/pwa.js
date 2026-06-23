// BokPilot PWA-registrering, kontrollerad uppdatering och kill switch — Etapp 1A.
// - Registrerar Service Worker ENDAST i produktionsbygge (aldrig i dev).
// - Aktiverar ALDRIG ny version automatiskt mitt i arbetet; klienten väljer via applyUpdate().
// - Kill switch: avregistrera SW + rensa endast BokPilots egna cacheversioner. Rör inte session/data.

const SW_URL = '/sw.js'
const DISABLE_KEY = 'bokpilot.pwa.disabled'

let waitingWorker = null
let reloadingForUpdate = false
const listeners = new Set()

function emitUpdate() { for (const cb of listeners) { try { cb(!!waitingWorker) } catch { /* ignore */ } } }

/** Prenumerera på "ny version väntar". Returnerar avregistreringsfunktion. */
export function onPwaUpdate(cb) { listeners.add(cb); cb(!!waitingWorker); return () => listeners.delete(cb) }

/** Aktivera den väntande versionen (efter användarens val). Sidan laddas om vid controllerchange. */
export function applyUpdate() {
  if (waitingWorker) waitingWorker.postMessage('SKIP_WAITING')
}

/** Avregistrera BokPilots SW och radera endast BokPilots cacheversioner. Permanent kräver disablePwaPersistently(). */
export async function killSwitch() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
  } catch { /* ignore */ }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter(k => k.startsWith('bokpilot-')).map(k => caches.delete(k)))
    }
  } catch { /* ignore */ }
}

export function disablePwaPersistently() { try { localStorage.setItem(DISABLE_KEY, '1') } catch { /* ignore */ } }
export function isPwaDisabled() { try { return localStorage.getItem(DISABLE_KEY) === '1' } catch { return false } }

/** Diagnostik: hämta aktiv Service Workers buildId (injicerat vid build). null om ingen aktiv SW. */
export function getBuildId(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sw = (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) || null
    if (!sw) return resolve(null)
    const ch = new MessageChannel()
    const t = setTimeout(() => resolve(null), timeoutMs)
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && e.data.buildId || null) }
    try { sw.postMessage({ type: 'GET_BUILD_ID' }, [ch.port2]) } catch { clearTimeout(t); resolve(null) }
  })
}

export async function registerPWA() {
  if (typeof window === 'undefined') return
  // Emergency kill switch nåbar från konsolen även om UI är trasigt.
  window.__bokpilotKillSwitch = async () => { disablePwaPersistently(); await killSwitch(); window.location.reload() }

  if (!import.meta.env.PROD) return                 // aldrig i dev (Vite HMR + SW = strul)
  if (!('serviceWorker' in navigator)) return
  if (isPwaDisabled()) { await killSwitch(); return } // respektera kill switch

  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' })

    if (reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; emitUpdate() }

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        // En ny version är installerad och en gammal styr fortfarande sidan → "uppdatering väntar".
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting || installing
          emitUpdate()
        }
      })
    })

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForUpdate) return
      reloadingForUpdate = true
      window.location.reload()
    })

    // Leta efter ny version vid fokus + var timme (network-first navigation täcker resten).
    const checkUpdate = () => { reg.update().catch(() => {}) }
    window.addEventListener('focus', checkUpdate)
    setInterval(checkUpdate, 60 * 60 * 1000)

    // Diagnostik: exponera aktiv buildId (syns i konsolen / window.__bokpilotBuildId).
    navigator.serviceWorker.ready.then(() => getBuildId()).then(id => {
      if (id) { window.__bokpilotBuildId = id; /* eslint-disable-next-line no-console */ console.info('[BokPilot] PWA buildId', id) }
    }).catch(() => {})
  } catch { /* registrering misslyckades → appen funkar ändå (network-only) */ }
}
