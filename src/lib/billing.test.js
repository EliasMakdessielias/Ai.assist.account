import { describe, it, expect } from 'vitest'
import {
  SUB_STATUSES, BILLING_PERIODS, STATUS_LABELS, PERIOD_LABELS,
  formatPrice, formatLimit, filterSubscriptions, canManageBilling, statusLabel,
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

describe('access (krav 9)', () => {
  it('bara billing/superadmin', () => {
    expect(canManageBilling({ canManageBilling: true })).toBe(true)
    expect(canManageBilling({ canManageBilling: false })).toBe(false)
    expect(canManageBilling(null)).toBe(false)
  })
})
