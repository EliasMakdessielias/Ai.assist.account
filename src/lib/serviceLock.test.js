import { describe, it, expect } from 'vitest'
import { isCompanyLocked, lockAllowsPath, serviceStateMeta, isValidServiceState } from './serviceLock'

describe('isCompanyLocked (krav 5)', () => {
  it('paused/blocked = låst, active/övrigt = ej låst', () => {
    expect(isCompanyLocked({ service_state: 'paused' })).toBe(true)
    expect(isCompanyLocked({ service_state: 'blocked' })).toBe(true)
    expect(isCompanyLocked({ service_state: 'active' })).toBe(false)
    expect(isCompanyLocked({})).toBe(false)
    expect(isCompanyLocked(null)).toBe(false)
  })
})

describe('lockAllowsPath – supportflödet nåbart trots lås (krav 5)', () => {
  it('släpper igenom /support, blockerar app-vägar', () => {
    expect(lockAllowsPath('/support')).toBe(true)
    expect(lockAllowsPath('/support/123')).toBe(true)
    expect(lockAllowsPath('/bokforing')).toBe(false)
    expect(lockAllowsPath('/')).toBe(false)
    expect(lockAllowsPath(null)).toBe(false)
  })
})

describe('serviceStateMeta + isValidServiceState', () => {
  it('etiketter', () => {
    expect(serviceStateMeta('paused').label).toBe('Pausad')
    expect(serviceStateMeta('blocked').label).toBe('Blockerad')
    expect(serviceStateMeta('active').label).toBe('Aktiv')
    expect(serviceStateMeta('x').label).toBe('x')
  })
  it('giltiga tillstånd (krav 9)', () => {
    expect(isValidServiceState('active')).toBe(true)
    expect(isValidServiceState('paused')).toBe(true)
    expect(isValidServiceState('blocked')).toBe(true)
    expect(isValidServiceState('deleted')).toBe(false)
  })
})
