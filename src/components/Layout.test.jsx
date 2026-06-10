// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from './Layout'

const h = vi.hoisted(() => ({ auth: {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => h.auth }))
vi.mock('./Sidebar', () => ({ default: () => <div data-testid="sidebar">SIDEBAR</div> }))
vi.mock('./StartGuide', () => ({ default: () => <div data-testid="startguide" /> }))

const lockedCompany = { service_state: 'paused', service_reason: 'Obetald faktura', service_changed_at: '2026-06-01', onboarded: true }
const renderAt = path => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>)
beforeEach(() => { cleanup(); h.auth = {} })

describe('Layout – tjänstelås (Fas 2, krav 5)', () => {
  it('pausat företag (kund) ser låsvyn med orsak + knappar, ej appen', () => {
    h.auth = { company: lockedCompany, isAdmin: false, signOut: vi.fn() }
    renderAt('/')
    expect(screen.getByText('Ditt BokPilot-konto är tillfälligt pausat.')).toBeTruthy()
    expect(screen.getByText('Obetald faktura')).toBeTruthy()
    expect(screen.getByText('Pausad')).toBeTruthy()
    expect(screen.getByText('Kontakta support')).toBeTruthy()
    expect(screen.getByText('Logga ut')).toBeTruthy()
    expect(screen.queryByTestId('sidebar')).toBeNull()          // appen renderas ej
  })

  it('supportflödet är nåbart trots lås (/support → appen renderas)', () => {
    h.auth = { company: lockedCompany, isAdmin: false, signOut: vi.fn() }
    renderAt('/support')
    expect(screen.queryByText('Ditt BokPilot-konto är tillfälligt pausat.')).toBeNull()
    expect(screen.getByTestId('sidebar')).toBeTruthy()
  })

  it('plattformsadmin släpps förbi låset', () => {
    h.auth = { company: lockedCompany, isAdmin: true, signOut: vi.fn() }
    renderAt('/')
    expect(screen.queryByText('Ditt BokPilot-konto är tillfälligt pausat.')).toBeNull()
    expect(screen.getByTestId('sidebar')).toBeTruthy()
  })

  it('aktivt företag renderar appen normalt', () => {
    h.auth = { company: { service_state: 'active', onboarded: true }, isAdmin: false, signOut: vi.fn() }
    renderAt('/')
    expect(screen.queryByText('Ditt BokPilot-konto är tillfälligt pausat.')).toBeNull()
    expect(screen.getByTestId('sidebar')).toBeTruthy()
  })
})
