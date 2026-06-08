import { describe, it, expect } from 'vitest'
import { limitStatus, LIMIT_METRICS, hasWarnings, worstStatus, isBlockingStatus } from './planLimits'

describe('limitStatus (krav 4/5)', () => {
  it('ok < 80%', () => {
    expect(limitStatus(5, 10)).toEqual({ status: 'ok', limit: 10, used: 5, remaining: 5, percentUsed: 50 })
    expect(limitStatus(79, 100).status).toBe('ok')
  })
  it('warning 80–99%', () => {
    expect(limitStatus(8, 10).status).toBe('warning')
    expect(limitStatus(99, 100).status).toBe('warning')
  })
  it('exceeded >= 100%', () => {
    expect(limitStatus(10, 10).status).toBe('exceeded')
    expect(limitStatus(15, 10)).toMatchObject({ status: 'exceeded', remaining: 0, percentUsed: 150 })
  })
  it('unlimited när limit null eller negativ', () => {
    expect(limitStatus(50, null)).toMatchObject({ status: 'unlimited', limit: null, remaining: null, percentUsed: null })
    expect(limitStatus(50, -1).status).toBe('unlimited')
  })
  it('limit 0 -> exceeded (100%)', () => {
    expect(limitStatus(0, 0)).toMatchObject({ status: 'exceeded', percentUsed: 100 })
  })
})

describe('aggregat', () => {
  const limits = [{ status: 'ok' }, { status: 'warning' }, { status: 'exceeded' }]
  it('hasWarnings true om warning/exceeded finns', () => {
    expect(hasWarnings(limits)).toBe(true)
    expect(hasWarnings([{ status: 'ok' }, { status: 'unlimited' }])).toBe(false)
  })
  it('worstStatus prioriterar exceeded > warning > ok', () => {
    expect(worstStatus(limits)).toBe('exceeded')
    expect(worstStatus([{ status: 'ok' }, { status: 'warning' }])).toBe('warning')
    expect(worstStatus([{ status: 'ok' }])).toBe('ok')
  })
  it('soft: bara exceeded är "blockerande" markör (men flöden blockeras ej hårt)', () => {
    expect(isBlockingStatus('exceeded')).toBe(true)
    expect(isBlockingStatus('warning')).toBe(false)
  })
})

describe('metrics (krav 2)', () => {
  it('täcker de sex limit-typerna', () => {
    expect(LIMIT_METRICS.map(m => m.key)).toEqual(['users', 'companies', 'invoices', 'documents', 'storage', 'ai'])
  })
})
