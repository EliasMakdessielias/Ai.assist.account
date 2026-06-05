import { describe, it, expect } from 'vitest'
import { classifyDocument, CLASSIFIED_THRESHOLD } from './classifyDocument'

describe('classifyDocument', () => {
  it('kvitto klassificeras korrekt', () => {
    const r = classifyDocument({ filename: 'kvitto-ica.pdf', subject: 'Kvitto', bodyText: 'Tack för ditt köp i butik. Moms 12,50. Betaldatum 2026-01-02.' })
    expect(r.type).toBe('kvitto')
    expect(r.status).toBe('classified')
    expect(r.confidence).toBeGreaterThanOrEqual(CLASSIFIED_THRESHOLD)
  })

  it('leverantörsfaktura klassificeras korrekt', () => {
    const r = classifyDocument({ filename: 'faktura_123.pdf', subject: 'Faktura 123', bodyText: 'Fakturanummer 123. Bankgiro 5050-1234. OCR 9999. Förfallodatum 2026-02-01.' })
    expect(r.type).toBe('leverantorsfaktura')
    expect(r.status).toBe('classified')
  })

  it('avtal klassificeras korrekt', () => {
    const r = classifyDocument({ filename: 'avtal.docx', subject: 'Avtal', bodyText: 'Detta avtal undertecknat mellan parterna. Signerat.' })
    expect(r.type).toBe('avtal')
    expect(r.status).toBe('classified')
  })

  it('kundfaktura känns igen', () => {
    const r = classifyDocument({ filename: 'kundfaktura.pdf', bodyText: 'Kundfaktura till kund' })
    expect(r.type).toBe('kundfaktura')
  })

  it('okänd fil -> needs_review', () => {
    const r = classifyDocument({ filename: 'scan001.pdf', subject: '', bodyText: 'Hej, se bifogat.' })
    expect(r.type).toBe('okand')
    expect(r.status).toBe('needs_review')
    expect(r.confidence).toBe(0)
  })

  it('filtyp som ej stöds -> unsupported', () => {
    const r = classifyDocument({ filename: 'k.exe' }, { supported: false })
    expect(r.status).toBe('unsupported')
    expect(r.type).toBe('okand')
  })

  it('väljer sannolik kategori vid flera signaler (faktura-övervikt)', () => {
    // Innehåller både "kvitto" och stark fakturasignal -> fakturasignalerna väger tyngre
    const r = classifyDocument({ filename: 'faktura.pdf', bodyText: 'Faktura. Bankgiro. OCR. Förfallodatum. Fakturanummer.' })
    expect(r.type).toBe('leverantorsfaktura')
  })

  it('confidence är ett tal mellan 0 och 0.97', () => {
    const r = classifyDocument({ filename: 'faktura.pdf', bodyText: 'faktura bankgiro ocr förfallodatum' })
    expect(r.confidence).toBeGreaterThan(0)
    expect(r.confidence).toBeLessThanOrEqual(0.97)
  })
})
