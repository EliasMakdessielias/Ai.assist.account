import { describe, it, expect } from 'vitest'
import {
  isCompanyLocked, lockAllowsPath, serviceStateMeta, isValidServiceState,
  canCompanyWrite, friendlyWriteError, LOCKED_WRITE_TABLES, WRITE_LOCK_EXEMPT_TABLES, SERVICE_PAUSED_MESSAGE,
} from './serviceLock'

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

describe('canCompanyWrite – speglar can_company_write() (Fas 2-härdning)', () => {
  it('active skriver, paused/blocked nekas', () => {
    expect(canCompanyWrite({ service_state: 'active' })).toBe(true)
    expect(canCompanyWrite({ service_state: 'paused' })).toBe(false)
    expect(canCompanyWrite({ service_state: 'blocked' })).toBe(false)
  })
  it('plattformsadmin (operations) får skriva även när låst', () => {
    expect(canCompanyWrite({ service_state: 'paused' }, { canManageOperations: true })).toBe(true)
    expect(canCompanyWrite({ service_state: 'blocked' }, { isSuperadmin: true })).toBe(true)
    expect(canCompanyWrite({ service_state: 'blocked' }, { isReadOnly: true })).toBe(false)  // read_only ej
  })
})

describe('friendlyWriteError – ren svensk text (krav 7)', () => {
  it('mappar lås-fel (errcode 42501 / triggermeddelande)', () => {
    expect(friendlyWriteError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(SERVICE_PAUSED_MESSAGE)
    expect(friendlyWriteError({ message: 'Tjänsten är pausad för detta företag. Kontakta BokPilot support.' })).toBe(SERVICE_PAUSED_MESSAGE)
  })
  it('lämnar andra fel orörda', () => {
    expect(friendlyWriteError({ message: 'Network error' })).toBe('Network error')
    expect(friendlyWriteError(null)).toBe('Något gick fel.')
  })
})

describe('write-lock tabell-policy (regressionsskydd för undantagen, krav 2)', () => {
  it('skyddar kärnaffärstabeller', () => {
    for (const t of ['documents', 'verifikationer', 'invoices', 'supplier_invoices', 'customers', 'suppliers', 'products', 'bank_transactions', 'accounts'])
      expect(LOCKED_WRITE_TABLES).toContain(t)
  })
  it('låser ALDRIG support/notiser/audit/billing/team', () => {
    for (const t of WRITE_LOCK_EXEMPT_TABLES) expect(LOCKED_WRITE_TABLES).not.toContain(t)
    expect(WRITE_LOCK_EXEMPT_TABLES).toContain('support_tickets')
    expect(WRITE_LOCK_EXEMPT_TABLES).toContain('notification_queue')
  })
})
