// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'

// Föränderlig auth-kontext per test.
const authState = { value: {} }
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState.value }))
vi.mock('./NotificationCenter', () => ({ default: () => null }))

const baseAuth = {
  company: { name: 'Acme AB', org_nr: '' }, companies: [],
  switchCompany: () => {}, createCompany: () => {}, signOut: () => {},
  isAdmin: false, platformAccess: null,
}
const renderSidebar = (path = '/support') =>
  render(<MemoryRouter initialEntries={[path]}><Sidebar /></MemoryRouter>)
// Länkar vars synliga text är EXAKT name (så "Support" ≠ "Supportärenden").
const linksNamed = name => screen.getAllByRole('link').filter(a => a.textContent.trim() === name)

beforeEach(() => { cleanup(); localStorage.clear(); authState.value = { ...baseAuth } })
afterEach(() => cleanup())

describe('Sidebar – support-navigation (ingen dubbel "Support")', () => {
  it('vanlig kund: exakt EN "Support" (HJÄLP → /support), ingen "Supportärenden"', () => {
    authState.value = { ...baseAuth, platformAccess: null }
    renderSidebar('/support')
    expect(linksNamed('Support')).toHaveLength(1)
    expect(linksNamed('Supportärenden')).toHaveLength(0)
    expect(linksNamed('Support')[0].getAttribute('href')).toBe('/support')
  })

  it('support_admin: "Support" (HJÄLP) + "Supportärenden" (PLATTFORM → /admin/support)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/support')
    expect(linksNamed('Support')).toHaveLength(1)
    const admin = linksNamed('Supportärenden')
    expect(admin).toHaveLength(1)
    expect(admin[0].getAttribute('href')).toBe('/admin/support')
  })

  it('superadmin: aldrig två poster med exakt label "Support"', () => {
    authState.value = { ...baseAuth, isAdmin: true, platformAccess: { canViewSupport: true, canViewOperations: true, canManageBilling: true } }
    renderSidebar('/')
    expect(linksNamed('Support')).toHaveLength(1)
    expect(linksNamed('Supportärenden')).toHaveLength(1)
  })

  it('billing_admin (utan support): ingen "Support" eller "Supportärenden" i PLATTFORM', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: false, canManageBilling: true } }
    renderSidebar('/support')
    expect(linksNamed('Support')).toHaveLength(1)        // kvar i HJÄLP
    expect(linksNamed('Supportärenden')).toHaveLength(0) // ingen adminlänk
  })

  it('aktiv kundsupport-länk markeras på /support (ej adminlänken)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/support')
    expect(linksNamed('Support')[0].getAttribute('aria-current')).toBe('page')
    expect(linksNamed('Supportärenden')[0].getAttribute('aria-current')).not.toBe('page')
  })

  it('aktiv adminlänk markeras på /admin/support (ej kundlänken)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/admin/support')
    expect(linksNamed('Supportärenden')[0].getAttribute('aria-current')).toBe('page')
    expect(linksNamed('Support')[0].getAttribute('aria-current')).not.toBe('page')
  })
})
