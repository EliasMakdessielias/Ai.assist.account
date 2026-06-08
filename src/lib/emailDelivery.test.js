import { describe, it, expect } from 'vitest'
import {
  isValidEmail, backoffMinutes, nextRetryAt, isPermanentFailure,
  deliveryDecision, failureTransition, buildUnsubToken, verifyUnsubToken,
  unsubscribeUrl, emailFooter, NON_UNSUBSCRIBABLE,
} from './emailDelivery.js'

const SECRET = 'test-secret-123'
const NOW = new Date('2026-06-08T10:00:00.000Z')
const baseRow = { channel: 'email', status: 'pending', scheduled_at: '2026-06-08T09:00:00.000Z', attempt_count: 0, max_attempts: 5, next_retry_at: null }

describe('isValidEmail', () => {
  it('accepterar giltiga, avvisar ogiltiga/saknade', () => {
    expect(isValidEmail('a@b.se')).toBe(true)
    expect(isValidEmail('admin@bokpilot.se')).toBe(true)
    expect(isValidEmail('ingen-snabel-a')).toBe(false)
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
  })
})

describe('exponentiell backoff', () => {
  it('2^n minuter med tak 60', () => {
    expect(backoffMinutes(0)).toBe(1)
    expect(backoffMinutes(1)).toBe(2)
    expect(backoffMinutes(2)).toBe(4)
    expect(backoffMinutes(3)).toBe(8)
    expect(backoffMinutes(10)).toBe(60) // tak
  })
  it('nextRetryAt = now + backoff', () => {
    expect(nextRetryAt(1, NOW)).toBe('2026-06-08T10:02:00.000Z')
    expect(nextRetryAt(3, NOW)).toBe('2026-06-08T10:08:00.000Z')
  })
})

describe('permanent fel', () => {
  it('saknad/ogiltig adress + 5xx = permanent', () => {
    expect(isPermanentFailure('missing recipient email')).toBe(true)
    expect(isPermanentFailure('Invalid email address')).toBe(true)
    expect(isPermanentFailure('550 5.1.1 user unknown')).toBe(true)
    expect(isPermanentFailure('421 try again later')).toBe(false)
    expect(isPermanentFailure('ETIMEDOUT connection')).toBe(false)
    expect(isPermanentFailure(null)).toBe(false)
  })
})

describe('deliveryDecision', () => {
  it('skickar när allt stämmer', () => {
    expect(deliveryDecision(baseRow, { recipientEmail: 'a@b.se', now: NOW })).toEqual({ action: 'send' })
  })
  it('väntar om scheduled_at i framtiden', () => {
    const r = { ...baseRow, scheduled_at: '2026-06-08T12:00:00.000Z' }
    expect(deliveryDecision(r, { recipientEmail: 'a@b.se', now: NOW }).action).toBe('wait')
  })
  it('väntar om next_retry_at i framtiden', () => {
    const r = { ...baseRow, next_retry_at: '2026-06-08T10:30:00.000Z' }
    expect(deliveryDecision(r, { recipientEmail: 'a@b.se', now: NOW }).action).toBe('wait')
  })
  it('failar permanent vid saknad/ogiltig adress', () => {
    const d = deliveryDecision(baseRow, { recipientEmail: '', now: NOW })
    expect(d.action).toBe('fail'); expect(d.permanent).toBe(true)
  })
  it('failar vid maxAttempts', () => {
    const r = { ...baseRow, attempt_count: 5 }
    expect(deliveryDecision(r, { recipientEmail: 'a@b.se', now: NOW })).toEqual({ action: 'fail', reason: 'max-attempts' })
  })
})

describe('failureTransition (retry vs ge upp)', () => {
  it('temporärt fel -> pending + backoff + ökat försök', () => {
    const t = failureTransition({ attempt_count: 0, max_attempts: 5 }, '421 temporary', NOW)
    expect(t.status).toBe('pending'); expect(t.attempt_count).toBe(1)
    expect(t.next_retry_at).toBe('2026-06-08T10:02:00.000Z')
  })
  it('maxAttempts nått -> failed, ingen retry', () => {
    const t = failureTransition({ attempt_count: 4, max_attempts: 5 }, 'timeout', NOW)
    expect(t.status).toBe('failed'); expect(t.attempt_count).toBe(5); expect(t.next_retry_at).toBeNull()
  })
  it('permanent fel -> failed direkt även tidigt', () => {
    const t = failureTransition({ attempt_count: 0, max_attempts: 5 }, '550 user unknown', NOW)
    expect(t.status).toBe('failed'); expect(t.next_retry_at).toBeNull()
  })
})

describe('unsubscribe-token (HMAC)', () => {
  it('bygg + verifiera round-trip', () => {
    const tok = buildUnsubToken('user-1', 'kvitto_classified', SECRET)
    expect(verifyUnsubToken(tok, SECRET)).toEqual({ userId: 'user-1', eventType: 'kvitto_classified' })
  })
  it('avvisar manipulerad token / fel secret', () => {
    const tok = buildUnsubToken('user-1', 'kvitto_classified', SECRET)
    expect(verifyUnsubToken(tok, 'fel-secret')).toBeNull()
    expect(verifyUnsubToken(tok + 'x', SECRET)).toBeNull()
    expect(verifyUnsubToken('skräp', SECRET)).toBeNull()
    expect(verifyUnsubToken(null, SECRET)).toBeNull()
  })
})

describe('unsubscribe-länk: obligatoriska events skyddas', () => {
  it('icke-obligatoriskt event får länk', () => {
    expect(unsubscribeUrl('https://x/unsub', 'u1', 'kvitto_classified', SECRET)).toContain('token=')
  })
  it('security_event får INGEN avregistreringslänk', () => {
    expect(NON_UNSUBSCRIBABLE.has('security_event')).toBe(true)
    expect(unsubscribeUrl('https://x/unsub', 'u1', 'security_event', SECRET)).toBeNull()
  })
  it('footer utelämnar länk när unsubUrl saknas', () => {
    expect(emailFooter({ companyName: 'AB', unsubUrl: null }).text).not.toContain('Avregistrera')
    expect(emailFooter({ companyName: 'AB', unsubUrl: 'https://x' }).text).toContain('Avregistrera')
  })
})
