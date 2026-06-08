// Plattformsroller – modell, etiketter och behörighetsmatris (klient-spegel av DB-helpers).
// superadmin = högsta roll (har alla rättigheter). Server (RPC/RLS) är auktoritativ; detta är för UI + test.

export const PLATFORM_ROLES = ['superadmin', 'operations_admin', 'support_admin', 'billing_admin']
// superadmin hanteras via platform_admins-tabellen, inte via grant-RPC.
export const ASSIGNABLE_ROLES = ['operations_admin', 'support_admin', 'billing_admin']

export const ROLE_LABELS = {
  superadmin: 'Superadmin',
  operations_admin: 'Operations admin',
  support_admin: 'Support admin',
  billing_admin: 'Billing admin',
}
export const ROLE_DESC = {
  superadmin: 'Full åtkomst till allt på plattformen.',
  operations_admin: 'Systemövervakning & drift: worker health, system errors, notification queue, retry/cancel/acknowledge, provider logs.',
  support_admin: 'Support-ärenden & begränsad kundöversikt. Ej billing eller systemdrift.',
  billing_admin: 'Abonnemang, plan/status & faktureringsinfo. Ej driftloggar eller secrets.',
}

const has = (roles, role) => Array.isArray(roles) && roles.includes(role)
export const isSuperadmin = roles => has(roles, 'superadmin')
export const canViewOperations = roles => isSuperadmin(roles) || has(roles, 'operations_admin')
export const canManageOperations = roles => isSuperadmin(roles) || has(roles, 'operations_admin')
export const canViewSupport = roles => isSuperadmin(roles) || has(roles, 'support_admin')
export const canManageBilling = roles => isSuperadmin(roles) || has(roles, 'billing_admin')
export const canManageRoles = roles => isSuperadmin(roles)

// Exakt behörighetsmatris (även för dokumentation/test).
export const CAPABILITY_MATRIX = {
  superadmin: { viewOps: true, manageOps: true, viewSupport: true, manageBilling: true, manageRoles: true },
  operations_admin: { viewOps: true, manageOps: true, viewSupport: false, manageBilling: false, manageRoles: false },
  support_admin: { viewOps: false, manageOps: false, viewSupport: true, manageBilling: false, manageRoles: false },
  billing_admin: { viewOps: false, manageOps: false, viewSupport: false, manageBilling: true, manageRoles: false },
}

// Härled åtkomst-objekt från en roll-lista (matchar my_platform_access i DB).
export function accessFromRoles(roles) {
  return {
    isSuperadmin: isSuperadmin(roles),
    roles: roles || [],
    canViewOperations: canViewOperations(roles),
    canManageOperations: canManageOperations(roles),
    canViewSupport: canViewSupport(roles),
    canManageBilling: canManageBilling(roles),
  }
}
