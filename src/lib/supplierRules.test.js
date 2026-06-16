import { describe, it, expect } from 'vitest'
import {
  belopptyp, ruleKeyword, ruleConfidence, findMatchingRule, bestRuleFor, rulesFromKontering,
  avvikerFranMonster, normalizeMerchant, RULE_AUTOFILL, RULE_SUGGEST,
} from './supplierRules'

describe('normalizeMerchant', () => {
  it('normaliserar butiksnamn för stabil matchning', () => {
    expect(normalizeMerchant('  Clas Ohlson AB! ')).toBe('clas ohlson ab')
    expect(normalizeMerchant('ICA Maxi')).toBe(normalizeMerchant('ica  maxi'))
    expect(normalizeMerchant(null)).toBe('')
  })
})

describe('belopptyp', () => {
  it('klassar konto efter typ', () => {
    expect(belopptyp('6212')).toBe('kostnad')
    expect(belopptyp('2641')).toBe('ingaende_moms')
    expect(belopptyp('2611')).toBe('utgaende_moms')
    expect(belopptyp('2440')).toBe('leverantorsskuld')
    expect(belopptyp('3740')).toBe('oresavrundning')
  })
})

describe('ruleKeyword', () => {
  it('normaliserar och kortar', () => {
    expect(ruleKeyword('  Bredband / Internet!! ')).toBe('bredband internet')
    expect(ruleKeyword(null)).toBe('')
  })
})

describe('ruleConfidence', () => {
  it('stiger med bekräftelser', () => {
    expect(ruleConfidence({ confirmation_count: 1 })).toBe(0.4)
    expect(ruleConfidence({ confirmation_count: 2 })).toBe(0.7)
    expect(ruleConfidence({ confirmation_count: 3 })).toBe(0.9)
    expect(ruleConfidence({ confirmation_count: 1 })).toBeLessThan(RULE_AUTOFILL)
    expect(ruleConfidence({ confirmation_count: 3 })).toBeGreaterThanOrEqual(RULE_AUTOFILL)
  })
  it('sänks vid korrigeringar', () => {
    expect(ruleConfidence({ confirmation_count: 3, correction_count: 2 })).toBeLessThan(ruleConfidence({ confirmation_count: 3 }))
  })
})

describe('findMatchingRule', () => {
  const rules = [
    { id: 'a', account_number: '6212', invoice_category: 'debit', line_keyword: 'mobil' },
    { id: 'b', account_number: '6230', invoice_category: 'debit', line_keyword: 'bredband' },
  ]
  it('matchar på konto + kategori + nyckelord', () => {
    expect(findMatchingRule(rules, { account_number: '6230', invoice_category: 'debit', line_keyword: 'Bredband' })?.id).toBe('b')
    expect(findMatchingRule(rules, { account_number: '9999', invoice_category: 'debit', line_keyword: 'mobil' })).toBe(null)
  })
})

describe('bestRuleFor', () => {
  const rules = [
    { account_number: '6212', line_keyword: 'mobil', invoice_category: 'debit', confidence_score: 0.9, confirmation_count: 3, status: 'active' },
    { account_number: '6230', line_keyword: 'bredband', invoice_category: 'debit', confidence_score: 0.7, confirmation_count: 2, status: 'active' },
    { account_number: '4000', line_keyword: null, invoice_category: 'debit', confidence_score: 0.4, confirmation_count: 1, status: 'active' },
  ]
  it('väljer nyckelordsmatch', () => {
    expect(bestRuleFor(rules, { keyword: 'mobilabonnemang', invoiceCategory: 'debit' }).account_number).toBe('6212')
    expect(bestRuleFor(rules, { keyword: 'Bredband', invoiceCategory: 'debit' }).account_number).toBe('6230')
  })
  it('faller tillbaka på generell regel utan nyckelord', () => {
    expect(bestRuleFor(rules, { keyword: 'okänt', invoiceCategory: 'debit' }).account_number).toBe('4000')
  })
  it('ignorerar inaktiva regler och för låg confidence', () => {
    expect(bestRuleFor([{ account_number: '6212', confidence_score: 0.9, status: 'disabled' }], {})).toBe(null)
    expect(bestRuleFor([{ account_number: '6212', confidence_score: 0.2, status: 'active' }], {})).toBe(null)
  })
})

describe('rulesFromKontering', () => {
  it('en regel per kostnadskonto med momskonto + andel', () => {
    const rows = [
      { nr: '2440', namn: 'Leverantörsskulder', debet: 0, kredit: 1250 },
      { nr: '2640', namn: 'Ingående moms', debet: 250, kredit: 0 },
      { nr: '6212', namn: 'Mobiltelefon', info: 'Mobil', debet: 600, kredit: 0 },
      { nr: '6230', namn: 'Datakommunikation', info: 'Bredband', debet: 400, kredit: 0 },
    ]
    const out = rulesFromKontering(rows, { vat_rate: 25 })
    expect(out).toHaveLength(2)
    const mobil = out.find(r => r.account_number === '6212')
    expect(mobil.line_keyword).toBe('mobil')
    expect(mobil.vat_account).toBe('2640')
    expect(mobil.vat_rate).toBe(25)
    expect(mobil.allocation_share).toBe(0.6)
  })
  it('ignorerar moms/skuld/öres-rader', () => {
    const rows = [{ nr: '2440', kredit: 100 }, { nr: '2640', debet: 20 }, { nr: '3740', kredit: 0.5 }]
    expect(rulesFromKontering(rows)).toEqual([])
  })
})

describe('avvikerFranMonster', () => {
  const rules = [{ account_number: '6212', confidence_score: 0.9, status: 'active' }]
  it('flaggar okänt kostnadskonto', () => {
    expect(avvikerFranMonster([{ nr: '5020', debet: 100 }], rules)).toBe(true)
  })
  it('flaggar inte känt konto', () => {
    expect(avvikerFranMonster([{ nr: '6212', debet: 100 }], rules)).toBe(false)
  })
  it('ingen historik → ingen avvikelse', () => {
    expect(avvikerFranMonster([{ nr: '5020', debet: 100 }], [])).toBe(false)
  })
})
