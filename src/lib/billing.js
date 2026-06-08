// Billing-admin: konstanter, etiketter, formattering och filterlogik. RPC/RLS auktoritativa på backend.

export const SUB_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired']
export const BILLING_PERIODS = ['monthly', 'yearly', 'trial']

export const STATUS_LABELS = {
  trial: 'Provperiod', active: 'Aktiv', past_due: 'Förfallen', suspended: 'Pausad', cancelled: 'Avslutad', expired: 'Utgången',
}
export const STATUS_META = {
  trial: { tone: 'blue' }, active: { tone: 'green' }, past_due: { tone: 'red' },
  suspended: { tone: 'amber' }, cancelled: { tone: 'gray' }, expired: { tone: 'gray' },
}
export const PERIOD_LABELS = { monthly: 'Månadsvis', yearly: 'Årsvis', trial: 'Provperiod' }
export const TONE_CLASS = {
  blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700', gray: 'bg-gray-100 text-gray-500',
}

export const statusLabel = s => STATUS_LABELS[s] || s || 'Ingen plan'

// Kundvända statusnamn (krav 4).
export const CUSTOMER_STATUS_LABELS = {
  trial: 'Testperiod', active: 'Aktiv', past_due: 'Betalning krävs', suspended: 'Avstängd', cancelled: 'Avslutad', expired: 'Utgången',
}
export const customerStatusLabel = s => CUSTOMER_STATUS_LABELS[s] || s || 'Ingen plan'

export function formatPrice(n, currency = 'SEK') {
  const v = Number(n) || 0
  return `${v.toLocaleString('sv-SE')} ${currency === 'SEK' ? 'kr' : currency}`
}
export function formatLimit(n) {
  return (n === null || n === undefined) ? 'Obegränsat' : Number(n).toLocaleString('sv-SE')
}

export function filterSubscriptions(rows, { status = '', planId = '', search = '' } = {}) {
  const q = search.trim().toLowerCase()
  return (rows || []).filter(r =>
    (!status || r.status === status) &&
    (!planId || r.plan_id === planId) &&
    (!q || (r.company_name || '').toLowerCase().includes(q) || (r.org_nr || '').toLowerCase().includes(q)))
}

// Endast billing_admin/superadmin får billing-vyn.
export const canManageBilling = access => !!access?.canManageBilling

// Usage-rader för kundvyn: visar förbrukning ENDAST om data finns (krav 3), annars bara limit.
export const USAGE_METRICS = [
  { key: 'users', label: 'Användare', limitKey: 'max_users' },
  { key: 'invoices_this_month', label: 'Fakturor denna månad', limitKey: 'max_invoices_per_month' },
  { key: 'documents_this_month', label: 'Underlag denna månad', limitKey: 'max_documents_per_month' },
  { key: 'storage_mb', label: 'Lagring (MB)', limitKey: 'max_storage_mb' },
  { key: 'ai', label: 'AI-operationer/mån', limitKey: 'max_ai_operations_per_month' },
]
export function usageRows(usage, plan) {
  return USAGE_METRICS.map(m => ({
    label: m.label,
    used: usage && usage[m.key] !== undefined && usage[m.key] !== null ? usage[m.key] : null,
    limit: plan ? plan[m.limitKey] : null,
  }))
}

export const STATUS_WARNING = { past_due: true, suspended: true, expired: true }
export const isWarningStatus = s => !!STATUS_WARNING[s]
