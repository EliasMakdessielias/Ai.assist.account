import { describe, it, expect } from 'vitest'
import {
  normalizeWhatsAppNumber, getSupportWhatsAppNumber, buildWhatsAppMessage, buildWhatsAppUrl,
  WHATSAPP_BUTTON_LABEL, WHATSAPP_GDPR_WARNING,
} from './whatsappSupport'

describe('normalizeWhatsAppNumber', () => {
  it('behåller endast siffror', () => {
    expect(normalizeWhatsAppNumber('+46 70-123 45 67')).toBe('46701234567')
    expect(normalizeWhatsAppNumber('0046 (70) 1234567')).toBe('0046701234567')
  })
  it('returnerar tom sträng för tomt/odefinierat', () => {
    expect(normalizeWhatsAppNumber('')).toBe('')
    expect(normalizeWhatsAppNumber(null)).toBe('')
    expect(normalizeWhatsAppNumber(undefined)).toBe('')
  })
})

describe('getSupportWhatsAppNumber', () => {
  it('läser och normaliserar från env', () => {
    expect(getSupportWhatsAppNumber({ VITE_BOKPILOT_SUPPORT_WHATSAPP_NUMBER: '+46 70 123 45 67' })).toBe('46701234567')
  })
  it('saknas numret → tom sträng (knappen ska döljas)', () => {
    expect(getSupportWhatsAppNumber({})).toBe('')
    expect(getSupportWhatsAppNumber({ VITE_BOKPILOT_SUPPORT_WHATSAPP_NUMBER: '' })).toBe('')
  })
})

describe('buildWhatsAppMessage', () => {
  const full = {
    company_name: 'Acme AB', org_number: '556677-8899', archive_number: 'A123',
    user_email: 'ulla@acme.se', current_path: '/leverantorsfakturor/ny', service_state: 'paused',
  }

  it('innehåller alltid företag, användare och sida', () => {
    const m = buildWhatsAppMessage(full)
    expect(m).toContain('Hej BokPilot, jag behöver hjälp.')
    expect(m).toContain('Företag: Acme AB')
    expect(m).toContain('Användare: ulla@acme.se')
    expect(m).toContain('Sida: /leverantorsfakturor/ny')
    expect(m.trimEnd().endsWith('Beskrivning:')).toBe(true)
  })

  it('tar med org.nr och arkivnummer endast när de finns', () => {
    expect(buildWhatsAppMessage(full)).toContain('Org.nr: 556677-8899')
    expect(buildWhatsAppMessage(full)).toContain('Arkivnummer: A123')
    const m = buildWhatsAppMessage({ company_name: 'Acme AB', user_email: 'u@a.se', current_path: '/' })
    expect(m).not.toContain('Org.nr:')
    expect(m).not.toContain('Arkivnummer:')
  })

  it('tar med Status endast när kontot är pausat/blockerat', () => {
    expect(buildWhatsAppMessage({ ...full, service_state: 'paused' })).toContain('Status: paused')
    expect(buildWhatsAppMessage({ ...full, service_state: 'blocked' })).toContain('Status: blocked')
    expect(buildWhatsAppMessage({ ...full, service_state: 'active' })).not.toContain('Status:')
    expect(buildWhatsAppMessage({ ...full, service_state: undefined })).not.toContain('Status:')
  })
})

describe('buildWhatsAppUrl', () => {
  it('bygger korrekt wa.me-url med encodad text', () => {
    const url = buildWhatsAppUrl('46701234567', 'Hej & hå\nrad 2 åäö')
    expect(url.startsWith('https://wa.me/46701234567?text=')).toBe(true)
    // Texten ska vara URL-encodad (inga råa &, mellanslag, nyrader eller åäö)
    const enc = url.split('?text=')[1]
    expect(enc).not.toMatch(/[\s&åäö]/)
    expect(decodeURIComponent(enc)).toBe('Hej & hå\nrad 2 åäö')
  })

  it('normaliserar numret i url:en', () => {
    expect(buildWhatsAppUrl('+46 70-123 45 67', 'x')).toContain('https://wa.me/46701234567?text=')
  })

  it('returnerar null när numret saknas', () => {
    expect(buildWhatsAppUrl('', 'x')).toBeNull()
    expect(buildWhatsAppUrl(null, 'x')).toBeNull()
  })

  it('encodar en komplett förifylld text korrekt', () => {
    const msg = buildWhatsAppMessage({ company_name: 'Acme AB', org_number: '556677-8899', user_email: 'u@a.se', current_path: '/support', service_state: 'blocked' })
    const url = buildWhatsAppUrl('46701234567', msg)
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(msg)
  })
})

describe('konstanter', () => {
  it('har rätt knapptext och GDPR-varning', () => {
    expect(WHATSAPP_BUTTON_LABEL).toBe('Kontakta support via WhatsApp')
    expect(WHATSAPP_GDPR_WARNING).toContain('Skicka inte bokföringsunderlag')
  })
})
