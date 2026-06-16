import { describe, it, expect } from 'vitest'
import { samlaKorrigeringar, larDefaultMotkonto } from './larande'

describe('samlaKorrigeringar', () => {
  const original = { fakturadatum: '2026-03-01', forfallodatum: '2026-03-31', fakturanummer: 'A1', ocr: '123', belopp_inkl_moms: 1250, moms_belopp: 250 }

  it('inga ändringar → inga korrigeringar', () => {
    const final = { fakturadatum: '2026-03-01', forfallodatum: '2026-03-31', fakturanummer: 'A1', ocr: '123', belopp_inkl_moms: '1250,00', moms_belopp: '250,00' }
    expect(samlaKorrigeringar({ original, final })).toEqual([])
  })

  it('ändrat fakturanummer fångas med original + slutvärde + säkerhet', () => {
    const k = samlaKorrigeringar({ original, final: { fakturanummer: 'A2' }, faltSak: { fakturanummer: 0.4 } })
    expect(k).toEqual([{ field: 'fakturanummer', original_value: 'A1', final_value: 'A2', confidence_before: 0.4 }])
  })

  it('belopp jämförs numeriskt (1250 = 1 250,00)', () => {
    const k = samlaKorrigeringar({ original, final: { belopp_inkl_moms: '1 250,00' } })
    expect(k).toEqual([])
  })

  it('ändrat momsbelopp fångas', () => {
    const k = samlaKorrigeringar({ original, final: { moms_belopp: '300' } })
    expect(k.map(x => x.field)).toEqual(['moms_belopp'])
    expect(k[0].final_value).toBe('300')
  })

  it('negativa belopp (kreditfaktura) jämförs som magnitud', () => {
    const k = samlaKorrigeringar({ original: { belopp_inkl_moms: -1250 }, final: { belopp_inkl_moms: '-1250,00' } })
    expect(k).toEqual([])
  })

  it('utan original → inga korrigeringar (manuell faktura)', () => {
    expect(samlaKorrigeringar({ original: null, final: { fakturanummer: 'X' } })).toEqual([])
  })
})

describe('larDefaultMotkonto', () => {
  it('väljer kostnadskontot (debet), ej moms/skuld/öres', () => {
    const rows = [
      { nr: '2440', debet: 0, kredit: 1250 },
      { nr: '2640', debet: 250, kredit: 0 },
      { nr: '5611', debet: 1000, kredit: 0 },
    ]
    expect(larDefaultMotkonto(rows)).toBe('5611')
  })

  it('flera kostnadskonton → störst belopp', () => {
    const rows = [
      { nr: '2440', debet: 0, kredit: 1250 },
      { nr: '5611', debet: 200, kredit: 0 },
      { nr: '4000', debet: 800, kredit: 0 },
    ]
    expect(larDefaultMotkonto(rows)).toBe('4000')
  })

  it('kreditfaktura: kostnad på kredit', () => {
    const rows = [
      { nr: '2440', debet: 1250, kredit: 0 },
      { nr: '2640', debet: 0, kredit: 250 },
      { nr: '5611', debet: 0, kredit: 1000 },
    ]
    expect(larDefaultMotkonto(rows, true)).toBe('5611')
  })

  it('ingen kostnadsrad → null', () => {
    expect(larDefaultMotkonto([{ nr: '2440', debet: 0, kredit: 100 }, { nr: '3740', debet: 0, kredit: 0.5 }])).toBe(null)
  })
})
