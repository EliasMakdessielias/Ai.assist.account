import { describe, it, expect } from 'vitest'
import {
  INBOX_DOMAIN, INBOX_LOCAL, ARCHIVE_MIN, ARCHIVE_MAX,
  isValidArchiveNumber, generateArchiveNumber, buildInboxAddress,
  extractEmail, parseInboxRecipient, isAllowedAttachment, rejectionReason, MAX_ATTACHMENT_BYTES,
} from './inboxAddresses'

describe('arkivnummer', () => {
  it('giltigt i intervallet 1000000-9999999', () => {
    expect(isValidArchiveNumber(1000000)).toBe(true)
    expect(isValidArchiveNumber(9999999)).toBe(true)
    expect(isValidArchiveNumber(8063151)).toBe(true)
  })
  it('ogiltigt utanför intervallet eller fel typ', () => {
    expect(isValidArchiveNumber(999999)).toBe(false)
    expect(isValidArchiveNumber(10000000)).toBe(false)
    expect(isValidArchiveNumber(0)).toBe(false)
    expect(isValidArchiveNumber(null)).toBe(false)
    expect(isValidArchiveNumber('abc')).toBe(false)
  })
  it('generatorn ger alltid 7 siffror (börjar ej med 0)', () => {
    for (const r of [0, 0.0001, 0.5, 0.999999]) {
      const n = generateArchiveNumber(() => r)
      expect(n).toBeGreaterThanOrEqual(ARCHIVE_MIN)
      expect(n).toBeLessThanOrEqual(ARCHIVE_MAX)
      expect(String(n)).toMatch(/^[1-9]\d{6}$/)
    }
  })
})

describe('en enda mottagningsadress', () => {
  it('bygger {archiveNumber}.ulag@arkiv.bokpilot.se', () => {
    expect(buildInboxAddress(8063151)).toBe('8063151.ulag@arkiv.bokpilot.se')
    expect(INBOX_DOMAIN).toBe('arkiv.bokpilot.se')
    expect(INBOX_LOCAL).toBe('ulag')
  })
  it('ogiltigt arkivnummer -> null', () => {
    expect(buildInboxAddress(123)).toBeNull()
    expect(buildInboxAddress(null)).toBeNull()
  })
})

describe('extractEmail', () => {
  it('plockar adress ur namn+vinkelparenteser, normaliserar gemener', () => {
    expect(extractEmail('"BokPilot" <8063151.ULAG@Arkiv.BokPilot.se>')).toBe('8063151.ulag@arkiv.bokpilot.se')
  })
})

describe('parseInboxRecipient', () => {
  it('tolkar giltig adress -> archiveNumber', () => {
    expect(parseInboxRecipient('8063151.ulag@arkiv.bokpilot.se')).toEqual({
      archiveNumber: '8063151', email_address: '8063151.ulag@arkiv.bokpilot.se',
    })
    expect(parseInboxRecipient('<7564841.ulag@arkiv.bokpilot.se>')?.archiveNumber).toBe('7564841')
  })
  it('okänd domän -> null', () => {
    expect(parseInboxRecipient('8063151.ulag@example.com')).toBeNull()
    expect(parseInboxRecipient('8063151.ulag@bokpilot.se')).toBeNull()   // apex (Hostinger), ej giltig
    expect(parseInboxRecipient('8063151.ulag@ark.bokpilot.se')).toBeNull()
  })
  it('fel local-part eller arkivnummer -> null (säkerhet: nekas)', () => {
    expect(parseInboxRecipient('8063151.underlag@arkiv.bokpilot.se')).toBeNull()
    expect(parseInboxRecipient('8063151.kv@arkiv.bokpilot.se')).toBeNull()
    expect(parseInboxRecipient('ulag@arkiv.bokpilot.se')).toBeNull()
    expect(parseInboxRecipient('0063151.ulag@arkiv.bokpilot.se')).toBeNull() // börjar med 0
    expect(parseInboxRecipient('123.ulag@arkiv.bokpilot.se')).toBeNull()     // för kort
  })
})

describe('bilage-validering', () => {
  it('tillåter pdf/jpg/png/jpeg/heic/docx', () => {
    for (const f of ['k.pdf', 'k.jpg', 'k.jpeg', 'k.png', 'k.heic', 'k.heif', 'avtal.docx']) {
      expect(isAllowedAttachment({ filename: f, size: 1000 })).toBe(true)
    }
  })
  it('blockerar farliga/okända filtyper och för stora filer', () => {
    expect(isAllowedAttachment({ filename: 'virus.exe', size: 10 })).toBe(false)
    expect(isAllowedAttachment({ filename: 'a.zip', size: 10 })).toBe(false)
    expect(rejectionReason({ filename: 'virus.exe' })).toBe('blockerad_filtyp')
    expect(rejectionReason({ filename: 'stor.pdf', size: MAX_ATTACHMENT_BYTES + 1 })).toBe('for_stor')
  })
})
