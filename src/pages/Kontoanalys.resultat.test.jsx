// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Kontoanalys from './Kontoanalys'

const { nav } = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', async (orig) => { const a = await orig(); return { ...a, useNavigate: () => nav } })
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ company: { id: 'c1', bokforing_last_tom: '2024-12-31' } }) }))
vi.mock('../lib/supabase', () => {
  const ver = (id, nr, datum, besk) => ({ id, ver_nr: nr, ver_serie: 'L - Leverantörsfakturor', datum, beskrivning: besk, company_id: 'c1' })
  const A = ver('a', 'A1', '2026-03-10', 'Försäljning')
  const B = ver('b', 'L50', '2026-04-15', 'Leverantörsfaktura från X 3419')
  const C = ver('c', 'C1', '2026-05-01', 'Hyra')
  const DATA = {
    accounts: [
      { account_nr: '3051', name: 'Försäljning varor 25%', opening_balance: 0, vat_code: '' },
      { account_nr: '4000', name: 'Inköp av handelsvaror', opening_balance: 0, vat_code: '' },
      { account_nr: '5010', name: 'Lokalhyra', opening_balance: 0, vat_code: '' },
      { account_nr: '6000', name: 'Övriga externa kostnader', opening_balance: 0, vat_code: '' }, // noll
      { account_nr: '1510', name: 'Kundfordringar', opening_balance: 0, vat_code: '' },            // balanskonto
      { account_nr: '1930', name: 'Företagskonto', opening_balance: 0, vat_code: '' },
      { account_nr: '2440', name: 'Leverantörsskulder', opening_balance: 0, vat_code: '' },
    ],
    verifikation_rows: [
      { account_nr: '3051', debet: 0, kredit: 1000000, verifikationer: A },
      { account_nr: '1930', debet: 1000000, kredit: 0, verifikationer: A },
      { account_nr: '4000', debet: 300000, kredit: 0, verifikationer: B },
      { account_nr: '2440', debet: 0, kredit: 300000, verifikationer: B },
      { account_nr: '5010', debet: 128772.50, kredit: 0, verifikationer: C },
      { account_nr: '1930', debet: 0, kredit: 128772.50, verifikationer: C },
    ],
    fiscal_years: [{ id: 'fy1', year: 2026, status: 'active', start_date: '2026-01-01', end_date: '2026-12-31' }],
    supplier_invoices: [{ id: 'si1', invoice_nr: '3419', verifikation_id: 'b', betalning_ver_id: null }],
    invoices: [], documents: [],
  }
  const make = (t) => { const p = {}; const r = () => p; p.select = r; p.eq = r; p.order = r; p.not = r; p.then = (res) => res({ data: DATA[t] ?? [], error: null }); return p }
  return { supabase: { from: (t) => make(t) } }
})

const renderRes = (path = '/kontoanalys?tab=resultat', props = {}) =>
  render(<MemoryRouter initialEntries={[path]}><Kontoanalys {...props} /></MemoryRouter>)
const rowByText = re => screen.getByText(re).closest('tr')
beforeEach(() => { cleanup(); nav.mockReset() })
afterEach(() => cleanup())

describe('Kontoanalys – Resultaträkning', () => {
  it('visar Rörelsens intäkter och kostnader; 3xxx intäkt, 4/5xxx kostnad; 1xxx/2xxx visas inte', async () => {
    renderRes()
    expect(await screen.findByText('Rörelsens intäkter')).toBeTruthy()
    expect(screen.getByText('Rörelsens kostnader')).toBeTruthy()
    expect(screen.getByText(/3051 Försäljning/)).toBeTruthy()
    expect(screen.getByText(/4000 Inköp av handelsvaror/)).toBeTruthy()
    expect(screen.getByText(/5010 Lokalhyra/)).toBeTruthy()
    expect(screen.queryByText(/1510 Kundfordringar/)).toBeNull()
    expect(screen.queryByText(/2440 Leverantörsskulder/)).toBeNull()   // balanskonto, ej i resultat
  })

  it('har kolumnerna Perioden och Ackumulerat + Beräknat resultat', async () => {
    renderRes()
    await screen.findByText('Rörelsens intäkter')
    expect(screen.getByText('Perioden')).toBeTruthy()
    expect(screen.getByText('Ackumulerat')).toBeTruthy()
    expect(screen.getByText('Beräknat resultat för perioden')).toBeTruthy()
  })

  it('Visa alla konton visar/döljer nollkonton', async () => {
    renderRes()
    await screen.findByText('Rörelsens intäkter')
    expect(screen.queryByText(/6000 Övriga externa kostnader/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Visa alla konton/))
    expect(await screen.findByText(/6000 Övriga externa kostnader/)).toBeTruthy()
  })

  it('grupp kan fällas ihop (döljer konton)', async () => {
    renderRes()
    await screen.findByText('Rörelsens intäkter')
    expect(screen.getByText(/4000 Inköp av handelsvaror/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Råvaror och förnödenheter/ }))
    await waitFor(() => expect(screen.queryByText(/4000 Inköp av handelsvaror/)).toBeNull())
  })

  it('konto expanderar → transaktioner; verifikationsrad expanderar VerDetail inline (ingen navigation)', async () => {
    renderRes()
    await screen.findByText('Rörelsens intäkter')
    // expandera kontot 4000 → visar transaktionen L50
    fireEvent.click(rowByText(/4000 Inköp av handelsvaror/))
    expect(await screen.findByText('L50')).toBeTruthy()
    // expandera transaktionsraden → VerDetail visar konteringen (2440 Leverantörsskulder)
    fireEvent.click(screen.getByText('L50').closest('tr'))
    expect(await screen.findByText(/Leverantörsskulder/)).toBeTruthy()
    expect(nav).not.toHaveBeenCalled()   // BEVIS: ingen navigation vid expand
  })

  it('fakturanummer i transaktionen länkar i normal vy (utan att toggla raden)', async () => {
    renderRes()
    await screen.findByText('Rörelsens intäkter')
    fireEvent.click(rowByText(/4000 Inköp av handelsvaror/))
    const fakt = await screen.findByRole('button', { name: '3419' })
    fireEvent.click(fakt)
    expect(nav).toHaveBeenCalledWith('/leverantorsfakturor/si1')
  })

  it('Skriv ut-knapp finns', async () => {
    renderRes()
    await screen.findByText('Rörelsens intäkter')
    expect(screen.getByRole('button', { name: /Skriv ut/ })).toBeTruthy()
  })

  it('popout: Resultaträkning renderas, konto-expand fungerar, fakturanr ej klickbart, ingen navigation', async () => {
    renderRes('/kontoanalys/popout?tab=resultat', { popout: true })
    expect(await screen.findByText('Rörelsens intäkter')).toBeTruthy()
    fireEvent.click(rowByText(/4000 Inköp av handelsvaror/))
    expect(await screen.findByText('L50')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '3419' })).toBeNull()   // fakturanr ej klickbart i popout
    fireEvent.click(screen.getByText('L50').closest('tr'))
    expect(await screen.findByText(/Leverantörsskulder/)).toBeTruthy()
    expect(nav).not.toHaveBeenCalled()
  })
})
