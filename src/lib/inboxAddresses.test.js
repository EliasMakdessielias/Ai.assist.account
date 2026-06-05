import { describe, it, expect } from 'vitest'
import {
  INBOX_TYPE_KEYS, INBOX_SUFFIXES, ARCHIVE_MIN, ARCHIVE_MAX,
  isValidArchiveNumber, generateArchiveNumber, buildInboxAddress, buildInboxAddresses,
  extractEmail, parseInboxRecipient, isAllowedAttachment, rejectionReason, MAX_ATTACHMENT_BYTES,
} from './inboxAddresses'

describe('arkivnummer', () => {
  it('giltigt i intervallet 1000000-9999999', () => {
    expect(isValidArchiveNumber(1000000)).toBe(true)
    expect(isValidArchiveNumber(9999999)).toBe(true)
    expect(isValidArchiveNumber(7564841)).toBe(true)
  })
  it('ogiltigt utanför intervallet eller fel typ', () => {
    expect(isValidArchiveNumber(999999)).toBe(false)   // 6 siffror
    expect(isValidArchiveNumber(10000000)).toBe(false) // 8 siffror
    expect(isValidArchiveNumber(0)).toBe(false)
    expect(isValidArchiveNumber(null)).toBe(false)
    expect(isValidArchiveNumber('abc')).toBe(false)
    expect(isValidArchiveNumber(1234567.5)).toBe(false)
  })
  it('generatorn ger alltid 7 siffror inom intervallet (börjar ej med 0)', () => {
    for (const r of [0, 0.0001, 0.5, 0.999999]) {
      const n = generateArchiveNumber(() => r)
      expect(n).toBeGreaterThanOrEqual(ARCHIVE_MIN)
      expect(n).toBeLessThanOrEqual(ARCHIVE_MAX)
      expect(String(n)).toMatch(/^[1-9]\d{6}$/)
      expect(isValidArchiveNumber(n)).toBe(true)
    }
  })
})

describe('bygg adresser (arkivnummer + suffix)', () => {
  it('bygger en adress med rätt suffix', () => {
    expect(buildInboxAddress(7564841, 'kvitto')).toBe('7564841.kvi@arkiv.bokpilot.se')
    expect(buildInboxAddress(7564841, 'leverantorsfaktura')).toBe('7564841.lev@arkiv.bokpilot.se')
    expect(buildInboxAddress(7564841, 'dokument')).toBe('7564841.dok@arkiv.bokpilot.se')
    expect(buildInboxAddress(7564841, 'avtal')).toBe('7564841.avt@arkiv.bokpilot.se')
  })
  it('ogiltigt arkivnummer eller typ -> null', () => {
    expect(buildInboxAddress(123, 'kvitto')).toBeNull()
    expect(buildInboxAddress(7564841, 'spam')).toBeNull()
  })
  it('bygger alla fyra adresser', () => {
    const a = buildInboxAddresses(7564841)
    expect(a.map(x => x.email_address)).toEqual([
      '7564841.kvi@arkiv.bokpilot.se',
      '7564841.lev@arkiv.bokpilot.se',
      '7564841.dok@arkiv.bokpilot.se',
      '7564841.avt@arkiv.bokpilot.se',
    ])
    expect(INBOX_TYPE_KEYS).toHaveLength(4)
    expect(INBOX_SUFFIXES).toEqual(['kvi', 'lev', 'dok', 'avt'])
  })
})

describe('extractEmail', () => {
  it('plockar adress ur namn+vinkelparenteser, normaliserar gemener', () => {
    expect(extractEmail('"BokPilot" <7564841.KVI@Arkiv.BokPilot.se>')).toBe('7564841.kvi@arkiv.bokpilot.se')
  })
})

describe('parseInboxRecipient (suffix -> typ)', () => {
  it('.kvi -> kvitto', () => expect(parseInboxRecipient('7564841.kvi@arkiv.bokpilot.se')).toMatchObject({ archiveNumber: '7564841', type: 'kvitto', kategori: 'kvitto' }))
  it('.lev -> leverantorsfaktura', () => expect(parseInboxRecipient('7564841.lev@arkiv.bokpilot.se').type).toBe('leverantorsfaktura'))
  it('.dok -> dokument', () => expect(parseInboxRecipient('7564841.dok@arkiv.bokpilot.se').type).toBe('dokument'))
  it('.avt -> avtal', () => expect(parseInboxRecipient('<7564841.avt@arkiv.bokpilot.se>').type).toBe('avtal'))
  it('okänd domän -> null', () => {
    expect(parseInboxRecipient('7564841.kvi@arkiv.example.com')).toBeNull()
    expect(parseInboxRecipient('7564841.kvi@bokpilot.se')).toBeNull()
  })
  it('ogiltigt suffix -> null (säkerhet: nekas)', () => {
    expect(parseInboxRecipient('7564841.xyz@arkiv.bokpilot.se')).toBeNull()
    expect(parseInboxRecipient('7564841.kvitto@arkiv.bokpilot.se')).toBeNull() // gammalt långt suffix
    expect(parseInboxRecipient('support@arkiv.bokpilot.se')).toBeNull()
  })
  it('ogiltigt arkivnummer -> null', () => {
    expect(parseInboxRecipient('0564841.kvi@arkiv.bokpilot.se')).toBeNull() // börjar med 0
    expect(parseInboxRecipient('123.kvi@arkiv.bokpilot.se')).toBeNull()     // för kort
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
