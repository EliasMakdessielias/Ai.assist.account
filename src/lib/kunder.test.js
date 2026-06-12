import { describe, it, expect } from 'vitest'
import { nextKundNr, kundPayload } from './kunder'

describe('nextKundNr', () => {
  it('högsta + 1; tom lista börjar på 1; null-nummer ignoreras', () => {
    expect(nextKundNr([{ kund_nr: 1 }, { kund_nr: 7 }, { kund_nr: null }])).toBe(8)
    expect(nextKundNr([])).toBe(1)
    expect(nextKundNr(null)).toBe(1)
  })
})

describe('kundPayload', () => {
  it('trimmar, tomt blir null, heltal parsas, valuta får default', () => {
    const p = kundPayload({ kund_nr: '2', name: '  Acme AB  ', org_nr: ' ', email: 'a@b.se', payment_terms: '14', valuta: '' })
    expect(p.kund_nr).toBe(2)
    expect(p.name).toBe('Acme AB')
    expect(p.org_nr).toBeNull()
    expect(p.email).toBe('a@b.se')
    expect(p.payment_terms).toBe(14)
    expect(p.valuta).toBe('SEK')
    expect(p.kundtyp).toBe('foretag')
    expect(p.is_active).toBe(true)
  })

  it('kundtyp privat + inaktiv bevaras; ogiltig kundtyp blir foretag', () => {
    expect(kundPayload({ name: 'x', kundtyp: 'privat', is_active: false }).kundtyp).toBe('privat')
    expect(kundPayload({ name: 'x', kundtyp: 'privat', is_active: false }).is_active).toBe(false)
    expect(kundPayload({ name: 'x', kundtyp: 'hittepå' }).kundtyp).toBe('foretag')
  })

  it('försäljningskonto kräver exakt 4 siffror, annars null (fallback 3001 i bokföringen)', () => {
    expect(kundPayload({ name: 'x', forsaljningskonto: '3041' }).forsaljningskonto).toBe('3041')
    expect(kundPayload({ name: 'x', forsaljningskonto: ' 3001 ' }).forsaljningskonto).toBe('3001')
    expect(kundPayload({ name: 'x', forsaljningskonto: '30' }).forsaljningskonto).toBeNull()
    expect(kundPayload({ name: 'x', forsaljningskonto: 'abcd' }).forsaljningskonto).toBeNull()
    expect(kundPayload({ name: 'x' }).forsaljningskonto).toBeNull()
  })

  it('betalningsvillkor default 30 dagar', () => {
    expect(kundPayload({ name: 'x' }).payment_terms).toBe(30)
    expect(kundPayload({ name: 'x', payment_terms: 'abc' }).payment_terms).toBe(30)
  })
})
