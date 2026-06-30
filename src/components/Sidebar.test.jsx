// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'

// Föränderlig auth-kontext + bokslut-licens per test.
const authState = { value: {} }
const license = { value: false }
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState.value }))
vi.mock('./NotificationCenter', () => ({ default: () => null }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: fn => Promise.resolve({ data: fn === 'has_ai_feature' ? license.value : { critical: 0, high: 0, open: 0 } }),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch },
    removeChannel: () => {},
  },
}))

const baseAuth = {
  company: { id: 'c1', name: 'Acme AB', org_nr: '' }, companies: [],
  switchCompany: () => {}, createCompany: () => {}, signOut: () => {},
  isAdmin: false, platformAccess: null,
}
const renderSidebar = (path = '/') =>
  render(<MemoryRouter initialEntries={[path]}><Sidebar /></MemoryRouter>)
const groupBtn = name => screen.getByRole('button', { name: new RegExp(name) })
const openGroup = name => fireEvent.click(groupBtn(name))
// Länkar vars synliga text är EXAKT name (så "Support" ≠ "Supportärenden").
const linksNamed = name => screen.getAllByRole('link').filter(a => a.textContent.trim() === name)

beforeEach(() => { cleanup(); localStorage.clear(); authState.value = { ...baseAuth }; license.value = false })
afterEach(() => cleanup())

describe('Sidebar – AI-paket flyout', () => {
  it('öppnas och visar AI-valen (utan licens: ingen AI Bokslut)', () => {
    renderSidebar('/')
    openGroup('AI-paket')
    expect(linksNamed('AI-assistent')[0].getAttribute('href')).toBe('/assistent')
    expect(linksNamed('AI-ekonomichef')).toHaveLength(1)
    expect(linksNamed('Månadskontroll')).toHaveLength(1)
    expect(linksNamed('AI-granskning')).toHaveLength(1)
    expect(linksNamed('AI Bokslut & Årsredovisning')).toHaveLength(0)   // ej licensierad
  })

  it('visar AI Bokslut & Årsredovisning när licensen är aktiv', async () => {
    license.value = true
    renderSidebar('/')
    openGroup('AI-paket')
    await waitFor(() => expect(linksNamed('AI Bokslut & Årsredovisning')).toHaveLength(1))
    expect(linksNamed('AI Bokslut & Årsredovisning')[0].getAttribute('href')).toBe('/ai-bokslut')
  })

  it('innehåller ALDRIG "OCR-test" (internt verktyg ligger ej i AI-paket)', () => {
    license.value = true
    renderSidebar('/')
    openGroup('AI-paket')
    expect(linksNamed('OCR-test')).toHaveLength(0)
    expect(linksNamed('Dokumenttolkning')).toHaveLength(0)
  })
})

describe('Sidebar – OCR-test (internt, döljs för vanliga användare)', () => {
  it('vanlig användare: ingen Plattform-knapp och inget "OCR-test" någonstans', () => {
    authState.value = { ...baseAuth, platformAccess: null }
    renderSidebar('/')
    expect(screen.queryByRole('button', { name: /Plattform/ })).toBeNull()
    openGroup('AI-paket')
    expect(linksNamed('OCR-test')).toHaveLength(0)
  })

  it('ops-roll (ej superadmin): ser Systemövervakning men INTE OCR-test', () => {
    authState.value = { ...baseAuth, isAdmin: false, platformAccess: { canViewOperations: true } }
    renderSidebar('/')
    openGroup('Plattform')
    expect(linksNamed('Systemövervakning')).toHaveLength(1)
    expect(linksNamed('OCR-test')).toHaveLength(0)
  })

  it('superadmin: ser OCR-test i Plattform-flyouten (/admin/ocr-test)', () => {
    authState.value = { ...baseAuth, isAdmin: true, platformAccess: { canViewOperations: true } }
    renderSidebar('/')
    openGroup('Plattform')
    expect(linksNamed('OCR-test')).toHaveLength(1)
    expect(linksNamed('OCR-test')[0].getAttribute('href')).toBe('/admin/ocr-test')
  })
})

describe('Sidebar – Hjälp + Plattform flyouts + behörighet', () => {
  it('Hjälp-flyout innehåller Handbok och Support', () => {
    renderSidebar('/')
    openGroup('Hjälp')
    expect(linksNamed('Handbok')[0].getAttribute('href')).toBe('/help')
    expect(linksNamed('Support')[0].getAttribute('href')).toBe('/support')
  })

  it('Plattform-knappen visas bara med plattformsbehörighet', () => {
    authState.value = { ...baseAuth, platformAccess: null }
    renderSidebar('/')
    expect(screen.queryByRole('button', { name: /Plattform/ })).toBeNull()
    cleanup()
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/')
    expect(screen.getByRole('button', { name: /Plattform/ })).toBeTruthy()
  })

  it('varje Plattform-val är separat behörighetsgrindat (billing_admin ser bara Billing)', () => {
    authState.value = { ...baseAuth, platformAccess: { canManageBilling: true } }
    renderSidebar('/')
    openGroup('Plattform')
    expect(linksNamed('Billing')).toHaveLength(1)
    expect(linksNamed('Superadmin')).toHaveLength(0)
    expect(linksNamed('Systemövervakning')).toHaveLength(0)
    expect(linksNamed('Supportärenden')).toHaveLength(0)
    expect(linksNamed('OCR-test')).toHaveLength(0)
  })

  it('ingen duplicerad "Support": Hjälp→Support, Plattform→Supportärenden (aldrig samtidigt)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/support')
    openGroup('Hjälp')
    expect(linksNamed('Support')).toHaveLength(1)
    openGroup('Plattform')                                    // byter flyout → Hjälp stängs
    expect(linksNamed('Support')).toHaveLength(0)
    expect(linksNamed('Supportärenden')[0].getAttribute('href')).toBe('/admin/support')
  })
})

describe('Sidebar – tillgänglighet (aria/tangentbord/aktiv markering)', () => {
  it('gruppknapp: native button med aria-expanded som växlar + aria-controls', () => {
    renderSidebar('/')
    const btn = groupBtn('AI-paket')
    expect(btn.tagName).toBe('BUTTON')                        // Enter/Space aktiverar nativt
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    const open = groupBtn('AI-paket')
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(open.getAttribute('aria-controls')).toBe('flyout-ai')
  })

  it('Escape stänger öppen flyout', () => {
    renderSidebar('/')
    openGroup('AI-paket')
    expect(linksNamed('AI-assistent')).toHaveLength(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(linksNamed('AI-assistent')).toHaveLength(0)
  })

  it('flyout-panelen är en märkt grupp (id + aria-label) med länkar (disclosure-mönster)', () => {
    renderSidebar('/')
    openGroup('Hjälp')
    const group = screen.getByRole('group', { name: 'Hjälp' })
    expect(group.getAttribute('id')).toBe('flyout-help')
    expect(linksNamed('Handbok')).toHaveLength(1)
    expect(linksNamed('Support')).toHaveLength(1)
  })

  it('aktiv route markerar BÅDE gruppknapp och länk (Plattform/Supportärenden på /admin/support)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/admin/support')
    const platBtn = groupBtn('Plattform')
    expect(platBtn.className).toMatch(/text-blue-700/)        // gruppknapp markerad
    expect(platBtn.getAttribute('aria-current')).toBe('page')
    openGroup('Plattform')
    expect(linksNamed('Supportärenden')[0].getAttribute('aria-current')).toBe('page')  // länk markerad
  })

  it('Hjälp-gruppknappen markeras aktiv på /support (ej Plattform)', () => {
    authState.value = { ...baseAuth, platformAccess: { canViewSupport: true } }
    renderSidebar('/support')
    expect(groupBtn('Hjälp').className).toMatch(/text-blue-700/)
    expect(groupBtn('Plattform').className).not.toMatch(/text-blue-700/)
  })
})
