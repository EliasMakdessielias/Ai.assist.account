import { describe, it, expect } from 'vitest'
import { pickInboxRecipient, importKey } from './imapRecipient'

describe('pickInboxRecipient – hitta rätt mottagare i headers', () => {
  it('hittar adressen i To även med namn/vinkelparenteser', () => {
    const hit = pickInboxRecipient(['"BokPilot" <8063151underlag@bokpilot.se>'])
    expect(hit?.archiveNumber).toBe('8063151')
    expect(hit?.email_address).toBe('8063151underlag@bokpilot.se')
  })
  it('hittar adressen i X-Original-To/Delivered-To vid catch-all', () => {
    // catch-all levererar till underlag@bokpilot.se men original ligger kvar
    const hit = pickInboxRecipient(['underlag@bokpilot.se', '8063151underlag@bokpilot.se'])
    expect(hit?.archiveNumber).toBe('8063151')
  })
  it('hanterar flera kommaseparerade adresser', () => {
    const hit = pickInboxRecipient(['info@bokpilot.se, 806351underlag@bokpilot.se'])
    expect(hit?.archiveNumber).toBe('806351')
  })
  it('returnerar null när ingen giltig underlagsadress finns (avvisas)', () => {
    expect(pickInboxRecipient(['admin@bokpilot.se', 'underlag@bokpilot.se'])).toBeNull()
    expect(pickInboxRecipient(['8063151underlag@example.com'])).toBeNull()
    expect(pickInboxRecipient(['8063151kvitto@bokpilot.se'])).toBeNull()
    expect(pickInboxRecipient([])).toBeNull()
  })
})

describe('importKey – idempotens', () => {
  it('använder Message-ID när det finns', () => {
    expect(importKey({ messageId: '<abc@mail>' })).toBe('<abc@mail>')
  })
  it('faller tillbaka till stabil nyckel utan Message-ID', () => {
    expect(importKey({ firstAttachmentName: 'kvitto.pdf', size: 1234 })).toBe('noid:kvitto.pdf:1234')
  })
})
