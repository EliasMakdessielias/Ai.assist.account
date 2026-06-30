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

  it('ROBO-bp visas i AI-paket med licens (knapp, ej route)', async () => {
    license.value = true
    renderSidebar('/')
    openGroup('AI-paket')
    await waitFor(() => expect(screen.getByRole('button', { name: /ROBO-bp/ })).toBeTruthy())
  })

  it('ROBO-bp döljs utan ROBO-bp-licens', () => {
    license.value = false
    renderSidebar('/')
    openGroup('AI-paket')
    expect(screen.queryByRole('button', { name: /ROBO-bp/ })).toBeNull()
  })
})

// Sex separata access-fixturer. perm:'superadmin' (OCR-test) = ENDAST platformAccess.isSuperadmin.
// isAdmin = rad i platform_admins (plattformsadmin), aldrig company admin. ops/support/billing = granulära roller.
const PERSONAS = {
  member: { isAdmin: false, platformAccess: null },
  companyAdmin: { isAdmin: false, platformAccess: null, company: { id: 'c1', name: 'Acme AB', role: 'admin' } }, // company admin ≠ plattformsåtkomst
  ops: { isAdmin: false, platformAccess: { canViewOperations: true, isSuperadmin: false } },
  support: { isAdmin: false, platformAccess: { canViewSupport: true, isSuperadmin: false } },
  billing: { isAdmin: false, platformAccess: { canManageBilling: true, isSuperadmin: false } },
  superadmin: { isAdmin: true, platformAccess: { isSuperadmin: true, canViewOperations: true, canViewSupport: true, canManageBilling: true } },
}

describe('Sidebar – OCR-test endast för plattforms-superadmin (perm: superadmin = isSuperadmin)', () => {
  it.each([['member'], ['companyAdmin'], ['ops'], ['support'], ['billing']])(
    '%s: ser ALDRIG OCR-test', persona => {
      authState.value = { ...baseAuth, ...PERSONAS[persona] }
      renderSidebar('/')
      // OCR-test ligger i Plattform; öppna den om knappen finns, annars finns ingen åtkomst alls.
      if (screen.queryByRole('button', { name: /Plattform/ })) openGroup('Plattform')
      expect(linksNamed('OCR-test')).toHaveLength(0)
    })

  it('endast superadmin ser OCR-test (/admin/ocr-test) i Plattform-flyouten', () => {
    authState.value = { ...baseAuth, ...PERSONAS.superadmin }
    renderSidebar('/')
    openGroup('Plattform')
    expect(linksNamed('OCR-test')).toHaveLength(1)
    expect(linksNamed('OCR-test')[0].getAttribute('href')).toBe('/admin/ocr-test')
  })

  it('vanlig member OCH vanlig company admin saknar Plattform-knapp helt', () => {
    for (const persona of ['member', 'companyAdmin']) {
      cleanup()
      authState.value = { ...baseAuth, ...PERSONAS[persona] }
      renderSidebar('/')
      expect(screen.queryByRole('button', { name: /Plattform/ }), persona).toBeNull()
    }
  })

  it('ops/support/billing ser Plattform-knappen (sina egna val) men INTE OCR-test', () => {
    for (const [persona, ownLabel] of [['ops', 'Systemövervakning'], ['support', 'Supportärenden'], ['billing', 'Billing']]) {
      cleanup()
      authState.value = { ...baseAuth, ...PERSONAS[persona] }
      renderSidebar('/')
      openGroup('Plattform')
      expect(linksNamed(ownLabel), persona).toHaveLength(1)     // ser sitt eget val
      expect(linksNamed('OCR-test'), persona).toHaveLength(0)   // men aldrig OCR-test
    }
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
