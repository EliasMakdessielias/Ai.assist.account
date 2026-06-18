import { describe, it, expect } from 'vitest'
import { quotaMessage, remainingSeconds, isCoolingDown, quotaFrom, cooldownUntilFrom, DEFAULT_COOLDOWN_SECONDS } from './aiQuota'

describe('aiQuota', () => {
  it('quotaMessage visar countdown och antyder inte fel underlag', () => {
    expect(quotaMessage(60)).toBe('AI-kvoten är tillfälligt slut. Försök igen om 60 sekunder.')
    expect(quotaMessage(0)).toMatch(/om 1 sekunder/)        // golv 1
    expect(quotaMessage()).toMatch(new RegExp(`om ${DEFAULT_COOLDOWN_SECONDS} sekunder`))
    expect(quotaMessage(60)).not.toMatch(/bild|underlag är fel|oläslig/i)
  })

  it('remainingSeconds räknar ned och bottnar på 0', () => {
    const now = 1_000_000
    expect(remainingSeconds(now + 60_000, now)).toBe(60)
    expect(remainingSeconds(now + 1500, now)).toBe(2)       // rundar upp
    expect(remainingSeconds(now - 5000, now)).toBe(0)
    expect(remainingSeconds(0, now)).toBe(0)
    expect(remainingSeconds(null, now)).toBe(0)
  })

  it('isCoolingDown är sant bara med tid kvar', () => {
    const now = 1_000_000
    expect(isCoolingDown(now + 5000, now)).toBe(true)
    expect(isCoolingDown(now - 1, now)).toBe(false)
  })

  it('quotaFrom tolkar quota/rate-limit-svar och fel', () => {
    expect(quotaFrom({ code: 'quota_cooldown', retry_after_seconds: 45 })).toEqual({ seconds: 45, scope: null })
    expect(quotaFrom({ code: 'rate_limited', retry_after_seconds: 60, scope: 'company' })).toEqual({ seconds: 60, scope: 'company' })
    expect(quotaFrom({ code: 'quota_cooldown', retryAfter: 30 })).toEqual({ seconds: 30, scope: null })
    // utan giltig tid → default
    expect(quotaFrom({ code: 'quota_cooldown' })).toEqual({ seconds: DEFAULT_COOLDOWN_SECONDS, scope: null })
  })

  it('quotaFrom returnerar null för icke-quota', () => {
    expect(quotaFrom({ code: 'ai_failed' })).toBeNull()
    expect(quotaFrom({ ok: true, result: {} })).toBeNull()
    expect(quotaFrom(null)).toBeNull()
  })

  it('cooldownUntilFrom ger absolut framtid', () => {
    const now = 1_000_000
    expect(cooldownUntilFrom(60, now)).toBe(now + 60_000)
    expect(cooldownUntilFrom(0, now)).toBe(now + 1000)      // golv 1 s
  })
})
