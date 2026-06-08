import { describe, it, expect } from 'vitest'
import { LENS, MAG, clampLensBox } from './DocMagnifier'

describe('förstoringsglas – inställningar', () => {
  it('lins-storlek = 240px (krav 1)', () => {
    expect(LENS).toBe(240)
    expect(LENS).toBeGreaterThanOrEqual(220)
  })
  it('magnifierScale = 1.75 (krav 2)', () => {
    expect(MAG).toBe(1.75)
  })
})

describe('clampLensBox – alltid helt synlig inom containern (krav 4/5)', () => {
  const rect = { left: 100, top: 50, right: 900, bottom: 700 } // 800x650, toolbar slutar vid top=50

  it('centrerar på muspekaren när det får plats', () => {
    expect(clampLensBox(500, 400, rect)).toEqual({ left: 380, top: 280 })
  })
  it('vid toppen/vänster: klampas in (täcker ej toolbar ovanför rect.top)', () => {
    const { left, top } = clampLensBox(rect.left, rect.top, rect)
    expect(left).toBe(100)            // = rect.left
    expect(top).toBe(50)              // = rect.top (under toolbaren)
  })
  it('vid nedre högra hörnet: hålls helt inom containern', () => {
    const { left, top } = clampLensBox(rect.right, rect.bottom, rect)
    expect(left + LENS).toBeLessThanOrEqual(rect.right)
    expect(top + LENS).toBeLessThanOrEqual(rect.bottom)
    expect(left).toBe(660)            // 900 - 240
    expect(top).toBe(460)            // 700 - 240
  })
  it('utan container: centrerar på muspekaren', () => {
    expect(clampLensBox(300, 300, null)).toEqual({ left: 300 - LENS / 2, top: 300 - LENS / 2 })
  })
})
