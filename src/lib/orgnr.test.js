import { describe, it, expect } from 'vitest'
import { normalizeOrgNr, luhnValid, isValidOrgNr, formatOrgNr } from './orgnr'

// Giltiga svenska org-/personnummer (Luhn-korrekta).
const VALID = '5560360793'        // Skandinaviska Enskilda Banken
const VALID2 = '2120000142'       // (Luhn-korrekt testnummer)

describe('normalizeOrgNr', () => {
  it('tar bort bindestreck och mellanslag', () => {
    expect(normalizeOrgNr('556036-0793')).toBe('5560360793')
    expect(normalizeOrgNr(' 556036 0793 ')).toBe('5560360793')
  })
  it('kortar 12-siffrigt (sekel) till 10', () => {
    expect(normalizeOrgNr('165560360793')).toBe('5560360793')
  })
  it('ofullständigt ger tom sträng', () => {
    expect(normalizeOrgNr('5560')).toBe('')
    expect(normalizeOrgNr('')).toBe('')
    expect(normalizeOrgNr(null)).toBe('')
  })
})

describe('luhnValid', () => {
  it('godkänner korrekt kontrollsiffra', () => {
    expect(luhnValid(VALID)).toBe(true)
    expect(luhnValid(VALID2)).toBe(true)
  })
  it('underkänner fel kontrollsiffra', () => {
    expect(luhnValid('5560360794')).toBe(false)   // sista siffran ändrad (var 3)
    expect(luhnValid('5560360790')).toBe(false)
  })
  it('kräver exakt 10 siffror', () => {
    expect(luhnValid('556036079')).toBe(false)
    expect(luhnValid('55603607931')).toBe(false)
    expect(luhnValid('abcdefghij')).toBe(false)
  })
})

describe('isValidOrgNr', () => {
  it('accepterar båda formaten med giltig kontrollsiffra', () => {
    expect(isValidOrgNr('556036-0793')).toBe(true)
    expect(isValidOrgNr('5560360793')).toBe(true)
    expect(isValidOrgNr('165560360793')).toBe(true)
  })
  it('avvisar ogiltig kontrollsiffra och ofullständigt', () => {
    expect(isValidOrgNr('556036-0790')).toBe(false)   // fel kontrollsiffra
    expect(isValidOrgNr('5560')).toBe(false)
    expect(isValidOrgNr('')).toBe(false)
  })
})

describe('formatOrgNr', () => {
  it('formaterar 10 siffror till XXXXXX-XXXX', () => {
    expect(formatOrgNr('5560360793')).toBe('556036-0793')
    expect(formatOrgNr('165560360793')).toBe('556036-0793')
  })
  it('lämnar ofullständig indata oförändrad', () => {
    expect(formatOrgNr('5560')).toBe('5560')
  })
})
