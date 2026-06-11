// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NyLeverantorsfaktura from './NyLeverantorsfaktura'

// OCR-resultat: (1) kreditnota (negativa belopp + omvänd kontering); (2) vanlig faktura där
// OCR DUBBELRÄKNAR kostnaden (delsumma 365 + enskild rad 16 som redan ingår) – Spiris-fallet.
const { CREDIT_RESULT, NORMAL_DOUBLECOUNT } = vi.hoisted(() => ({
  CREDIT_RESULT: {
    invoice_type: 'credit', is_credit_invoice: true, credit_evidence: 'Kreditnota',
    beskrivning: 'Kreditnota konsultarvode', leverantor: 'Konsult AB', org_nr: '556677-8899',
    belopp_inkl_moms: -1458, moms_belopp: -291.5,
    konteringsrader: [
      { konto: '6550', benamning: 'Konsultarvoden', debet: 0, kredit: 1166 },
      { konto: '2641', benamning: 'Debiterad ingående moms', debet: 0, kredit: 291.5 },
      { konto: '2440', benamning: 'Leverantörsskulder', debet: 1458, kredit: 0 },
    ],
  },
  NORMAL_DOUBLECOUNT: {
    invoice_type: 'debit', is_credit_invoice: false, beskrivning: 'Faktura Spiris',
    belopp_inkl_moms: 456, moms_belopp: 91.25,
    konteringsrader: [
      { konto: '6592', benamning: 'Bokningstjänst', debet: 365, kredit: 0 },
      { konto: '6592', benamning: 'Bokningstjänst', debet: 16, kredit: 0 },
      { konto: '2641', benamning: 'Debiterad ingående moms', debet: 91.25, kredit: 0 },
      { konto: '2440', benamning: 'Leverantörsskulder', debet: 0, kredit: 456 },
    ],
  },
}))

vi.mock('../hooks/useAuth', () => {
  const auth = { company: { id: 'c1' }, user: { id: 'u1' } }
  return { useAuth: () => auth }
})

vi.mock('../lib/supabase', () => {
  const DATA = {
    accounts: [
      { account_nr: '2440', name: 'Leverantörsskulder', is_active: true, is_locked: true },
      { account_nr: '2640', name: 'Ingående moms', is_active: true, is_locked: true },
      { account_nr: '2641', name: 'Debiterad ingående moms', is_active: true, is_locked: true },
      { account_nr: '3740', name: 'Öres- och kronutjämning', is_active: true, is_locked: false },
      { account_nr: '4000', name: 'Inköp', is_active: true, is_locked: false },
      { account_nr: '6550', name: 'Konsultarvoden', is_active: true, is_locked: false },
      { account_nr: '6592', name: 'Bokningstjänst', is_active: true, is_locked: false },
    ],
    suppliers: [{ id: 's1', name: 'Konsult AB', org_nr: '556677-8899', bankgiro: '', default_motkonto: '6550' }],
    supplier_invoices: [],
  }
  const make = (table) => {
    const p = {}
    const ret = () => p
    p.select = ret; p.eq = ret; p.order = ret; p.in = ret; p.update = ret; p.insert = ret; p.single = ret; p.maybeSingle = ret; p.not = ret; p.limit = ret
    p.then = (resolve) => resolve({ data: DATA[table] ?? [], error: null })
    return p
  }
  return { supabase: { from: (t) => make(t), rpc: async () => ({ data: null, error: null }) } }
})

// Stubba tunga barn. UnderlagPanel exponerar en knapp som matar OCR-resultatet via onTolkat.
vi.mock('../components/UnderlagPanel', () => ({ default: ({ onTolkat }) => (<>
  <button data-testid="fake-tolka" onClick={() => onTolkat(CREDIT_RESULT)}>tolka kredit</button>
  <button data-testid="fake-tolka-normal" onClick={() => onTolkat(NORMAL_DOUBLECOUNT)}>tolka normal</button>
</>) }))
vi.mock('../components/LeverantorEditor', () => ({ default: () => null }))

const parseSv = s => { const n = parseFloat(String(s ?? '').replace(/[−‒–—―]/g, '-').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const kontoRow = (nr) => {
  const konto = [...document.querySelectorAll('input[id^="lev-konto-"]')].find(i => i.value === nr)
  if (!konto) return null
  const idx = konto.id.replace('lev-konto-', '')
  return {
    debet: parseSv(document.getElementById(`lev-debet-${idx}`)?.value),
    kredit: parseSv(document.getElementById(`lev-kredit-${idx}`)?.value),
  }
}

const renderPage = () => render(<MemoryRouter initialEntries={['/leverantorsfakturor/ny']}><NyLeverantorsfaktura /></MemoryRouter>)
beforeEach(() => { cleanup(); localStorage.clear() })
afterEach(() => cleanup())

describe('NyLeverantorsfaktura – kreditfaktura från OCR', () => {
  it('tolkar kreditnota → kryssruta markerad, Total/Moms negativa, 2440 på debet, balanserat', async () => {
    renderPage()
    // vänta tills kontoplanen laddats (datalist fylld)
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTestId('fake-tolka'))

    await waitFor(() => expect(parseSv(document.getElementById('lev-total').value)).toBe(-1458))
    expect(parseSv(document.getElementById('lev-moms').value)).toBe(-291.5)
    expect(screen.getByRole('checkbox').checked).toBe(true)        // Kreditfaktura ikryssad

    // Omvänd kontering: 2440 debet, kostnad/moms kredit
    expect(kontoRow('2440')).toEqual({ debet: 1458, kredit: 0 })
    expect(kontoRow('6550')).toEqual({ debet: 0, kredit: 1166 })
    expect(kontoRow('2641')).toEqual({ debet: 0, kredit: 291.5 })
    expect(kontoRow('3740')).toEqual({ debet: 0, kredit: 0.5 })    // öresutjämning rätt sida

    // Balans: summa debet = summa kredit
    const inputs = id => [...document.querySelectorAll(`input[id^="${id}"]`)].reduce((s, i) => s + parseSv(i.value), 0)
    expect(inputs('lev-debet-')).toBeCloseTo(inputs('lev-kredit-'), 2)
  })

  it('manuell toggle av Kreditfaktura räknar om tecken och kontering', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByTestId('fake-tolka'))
    await waitFor(() => expect(parseSv(document.getElementById('lev-total').value)).toBe(-1458))

    // Toggla UR kreditfaktura → vanlig faktura
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(false))
    expect(parseSv(document.getElementById('lev-total').value)).toBe(1458)   // positivt igen
    expect(parseSv(document.getElementById('lev-moms').value)).toBe(291.5)
    // Sidorna vända tillbaka: 2440 kredit, kostnad/moms debet
    expect(kontoRow('2440')).toEqual({ debet: 0, kredit: 1458 })
    expect(kontoRow('6550')).toEqual({ debet: 1166, kredit: 0 })
    expect(kontoRow('2641')).toEqual({ debet: 291.5, kredit: 0 })
  })
})

describe('NyLeverantorsfaktura – OCR-dubbelräkning korrigeras (Spiris-fallet)', () => {
  it('vanlig faktura med dubbelräknad kostnad → balanserad kontering, differens 0', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTestId('fake-tolka-normal'))

    await waitFor(() => expect(parseSv(document.getElementById('lev-total').value)).toBe(456))
    expect(parseSv(document.getElementById('lev-moms').value)).toBe(91.25)
    expect(screen.getByRole('checkbox').checked).toBe(false)        // INTE kreditfaktura

    // Endast EN 6592-rad (dubbelräkningen borta), avstämd mot netto 364,75
    expect([...document.querySelectorAll('input[id^="lev-konto-"]')].filter(i => i.value === '6592').length).toBe(1)
    expect(kontoRow('6592')).toEqual({ debet: 364.75, kredit: 0 })
    expect(kontoRow('2641')).toEqual({ debet: 91.25, kredit: 0 })
    expect(kontoRow('2440')).toEqual({ debet: 0, kredit: 456 })

    // Differens 0,00: summa debet = summa kredit
    const inputs = id => [...document.querySelectorAll(`input[id^="${id}"]`)].reduce((s, i) => s + parseSv(i.value), 0)
    expect(inputs('lev-debet-')).toBeCloseTo(456, 2)
    expect(inputs('lev-debet-')).toBeCloseTo(inputs('lev-kredit-'), 2)
  })
})

describe('NyLeverantorsfaktura – Kreditfaktura-kryssrutans placering', () => {
  it('ligger i formuläret direkt ovanför Total/Moms-gruppen, inte i verktygsraden', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))

    const checkbox = screen.getByRole('checkbox')
    const label = checkbox.closest('label')
    expect(label.textContent).toMatch(/Kreditfaktura/)

    // Stabil lokalisering via data-testid; wrappern hör till beloppsgruppen
    const wrapper = screen.getByTestId('supplier-invoice-credit-toggle-form')
    expect(wrapper.contains(checkbox)).toBe(true)

    // INTE i verktygsraden (raden med Kopiera/Kreditupplysning)
    const toolbar = screen.getByText('Kreditupplysning').closest('div')
    expect(toolbar.contains(checkbox)).toBe(false)

    // Sitter direkt ovanför Total/Moms-gridden (egen rad, nästa syskon = beloppsgridden)
    const totalGrid = document.getElementById('lev-total').closest('.grid')
    expect(wrapper.nextElementSibling).toBe(totalGrid)
    // och före Total i dokumentordning
    expect(label.compareDocumentPosition(document.getElementById('lev-total')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('toggle anropar samma logik: vänder Total/Moms-tecken och kontering', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))
    // fyll en vanlig faktura via OCR
    fireEvent.click(screen.getByTestId('fake-tolka-normal'))
    await waitFor(() => expect(parseSv(document.getElementById('lev-total').value)).toBe(456))
    expect(kontoRow('2440')).toEqual({ debet: 0, kredit: 456 })

    // toggla kreditfaktura → tecken negativa + sidor vända
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(true))
    expect(parseSv(document.getElementById('lev-total').value)).toBe(-456)
    expect(parseSv(document.getElementById('lev-moms').value)).toBe(-91.25)
    expect(kontoRow('2440')).toEqual({ debet: 456, kredit: 0 })   // skuld nu på debet
  })
})
