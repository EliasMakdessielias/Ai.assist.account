// Control Center – företagslista: ren klientlogik (filter, etiketter, behörighet).
// Datakälla: RPC admin_list_companies (server-side gate can_view_operations).
import { serviceStateMeta } from './serviceLock'

export { serviceStateMeta }

export const RISK_META = {
  healthy: { label: 'OK', tone: 'green' },
  warning: { label: 'Bevaka', tone: 'amber' },
  at_risk: { label: 'Risk', tone: 'amber' },
  blocked: { label: 'Låst', tone: 'red' },
}
export const riskMeta = r => RISK_META[r] || { label: r || '–', tone: 'gray' }

// Status-filteralternativ i UI:t (service-state + abonnemangsstatus).
export const COMPANY_FILTERS = [
  { value: '', label: 'Alla' },
  { value: 'active', label: 'Aktiv' },
  { value: 'paused', label: 'Pausad' },
  { value: 'blocked', label: 'Blockerad' },
  { value: 'trial', label: 'Trial' },
  { value: 'past_due', label: 'Past due' },
  { value: 'cancelled', label: 'Avslutad' },
]

// Klient-filter (server filtrerar också; detta ger snabb lokal sök/filtrering, krav 1/9).
export function filterCompanies(list, { search = '', state = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const SERVICE = new Set(['active', 'paused', 'blocked'])
  return (list || []).filter(c => {
    if (state) {
      if (SERVICE.has(state)) { if ((c.service_state || 'active') !== state) return false }
      else if (c.sub_status !== state) return false
    }
    if (!q) return true
    return [c.name, c.org_nr, c.email, c.archive_number]
      .some(v => String(v || '').toLowerCase().includes(q))
  })
}

// Endast superadmin/operations_admin får mutera service-state (krav 4). Speglar
// can_manage_operations() i DB – servern är auktoritativ.
export function canMutateServiceState(access) {
  return !!(access && (access.isSuperadmin || access.canManageOperations))
}
