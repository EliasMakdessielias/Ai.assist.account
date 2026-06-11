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
const rpc = vi.fn()
const verData = { current: [] }
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: async () => ({ data: verData.current, error: null }) }
  return { supabase: { from: () => q, rpc: (...a) => rpc(...a) } }
})
// Stubba tunga barn – vi testar layouten, inte deras innehåll.
vi.mock('../components/Dagskassa', () => ({ default: () => <div data-testid="dagskassa-form" /> }))
vi.mock('../components/Kvitto', () => ({ default: () => <div data-testid="kvitto-form" /> }))
vi.mock('../components/StamAvKonto', () => ({ default: () => <div /> }))
vi.mock('../components/SokBelopp', () => ({ default: () => <div /> }))
vi.mock('../components/AccountingUnderlagPanel', () => ({ default: () => <div data-testid="underlag-panel">PANEL</div> }))

const renderPage = () => render(<MemoryRouter><Bokforing /></MemoryRouter>)
beforeEach(() => {
  cleanup(); localStorage.clear()
  verData.current = []
  rpc.mockReset().mockResolvedValue({ data: null, error: null })
})

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

describe('Bokföring – makulering via motverifikation (BFL)', () => {
  const aktiv = { id: 'v1', ver_nr: 'M1', ver_serie: 'M', datum: '2026-06-01', beskrivning: 'Aktiv post', total_debet: 100, total_kredit: 100, status: 'aktiv' }
  const makulerad = { id: 'v2', ver_nr: 'M2', ver_serie: 'M', datum: '2026-06-02', beskrivning: 'Gammal post', total_debet: 50, total_kredit: 50, status: 'makulerad' }
  const motver = { id: 'v3', ver_nr: 'M3', ver_serie: 'M', datum: '2026-06-02', beskrivning: 'Makulering av M2', total_debet: 50, total_kredit: 50, status: 'motverifikation' }

  it('aktiv verifikation har Makulera-knapp som anropar makulera_verifikation', async () => {
    verData.current = [aktiv, makulerad]
    rpc.mockResolvedValue({ data: { ok: true, motverifikation_nr: 'M4' }, error: null })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await screen.findByText('M1')
    const btns = screen.getAllByTitle('Makulera (motverifikation skapas)')
    expect(btns).toHaveLength(1)   // endast den aktiva – ALDRIG på redan makulerad
    fireEvent.click(btns[0])
    expect(confirmSpy.mock.calls[0][0]).toContain('Makulera verifikation M1')
    expect(confirmSpy.mock.calls[0][0]).toContain('originalet bevaras')
    await screen.findByText('M2')  // vänta ut omladdningen
    expect(rpc).toHaveBeenCalledWith('makulera_verifikation', { p_ver_id: 'v1' })
    confirmSpy.mockRestore()
  })

  it('makulerad och motverifikation visar status-badge, raderar ALDRIG fysiskt', async () => {
    verData.current = [makulerad, motver]
    renderPage()
    await screen.findByText('M2')
    expect(screen.getByText('Makulerad')).toBeTruthy()
    expect(screen.getByText('Motverifikation')).toBeTruthy()
    expect(screen.queryByTitle('Makulera (motverifikation skapas)')).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('avbruten confirm anropar INTE makulera_verifikation', async () => {
    verData.current = [aktiv]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await screen.findByText('M1')
    fireEvent.click(screen.getByTitle('Makulera (motverifikation skapas)'))
    expect(rpc).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
