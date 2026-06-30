import { describe, it, expect } from 'vitest'
import { searchArticles, visibleArticles, visibleCategories, relatedOf } from './index'
import { ARTICLE_BY_SLUG, HELP_ARTICLES } from './articles'

const USER = { isAdmin: false, canViewOps: false }
const ADMIN = { isAdmin: true, canViewOps: true }

describe('handbok – sök & behörighet', () => {
  it('alla startartiklar har komplett metadata', () => {
    for (const a of HELP_ARTICLES) {
      expect(a.id).toBeTruthy()
      expect(a.slug).toBeTruthy()
      expect(a.title).toBeTruthy()
      expect(a.category).toBeTruthy()
      expect(Array.isArray(a.keywords)).toBe(true)
      expect(a.updatedAt).toBeTruthy()
      expect(a.appVersion).toBeTruthy()
      expect(a.summary).toBeTruthy()
    }
  })

  it('slugs är unika', () => {
    const slugs = HELP_ARTICLES.map(a => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('viktiga nyckelartiklar finns', () => {
    for (const slug of ['skapa-leverantorsfaktura', 'bokfora-kvitto', 'ladda-upp-underlag', 'lagg-till-anstalld', 'registrera-dagskassa', 'momsrapport']) {
      expect(ARTICLE_BY_SLUG[slug]).toBeTruthy()
    }
  })

  it('sök hittar på titel, nyckelord och innehåll', () => {
    expect(searchArticles('kvitto', USER).some(a => a.slug === 'bokfora-kvitto')).toBe(true)
    expect(searchArticles('leverantörsfaktura', USER).some(a => a.slug === 'skapa-leverantorsfaktura')).toBe(true)
    expect(searchArticles('anställd', USER).some(a => a.slug === 'lagg-till-anstalld')).toBe(true)
    expect(searchArticles('429 kvot', USER).some(a => a.slug === 'kvotfel-rate-limits')).toBe(true)
  })

  it('tom sökning ger inga träffar; nonsens ger inga träffar', () => {
    expect(searchArticles('', USER)).toHaveLength(0)
    expect(searchArticles('zzqqxx', USER)).toHaveLength(0)
  })

  it('behörighet: vanlig användare ser inte superadmin/systemövervakning', () => {
    const userSlugs = visibleArticles(USER).map(a => a.slug)
    expect(userSlugs).not.toContain('superadmin')
    expect(userSlugs).not.toContain('systemovervakning')
    const adminSlugs = visibleArticles(ADMIN).map(a => a.slug)
    expect(adminSlugs).toContain('superadmin')
    expect(adminSlugs).toContain('systemovervakning')
  })

  it('behörighetsstyrda kategorier döljs för vanlig användare', () => {
    const userCats = visibleCategories(USER).map(c => c.key)
    expect(userCats).not.toContain('Superadmin')
    expect(visibleCategories(ADMIN).map(c => c.key)).toContain('Superadmin')
  })

  it('superadmin-artikel kommer inte upp i sök för vanlig användare', () => {
    expect(searchArticles('superadmin', USER).some(a => a.slug === 'superadmin')).toBe(false)
    expect(searchArticles('superadmin', ADMIN).some(a => a.slug === 'superadmin')).toBe(true)
  })

  it('relaterade artiklar löses upp från slugs', () => {
    const art = ARTICLE_BY_SLUG['skapa-leverantorsfaktura']
    const rel = relatedOf(art, USER)
    expect(rel.some(r => r.slug === 'koppla-underlag')).toBe(true)
  })

  it('alla relaterade slugs pekar på befintliga artiklar', () => {
    for (const a of HELP_ARTICLES) {
      for (const slug of a.relatedArticles) {
        expect(ARTICLE_BY_SLUG[slug], `${a.slug} → ${slug}`).toBeTruthy()
      }
    }
  })
})

describe('handbok – ROBO-bp-artikel (Steg 2I)', () => {
  const art = ARTICLE_BY_SLUG['robo-bp']
  const fullText = [art?.summary, art?.purpose, art?.when, art?.example,
    ...(art?.steps || []), ...(art?.fields || []).flat(), ...(art?.errors || []).flat()].join(' ').toLowerCase()

  it('artikeln finns och slug fungerar', () => {
    expect(art).toBeTruthy()
    expect(art.slug).toBe('robo-bp')
    expect(art.category).toBe('ROBO-bp')
  })
  it('innehåller viktiga säkerhetsfraser', () => {
    expect(fullText).toContain('bokför inte automatiskt')
    expect(fullText).toContain('ändrar inte bokföringsdata')
    expect(fullText).toContain('kräver mänsklig granskning')
  })
  it('dokumenterar nyckelbegreppen', () => {
    for (const term of ['underlag för svaret', 'confidence', 'ai-säkerhet', 'decision_basis', 'kontrollpunkt', 'systemkontroll', 'in_progress']) {
      expect(fullText).toContain(term)
    }
  })
  it('hittas via sök', () => {
    expect(searchArticles('robo-bp', USER).some(a => a.slug === 'robo-bp')).toBe(true)
    expect(searchArticles('kontrollpunkt confidence', USER).some(a => a.slug === 'robo-bp')).toBe(true)
  })
})
