import { describe, it, expect } from 'vitest'
import { byggDagskassaRader, dagskassaFromTolkning, DAGSKASSA_ACC } from './dagskassa'

const sum = (rows, sida) => Math.round(rows.reduce((s, r) => s + r[sida], 0) * 100) / 100
const rad = (rows, nr) => rows.find(r => r.nr === nr)

describe('byggDagskassaRader', () => {
  it('balanserad dagskassa utan differens → ingen 3790-rad, debet = kredit', () => {
    // Netto 1000 (25%) → moms 250, betalt 1250 kontant
    const { rows, kassadiff, totalDebet, totalKredit } = byggDagskassaRader({
      net: { 25: 1000 }, moms: { 25: 250 }, kontant: 1250, kort: 0,
    })
    expect(kassadiff).toBe(0)
    expect(rad(rows, '3790')).toBeUndefined()
    expect(rad(rows, '3001')).toMatchObject({ debet: 0, kredit: 1000 })
    expect(rad(rows, '2611')).toMatchObject({ debet: 0, kredit: 250 })
    expect(rad(rows, '1910')).toMatchObject({ debet: 1250, kredit: 0 })
    expect(totalDebet).toBe(totalKredit)
    expect(totalDebet).toBe(1250)
  })

  it('manko (mindre inbetalt) → debet 3790, balanserar', () => {
    // Försäljning 1250 men bara 1200 inbetalt → 50 saknas (manko)
    const { rows, kassadiff, totalDebet, totalKredit } = byggDagskassaRader({
      net: { 25: 1000 }, moms: { 25: 250 }, kontant: 700, kort: 500,
    })
    expect(kassadiff).toBe(-50)
    expect(rad(rows, '3790')).toMatchObject({ debet: 50, kredit: 0 })
    expect(totalDebet).toBe(totalKredit)
  })

  it('överskott (mer inbetalt) → kredit 3790, balanserar', () => {
    const { rows, kassadiff, totalDebet, totalKredit } = byggDagskassaRader({
      net: { 25: 1000 }, moms: { 25: 250 }, kontant: 1300, kort: 0,
    })
    expect(kassadiff).toBe(50)
    expect(rad(rows, '3790')).toMatchObject({ debet: 0, kredit: 50 })
    expect(totalDebet).toBe(totalKredit)
  })

  it('flera momssatser + kontant och kort → korrekt kontering, debet = kredit', () => {
    const res = byggDagskassaRader({
      net: { 25: 800, 12: 500, 6: 200, 0: 100 },
      moms: { 25: 200, 12: 60, 6: 12 },
      kontant: 1000, kort: 872,
    })
    expect(rad(res.rows, '3001')).toMatchObject({ kredit: 800 })
    expect(rad(res.rows, '3002')).toMatchObject({ kredit: 500 })
    expect(rad(res.rows, '3003')).toMatchObject({ kredit: 200 })
    expect(rad(res.rows, '3004')).toMatchObject({ kredit: 100 })
    expect(rad(res.rows, '2611')).toMatchObject({ kredit: 200 })
    expect(rad(res.rows, '1580')).toMatchObject({ debet: 872 })
    expect(res.grandTotal).toBe(1872)
    expect(res.payments).toBe(1872)
    expect(res.kassadiff).toBe(0)
    expect(sum(res.rows, 'debet')).toBe(sum(res.rows, 'kredit'))
  })

  it('momsfri-only dag → krediterar 3004, ingen moms', () => {
    const { rows } = byggDagskassaRader({ net: { 0: 500 }, moms: {}, kontant: 500, kort: 0 })
    expect(rad(rows, '3004')).toMatchObject({ kredit: 500 })
    expect(rad(rows, '2611')).toBeUndefined()
  })

  it('3790 är konfigurerat konto för kassadifferens', () => {
    expect(DAGSKASSA_ACC.kassadiff).toBe('3790')
  })
})

describe('dagskassaFromTolkning', () => {
  it('plockar ut datum, varugrupper, moms och betalsätt', () => {
    const v = dagskassaFromTolkning({
      dagskassa: {
        datum: '2026-01-02', forsaljning_25: 800, forsaljning_12: 500, forsaljning_6: 200, forsaljning_0: 100,
        moms_25: 200, moms_12: 60, moms_6: 12, kontant: 1000, kort: 872,
      },
    })
    expect(v).toMatchObject({ datum: '2026-01-02', vg25: 800, vg12: 500, vg6: 200, vg0: 100, moms25: 200, kontant: 1000, kort: 872 })
  })

  it('returnerar null när underlaget inte är en dagskassa', () => {
    expect(dagskassaFromTolkning({ typ: 'kvitto' })).toBeNull()
    expect(dagskassaFromTolkning(null)).toBeNull()
  })

  it('returnerar null när dagskassa-objektet är tomt på belopp', () => {
    expect(dagskassaFromTolkning({ dagskassa: { datum: '2026-01-02' } })).toBeNull()
  })

  it('hanterar svenska tal-strängar och ogiltigt datum', () => {
    const v = dagskassaFromTolkning({ dagskassa: { datum: '2026/01/02', forsaljning_25: '1 234,50' } })
    expect(v.datum).toBeNull()
    expect(v.vg25).toBe(1234.5)
  })
})
