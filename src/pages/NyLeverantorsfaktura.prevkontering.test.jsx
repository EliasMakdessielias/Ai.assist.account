// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NyLeverantorsfaktura from './NyLeverantorsfaktura'

const { FX } = vi.hoisted(() => ({
  FX: {
    PREV_INV: { id: 'inv1', invoice_date: '2026-01-10', created_at: '2026-01-10', verifikation_id: 'ver1', kreditfaktura: false },
    PREV_ROWS: [
      { account_nr: '2440', account_name: 'Leverantörsskulder', debet: 0, kredit: 9999, sort_order: 0 },
      { account_nr: '2641', account_name: 'Debiterad ingående moms', debet: 1111, kredit: 0, sort_order: 1 },
      { account_nr: '5220', account_name: 'Hyra av inventarier och verktyg', debet: 8888, kredit: 0, sort_order: 2 },
    ],
    PREV_VER: { ver_nr: 'L7', datum: '2026-01-10' },
    PREV_DOC: { id: 'doc1', storage_path: 'c1/grenke.pdf', file_name: 'grenke.pdf', mime_type: 'application/pdf' },
  },
}))

vi.mock('../hooks/useAuth', () => {
  const auth = { company: { id: 'c1' }, user: { id: 'u1' } }
  return { useAuth: () => auth }
})

vi.mock('../lib/supabase', () => {
  const ACCOUNTS = [
    { account_nr: '2440', name: 'Leverantörsskulder', is_active: true, is_locked: true },
    { account_nr: '2641', name: 'Debiterad ingående moms', is_active: true, is_locked: true },
    { account_nr: '3740', name: 'Öres- och kronutjämning', is_active: true, is_locked: false },
    { account_nr: '5220', name: 'Hyra av inventarier och verktyg', is_active: true, is_locked: false },
  ]
  const SUPPLIERS = [
    { id: 'grenke', name: 'Grenkeleasing AB', org_nr: '5560000000', bankgiro: '', default_motkonto: '' },
    { id: 'nohist', name: 'Saknad Historik AB', org_nr: '5560000001', bankgiro: '', default_motkonto: '' },
  ]
  const make = (table) => {
    const st = { selectCols: '', eqs: [] }
    const p = {}
    p.select = (c) => { st.selectCols = c || ''; return p }
    p.eq = (col, val) => { st.eqs.push([col, val]); return p }
    p.not = () => p; p.order = () => p; p.limit = () => p; p.range = () => p; p.in = () => p; p.update = () => p; p.insert = () => p
    const data = () => {
      switch (table) {
        case 'accounts': return ACCOUNTS
        case 'suppliers': return SUPPLIERS
        case 'supplier_invoices': {
          if (st.selectCols.includes('lopnr')) return []
          const sup = st.eqs.find(e => e[0] === 'supplier_id')?.[1]
          return sup === 'grenke' ? FX.PREV_INV : null
        }
        case 'verifikation_rows': return FX.PREV_ROWS
        case 'verifikationer': return FX.PREV_VER
        case 'documents': return FX.PREV_DOC
        default: return []
      }
    }
    p.maybeSingle = async () => { const d = data(); return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: null } }
    p.single = async () => ({ data: data(), error: null })
    p.then = (resolve) => { const d = data(); resolve({ data: Array.isArray(d) ? d : (d ? [d] : []), error: null }) }
    return p
  }
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/grenke.pdf' }, error: null }) }) }
  return { supabase: { from: (t) => make(t), rpc: async () => ({ data: null, error: null }), storage } }
})
vi.mock('../components/UnderlagPanel', () => ({ default: () => null }))
vi.mock('../components/LeverantorEditor', () => ({ default: () => null }))

const parseSv = s => { const n = parseFloat(String(s ?? '').replace(/[−‒–—―]/g, '-').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n }
const kontoRow = (nr) => {
  const k = [...document.querySelectorAll('input[id^="lev-konto-"]')].find(i => i.value === nr)
  if (!k) return null
  const idx = k.id.replace('lev-konto-', '')
  return { debet: parseSv(document.getElementById(`lev-debet-${idx}`)?.value), kredit: parseSv(document.getElementById(`lev-kredit-${idx}`)?.value) }
}
const renderPage = () => render(<MemoryRouter initialEntries={['/leverantorsfakturor/ny']}><NyLeverantorsfaktura /></MemoryRouter>)
const selectSupplier = (name) => { fireEvent.focus(document.getElementById('lev-leverantor')); fireEvent.mouseDown(screen.getByText(name)) }
const openSection = () => fireEvent.click(screen.getByRole('button', { name: /Kontering från förra fakturan/ }))

beforeEach(() => { cleanup(); localStorage.clear() })
afterEach(() => cleanup())

describe('Kontering från förra fakturan', () => {
  it('ingen leverantör vald → vänligt läge, ingen tabell', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))
    openSection()
    expect(screen.getByText(/Välj leverantör för att se tidigare kontering/)).toBeTruthy()
  })

  it('leverantör utan historik → "Ingen tidigare kontering hittades"', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))
    selectSupplier('Saknad Historik AB')
    openSection()
    await waitFor(() => expect(screen.getByText(/Ingen tidigare kontering hittades/)).toBeTruthy())
  })

  it('leverantör med tidigare bokförd faktura → konton visas + Använd kontering balanserar', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))
    selectSupplier('Grenkeleasing AB')
    openSection()
    await waitFor(() => expect(screen.getByText('5220')).toBeTruthy())
    expect(screen.getByText('Hyra av inventarier och verktyg')).toBeTruthy()
    expect(screen.getByText('2641')).toBeTruthy()

    // Sätt NY total/moms och applicera
    const t = document.getElementById('lev-total'); fireEvent.change(t, { target: { value: '1250' } }); fireEvent.blur(t)
    const m = document.getElementById('lev-moms'); fireEvent.change(m, { target: { value: '250' } }); fireEvent.blur(m)
    fireEvent.click(screen.getByRole('button', { name: /Använd kontering/ }))

    // Omräknat från NY total/moms (inte gamla 8888/9999)
    await waitFor(() => expect(kontoRow('5220')).toEqual({ debet: 1000, kredit: 0 }))
    expect(kontoRow('2641')).toEqual({ debet: 250, kredit: 0 })
    expect(kontoRow('2440')).toEqual({ debet: 0, kredit: 1250 })
    // Differens 0: summa debet = summa kredit
    const inputs = id => [...document.querySelectorAll(`input[id^="${id}"]`)].reduce((s, i) => s + parseSv(i.value), 0)
    expect(inputs('lev-debet-')).toBeCloseTo(inputs('lev-kredit-'), 2)
    expect(inputs('lev-debet-')).toBeCloseTo(1250, 2)
  })

  it('Visa underlag är aktiv när tidigare underlag finns', async () => {
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('#lev-konton option').length).toBeGreaterThan(0))
    selectSupplier('Grenkeleasing AB')
    openSection()
    await waitFor(() => expect(screen.getByText('5220')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Visa underlag/ }).disabled).toBe(false)
  })
})
