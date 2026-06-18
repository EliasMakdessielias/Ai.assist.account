// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Bokforing from './Bokforing'

// Stabil referens – annars triggar useEffect([company]) en oändlig render-loop.
// vi.hoisted: tillgängliga inne i mock-factories (som hissas över vanliga const).
const { mockCompany, rpc, del, verData, rowData } = vi.hoisted(() => ({
  mockCompany: { id: 'c1' },
  rpc: vi.fn(),
  del: vi.fn(),
  verData: { current: [] },
  rowData: { current: [] },
}))
vi.mock('../hooks/useAuth', () => {
  const auth = { company: mockCompany, user: { id: 'u1' } }
  return { useAuth: () => auth }
})
vi.mock('../lib/supabase', () => {
  // Tabellmedveten thenable-kedja: verifikationer -> verData, verifikation_rows -> rowData.
  const mk = (table, get) => {
    const q = {
      select: () => q, eq: () => q, order: () => q,
      delete: () => { del(table); return q },
      then: (res, rej) => Promise.resolve({ data: get(), error: null }).then(res, rej),
    }
    return q
  }
  return {
    supabase: {
      from: t => mk(t, () => (t === 'verifikation_rows' ? rowData.current : verData.current)),
      rpc: (...a) => rpc(...a),
    },
  }
})
// Stubba tunga barn – vi testar layouten, inte deras innehåll.
vi.mock('../components/Dagskassa', () => ({ default: () => <div data-testid="dagskassa-form" /> }))
vi.mock('../components/Kvitto', () => ({ default: () => <div data-testid="kvitto-form" /> }))
vi.mock('../components/StamAvKonto', () => ({ default: () => <div /> }))
vi.mock('../components/SokBelopp', () => ({ default: () => <div /> }))
vi.mock('../components/UnderlagPanel', () => ({ default: () => <div data-testid="underlag-panel">PANEL</div> }))
vi.mock('../components/BokforAIAssistent', () => ({ default: () => <div data-testid="ai-fab" /> }))

const renderPage = () => render(<MemoryRouter><Bokforing /></MemoryRouter>)
beforeEach(() => {
  cleanup(); localStorage.clear()
  verData.current = []
  rowData.current = []
  delete mockCompany.bokforing_last_tom
  rpc.mockReset().mockResolvedValue({ data: null, error: null })
  del.mockReset()
})

describe('Bokföring – dokumentpanel i registreringsflikar (krav 1)', () => {
  it('visar INTE panel på fliken Verifikationer', () => {
    renderPage()
    expect(screen.queryByTestId('underlag-panel')).toBeNull()
  })

  it('visar panel på "Registrera dagskassa"', () => {
    renderPage()
    fireEvent.click(screen.getByText('Registrera dagskassa'))
    expect(screen.getByTestId('dagskassa-form')).toBeTruthy()
    expect(screen.getByTestId('underlag-panel')).toBeTruthy()
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

describe('Bokföring – spårbart rättelseflöde (BFL)', () => {
  const aktiv = { id: 'v1', ver_nr: 'M1', ver_serie: 'M', datum: '2026-06-01', beskrivning: 'Aktiv post', total_debet: 100, total_kredit: 100, status: 'aktiv' }
  const rattad = { id: 'v2', ver_nr: 'M2', ver_serie: 'M', datum: '2026-06-02', beskrivning: 'Fel post', total_debet: 50, total_kredit: 50, status: 'rattad', rattad_av: 'v3' }
  const rattelse = { id: 'v3', ver_nr: 'R1', ver_serie: 'R - Rättelser', datum: '2026-06-02', beskrivning: 'Rättelse av verifikation M2', total_debet: 50, total_kredit: 50, status: 'rattelse', rattar: 'v2' }
  const ersattning = { id: 'v4', ver_nr: 'M3', ver_serie: 'M', datum: '2026-06-02', beskrivning: 'Korrekt post', total_debet: 50, total_kredit: 50, status: 'aktiv', ersatter: 'v2' }

  it('Rätta-knapp endast på aktiva; rättad/rättelse visar badges', async () => {
    verData.current = [aktiv, rattad, rattelse]
    renderPage()
    await screen.findByText('M1')
    // aktiv M1 + ersättningen saknas här -> bara aktiva har Rätta (M1)
    expect(screen.getAllByTitle('Rätta (spårbar rättelsekedja)')).toHaveLength(1)
    expect(screen.getByText('Rättad')).toBeTruthy()
    expect(screen.getByText('Rättelse')).toBeTruthy()
  })

  it('ersättningsverifikation visar "Ersätter {ver_nr}"-länk', async () => {
    verData.current = [rattad, ersattning]
    renderPage()
    await screen.findByText('M3')
    expect(screen.getByText('Ersätter M2')).toBeTruthy()
  })

  it('Rätta öppnar modal med originalrader; submit anropar ratta_verifikation med orsak+datum', async () => {
    verData.current = [aktiv]
    rowData.current = [
      { id: 'r1', account_nr: '1930', account_name: 'Företagskonto', debet: 100, kredit: 0, sort_order: 0 },
      { id: 'r2', account_nr: '2440', account_name: 'Leverantörsskulder', debet: 0, kredit: 100, sort_order: 1 },
    ]
    rpc.mockResolvedValue({ data: { ok: true, rattelse_id: 'rx', rattelse_nr: 'R1', datum: '2026-06-01', period_locked_original: false }, error: null })
    renderPage()
    await screen.findByText('M1')
    fireEvent.click(screen.getByTitle('Rätta (spårbar rättelsekedja)'))
    await screen.findByText('RÄTTA VERIFIKATION M1')
    await screen.findByText('Företagskonto')   // originalets rader som läsbar källa
    expect(screen.queryByText(/ligger i låst period/)).toBeNull()   // öppen period -> ingen låst-info
    fireEvent.change(screen.getByPlaceholderText('T.ex. fel konto användes'), { target: { value: 'Fel konto' } })
    fireEvent.click(screen.getByText('Skapa rättelse'))
    await screen.findByText('M1')
    expect(rpc).toHaveBeenCalledWith('ratta_verifikation', { p_ver_id: 'v1', p_orsak: 'Fel konto', p_datum: '2026-06-01' })
  })

  it('original i låst period: modal visar förklaring + föreslår första öppna datum', async () => {
    mockCompany.bokforing_last_tom = '2026-03'
    const lastVer = { ...aktiv, id: 'v9', ver_nr: 'M9', datum: '2026-02-15' }
    verData.current = [lastVer]
    renderPage()
    await screen.findByText('M9')
    fireEvent.click(screen.getByTitle('Rätta (spårbar rättelsekedja)'))
    await screen.findByText('RÄTTA VERIFIKATION M9')
    expect(screen.getByText(/Originalverifikationen ligger i låst period\. Rättelsen bokförs i öppen period\./)).toBeTruthy()
    expect(document.querySelector('input[type="date"]').value).toBe('2026-04-01')
  })

  it('valt datum i låst period blockeras med svensk förklaring (ingen RPC)', async () => {
    mockCompany.bokforing_last_tom = '2026-03'
    const lastVer = { ...aktiv, id: 'v9', ver_nr: 'M9', datum: '2026-02-15' }
    verData.current = [lastVer]
    renderPage()
    await screen.findByText('M9')
    fireEvent.click(screen.getByTitle('Rätta (spårbar rättelsekedja)'))
    await screen.findByText('RÄTTA VERIFIKATION M9')
    fireEvent.change(screen.getByPlaceholderText('T.ex. fel konto användes'), { target: { value: 'Fel' } })
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-02-20' } })
    expect(screen.getByText(/Datumet ligger i låst period/)).toBeTruthy()
    expect(screen.getByText('Skapa rättelse').disabled).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('Bokföring – ta bort senaste verifikationen i serien', () => {
  const m1 = { id: 'v1', ver_nr: 'M1', ver_serie: 'M', datum: '2026-06-01', beskrivning: 'Äldre', total_debet: 100, total_kredit: 100, status: 'aktiv' }
  const m2 = { id: 'v2', ver_nr: 'M2', ver_serie: 'M', datum: '2026-06-02', beskrivning: 'Senaste i M', total_debet: 50, total_kredit: 50, status: 'aktiv' }
  const a1 = { id: 'v3', ver_nr: 'A1', ver_serie: 'A', datum: '2026-06-03', beskrivning: 'Senaste i A', total_debet: 70, total_kredit: 70, status: 'aktiv' }

  it('endast SENASTE aktiva i varje serie har Ta bort-knapp', async () => {
    verData.current = [m1, m2, a1]
    renderPage()
    await screen.findByText('M1')
    // En per serie (M2 + A1) – aldrig på äldre M1.
    expect(screen.getAllByTitle('Ta bort (senaste i serien)')).toHaveLength(2)
    // Rätta/Makulera finns kvar på ALLA aktiva.
    expect(screen.getAllByTitle('Makulera (motverifikation skapas)')).toHaveLength(3)
  })

  it('senaste i serien som är makulerad/motverifikation kan INTE tas bort', async () => {
    verData.current = [
      m1,
      { ...m2, status: 'makulerad' },
      { id: 'v4', ver_nr: 'M3', ver_serie: 'M', datum: '2026-06-02', beskrivning: 'Motver', total_debet: 50, total_kredit: 50, status: 'motverifikation' },
    ]
    renderPage()
    await screen.findByText('M1')
    expect(screen.queryByTitle('Ta bort (senaste i serien)')).toBeNull()   // M3 är senaste men motverifikation
  })

  it('Ta bort + bekräfta raderar verifikationen (loggas i behandlingshistoriken av DB-triggern)', async () => {
    verData.current = [m1, m2]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await screen.findByText('M2')
    fireEvent.click(screen.getByTitle('Ta bort (senaste i serien)'))
    expect(confirmSpy.mock.calls[0][0]).toContain('Ta bort verifikation M2')
    expect(confirmSpy.mock.calls[0][0]).toContain('loggas i behandlingshistoriken')
    await screen.findByText('M1')   // vänta ut omladdningen
    expect(del).toHaveBeenCalledWith('verifikationer')
    confirmSpy.mockRestore()
  })

  it('avbruten confirm raderar INTE', async () => {
    verData.current = [m1, m2]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await screen.findByText('M2')
    fireEvent.click(screen.getByTitle('Ta bort (senaste i serien)'))
    expect(del).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
