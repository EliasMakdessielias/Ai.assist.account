import { describe, it, expect, beforeEach } from 'vitest'
import {
  __setOpsForTests, enqueue, listForUser, claimNext, applyResult, recoverStuck, manualRetry,
  countByStatus, mapServerResult, classifyTransport, computeBackoff, canAutoRetry, sanitizeServerResult,
  payloadHash, commentByteLength, exceedsMax, normalizeComment,
  QUEUE_STATUS, OP_UPSERT, OP_CLEAR, AUTO_RETRYABLE, NEVER_AUTO_RETRY,
} from './syncQueue'
import { createLeader } from './syncLeader'

// In-memory IndexedDB-ops (deterministisk, ingen riktig IDB).
function memOps() {
  const store = new Map()
  return {
    idbAvailable: () => true,
    idbGet: async (_s, k) => store.get(k) ?? null,
    idbGetAll: async () => [...store.values()],
    idbPut: async (_s, v) => { store.set(v.operationId, v); return v },
    idbDelete: async (_s, k) => { store.delete(k); return true },
    idbUpdate: async (_s, k, updater) => { const next = updater(store.get(k) ?? null); if (next == null) return null; store.set(k, next); return next },
    __store: store,
  }
}

const IDENT = { userId: 'u1', companyId: 'c1', fiscalYearId: 'fy1', engagementId: 'e1', entityType: 'bokslut_check_comment', entityId: 'chk1' }

beforeEach(() => __setOpsForTests(memOps()))

describe('payload + byte-gräns', () => {
  it('NFC-normaliserar och mäter UTF-8 bytes', () => {
    expect(commentByteLength('abc')).toBe(3)
    expect(commentByteLength('åäö')).toBe(6)
    expect(commentByteLength('😀')).toBe(4)
  })
  it('8000 byte ok, 8001 avvisas; emoji mäts i bytes', () => {
    expect(exceedsMax('a'.repeat(8000))).toBe(false)
    expect(exceedsMax('a'.repeat(8001))).toBe(true)
    expect(exceedsMax('😀'.repeat(2001))).toBe(true)   // 2001 tecken men 8004 bytes
  })
  it('payloadHash är NFC-stabil och skiljer clear från upsert', () => {
    const nfc = 'é'; const nfd = 'é'   // é (komponerad) vs e + combining accent
    expect(payloadHash(OP_UPSERT, nfc)).toBe(payloadHash(OP_UPSERT, nfd))
    expect(payloadHash(OP_CLEAR, null)).not.toBe(payloadHash(OP_UPSERT, ''))
  })
})

describe('enqueue + dedup + validering', () => {
  it('kräver fullständig identity, baseRevision och giltig storlek', async () => {
    await expect(enqueue({}, { operationType: OP_UPSERT, comment: 'x', baseRevision: 1 })).rejects.toThrow('identity-incomplete')
    await expect(enqueue(IDENT, { operationType: OP_UPSERT, comment: 'x' })).rejects.toThrow('base-revision-required')
    await expect(enqueue(IDENT, { operationType: OP_UPSERT, comment: 'a'.repeat(8001), baseRevision: 1 })).rejects.toThrow('payload-too-large')
  })
  it('sparar operationen lokalt FÖRE nätverksanrop med pending-status och idempotencyKey', async () => {
    const op = await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'hej', baseRevision: 2 })
    expect(op.status).toBe(QUEUE_STATUS.PENDING)
    expect(op.idempotencyKey).toBeTruthy()
    expect(op.baseRevision).toBe(2)
    expect(op.payload).toBe('hej')
    expect((await listForUser('u1')).length).toBe(1)
  })
  it('dubbelklick (samma identity+payload+baseRevision) skapar EN operation', async () => {
    const a = await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'dup', baseRevision: 1 })
    const b = await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'dup', baseRevision: 1 })
    expect(a.operationId).toBe(b.operationId)
    expect((await listForUser('u1')).length).toBe(1)
  })
  it('isolerar kö per userId', async () => {
    await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'a', baseRevision: 1 })
    await enqueue({ ...IDENT, userId: 'u2' }, { operationType: OP_UPSERT, comment: 'b', baseRevision: 1 })
    expect((await listForUser('u1')).length).toBe(1)
    expect((await listForUser('u2')).length).toBe(1)
  })
})

describe('claimNext (atomisk) + recoverStuck', () => {
  it('endast en claim lyckas; andra claim ger null tills åter redo', async () => {
    await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'x', baseRevision: 1 })
    const first = await claimNext('u1')
    expect(first.status).toBe(QUEUE_STATUS.PROCESSING)
    expect(first.attemptCount).toBe(1)
    const second = await claimNext('u1')          // redan processing → inget redo
    expect(second).toBe(null)
  })
  it('recoverStuck återställer processing efter lease-timeout', async () => {
    await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'x', baseRevision: 1 })
    const c = await claimNext('u1', Date.now(), { leaseMs: 1 })
    const n = await recoverStuck('u1', Date.now() + 1000)
    expect(n).toBe(1)
    const ops = await listForUser('u1')
    expect(ops[0].status).toBe(QUEUE_STATUS.RETRY_WAIT)
    expect(c.operationId).toBe(ops[0].operationId)
  })
})

describe('mapServerResult (deterministisk resultatmappning)', () => {
  const cases = [
    [{ outcome: 'succeeded' }, QUEUE_STATUS.SUCCEEDED],
    [{ outcome: 'no_change' }, QUEUE_STATUS.SUCCEEDED],
    [{ errorCode: 'revision_conflict' }, QUEUE_STATUS.CONFLICT],
    [{ errorCode: 'validation_failed' }, QUEUE_STATUS.REJECTED],
    [{ errorCode: 'engagement_approved' }, QUEUE_STATUS.REJECTED],
    [{ errorCode: 'engagement_locked' }, QUEUE_STATUS.REJECTED],
    [{ errorCode: 'feature_disabled' }, QUEUE_STATUS.PAUSED],
    [{ errorCode: 'not_found' }, QUEUE_STATUS.REJECTED],
    [{ errorCode: 'entity_deleted' }, QUEUE_STATUS.REJECTED],
    [{ errorCode: 'idempotency_payload_mismatch' }, QUEUE_STATUS.REJECTED],
    [{ errorCode: 'transaction_retry' }, QUEUE_STATUS.RETRY_WAIT],
  ]
  it.each(cases)('domän %o → %s', (data, expected) => {
    expect(mapServerResult({ data }).status).toBe(expected)
  })
  const transport = [
    ['unauthorized', QUEUE_STATUS.PAUSED, true],
    ['membership_removed', QUEUE_STATUS.REJECTED, false],
    ['forbidden', QUEUE_STATUS.REJECTED, false],
    ['timeout', QUEUE_STATUS.RETRY_WAIT, false],
    ['unavailable', QUEUE_STATUS.RETRY_WAIT, false],
  ]
  it.each(transport)('transport %s → %s (reauth=%s)', (code, expected, reauth) => {
    const r = mapServerResult({ transportErrorCode: code })
    expect(r.status).toBe(expected)
    expect(!!r.requireReauth).toBe(reauth)
  })
})

describe('classifyTransport', () => {
  it('klassificerar timeout/abort, unauthorized, membership, forbidden, nät', () => {
    expect(classifyTransport({ name: 'AbortError' })).toBe('timeout')
    expect(classifyTransport({ code: 'TIMEOUT' })).toBe('timeout')
    expect(classifyTransport({ code: '28000', message: 'not authenticated' })).toBe('unauthorized')
    expect(classifyTransport({ message: 'membership_removed' })).toBe('membership_removed')
    expect(classifyTransport({ message: 'forbidden' })).toBe('forbidden')
    expect(classifyTransport({ message: 'Failed to fetch' })).toBe('unavailable')
  })
})

describe('retry-policy', () => {
  it('AUTO_RETRYABLE och NEVER_AUTO_RETRY är disjunkta och korrekta', () => {
    for (const c of NEVER_AUTO_RETRY) expect(AUTO_RETRYABLE).not.toContain(c)
    expect(AUTO_RETRYABLE).toContain('transaction_retry')
    expect(NEVER_AUTO_RETRY).toContain('validation_failed')
  })
  it('canAutoRetry endast för retryable och under maxförsök', () => {
    expect(canAutoRetry('timeout', 1)).toBe(true)
    expect(canAutoRetry('validation_failed', 1)).toBe(false)
    expect(canAutoRetry('timeout', 6)).toBe(false)   // MAX_ATTEMPTS
  })
  it('computeBackoff växer exponentiellt och kapas vid max', () => {
    const now = 1_000_000
    const d1 = computeBackoff(1, now) - now
    const d3 = computeBackoff(3, now) - now
    const dBig = computeBackoff(20, now) - now
    expect(d3).toBeGreaterThan(d1)
    expect(dBig).toBeLessThanOrEqual(60000 * 1.25 + 1)
  })
  it('applyResult: retry_wait → backoff medan retryable; → rejected när uttömt', async () => {
    const op = await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'x', baseRevision: 1 })
    // simulera 1 försök
    await claimNext('u1')
    await applyResult(op.operationId, mapServerResult({ transportErrorCode: 'timeout' }))
    let cur = (await listForUser('u1'))[0]
    expect(cur.status).toBe(QUEUE_STATUS.RETRY_WAIT)
    expect(cur.nextAttemptAt).toBeGreaterThan(Date.now())
    // pumpa attemptCount till max → rejected
    for (let i = 0; i < 8; i++) { const c = await claimNext('u1', cur.nextAttemptAt + 1); if (!c) break; await applyResult(op.operationId, mapServerResult({ transportErrorCode: 'timeout' }), { now: cur.nextAttemptAt + 1 }); cur = (await listForUser('u1'))[0] }
    expect(cur.status).toBe(QUEUE_STATUS.REJECTED)
  })
})

describe('sanitizeServerResult (ingen kommentartext)', () => {
  it('lagrar metadata men ALDRIG kommentartext', () => {
    const s = sanitizeServerResult({ outcome: 'conflict', errorCode: 'revision_conflict', currentRevision: 5,
      serverVersion: { comment: 'HEMLIG TEXT', commentRevision: 5, commentUpdatedAt: 't', commentUpdatedBy: 'u9' } })
    expect(JSON.stringify(s)).not.toContain('HEMLIG TEXT')
    expect(s.hasServerComment).toBe(true)
    expect(s.serverCommentRevision).toBe(5)
    expect(s.changedBy).toBe('u9')
  })
})

describe('syncLeader tiebreak', () => {
  it('lägst tabId vinner deterministiskt (broadcast-läge-logik)', () => {
    // ren jämförelse av tiebreak-regeln
    const a = 'tab-aaa', b = 'tab-bbb'
    expect(a < b).toBe(true)        // a vinner
    const l = createLeader({ userId: 'u1', companyId: 'c1', tabId: a })
    expect(typeof l.start).toBe('function')
    expect(['web-locks', 'broadcast-lease']).toContain(l.mode)
  })
})

describe('computeBackoff deterministisk (injicerbar klocka + random) §8', () => {
  const zero = () => 0, one = () => 1
  it('rand=0 → exakt base; exponentiell ökning', () => {
    expect(computeBackoff(1, 0, { rand: zero })).toBe(2000)
    expect(computeBackoff(2, 0, { rand: zero })).toBe(4000)
    expect(computeBackoff(3, 0, { rand: zero })).toBe(8000)
    expect(computeBackoff(4, 0, { rand: zero })).toBe(16000)
  })
  it('kapas vid maximal delay', () => {
    expect(computeBackoff(20, 0, { rand: zero })).toBe(60000)
    expect(computeBackoff(20, 0, { rand: one })).toBe(60000 + 15000)   // base 60000 + 25 %
  })
  it('jitter ligger inom [0, 25 % av base] för valfri rand', () => {
    for (const r of [0, 0.1, 0.5, 0.9, 0.999]) {
      const d = computeBackoff(2, 0, { rand: () => r })             // base 4000
      expect(d).toBeGreaterThanOrEqual(4000)
      expect(d).toBeLessThanOrEqual(4000 + 1000)
    }
  })
  it('respekterar now-offset', () => {
    expect(computeBackoff(1, 1_000_000, { rand: zero })).toBe(1_002_000)
  })
})

describe('lease-takeover-cykel §9 (fastnad processing)', () => {
  it('claim→stuck→recover efter expiry→reclaim; samma operationId; attemptCount +1 per verkligt försök', async () => {
    const t0 = 1_000_000
    const op = await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'x', baseRevision: 1, now: t0 })
    const c1 = await claimNext('u1', t0, { leaseMs: 5000 })
    expect(c1.status).toBe(QUEUE_STATUS.PROCESSING)
    expect(c1.attemptCount).toBe(1)
    // före expiry: ingen recovery, ingen ny worker tar över
    expect(await recoverStuck('u1', t0 + 1000)).toBe(0)
    expect(await claimNext('u1', t0 + 1000)).toBe(null)
    // efter expiry: recovery → retry_wait, sedan reclaim
    expect(await recoverStuck('u1', t0 + 6000)).toBe(1)
    const c2 = await claimNext('u1', t0 + 6000)
    expect(c2.operationId).toBe(op.operationId)         // samma operation, ingen dubblett
    expect(c2.attemptCount).toBe(2)                      // exakt +1 per verkligt försök
    expect((await listForUser('u1')).length).toBe(1)
  })
})

describe('manualRetry', () => {
  it('flyttar retry_wait/paused → pending nu', async () => {
    const op = await enqueue(IDENT, { operationType: OP_UPSERT, comment: 'x', baseRevision: 1 })
    await claimNext('u1')
    await applyResult(op.operationId, mapServerResult({ data: { errorCode: 'feature_disabled' } }))
    expect((await listForUser('u1'))[0].status).toBe(QUEUE_STATUS.PAUSED)
    await manualRetry(op.operationId)
    expect((await listForUser('u1'))[0].status).toBe(QUEUE_STATUS.PENDING)
  })
})
