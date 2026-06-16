import { describe, it, expect } from 'vitest'
import { validateLevfaktura, vatRateMatches, VALID_VAT_RATES } from './levfakturaValidering'

describe('vatRateMatches', () => {
  it('25 % moms matchar', () => {
    expect(vatRateMatches(1000, 250).ok).toBe(true)
  })
  it('12 % och 6 % matchar', () => {
    expect(vatRateMatches(1000, 120).ok).toBe(true)
    expect(vatRateMatches(1000, 60).ok).toBe(true)
  })
  it('momsfritt (0) matchar', () => {
    expect(vatRateMatches(1000, 0).ok).toBe(true)
  })
  it('öresavrundning inom tolerans', () => {
    expect(vatRateMatches(1000, 250.4).ok).toBe(true)
  })
  it('avvikande sats (10 %) matchar inte', () => {
    const r = vatRateMatches(1000, 100)
    expect(r.ok).toBe(false)
    expect(r.impliedRate).toBe(10)
  })
  it('net≈0 kräver moms≈0', () => {
    expect(vatRateMatches(0, 0).ok).toBe(true)
    expect(vatRateMatches(0, 50).ok).toBe(false)
  })
  it('VALID_VAT_RATES innehåller svenska satser', () => {
    expect(VALID_VAT_RATES).toEqual([0, 6, 12, 25])
  })
})

describe('validateLevfaktura', () => {
  it('korrekt faktura ger inga fel/varningar', () => {
    const r = validateLevfaktura({ total: '1250,00', moms: '250,00', fakturadatum: '2026-03-01', forfallodatum: '2026-03-31' })
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })
  it('moms > total är ett fel', () => {
    const r = validateLevfaktura({ total: '100,00', moms: '200,00' })
    expect(r.errors.length).toBe(1)
  })
  it('avvikande momssats ger varning, inte fel', () => {
    const r = validateLevfaktura({ total: '1100,00', moms: '100,00' })
    expect(r.errors).toEqual([])
    expect(r.warnings.some(w => w.includes('%'))).toBe(true)
  })
  it('förfallo före faktura ger varning', () => {
    const r = validateLevfaktura({ total: '1250', moms: '250', fakturadatum: '2026-03-10', forfallodatum: '2026-03-01' })
    expect(r.warnings.some(w => w.includes('Förfallodatumet'))).toBe(true)
  })
  it('negativa belopp (kreditfaktura) hanteras som magnituder', () => {
    const r = validateLevfaktura({ total: '-1250,00', moms: '-250,00' })
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })
  it('tomt fakturahuvud ger inga fel', () => {
    const r = validateLevfaktura({})
    expect(r.errors).toEqual([])
  })
})
