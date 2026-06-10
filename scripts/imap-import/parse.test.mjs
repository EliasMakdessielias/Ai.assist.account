import { describe, it, expect } from 'vitest'
import { parseRecipient, pickRecipient, classifyWebhookOutcome } from './parse.mjs'

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

describe('classifyWebhookOutcome – service-lock = business rejection, ej system_error (krav 4)', () => {
  it('mottaget/needs_review/dubblett → processed', () => {
    expect(classifyWebhookOutcome({ ok: true, status: 200, body: { status: 'received', created: 1 } })).toBe('processed')
    expect(classifyWebhookOutcome({ ok: true, status: 200, body: { status: 'needs_review' } })).toBe('processed')
    expect(classifyWebhookOutcome({ ok: true, status: 200, body: { status: 'duplicate' } })).toBe('processed')
  })
  it('pausat/blockerat företag → service_locked (INTE failed)', () => {
    expect(classifyWebhookOutcome({ ok: true, status: 200, body: { status: 'rejected', reason: 'service_locked', state: 'paused' } })).toBe('service_locked')
    expect(classifyWebhookOutcome({ ok: true, status: 200, body: { status: 'rejected', reason: 'service_locked', state: 'blocked' } })).toBe('service_locked')
  })
  it('tekniska fel → failed (rapporteras som system_error vid upprepning)', () => {
    expect(classifyWebhookOutcome({ ok: false, status: 500, body: {} })).toBe('failed')
    expect(classifyWebhookOutcome({ ok: true, status: 200, body: { status: 'rejected', reason: 'unknown_recipient' } })).toBe('failed')
  })
})
