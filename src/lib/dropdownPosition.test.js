import { describe, it, expect } from 'vitest'
import { computeDropdownPos, DROPDOWN_W } from './dropdownPosition'

// Klocka i sidomeny (vänster). rect = trigger-bounds.
const rect = (left, top, w = 28, h = 24) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })

describe('computeDropdownPos – öppnar inåt mot arbetsytan (krav 1/2/6)', () => {
  it('expanderad sidebar: dropdown till HÖGER om klockan, inte åt vänster', () => {
    const r = rect(190, 30)            // klocka nära vänsterkant i bred sidomeny
    const p = computeDropdownPos(r, 1440, 900)
    expect(p.left).toBe(r.right + 8)   // = 226, öppnas åt höger
    expect(p.left + p.width).toBeLessThanOrEqual(1440 - 8)
    expect(p.width).toBe(DROPDOWN_W)
  })
  it('hopfälld sidebar: öppnas åt höger om den smala klockan', () => {
    const r = rect(20, 40)
    const p = computeDropdownPos(r, 1440, 900)
    expect(p.left).toBe(r.right + 8)   // öppnas åt höger om klockan
    expect(p.left).toBeGreaterThanOrEqual(8)
  })
})

describe('collision detection (krav 3/4/5)', () => {
  it('trigger nära högerkant: flippar åt vänster och håller sig inom viewporten', () => {
    const r = rect(1380, 100)          // nära höger kant
    const p = computeDropdownPos(r, 1440, 900)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + p.width).toBeLessThanOrEqual(1440 - 8)
    expect(p.left).toBeLessThan(r.left) // hamnade till vänster om triggern
  })
  it('trigger nära botten: justeras uppåt så hela dropdownen syns', () => {
    const r = rect(20, 870)            // klocka längst ned (vanligt i sidomeny)
    const p = computeDropdownPos(r, 1440, 900)
    expect(p.top).toBeGreaterThanOrEqual(8)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(900 - 8)
  })
  it('alltid helt inom viewporten (left/top clampade)', () => {
    const p = computeDropdownPos(rect(0, 0), 1440, 900)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })
})

describe('liten skärm + storlek (krav 7/9)', () => {
  it('bredd clampas till calc(100vw - 16px) på smal skärm', () => {
    const p = computeDropdownPos(rect(10, 10), 300, 600)
    expect(p.width).toBe(300 - 16)     // 284
    expect(p.left).toBe(8)
    expect(p.left + p.width).toBeLessThanOrEqual(300 - 8)
  })
  it('maxHeight = min(480, 100vh - 80)', () => {
    expect(computeDropdownPos(rect(10, 10), 1440, 900).maxHeight).toBe(480)   // 900-80=820 -> min 480
    expect(computeDropdownPos(rect(10, 10), 1440, 500).maxHeight).toBe(420)   // 500-80
  })
  it('lång notislista: höjden begränsas (scroll i listan)', () => {
    const p = computeDropdownPos(rect(20, 100), 1440, 760)
    expect(p.maxHeight).toBe(480)      // 760-80=680 -> 480
  })
})
