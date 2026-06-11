// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Kontoanalys from './Kontoanalys'

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ company: { id: 'c1', bokforing_last_tom: '2024-12-31' } }) }))
vi.mock('../lib/supabase', () => {
  const ver = (id, nr, datum) => ({ id, ver_nr: nr, ver_serie: 'M - Manuella verifikationer', datum, beskrivning: nr, company_id: 'c1' })
  const A = ver('a', 'A1', '2026-03-10'), B = ver('b', 'B1', '2026-04-15')
  const DATA = {
    accounts: [
      { account_nr: '1220', name: 'Inventarier', opening_balance: 0, vat_code: '' },     // noll → dolt utan "Visa alla"
      { account_nr: '1510', name: 'Kundfordringar', opening_balance: 0, vat_code: '' },   // noll
      { account_nr: '1930', name: 'Företagskonto', opening_balance: 0, vat_code: '' },
      { account_nr: '2081', name: 'Aktiekapital', opening_balance: 0, vat_code: '' },
      { account_nr: '2440', name: 'Leverantörsskulder', opening_balance: 0, vat_code: '' }, // noll
      { account_nr: '5010', name: 'Lokalhyra', opening_balance: 0, vat_code: '' },          // kostnad (ej balanskonto)
    ],
    verifikation_rows: [
      { account_nr: '1930', debet: 100000, kredit: 0, verifikationer: A },
      { account_nr: '2081', debet: 0, kredit: 100000, verifikationer: A },
      { account_nr: '5010', debet: 5000, kredit: 0, verifikationer: B },
      { account_nr: '1930', debet: 0, kredit: 5000, verifikationer: B },
    ],
    fiscal_years: [{ id: 'fy1', year: 2026, status: 'active', start_date: '2026-01-01', end_date: '2026-12-31' }],
    supplier_invoices: [], invoices: [], documents: [],
  }
  const make = (t) => { const p = {}; const ret = () => p; p.select = ret; p.eq = ret; p.order = ret; p.not = ret; p.then = (r) => r({ data: DATA[t] ?? [], error: null }); return p }
  return { supabase: { from: (t) => make(t) } }
})

const renderBalans = (path = '/kontoanalys?tab=balans', props = {}) =>
  render(<MemoryRouter initialEntries={[path]}><Kontoanalys {...props} /></MemoryRouter>)
beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('Kontoanalys – Balansräkning', () => {
  it('visar Tillgångar och Eget kapital och skulder med rätt konton', async () => {
    renderBalans()
    expect(await screen.findByText('Tillgångar')).toBeTruthy()
    expect(screen.getByText('Eget kapital och skulder')).toBeTruthy()
    expect(screen.getByText(/1930 Företagskonto/)).toBeTruthy()   // 1xxx = tillgång
    expect(screen.getByText(/2081 Aktiekapital/)).toBeTruthy()    // 2xxx = eget kapital
  })

  it('kostnadskonto (5xxx) visas inte som balanskonto; Årets resultat fångar resultatet', async () => {
    renderBalans()
    await screen.findByText('Tillgångar')
    expect(screen.queryByText(/5010 Lokalhyra/)).toBeNull()
    expect(screen.getByText('Årets resultat')).toBeTruthy()
  })

  it('Visa alla konton visar/döljer nollkonton', async () => {
    renderBalans()
    await screen.findByText('Tillgångar')
    expect(screen.queryByText(/1220 Inventarier/)).toBeNull()        // noll → dolt
    fireEvent.click(screen.getByLabelText(/Visa alla konton/))
    expect(await screen.findByText(/1220 Inventarier/)).toBeTruthy() // nu synligt
  })

  it('grupp kan fällas ihop (döljer konton, behåller summa)', async () => {
    renderBalans()
    await screen.findByText('Tillgångar')
    expect(screen.getByText(/1930 Företagskonto/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Omsättningstillgångar/ }))
    await waitFor(() => expect(screen.queryByText(/1930 Företagskonto/)).toBeNull())
  })

  it('klick på konto öppnar Huvudbok filtrerat på samma konto (ingen route-navigation)', async () => {
    renderBalans()
    await screen.findByText('Tillgångar')
    fireEvent.click(screen.getByText(/1930 Företagskonto/))
    await waitFor(() => expect(screen.getByPlaceholderText(/Sök konto/).value).toBe('1930'))
  })

  it('kontrollsumma visas och balanserar (ingen differensvarning)', async () => {
    renderBalans()
    await screen.findByText('Tillgångar')
    expect(screen.getAllByText('Summa tillgångar').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Summa eget kapital och skulder').length).toBeGreaterThan(0)
    expect(screen.getByText('Differens')).toBeTruthy()
    expect(screen.queryByText(/balanserar inte/)).toBeNull()   // balanserad data
  })

  it('visar "Bokföring låst t.o.m." när data finns, och Skriv ut-knapp', async () => {
    renderBalans()
    await screen.findByText('Tillgångar')
    expect(screen.getByText(/Bokföring låst t\.o\.m\./)).toBeTruthy()
    expect(screen.getByText('2024-12-31')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Skriv ut/ })).toBeTruthy()
  })

  it('popout: Balansräkning renderas (extern vy opåverkad)', async () => {
    renderBalans('/kontoanalys/popout?tab=balans', { popout: true })
    expect(await screen.findByText('Tillgångar')).toBeTruthy()
    expect(screen.getByText(/1930 Företagskonto/)).toBeTruthy()
  })
})
