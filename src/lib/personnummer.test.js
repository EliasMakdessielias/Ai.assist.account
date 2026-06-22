import { describe, it, expect } from 'vitest'
import { validatePersonnummer, normalizePersonnummer, maskPersonnummer } from './personnummer'

describe('personnummer', () => {
  it('godtar giltigt 10-siffrigt personnummer (rätt Luhn)', () => {
    const r = validatePersonnummer('811218-9876')
    expect(r.valid).toBe(true)
    expect(r.normalized).toBe('811218-9876')
  })

  it('godtar giltigt 12-siffrigt personnummer och normaliserar med århundrade', () => {
    const r = validatePersonnummer('19811218-9876')
    expect(r.valid).toBe(true)
    expect(r.normalized).toBe('19811218-9876')
  })

  it('hanterar siffror utan bindestreck', () => {
    expect(validatePersonnummer('8112189876').valid).toBe(true)
    expect(validatePersonnummer('198112189876').valid).toBe(true)
  })

  it('avvisar fel kontrollsiffra', () => {
    const r = validatePersonnummer('811218-9875')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/kontrollsiffran/i)
  })

  it('avvisar ogiltig månad', () => {
    expect(validatePersonnummer('811318-9876').valid).toBe(false) // månad 13
  })

  it('avvisar fel längd', () => {
    expect(validatePersonnummer('1234').valid).toBe(false)
    expect(validatePersonnummer('').valid).toBe(false)
  })

  it('normaliserar med bindestreck', () => {
    expect(normalizePersonnummer('8112189876')).toBe('811218-9876')
    expect(normalizePersonnummer('198112189876')).toBe('19811218-9876')
  })

  it('maskar de fyra sista siffrorna (GDPR)', () => {
    expect(maskPersonnummer('19811218-9876')).toBe('19811218-****')
    expect(maskPersonnummer('8112189876')).toBe('811218-****')
  })
})
