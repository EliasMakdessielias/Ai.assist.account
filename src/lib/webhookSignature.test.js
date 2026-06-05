import { describe, it, expect } from 'vitest'
import { hmacSha256Hex, timingSafeEqualHex, verifyInboundSignature } from './webhookSignature'

const SECRET = 'test-shared-secret'
const BODY = JSON.stringify({ to: '0000001.kvitto@arkiv.bokpilot.se', from: 'a@b.se', attachments: [] })

describe('webhook-signatur (HMAC-SHA256)', () => {
  it('genererar deterministisk hex-signatur', async () => {
    const a = await hmacSha256Hex(SECRET, BODY)
    const b = await hmacSha256Hex(SECRET, BODY)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepterar korrekt signatur (med och utan sha256=-prefix)', async () => {
    const sig = await hmacSha256Hex(SECRET, BODY)
    expect(await verifyInboundSignature(SECRET, BODY, sig)).toBe(true)
    expect(await verifyInboundSignature(SECRET, BODY, `sha256=${sig}`)).toBe(true)
  })

  it('nekar manipulerad body', async () => {
    const sig = await hmacSha256Hex(SECRET, BODY)
    expect(await verifyInboundSignature(SECRET, BODY + 'x', sig)).toBe(false)
  })

  it('nekar fel hemlighet', async () => {
    const sig = await hmacSha256Hex(SECRET, BODY)
    expect(await verifyInboundSignature('fel-hemlighet', BODY, sig)).toBe(false)
  })

  it('nekar saknad signatur/hemlighet', async () => {
    expect(await verifyInboundSignature(SECRET, BODY, '')).toBe(false)
    expect(await verifyInboundSignature('', BODY, 'abc')).toBe(false)
  })

  it('timingSafeEqualHex jämför korrekt', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true)
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
    expect(timingSafeEqualHex('ab', 'abc')).toBe(false)
  })
})
