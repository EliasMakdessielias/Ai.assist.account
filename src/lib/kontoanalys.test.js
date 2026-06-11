import { describe, it, expect } from 'vitest'
import { buildInvoiceLinkMap, invoiceRoute, splitDescriptionByInvoiceNr } from './kontoanalys'

describe('buildInvoiceLinkMap', () => {
  it('mappar leverantörs- och kundfakturor på verifikation_id', () => {
    const map = buildInvoiceLinkMap(
      [{ id: 'si1', invoice_nr: '3419', verifikation_id: 'v1' }],
      [{ id: 'ci1', invoice_nr: 'K100', verifikation_id: 'v2' }],
    )
    expect(map.v1).toEqual({ kind: 'lev', id: 'si1', invoice_nr: '3419' })
    expect(map.v2).toEqual({ kind: 'kund', id: 'ci1', invoice_nr: 'K100' })
  })

  it('flera fakturor på samma verifikation → ambiguös, ingen länk', () => {
    const map = buildInvoiceLinkMap(
      [{ id: 'si1', invoice_nr: '3419', verifikation_id: 'v1' }, { id: 'si2', invoice_nr: '9999', verifikation_id: 'v1' }],
      [],
    )
    expect(map.v1).toBeUndefined()
  })

  it('utelämnar fakturor utan verifikation_id eller utan fakturanummer', () => {
    const map = buildInvoiceLinkMap(
      [{ id: 'si1', invoice_nr: '3419', verifikation_id: null }, { id: 'si2', invoice_nr: '', verifikation_id: 'v3' }],
      [],
    )
    expect(map).toEqual({})
  })
})

describe('invoiceRoute', () => {
  it('leverantörsfaktura → /leverantorsfakturor/{id}', () => {
    expect(invoiceRoute({ kind: 'lev', id: 'si1' })).toBe('/leverantorsfakturor/si1')
  })
  it('kundfaktura → /fakturor/{id}', () => {
    expect(invoiceRoute({ kind: 'kund', id: 'ci1' })).toBe('/fakturor/ci1')
  })
  it('null om ingen länk', () => { expect(invoiceRoute(null)).toBeNull() })
})

describe('splitDescriptionByInvoiceNr', () => {
  it('delar texten runt fakturanumret som egen token', () => {
    const r = splitDescriptionByInvoiceNr('Lev.faktura AcountX Redovisningsbyrå AB 3419', '3419')
    expect(r).toEqual({ before: 'Lev.faktura AcountX Redovisningsbyrå AB ', match: '3419', after: '' })
  })
  it('matchar inte numret inuti ett större tal', () => {
    expect(splitDescriptionByInvoiceNr('Faktura 34190', '3419')).toBeNull()
  })
  it('hanterar nummer mitt i texten', () => {
    expect(splitDescriptionByInvoiceNr('Faktura 3419 betald', '3419')).toEqual({ before: 'Faktura ', match: '3419', after: ' betald' })
  })
  it('returnerar null när numret saknas i texten eller är tomt', () => {
    expect(splitDescriptionByInvoiceNr('Ingen match här', '3419')).toBeNull()
    expect(splitDescriptionByInvoiceNr('Faktura 3419', '')).toBeNull()
  })
})
