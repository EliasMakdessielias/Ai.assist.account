import { describe, it, expect } from 'vitest'
import {
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, STATUS_LABELS, CATEGORY_LABELS,
  filterTickets, canViewSupportAdmin, isActiveStatus, isOpenForReply,
  CUSTOMER_STATUS_LABELS, CUSTOMER_PRIORITIES, customerStatusLabel,
} from './support'

describe('support-konstanter (krav 3/4/5)', () => {
  it('status, priority, category täcker specen', () => {
    expect(TICKET_STATUSES).toEqual(['new', 'open', 'waiting_for_customer', 'waiting_for_support', 'resolved', 'closed'])
    expect(TICKET_PRIORITIES).toEqual(['low', 'normal', 'high', 'urgent'])
    expect(TICKET_CATEGORIES).toEqual(['billing', 'invoice_import', 'bookkeeping', 'login_access', 'technical_error', 'feature_request', 'other'])
  })
  it('alla har etiketter', () => {
    TICKET_STATUSES.forEach(s => expect(STATUS_LABELS[s]).toBeTruthy())
    TICKET_CATEGORIES.forEach(c => expect(CATEGORY_LABELS[c]).toBeTruthy())
  })
  it('aktiv/öppen-status', () => {
    expect(isActiveStatus('open')).toBe(true)
    expect(isActiveStatus('closed')).toBe(false)
    expect(isOpenForReply('resolved')).toBe(true)
    expect(isOpenForReply('closed')).toBe(false)
  })
})

describe('filterTickets (krav 6)', () => {
  const tix = [
    { id: '1', subject: 'Fakturaimport krånglar', company_name: 'Acme AB', status: 'open', priority: 'urgent', company_id: 'c1', assigned_admin_id: 'a1' },
    { id: '2', subject: 'Glömt lösenord', company_name: 'Beta HB', status: 'closed', priority: 'low', company_id: 'c2', assigned_admin_id: null },
    { id: '3', subject: 'Bokföringsfråga', company_name: 'Acme AB', status: 'open', priority: 'normal', company_id: 'c1', assigned_admin_id: 'a2' },
  ]
  it('filtrerar på status', () => { expect(filterTickets(tix, { status: 'open' }).map(t => t.id)).toEqual(['1', '3']) })
  it('filtrerar på priority', () => { expect(filterTickets(tix, { priority: 'urgent' }).map(t => t.id)).toEqual(['1']) })
  it('filtrerar på company', () => { expect(filterTickets(tix, { companyId: 'c1' })).toHaveLength(2) })
  it('filtrerar på assigned', () => { expect(filterTickets(tix, { assigned: 'a2' }).map(t => t.id)).toEqual(['3']) })
  it('söker i subject och företagsnamn', () => {
    expect(filterTickets(tix, { search: 'lösenord' }).map(t => t.id)).toEqual(['2'])
    expect(filterTickets(tix, { search: 'acme' })).toHaveLength(2)
  })
  it('kombinerar filter', () => {
    expect(filterTickets(tix, { status: 'open', companyId: 'c1', search: 'bokför' }).map(t => t.id)).toEqual(['3'])
  })
})

describe('kundvy (krav 3/5)', () => {
  it('kundvänliga statusnamn (new/open = Öppet)', () => {
    expect(customerStatusLabel('new')).toBe('Öppet')
    expect(customerStatusLabel('open')).toBe('Öppet')
    expect(customerStatusLabel('waiting_for_customer')).toBe('Väntar på dig')
    expect(customerStatusLabel('waiting_for_support')).toBe('Väntar på support')
    expect(customerStatusLabel('resolved')).toBe('Löst')
    expect(customerStatusLabel('closed')).toBe('Stängt')
    TICKET_STATUSES.forEach(s => expect(CUSTOMER_STATUS_LABELS[s]).toBeTruthy())
  })
  it('kund får inte välja urgent', () => {
    expect(CUSTOMER_PRIORITIES).toEqual(['low', 'normal', 'high'])
    expect(CUSTOMER_PRIORITIES).not.toContain('urgent')
  })
})

describe('access (krav 10)', () => {
  it('bara support/superadmin ser admin-supportvyn', () => {
    expect(canViewSupportAdmin({ canViewSupport: true })).toBe(true)
    expect(canViewSupportAdmin({ canViewSupport: false })).toBe(false)
    expect(canViewSupportAdmin(null)).toBe(false)
  })
})
