import { describe, it, expect } from 'vitest'
import {
  granskaMomsFynd, isInputVat, isOutputVat, outputVatRate, isCost, isRevenue, salesAccountRate,
} from './momskontroll'

// Bygg en verifikation + rader snabbt.
let _id = 0
function ver(rows, extra = {}) {
  const id = `v${++_id}`
  const total_debet = rows.reduce((s, r) => s + (r.debet || 0), 0)
  const total_kredit = rows.reduce((s, r) => s + (r.kredit || 0), 0)
  return { v: { id, ver_nr: id.toUpperCase(), datum: '2026-03-15', total_debet, total_kredit, ...extra }, rows }
}
function kor(vlist, supplierInvoices = []) {
  const vers = vlist.map(x => x.v)
  const rowsByVer = {}; vlist.forEach(x => { rowsByVer[x.v.id] = x.rows })
  return granskaMomsFynd({ vers, rowsByVer, supplierInvoices })
}
const koder = f => f.map(x => x.kod)

describe('kontoklassning', () => {
  it('känner igen moms-, kostnads- och intäktskonton', () => {
    expect(isInputVat('2641')).toBe(true)
    expect(isInputVat('2640')).toBe(true)
    expect(isInputVat('2611')).toBe(false)
    expect(isOutputVat('2611')).toBe(true)
    expect(isOutputVat('2621')).toBe(true)
    expect(isOutputVat('2631')).toBe(true)
    expect(isOutputVat('2641')).toBe(false)
    expect(outputVatRate('2611')).toBe(25)
    expect(outputVatRate('2621')).toBe(12)
    expect(outputVatRate('2631')).toBe(6)
    expect(isCost('4000')).toBe(true)
    expect(isCost('7010')).toBe(true)
    expect(isCost('3740')).toBe(false) // öresavrundning räknas inte som kostnad
    expect(isRevenue('3001')).toBe(true)
    expect(isRevenue('3740')).toBe(false)
    expect(salesAccountRate('3001')).toBe(25)
    expect(salesAccountRate('3004')).toBe(0)
  })
})

describe('korrekt bokföring ger inga fynd', () => {
  it('inköp 25% moms', () => {
    const f = kor([ver([
      { account_nr: '4000', debet: 800, kredit: 0 },
      { account_nr: '2641', debet: 200, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1000 },
    ])])
    expect(f).toEqual([])
  })
  it('försäljning 25% moms', () => {
    const f = kor([ver([
      { account_nr: '1510', debet: 1250, kredit: 0 },
      { account_nr: '3001', debet: 0, kredit: 1000 },
      { account_nr: '2611', debet: 0, kredit: 250 },
    ])])
    expect(f).toEqual([])
  })
  it('öresavrundning stör inte', () => {
    const f = kor([ver([
      { account_nr: '4000', debet: 800.40, kredit: 0 },
      { account_nr: '2641', debet: 200.10, kredit: 0 },
      { account_nr: '3740', debet: 0, kredit: 0.50 },
      { account_nr: '2440', debet: 0, kredit: 1000 },
    ])])
    expect(f).toEqual([])
  })
})

describe('moms stämmer inte med kostnads-/intäktskonto', () => {
  it('ingående moms med fel sats (10% istället för 25%)', () => {
    const f = kor([ver([
      { account_nr: '4000', debet: 1000, kredit: 0 },
      { account_nr: '2641', debet: 100, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1100 },
    ])])
    expect(koder(f)).toContain('moms_fel_sats')
    expect(f[0].sev).toBe('fel')
  })
  it('utgående moms med fel sats', () => {
    const f = kor([ver([
      { account_nr: '1510', debet: 1080, kredit: 0 },
      { account_nr: '3001', debet: 0, kredit: 1000 },
      { account_nr: '2611', debet: 0, kredit: 80 },
    ])])
    expect(koder(f)).toContain('moms_fel_sats')
  })
  it('moms matchar inte försäljningskontot (3001=25% men 6% bokförd via 2631)', () => {
    const f = kor([ver([
      { account_nr: '1510', debet: 1060, kredit: 0 },
      { account_nr: '3001', debet: 0, kredit: 1000 },
      { account_nr: '2631', debet: 0, kredit: 60 },
    ])])
    expect(koder(f)).toContain('moms_fel_konto')
  })
})

describe('moms i fel riktning', () => {
  it('ingående moms på en försäljning', () => {
    const f = kor([ver([
      { account_nr: '1510', debet: 1250, kredit: 0 },
      { account_nr: '3001', debet: 0, kredit: 1000 },
      { account_nr: '2641', debet: 0, kredit: 250 },
    ])])
    expect(koder(f)).toContain('moms_fel_riktning')
  })
  it('utgående moms på ett inköp', () => {
    const f = kor([ver([
      { account_nr: '4000', debet: 1000, kredit: 0 },
      { account_nr: '2611', debet: 250, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1250 },
    ])])
    expect(koder(f)).toContain('moms_fel_riktning')
  })
})

describe('moms utan motkonto', () => {
  it('ingående moms utan kostnadskonto', () => {
    const f = kor([ver([
      { account_nr: '2641', debet: 200, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 200 },
    ])])
    expect(koder(f)).toContain('moms_utan_konto')
  })
})

describe('momspliktig försäljning utan moms', () => {
  it('3001 utan utgående moms flaggas', () => {
    const f = kor([ver([
      { account_nr: '1510', debet: 1000, kredit: 0 },
      { account_nr: '3001', debet: 0, kredit: 1000 },
    ])])
    expect(koder(f)).toContain('moms_saknas')
  })
  it('momsfri försäljning (3004) flaggas INTE', () => {
    const f = kor([ver([
      { account_nr: '1510', debet: 1000, kredit: 0 },
      { account_nr: '3004', debet: 0, kredit: 1000 },
    ])])
    expect(f).toEqual([])
  })
})

describe('leverantörsfakturor bokförda fel', () => {
  it('fel belopp mot fakturan', () => {
    const v = ver([
      { account_nr: '4000', debet: 800, kredit: 0 },
      { account_nr: '2641', debet: 200, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1000 },
    ])
    const f = kor([v], [{ verifikation_id: v.v.id, bokford: true, makulerad: false, invoice_nr: 'F1', total_amount: 1500, vat_amount: 200 }])
    expect(koder(f)).toContain('lev_fel_belopp')
  })
  it('moms saknas i bokföringen men finns på fakturan', () => {
    const v = ver([
      { account_nr: '4000', debet: 1000, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1000 },
    ])
    const f = kor([v], [{ verifikation_id: v.v.id, bokford: true, makulerad: false, invoice_nr: 'F2', total_amount: 1000, vat_amount: 200 }])
    expect(koder(f)).toContain('lev_moms_saknas')
  })
  it('fakturans moms matchar inte bokförd ingående moms', () => {
    const v = ver([
      { account_nr: '4000', debet: 900, kredit: 0 },
      { account_nr: '2641', debet: 100, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1000 },
    ])
    // Faktura säger moms 250 (men 100 bokförd) – och 900-net stämmer inte heller med 100 (≈11%)
    const f = kor([v], [{ verifikation_id: v.v.id, bokford: true, makulerad: false, invoice_nr: 'F3', total_amount: 1000, vat_amount: 250 }])
    expect(koder(f)).toContain('lev_fel_moms')
  })
  it('makulerad faktura kontrolleras inte', () => {
    const v = ver([{ account_nr: '4000', debet: 1000, kredit: 0 }, { account_nr: '2440', debet: 0, kredit: 1000 }])
    const f = kor([v], [{ verifikation_id: v.v.id, bokford: true, makulerad: true, invoice_nr: 'F4', total_amount: 9999, vat_amount: 999 }])
    expect(f).toEqual([])
  })
  it('korrekt bokförd faktura ger inga fynd', () => {
    const v = ver([
      { account_nr: '4000', debet: 800, kredit: 0 },
      { account_nr: '2641', debet: 200, kredit: 0 },
      { account_nr: '2440', debet: 0, kredit: 1000 },
    ])
    const f = kor([v], [{ verifikation_id: v.v.id, bokford: true, makulerad: false, invoice_nr: 'F5', total_amount: 1000, vat_amount: 200 }])
    expect(f).toEqual([])
  })
  it('kreditfaktura (negativa belopp) ger inga fynd', () => {
    const v = ver([
      { account_nr: '2440', debet: 1000, kredit: 0 },
      { account_nr: '4000', debet: 0, kredit: 800 },
      { account_nr: '2641', debet: 0, kredit: 200 },
    ])
    const f = kor([v], [{ verifikation_id: v.v.id, bokford: true, makulerad: false, invoice_nr: 'K1', total_amount: -1000, vat_amount: -200, kreditfaktura: true }])
    expect(f).toEqual([])
  })
})
