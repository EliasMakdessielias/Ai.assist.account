// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Kontoanalys from './Kontoanalys'
import { BRAND } from '../lib/brand'

const { nav, fromSpy } = vi.hoisted(() => ({ nav: vi.fn(), fromSpy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => { const actual = await importOriginal(); return { ...actual, useNavigate: () => nav } })
vi.mock('../hooks/useAuth', () => { const auth = { company: { id: 'c1' } }; return { useAuth: () => auth } })
vi.mock('../lib/supabase', () => {
  const ver = (id, ver_nr, serie, datum, besk) => ({ id, ver_nr, ver_serie: serie, datum, beskrivning: besk, company_id: 'c1' })
  const V1 = ver('v1', 'L5', 'L - Leverantörsfakturor', '2026-03-15', 'Lev.faktura AcountX Redovisningsbyrå AB 3419')
  const V2 = ver('v2', 'M33', 'U - Utbetalningar', '2026-01-12', 'Betalning till AcountX Redovisningsbyrå AB 3419')
  const DATA = {
    accounts: [
      { account_nr: '1510', name: 'Kundfordringar', opening_balance: 0, vat_code: '' },
      { account_nr: '1930', name: 'Företagskonto', opening_balance: 0, vat_code: '' },
      { account_nr: '2440', name: 'Leverantörsskulder', opening_balance: 0, vat_code: '' },
      { account_nr: '2641', name: 'Debiterad ingående moms', opening_balance: 0, vat_code: '48' },
      { account_nr: '6530', name: 'Redovisningstjänster', opening_balance: 0, vat_code: '' },
    ],
    verifikation_rows: [
      { account_nr: '2440', debet: 0, kredit: 3125, verifikationer: V1 },
      { account_nr: '2641', debet: 625, kredit: 0, verifikationer: V1 },
      { account_nr: '6530', debet: 2500, kredit: 0, verifikationer: V1 },
      { account_nr: '2440', debet: 3125, kredit: 0, verifikationer: V2 },
      { account_nr: '1930', debet: 0, kredit: 3125, verifikationer: V2 },
    ],
    fiscal_years: [{ id: 'fy1', year: 2026, status: 'active', start_date: '2026-01-01', end_date: '2026-12-31' }],
    supplier_invoices: [{ id: 'si1', invoice_nr: '3419', verifikation_id: 'v1', betalning_ver_id: 'v2' }],
    invoices: [],
    documents: [{ verifikation_id: 'v1' }],
  }
  const make = (table) => { const p = {}; const ret = () => p; p.select = ret; p.eq = ret; p.order = ret; p.not = ret; p.then = (r) => r({ data: DATA[table] ?? [], error: null }); return p }
  return { supabase: { from: (t) => { fromSpy(t); return make(t) } } }
})

const renderAt = (path = '/kontoanalys', props = {}) =>
  render(<MemoryRouter initialEntries={[path]}><Kontoanalys {...props} /></MemoryRouter>)
// Hela transaktionsraden är klickbar (ingen pilikon) – hitta <tr> via verifikationsnumret.
const rowByVer = name => screen.getAllByText(name)[0].closest('tr')

beforeEach(() => { cleanup(); vi.restoreAllMocks(); nav.mockReset(); fromSpy.mockClear() })
afterEach(() => cleanup())

describe('Kontoanalys – Öppna i eget fönster (popout)', () => {
  it('normal vy: knappen "Öppna i eget fönster" finns, ingen Stäng', () => {
    renderAt('/kontoanalys')
    expect(screen.getByTestId('kontoanalys-popout-open')).toBeTruthy()
    expect(screen.getByText('Öppna i eget fönster')).toBeTruthy()
    expect(screen.queryByTestId('kontoanalys-popout-close')).toBeNull()
  })

  it('klick bygger korrekt popout-URL med nuvarande filter (och rensar inte huvudvyn)', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({}))
    renderAt('/kontoanalys')
    fireEvent.change(screen.getByPlaceholderText(/Sök konto/), { target: { value: '1510' } })
    fireEvent.click(screen.getByTestId('kontoanalys-popout-open'))

    expect(open).toHaveBeenCalledTimes(1)
    const [url, name] = open.mock.calls[0]
    expect(url).toContain('/kontoanalys/popout')
    expect(url).toContain('account=1510')
    expect(name).toBe('bokpilot-kontoanalys-popout')        // eget fönster, inte modal
    expect(screen.getByPlaceholderText(/Sök konto/).value).toBe('1510')   // huvudvyn oförändrad
  })

  it('popout-vy: minimal header (BokPilot · Kontoanalys), Stäng finns, ingen "Öppna i eget fönster"', () => {
    renderAt('/kontoanalys/popout', { popout: true })
    expect(screen.getByText(BRAND.appName)).toBeTruthy()
    expect(screen.getByText('Kontoanalys')).toBeTruthy()
    expect(screen.getByTestId('kontoanalys-popout-close')).toBeTruthy()
    expect(screen.queryByTestId('kontoanalys-popout-open')).toBeNull()
  })

  it('query params seedar filtren i popout', () => {
    renderAt('/kontoanalys/popout?account=1510&search=hyra&hideCorrections=1&from=2026-02-01&to=2026-02-28', { popout: true })
    expect(screen.getByPlaceholderText(/Sök konto/).value).toBe('1510')
    expect(screen.getByPlaceholderText('Sök').value).toBe('hyra')
    expect(screen.getByLabelText(/Dölj korrigeringar/).checked).toBe(true)
    const dates = [...document.querySelectorAll('input[type="date"]')].map(i => i.value)
    expect(dates).toContain('2026-02-01')
    expect(dates).toContain('2026-02-28')
  })

  it('Stäng anropar window.close (påverkar inte huvudappen)', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    renderAt('/kontoanalys/popout', { popout: true })
    fireEvent.click(screen.getByTestId('kontoanalys-popout-close'))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('normal vy renderar Kontoanalys-rubriken (oförändrad layout, utan popout-header)', () => {
    renderAt('/kontoanalys')
    expect(screen.getByText('Kontoanalys')).toBeTruthy()
    expect(screen.queryByText(BRAND.appName)).toBeNull()   // ingen BokPilot-rubrik i normal vy
  })
})

describe('Kontoanalys – klickbart fakturanummer (normal vy, oförändrat)', () => {
  it('fakturanummer är klickbart → öppnar leverantörsfakturan men togglar INTE raden', async () => {
    renderAt('/kontoanalys')
    const btn = (await screen.findAllByRole('button', { name: '3419' }))[0]
    fireEvent.click(btn)
    expect(nav).toHaveBeenCalledWith('/leverantorsfakturor/si1')   // company-scopad relation, ej globalt nr
    expect(screen.queryByText('Relaterade verifikationer')).toBeNull()   // stopPropagation → raden expanderade inte
  })

  it('popout: fakturanummer är INTE klickbart (vanlig text)', async () => {
    renderAt('/kontoanalys/popout', { popout: true })
    await waitFor(() => expect(screen.getAllByText(/AcountX/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: '3419' })).toBeNull()
  })
})

describe('Kontoanalys – hela raden expanderar (ingen pilikon, ingen navigation)', () => {
  it('ingen chevron/pil i raden; klick på hela raden expanderar/collapsar; aria-expanded uppdateras', async () => {
    renderAt('/kontoanalys')
    await screen.findAllByText('L5')
    const row = rowByVer('L5')
    expect(row.tagName).toBe('TR')
    expect(row.querySelector('[class*="ti-chevron"]')).toBeNull()      // ingen pilikon kvar
    expect(row.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(row)                                                // klick var som helst på raden
    expect(await screen.findByText('Relaterade verifikationer')).toBeTruthy()
    expect(screen.getByText('48')).toBeTruthy()
    expect(rowByVer('L5').getAttribute('aria-expanded')).toBe('true')
    expect(nav).not.toHaveBeenCalled()                                 // ingen navigation

    fireEvent.click(rowByVer('L5'))                                     // klick igen → collapse
    await waitFor(() => expect(screen.queryByText('Relaterade verifikationer')).toBeNull())
    expect(nav).not.toHaveBeenCalled()
  })

  it('Enter expanderar och Space collapsar (keyboard-accessible)', async () => {
    renderAt('/kontoanalys')
    await screen.findAllByText('L5')
    fireEvent.keyDown(rowByVer('L5'), { key: 'Enter' })
    expect(await screen.findByText('Relaterade verifikationer')).toBeTruthy()
    expect(rowByVer('L5').getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(rowByVer('L5'), { key: ' ' })
    await waitFor(() => expect(screen.queryByText('Relaterade verifikationer')).toBeNull())
  })

  it('endast en verifikation expanderad åt gången', async () => {
    renderAt('/kontoanalys')
    await screen.findAllByText('L5')
    fireEvent.click(rowByVer('L5'))
    expect(await screen.findByText('48')).toBeTruthy()
    fireEvent.click(rowByVer('M33'))
    await waitFor(() => expect(screen.queryByText('48')).toBeNull())
  })

  it('expand använder redan laddad data – ingen extra fetch per verifikation', async () => {
    renderAt('/kontoanalys')
    await screen.findAllByText('L5')
    const before = fromSpy.mock.calls.filter(c => c[0] === 'verifikation_rows').length
    fireEvent.click(rowByVer('L5'))
    expect(await screen.findByText('Relaterade verifikationer')).toBeTruthy()
    const after = fromSpy.mock.calls.filter(c => c[0] === 'verifikation_rows').length
    expect(after).toBe(before)
  })

  it('klick på "Skapa pdf" i panelen togglar INTE raden', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    renderAt('/kontoanalys')
    await screen.findAllByText('L5')
    fireEvent.click(rowByVer('L5'))
    expect(await screen.findByText('Relaterade verifikationer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Skapa pdf/ }))
    expect(screen.getByText('Relaterade verifikationer')).toBeTruthy()   // fortfarande öppen
  })

  it('popout: hela raden expanderar men navigerar inte; Redigera (navigation) visas inte', async () => {
    renderAt('/kontoanalys/popout', { popout: true })
    await screen.findAllByText('L5')
    fireEvent.click(rowByVer('L5'))
    expect(await screen.findByText('Relaterade verifikationer')).toBeTruthy()
    expect(screen.getByText('48')).toBeTruthy()
    expect(nav).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Redigera/ })).toBeNull()
  })
})
