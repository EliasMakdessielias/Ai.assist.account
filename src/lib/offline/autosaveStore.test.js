import { describe, it, expect, afterEach } from 'vitest'
import {
  makeId, payloadHash, isExpired, identityComplete, identityMatches, byteLength, RETENTION_MS,
  saveDraft, getDraft, getDraftResult, listForkDrafts, RevisionConflict, MAX_PAYLOAD_BYTES, makeId, __setOpsForTests,
} from './autosaveStore'

const full = {
  userId: 'u1', companyId: 'c1', fiscalYearId: 'fy1', engagementId: 'e1',
  entityType: 'bokslut_check_comment', fieldId: 'chk1',
}

describe('autosaveStore – rena hjälpfunktioner (Etapp 2A)', () => {
  it('identityComplete kräver alla sex delar', () => {
    expect(identityComplete(full)).toBe(true)
    for (const k of Object.keys(full)) {
      expect(identityComplete({ ...full, [k]: '' })).toBe(false)
      expect(identityComplete({ ...full, [k]: null })).toBe(false)
    }
  })

  it('makeId är deterministisk och innehåller HELA identiteten (ej bara fieldId)', () => {
    expect(makeId(full)).toBe(makeId({ ...full }))
    expect(makeId(full)).toBe('u1|c1|fy1|e1|bokslut_check_comment|chk1')
    // Olika bolag/år/användare → olika nyckel (isolering)
    expect(makeId({ ...full, companyId: 'c2' })).not.toBe(makeId(full))
    expect(makeId({ ...full, fiscalYearId: 'fy2' })).not.toBe(makeId(full))
    expect(makeId({ ...full, userId: 'u2' })).not.toBe(makeId(full))
  })

  it('identityMatches kräver exakt matchning på alla delar', () => {
    expect(identityMatches({ ...full, id: makeId(full) }, full)).toBe(true)
    expect(identityMatches({ ...full, companyId: 'c2' }, full)).toBe(false)
    expect(identityMatches(null, full)).toBe(false)
  })

  it('payloadHash är stabil och skiljer olika innehåll', () => {
    expect(payloadHash('abc')).toBe(payloadHash('abc'))
    expect(payloadHash('abc')).not.toBe(payloadHash('abd'))
    expect(payloadHash('')).toBe(payloadHash(''))
  })

  it('isExpired jämför mot expiresAt', () => {
    const now = 1_000_000
    expect(isExpired({ expiresAt: now - 1 }, now)).toBe(true)
    expect(isExpired({ expiresAt: now + 1 }, now)).toBe(false)
    expect(isExpired({}, now)).toBe(false)
  })

  it('byteLength mäter UTF-8-storlek (å ä ö > 1 byte)', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('ä')).toBeGreaterThan(1)
  })

  it('RETENTION_MS är 30 dagar', () => {
    expect(RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('byteLength: emoji/Unicode mäts i UTF-8 bytes (≠ tecken)', () => {
    expect(byteLength('😀')).toBe(4)              // 4 bytes, 1 "tecken-par"
    expect(byteLength('åäö')).toBe(6)             // 2 bytes vardera
  })
})

// In-memory IndexedDB-adapter för deterministiska skriv-/konflikt-/felscenarier (ingen riktig IDB i jsdom).
function memOps(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    idbAvailable: () => true,
    idbGet: async (s, k) => map.get(k) ?? null,
    idbGetAll: async () => [...map.values()],
    idbDelete: async (s, k) => { map.delete(k); return true },
    idbUpdate: async (s, k, updater) => { const prev = map.get(k) ?? null; const next = updater(prev); if (next == null) return null; map.set(k, next); return next },
    _map: map,
  }
}

describe('autosaveStore – lokal optimistic concurrency (Etapp 2B)', () => {
  afterEach(() => __setOpsForTests(null))
  const ident = { userId: 'u1', companyId: 'c1', fiscalYearId: 'fy1', engagementId: 'e1', entityType: 'bokslut_check_comment', fieldId: 'chk1' }

  it('första skrivning ger revision 1; nästa (expected 1) ger revision 2', async () => {
    __setOpsForTests(memOps())
    const e1 = await saveDraft(ident, { payload: 'a', expectedRevision: 0 })
    expect(e1.localRevision).toBe(1)
    const e2 = await saveDraft(ident, { payload: 'ab', expectedRevision: 1 })
    expect(e2.localRevision).toBe(2)
  })

  it('inaktuell expectedRevision → RevisionConflict, INGEN överskrivning', async () => {
    const ops = memOps()
    __setOpsForTests(ops)
    await saveDraft(ident, { payload: 'från flik B', expectedRevision: 0 })   // rev 1 (annan flik)
    // Denna flik tror fortfarande att basen är 0 → konflikt, posten rörs ej
    await expect(saveDraft(ident, { payload: 'från flik A', expectedRevision: 0 })).rejects.toBeInstanceOf(RevisionConflict)
    const stored = await getDraft(ident)
    expect(stored.payload).toBe('från flik B')   // inte överskriven
    expect(stored.localRevision).toBe(1)
  })

  it('payload över MAX_PAYLOAD_BYTES avvisas (bytes, ej tecken)', async () => {
    __setOpsForTests(memOps())
    await expect(saveDraft(ident, { payload: 'a'.repeat(MAX_PAYLOAD_BYTES + 1), expectedRevision: 0 })).rejects.toThrow('payload-too-large')
  })

  it('injicerat lagringsfel (QuotaExceeded) propageras (hooken visar fel, raderar inte text)', async () => {
    const failing = { ...memOps(), idbUpdate: async () => { const e = new Error('Quota'); e.name = 'QuotaExceededError'; throw e } }
    __setOpsForTests(failing)
    await expect(saveDraft(ident, { payload: 'x', expectedRevision: 0 })).rejects.toThrow('Quota')
  })

  it('getDraft svälier läsfel och returnerar null (kraschar inte formuläret)', async () => {
    __setOpsForTests({ ...memOps(), idbGet: async () => { throw new Error('open error') } })
    expect(await getDraft(ident)).toBeNull()
  })
})

describe('autosaveStore – getDraftResult skiljer läsfel från saknad post (Etapp 2C)', () => {
  afterEach(() => __setOpsForTests(null))
  const ident = { userId: 'u1', companyId: 'c1', fiscalYearId: 'fy1', engagementId: 'e1', entityType: 'bokslut_check_comment', fieldId: 'chk1' }

  it('post finns → draft_loaded', async () => {
    __setOpsForTests(memOps())
    await saveDraft(ident, { payload: 'hej', expectedRevision: 0 })
    const r = await getDraftResult(ident)
    expect(r.status).toBe('draft_loaded'); expect(r.entry.payload).toBe('hej')
  })

  it('ingen post → draft_not_found', async () => {
    __setOpsForTests(memOps())
    expect((await getDraftResult(ident)).status).toBe('draft_not_found')
  })

  it('läsfel (idbGet kastar) → storage_read_error (INTE not_found)', async () => {
    __setOpsForTests({ ...memOps(), idbGet: async () => { throw new Error('open error') } })
    expect((await getDraftResult(ident)).status).toBe('storage_read_error')
  })

  it('IndexedDB otillgänglig → storage_read_error', async () => {
    __setOpsForTests({ ...memOps(), idbAvailable: () => false })
    expect((await getDraftResult(ident)).status).toBe('storage_read_error')
  })

  it('listForkDrafts hittar fork-kopior för samma fullständiga identity', async () => {
    __setOpsForTests(memOps())
    await saveDraft(ident, { payload: 'huvud', expectedRevision: 0 })
    await saveDraft({ ...ident, fieldId: `${ident.fieldId}::fork-tabX-1` }, { payload: 'kopia 1', expectedRevision: 0 })
    await saveDraft({ ...ident, fieldId: `${ident.fieldId}::fork-tabX-2` }, { payload: 'kopia 2', expectedRevision: 0 })
    const forks = await listForkDrafts(ident)
    expect(forks).toHaveLength(2)
    expect(forks.map(f => f.payload).sort()).toEqual(['kopia 1', 'kopia 2'])
    // huvudposten är inte en fork
    expect(forks.some(f => f.id === makeId(ident))).toBe(false)
  })
})
