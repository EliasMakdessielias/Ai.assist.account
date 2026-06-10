import { describe, it, expect } from 'vitest'
import {
  missingKonteringAccounts, reactivatableAccounts,
  detectCreditInvoice, buildSupplierInvoicePosting, costRowsFromKontering, reconcileCostRows,
  signedHeaderAmount, amountMagnitude,
} from './leverantorsfaktura'

const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100
const row = (rows, nr) => rows.find(r => r.nr === nr)

describe('missingKonteringAccounts', () => {
  const plan = ['2440', '2640', '4000', '3740']

  it('returnerar tomt när alla konton finns', () => {
    const rows = [{ nr: '2440' }, { nr: '2640' }, { nr: '4000' }]
    expect(missingKonteringAccounts(rows, plan)).toEqual([])
  })

  it('flaggar konton som saknas i kontoplanen', () => {
    const rows = [{ nr: '2440' }, { nr: '5999' }, { nr: '4000' }]
    expect(missingKonteringAccounts(rows, plan)).toEqual(['5999'])
  })

  it('avduplicerar och behåller inmatningsordning', () => {
    const rows = [{ nr: '5999' }, { nr: '4000' }, { nr: '5999' }, { nr: '6111' }]
    expect(missingKonteringAccounts(rows, plan)).toEqual(['5999', '6111'])
  })

  it('ignorerar tomma kontonummer', () => {
    const rows = [{ nr: '' }, { nr: '2440' }, {}]
    expect(missingKonteringAccounts(rows, plan)).toEqual([])
  })

  it('accepterar Set och kontoobjekt som kontoplan', () => {
    expect(missingKonteringAccounts([{ nr: '4000' }], new Set(['4000']))).toEqual([])
    const objs = [{ account_nr: '4000' }, { account_nr: '2440' }]
    expect(missingKonteringAccounts([{ nr: '4000' }, { nr: '9000' }], objs)).toEqual(['9000'])
  })
})

describe('reactivatableAccounts', () => {
  const accounts = [
    { account_nr: '2440', is_active: false, is_locked: true },  // låst – ska EJ röras
    { account_nr: '2640', is_active: false, is_locked: true },  // låst – ska EJ röras
    { account_nr: '4000', is_active: true, is_locked: false },  // redan aktivt
    { account_nr: '6110', is_active: false, is_locked: false }, // inaktivt, ej låst → återaktivera
  ]

  it('återaktiverar endast inaktiva, icke-låsta konton som används', () => {
    const rows = [{ nr: '2440' }, { nr: '2640' }, { nr: '4000' }, { nr: '6110' }]
    expect(reactivatableAccounts(rows, accounts)).toEqual(['6110'])
  })

  it('rör aldrig låsta konton även om de är inaktiva och används', () => {
    const rows = [{ nr: '2440' }, { nr: '2640' }]
    expect(reactivatableAccounts(rows, accounts)).toEqual([])
  })

  it('tar bara med konton som faktiskt används i konteringen', () => {
    const rows = [{ nr: '4000' }]
    expect(reactivatableAccounts(rows, accounts)).toEqual([])
  })

  it('hanterar tomma indata', () => {
    expect(reactivatableAccounts([], accounts)).toEqual([])
    expect(reactivatableAccounts(null, null)).toEqual([])
  })
})

describe('detectCreditInvoice', () => {
  it('"Kreditnota" → kreditfaktura', () => {
    const d = detectCreditInvoice({ beskrivning: 'Kreditnota för konsultarvode', konteringsrader: [] })
    expect(d.isCreditInvoice).toBe(true)
    expect(d.invoiceType).toBe('credit')
    expect(d.sourceEvidence).toBe('kreditnota')
  })

  it('"Kreditfaktura" → kreditfaktura', () => {
    expect(detectCreditInvoice({ beskrivning: 'KREDITFAKTURA 123', konteringsrader: [] }).isCreditInvoice).toBe(true)
  })

  it('"Att erhålla" → kreditfaktura', () => {
    const d = detectCreditInvoice({ beskrivning: 'Belopp att erhålla 1 458', konteringsrader: [] })
    expect(d.isCreditInvoice).toBe(true)
    expect(d.sourceEvidence).toBe('att erhålla')
  })

  it('"credit note" (en) → kreditfaktura', () => {
    expect(detectCreditInvoice({ beskrivning: 'Credit note', konteringsrader: [] }).isCreditInvoice).toBe(true)
  })

  it('uttrycklig OCR-flagga → kreditfaktura', () => {
    expect(detectCreditInvoice({ invoice_type: 'credit', konteringsrader: [] }).isCreditInvoice).toBe(true)
    expect(detectCreditInvoice({ is_credit_invoice: true, konteringsrader: [] }).isCreditInvoice).toBe(true)
  })

  it('2440 på debet → kreditfaktura (strukturell signal)', () => {
    const d = detectCreditInvoice({ beskrivning: 'Faktura', konteringsrader: [{ konto: '2440', debet: 1458, kredit: 0 }] })
    expect(d.isCreditInvoice).toBe(true)
    expect(d.sourceEvidence).toBe('2440 på debet')
  })

  it('negativ total → kreditfaktura', () => {
    expect(detectCreditInvoice({ beskrivning: 'x', belopp_inkl_moms: -1458, konteringsrader: [] }).isCreditInvoice).toBe(true)
  })

  it('vanlig faktura → INTE kreditfaktura', () => {
    const d = detectCreditInvoice({ beskrivning: 'Faktura konsultarvode', belopp_inkl_moms: 1458, konteringsrader: [{ konto: '2440', debet: 0, kredit: 1458 }] })
    expect(d.isCreditInvoice).toBe(false)
    expect(d.invoiceType).toBe('debit')
  })

  it('betalkredit/kreditvillkor ska INTE klassas som kreditfaktura', () => {
    expect(detectCreditInvoice({ beskrivning: 'Faktura. Betalningsvillkor: 30 dagar kredit. Kreditgräns 50000.', belopp_inkl_moms: 1000, konteringsrader: [{ konto: '2440', debet: 0, kredit: 1000 }] }).isCreditInvoice).toBe(false)
  })
})

describe('signedHeaderAmount / amountMagnitude (ingen dubbel-negativ)', () => {
  it('magnitud är alltid positiv', () => {
    expect(amountMagnitude(-1458)).toBe(1458)
    expect(amountMagnitude('−291,50')).toBe(291.5)
    expect(amountMagnitude('1 458,00')).toBe(1458)
  })

  it('kreditfaktura → negativt, vanlig → positivt', () => {
    expect(signedHeaderAmount(1458, true)).toBe(-1458)
    expect(signedHeaderAmount(1458, false)).toBe(1458)
  })

  it('redan negativt OCR-belopp dubbel-negativeras INTE', () => {
    expect(signedHeaderAmount(-1458, true)).toBe(-1458)   // abs först → -1458, inte +1458
    expect(signedHeaderAmount(-291.5, true)).toBe(-291.5)
  })
})

describe('costRowsFromKontering', () => {
  it('plockar bort 244x och 264x, returnerar kostnadsrader + momskonto', () => {
    const { costRows, vatAccount } = costRowsFromKontering([
      { konto: '6550', benamning: 'Konsultarvoden', debet: 0, kredit: 1166 },
      { konto: '2641', benamning: 'Deb. ing. moms', debet: 0, kredit: 291.5 },
      { konto: '2440', debet: 1458, kredit: 0 },
    ])
    expect(costRows).toEqual([{ nr: '6550', name: 'Konsultarvoden', amount: 1166 }])
    expect(vatAccount).toBe('2641')
  })
})

describe('buildSupplierInvoicePosting', () => {
  it('vanlig faktura: kostnad+moms debet, 2440 kredit, balanserar', () => {
    const p = buildSupplierInvoicePosting({ isCreditInvoice: false, total: 1250, vat: 250, rows: [{ nr: '4000', name: 'Inköp', amount: 1000 }] })
    expect(row(p.rows, '4000').debet).toBe(1000)
    expect(row(p.rows, '2640').debet).toBe(250)
    expect(row(p.rows, '2440').kredit).toBe(1250)
    expect(p.balanced).toBe(true)
    expect(sum(p.rows, 'debet')).toBe(sum(p.rows, 'kredit'))
  })

  it('kreditfaktura: kostnad+moms kredit, 2440 debet, balanserar (referensexempel)', () => {
    const p = buildSupplierInvoicePosting({
      isCreditInvoice: true, total: -1458, vat: -291.5,
      rows: [{ nr: '6550', name: 'Konsultarvoden', amount: 1166 }], vatAccount: '2641',
    })
    expect(row(p.rows, '6550').kredit).toBe(1166)
    expect(row(p.rows, '2641').kredit).toBe(291.5)
    expect(row(p.rows, '2440').debet).toBe(1458)
    // Differens 1458 − 1457,50 = 0,50 → öresutjämning på KREDIT (balanserar debet-sidan)
    expect(row(p.rows, '3740').kredit).toBe(0.5)
    expect(p.balanced).toBe(true)
    expect(sum(p.rows, 'debet')).toBe(1458)
    expect(sum(p.rows, 'kredit')).toBe(1458)
  })

  it('öresutjämning får rätt sida åt båda håll', () => {
    // Konstruerad diff där debet < kredit för normal faktura → 3740 på debet
    const p = buildSupplierInvoicePosting({ isCreditInvoice: false, total: 100, vat: 0, rows: [{ nr: '4000', amount: 100.5 }] })
    // debet 100,50 (kostnad) vs kredit 100 (2440) → diff +0,50 → 3740 kredit 0,50
    expect(row(p.rows, '3740').kredit).toBe(0.5)
    expect(p.balanced).toBe(true)
  })

  it('ingen öresutjämning när det redan balanserar', () => {
    const p = buildSupplierInvoicePosting({ isCreditInvoice: false, total: 1250, vat: 250, rows: [{ nr: '4000', amount: 1000 }] })
    expect(row(p.rows, '3740')).toBeUndefined()
    expect(p.diff).toBe(0)
  })

  it('belopp i debet/kredit är alltid positiva även för kreditfaktura', () => {
    const p = buildSupplierInvoicePosting({ isCreditInvoice: true, total: -1458, vat: -291.5, rows: [{ nr: '6550', amount: 1166 }], vatAccount: '2641' })
    for (const r of p.rows) { expect(r.debet).toBeGreaterThanOrEqual(0); expect(r.kredit).toBeGreaterThanOrEqual(0) }
  })
})

describe('reconcileCostRows (OCR-dubbelräkning)', () => {
  it('behåller raderna när de summerar ≈ nettot (öresavrundning ok)', () => {
    // 365 mot netto 364,75 → diff 0,25 ≤ tol → behåll (byggaren lägger öresutjämning)
    expect(reconcileCostRows([{ nr: '6592', amount: 365 }], 364.75)).toEqual([{ nr: '6592', name: '', amount: 365 }])
  })

  it('ett konto som dubbelräknats → en nettorad (Spiris-fallet)', () => {
    // 365 + 16 = 381, men 16 ingår redan i 365. Netto = 456 − 91,25 = 364,75.
    const out = reconcileCostRows([{ nr: '6592', amount: 365 }, { nr: '6592', amount: 16 }], 364.75)
    expect(out).toEqual([{ nr: '6592', name: '', amount: 364.75 }])
  })

  it('flera konton som inte stämmer → proportionell skalning, summa = netto', () => {
    const out = reconcileCostRows([{ nr: '5910', amount: 200 }, { nr: '6071', amount: 200 }], 300)
    expect(out.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(300, 2)
  })
})

describe('Spiris-faktura: dubbelräkning korrigeras och balanserar', () => {
  it('OCR ger 6592:365 + 6592:16 (dubbelräkning) → balanserad kontering, differens 0', () => {
    const { costRows, vatAccount } = costRowsFromKontering([
      { konto: '6592', benamning: 'Bokningstjänst', debet: 365, kredit: 0 },
      { konto: '6592', benamning: 'Bokningstjänst', debet: 16, kredit: 0 },
      { konto: '2641', benamning: 'Debiterad ingående moms', debet: 91.25, kredit: 0 },
      { konto: '2440', benamning: 'Leverantörsskulder', debet: 0, kredit: 456 },
    ])
    const T = 456, M = 91.25
    const fixed = reconcileCostRows(costRows, T - M)
    const p = buildSupplierInvoicePosting({ isCreditInvoice: false, total: T, vat: M, rows: fixed, vatAccount })
    expect(row(p.rows, '6592').debet).toBe(364.75)   // ingen dubbelräkning
    expect(row(p.rows, '2641').debet).toBe(91.25)
    expect(row(p.rows, '2440').kredit).toBe(456)
    expect(p.balanced).toBe(true)
    expect(sum(p.rows, 'debet')).toBe(456)
    expect(sum(p.rows, 'kredit')).toBe(456)
  })
})
