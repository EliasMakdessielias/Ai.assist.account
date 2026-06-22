import { describe, it, expect } from 'vitest'
import { buildSupportKb, technicalContext } from './supportAi'

describe('supportAi', () => {
  it('bygger handbokskontext (kb) som innehåller relevanta artiklar', () => {
    const kb = buildSupportKb('Hur bokför jag ett kvitto?', { isAdmin: false, canViewOps: false })
    expect(kb).toMatch(/kvitto/i)
    expect(kb).toMatch(/Steg:|Syfte:/)
  })

  it('kb tomt för helt orelaterad fråga', () => {
    expect(buildSupportKb('väder i paris zzz', {})).toBe('')
  })

  it('technicalContext innehåller route, browser och timestamp', () => {
    const c = technicalContext('/bokforing')
    expect(c.route).toBe('/bokforing')
    expect(c).toHaveProperty('browser')
    expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
