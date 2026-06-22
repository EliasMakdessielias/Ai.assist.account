import { HELP_ARTICLES, ARTICLE_BY_SLUG, ARTICLE_BY_ID } from './articles'
import { HELP_CATEGORIES, CATEGORY_ICON, roleAllowed } from './categories'

export { HELP_ARTICLES, ARTICLE_BY_SLUG, ARTICLE_BY_ID, HELP_CATEGORIES, CATEGORY_ICON, roleAllowed }

// Hela artikelns sökbara text (titel väger tyngst, sedan nyckelord, sedan brödtext).
function haystack(art) {
  const body = [art.summary, art.purpose, art.when, art.example,
    ...(art.steps || []), ...(art.fields || []).flat(), ...(art.errors || []).flat()].join(' ')
  return { title: art.title.toLowerCase(), keywords: (art.keywords || []).join(' ').toLowerCase(), category: art.category.toLowerCase(), body: body.toLowerCase() }
}

// Artiklar användaren får se utifrån behörighet. access = { isAdmin, canViewOps }.
export function visibleArticles(access = {}) {
  return HELP_ARTICLES.filter(a => roleAllowed(a.requiredRole, access))
}

// Kategorier användaren får se (med ikon).
export function visibleCategories(access = {}) {
  return HELP_CATEGORIES.filter(c => roleAllowed(c.requiredRole, access))
}

// Söker artiklar på titel, nyckelord, kategori och innehåll. Returnerar rankade träffar.
export function searchArticles(query, access = {}) {
  const q = String(query || '').trim().toLowerCase()
  const pool = visibleArticles(access)
  if (!q) return []
  const terms = q.split(/\s+/).filter(Boolean)
  const scored = []
  for (const art of pool) {
    const h = haystack(art)
    let score = 0
    for (const t of terms) {
      if (h.title.includes(t)) score += 10
      if (h.keywords.includes(t)) score += 6
      if (h.category.includes(t)) score += 3
      if (h.body.includes(t)) score += 1
    }
    // Exakt fras i titel ger extra lyft.
    if (h.title.includes(q)) score += 8
    if (score > 0) scored.push({ art, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.art.title.localeCompare(b.art.title, 'sv')).map(s => s.art)
}

// Relaterade artiklar (filtrerade på behörighet), upplösta från slugs.
export function relatedOf(art, access = {}) {
  return (art.relatedArticles || [])
    .map(slug => ARTICLE_BY_SLUG[slug])
    .filter(a => a && roleAllowed(a.requiredRole, access))
}
