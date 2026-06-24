import { describe, it, expect } from 'vitest'
import { fetchPilotServerEnabled, PILOT_FEATURE_KEY } from './flags'

// Etapp 2D: explicit company-level uppslag (ingen plan-fallback). Frånvaro/false/fel → ALLTID false.
const sb = (result, opts = {}) => {
  const calls = { from: null, eqs: [] }
  return {
    _calls: calls,
    from(t) { calls.from = t; const b = { select: () => b, eq: (col, val) => { calls.eqs.push([col, val]); return b }, maybeSingle: async () => { if (opts.throw) throw new Error('boom'); return result } }; return b },
  }
}

describe('fetchPilotServerEnabled (Etapp 2D)', () => {
  it('rad med enabled=true → true', async () => {
    expect(await fetchPilotServerEnabled(sb({ data: { enabled: true }, error: null }), 'c1')).toBe(true)
  })
  it('rad med enabled=false → false', async () => {
    expect(await fetchPilotServerEnabled(sb({ data: { enabled: false }, error: null }), 'c1')).toBe(false)
  })
  it('ingen rad (frånvaro) → false', async () => {
    expect(await fetchPilotServerEnabled(sb({ data: null, error: null }), 'c1')).toBe(false)
  })
  it('läsfel/error → false (aldrig på)', async () => {
    expect(await fetchPilotServerEnabled(sb({ data: null, error: { message: 'rls' } }), 'c1')).toBe(false)
  })
  it('kastat undantag → false', async () => {
    expect(await fetchPilotServerEnabled(sb(null, { throw: true }), 'c1')).toBe(false)
  })
  it('saknat companyId → false (ingen query)', async () => {
    expect(await fetchPilotServerEnabled(sb({ data: { enabled: true } }), null)).toBe(false)
  })
  it('frågar exakt rätt feature_key och bolag', async () => {
    const client = sb({ data: { enabled: true }, error: null })
    await fetchPilotServerEnabled(client, 'c-XYZ')
    expect(client._calls.from).toBe('company_ai_features')
    expect(client._calls.eqs).toEqual([['company_id', 'c-XYZ'], ['feature_key', PILOT_FEATURE_KEY]])
  })
})
