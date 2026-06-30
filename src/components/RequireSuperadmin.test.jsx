// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RequireSuperadmin from './RequireSuperadmin'

const authState = { value: {} }
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState.value }))

// Samma sex personas som sidomenytestet. perm/route-guard = ENBART platformAccess.isSuperadmin.
const PERSONAS = {
  member: { loading: false, platformAccess: null },
  companyAdmin: { loading: false, platformAccess: null },                                  // company admin ≠ plattformsåtkomst
  ops: { loading: false, platformAccess: { canViewOperations: true, isSuperadmin: false } },
  support: { loading: false, platformAccess: { canViewSupport: true, isSuperadmin: false } },
  billing: { loading: false, platformAccess: { canManageBilling: true, isSuperadmin: false } },
  superadmin: { loading: false, platformAccess: { isSuperadmin: true, canViewOperations: true } },
}

// Renderar /admin/ocr-test bakom guarden; "/" är redirect-målet.
function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin/ocr-test']}>
      <Routes>
        <Route path="/" element={<div>HEMSIDA</div>} />
        <Route path="/admin/ocr-test" element={<RequireSuperadmin><div>OCR-TEST-SIDA</div></RequireSuperadmin>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { cleanup(); authState.value = {} })
afterEach(() => cleanup())

describe('RequireSuperadmin – /admin/ocr-test route-guard', () => {
  it.each([['member'], ['companyAdmin'], ['ops'], ['support'], ['billing']])(
    '%s: nekas → ingen OCR-test-sida, omdirigeras till "/"', persona => {
      authState.value = PERSONAS[persona]
      renderRoute()
      expect(screen.queryByText('OCR-TEST-SIDA')).toBeNull()   // sidan renderas ALDRIG
      expect(screen.getByText('HEMSIDA')).toBeTruthy()         // redirect till hem
    })

  it('superadmin: OCR-test-sidan renderas', () => {
    authState.value = PERSONAS.superadmin
    renderRoute()
    expect(screen.getByText('OCR-TEST-SIDA')).toBeTruthy()
    expect(screen.queryByText('HEMSIDA')).toBeNull()
  })

  it('ops (canViewOperations men ej superadmin): nekas explicit', () => {
    authState.value = PERSONAS.ops
    renderRoute()
    expect(screen.queryByText('OCR-TEST-SIDA')).toBeNull()
  })

  it('väntar in access (loading) utan att felaktigt omdirigera', () => {
    authState.value = { loading: true, platformAccess: null }
    renderRoute()
    expect(screen.queryByText('OCR-TEST-SIDA')).toBeNull()
    expect(screen.queryByText('HEMSIDA')).toBeNull()           // ingen redirect under laddning
  })
})
