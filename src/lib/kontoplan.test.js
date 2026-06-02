import { describe, it, expect } from 'vitest'
import {
  parseDelimited, mapColumns, parseBool, parseAccountsFile,
  basClass, basType, validateAccounts, planImport,
} from './kontoplan'

// Exempel i Fortnox-exportformat (semikolon)
const FORTNOX = [
  'IsActive;AccountNumber;AccountName;VatCodeAndPercent;IsCostCenterAllowed;IsProjectAllowed;AllowTransactionText;IsBlockedForManualBooking',
  'True;1930;Företagskonto;;False;False;True;True',
  'False;3041;Försäljn tjänst 25% sv;05-25%;True;True;True;False',
  'True;2611;Utgående moms på försäljning inom Sverige, 25%;10-25%;False;False;True;False',
].join('\r\n')

describe('parseDelimited', () => {
  it('upptäcker semikolon och tolkar rubrik + rader', () => {
    const { header, rows } = parseDelimited(FORTNOX)
    expect(header[1]).toBe('AccountNumber')
    expect(rows).toHaveLength(3)
    expect(rows[0][1]).toBe('1930')
  })
  it('hanterar citerade fält med kommatecken', () => {
    const { rows } = parseDelimited('a;b\n"text, med komma";2')
    expect(rows[0][0]).toBe('text, med komma')
  })
  it('returnerar tomt för tom indata', () => {
    expect(parseDelimited('').rows).toHaveLength(0)
  })
})

describe('mapColumns', () => {
  it('mappar Fortnox-rubriker till fält', () => {
    const map = mapColumns(['IsActive', 'AccountNumber', 'AccountName', 'VatCodeAndPercent'])
    expect(map.account_nr).toBe(1)
    expect(map.name).toBe(2)
    expect(map.is_active).toBe(0)
    expect(map.vat_code).toBe(3)
  })
  it('mappar projektets egna rubriker (account_nr/name)', () => {
    const map = mapColumns(['account_nr', 'name', 'is_active'])
    expect(map.account_nr).toBe(0)
    expect(map.name).toBe(1)
  })
})

describe('parseBool', () => {
  it('tolkar sanningsvärden', () => {
    expect(parseBool('True')).toBe(true)
    expect(parseBool('False')).toBe(false)
    expect(parseBool('ja')).toBe(true)
    expect(parseBool('0')).toBe(false)
    expect(parseBool('', false)).toBe(false)
  })
})

describe('parseAccountsFile', () => {
  it('tolkar Fortnox-fil till konton', () => {
    const res = parseAccountsFile(FORTNOX)
    expect(res.ok).toBe(true)
    expect(res.accounts).toHaveLength(3)
    expect(res.accounts[0]).toMatchObject({ account_nr: '1930', name: 'Företagskonto', is_active: true })
    expect(res.accounts[1]).toMatchObject({ account_nr: '3041', is_active: false, vat_code: '05-25%' })
  })
  it('returnerar fel när nyckelkolumner saknas', () => {
    const res = parseAccountsFile('foo;bar\n1;2')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/kontonummer/i)
  })
})

describe('bas-klass och typ', () => {
  it('härleder klass från första siffran', () => {
    expect(basClass('1930')).toBe(1)
    expect(basClass('3041')).toBe(3)
    expect(basClass('abc')).toBeNull()
  })
  it('härleder kontotyp', () => {
    expect(basType('1930')).toBe('tillgång')
    expect(basType('2440')).toBe('eget_kapital_skuld')
    expect(basType('3041')).toBe('intäkt')
    expect(basType('5010')).toBe('kostnad')
    expect(basType('8410')).toBe('finansiell')
  })
})

describe('validateAccounts', () => {
  it('godkänner giltiga konton', () => {
    const v = validateAccounts([
      { _line: 2, account_nr: '1930', name: 'Företagskonto' },
      { _line: 3, account_nr: '3041', name: 'Försäljning' },
    ])
    expect(v.valid).toBe(true)
    expect(v.errors).toHaveLength(0)
  })
  it('flaggar icke-numeriskt kontonummer och saknad benämning', () => {
    const v = validateAccounts([{ _line: 2, account_nr: '19A0', name: '' }])
    expect(v.valid).toBe(false)
    expect(v.errors.some(e => /siffror/.test(e.message))).toBe(true)
    expect(v.errors.some(e => /benämning/.test(e.message))).toBe(true)
  })
  it('upptäcker dubbletter i filen', () => {
    const v = validateAccounts([
      { _line: 2, account_nr: '1930', name: 'A' },
      { _line: 3, account_nr: '1930', name: 'B' },
    ])
    expect(v.duplicatesInFile).toContain('1930')
    expect(v.valid).toBe(false)
  })
})

describe('planImport', () => {
  const accounts = [
    { account_nr: '1930', name: 'A' },
    { account_nr: '3041', name: 'B' },
    { account_nr: '9999', name: 'Ny' },
  ]
  const existing = ['1930', '3041', '2440']

  it('läge add: bara nya läggs till, befintliga hoppas över', () => {
    const p = planImport(accounts, existing, 'add')
    expect(p.inserted).toBe(1) // 9999
    expect(p.skipped).toBe(2)  // 1930, 3041
    expect(p.updated).toBe(0)
  })
  it('läge update: bara befintliga uppdateras, nya hoppas över', () => {
    const p = planImport(accounts, existing, 'update')
    expect(p.updated).toBe(2)
    expect(p.skipped).toBe(1) // 9999
  })
  it('läge replace: upsert + saknade konton rapporteras', () => {
    const p = planImport(accounts, existing, 'replace')
    expect(p.inserted).toBe(1)        // 9999
    expect(p.updated).toBe(2)         // 1930, 3041
    expect(p.missing).toEqual(['2440'])
    expect(p.missingCount).toBe(1)
  })
})
