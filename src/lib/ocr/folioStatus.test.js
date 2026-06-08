import { describe, it, expect } from 'vitest'
import { folioStatus, folioStatusMeta, folioRunOutcome, folioButtonDisabled, FOLIO_STATES } from './folioStatus'

describe('folioStatus – statuslägen (krav 8)', () => {
  it('känner igen explicit status', () => {
    expect(folioStatus({ status: 'available' })).toBe('available')
    expect(folioStatus({ status: 'unavailable' })).toBe('unavailable')
    expect(folioStatus({ status: 'disabled' })).toBe('disabled')
    expect(folioStatus({ status: 'not_configured' })).toBe('not_configured')
  })
  it('faller tillbaka på available/reason (äldre svar)', () => {
    expect(folioStatus({ available: false, reason: 'disabled' })).toBe('disabled')
    expect(folioStatus({ available: false, reason: 'not_configured' })).toBe('not_configured')
    expect(folioStatus({ available: false })).toBe('unavailable')
    expect(folioStatus({ available: true })).toBe('available')
  })
  it('null/okänt -> unknown', () => {
    expect(folioStatus(null)).toBe('unknown')
    expect(folioStatus({})).toBe('unknown')
  })
})

describe('folioStatusMeta – ton + etikett (krav 3)', () => {
  it('not_configured visar "inte konfigurerad", inte tekniskt fel', () => {
    const m = folioStatusMeta({ status: 'not_configured' })
    expect(m.state).toBe('not_configured')
    expect(m.label).toBe('Folio-OCR är inte konfigurerad')
    expect(m.tone).toBe('amber')
  })
  it('disabled är neutralt (grått)', () => {
    expect(folioStatusMeta({ status: 'disabled' }).tone).toBe('gray')
  })
  it('available är grönt', () => {
    expect(folioStatusMeta({ status: 'available' }).tone).toBe('green')
  })
})

describe('folioRunOutcome – körutfall (krav 5/7)', () => {
  it('lyckat resultat', () => {
    const o = folioRunOutcome({ available: true, result: { rawText: 'hej', providerName: 'folio_ocr' } })
    expect(o.kind).toBe('ok')
    expect(o.result.rawText).toBe('hej')
  })
  it('inaktiverad -> lugnt läge, inget fel', () => {
    expect(folioRunOutcome({ status: 'disabled' }).kind).toBe('disabled')
  })
  it('ej konfigurerad -> lugnt läge', () => {
    expect(folioRunOutcome({ status: 'not_configured' }).kind).toBe('not_configured')
  })
  it('service-fel -> failed med "Gemini påverkas inte"', () => {
    const o = folioRunOutcome({ available: false, status: 'unavailable', error: 'folio_error', result: null })
    expect(o.kind).toBe('failed')
    expect(o.reason).toBe('folio_error')
    expect(o.label).toMatch(/Gemini påverkas inte/)
  })
  it('timeout -> failed med reason timeout', () => {
    const o = folioRunOutcome({ available: false, error: 'timeout', result: null })
    expect(o.kind).toBe('failed')
    expect(o.reason).toBe('timeout')
  })
})

describe('folioButtonDisabled (krav 13)', () => {
  it('knappen inaktiv när av/ej konfigurerad', () => {
    expect(folioButtonDisabled('disabled')).toBe(true)
    expect(folioButtonDisabled('not_configured')).toBe(true)
  })
  it('knappen aktiv när tillgänglig/okänd', () => {
    expect(folioButtonDisabled('available')).toBe(false)
    expect(folioButtonDisabled('unknown')).toBe(false)
    expect(folioButtonDisabled('unavailable')).toBe(false)
  })
})

describe('FOLIO_STATES täcker alla lägen', () => {
  it('har alla nycklar', () => {
    expect(Object.keys(FOLIO_STATES).sort()).toEqual(
      ['available', 'disabled', 'not_configured', 'unavailable', 'unknown'])
  })
})
