// Control Center – rena aggregeringsfunktioner för dashboarden. Inga sidoeffekter,
// inga DB-anrop (testbara). Data kommer från befintliga RPC:er:
//   admin_list_subscriptions() → en rad per företag (left join subscription)
//   subscription_plans (RLS-läsbar katalog) → monthly_price / yearly_price
//   admin_system_overview().workers → worker health
// MRR räknas på status='active' (intäktsgenererande); trial/past_due/etc räknas separat.

import { computeWorkerStatus, WORKER_COMPONENTS } from './systemStatus'

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

// Normaliserad månadsintäkt för en subscription (yearly → /12).
export function normalizedMonthly(sub, plansById) {
  const plan = plansById[sub?.plan_id]
  if (!plan) return 0
  return sub.billing_period === 'yearly' ? n(plan.yearly_price) / 12 : n(plan.monthly_price)
}

// Aggregerar abonnemangsdata → nyckeltal för dashboarden.
export function computeBillingMetrics(subscriptions = [], plans = []) {
  const plansById = Object.fromEntries((plans || []).map(p => [p.id, p]))
  const byStatus = {}
  const revenueByPlan = {}
  let mrr = 0
  let companiesWithSub = 0
  let failedPayments = 0

  for (const s of subscriptions || []) {
    const status = s.status || 'none'                 // företag utan subscription → 'none'
    byStatus[status] = (byStatus[status] || 0) + 1
    if (s.subscription_id) companiesWithSub++
    if (s.payment_status === 'failed') failedPayments++
    if (s.status === 'active') {
      const m = normalizedMonthly(s, plansById)
      mrr += m
      const pn = s.plan_name || 'Okänd plan'
      revenueByPlan[pn] = (revenueByPlan[pn] || 0) + m
    }
  }

  const totalCompanies = (subscriptions || []).length
  const active = byStatus.active || 0
  const mrrR = Math.round(mrr)
  return {
    totalCompanies,
    companiesWithSub,
    activeCompanies: active,
    trial: byStatus.trial || 0,
    pastDue: byStatus.past_due || 0,
    paused: (byStatus.paused || 0) + (byStatus.suspended || 0) + (byStatus.blocked || 0),
    cancelled: byStatus.cancelled || 0,
    expired: byStatus.expired || 0,
    noSubscription: byStatus.none || 0,
    failedPayments,
    byStatus,
    mrr: mrrR,
    arr: mrrR * 12,
    arpc: active ? Math.round(mrr / active) : 0,              // average revenue per active company
    revenueByPlan: Object.fromEntries(Object.entries(revenueByPlan).map(([k, v]) => [k, Math.round(v)])),
  }
}

// Summerar worker health (de 10 komponenterna) per status för hälsokorten.
export function summarizeWorkerHealth(workers = [], now = new Date()) {
  const counts = { healthy: 0, warning: 0, failing: 0, unknown: 0 }
  const perComponent = WORKER_COMPONENTS.map(c => {
    const w = (workers || []).find(x => x.component === c.key) || { component: c.key, has_record: false, consecutive_failures: 0 }
    const status = computeWorkerStatus(w, now)
    counts[status] = (counts[status] || 0) + 1
    return { key: c.key, label: c.label, status }
  })
  const worst = counts.failing > 0 ? 'failing' : counts.warning > 0 ? 'warning' : counts.unknown > 0 ? 'unknown' : 'healthy'
  return { counts, perComponent, worst, total: perComponent.length }
}

// Räknar öppna supportärenden (status ej resolved/closed).
export function countOpenTickets(tickets = []) {
  const closed = new Set(['resolved', 'closed'])
  return (tickets || []).filter(t => !closed.has(t.status)).length
}

export const fmtSek = v => `${Math.round(n(v)).toLocaleString('sv-SE')} kr`
