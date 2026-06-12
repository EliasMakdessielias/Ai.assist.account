// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import StamAvKonto from './StamAvKonto'

const { upd, data } = vi.hoisted(() => ({
  upd: vi.fn(),
  data: { accounts: [], rows: [], btx: [] },
}))
vi.mock('../hooks/useAuth', () => {
  const auth = { company: { id: 'c1' } }
  return { useAuth: () => auth }
})
vi.mock('../lib/supabase', () => {
  const mk = (table, get) => {
    const q = {
      select: () => q, eq: () => q, like: () => q, order: () => q, in: () => q,
      update: vals => { upd(table, vals); return q },
      then: (res, rej) => Promise.resolve({ data: get(), error: null }).then(res, rej),
    }
    return q
  }
  return {
    supabase: {
      from: t => mk(t, () => (t === 'accounts' ? data.accounts : t === 'verifikation_rows' ? data.rows : data.btx)),
    },
  }
})

const ver = (ver_nr, datum, besk) => ({ company_id: 'c1', datum, ver_nr, beskrivning: besk })

beforeEach(() => {
  cleanup()
  upd.mockReset()
  data.accounts = [{ account_nr: '1930', name: 'Företagskonto' }]
  data.rows = [
    { id: 'k1', debet: 0, kredit: 8213, avstamd: false, verifikationer: ver('U1', '2026-01-14', 'Betalning Tele2') },
    { id: 'k2', debet: 0, kredit: 5510, avstamd: false, verifikationer: ver('U2', '2026-01-22', 'Betalning HEDIN') },
  ]
  data.btx = [
    { id: 't1', datum: '2026-01-14', text: 'TELE2 SV AB', amount: -8213, avstamd: false },
    { id: 't2', datum: '2026-01-22', text: 'DNB BANK ASA', amount: -5510, avstamd: false },
    { id: 't3', datum: '2026-01-02', text: 'BG 745-2287', amount: 2500, avstamd: false },
  ]
})

describe('Stäm av konto – matcha (granska) och spara (acceptera)', () => {
  it('Matcha bygger UNIK 1:1-matchning som granskningsläge – INGET skrivs till databasen', async () => {
    render(<StamAvKonto />)
    await screen.findByText('Betalning Tele2')
    fireEvent.click(screen.getByRole('button', { name: /Matcha transaktioner/ }))
    // Granskningsläge: parnummer på BÅDA sidor, Spara/Avbryt synliga, ingen DB-skrivning.
    await screen.findByText(/2 unika matchningar/)
    expect(screen.getAllByTitle('Matchning 1')).toHaveLength(2)   // P1 på bok + bank
    expect(screen.getAllByTitle('Matchning 2')).toHaveLength(2)   // P2 på bok + bank
    expect(screen.getByRole('button', { name: 'Spara' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeTruthy()
    expect(upd).not.toHaveBeenCalled()
  })

  it('Spara = användarens acceptans → avstämningen skrivs för båda sidorna', async () => {
    render(<StamAvKonto />)
    await screen.findByText('Betalning Tele2')
    fireEvent.click(screen.getByRole('button', { name: /Matcha transaktioner/ }))
    await screen.findByText(/2 unika matchningar/)
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }))
    await screen.findByRole('button', { name: /Matcha transaktioner/ })   // tillbaka i normalläge efter omladdning
    expect(upd).toHaveBeenCalledWith('verifikation_rows', { avstamd: true })
    expect(upd).toHaveBeenCalledWith('bank_transactions', { avstamd: true })
  })

  it('Avbryt lämnar granskningsläget utan att något skrivs', async () => {
    render(<StamAvKonto />)
    await screen.findByText('Betalning Tele2')
    fireEvent.click(screen.getByRole('button', { name: /Matcha transaktioner/ }))
    await screen.findByText(/2 unika matchningar/)
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(screen.queryByText(/unika matchningar/)).toBeNull()
    expect(screen.getByRole('button', { name: /Matcha transaktioner/ })).toBeTruthy()
    expect(upd).not.toHaveBeenCalled()
  })

  it('post utan motsvarighet (t3, 2500) får ALDRIG parnummer', async () => {
    render(<StamAvKonto />)
    await screen.findByText('Betalning Tele2')
    fireEvent.click(screen.getByRole('button', { name: /Matcha transaktioner/ }))
    await screen.findByText(/2 unika matchningar/)
    const t3Rad = screen.getByText('BG 745-2287').closest('tr')
    expect(t3Rad.querySelector('[title^="Matchning"]')).toBeNull()
  })
})
