// Autosave-store (domänlager över IndexedDB) — Etapp 2A.
// Lagrar ENBART pilotens textutkast lokalt. Aldrig tokens/sessioner/bokföringsdata.
// Hela den sammansatta identiteten verifieras vid läsning, skrivning och rensning.
import { idbAvailable, idbGet, idbGetAll, idbDelete, idbUpdate } from './idb'

export const STORE = 'autosaveEntries'
export const SCHEMA_VERSION = 1
export const RETENTION_DAYS = 30
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000
export const MAX_PAYLOAD_BYTES = 50 * 1024     // ett kommentarsutkast ska aldrig vara större
export const MAX_ENTRIES = 200                  // tak mot obegränsad lokal ackumulering

const IDENTITY_KEYS = ['userId', 'companyId', 'fiscalYearId', 'engagementId', 'entityType', 'fieldId']

// ── Rena hjälpfunktioner (enhetstestade, ingen IndexedDB) ──
export function identityComplete(id) {
  return !!id && IDENTITY_KEYS.every(k => id[k] !== undefined && id[k] !== null && id[k] !== '')
}
export function makeId(id) {
  // Deterministisk sammansatt nyckel. Får ALDRIG hittas enbart via entityId/aktivt bolag.
  return IDENTITY_KEYS.map(k => String(id[k])).join('|')
}
export function identityMatches(entry, id) {
  return !!entry && !!id && IDENTITY_KEYS.every(k => entry[k] === id[k])
}
export function payloadHash(str) {
  // djb2 → kort stabil sträng. Endast för att undvika identiska skrivningar (ej säkerhet).
  let h = 5381
  const s = String(str ?? '')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
export function isExpired(entry, now) {
  return !!entry && typeof entry.expiresAt === 'number' && entry.expiresAt < now
}
export function byteLength(str) {
  try { return new TextEncoder().encode(String(str ?? '')).length } catch { return String(str ?? '').length }
}

// ── IndexedDB-operationer ──
export async function getDraft(identity) {
  if (!idbAvailable() || !identityComplete(identity)) return null
  let e
  try { e = await idbGet(STORE, makeId(identity)) } catch { return null }
  if (!e || !identityMatches(e, identity)) return null      // försvar på djupet
  if (isExpired(e, Date.now())) { try { await idbDelete(STORE, e.id) } catch { /* ignore */ } return null }
  return e
}

export async function saveDraft(identity, { payload, appBuildId = null, tabId = null, now = Date.now() } = {}) {
  if (!idbAvailable()) throw new Error('idb-unavailable')
  if (!identityComplete(identity)) throw new Error('identity-incomplete')
  const text = String(payload ?? '')
  if (byteLength(text) > MAX_PAYLOAD_BYTES) throw new Error('payload-too-large')
  const id = makeId(identity)
  const entry = await idbUpdate(STORE, id, (prev) => {
    const base = identityMatches(prev, identity) ? prev : null
    return {
      id, schemaVersion: SCHEMA_VERSION,
      userId: identity.userId, companyId: identity.companyId, fiscalYearId: identity.fiscalYearId,
      engagementId: identity.engagementId, entityType: identity.entityType, fieldId: identity.fieldId,
      payload: text, payloadHash: payloadHash(text),
      localRevision: (base?.localRevision || 0) + 1,
      writerTabId: tabId,
      createdAt: base?.createdAt || now, updatedAt: now, expiresAt: now + RETENTION_MS,
      appBuildId, status: 'local',
    }
  })
  return entry
}

export async function deleteDraft(identity) {
  if (!idbAvailable() || !identityComplete(identity)) return false
  try { await idbDelete(STORE, makeId(identity)); return true } catch { return false }
}

export async function purgeExpired(now = Date.now()) {
  if (!idbAvailable()) return 0
  let all
  try { all = await idbGetAll(STORE) } catch { return 0 }
  let n = 0
  for (const e of all || []) if (isExpired(e, now)) { try { await idbDelete(STORE, e.id); n++ } catch { /* ignore */ } }
  return n
}

// Rensar EXPLICIT en specifik användares pilotutkast (anropas vid explicit utloggning).
export async function purgeUserDrafts(userId) {
  if (!idbAvailable() || !userId) return 0
  let all
  try { all = await idbGetAll(STORE) } catch { return 0 }
  let n = 0
  for (const e of all || []) if (e.userId === userId) { try { await idbDelete(STORE, e.id); n++ } catch { /* ignore */ } }
  return n
}

export async function enforceCap() {
  if (!idbAvailable()) return
  let all
  try { all = await idbGetAll(STORE) } catch { return }
  if (!all || all.length <= MAX_ENTRIES) return
  const sorted = [...all].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))   // äldst först
  for (let i = 0; i < all.length - MAX_ENTRIES; i++) { try { await idbDelete(STORE, sorted[i].id) } catch { /* ignore */ } }
}

export async function storageEstimate() {
  try { if (typeof navigator !== 'undefined' && navigator.storage?.estimate) return await navigator.storage.estimate() } catch { /* ignore */ }
  return null
}

export async function countDrafts() {
  if (!idbAvailable()) return 0
  try { return (await idbGetAll(STORE) || []).length } catch { return 0 }
}
