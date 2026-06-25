// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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
// Hjälp/Plattform är grupp-knappar som öppnar en flyout; öppna gruppen innan länkarna nås.
const groupBtn = name => screen.getByRole('button', { name: new RegExp(name) })
const openGroup = name => fireEvent.click(groupBtn(name))
// Länkar vars synliga text är EXAKT name (så "Support" ≠ "Supportärenden").
const linksNamed = name => screen.getAllByRole('link').filter(a => a.textContent.trim() === name)

beforeEach(() => { cleanup(); localStorage.clear(); authState.value = { ...baseAuth } })
afterEach(() => cleanup())

describe('Sidebar – grupperade flyout-menyer (Hjälp/Plattform)', () => {
  it('vanlig kund: ingen Plattform-knapp; Hjälp-flyout har exakt EN "Support" (/support)', () => {
    authState.value = { ...baseAuth, platformAccess: null }
    renderSidebar('/support')
    expect(screen.queryByRole('button', { name: /Plattform/ })).toBeNull()  // ingen plattformsåtkomst → ingen knapp
    openGroup('Hjälp')
    expect(linksNamed('Support')).toHaveLength(1)
    expect(linksNamed('Support')[0].getAttribute('href')).toBe('/support')
    expect(linksNamed('Supportärenden')).toHaveLength(0)
  })

  it('support_admin: Hjälp→Support (/support); Plattform→Supportärenden (/admin/support), aldrig samtidigt dubbel "Support"', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/support')
    openGroup('Hjälp')
    expect(linksNamed('Support')).toHaveLength(1)
    openGroup('Plattform')                                  // byter flyout → Hjälp stängs
    const admin = linksNamed('Supportärenden')
    expect(admin).toHaveLength(1)
    expect(admin[0].getAttribute('href')).toBe('/admin/support')
    expect(linksNamed('Support')).toHaveLength(0)           // exakt-label "Support" finns ej i Plattform-flyouten
  })

  it('superadmin: Plattform-flyout innehåller Superadmin + Systemövervakning + Supportärenden + Billing', () => {
    authState.value = { ...baseAuth, isAdmin: true, platformAccess: { canViewSupport: true, canViewOperations: true, canManageBilling: true } }
    renderSidebar('/')
    openGroup('Plattform')
    expect(linksNamed('Superadmin')).toHaveLength(1)
    expect(linksNamed('Systemövervakning')).toHaveLength(1)
    expect(linksNamed('Supportärenden')).toHaveLength(1)
    expect(linksNamed('Billing')).toHaveLength(1)
  })

  it('billing_admin (utan support): Plattform→Billing men ingen "Supportärenden"; Hjälp→Support kvar', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: false, canManageBilling: true } }
    renderSidebar('/support')
    openGroup('Plattform')
    expect(linksNamed('Billing')).toHaveLength(1)
    expect(linksNamed('Supportärenden')).toHaveLength(0)
    openGroup('Hjälp')
    expect(linksNamed('Support')).toHaveLength(1)
  })

  it('Hjälp-knappen markeras aktiv på /support (ej Plattform)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/support')
    expect(groupBtn('Hjälp').className).toMatch(/text-blue-700/)
    expect(groupBtn('Plattform').className).not.toMatch(/text-blue-700/)
  })

  it('Plattform-knappen markeras aktiv på /admin/support (ej Hjälp)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/admin/support')
    expect(groupBtn('Plattform').className).toMatch(/text-blue-700/)
    expect(groupBtn('Hjälp').className).not.toMatch(/text-blue-700/)
  })
})
