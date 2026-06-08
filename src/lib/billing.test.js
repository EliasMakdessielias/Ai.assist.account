import { describe, it, expect } from 'vitest'
import {
  SUB_STATUSES, BILLING_PERIODS, STATUS_LABELS, PERIOD_LABELS,
  formatPrice, formatLimit, filterSubscriptions, canManageBilling, statusLabel,
  usageRows, isWarningStatus, customerStatusLabel,
} from './billing'

describe('billing-konstanter (krav 3/4)', () => {
  it('status + billing period', () => {
    expect(SUB_STATUSES).toEqual(['trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired'])
    expect(BILLING_PERIODS).toEqual(['monthly', 'yearly', 'trial'])
  })
  it('etiketter finns', () => {
    SUB_STATUSES.forEach(s => expect(STATUS_LABELS[s]).toBeTruthy())
    BILLING_PERIODS.forEach(p => expect(PERIOD_LABELS[p]).toBeTruthy())
  })
})

describe('formattering', () => {
  it('pris i SEK', () => { expect(formatPrice(1990)).toBe('1 990 kr'); expect(formatPrice(0)).toBe('0 kr') })
  it('limits (null = obegränsat)', () => {
    expect(formatLimit(null)).toBe('Obegränsat')
    expect(formatLimit(undefined)).toBe('Obegränsat')
    expect(formatLimit(50)).toBe('50')
  })
  it('statusLabel', () => {
    expect(statusLabel('active')).toBe('Aktiv')
    expect(statusLabel(null)).toBe('Ingen plan')
  })
  it('kundvända statusnamn (krav 4)', () => {
    expect(customerStatusLabel('trial')).toBe('Testperiod')
    expect(customerStatusLabel('past_due')).toBe('Betalning krävs')
    expect(customerStatusLabel('suspended')).toBe('Avstängd')
    expect(customerStatusLabel('cancelled')).toBe('Avslutad')
    expect(customerStatusLabel('expired')).toBe('Utgången')
    expect(customerStatusLabel('active')).toBe('Aktiv')
  })
})

describe('filterSubscriptions (krav 5)', () => {
  const rows = [
    { company_name: 'Acme AB', org_nr: '556001-0001', status: 'active', plan_id: 'p1' },
    { company_name: 'Beta HB', org_nr: '556002-0002', status: 'trial', plan_id: 'p2' },
    { company_name: 'Acme Service', org_nr: '556003-0003', status: 'active', plan_id: 'p1' },
  ]
  it('filtrerar på status', () => { expect(filterSubscriptions(rows, { status: 'trial' })).toHaveLength(1) })
  it('filtrerar på plan', () => { expect(filterSubscriptions(rows, { planId: 'p1' })).toHaveLength(2) })
  it('söker på namn/org', () => {
    expect(filterSubscriptions(rows, { search: 'acme' })).toHaveLength(2)
    expect(filterSubscriptions(rows, { search: '556002' })).toHaveLength(1)
  })
})

describe('usageRows (krav 3 – usage endast om data finns)', () => {
  const plan = { max_users: 10, max_invoices_per_month: 300, max_documents_per_month: 1000, max_storage_mb: 10240, max_ai_operations_per_month: 1000 }
  it('visar used endast där data finns, annars null (bara limit)', () => {
    const rows = usageRows({ users: 3, invoices_this_month: 12, documents_this_month: 40, storage_mb: 5 }, plan)
    const byLabel = Object.fromEntries(rows.map(r => [r.label, r]))
    expect(byLabel['Användare'].used).toBe(3)
    expect(byLabel['Användare'].limit).toBe(10)
    expect(byLabel['Fakturor denna månad'].used).toBe(12)
    // AI saknar usage-data -> used null, men limit visas
    expect(byLabel['AI-operationer/mån'].used).toBeNull()
    expect(byLabel['AI-operationer/mån'].limit).toBe(1000)
  })
  it('inget usage-objekt -> alla used null (hittar inte på siffror)', () => {
    expect(usageRows(null, plan).every(r => r.used === null)).toBe(true)
  })
})

describe('isWarningStatus (krav 5)', () => {
  it('past_due/suspended/expired = varning', () => {
    expect(isWarningStatus('past_due')).toBe(true)
    expect(isWarningStatus('suspended')).toBe(true)
    expect(isWarningStatus('expired')).toBe(true)
    expect(isWarningStatus('active')).toBe(false)
    expect(isWarningStatus('trial')).toBe(false)
  })
})

describe('access (krav 9)', () => {
  it('bara billing/superadmin', () => {
    expect(canManageBilling({ canManageBilling: true })).toBe(true)
    expect(canManageBilling({ canManageBilling: false })).toBe(false)
    expect(canManageBilling(null)).toBe(false)
  })
})
