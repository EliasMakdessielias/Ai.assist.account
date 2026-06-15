// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import KundEditor from './KundEditor'

const { ins, upd, invoke, data } = vi.hoisted(() => ({
  ins: vi.fn(), upd: vi.fn(), invoke: vi.fn(),
  data: { accounts: [], dup: null },
}))
vi.mock('../hooks/useAuth', () => {
  const auth = { company: { id: 'c1' }, user: { id: 'u1' } }
  return { useAuth: () => auth }
})
vi.mock('../lib/supabase', () => {
  const mk = table => {
    const q = {
      select: () => q, eq: () => q, like: () => q, order: () => q, limit: () => q,
      insert: v => { ins(table, v); return q },
      update: v => { upd(table, v); return q },
      maybeSingle: async () => ({ data: table === 'customers' ? data.dup : null, error: null }),
      then: (res, rej) => Promise.resolve({ data: table === 'accounts' ? data.accounts : null, error: null }).then(res, rej),
    }
    return q
  }
  return { supabase: { from: t => mk(t), functions: { invoke: (...a) => invoke(...a) } } }
})

// Syntetisk företagsmodell (mockdata – endast i test).
const COMPANY = {
  organizationNumber: '5560360793', legalName: 'Nordic Example AB', displayName: 'Nordic Example AB',
  status: 'Aktivt', source: 'Allabolag', sourceRetrievedAt: '2026-06-12T10:00:00Z',
  address: { street: 'Besöksgatan 1', postalCode: '11122', city: 'Stockholm', country: 'Sverige', careOf: '' },
  postalAddress: { street: 'Box 100', postalCode: '10010', city: 'Stockholm', country: 'Sverige', careOf: '' },
  contact: { phone: '08-1234567', mobile: '', email: 'info@nordic.se', website: 'nordic.se' },
  taxRegistration: { vatNumber: 'SE556036079301' },
  industries: [{ code: '62010', description: 'Datakonsultverksamhet' }],
}
const okInvoke = () => invoke.mockResolvedValue({ data: { ok: true, company: COMPANY, result: {}, apiVersion: 'v1' }, error: null })
// Edge svarar 400 not_configured (UC-secrets saknas) – som supabase-functions FunctionsHttpError.
const notConfiguredInvoke = () => invoke.mockResolvedValue({
  data: null,
  error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Anslutningen till Allabolag är inte konfigurerad. Kontrollera API-inställningarna.', code: 'not_configured' }) } },
})

const orgInput = () => screen.getByText('Org-/Personnummer').closest('div').querySelector('input')
const fieldInput = label => screen.getByText(label).closest('div').querySelector('input')

beforeEach(() => {
  cleanup(); ins.mockReset(); upd.mockReset(); invoke.mockReset()
  data.accounts = [{ account_nr: '3001', name: 'Försäljning' }, { account_nr: '3041', name: 'Försäljning tjänster' }]
  data.dup = null
})

describe('KundEditor – grundflöde', () => {
  it('föreslår nästa kundnummer, har två flikar och sparar normaliserad payload', async () => {
    const onSaved = vi.fn()
    render(<KundEditor kund={null} forslagsNr={2} onClose={() => {}} onSaved={onSaved} onDelete={() => {}} />)
    expect(screen.getByText('KUND 2 – SKAPA NY')).toBeTruthy()
    fireEvent.change(fieldInput('Namn *'), { target: { value: '  Acme AB  ' } })
    fireEvent.click(screen.getByText('Faktureringsuppgifter'))
    await screen.findByText('Betal- och leveransvillkor')
    const betal = screen.getByText('Betalningsvillkor').closest('div').querySelector('select')
    fireEvent.change(betal, { target: { value: '14' } })
    fireEvent.click(screen.getByText('Spara'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [table, payload] = ins.mock.calls[0]
    expect(table).toBe('customers')
    expect(payload).toMatchObject({ company_id: 'c1', kund_nr: 2, name: 'Acme AB', payment_terms: 14, kundtyp: 'foretag' })
  })

  it('Faktureringsuppgifter: visar alla sektioner och sparar inställningar i faktura_installningar', async () => {
    const onSaved = vi.fn()
    render(<KundEditor kund={null} forslagsNr={3} onClose={() => {}} onSaved={onSaved} onDelete={() => {}} />)
    fireEvent.change(fieldInput('Namn *'), { target: { value: 'Bolag AB' } })
    fireEvent.click(screen.getByText('Faktureringsuppgifter'))
    // De fyra kolumnerna + de tre hopfällbara sektionerna finns (exakt som bilden).
    await screen.findByText('Betal- och leveransvillkor')
    expect(screen.getByText('Fakturering')).toBeTruthy()
    expect(screen.getByText('Referenser')).toBeTruthy()
    expect(screen.getByText('Bokföring')).toBeTruthy()
    expect(screen.getByText('E-dokument')).toBeTruthy()
    expect(screen.getByText('Fakturatext')).toBeTruthy()
    expect(screen.getByText('Förvalda mallar')).toBeTruthy()
    // Fyll ett JSONB-fält (Fakturarabatt) och ett dropdown-fält (Momstyp).
    fireEvent.change(screen.getByText('Fakturarabatt (%)').closest('div').querySelector('input'), { target: { value: '10' } })
    fireEvent.change(screen.getByText('Momstyp').closest('div').querySelector('select'), { target: { value: 'EU' } })
    fireEvent.click(screen.getByText('Spara'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [, payload] = ins.mock.calls[0]
    expect(payload.faktura_installningar).toMatchObject({ fakturarabatt: '10', momstyp: 'EU' })
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

describe('KundEditor – automatisk hämtning från Allabolag', () => {
  it('giltigt org-nr (Luhn) auto-hämtar efter debounce och fyller fälten + badge + statusrad', async () => {
    okInvoke()
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} />)
    fireEvent.change(orgInput(), { target: { value: '556036-0793' } })
    await waitFor(() => expect(invoke).toHaveBeenCalled(), { timeout: 2000 })
    expect(invoke.mock.calls[0][0]).toBe('hamta-foretag')
    expect(invoke.mock.calls[0][1].body).toMatchObject({ org_nr: '556036-0793' })
    await waitFor(() => expect(fieldInput('Namn *').value).toBe('Nordic Example AB'))
    expect(fieldInput('Fakturaadress').value).toBe('Box 100')
    expect(fieldInput('Branschkod (SNI)').value).toBe('62010 Datakonsultverksamhet')   // SNI ifylld
    expect(screen.getByText('Aktivt')).toBeTruthy()                 // statusrad
    expect(screen.getAllByText('Hämtad från Allabolag').length).toBeGreaterThan(0)   // badge
  })

  it('ogiltig kontrollsiffra hämtar ALDRIG', async () => {
    okInvoke()
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} />)
    fireEvent.change(orgInput(), { target: { value: '556036-0790' } })   // fel Luhn
    await new Promise(r => setTimeout(r, 800))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('manuell ändring efter hämtning tar bort badgen för fältet', async () => {
    okInvoke()
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} />)
    fireEvent.change(orgInput(), { target: { value: '5560360793' } })
    await waitFor(() => expect(fieldInput('Namn *').value).toBe('Nordic Example AB'), { timeout: 2000 })
    const badgesFore = screen.getAllByText('Hämtad från Allabolag').length
    fireEvent.change(fieldInput('Namn *'), { target: { value: 'Eget namn AB' } })
    await waitFor(() => expect(screen.getAllByText('Hämtad från Allabolag').length).toBe(badgesFore - 1))
  })

  it('ej konfigurerat API: degraderar tyst (lugn inline-text, döljer Uppdatera-knappen)', async () => {
    notConfiguredInvoke()
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} />)
    fireEvent.change(orgInput(), { target: { value: '5560360793' } })
    await screen.findByText('Automatisk företagshämtning är inte aktiverad – fyll i uppgifterna manuellt.', {}, { timeout: 2000 })
    expect(screen.queryByText('Uppdatera företagsuppgifter')).toBeNull()
    expect(fieldInput('Namn *').value).toBe('')        // inget autofyllt
  })

  it('dubblett: varnar och blockerar Spara, erbjuder att öppna befintlig kund', async () => {
    okInvoke()
    data.dup = { id: 'kx', kund_nr: 5, name: 'Befintlig AB' }
    const onOpenExisting = vi.fn()
    render(<KundEditor kund={null} forslagsNr={1} onClose={() => {}} onSaved={() => {}} onDelete={() => {}} onOpenExisting={onOpenExisting} />)
    fireEvent.change(orgInput(), { target: { value: '5560360793' } })
    await screen.findByText('Det finns redan en kund med detta organisationsnummer.', {}, { timeout: 2000 })
    expect(screen.getByText('Spara').disabled).toBe(true)
    fireEvent.click(screen.getByText(/Öppna kund 5/))
    expect(onOpenExisting).toHaveBeenCalledWith(data.dup)
  })
})
