import { describe, it, expect } from 'vitest'
import { parseFile, parseAmount, parseDate, guessColumns } from './parseBank'

// Skatteverkets skattekonto-export: ingen rubrikrad, företagsnamn överst,
// saldo-rader, fyra kolumner (datum, text, belopp, löpande saldo).
const SKV = [
  '"Makdesi Redovisningsbyrå AB";"559208-1219";"";""',
  '"";"";"";""',
  '"";"Ingående saldo 2026-01-01";"";"115 946"',
  '"2026-01-03";"Korrigerad kostnadsränta";"41";"115 987"',
  '"2026-01-03";"Intäktsränta";"88";"116 075"',
  '"2026-01-03";"Korrigerad intäktsränta";"326";"116 401"',
  '"2026-01-09";"Utbetalning";"-90 000";"26 401"',
  '"2026-01-16";"Moms nov 2025";"1 870";"28 271"',
  '"2026-01-19";"Arbetsgivaravgift dec 2025";"-1 461";"26 810"',
  '"2026-01-21";"Utbetalning";"-1 870";"24 940"',
  '"";"Utgående saldo 2026-01-31";"";"24 940"',
].join('\n')

describe('parseAmount', () => {
  it('tolkar svenska belopp med mellanslag som tusentalsavgränsare', () => {
    expect(parseAmount('1 870')).toBe(1870)
    expect(parseAmount('-90 000')).toBe(-90000)
    expect(parseAmount('41')).toBe(41)
    expect(parseAmount('1 234,56')).toBe(1234.56)
  })
  it('tolkar INTE datum som belopp (bugg-fix)', () => {
    expect(parseAmount('2026-01-21')).toBeNull()
    expect(parseAmount('2026-01-03')).toBeNull()
  })
})

describe('parseFile', () => {
  it('hanterar semikolon och citationstecken', () => {
    const { rows, delim } = parseFile(SKV)
    expect(delim).toBe(';')
    expect(rows[3]).toEqual(['2026-01-03', 'Korrigerad kostnadsränta', '41', '115 987'])
  })
})

describe('guessColumns – Skatteverkets skattekonto (rubriklös)', () => {
  it('mappar datum=0, text=1, belopp=2 (INTE datumkolumnen, INTE saldo)', () => {
    const { rows } = parseFile(SKV)
    const map = guessColumns(rows)
    expect(map).toEqual({ datum: 0, text: 1, belopp: 2 })
  })
  it('end-to-end: ger 7 transaktioner med korrekta belopp', () => {
    const { rows } = parseFile(SKV)
    const map = guessColumns(rows)
    const tx = rows
      .map(r => ({ datum: parseDate(r[map.datum]), text: r[map.text], amount: parseAmount(r[map.belopp]) }))
      .filter(t => t.datum && t.amount != null)
    expect(tx).toHaveLength(7)
    expect(tx.map(t => t.amount)).toEqual([41, 88, 326, -90000, 1870, -1461, -1870])
  })
})

describe('guessColumns – fil med rubrikrad', () => {
  it('matchar på rubriknamn och undviker saldo', () => {
    const csv = ['Datum;Text;Belopp;Saldo', '2026-01-03;Köp;-100,00;900,00'].join('\n')
    const { rows } = parseFile(csv)
    expect(guessColumns(rows)).toEqual({ datum: 0, text: 1, belopp: 2 })
  })
})
