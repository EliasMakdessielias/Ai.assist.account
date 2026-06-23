import { describe, it, expect } from 'vitest'
import { riskRank, isOpenCheck, sortChecks, groupByCategory, categoryLabel, CHECKLIST_CATEGORIES, FEATURE_KEY, PERMISSIONS } from './bokslut'

describe('bokslut', () => {
  it('riskRank ordnar kritisk först', () => {
    expect(riskRank('critical')).toBeLessThan(riskRank('high'))
    expect(riskRank('high')).toBeLessThan(riskRank('medium'))
    expect(riskRank('medium')).toBeLessThan(riskRank('low'))
    expect(riskRank('okänt')).toBe(9)
  })

  it('isOpenCheck: öppna inkl needs_review, ej resolved/ignored', () => {
    expect(isOpenCheck('open')).toBe(true)
    expect(isOpenCheck('needs_review')).toBe(true)
    expect(isOpenCheck('resolved')).toBe(false)
    expect(isOpenCheck('ignored')).toBe(false)
  })

  it('sortChecks prioriterar risk', () => {
    const s = sortChecks([
      { risk_level: 'low', category: 'moms', title: 'a' },
      { risk_level: 'critical', category: 'arets_resultat', title: 'b' },
      { risk_level: 'medium', category: 'bank', title: 'c' },
    ])
    expect(s[0].risk_level).toBe('critical')
    expect(s[2].risk_level).toBe('low')
  })

  it('groupByCategory grupperar och behåller kategoriordning', () => {
    const groups = groupByCategory([
      { category: 'moms', risk_level: 'medium', title: 'm' },
      { category: 'bankavstamning', risk_level: 'high', title: 'b' },
    ])
    expect(groups.map(g => g.key)).toEqual(['bankavstamning', 'moms']) // bank före moms enligt CHECKLIST_CATEGORIES
    expect(groups[0].items).toHaveLength(1)
  })

  it('katalog + konstanter', () => {
    expect(categoryLabel('eget_kapital')).toBe('Eget kapital')
    expect(CHECKLIST_CATEGORIES.some(c => c.key === 'noter')).toBe(true)
    expect(FEATURE_KEY).toBe('ai_bokslut_arsredovisning')
    expect(PERMISSIONS.APPROVE).toBe('ai_bokslut_approve')
  })
})
