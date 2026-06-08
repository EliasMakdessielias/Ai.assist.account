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
