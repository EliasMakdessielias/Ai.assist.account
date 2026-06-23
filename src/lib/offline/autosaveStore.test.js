import { describe, it, expect } from 'vitest'
import { makeId, payloadHash, isExpired, identityComplete, identityMatches, byteLength, RETENTION_MS } from './autosaveStore'

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
})
