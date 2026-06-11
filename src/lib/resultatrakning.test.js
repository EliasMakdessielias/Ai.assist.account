import { describe, it, expect } from 'vitest'
import { buildResultatReport, isResultatKonto } from './resultatrakning'

const accounts = [
  { account_nr: '3051', name: 'Försäljning varor 25%' },
  { account_nr: '3231', name: 'Försäljning bygg omvänd moms' },
  { account_nr: '4000', name: 'Inköp av handelsvaror' },
  { account_nr: '5010', name: 'Lokalhyra' },
  { account_nr: '7010', name: 'Löner' },
  { account_nr: '8410', name: 'Räntekostnader' },
  { account_nr: '8910', name: 'Skatt på årets resultat' },
  { account_nr: '1510', name: 'Kundfordringar' },     // balanskonto – ska INTE med
  { account_nr: '2440', name: 'Leverantörsskulder' },  // balanskonto – ska INTE med
]
// RAW (debet−kredit): intäkter kredit (negativa), kostnader debet (positiva).
const VALUES = {
  3051: { perioden: -1215090, ackumulerat: -1215090 },
  3231: { perioden: -693510, ackumulerat: -693510 },
  4000: { perioden: 303312.55, ackumulerat: 303312.55 },
  5010: { perioden: 128772.50, ackumulerat: 128772.50 },
  7010: { perioden: 50000, ackumulerat: 80000 },   // perioden < ackumulerat
  8410: { perioden: 2000, ackumulerat: 2000 },
  8910: { perioden: 10000, ackumulerat: 10000 },
}
const valueFn = nr => VALUES[nr] || { perioden: 0, ackumulerat: 0 }
const flat = rep => rep.sektioner.flatMap(s => s.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr))))

describe('isResultatKonto', () => {
  it('3xxx–8xxx är resultatkonton; 1xxx/2xxx är det inte', () => {
    expect(isResultatKonto('3051')).toBe(true)
    expect(isResultatKonto('7010')).toBe(true)
    expect(isResultatKonto('8910')).toBe(true)
    expect(isResultatKonto('1510')).toBe(false)
    expect(isResultatKonto('2440')).toBe(false)
  })
})

describe('buildResultatReport', () => {
  it('3xxx under Rörelsens intäkter, 4xxx–7xxx under Rörelsens kostnader', () => {
    const rep = buildResultatReport(accounts, valueFn)
    const intakter = rep.sektioner.find(s => s.key === 'intakter')
    const kostnader = rep.sektioner.find(s => s.key === 'kostnader')
    expect(intakter.rubrik).toBe('Rörelsens intäkter')
    expect(intakter.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr)))).toEqual(expect.arrayContaining(['3051', '3231']))
    expect(kostnader.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr)))).toEqual(expect.arrayContaining(['4000', '5010', '7010']))
  })

  it('1xxx/2xxx (balanskonton) visas INTE', () => {
    const rep = buildResultatReport(accounts, valueFn, { showZero: true })
    expect(flat(rep)).not.toContain('1510')
    expect(flat(rep)).not.toContain('2440')
  })

  it('intäkter visas positivt, kostnader negativt (sign −1)', () => {
    const rep = buildResultatReport(accounts, valueFn)
    const konto = nr => rep.sektioner.flatMap(s => s.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton))).find(k => k.nr === nr)
    expect(konto('3051').perioden).toBe(1215090)     // intäkt positiv
    expect(konto('4000').perioden).toBe(-303312.55)  // kostnad negativ
  })

  it('Summa rörelsens intäkter och kostnader beräknas korrekt', () => {
    const rep = buildResultatReport(accounts, valueFn)
    expect(rep.intakter.perioden).toBe(1908600)                 // 1215090 + 693510
    expect(rep.kostnader.perioden).toBe(-482085.05)             // −(303312.55 + 128772.50 + 50000)
  })

  it('rörelseresultat, efter finansiella poster och beräknat resultat', () => {
    const rep = buildResultatReport(accounts, valueFn)
    expect(rep.rorelseresultat.perioden).toBe(1426514.95)       // 1908600 − 482085.05
    expect(rep.efterFinansiella.perioden).toBe(1424514.95)      // − 2000 (ränta)
    expect(rep.beraknat.perioden).toBe(1414514.95)              // − 10000 (skatt)
  })

  it('Perioden och Ackumulerat kan skilja sig (ackumulerat ≥ perioden)', () => {
    const rep = buildResultatReport(accounts, valueFn)
    const k7010 = rep.sektioner.flatMap(s => s.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton))).find(k => k.nr === '7010')
    expect(k7010.perioden).toBe(-50000)
    expect(k7010.ackumulerat).toBe(-80000)
  })

  it('döljer nollkonton som standard, visar med showZero', () => {
    const accs = [...accounts, { account_nr: '6000', name: 'Övriga externa kostnader' }]  // saknar värde → noll
    expect(flat(buildResultatReport(accs, valueFn))).not.toContain('6000')
    expect(flat(buildResultatReport(accs, valueFn, { showZero: true }))).toContain('6000')
  })
})
