import { supabase } from './supabase'
import { searchArticles } from '../help'

// Komprimerar en handboksartikel till kort text för AI-kontext (RAG-lite).
function articleToText(a) {
  return [
    `# ${a.title} (${a.category})`,
    a.summary,
    a.purpose && `Syfte: ${a.purpose}`,
    a.when && `När: ${a.when}`,
    a.steps?.length && `Steg: ${a.steps.join(' ')}`,
    a.fields?.length && `Fält: ${a.fields.map(f => f.join(': ')).join('; ')}`,
    a.errors?.length && `Vanliga fel: ${a.errors.map(e => e.join(' → ')).join('; ')}`,
    a.example && `Exempel: ${a.example}`,
  ].filter(Boolean).join('\n')
}

// Bygger kunskapskontext (kb) ur handboken för en supportfråga – endast artiklar användaren
// har behörighet till (access). AI:n svarar enbart utifrån denna text + supportreglerna.
export function buildSupportKb(question, access = {}) {
  const hits = searchArticles(question, access).slice(0, 5)
  return hits.map(articleToText).join('\n\n---\n\n')
}

// Frågar AI-supporten. Svar kommer enbart inom BokPilots supportområde (edge: support-ai).
// Returnerar { svar, in_scope, foreslar_eskalering, model }.
export async function askSupportAi({ question, history = [], company, user, role, route, access }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) { const e = new Error('Sessionen har gått ut. Logga in igen.'); e.code = 'session_expired'; throw e }
  const kb = buildSupportKb(question, access)
  const { data, error } = await supabase.functions.invoke('support-ai', {
    body: {
      fraga: question, history: history.slice(-6), kb, company_id: company?.id || null, route,
      user_context: { name: user?.email || null, company: company?.name || null, role: role || 'user' },
    },
    headers: { Authorization: `Bearer ${token}` },
  })
  if (error) {
    let m = error.message
    try { const b = await error.context.json(); if (b?.error) m = b.error } catch { /* ignore */ }
    throw new Error(m)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// Teknisk kontext som bifogas vid eskalering till mänsklig support.
export function technicalContext(route) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return { route: route || (typeof location !== 'undefined' ? location.pathname : ''), browser: ua, timestamp: new Date().toISOString() }
}
