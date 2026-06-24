import { describe, it, expect } from 'vitest'
import { commitCheckComment } from './commit'

// Etapp 2C: varje serverfall verifieras SEPARAT (inte via ett gemensamt catch-block).
// commitCheckComment ska kasta vid alla fel och returnera true ENDAST vid bekräftad, validerad respons.
const sb = (rpcImpl) => ({ rpc: rpcImpl })

describe('commitCheckComment – serverfelmatris (Etapp 2C)', () => {
  it('lyckad validerad respons → true (anroparen raderar lokalt utkast)', async () => {
    await expect(commitCheckComment(sb(async () => ({ data: null, error: null })), 'chk1', 'text')).resolves.toBe(true)
  })

  it('401 → kastar', async () => {
    await expect(commitCheckComment(sb(async () => ({ error: { status: 401, message: 'Unauthorized' } })), 'c', 't')).rejects.toBeTruthy()
  })

  it('403 → kastar', async () => {
    await expect(commitCheckComment(sb(async () => ({ error: { status: 403, message: 'Forbidden' } })), 'c', 't')).rejects.toBeTruthy()
  })

  it('500 → kastar', async () => {
    await expect(commitCheckComment(sb(async () => ({ error: { status: 500, message: 'Server error' } })), 'c', 't')).rejects.toBeTruthy()
  })

  it('request timeout → kastar', async () => {
    await expect(commitCheckComment(sb(async () => { throw new Error('timeout of 0ms exceeded') }), 'c', 't')).rejects.toThrow(/timeout/)
  })

  it('AbortError (avbrutet request) → kastar', async () => {
    await expect(commitCheckComment(sb(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }), 'c', 't')).rejects.toBeTruthy()
  })

  it('nätverket helt offline → kastar', async () => {
    await expect(commitCheckComment(sb(async () => { throw new TypeError('Failed to fetch') }), 'c', 't')).rejects.toThrow(/Failed to fetch/)
  })

  it('felaktigt RPC-svar (null/odefinierat) → kastar', async () => {
    await expect(commitCheckComment(sb(async () => null), 'c', 't')).rejects.toThrow(/Ogiltigt svar/)
    await expect(commitCheckComment(sb(async () => undefined), 'c', 't')).rejects.toThrow(/Ogiltigt svar/)
  })

  it('timeout via riktig AbortController → kastar TIMEOUT (utkast behålls), skild från 401/500', async () => {
    // builder.abortSignal(sig) avvisar med AbortError NÄR signalen aborteras → bevisar att aborten når anropet.
    const sb2 = { rpc: () => ({ abortSignal: (sig) => new Promise((_, rej) => { sig.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e) }) }) }) }
    await expect(commitCheckComment(sb2, 'c', 't', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('AbortSignal skickas genom adaptern (.abortSignal anropas med en AbortSignal)', async () => {
    let got = null
    const sb2 = { rpc: () => ({ abortSignal: (sig) => { got = sig; return Promise.resolve({ error: null }) } }) }
    await expect(commitCheckComment(sb2, 'c', 't')).resolves.toBe(true)
    expect(got).toBeInstanceOf(AbortSignal)
  })
})
