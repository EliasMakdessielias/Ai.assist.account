// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import KundEditor from './KundEditor'

const { ins, upd, data } = vi.hoisted(() => ({
  ins: vi.fn(),
  upd: vi.fn(),
  data: { accounts: [] },
}))
vi.mock('../hooks/useAuth', () => {
  const auth = { company: { id: 'c1' } }
  return { useAuth: () => auth }
})
vi.mock('../lib/supabase', () => {
  const mk = table => {
    const q = {
      select: () => q, eq: () => q, like: () => q, order: () => q,
      insert: vals => { ins(table, vals); return q },
      update: vals => { upd(table, vals); return q },
      then: (res, rej) => Promise.resolve({ data: table === 'accounts' ? data.accounts : null, error: null }).then(res, rej),
    }
    return q
  }
  return { supabase: { from: t => mk(t) } }
})

beforeEach(() => {
  cleanup()
  ins.mockReset(); upd.mockReset()
  data.accounts = [{ account_nr: '3001', name: 'Försäljning' }, { account_nr: '3041', name: 'Försäljning tjänster 25 %' }]
})

describe('KundEditor – skapa ny kund (Fortnox-mönstret)', () => {
  it('föreslår nästa kundnummer, har två flikar och sparar normaliserad payload', async () => {
    const onSaved = vi.fn()
    render(<KundEditor kund={null} forslagsNr={2} onClose={() => {}} onSaved={onSaved} onDelete={() => {}} />)
    expect(screen.getByText('KUND 2 – SKAPA NY')).toBeTruthy()

    // Grunduppgifter
    const namn = screen.getByText('Namn *').closest('div').querySelector('input')
    fireEvent.change(namn, { target: { value: '  Acme AB  ' } })

    // Faktureringsuppgifter
    fireEvent.click(screen.getByText('Faktureringsuppgifter'))
    await screen.findByText('Betal- och leveransvillkor')
    const villkor = screen.getByText('Betalningsvillkor (dagar)').closest('div').querySelector('input')
    fireEvent.change(villkor, { target: { value: '14' } })
    const konto = screen.getByText('Försäljningskonto').closest('div').querySelector('input')
    fireEvent.change(konto, { target: { value: '3041' } })

    fireEvent.click(screen.getByText('Spara'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(ins).toHaveBeenCalledTimes(1)
    const [table, payload] = ins.mock.calls[0]
    expect(table).toBe('customers')
    expect(payload).toMatchObject({
      company_id: 'c1', kund_nr: 2, name: 'Acme AB', payment_terms: 14,
      forsaljningskonto: '3041', kundtyp: 'foretag', is_active: true, valuta: 'SEK',
    })
  })

  it('kundnamn krävs – inget sparas utan namn', async () => {
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByText('Spara'))
    await waitFor(() => expect(ins).not.toHaveBeenCalled())
  })

  it('befintlig kund uppdateras (inte insert) och Radera är aktiv', async () => {
    const onSaved = vi.fn()
    const kund = { id: 'k1', kund_nr: 5, name: 'Gammal AB', kundtyp: 'foretag', is_active: true, payment_terms: 30 }
    render(<KundEditor kund={kund} forslagsNr={9} onClose={() => {}} onSaved={onSaved} onDelete={() => {}} />)
    expect(screen.getByText('KUND 5 – GAMMAL AB')).toBeTruthy()
    expect(screen.getByText('Radera').disabled).toBe(false)
    fireEvent.click(screen.getByText('Spara'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(upd).toHaveBeenCalledTimes(1)
    expect(ins).not.toHaveBeenCalled()
  })

  it('ny kund: Radera är inaktiverad', () => {
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('Radera').disabled).toBe(true)
  })
})
