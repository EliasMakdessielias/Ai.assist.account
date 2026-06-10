import { describe, it, expect } from 'vitest'
import {
  PLATFORM_ROLES, ASSIGNABLE_ROLES, CAPABILITY_MATRIX, accessFromRoles,
  isSuperadmin, isReadOnlyAdmin, canViewOperations, canManageOperations,
  canViewSupport, canViewBilling, canManageBilling, canManageRoles, canAccessAdmin,
} from './platformRoles'

describe('rollmodell', () => {
  it('har de fem plattformsrollerna (inkl. read_only_admin)', () => {
    expect(PLATFORM_ROLES).toEqual(['superadmin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only_admin'])
  })
  it('superadmin tilldelas ej via grant; övriga (inkl. read_only) är tilldelbara', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('superadmin')
    expect(ASSIGNABLE_ROLES).toEqual(['operations_admin', 'support_admin', 'billing_admin', 'read_only_admin'])
  })
})

describe('behörighetsmatris (krav 1)', () => {
  it('superadmin har allt', () => {
    expect(CAPABILITY_MATRIX.superadmin).toEqual({ viewOps: true, manageOps: true, viewSupport: true, viewBilling: true, manageBilling: true, manageRoles: true })
  })
  it('operations_admin: ops men ej support/billing/roller', () => {
    expect(CAPABILITY_MATRIX.operations_admin).toEqual({ viewOps: true, manageOps: true, viewSupport: false, viewBilling: false, manageBilling: false, manageRoles: false })
  })
  it('billing_admin: view+manage billing, ej ops', () => {
    expect(CAPABILITY_MATRIX.billing_admin.viewBilling).toBe(true)
    expect(CAPABILITY_MATRIX.billing_admin.manageBilling).toBe(true)
    expect(CAPABILITY_MATRIX.billing_admin.viewOps).toBe(false)
  })
  it('read_only_admin: ser allt men hanterar inget', () => {
    expect(CAPABILITY_MATRIX.read_only_admin).toEqual({ viewOps: true, manageOps: false, viewSupport: true, viewBilling: true, manageBilling: false, manageRoles: false })
  })
})

describe('helpers per roll-lista', () => {
  it('superadmin har all åtkomst', () => {
    const r = ['superadmin']
    expect(isSuperadmin(r)).toBe(true)
    expect(canViewOperations(r)).toBe(true)
    expect(canManageOperations(r)).toBe(true)
    expect(canViewSupport(r)).toBe(true)
    expect(canViewBilling(r)).toBe(true)
    expect(canManageBilling(r)).toBe(true)
    expect(canManageRoles(r)).toBe(true)
  })
  it('read_only_admin: alla VIEW-gates true, alla MANAGE-gates false (krav 1)', () => {
    const r = ['read_only_admin']
    expect(isReadOnlyAdmin(r)).toBe(true)
    expect(canViewOperations(r)).toBe(true)
    expect(canViewSupport(r)).toBe(true)
    expect(canViewBilling(r)).toBe(true)
    expect(canManageOperations(r)).toBe(false)
    expect(canManageBilling(r)).toBe(false)
    expect(canManageRoles(r)).toBe(false)
    expect(canAccessAdmin(r)).toBe(true)
  })
  it('support_admin nekas operations/billing', () => {
    expect(canViewOperations(['support_admin'])).toBe(false)
    expect(canViewBilling(['support_admin'])).toBe(false)
    expect(canViewSupport(['support_admin'])).toBe(true)
  })
  it('vanlig user (inga roller) nekas allt + ingen admin-åtkomst', () => {
    expect(canViewOperations([])).toBe(false)
    expect(canViewOperations(null)).toBe(false)
    expect(canManageBilling([])).toBe(false)
    expect(canAccessAdmin([])).toBe(false)
    expect(canAccessAdmin(null)).toBe(false)
  })
})

describe('accessFromRoles (speglar my_platform_access)', () => {
  it('read_only_admin', () => {
    expect(accessFromRoles(['read_only_admin'])).toEqual({
      isSuperadmin: false, isReadOnly: true, roles: ['read_only_admin'],
      canViewOperations: true, canManageOperations: false, canViewSupport: true,
      canViewBilling: true, canManageBilling: false,
    })
  })
})
