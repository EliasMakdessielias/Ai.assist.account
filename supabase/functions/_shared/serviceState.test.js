import { describe, it, expect } from 'vitest'
import { isServiceLocked, getCompanyServiceState, assertCompanyAcceptsUnderlag, SERVICE_PAUSED_MESSAGE } from './serviceState.ts'

// Fejkad service-role-klient: companies.select(...).eq(...).maybeSingle() → {data,error}.
const fakeAdmin = (result) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
})

describe('isServiceLocked (edge/worker-guard)', () => {
  it('paused/blocked låst, active/övrigt ej', () => {
    expect(isServiceLocked('paused')).toBe(true)
    expect(isServiceLocked('blocked')).toBe(true)
    expect(isServiceLocked('active')).toBe(false)
    expect(isServiceLocked(null)).toBe(false)
  })
})

describe('getCompanyServiceState', () => {
  it('saknat company_id → active', async () => {
    expect(await getCompanyServiceState(fakeAdmin({ data: null, error: null }), null)).toBe('active')
  })
  it('läser service_state', async () => {
    expect(await getCompanyServiceState(fakeAdmin({ data: { service_state: 'paused' }, error: null }), 'c1')).toBe('paused')
  })
  it('saknad rad → active (default)', async () => {
    expect(await getCompanyServiceState(fakeAdmin({ data: null, error: null }), 'c1')).toBe('active')
  })
  it('DB-fel kastar (tekniskt fel, ej tyst active)', async () => {
    await expect(getCompanyServiceState(fakeAdmin({ data: null, error: { message: 'boom' } }), 'c1'))
      .rejects.toThrow(/service_state_read_failed/)
  })
})

describe('assertCompanyAcceptsUnderlag – bevisar att service-role-flöden respekterar låset', () => {
  it('active → ok', async () => {
    expect(await assertCompanyAcceptsUnderlag(fakeAdmin({ data: { service_state: 'active' }, error: null }), 'c1')).toEqual({ ok: true, state: 'active' })
  })
  it('paused → nekas', async () => {
    expect(await assertCompanyAcceptsUnderlag(fakeAdmin({ data: { service_state: 'paused' }, error: null }), 'c1')).toEqual({ ok: false, state: 'paused' })
  })
  it('blocked → nekas', async () => {
    expect(await assertCompanyAcceptsUnderlag(fakeAdmin({ data: { service_state: 'blocked' }, error: null }), 'c1')).toEqual({ ok: false, state: 'blocked' })
  })
  it('svensk felorsak finns', () => {
    expect(SERVICE_PAUSED_MESSAGE).toBe('Tjänsten är pausad för detta företag. Kontakta BokPilot support.')
  })
})
