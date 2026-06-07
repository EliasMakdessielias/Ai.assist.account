import { describe, it, expect } from 'vitest'
import { parseRecipient, pickRecipient } from './parse.mjs'

describe('IMAP-mottagar-parser', () => {
  it('accepterar 8063151underlag@bokpilot.se och extraherar 8063151', () => {
    expect(parseRecipient('8063151underlag@bokpilot.se')).toEqual({ archiveNumber: '8063151', email: '8063151underlag@bokpilot.se' })
  })
  it('plockar adress ur "Namn <adress>" och normaliserar gemener', () => {
    expect(parseRecipient('"Kund" <8063151UNDERLAG@BokPilot.se>').archiveNumber).toBe('8063151')
  })
  it('fel suffix avvisas', () => {
    expect(parseRecipient('8063151kvitto@bokpilot.se')).toBeNull()
    expect(parseRecipient('8063151.underlag@bokpilot.se')).toBeNull()
    expect(parseRecipient('underlag@bokpilot.se')).toBeNull()
  })
  it('fel domän avvisas', () => {
    expect(parseRecipient('8063151underlag@example.com')).toBeNull()
    expect(parseRecipient('8063151underlag@in.bokpilot.se')).toBeNull()
  })
  it('icke-numeriskt eller fel längd (5–10 siffror) avvisas', () => {
    expect(parseRecipient('abcunderlag@bokpilot.se')).toBeNull()
    expect(parseRecipient('123underlag@bokpilot.se')).toBeNull()            // 3 siffror < 5
    expect(parseRecipient('123456789012underlag@bokpilot.se')).toBeNull()  // 12 siffror > 10
    expect(parseRecipient('12345underlag@bokpilot.se')?.archiveNumber).toBe('12345') // 5 ok
  })
  it('pickRecipient respekterar ordning och hoppar över ogiltiga', () => {
    expect(pickRecipient([null, '', 'noreply@spam.se', '8063151underlag@bokpilot.se'])).toBe('8063151underlag@bokpilot.se')
    expect(pickRecipient(['a@b.se', 'c@d.se'])).toBeNull()
  })
  it('hanterar kommaseparerade header-värden', () => {
    expect(pickRecipient(['x@y.se, 9999999underlag@bokpilot.se'])).toBe('9999999underlag@bokpilot.se')
  })
})
