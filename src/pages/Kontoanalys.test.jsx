// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Kontoanalys from './Kontoanalys'
import { BRAND } from '../lib/brand'

vi.mock('../hooks/useAuth', () => { const auth = { company: { id: 'c1' } }; return { useAuth: () => auth } })
vi.mock('../lib/supabase', () => {
  const DATA = {
    accounts: [{ account_nr: '1510', name: 'Kundfordringar', opening_balance: 0 }],
    verifikation_rows: [],
    fiscal_years: [{ id: 'fy1', year: 2026, status: 'active', start_date: '2026-01-01', end_date: '2026-12-31' }],
  }
  const make = (table) => { const p = {}; const ret = () => p; p.select = ret; p.eq = ret; p.order = ret; p.then = (r) => r({ data: DATA[table] ?? [], error: null }); return p }
  return { supabase: { from: (t) => make(t) } }
})

const renderAt = (path = '/kontoanalys', props = {}) =>
  render(<MemoryRouter initialEntries={[path]}><Kontoanalys {...props} /></MemoryRouter>)

beforeEach(() => { cleanup(); vi.restoreAllMocks() })
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
