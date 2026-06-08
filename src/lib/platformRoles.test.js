import { describe, it, expect } from 'vitest'
import {
  PLATFORM_ROLES, ASSIGNABLE_ROLES, CAPABILITY_MATRIX, accessFromRoles,
  isSuperadmin, canViewOperations, canManageOperations, canViewSupport, canManageBilling, canManageRoles,
} from './platformRoles'

describe('rollmodell', () => {
  it('har de fyra plattformsrollerna', () => {
    expect(PLATFORM_ROLES).toEqual(['superadmin', 'operations_admin', 'support_admin', 'billing_admin'])
  })
  it('superadmin tilldelas ej via grant (hanteras via platform_admins)', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('superadmin')
    expect(ASSIGNABLE_ROLES).toEqual(['operations_admin', 'support_admin', 'billing_admin'])
  })
})

describe('behörighetsmatris (krav 14)', () => {
  it('superadmin har allt', () => {
    expect(CAPABILITY_MATRIX.superadmin).toEqual({ viewOps: true, manageOps: true, viewSupport: true, manageBilling: true, manageRoles: true })
  })
  it('operations_admin: ops men ej support/billing/roller', () => {
    expect(CAPABILITY_MATRIX.operations_admin).toEqual({ viewOps: true, manageOps: true, viewSupport: false, manageBilling: false, manageRoles: false })
  })
  it('support_admin: bara support', () => {
    expect(CAPABILITY_MATRIX.support_admin.viewOps).toBe(false)
    expect(CAPABILITY_MATRIX.support_admin.manageOps).toBe(false)
    expect(CAPABILITY_MATRIX.support_admin.viewSupport).toBe(true)
  })
  it('billing_admin: bara billing, ej ops', () => {
    expect(CAPABILITY_MATRIX.billing_admin.manageBilling).toBe(true)
    expect(CAPABILITY_MATRIX.billing_admin.viewOps).toBe(false)
  })
})

describe('helpers per roll-lista', () => {
  it('superadmin har all åtkomst', () => {
    const r = ['superadmin']
    expect(isSuperadmin(r)).toBe(true)
    expect(canViewOperations(r)).toBe(true)
    expect(canManageOperations(r)).toBe(true)
    expect(canViewSupport(r)).toBe(true)
    expect(canManageBilling(r)).toBe(true)
    expect(canManageRoles(r)).toBe(true)
  })
  it('operations_admin kan se+hantera ops, inte roller/billing', () => {
    const r = ['operations_admin']
    expect(canViewOperations(r)).toBe(true)
    expect(canManageOperations(r)).toBe(true)
    expect(canManageBilling(r)).toBe(false)
    expect(canManageRoles(r)).toBe(false)
    expect(isSuperadmin(r)).toBe(false)
  })
  it('support_admin nekas operations', () => {
    expect(canViewOperations(['support_admin'])).toBe(false)
    expect(canManageOperations(['support_admin'])).toBe(false)
    expect(canViewSupport(['support_admin'])).toBe(true)
  })
  it('billing_admin nekas operations', () => {
    expect(canViewOperations(['billing_admin'])).toBe(false)
    expect(canManageBilling(['billing_admin'])).toBe(true)
  })
  it('vanlig user (inga roller) nekas allt', () => {
    expect(canViewOperations([])).toBe(false)
    expect(canViewOperations(null)).toBe(false)
    expect(canManageOperations([])).toBe(false)
    expect(canManageBilling([])).toBe(false)
  })
})

describe('accessFromRoles (speglar my_platform_access)', () => {
  it('operations_admin', () => {
    expect(accessFromRoles(['operations_admin'])).toEqual({
      isSuperadmin: false, roles: ['operations_admin'],
      canViewOperations: true, canManageOperations: true, canViewSupport: false, canManageBilling: false,
    })
  })
})
