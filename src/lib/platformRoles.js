// Plattformsroller – modell, etiketter och behörighetsmatris (klient-spegel av DB-helpers).
// superadmin = högsta roll (har alla rättigheter). Server (RPC/RLS) är auktoritativ; detta är för UI + test.
// read_only_admin = ser allt (operations/support/billing) men kan ALDRIG mutera.

export const PLATFORM_ROLES = ['superadmin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only_admin']
// superadmin hanteras via platform_admins-tabellen, inte via grant-RPC.
export const ASSIGNABLE_ROLES = ['operations_admin', 'support_admin', 'billing_admin', 'read_only_admin']

export const ROLE_LABELS = {
  superadmin: 'Superadmin',
  operations_admin: 'Operations admin',
  support_admin: 'Support admin',
  billing_admin: 'Billing admin',
  read_only_admin: 'Read-only admin',
}
export const ROLE_DESC = {
  superadmin: 'Full åtkomst till allt på plattformen.',
  operations_admin: 'Systemövervakning & drift: worker health, system errors, notification queue, retry/cancel/acknowledge, provider logs.',
  support_admin: 'Support-ärenden & begränsad kundöversikt. Ej billing eller systemdrift.',
  billing_admin: 'Abonnemang, plan/status & faktureringsinfo. Ej driftloggar eller secrets.',
  read_only_admin: 'Läsåtkomst till hela plattformen (drift, support, billing). Kan inte ändra något.',
}

const has = (roles, role) => Array.isArray(roles) && roles.includes(role)
export const isSuperadmin = roles => has(roles, 'superadmin')
export const isReadOnlyAdmin = roles => has(roles, 'read_only_admin')
// Läs-gates: read_only_admin ser allt. Manage-gates: read_only_admin exkluderas.
export const canViewOperations = roles => isSuperadmin(roles) || has(roles, 'operations_admin') || isReadOnlyAdmin(roles)
export const canManageOperations = roles => isSuperadmin(roles) || has(roles, 'operations_admin')
export const canViewSupport = roles => isSuperadmin(roles) || has(roles, 'support_admin') || isReadOnlyAdmin(roles)
export const canViewBilling = roles => isSuperadmin(roles) || has(roles, 'billing_admin') || isReadOnlyAdmin(roles)
export const canManageBilling = roles => isSuperadmin(roles) || has(roles, 'billing_admin')
export const canManageRoles = roles => isSuperadmin(roles)
// Har användaren någon plattformsroll alls (får komma in i Control Center)?
export const canAccessAdmin = roles =>
  isSuperadmin(roles) || canViewOperations(roles) || canViewSupport(roles) || canViewBilling(roles)

// Exakt behörighetsmatris (även för dokumentation/test).
export const CAPABILITY_MATRIX = {
  superadmin: { viewOps: true, manageOps: true, viewSupport: true, viewBilling: true, manageBilling: true, manageRoles: true },
  operations_admin: { viewOps: true, manageOps: true, viewSupport: false, viewBilling: false, manageBilling: false, manageRoles: false },
  support_admin: { viewOps: false, manageOps: false, viewSupport: true, viewBilling: false, manageBilling: false, manageRoles: false },
  billing_admin: { viewOps: false, manageOps: false, viewSupport: false, viewBilling: true, manageBilling: true, manageRoles: false },
  read_only_admin: { viewOps: true, manageOps: false, viewSupport: true, viewBilling: true, manageBilling: false, manageRoles: false },
}

// Härled åtkomst-objekt från en roll-lista (matchar my_platform_access i DB).
export function accessFromRoles(roles) {
  return {
    isSuperadmin: isSuperadmin(roles),
    isReadOnly: isReadOnlyAdmin(roles),
    roles: roles || [],
    canViewOperations: canViewOperations(roles),
    canManageOperations: canManageOperations(roles),
    canViewSupport: canViewSupport(roles),
    canViewBilling: canViewBilling(roles),
    canManageBilling: canManageBilling(roles),
  }
}
