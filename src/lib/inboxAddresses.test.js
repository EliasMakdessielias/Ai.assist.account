import { describe, it, expect } from 'vitest'
import {
  INBOX_DOMAIN, INBOX_TYPE_KEYS, companyNumberToPrefix, buildInboxAddress, buildInboxAddresses,
  extractEmail, parseInboxRecipient, isAllowedAttachment, rejectionReason, MAX_ATTACHMENT_BYTES,
} from './inboxAddresses'

describe('företagsnummer -> prefix', () => {
  it('nollutfyller till 7 tecken', () => {
    expect(companyNumberToPrefix(1)).toBe('0000001')
    expect(companyNumberToPrefix(42)).toBe('0000042')
    expect(companyNumberToPrefix(1234567)).toBe('1234567')
  })
  it('ogiltigt -> null', () => {
    expect(companyNumberToPrefix(null)).toBeNull()
    expect(companyNumberToPrefix(-3)).toBeNull()
    expect(companyNumberToPrefix('abc')).toBeNull()
  })
})

describe('bygg adresser', () => {
  it('bygger en adress', () => {
    expect(buildInboxAddress(1, 'kvitto')).toBe('0000001.kvitto@arkiv.bokpilot.se')
    expect(buildInboxAddress('0000001', 'avtal')).toBe('0000001.avtal@arkiv.bokpilot.se')
  })
  it('okänd typ -> null', () => {
    expect(buildInboxAddress(1, 'spam')).toBeNull()
  })
  it('bygger alla fyra adresser för ett företag', () => {
    const a = buildInboxAddresses(1)
    expect(a.map(x => x.email_address)).toEqual([
      '0000001.kvitto@arkiv.bokpilot.se',
      '0000001.leverantorsfaktura@arkiv.bokpilot.se',
      '0000001.dokument@arkiv.bokpilot.se',
      '0000001.avtal@arkiv.bokpilot.se',
    ])
    expect(a).toHaveLength(4)
    expect(INBOX_TYPE_KEYS).toHaveLength(4)
  })
})

describe('extractEmail', () => {
  it('plockar adress ur namn+vinkelparenteser', () => {
    expect(extractEmail('"BokPilot" <0000001.kvitto@arkiv.bokpilot.se>')).toBe('0000001.kvitto@arkiv.bokpilot.se')
    expect(extractEmail('0000001.KVITTO@Arkiv.BokPilot.se')).toBe('0000001.kvitto@arkiv.bokpilot.se')
  })
})

describe('parseInboxRecipient', () => {
  it('tolkar giltig mottagare -> typ + kategori', () => {
    expect(parseInboxRecipient('0000001.kvitto@arkiv.bokpilot.se')).toEqual({
      prefix: '0000001', type: 'kvitto', kategori: 'kvitto', email_address: '0000001.kvitto@arkiv.bokpilot.se',
    })
    expect(parseInboxRecipient('0000007.leverantorsfaktura@arkiv.bokpilot.se').type).toBe('leverantorsfaktura')
    expect(parseInboxRecipient('<0000001.avtal@arkiv.bokpilot.se>').kategori).toBe('avtal')
  })
  it('okänd domän -> null', () => {
    expect(parseInboxRecipient('0000001.kvitto@arkiv.example.com')).toBeNull()
    expect(parseInboxRecipient('0000001.kvitto@bokpilot.se')).toBeNull()
  })
  it('okänd typ -> null (säkerhet: nekas)', () => {
    expect(parseInboxRecipient('0000001.spam@arkiv.bokpilot.se')).toBeNull()
    expect(parseInboxRecipient('support@arkiv.bokpilot.se')).toBeNull()
    expect(parseInboxRecipient('skräp')).toBeNull()
  })
})

describe('bilage-validering', () => {
  it('tillåter pdf/jpg/png/jpeg/heic/docx', () => {
    for (const f of ['k.pdf', 'k.jpg', 'k.jpeg', 'k.png', 'k.heic', 'k.heif', 'avtal.docx']) {
      expect(isAllowedAttachment({ filename: f, size: 1000 })).toBe(true)
    }
  })
  it('blockerar farliga/okända filtyper', () => {
    expect(isAllowedAttachment({ filename: 'virus.exe', size: 10 })).toBe(false)
    expect(isAllowedAttachment({ filename: 'a.zip', size: 10 })).toBe(false)
    expect(isAllowedAttachment({ filename: 'page.html', size: 10 })).toBe(false)
    expect(rejectionReason({ filename: 'virus.exe' })).toBe('blockerad_filtyp')
  })
  it('blockerar för stora filer', () => {
    expect(isAllowedAttachment({ filename: 'stor.pdf', size: MAX_ATTACHMENT_BYTES + 1 })).toBe(false)
    expect(rejectionReason({ filename: 'stor.pdf', size: MAX_ATTACHMENT_BYTES + 1 })).toBe('for_stor')
  })
  it('tillåter giltig MIME utan ändelse', () => {
    expect(isAllowedAttachment({ filename: 'scan', contentType: 'application/pdf', size: 100 })).toBe(true)
  })
})
