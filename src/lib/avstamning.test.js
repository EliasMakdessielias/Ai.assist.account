import { describe, it, expect } from 'vitest'
import { buildUniqueMatches } from './avstamning'

const b = (id, datum, belopp) => ({ id, datum, belopp })

describe('buildUniqueMatches – unik 1:1-matchning', () => {
  it('parar samma belopp inom 7 dagar; varje post ingår i HÖGST ett par', () => {
    const bok = [b('k1', '2026-01-14', -8213), b('k2', '2026-01-22', -5510)]
    const bank = [b('t1', '2026-01-14', -8213), b('t2', '2026-01-22', -5510), b('t3', '2026-01-02', 2500)]
    const m = buildUniqueMatches(bok, bank)
    expect(m).toHaveLength(2)
    expect(m.find(p => p.bokId === 'k1').bankId).toBe('t1')
    expect(m.find(p => p.bokId === 'k2').bankId).toBe('t2')
    const bokIds = m.map(p => p.bokId), bankIds = m.map(p => p.bankId)
    expect(new Set(bokIds).size).toBe(bokIds.length)
    expect(new Set(bankIds).size).toBe(bankIds.length)
  })

  it('dubbletter av samma belopp paras unikt – inga dubbelmatchningar', () => {
    const bok = [b('k1', '2026-01-09', -50), b('k2', '2026-01-10', -50)]
    const bank = [b('t1', '2026-01-09', -50), b('t2', '2026-01-10', -50)]
    const m = buildUniqueMatches(bok, bank)
    expect(m).toHaveLength(2)
    expect(m.find(p => p.bokId === 'k1').bankId).toBe('t1')   // närmast datum
    expect(m.find(p => p.bokId === 'k2').bankId).toBe('t2')
  })

  it('globalt närmaste datum vinner (inte radernas ordning)', () => {
    // t1 ligger 3 dagar från k1 men bara 1 dag från k2 → ska para med k2.
    const bok = [b('k1', '2026-01-01', 100), b('k2', '2026-01-05', 100)]
    const bank = [b('t1', '2026-01-04', 100)]
    const m = buildUniqueMatches(bok, bank)
    expect(m).toHaveLength(1)
    expect(m[0].bokId).toBe('k2')
  })

  it('mer än 7 dagars avstånd eller annat belopp paras ALDRIG', () => {
    const bok = [b('k1', '2026-01-01', 100), b('k2', '2026-01-01', 200)]
    const bank = [b('t1', '2026-01-09', 100), b('t2', '2026-01-02', 200.5)]
    expect(buildUniqueMatches(bok, bank)).toHaveLength(0)
  })

  it('tecknet räknas: −8213 matchar inte +8213', () => {
    const m = buildUniqueMatches([b('k1', '2026-01-14', -8213)], [b('t1', '2026-01-14', 8213)])
    expect(m).toHaveLength(0)
  })

  it('tomma listor ger tomt resultat', () => {
    expect(buildUniqueMatches([], [])).toEqual([])
    expect(buildUniqueMatches(null, undefined)).toEqual([])
  })
})
