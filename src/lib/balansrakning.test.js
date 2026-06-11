import { describe, it, expect } from 'vitest'
import { buildBalansReport, isBalansKonto } from './balansrakning'

const accounts = [
  { account_nr: '1220', name: 'Inventarier' },
  { account_nr: '1510', name: 'Kundfordringar' },
  { account_nr: '1930', name: 'Företagskonto' },
  { account_nr: '2440', name: 'Leverantörsskulder' },
  { account_nr: '2081', name: 'Aktiekapital' },
  { account_nr: '3001', name: 'Försäljning' },   // resultatkonto – ska INTE bli balanskonto
  { account_nr: '5010', name: 'Lokalhyra' },
]
// RAW (debet−kredit). Tillgångar debet-positiva, skulder/EK kredit-negativa.
const VALUES = {
  1220: { ib: 100000, change: 0, ub: 100000 },
  1510: { ib: 5000, change: 2000, ub: 7000 },
  1930: { ib: 20000, change: -3000, ub: 17000 },
  2440: { ib: -8000, change: -1000, ub: -9000 },   // skuld (kredit)
  2081: { ib: -100000, change: 0, ub: -100000 },   // aktiekapital (kredit)
}
const valueFn = nr => VALUES[nr] || { ib: 0, change: 0, ub: 0 }

describe('isBalansKonto', () => {
  it('1xxx och 2xxx är balanskonton; 3xxx/4xxx/5xxx är det inte', () => {
    expect(isBalansKonto('1220')).toBe(true)
    expect(isBalansKonto('2440')).toBe(true)
    expect(isBalansKonto('3001')).toBe(false)
    expect(isBalansKonto('5010')).toBe(false)
  })
})

describe('buildBalansReport', () => {
  it('placerar 1xxx under Tillgångar och 2xxx under Eget kapital och skulder', () => {
    const rep = buildBalansReport(accounts, valueFn)
    const tg = rep.sektioner.find(s => s.key === 'tillgangar')
    const ek = rep.sektioner.find(s => s.key === 'ekskuld')
    expect(tg.rubrik).toBe('Tillgångar')
    const allaTgKonton = tg.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr)))
    expect(allaTgKonton).toEqual(expect.arrayContaining(['1220', '1510', '1930']))
    const allaEkKonton = ek.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr)))
    expect(allaEkKonton).toEqual(expect.arrayContaining(['2440', '2081']))
  })

  it('intäkts- och kostnadskonton (3xxx/5xxx) tas INTE med som balanskonton', () => {
    const rep = buildBalansReport(accounts, valueFn, { showZero: true })
    const alla = rep.sektioner.flatMap(s => s.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr))))
    expect(alla).not.toContain('3001')
    expect(alla).not.toContain('5010')
  })

  it('tecknar skulder/EK kredit-positivt (sign −1)', () => {
    const rep = buildBalansReport(accounts, valueFn)
    const ek = rep.sektioner.find(s => s.key === 'ekskuld')
    const k2440 = ek.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton)).find(k => k.nr === '2440')
    expect(k2440.ub).toBe(9000)   // raw −9000 × sign −1 = +9000
  })

  it('summerar undergrupp/grupp/sektion korrekt (IB, Förändring, UB)', () => {
    const rep = buildBalansReport(accounts, valueFn)
    const tg = rep.sektioner.find(s => s.key === 'tillgangar')
    // Tillgångar UB = 100000 + 7000 + 17000 = 124000
    expect(tg.sum.ub).toBe(124000)
    expect(tg.sum.ib).toBe(125000)        // 100000 + 5000 + 20000
    expect(tg.sum.change).toBe(-1000)     // 0 + 2000 − 3000
  })

  it('UB = IB + Förändring per konto', () => {
    const rep = buildBalansReport(accounts, valueFn)
    const konton = rep.sektioner.flatMap(s => s.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton)))
    for (const k of konton) expect(Math.round((k.ib + k.change) * 100) / 100).toBe(k.ub)
  })

  it('döljer nollkonton som standard, visar dem med showZero', () => {
    const accs = [...accounts, { account_nr: '1240', name: 'Maskiner' }]   // saknar värde → noll
    const utan = buildBalansReport(accs, valueFn)
    const medAlla = buildBalansReport(accs, valueFn, { showZero: true })
    const flat = rep => rep.sektioner.flatMap(s => s.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton.map(k => k.nr))))
    expect(flat(utan)).not.toContain('1240')
    expect(flat(medAlla)).toContain('1240')
  })

  it('Årets resultat injiceras i Eget kapital och balanserar', () => {
    // Tillgångar UB 124000; skulder+EK (2440+2081) UB = 9000 + 100000 = 109000.
    // Differens 15000 → motsvarar årets resultat. Med årsresultat 15000 → balanserar.
    const rep = buildBalansReport(accounts, valueFn, { aretsResultat: { ib: 0, change: 0, ub: 15000 } })
    const ek = rep.sektioner.find(s => s.key === 'ekskuld')
    const ar = ek.grupper.flatMap(g => g.undergrupper.flatMap(u => u.konton)).find(k => k.namn === 'Årets resultat')
    expect(ar).toBeTruthy()
    expect(rep.ekskuld.ub).toBe(124000)
    expect(rep.differens.ub).toBe(0)
    expect(rep.balanserar).toBe(true)
  })

  it('flaggar obalans när differens ≠ 0', () => {
    const rep = buildBalansReport(accounts, valueFn)   // utan årsresultat → obalans
    expect(rep.balanserar).toBe(false)
    expect(rep.differens.ub).toBe(15000)
  })

  it('tomma grupper (saknade obeskattade reserver/avsättningar) utelämnas', () => {
    const rep = buildBalansReport(accounts, valueFn)
    const ek = rep.sektioner.find(s => s.key === 'ekskuld')
    expect(ek.grupper.map(g => g.key)).not.toContain('obesk')
    expect(ek.grupper.map(g => g.key)).not.toContain('avsattningar')
  })
})
