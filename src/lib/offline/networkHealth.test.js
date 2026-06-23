import { describe, it, expect } from 'vitest'
import { classifyNetwork } from './networkHealth'

// Etapp 1A: verifierar att nätverksklassningen skiljer offline från auth-/serverfel.
describe('classifyNetwork', () => {
  it('server nåbar, allt ok → online', () => {
    expect(classifyNetwork({ reachable: true, serverError: false, sessionValid: true, online: true, recent: [true, true] })).toBe('online')
  })

  it('401/403 (auth) räknas INTE som offline (servern nåddes)', () => {
    // 401/403 → reachable=true, serverError=false
    expect(classifyNetwork({ reachable: true, serverError: false, sessionValid: true, online: true, recent: [true] })).toBe('online')
  })

  it('500 (serverfel) räknas INTE som offline', () => {
    expect(classifyNetwork({ reachable: true, serverError: true, sessionValid: true, online: true, recent: [true] })).toBe('server_error')
  })

  it('timeout/nätfel med navigator.onLine=false → offline', () => {
    expect(classifyNetwork({ reachable: false, serverError: false, sessionValid: true, online: false, recent: [false] })).toBe('offline')
  })

  it('timeout/nätfel med navigator.onLine=true → servern kan inte nås', () => {
    expect(classifyNetwork({ reachable: false, serverError: false, sessionValid: true, online: true, recent: [false] })).toBe('server_unreachable')
  })

  it('blandade resultat → instabil anslutning', () => {
    expect(classifyNetwork({ reachable: true, serverError: false, sessionValid: true, online: true, recent: [true, false, true] })).toBe('unstable')
  })

  it('ogiltig session men server nåbar → session (ej offline)', () => {
    expect(classifyNetwork({ reachable: true, serverError: false, sessionValid: false, online: true, recent: [true] })).toBe('session')
  })
})
