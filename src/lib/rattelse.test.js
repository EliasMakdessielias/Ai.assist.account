import { describe, it, expect } from 'vitest'
import { lockEndDate, arLastDatum, foreslaRattelsedatum } from './rattelse'

describe('lockEndDate', () => {
  it('YYYY-MM -> sista dagen i månaden (inkl. skottår)', () => {
    expect(lockEndDate('2026-03')).toBe('2026-03-31')
    expect(lockEndDate('2026-06')).toBe('2026-06-30')
    expect(lockEndDate('2024-02')).toBe('2024-02-29')
    expect(lockEndDate('2026-12')).toBe('2026-12-31')
  })
  it('YYYY-MM-DD används som det är; ogiltigt/saknat -> null', () => {
    expect(lockEndDate('2026-03-15')).toBe('2026-03-15')
    expect(lockEndDate(null)).toBeNull()
    expect(lockEndDate('')).toBeNull()
    expect(lockEndDate('mars')).toBeNull()
  })
})

describe('arLastDatum', () => {
  it('datum inom låset är låst, efter låset öppet', () => {
    expect(arLastDatum('2026-03-31', '2026-03')).toBe(true)
    expect(arLastDatum('2026-02-01', '2026-03')).toBe(true)
    expect(arLastDatum('2026-04-01', '2026-03')).toBe(false)
  })
  it('utan lås är inget låst', () => {
    expect(arLastDatum('2026-01-01', null)).toBe(false)
  })
})

describe('foreslaRattelsedatum', () => {
  it('öppen period: originalets datum, ingen låst-info', () => {
    expect(foreslaRattelsedatum('2026-06-11', '2026-03')).toEqual({ datum: '2026-06-11', lastPeriod: false })
    expect(foreslaRattelsedatum('2026-06-11', null)).toEqual({ datum: '2026-06-11', lastPeriod: false })
  })
  it('låst period: första dagen efter låset + låst-info (visas för användaren)', () => {
    expect(foreslaRattelsedatum('2026-02-15', '2026-03')).toEqual({ datum: '2026-04-01', lastPeriod: true })
    expect(foreslaRattelsedatum('2026-03-31', '2026-03')).toEqual({ datum: '2026-04-01', lastPeriod: true })
  })
  it('årsskifte: lås i december -> 1 januari nästa år', () => {
    expect(foreslaRattelsedatum('2025-11-05', '2025-12')).toEqual({ datum: '2026-01-01', lastPeriod: true })
  })
})
