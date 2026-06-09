// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Bokforing from './Bokforing'

// Stabil referens – annars triggar useEffect([company]) en oändlig render-loop.
vi.mock('../hooks/useAuth', () => {
  const auth = { company: { id: 'c1' }, user: { id: 'u1' } }
  return { useAuth: () => auth }
})
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: async () => ({ data: [], error: null }) }
  return { supabase: { from: () => q, rpc: async () => ({ data: null, error: null }) } }
})
// Stubba tunga barn – vi testar layouten, inte deras innehåll.
vi.mock('../components/Dagskassa', () => ({ default: () => <div data-testid="dagskassa-form" /> }))
vi.mock('../components/Kvitto', () => ({ default: () => <div data-testid="kvitto-form" /> }))
vi.mock('../components/StamAvKonto', () => ({ default: () => <div /> }))
vi.mock('../components/SokBelopp', () => ({ default: () => <div /> }))
vi.mock('../components/AccountingUnderlagPanel', () => ({ default: () => <div data-testid="underlag-panel">PANEL</div> }))

const renderPage = () => render(<MemoryRouter><Bokforing /></MemoryRouter>)
beforeEach(() => { cleanup(); localStorage.clear() })

describe('Bokföring – dokumentpanel i registreringsflikar (krav 1)', () => {
  it('visar INTE panel på fliken Verifikationer', () => {
    renderPage()
    expect(screen.queryByTestId('underlag-panel')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('visar panel + splitter på "Registrera dagskassa"', () => {
    renderPage()
    fireEvent.click(screen.getByText('Registrera dagskassa'))
    expect(screen.getByTestId('dagskassa-form')).toBeTruthy()
    expect(screen.getByTestId('underlag-panel')).toBeTruthy()
    expect(screen.getByRole('separator')).toBeTruthy()
  })

  it('visar panel på "Registrera kvitto"', () => {
    renderPage()
    fireEvent.click(screen.getByText('Registrera kvitto'))
    expect(screen.getByTestId('kvitto-form')).toBeTruthy()
    expect(screen.getByTestId('underlag-panel')).toBeTruthy()
  })

  it('"Dölj bild" döljer panelen, "Visa bild" återställer den', () => {
    renderPage()
    fireEvent.click(screen.getByText('Registrera dagskassa'))
    expect(screen.getByTestId('underlag-panel')).toBeTruthy()

    fireEvent.click(screen.getByText('Dölj bild'))
    expect(screen.queryByTestId('underlag-panel')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()

    fireEvent.click(screen.getByText('Visa bild'))
    expect(screen.getByTestId('underlag-panel')).toBeTruthy()
  })

  it('dölj-läget sparas i localStorage (krav 6/8)', () => {
    renderPage()
    fireEvent.click(screen.getByText('Registrera dagskassa'))
    fireEvent.click(screen.getByText('Dölj bild'))
    expect(localStorage.getItem('bokpilot.bokforing.registrera.viewerOpen')).toBe('0')
  })
})
