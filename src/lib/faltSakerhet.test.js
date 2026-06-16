import { describe, it, expect } from 'vitest'
import { faltNiva, effektivNiva, granskningskravda } from './faltSakerhet'

describe('faltNiva', () => {
  it('trösklar grön/gul/röd', () => {
    expect(faltNiva(0.99)).toBe('ok')
    expect(faltNiva(0.95)).toBe('ok')
    expect(faltNiva(0.9)).toBe('granska')
    expect(faltNiva(0.8)).toBe('granska')
    expect(faltNiva(0.79)).toBe('osaker')
    expect(faltNiva(0)).toBe('osaker')
  })
  it('okänt score → null', () => {
    expect(faltNiva(null)).toBe(null)
    expect(faltNiva(undefined)).toBe(null)
  })
})

describe('effektivNiva', () => {
  const faltSak = { fakturadatum: 0.5, leverantor: 0.4 }
  it('verifierat fält är alltid ok', () => {
    expect(effektivNiva('fakturadatum', { faltSak, verifierat: { fakturadatum: true } })).toBe('ok')
  })
  it('leverantör med vald supplier är ok', () => {
    expect(effektivNiva('leverantor', { faltSak, supplierId: 'x' })).toBe('ok')
    expect(effektivNiva('leverantor', { faltSak })).toBe('osaker')
  })
})

describe('granskningskravda', () => {
  it('inga krav utan faltSak', () => {
    expect(granskningskravda({ faltSak: null })).toEqual([])
  })
  it('hög säkerhet → inga krav', () => {
    const faltSak = { leverantor: 1, fakturadatum: 1, forfallodatum: 1, belopp_inkl_moms: 1, moms_belopp: 1, fakturanummer: 1, ocr: 1 }
    expect(granskningskravda({ faltSak, supplierId: 'x' })).toEqual([])
  })
  it('låg säkerhet på datum/belopp flaggas', () => {
    const faltSak = { fakturadatum: 0.4, belopp_inkl_moms: 0.5, moms_belopp: 1, forfallodatum: 1, fakturanummer: 1, ocr: 1 }
    const krav = granskningskravda({ faltSak, supplierId: 'x' })
    expect(krav.map(k => k.key).sort()).toEqual(['belopp_inkl_moms', 'fakturadatum'])
  })
  it('fakturanummer ELLER ocr – bara om båda osäkra', () => {
    const base = { leverantor: 1, fakturadatum: 1, forfallodatum: 1, belopp_inkl_moms: 1, moms_belopp: 1 }
    expect(granskningskravda({ faltSak: { ...base, fakturanummer: 0.3, ocr: 1 }, supplierId: 'x' })).toEqual([])
    expect(granskningskravda({ faltSak: { ...base, fakturanummer: 1, ocr: 0.3 }, supplierId: 'x' })).toEqual([])
    const krav = granskningskravda({ faltSak: { ...base, fakturanummer: 0.3, ocr: 0.3 }, supplierId: 'x' })
    expect(krav).toHaveLength(1)
    expect(krav[0].fields).toEqual(['fakturanummer', 'ocr'])
  })
  it('verifierat fält tas bort ur kraven', () => {
    const faltSak = { fakturadatum: 0.4, leverantor: 1, forfallodatum: 1, belopp_inkl_moms: 1, moms_belopp: 1, fakturanummer: 1, ocr: 1 }
    expect(granskningskravda({ faltSak, supplierId: 'x', verifierat: { fakturadatum: true } })).toEqual([])
  })
})
