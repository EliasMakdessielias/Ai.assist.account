import { describe, it, expect } from 'vitest'
import { computeBillingMetrics, normalizedMonthly, countOpenTickets, summarizeWorkerHealth, fmtSek } from './adminMetrics'

const plans = [
  { id: 'p1', name: 'Bas', monthly_price: 199, yearly_price: 1990 },
  { id: 'p2', name: 'Plus', monthly_price: 499, yearly_price: 4990 },
]
// En rad per företag (admin_list_subscriptions left-joinar subscription).
const subs = [
  { company_id: 'c1', subscription_id: 's1', plan_id: 'p1', plan_name: 'Bas', status: 'active', billing_period: 'monthly' },
  { company_id: 'c2', subscription_id: 's2', plan_id: 'p2', plan_name: 'Plus', status: 'active', billing_period: 'yearly' },
  { company_id: 'c3', subscription_id: 's3', plan_id: 'p1', plan_name: 'Bas', status: 'trial', billing_period: 'trial' },
  { company_id: 'c4', subscription_id: 's4', plan_id: 'p2', plan_name: 'Plus', status: 'past_due', billing_period: 'monthly' },
  { company_id: 'c5', subscription_id: null, status: null },
]

describe('normalizedMonthly', () => {
  const byId = { p1: plans[0], p2: plans[1] }
  it('månadsabonnemang = monthly_price', () => {
    expect(normalizedMonthly({ plan_id: 'p1', billing_period: 'monthly' }, byId)).toBe(199)
  })
  it('årsabonnemang = yearly_price / 12', () => {
    expect(normalizedMonthly({ plan_id: 'p2', billing_period: 'yearly' }, byId)).toBeCloseTo(4990 / 12, 3)
  })
  it('okänd plan = 0', () => {
    expect(normalizedMonthly({ plan_id: 'x', billing_period: 'monthly' }, byId)).toBe(0)
  })
})

describe('computeBillingMetrics – MRR/ARR/ARPC + statusräkning (krav 2)', () => {
  const m = computeBillingMetrics(subs, plans)
  it('räknar företag och statusar', () => {
    expect(m.totalCompanies).toBe(5)
    expect(m.companiesWithSub).toBe(4)
    expect(m.activeCompanies).toBe(2)
    expect(m.trial).toBe(1)
    expect(m.pastDue).toBe(1)
    expect(m.noSubscription).toBe(1)
  })
  it('MRR endast på aktiva, ARR = MRR×12, ARPC = MRR/aktiva', () => {
    // 199 (Bas/mån) + 4990/12 (Plus/år) = 614.83 → 615
    expect(m.mrr).toBe(615)
    expect(m.arr).toBe(615 * 12)
    expect(m.arpc).toBe(307)            // round(614.83/2)
  })
  it('intäkt per plan (avrundad)', () => {
    expect(m.revenueByPlan).toEqual({ Bas: 199, Plus: 416 })
  })
  it('tom indata ger nollor', () => {
    const z = computeBillingMetrics([], [])
    expect(z.mrr).toBe(0); expect(z.arr).toBe(0); expect(z.arpc).toBe(0); expect(z.totalCompanies).toBe(0)
  })
})

describe('countOpenTickets', () => {
  it('räknar ej resolved/closed', () => {
    expect(countOpenTickets([
      { status: 'new' }, { status: 'open' }, { status: 'waiting_for_customer' },
      { status: 'resolved' }, { status: 'closed' },
    ])).toBe(3)
    expect(countOpenTickets([])).toBe(0)
  })
})

describe('summarizeWorkerHealth', () => {
  const now = new Date('2026-06-10T12:00:00Z')
  const workers = [
    { component: 'imap-import', has_record: true, consecutive_failures: 0, last_success_at: '2026-06-10T11:00:00Z' },
    { component: 'email-worker', has_record: true, consecutive_failures: 2 },
  ]
  it('summerar per status över alla komponenter', () => {
    const h = summarizeWorkerHealth(workers, now)
    expect(h.total).toBe(6)                 // WORKER_COMPONENTS
    expect(h.counts.healthy).toBe(1)
    expect(h.counts.failing).toBe(1)
    expect(h.counts.unknown).toBe(4)        // resten saknar record
    expect(h.worst).toBe('failing')
  })
})

describe('fmtSek', () => {
  it('formaterar SEK', () => {
    expect(fmtSek(615)).toBe('615 kr')
    expect(fmtSek(0)).toBe('0 kr')
    expect(fmtSek('abc')).toBe('0 kr')
  })
})
