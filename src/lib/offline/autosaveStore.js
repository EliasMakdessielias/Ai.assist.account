// Autosave-store (domänlager över IndexedDB) — Etapp 2A/2B.
// Lagrar ENBART pilotens textutkast lokalt. Aldrig tokens/sessioner/bokföringsdata.
// Hela den sammansatta identiteten verifieras vid läsning, skrivning och rensning.
// 2B: lokal optimistic concurrency (revisionskontroll i samma transaktion) + injicerbara ops (för test).
import * as realIdb from './idb'

export const STORE = 'autosaveEntries'
export const SCHEMA_VERSION = 1
export const RETENTION_DAYS = 30
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000
export const MAX_PAYLOAD_BYTES = 50 * 1024     // max storlek per utkast (UTF-8 bytes)
export const MAX_ENTRIES = 200                  // max antal lokala pilotposter (tak mot ackumulering)

const IDENTITY_KEYS = ['userId', 'companyId', 'fiscalYearId', 'engagementId', 'entityType', 'fieldId']

// Injicerbar IndexedDB-adapter (default = riktig). Tester kan ersätta för deterministiska lagringsfel.
let ops = { ...realIdb }
export function __setOpsForTests(o) { ops = o ? { ...realIdb, ...o } : { ...realIdb } }

// Strukturerad lokal konflikt (annan flik har en nyare localRevision).
export class RevisionConflict extends Error {
  constructor(current) { super('revision-conflict'); this.name = 'RevisionConflict'; this.current = current }
}

// ── Rena hjälpfunktioner (enhetstestade, ingen IndexedDB) ──
export function identityComplete(id) {
  return !!id && IDENTITY_KEYS.every(k => id[k] !== undefined && id[k] !== null && id[k] !== '')
}
export function makeId(id) {
  return IDENTITY_KEYS.map(k => String(id[k])).join('|')
}
export function identityMatches(entry, id) {
  return !!entry && !!id && IDENTITY_KEYS.every(k => entry[k] === id[k])
}
export function payloadHash(str) {
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
// Etapp 2C: skilj läsfel från "inget utkast". status: draft_loaded | draft_not_found | storage_read_error.
export async function getDraftResult(identity) {
  if (!identityComplete(identity)) return { status: 'draft_not_found', entry: null }
  if (!ops.idbAvailable()) return { status: 'storage_read_error', entry: null }   // kan inte läsa ≠ saknas
  let e
  try { e = await ops.idbGet(STORE, makeId(identity)) } catch { return { status: 'storage_read_error', entry: null } }
  if (!e || !identityMatches(e, identity)) return { status: 'draft_not_found', entry: null }
  if (isExpired(e, Date.now())) { try { await ops.idbDelete(STORE, e.id) } catch { /* ignore */ } return { status: 'draft_not_found', entry: null } }
  return { status: 'draft_loaded', entry: e }
}
export async function getDraft(identity) {
  const r = await getDraftResult(identity)
  return r.status === 'draft_loaded' ? r.entry : null
}

// Fork-utkast (separata konfliktkopior) för en fullständig identity.
export function forkPrefix(identity) { return `${identity.fieldId}::fork-` }
export async function listForkDrafts(identity) {
  if (!identityComplete(identity) || !ops.idbAvailable()) return []
  try {
    const all = await ops.idbGetAll(STORE) || []
    const pfx = forkPrefix(identity)
    return all
      .filter(e => e.userId === identity.userId && e.companyId === identity.companyId && e.fiscalYearId === identity.fiscalYearId &&
        e.engagementId === identity.engagementId && e.entityType === identity.entityType &&
        typeof e.fieldId === 'string' && e.fieldId.startsWith(pfx))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } catch { return [] }
}
export async function deleteDraftById(id) {
  if (!ops.idbAvailable() || !id) return false
  try { await ops.idbDelete(STORE, id); return true } catch { return false }
}

// Skriver lokalt. expectedRevision !== null → atomisk revisionskontroll (förhindrar tyst multi-tab-överskrivning).
export async function saveDraft(identity, { payload, appBuildId = null, tabId = null, expectedRevision = null, now = Date.now() } = {}) {
  if (!identityComplete(identity)) throw new Error('identity-incomplete')
  const text = String(payload ?? '')
  if (byteLength(text) > MAX_PAYLOAD_BYTES) throw new Error('payload-too-large')
  if (!ops.idbAvailable()) throw new Error('idb-unavailable')
  const id = makeId(identity)
  const entry = await ops.idbUpdate(STORE, id, (prev) => {
    const base = identityMatches(prev, identity) ? prev : null
    if (expectedRevision != null && base && (base.localRevision || 0) !== expectedRevision) {
      throw new RevisionConflict(base)        // avbryter transaktionen → ingen överskrivning
    }
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
  if (!identityComplete(identity) || !ops.idbAvailable()) return false
  try { await ops.idbDelete(STORE, makeId(identity)); return true } catch { return false }
}

export async function listUserDrafts(userId) {
  if (!userId || !ops.idbAvailable()) return []
  try { return (await ops.idbGetAll(STORE) || []).filter(e => e.userId === userId) } catch { return [] }
}

export async function purgeExpired(now = Date.now()) {
  if (!ops.idbAvailable()) return 0
  let all
  try { all = await ops.idbGetAll(STORE) } catch { return 0 }
  let n = 0
  for (const e of all || []) if (isExpired(e, now)) { try { await ops.idbDelete(STORE, e.id); n++ } catch { /* ignore */ } }
  return n
}

export async function purgeUserDrafts(userId) {
  if (!userId || !ops.idbAvailable()) return 0
  let all
  try { all = await ops.idbGetAll(STORE) } catch { return 0 }
  let n = 0
  for (const e of all || []) if (e.userId === userId) { try { await ops.idbDelete(STORE, e.id); n++ } catch { /* ignore */ } }
  return n
}

export async function enforceCap() {
  if (!ops.idbAvailable()) return
  let all
  try { all = await ops.idbGetAll(STORE) } catch { return }
  if (!all || all.length <= MAX_ENTRIES) return
  const sorted = [...all].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))   // äldst först
  for (let i = 0; i < all.length - MAX_ENTRIES; i++) { try { await ops.idbDelete(STORE, sorted[i].id) } catch { /* ignore */ } }
}

export async function storageEstimate() {
  try { if (typeof navigator !== 'undefined' && navigator.storage?.estimate) return await navigator.storage.estimate() } catch { /* ignore */ }
  return null
}

export async function countDrafts() {
  if (!ops.idbAvailable()) return 0
  try { return (await ops.idbGetAll(STORE) || []).length } catch { return 0 }
}
