import { describe, it, expect } from 'vitest'
import {
  normalizeSeverity, severityRouting, hourBucket, normalizeErrorCode,
  dedupeKey, sanitizeMetadata, buildErrorReport, toRpcParams,
} from './systemError'

describe('severity & routing (krav 7/8)', () => {
  it('normaliserar okänd severity till error', () => {
    expect(normalizeSeverity('warning')).toBe('warning')
    expect(normalizeSeverity('critical')).toBe('critical')
    expect(normalizeSeverity('bogus')).toBe('error')
  })
  it('warning = in_app only; error/critical = in_app + email', () => {
    expect(severityRouting('warning')).toEqual({ channels: ['in_app'], priority: 'normal' })
    expect(severityRouting('error')).toEqual({ channels: ['in_app', 'email'], priority: 'high' })
    expect(severityRouting('critical')).toEqual({ channels: ['in_app', 'email'], priority: 'urgent' })
  })
})

describe('dedupe (krav 9)', () => {
  it('hourBucket är UTC YYYYMMDDHH', () => {
    expect(hourBucket(new Date('2026-06-08T09:42:11Z'))).toBe('2026060809')
  })
  it('nyckel = system_error:{component}:{errorCode}:{hourBucket}', () => {
    expect(dedupeKey('imap-import', 'imap_connection_failure', '2026060809'))
      .toBe('system_error:imap-import:imap_connection_failure:2026060809')
  })
  it('samma component+kod+timme => samma nyckel (anti-spam)', () => {
    const b = '2026060809'
    expect(dedupeKey('ocr-tolka', 'gemini_api_failure', b)).toBe(dedupeKey('ocr-tolka', 'gemini_api_failure', b))
    expect(dedupeKey('ocr-tolka', 'gemini_api_failure', '2026060810'))
      .not.toBe(dedupeKey('ocr-tolka', 'gemini_api_failure', b))
  })
  it('saniterar error-kod till säkra tecken', () => {
    expect(normalizeErrorCode('Gemini 429!')).toBe('Gemini_429_')
    expect(normalizeErrorCode('')).toBe('unknown')
  })
})

describe('sanitizeMetadata (krav 3)', () => {
  it('redigerar bort känsliga nycklar (tokens/credentials/innehåll)', () => {
    const out = sanitizeMetadata({
      token: 'abc', password: 'p', authorization: 'Bearer x', apiKey: 'k',
      email_body: 'hela mailet...', contentBase64: 'AAAA', iban: 'SE..', ocr: '123',
      status: 502, mailbox: 'INBOX', filename: 'faktura.pdf',
    })
    expect(out.token).toBe('[redacted]')
    expect(out.password).toBe('[redacted]')
    expect(out.authorization).toBe('[redacted]')
    expect(out.apiKey).toBe('[redacted]')
    expect(out.email_body).toBe('[redacted]')
    expect(out.contentBase64).toBe('[redacted]')
    expect(out.iban).toBe('[redacted]')
    expect(out.ocr).toBe('[redacted]')
    // ofarliga fält behålls
    expect(out.status).toBe(502)
    expect(out.mailbox).toBe('INBOX')
    expect(out.filename).toBe('faktura.pdf')
  })
  it('trunkerar långa strängar och kapar stora objekt', () => {
    const long = 'x'.repeat(500)
    expect(sanitizeMetadata({ msg: long }).msg.length).toBeLessThanOrEqual(301)
    expect(sanitizeMetadata({ arr: [1, 2, 3] }).arr).toBe('[array(3)]')
    expect(sanitizeMetadata('inte ett objekt')).toEqual({})
    expect(sanitizeMetadata(null)).toEqual({})
  })
})

describe('buildErrorReport', () => {
  it('bygger komplett sanerat report med routing', () => {
    const r = buildErrorReport({
      component: 'imap-import', severity: 'critical', errorCode: 'imap_auth_failure',
      message: 'auth misslyckades', metadata: { password: 'hemlig', host: 'imap.x' }, occurredAt: '2026-06-08T09:00:00Z',
    })
    expect(r).toMatchObject({
      component: 'imap-import', severity: 'critical', errorCode: 'imap_auth_failure',
      message: 'auth misslyckades', channels: ['in_app', 'email'], priority: 'urgent',
    })
    expect(r.metadata.password).toBe('[redacted]')
    expect(r.metadata.host).toBe('imap.x')
  })
  it('toRpcParams mappar till snake_case', () => {
    const p = toRpcParams(buildErrorReport({ component: 'c', errorCode: 'e', message: 'm' }), null)
    expect(p).toMatchObject({ p_component: 'c', p_error_code: 'e', p_message: 'm', p_company_id: null, p_severity: 'error' })
  })
})
