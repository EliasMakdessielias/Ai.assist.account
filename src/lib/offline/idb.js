// Minimal handrullad IndexedDB-wrapper — Etapp 2A (autosave-pilot).
// Inget nytt paket (Dexie utvärderat men ej nödvändigt för 2 stores). Endast lokala utkast lagras här –
// ALDRIG tokens, sessioner eller bokföringsdata. Service Worker rör aldrig IndexedDB.
const DB_NAME = 'bokpilot-offline'
const DB_VERSION = 1
const STORES = { autosaveEntries: { keyPath: 'id' }, localMetadata: { keyPath: 'key' } }

let dbPromise = null

export function idbAvailable() {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB } catch { return false }
}

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch (e) { return reject(e) }
    req.onupgradeneeded = () => {
      const db = req.result
      for (const [name, opt] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opt)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blockerad'))
  })
  return dbPromise
}

export async function idbGet(store, key) {
  const db = await openDB()
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readonly')
    const r = t.objectStore(store).get(key)
    r.onsuccess = () => res(r.result ?? null)
    r.onerror = () => rej(r.error)
  })
}

export async function idbGetAll(store) {
  const db = await openDB()
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readonly')
    const r = t.objectStore(store).getAll()
    r.onsuccess = () => res(r.result || [])
    r.onerror = () => rej(r.error)
  })
}

export async function idbPut(store, value) {
  const db = await openDB()
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite')
    t.objectStore(store).put(value)
    t.oncomplete = () => res(value)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error || new Error('tx avbruten'))
  })
}

export async function idbDelete(store, key) {
  const db = await openDB()
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite')
    t.objectStore(store).delete(key)
    t.oncomplete = () => res(true)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error || new Error('tx avbruten'))
  })
}

// Atomisk läs-modifiera-skriv i EN transaktion (för säker localRevision-uppräkning mellan flikar).
export async function idbUpdate(store, key, updater) {
  const db = await openDB()
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite')
    const os = t.objectStore(store)
    const g = os.get(key)
    let next
    g.onsuccess = () => {
      try { next = updater(g.result ?? null) } catch (e) { try { t.abort() } catch { /* ignore */ } return rej(e) }
      if (next === undefined || next === null) return
      os.put(next)
    }
    g.onerror = () => rej(g.error)
    t.oncomplete = () => res(next ?? null)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error || new Error('tx avbruten'))
  })
}
